import { randomUUID } from "node:crypto";
import { to_mysql_utc } from "../shared/slots.js";

// Durable outbox queue (backend.md section 9). At-least-once execution with
// idempotent visible results: lease tokens fence stale workers, notification
// keys deduplicate deliveries.

const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;
const RETRY_DELAYS_S = [5, 30, 120, 600];
const db = (date) => to_mysql_utc(date);

// Written inside the source transaction. A duplicate action_key is a no-op.
async function enqueue(conn, { action_key, type, event_id = null, booking_id = null, payload = {}, due_at, now }) {
  const [result] = await conn.query(
    `INSERT IGNORE INTO notification_jobs (action_key, type, event_id, booking_id, payload, status, due_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [action_key, type, event_id, booking_id, JSON.stringify(payload), db(due_at ?? now), db(now)]);
  return result.affectedRows === 1;
}

// Claims due jobs (and expired leases that still have attempts left) and commits
// the claim before any domain lock is taken.
async function claim_due(pool, { now, limit = 1 }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // An expired lease on the last attempt becomes failed; it never reaches attempt 6.
    await conn.query(
      `UPDATE notification_jobs SET status = 'failed', last_error = 'lease_expired_last_attempt', lock_token = NULL
       WHERE status = 'processing' AND locked_until < ? AND attempts >= ?`, [db(now), MAX_ATTEMPTS]);
    const [due] = await conn.query(
      `SELECT id FROM notification_jobs
       WHERE (status = 'pending' AND due_at <= ?) OR (status = 'processing' AND locked_until < ? AND attempts < ?)
       ORDER BY due_at, id LIMIT ? FOR UPDATE SKIP LOCKED`, [db(now), db(now), MAX_ATTEMPTS, limit]);
    const claimed = [];
    for (const { id } of due) {
      const token = randomUUID();
      await conn.query(
        "UPDATE notification_jobs SET status = 'processing', attempts = attempts + 1, lock_token = ?, locked_until = ? WHERE id = ?",
        [token, db(new Date(now.getTime() + LEASE_SECONDS * 1000)), id]);
      const [[job]] = await conn.query("SELECT * FROM notification_jobs WHERE id = ?", [id]);
      claimed.push({ ...job, payload: typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload, lock_token: token });
    }
    await conn.commit();
    return claimed;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// Acknowledges inside the delivery transaction. Returns false (so the caller
// rolls back) when the token no longer owns the job.
async function complete(conn, job, now) {
  const [result] = await conn.query(
    "UPDATE notification_jobs SET status = 'completed', completed_at = ?, lock_token = NULL WHERE id = ? AND lock_token = ? AND status = 'processing'",
    [db(now), job.id, job.lock_token]);
  return result.affectedRows === 1;
}

async function fail(pool, job, error, now) {
  const message = String(error?.message ?? error).replace(/[\r\n]+/g, " ").slice(0, 1000);
  const last = job.attempts >= MAX_ATTEMPTS;
  const delay = RETRY_DELAYS_S[Math.min(job.attempts, RETRY_DELAYS_S.length) - 1];
  await pool.query(
    `UPDATE notification_jobs SET status = ?, last_error = ?, lock_token = NULL, locked_until = NULL, due_at = ? WHERE id = ? AND lock_token = ?`,
    [last ? "failed" : "pending", message, db(last ? now : new Date(now.getTime() + delay * 1000)), job.id, job.lock_token]);
}

// Operator-only: reset a failed job and leave an audit record.
async function requeue_failed(pool, job_id, { now, operator = "operator" }) {
  const [result] = await pool.query(
    "UPDATE notification_jobs SET status = 'pending', attempts = 0, lock_token = NULL, locked_until = NULL, due_at = ?, last_error = NULL WHERE id = ? AND status = 'failed'", [db(now), job_id]);
  if (result.affectedRows) {
    await pool.query("INSERT INTO audit_logs (action_id, actor_user_id, entity_type, entity_id, action, details, created_at) VALUES (?, NULL, 'event', 0, 'job.requeued', ?, ?)",
      [randomUUID(), JSON.stringify({ job_id, operator }), db(now)]);
  }
  return result.affectedRows === 1;
}

export { LEASE_SECONDS, MAX_ATTEMPTS, RETRY_DELAYS_S, claim_due, complete, enqueue, fail, requeue_failed };
