import pool from "./config/db.js";
import { verifyWorkflowSchema } from "./config/schema.js";
import { randomUUID } from "node:crypto";
import { claimJob, deliverJob, failJob, scanReminders } from "./jobs/notifications.js";

let stopping = false;
const workerId = `worker-${randomUUID()}`;
let wake;
let shutdownTimer;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  stopping = true;
  shutdownTimer ||= setTimeout(() => process.exit(1), 28000).unref();
  wake?.();
});
const pause = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); wake = () => { clearTimeout(timer); resolve(); }; });
let nextScan = 0;
let nextHeartbeat = 0;
try {
  await verifyWorkflowSchema(pool);
  while (!stopping) {
    try {
      if (Date.now() >= nextHeartbeat) {
        await pool.query(`INSERT INTO worker_heartbeats (worker_id,last_seen_at) VALUES (?,UTC_TIMESTAMP(6))
          ON DUPLICATE KEY UPDATE last_seen_at=VALUES(last_seen_at)`, [workerId]);
        nextHeartbeat = Date.now() + 30000;
      }
      if (Date.now() >= nextScan) { await scanReminders(pool); nextScan = Date.now() + 60000; }
      if (stopping) break;
      const claim = await claimJob(pool);
      if (!claim) { await pause(5000); continue; }
      try { await deliverJob(pool, claim); }
      catch { await failJob(pool, claim); console.error("Notification delivery failed; job scheduled for retry or operator review."); }
    } catch { console.error("Notification worker could not reach the database; retrying."); await pause(5000); }
  }
} finally {
  try { await pool.query("DELETE FROM worker_heartbeats WHERE worker_id=?", [workerId]); }
  finally { await pool.end(); clearTimeout(shutdownTimer); }
}
