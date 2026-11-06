import { test, after } from "node:test";
import assert from "node:assert/strict";

// These tests write rows and must only run against a disposable test database.
const enabled = process.env.CLUBSPACE_TEST_DB === "1" &&
  /^clubspace_test_/.test(process.env.DB_NAME || "");

test("cancellation atomically releases active registrations and is idempotent", { skip: !enabled }, async () => {
  const { default: pool } = await import("../../config/db.js");
  const { cancel_event, leave_event, join_event, create_event, edit_event, list_notifications, mark_notification_read } = await import("./events.service.js");
  const { leave_club } = await import("../clubs/clubs.service.js");
  const { timeslot_bounds } = await import("../../shared/timeslots.js");
  const { claimJob, deliverJob, failJob, scanReminders } = await import("../../jobs/notifications.js");
  const { clubReport, parseReportRange } = await import("../clubs/reports.service.js");
  const { decideBooking, publishEvent } = await import("./approval.service.js");
  after(() => pool.end());
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const users = [];
  for (let i = 0; i < 4; i++) {
    const [result] = await pool.query("INSERT INTO users (email,password_hash,name,student_id) VALUES (?,?,?,?)", [`${suffix}-${i}@example.test`, "unused", `User ${i}`, `${suffix}-${i}`]);
    users.push(result.insertId);
  }
  const [club] = await pool.query("INSERT INTO clubs (name) VALUES (?)", [`Club ${suffix}`]);
  const [venue] = await pool.query("INSERT INTO venues (name,location,capacity) VALUES (?,?,?)", [`Venue ${suffix}`, "Test", 1]);
  await pool.query("INSERT INTO memberships (user_id,club_id,role) VALUES (?,?,'committee')", [users[0], club.insertId]);
  async function eventAt(offsetHours) {
    const [booking] = await pool.query(`INSERT INTO bookings (venue_id,club_id,start_time,end_time,status)
      VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR),DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR),'confirmed')`,
      [venue.insertId, club.insertId, offsetHours, offsetHours + 1]);
    const [event] = await pool.query(`INSERT INTO events (booking_id,club_id,title,start_time,end_time,capacity,status)
      SELECT id,club_id,'Integration event',start_time,end_time,1,'published' FROM bookings WHERE id = ?`, [booking.insertId]);
    return { id: event.insertId, booking: booking.insertId };
  }
  const event = await eventAt(10); // legacy datetime = HKT, therefore two hours ahead
  await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined'),(?,?,'waitlisted')", [users[1], event.id, users[2], event.id]);
  assert.equal((await cancel_event(event.id, users[3], 1, "test cancellation")).reason, "forbidden");
  assert.equal((await cancel_event(event.id, users[0], 1, "test cancellation")).ok, true);
  assert.equal((await cancel_event(event.id, users[0], 1, "test cancellation")).already_cancelled, true);
  const firstClaim = await claimJob(pool);
  assert.equal(await deliverJob(pool, firstClaim), true);
  const [rows] = await pool.query("SELECT status FROM participations WHERE event_id = ? ORDER BY user_id", [event.id]);
  assert.deepEqual(rows.map(row => row.status), ["cancelled", "cancelled"]);
  const [history] = await pool.query("SELECT action FROM participation_history WHERE event_id=? ORDER BY id", [event.id]);
  assert.deepEqual(history.map(row => row.action), ["cancelled", "cancelled"]);
  const [[booking]] = await pool.query("SELECT status FROM bookings WHERE id = ?", [event.booking]);
  assert.equal(booking.status, "cancelled");
  const [messages] = await pool.query("SELECT id,user_id FROM notifications WHERE event_id = ?", [event.id]);
  assert.equal(messages.length, 2);
  const notification = messages.find(row => row.user_id === users[1]);
  assert.equal(await mark_notification_read(notification.id, users[2]), false);
  assert.equal(await mark_notification_read(notification.id, users[1]), true);
  const first = (await list_notifications(users[1]))[0].read_at;
  assert.equal(await mark_notification_read(notification.id, users[1]), true);
  assert.equal((await list_notifications(users[1]))[0].read_at, first);
  assert.equal((await leave_event(event.id, users[1])).cancelled, true);

  const started = await eventAt(7);
  assert.equal((await cancel_event(started.id, users[0], 1, "test cancellation")).reason, "started");
  assert.equal((await join_event(started.id, users[1])).reason, "unavailable");

  const rollback = await eventAt(12);
  await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined')", [users[1], rollback.id]);
  await pool.query(`CREATE TRIGGER test_cancellation_failure BEFORE UPDATE ON participations FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected cancellation failure'`);
  try {
    assert.equal((await cancel_event(rollback.id, users[0], 1, "test cancellation")).reason, "database");
  } finally {
    await pool.query("DROP TRIGGER test_cancellation_failure");
  }
  const [[rolledBack]] = await pool.query(`SELECT e.status AS event_status, b.status AS booking_status,
    (SELECT COUNT(*) FROM notifications WHERE event_id = e.id) AS messages
    FROM events e JOIN bookings b ON b.id=e.booking_id WHERE e.id=?`, [rollback.id]);
  assert.equal(rolledBack.event_status, "published");
  assert.equal(rolledBack.booking_status, "confirmed");
  assert.equal(rolledBack.messages, 0);
  const [[orphan]] = await pool.query("SELECT COUNT(*) AS count FROM notification_jobs WHERE event_id=?", [rollback.id]);
  assert.equal(orphan.count, 0);
  const [[historyOrphan]] = await pool.query("SELECT COUNT(*) AS count FROM participation_history WHERE event_id=?", [rollback.id]);
  assert.equal(historyOrphan.count, 0);

  const race = await eventAt(11);
  await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined'),(?,?,'waitlisted')", [users[1], race.id, users[2], race.id]);
  const results = await Promise.all([cancel_event(race.id, users[0], 1, "test cancellation"), leave_event(race.id, users[1])]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, true);
  const [[active]] = await pool.query("SELECT COUNT(*) AS count FROM participations WHERE event_id=? AND status IN ('joined','waitlisted')", [race.id]);
  assert.equal(active.count, 0);

  const reminder = await eventAt(14);
  await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined')", [users[3], reminder.id]);
  await scanReminders(pool);
  const [[reminderJob]] = await pool.query("SELECT id FROM notification_jobs WHERE action_key=?", [`reminder-scan:${reminder.id}`]);
  // A reclaimed lease must fence the stale worker and roll back its insert.
  await pool.query("UPDATE notification_jobs SET status='processing',attempts=1,lock_token='old',locked_until=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE id=?", [reminderJob.id]);
  assert.equal(await deliverJob(pool, { id: reminderJob.id, token: 'old' }), false);
  const [[staleMessages]] = await pool.query("SELECT COUNT(*) AS count FROM notifications WHERE event_id=?", [reminder.id]);
  assert.equal(staleMessages.count, 0);
  await pool.query("UPDATE notification_jobs SET status='processing',attempts=2,lock_token='new',locked_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 120 SECOND) WHERE id=?", [reminderJob.id]);
  assert.equal(await deliverJob(pool, { id: reminderJob.id, token: 'new' }), true);
  await pool.query("UPDATE notification_jobs SET status='processing',lock_token='replay',locked_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 120 SECOND) WHERE id=?", [reminderJob.id]);
  assert.equal(await deliverJob(pool, { id: reminderJob.id, token: 'replay' }), true);
  const [[delivered]] = await pool.query("SELECT COUNT(*) AS count FROM notifications WHERE event_id=? AND user_id=?", [reminder.id, users[3]]);
  assert.equal(delivered.count, 1);

  const suppressed = await eventAt(15);
  await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'joined')", [users[3], suppressed.id]);
  await scanReminders(pool);
  const [[suppressedJob]] = await pool.query("SELECT id FROM notification_jobs WHERE action_key=?", [`reminder-scan:${suppressed.id}`]);
  assert.equal((await cancel_event(suppressed.id, users[0], 1, "test cancellation")).ok, true);
  await pool.query("UPDATE notification_jobs SET status='processing',attempts=1,lock_token='suppressed',locked_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 120 SECOND) WHERE id=?", [suppressedJob.id]);
  assert.equal(await deliverJob(pool, { id: suppressedJob.id, token: 'suppressed' }), true);
  const [[suppressedMessages]] = await pool.query("SELECT COUNT(*) AS count FROM notifications WHERE event_id=? AND dedup_key LIKE 'reminder:%'", [suppressed.id]);
  assert.equal(suppressedMessages.count, 0);

  const [[failedJob]] = await pool.query("SELECT id FROM notification_jobs WHERE event_id=? AND type='event_cancelled'", [suppressed.id]);
  await pool.query("UPDATE notification_jobs SET status='processing',attempts=5,lock_token='failure',locked_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 120 SECOND) WHERE id=?", [failedJob.id]);
  await failJob(pool, { id: failedJob.id, token: 'stale' });
  const [[beforeFailure]] = await pool.query("SELECT status FROM notification_jobs WHERE id=?", [failedJob.id]);
  assert.equal(beforeFailure.status, 'processing');
  await failJob(pool, { id: failedJob.id, token: 'failure' });
  const [[afterFailure]] = await pool.query("SELECT status,last_error FROM notification_jobs WHERE id=?", [failedJob.id]);
  assert.deepEqual(afterFailure, { status: 'failed', last_error: 'delivery_failed' });

  const historyEvent = await eventAt(50);
  assert.equal((await join_event(historyEvent.id, users[1])).status, "joined");
  assert.equal((await join_event(historyEvent.id, users[1])).unchanged, true);
  assert.equal((await leave_event(historyEvent.id, users[1])).ok, true);
  assert.equal((await leave_event(historyEvent.id, users[1])).unchanged, true);
  assert.equal((await join_event(historyEvent.id, users[1])).status, "joined");
  const [actions] = await pool.query("SELECT action FROM participation_history WHERE event_id=? ORDER BY id", [historyEvent.id]);
  assert.deepEqual(actions.map(row => row.action), ["joined", "left", "joined"]);
  await pool.query("UPDATE events SET capacity=3 WHERE id=?", [historyEvent.id]);
  assert.equal((await join_event(historyEvent.id, users[2])).status, 'joined');
  assert.equal((await leave_event(historyEvent.id, users[2])).ok, true);
  assert.equal((await join_event(historyEvent.id, users[2])).status, 'joined');
  const range = { start: Date.now() - 3600000, end: Date.now() + 72 * 3600000 };
  assert.equal((await clubReport(club.insertId, users[1], range)).reason, "forbidden");
  const report = (await clubReport(club.insertId, users[0], range)).data;
  assert.ok(!JSON.stringify(report).includes('attendance'));
  const listed = report.events.find(row => row.event_id === historyEvent.id);
  assert.equal(listed.joined_count, 2);
  assert.equal(report.daily_actions.reduce((sum, row) => sum + row.joined, 0), 4);
  assert.ok(report.daily_actions.reduce((sum, row) => sum + row.left, 0) >= 2);
  assert.ok(report.daily_actions.some(row => row.joined === 0 && row.left === 0));
  assert.ok(report.history_complete_from.endsWith("Z"));
  const [[bookingTime]] = await pool.query("SELECT start_time FROM bookings WHERE id=?", [historyEvent.booking]);
  const start = Date.parse(bookingTime.start_time.replace(" ", "T") + "+08:00");
  const clipped = (await clubReport(club.insertId, users[0], { start: start + 1800000, end: start + 3600000 })).data;
  assert.equal(clipped.venue_hours[0].hours, 0.5);
  assert.equal(parseReportRange("2026-02-30T00:00:00Z", "2026-03-02T00:00:00Z"), null);
  assert.equal(parseReportRange("2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"), null);

  const [[dateRow]] = await pool.query("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 6 DAY),'%Y-%m-%d') AS date");
  const bookingInput = { club: `Club ${suffix}`, venue: `Venue ${suffix}`, title: "Booking race", description: "Test", date: dateRow.date,
    timeslot: "10:00 - 12:00", visibility: "Public", bounds: timeslot_bounds(dateRow.date, "10:00 - 12:00"), user_id: users[0] };
  await pool.query("UPDATE users SET platform_role='venue_admin' WHERE id IN (?,?)", [users[0], users[3]]);
  const [[beforeCreationFailure]] = await pool.query("SELECT (SELECT COUNT(*) FROM bookings) AS bookings,(SELECT COUNT(*) FROM events) AS events,(SELECT COUNT(*) FROM audit_logs) AS audits,(SELECT COUNT(*) FROM notification_jobs) AS jobs");
  await pool.query("CREATE TRIGGER test_event_creation_failure BEFORE INSERT ON events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected event failure'");
  try { assert.equal((await create_event(bookingInput)).reason, 'database'); }
  finally { await pool.query('DROP TRIGGER test_event_creation_failure'); }
  const [[afterCreationFailure]] = await pool.query("SELECT (SELECT COUNT(*) FROM bookings) AS bookings,(SELECT COUNT(*) FROM events) AS events,(SELECT COUNT(*) FROM audit_logs) AS audits,(SELECT COUNT(*) FROM notification_jobs) AS jobs");
  assert.deepEqual(afterCreationFailure, beforeCreationFailure);
  const bookings = await Promise.all([create_event(bookingInput), create_event(bookingInput)]);
  assert.equal(bookings.filter(item => item.ok).length, 2);
  const [requests] = await pool.query("SELECT id FROM bookings WHERE requested_by=? ORDER BY id DESC LIMIT 2", [users[0]]);
  const [[requestedJob]] = await pool.query("SELECT payload FROM notification_jobs WHERE booking_id=? AND type='booking_requested'", [requests[0].id]);
  const requestPayload = typeof requestedJob.payload === 'string' ? JSON.parse(requestedJob.payload) : requestedJob.payload;
  assert.deepEqual(requestPayload.recipients, [users[3]]);
  const [[requestAudit]] = await pool.query("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='booking' AND entity_id=? AND action='booking.requested' AND actor_user_id=?", [requests[0].id,users[0]]);
  assert.equal(requestAudit.count, 1);
  assert.equal((await decideBooking(requests[0].id, users[0], 1, "approve")).reason, "self_decision");
  const decisions = await Promise.all(requests.map(request => decideBooking(request.id, users[3], 1, "approve")));
  assert.equal(decisions.filter(result => result.ok).length, 1);
  assert.equal(decisions.filter(result => result.reason === 'conflict').length, 1);
  const approved = decisions.find(result => result.ok);
  const pendingId = requests.find(request => request.id !== approved.booking_id).id;
  assert.equal((await decideBooking(pendingId, users[3], 2, 'reject', 'Unavailable')).reason, 'stale');
  assert.equal((await decideBooking(pendingId, users[3], 1, 'reject', 'Unavailable')).status, 'rejected');
  const eventId = approved.event_id;
  const [[draft]] = await pool.query("SELECT status FROM events WHERE id=?", [eventId]);
  assert.equal(draft.status, 'draft');
  assert.equal((await edit_event(eventId, { title: 'Updated draft', description: 'Updated', expected_version: 1, capacity: 1, visibility: 'Public' }, users[0])).ok, true);
  assert.equal((await publishEvent(eventId, users[0], 1)).reason, 'stale');
  assert.equal((await publishEvent(eventId, users[3], 1)).reason, 'forbidden');
  assert.equal((await publishEvent(eventId, users[0], 2)).ok, true);
  assert.equal((await edit_event(eventId, { title: "Updated", description: "Test", bounds: bookingInput.bounds, expected_version: 3 }, users[0])).reason, "frozen");

  const seats = await eventAt(80);
  const joined = await Promise.all([join_event(seats.id, users[1]), join_event(seats.id, users[2])]);
  assert.deepEqual(joined.map(row => row.status).sort(), ["joined", "waitlisted"]);
  const [[seatCounts]] = await pool.query("SELECT SUM(status='joined') AS joined, SUM(status='waitlisted') AS waiting FROM participations WHERE event_id=?", [seats.id]);
  assert.deepEqual(seatCounts, { joined: '1', waiting: '1' });

  const privateEvent = await eventAt(82);
  await pool.query("UPDATE events SET visibility='members_only' WHERE id=?", [privateEvent.id]);
  await pool.query("INSERT INTO memberships (user_id,club_id,role) VALUES (?,?,'member')", [users[3], club.insertId]);
  assert.equal((await join_event(privateEvent.id, users[3])).status, 'pending');
  const [registration, departure] = await Promise.all([join_event(privateEvent.id, users[3], true, users[0]), leave_club(club.insertId, users[3])]);
  assert.ok((registration.ok && departure.reason === 'active_registration') || (registration.reason === 'membership_required' && departure.ok));

  const fifo = await eventAt(84);
  await pool.query("INSERT INTO participations (user_id,event_id,status) VALUES (?,?,'waitlisted')", [users[1], fifo.id]);
  assert.equal((await join_event(fifo.id, users[2])).status, "waitlisted");
  const [fifoRows] = await pool.query("SELECT user_id,status FROM participations WHERE event_id=? ORDER BY user_id", [fifo.id]);
  assert.deepEqual(fifoRows.map(row => row.status), ["joined", "waitlisted"]);

  const legacy = await eventAt(86);
  await pool.query("UPDATE events SET visibility='members_only' WHERE id=?", [legacy.id]);
  await pool.query("INSERT IGNORE INTO memberships (user_id,club_id,role) VALUES (?,?,'member')", [users[3], club.insertId]);
  await pool.query(`INSERT INTO participations (user_id,event_id,status,joined_at) VALUES
    (?,?,'joined',CURRENT_TIMESTAMP(6)),(?,?,'waitlisted',DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 2 SECOND)),
    (?,?,'waitlisted',DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 SECOND))`,
  [users[0], legacy.id, users[2], legacy.id, users[3], legacy.id]);
  assert.equal((await leave_event(legacy.id, users[0])).promoted_user_id, users[3]);
  const [legacyRows] = await pool.query("SELECT user_id,status FROM participations WHERE event_id=? ORDER BY user_id", [legacy.id]);
  assert.deepEqual(legacyRows.map(row => row.status), ["left", "left", "joined"]);
  const [[ineligible]] = await pool.query("SELECT reason FROM participation_history WHERE event_id=? AND user_id=?", [legacy.id, users[2]]);
  assert.equal(ineligible.reason, "membership_ineligible");
});
