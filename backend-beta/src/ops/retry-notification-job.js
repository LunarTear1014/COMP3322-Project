import pool from "../config/db.js";
import { audit } from "../features/events/audit.js";

const jobId = Number(process.argv[2]);
const operatorId = Number(process.argv[3]);
if (!Number.isSafeInteger(jobId) || jobId < 1 || !Number.isSafeInteger(operatorId) || operatorId < 1) {
  console.error("Usage: node src/ops/retry-notification-job.js JOB_ID VENUE_ADMIN_USER_ID");
  process.exit(2);
}
const connection = await pool.getConnection();
try {
  await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
  await connection.beginTransaction();
  const [[operator]] = await connection.query("SELECT platform_role FROM users WHERE id=?", [operatorId]);
  if (operator?.platform_role !== "venue_admin") throw new Error("Operator must be a venue administrator.");
  const [[job]] = await connection.query("SELECT id,event_id,status FROM notification_jobs WHERE id=? FOR UPDATE", [jobId]);
  if (!job || job.status !== "failed" || !job.event_id) throw new Error("Job is missing or is not failed.");
  await connection.query(`UPDATE notification_jobs SET status='pending',attempts=0,due_at=UTC_TIMESTAMP(6),
    lock_token=NULL,locked_until=NULL,last_error=NULL,completed_at=NULL WHERE id=?`, [jobId]);
  await audit(connection, operatorId, "event", job.event_id, "notification.retry", { job_id: jobId });
  await connection.commit();
  console.log(`Notification job ${jobId} queued for retry.`);
} catch (error) {
  await connection.rollback();
  console.error(error.message);
  process.exitCode = 1;
} finally { connection.release(); await pool.end(); }
