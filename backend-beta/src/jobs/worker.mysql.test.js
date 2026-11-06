import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const enabled = process.env.CLUBSPACE_TEST_DB === "1" && /^clubspace_test_/.test(process.env.DB_NAME || "");
test("worker recovers a lease after restart and operator retry is audited", { skip: !enabled }, async () => {
  const { default: pool } = await import("../config/db.js");
  const { enqueueEventJob } = await import("./notifications.js");
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const [user] = await pool.query("INSERT INTO users (email,password_hash,name,student_id,platform_role) VALUES (?,?,?,?,'venue_admin')", [`worker-${suffix}@example.test`, "unused", "Test", `w-${suffix}`]);
  const [club] = await pool.query("INSERT INTO clubs (name) VALUES (?)", [`Worker club ${suffix}`]);
  const [venue] = await pool.query("INSERT INTO venues (name,location,capacity) VALUES (?,?,?)", [`Worker venue ${suffix}`, "Test", 10]);
  const [booking] = await pool.query(`INSERT INTO bookings (venue_id,club_id,start_time,end_time,status)
    VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 56 HOUR),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 57 HOUR),'confirmed')`, [venue.insertId, club.insertId]);
  const [event] = await pool.query(`INSERT INTO events (booking_id,club_id,title,start_time,end_time,capacity,status)
    SELECT id,club_id,'Worker event',start_time,end_time,10,'published' FROM bookings WHERE id=?`, [booking.insertId]);
  await enqueueEventJob(pool, { type: "registration_changed", eventId: event.insertId, title: "Worker event", recipients: [user.insertId], action: "joined" });
  const [[job]] = await pool.query("SELECT id FROM notification_jobs WHERE event_id=?", [event.insertId]);
  const launch = () => spawn(process.execPath, ["src/worker.js"], { env: process.env, stdio: "ignore" });
  let worker = launch();
  async function waitForStatus(status) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [[row]] = await pool.query("SELECT status FROM notification_jobs WHERE id=?", [job.id]);
      if (row.status === status) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`Job did not reach ${status}`);
  }
  try {
    await waitForStatus("completed");
    const [[heartbeat]] = await pool.query("SELECT COUNT(*) AS n FROM worker_heartbeats WHERE last_seen_at > DATE_SUB(UTC_TIMESTAMP(),INTERVAL 120 SECOND)");
    assert.ok(heartbeat.n > 0);
    worker.kill("SIGTERM");
    await once(worker, "exit");
    await pool.query("UPDATE notification_jobs SET status='processing',attempts=1,lock_token='crashed',locked_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=?", [job.id]);
    worker = launch();
    await waitForStatus("completed");
    const [[delivered]] = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE event_id=? AND user_id=?", [event.insertId, user.insertId]);
    assert.equal(delivered.n, 1);
    worker.kill("SIGTERM");
    await once(worker, "exit");
    await pool.query("UPDATE notification_jobs SET status='failed',attempts=5,last_error='delivery_failed' WHERE id=?", [job.id]);
    const retry = spawn(process.execPath, ["src/ops/retry-notification-job.js", String(job.id), String(user.insertId)], { env: process.env, stdio: "ignore" });
    const [code] = await once(retry, "exit");
    assert.equal(code, 0);
    const [[retried]] = await pool.query("SELECT status,attempts FROM notification_jobs WHERE id=?", [job.id]);
    assert.deepEqual(retried, { status: "pending", attempts: 0 });
    const [[entry]] = await pool.query("SELECT COUNT(*) AS n FROM audit_logs WHERE actor_user_id=? AND action='notification.retry' AND entity_id=?", [user.insertId, event.insertId]);
    assert.equal(entry.n, 1);
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) { worker.kill("SIGTERM"); await once(worker, "exit"); }
    await pool.end();
  }
});
