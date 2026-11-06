import { test } from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.CLUBSPACE_TEST_DB === '1' && /^clubspace_test_/.test(process.env.DB_NAME || '');

test('reminders deduplicate scan and promotion and recheck current eligibility', { skip: !enabled }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { join_event, leave_event, cancel_event } = await import('../features/events/events.service.js');
  const { scanReminders, deliverJob, enqueueEventJob, failJob } = await import('./notifications.js');
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  try {
    const users = [];
    for (let i = 0; i < 2; i++) {
      const [user] = await pool.query('INSERT INTO users (email,password_hash,name,student_id) VALUES (?,?,?,?)', [`reminder-${suffix}-${i}@example.test`, 'unused', 'Test', `r-${suffix}-${i}`]);
      users.push(user.insertId);
    }
    const [club] = await pool.query('INSERT INTO clubs (name) VALUES (?)', [`Reminder club ${suffix}`]);
    const [venue] = await pool.query('INSERT INTO venues (name,location,capacity) VALUES (?,?,?)', [`Reminder venue ${suffix}`, 'Test', 1]);
    async function eventAt(offsetMinutes) {
      const [booking] = await pool.query(`INSERT INTO bookings (venue_id,club_id,start_time,end_time,status)
        VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE),DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE),'confirmed')`, [venue.insertId,club.insertId,offsetMinutes,offsetMinutes+60]);
      const [event] = await pool.query(`INSERT INTO events (booking_id,club_id,title,start_time,end_time,capacity,status)
        SELECT id,club_id,'Reminder test',start_time,end_time,1,'published' FROM bookings WHERE id=?`, [booking.insertId]);
      return event.insertId;
    }
    async function deliver(id) {
      const token = `test-${id}`;
      await pool.query("UPDATE notification_jobs SET status='processing',attempts=1,lock_token=?,locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND) WHERE id=?", [token,id]);
      return deliverJob(pool,{id,token});
    }

    // The scanner and late promotion can enqueue independent jobs for the same recipient.
    const event = await eventAt(600); // HKT wall time: two hours from now
    assert.equal((await join_event(event,users[0])).status,'joined');
    assert.equal((await join_event(event,users[1])).status,'waitlisted');
    await Promise.all([scanReminders(pool), leave_event(event,users[0])]);
    const [reminders] = await pool.query("SELECT id,action_key FROM notification_jobs WHERE event_id=? AND type='event_reminder' ORDER BY id",[event]);
    assert.equal(reminders.length,3); // first join, promotion, scanner
    await Promise.all(reminders.map(job => deliver(job.id)));
    const [visible] = await pool.query("SELECT user_id FROM notifications WHERE event_id=? AND type='event_reminder' ORDER BY user_id",[event]);
    assert.deepEqual(visible.map(row=>row.user_id),[users[1]], 'withdrawn member receives no reminder and promoted member receives exactly one');

    // Scans after downtime catch up future events but skip events outside the window or already started.
    const future = await eventAt(481), outside = await eventAt(1921), started = await eventAt(479);
    await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined'),(?,?,'joined'),(?,?,'joined')",[users[0],future,users[0],outside,users[0],started]);
    await scanReminders(pool);
    const [scanned] = await pool.query("SELECT event_id,id FROM notification_jobs WHERE type='event_reminder' AND event_id IN (?,?,?)",[future,outside,started]);
    assert.deepEqual(scanned.map(row=>row.event_id),[future]);
    assert.equal(await deliver(scanned[0].id),true);
    const [[futureNotice]] = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE event_id=? AND type='event_reminder'",[future]);
    assert.equal(futureNotice.n,1);
    await pool.query('UPDATE events SET start_time=DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),INTERVAL 1 SECOND) WHERE id=?',[future]);
    await pool.query('DELETE FROM notifications WHERE event_id=? AND type=\'event_reminder\'',[future]);
    assert.equal(await deliver(scanned[0].id),true);
    const [[afterStart]] = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE event_id=? AND type='event_reminder'",[future]);
    assert.equal(afterStart.n,0);

    // Every failed attempt has a bounded delay; the fifth requires operator review.
    await enqueueEventJob(pool, { type: 'registration_changed', eventId: outside, recipients: [users[0]], title: 'Retry test', action: 'joined', actionKey: `retry-test:${suffix}` });
    const [[retryJob]] = await pool.query('SELECT id FROM notification_jobs WHERE action_key=?', [`retry-test:${suffix}`]);
    for (const [attempt, delay] of [5,30,120,600,600].entries()) {
      const token = `failure-${attempt}`;
      await pool.query("UPDATE notification_jobs SET status='processing',attempts=?,lock_token=?,locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND) WHERE id=?", [attempt+1,token,retryJob.id]);
      await failJob(pool,{ id: retryJob.id, token });
      const [[row]] = await pool.query('SELECT status,last_error,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),due_at) AS delay FROM notification_jobs WHERE id=?',[retryJob.id]);
      assert.equal(row.status,attempt === 4 ? 'failed' : 'pending');
      assert.equal(row.last_error,'delivery_failed');
      assert.ok(row.delay >= delay-2 && row.delay <= delay, `unexpected delay after attempt ${attempt+1}: ${row.delay}`);
    }

    // Hold delivery at the club lock while cancellation starts on another connection.
    await pool.query("INSERT INTO memberships (user_id,club_id,role) VALUES (?,?,'committee')",[users[0],club.insertId]);
    const cancelling = await eventAt(600);
    await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined')",[users[1],cancelling]);
    await enqueueEventJob(pool,{ type:'event_reminder', eventId:cancelling, recipients:[users[1]], title:'Race test', actionKey:`race-test:${suffix}` });
    const [[raceJob]] = await pool.query('SELECT id FROM notification_jobs WHERE action_key=?',[`race-test:${suffix}`]);
    await pool.query("UPDATE notification_jobs SET status='processing',attempts=1,lock_token='race',locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND) WHERE id=?",[raceJob.id]);
    let locked, resume;
    const holding = new Promise(resolve => { locked = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    const gatedPool = { getConnection: async () => {
      const connection = await pool.getConnection();
      return new Proxy(connection, { get(target,key) {
        if (key === 'query') return async (...args) => {
          const result = await target.query(...args);
          if (args[0] === 'SELECT id FROM clubs WHERE id=? FOR UPDATE') { locked(); await gate; }
          return result;
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
    const delivering = deliverJob(gatedPool,{ id:raceJob.id, token:'race' });
    await holding;
    const cancellation = cancel_event(cancelling,users[0],1,'Cancelled during reminder delivery');
    try {
      assert.equal(await Promise.race([cancellation.then(() => 'finished'),new Promise(resolve => setTimeout(() => resolve('waiting'),100))]),'waiting');
    } finally { resume(); }
    assert.equal(await delivering,true);
    assert.equal((await cancellation).ok,true);
    const [[cancelledState]] = await pool.query('SELECT status FROM events WHERE id=?',[cancelling]);
    assert.equal(cancelledState.status,'cancelled');
    const [[beforeReplay]] = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE event_id=? AND type='event_reminder'",[cancelling]);
    assert.equal(beforeReplay.n,1, 'the in-flight delivery completed before cancellation');
    await pool.query("DELETE FROM notifications WHERE event_id=? AND type='event_reminder'",[cancelling]);
    await pool.query("UPDATE notification_jobs SET status='processing',lock_token='after-cancel',locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND) WHERE id=?",[raceJob.id]);
    assert.equal(await deliverJob(pool,{ id:raceJob.id, token:'after-cancel' }),true);
    const [[raceNotices]] = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE event_id=? AND type='event_reminder'",[cancelling]);
    assert.equal(raceNotices.n,0, 'the later replay after cancellation must not create a reminder');

    // Freeze one MySQL session to exercise the inclusive 24-hour and exclusive start boundaries.
    const clock = await pool.getConnection();
    try {
      await clock.query('SET timestamp = ?', [Date.parse('2026-11-06T00:00:00Z') / 1000]);
      const fixed = {
        query: (...args) => clock.query(...args),
        getConnection: async () => ({ query: (...args) => clock.query(...args),
          beginTransaction: () => clock.beginTransaction(), commit: () => clock.commit(),
          rollback: () => clock.rollback(), release: () => {} }),
      };
      async function fixedEvent(start) {
        const [booking] = await clock.query("INSERT INTO bookings (venue_id,club_id,start_time,end_time,status) VALUES (?,?,?,DATE_ADD(?,INTERVAL 1 HOUR),'confirmed')", [venue.insertId,club.insertId,start,start]);
        const [event] = await clock.query("INSERT INTO events (booking_id,club_id,title,start_time,end_time,capacity,status) SELECT id,club_id,'Boundary test',start_time,end_time,1,'published' FROM bookings WHERE id=?", [booking.insertId]);
        await clock.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined')",[users[0],event.insertId]);
        return event.insertId;
      }
      const atStart = await fixedEvent('2026-11-06 08:00:00');
      const oneMinute = await fixedEvent('2026-11-06 08:01:00');
      const at24 = await fixedEvent('2026-11-07 08:00:00');
      const after24 = await fixedEvent('2026-11-07 08:00:01');
      await scanReminders(fixed);
      const [boundaryJobs] = await clock.query("SELECT id,event_id FROM notification_jobs WHERE type='event_reminder' AND event_id IN (?,?,?,?) ORDER BY event_id", [atStart,oneMinute,at24,after24]);
      assert.deepEqual(boundaryJobs.map(row => row.event_id), [oneMinute,at24]);
      for (const job of boundaryJobs) {
        await clock.query("UPDATE notification_jobs SET status='processing',attempts=1,lock_token='fixed-clock',locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND) WHERE id=?",[job.id]);
        assert.equal(await deliverJob(fixed,{ id: job.id, token: 'fixed-clock' }),true);
      }
      const [[count]] = await clock.query("SELECT COUNT(*) AS n FROM notifications WHERE type='event_reminder' AND event_id IN (?,?,?,?)",[atStart,oneMinute,at24,after24]);
      assert.equal(count.n,2);
      await clock.query('SET timestamp = ?', [Date.parse('2026-11-06T00:01:00Z') / 1000]);
      await clock.query("DELETE FROM notifications WHERE event_id=? AND type='event_reminder'",[oneMinute]);
      await clock.query("UPDATE notification_jobs SET status='processing',lock_token='at-start',locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND) WHERE event_id=? AND type='event_reminder'",[oneMinute]);
      assert.equal(await deliverJob(fixed,{ id: boundaryJobs[0].id, token: 'at-start' }),true);
      const [[atStartCount]] = await clock.query("SELECT COUNT(*) AS n FROM notifications WHERE event_id=? AND type='event_reminder'",[oneMinute]);
      assert.equal(atStartCount.n,0);
    } finally {
      await clock.query('SET timestamp = 0');
      clock.release();
    }
  } finally { await pool.end(); }
});
