import { randomUUID } from "node:crypto";

const types = new Set(["event_changed", "event_cancelled", "event_reminder", "registration_changed", "booking_requested", "booking_decided"]);
const registrationMessages = {
  joined: "Your registration was confirmed",
  waitlisted: "You were added to the waitlist",
  left: "Your registration was withdrawn",
  promoted: "You were promoted from the waitlist",
  rejected: "Your registration request was declined",
};
const retrySeconds = [5, 30, 120, 600];

// The caller supplies its active transaction; recipient lists are server-generated.
export async function enqueueEventJob(connection, { type, eventId, bookingId = null, recipients, title, action = null, actionKey = randomUUID() }) {
  if (!types.has(type) || !Number.isSafeInteger(eventId) || eventId < 1 ||
      !Array.isArray(recipients) || recipients.length > 1500 ||
      recipients.some(id => !Number.isSafeInteger(id) || id < 1) ||
      typeof title !== "string" || title.length > 255 ||
      (type === "registration_changed" && !Object.hasOwn(registrationMessages, action)) ||
      (type === "booking_decided" && !["approved", "rejected"].includes(action)) ||
      typeof actionKey !== "string" || !/^[\x21-\x7e]{1,191}$/.test(actionKey)) {
    throw new Error("Invalid notification job payload");
  }
  await connection.query(`INSERT INTO notification_jobs
    (action_key,type,event_id,booking_id,payload,due_at,created_at)
    VALUES (?,?,?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
  [actionKey, type, eventId, bookingId, JSON.stringify({ recipients: [...new Set(recipients)], title, action })]);
}

export async function claimJob(pool, leaseSeconds = 120) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    await connection.query(`UPDATE notification_jobs SET status='failed', last_error='lease_expired_last_attempt',
      lock_token=NULL, locked_until=NULL WHERE status='processing' AND locked_until <= UTC_TIMESTAMP(6) AND attempts >= 5`);
    const [[job]] = await connection.query(`SELECT id FROM notification_jobs
      WHERE (status='pending' AND due_at <= UTC_TIMESTAMP(6)) OR
        (status='processing' AND locked_until <= UTC_TIMESTAMP(6) AND attempts < 5)
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!job) { await connection.commit(); return null; }
    const token = randomUUID();
    await connection.query(`UPDATE notification_jobs SET status='processing',attempts=attempts+1,
      lock_token=?,locked_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND) WHERE id=?`, [token, leaseSeconds, job.id]);
    await connection.commit();
    return { id: job.id, token };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function deliverJob(pool, claim) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    // Read without locking the job: domain rows must be locked before acknowledgement.
    const [[job]] = await connection.query(`SELECT j.type,j.event_id,j.booking_id,j.payload,j.action_key,e.club_id
      FROM notification_jobs j LEFT JOIN events e ON e.id=j.event_id WHERE j.id=?`, [claim.id]);
    if (!job || !job.event_id || !job.club_id) throw new Error("Invalid event job");
    await connection.query("SELECT id FROM clubs WHERE id=? FOR UPDATE", [job.club_id]);
    const [[event]] = await connection.query(`SELECT e.id,e.status,e.title,b.status AS booking_status,
      e.start_time > DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 8 HOUR) AS future,
      e.start_time <= DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 32 HOUR) AS within_day
      FROM events e JOIN bookings b ON b.id=e.booking_id WHERE e.id=? FOR UPDATE`, [job.event_id]);
    if (!event) throw new Error("Event missing");
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    if (!types.has(job.type) || !payload || !Array.isArray(payload.recipients) || payload.recipients.length > 1500 ||
        payload.recipients.some(id => !Number.isSafeInteger(id) || id < 1) || typeof payload.title !== "string" ||
        (job.type === "registration_changed" && !Object.hasOwn(registrationMessages, payload.action)) ||
        (job.type === "booking_decided" && !["approved", "rejected"].includes(payload.action))) {
      throw new Error("Invalid event job payload");
    }
    let recipients = payload.recipients;
    if (job.type === "event_changed" && event.status === "cancelled") recipients = [];
    if (job.type === "event_reminder") {
      if (event.status !== "published" || event.booking_status !== "confirmed" || !event.future || !event.within_day) recipients = [];
      else if (recipients.length === 0) {
        const [rows] = await connection.query("SELECT user_id FROM participations WHERE event_id=? AND status='joined'", [event.id]);
        recipients = rows.map(row => row.user_id);
      } else {
        const [rows] = await connection.query("SELECT user_id FROM participations WHERE event_id=? AND status='joined' AND user_id IN (?)", [event.id, recipients]);
        recipients = rows.map(row => row.user_id);
      }
    }
    const message = job.type === "event_cancelled" ? `"${payload.title}" was cancelled by its organising club.` :
      job.type === "event_changed" ? `"${payload.title}" has been updated. Please review the new details.` :
      job.type === "registration_changed" ? `${registrationMessages[payload.action]} for "${payload.title}".` :
      job.type === "booking_requested" ? `Venue request for "${payload.title}" is awaiting review.` :
      job.type === "booking_decided" ? `Venue request for "${payload.title}" was ${payload.action}.` :
        `"${payload.title}" starts within 24 hours.`;
    for (const userId of recipients) {
      const key = job.type === "event_reminder" ? `reminder:${event.id}:${userId}` : job.action_key;
      await connection.query(`INSERT INTO notifications (user_id,event_id,booking_id,type,event_title,message,dedup_key)
        VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, [userId, event.id, job.booking_id, job.type, payload.title, message, key]);
    }
    const [ack] = await connection.query(`UPDATE notification_jobs SET status='completed',completed_at=UTC_TIMESTAMP(6),
      lock_token=NULL,locked_until=NULL,last_error=NULL WHERE id=? AND status='processing' AND lock_token=?
      AND locked_until > UTC_TIMESTAMP(6)`, [claim.id, claim.token]);
    if (ack.affectedRows !== 1) { await connection.rollback(); return false; }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function failJob(pool, claim) {
  // Do not persist exception text: SQL errors can contain private payloads.
  await pool.query(`UPDATE notification_jobs SET status=IF(attempts>=5,'failed','pending'),
    due_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL CASE attempts WHEN 1 THEN ? WHEN 2 THEN ? WHEN 3 THEN ? ELSE ? END SECOND),
    last_error='delivery_failed',lock_token=NULL,locked_until=NULL
    WHERE id=? AND status='processing' AND lock_token=? AND locked_until > UTC_TIMESTAMP(6)`, [...retrySeconds, claim.id, claim.token]);
}

// Legacy beta event datetimes are stored as Hong Kong wall time (UTC+08).
export async function scanReminders(pool) {
  const [events] = await pool.query(`SELECT e.id,e.title FROM events e JOIN bookings b ON b.id=e.booking_id
    WHERE e.status='published' AND b.status='confirmed' AND e.start_time > DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 8 HOUR)
      AND e.start_time <= DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 32 HOUR)`);
  for (const event of events) {
    await pool.query(`INSERT INTO notification_jobs (action_key,type,event_id,payload,due_at,created_at)
      VALUES (?,'event_reminder',?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE id=id`,
    [`reminder-scan:${event.id}`, event.id, JSON.stringify({ recipients: [], title: event.title })]);
  }
}
