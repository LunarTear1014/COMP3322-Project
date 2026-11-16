import { with_transaction } from "../db/transaction.js";
import { notify } from "../api_v1/common.js";
import { utc_to_campus_date, to_mysql_utc } from "../shared/slots.js";
import { claim_due, complete, enqueue, fail } from "./queue.js";

const asDate = (text) => new Date(`${String(text).replace(" ", "T")}Z`);
const DAY = 86_400_000;

// event_reminder: lock club then event, recheck, notify current joined students.
async function deliver_reminder(conn, job, now) {
  const { event_id, user_id } = job.payload;
  const [[ref]] = await conn.query("SELECT club_id FROM events WHERE id = ?", [event_id]);
  if (!ref) return;
  await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [ref.club_id]);
  const [[event]] = await conn.query("SELECT * FROM events WHERE id = ? FOR UPDATE", [event_id]);
  // Suppress cancelled, started and unpublished events; reminders only exist before the start.
  if (event.status !== "published" || asDate(event.start_time) <= now) return;
  const [recipients] = await conn.query(
    `SELECT user_id FROM participations WHERE event_id = ? AND status = 'joined'${user_id ? " AND user_id = ?" : ""}`, user_id ? [event_id, user_id] : [event_id]);
  for (const { user_id: target } of recipients) {
    // One visible key for the event-level and the late-registration path.
    await notify(conn, { users: [target], type: "event_reminder", event_id, club_id: event.club_id, now, key: `reminder:${event_id}`, title: `Coming up: ${event.title}`, body: "This event starts within 24 hours." });
  }
}

// activity_digest: yesterday's joins, leaves and member changes for one club.
async function deliver_digest(conn, job, now) {
  const { club_id, campus_date } = job.payload;
  const [[done]] = [await conn.query("SELECT 1 AS done FROM activity_digests WHERE club_id = ? AND campus_date = ?", [club_id, campus_date])].map((r) => [r[0][0]]);
  if (done) return;
  const counts = await digest_counts(conn, club_id, campus_date);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return;
  const [[club]] = await conn.query("SELECT name FROM clubs WHERE id = ?", [club_id]);
  const [committee] = await conn.query("SELECT user_id FROM memberships WHERE club_id = ? AND role IN ('committee', 'president')", [club_id]);
  await conn.query("INSERT IGNORE INTO activity_digests (club_id, campus_date) VALUES (?, ?)", [club_id, campus_date]);
  const body = `${counts.joined} joined, ${counts.left} left, ${counts.members_joined} new members, ${counts.members_left} left the club.`;
  await notify(conn, { users: committee.map((row) => row.user_id), type: "activity_digest", club_id, now, key: `digest:${club_id}:${campus_date}`, title: `${club.name} yesterday`, body });
}

async function digest_counts(db, club_id, campus_date) {
  const from = new Date(`${campus_date}T00:00:00+08:00`);
  const to = new Date(from.getTime() + DAY);
  const [rows] = await db.query(
    `SELECT h.action, COUNT(*) AS n FROM participation_history h JOIN events e ON e.id = h.event_id
     WHERE e.club_id = ? AND h.occurred_at >= ? AND h.occurred_at < ? AND h.action IN ('joined', 'left') GROUP BY h.action`, [club_id, to_mysql_utc(from), to_mysql_utc(to)]);
  const [members] = await db.query(
    `SELECT action, COUNT(*) AS n FROM audit_logs WHERE entity_type = 'membership' AND entity_id = ? AND action IN ('member.joined', 'member.left') AND created_at >= ? AND created_at < ? GROUP BY action`,
    [club_id, to_mysql_utc(from), to_mysql_utc(to)]);
  const get = (list, key) => Number(list.find((row) => row.action === key)?.n ?? 0);
  return { joined: get(rows, "joined"), left: get(rows, "left"), members_joined: get(members, "member.joined"), members_left: get(members, "member.left") };
}

const HANDLERS = { event_reminder: deliver_reminder, activity_digest: deliver_digest };

// Executes one claimed job: deliver and acknowledge in one transaction; a
// delivery whose token no longer matches is rolled back (fencing).
async function run_job(pool, job, now) {
  const handler = HANDLERS[job.type];
  try {
    await with_transaction(pool, async (conn) => {
      if (handler) await handler(conn, job, now);
      if (!(await complete(conn, job, now))) throw Object.assign(new Error("lease lost"), { fenced: true });
    });
    return "completed";
  } catch (error) {
    if (error.fenced) return "fenced";
    await fail(pool, job, error, now);
    return "failed";
  }
}

// Event reminder scan: published events starting in (now, now + 24h].
async function scan_reminders(pool, now) {
  const [events] = await pool.query(
    "SELECT id FROM events WHERE status = 'published' AND start_time > ? AND start_time <= ?", [to_mysql_utc(now), to_mysql_utc(new Date(now.getTime() + DAY))]);
  let created = 0;
  for (const { id } of events) {
    if (await enqueue(pool, { action_key: `reminder-event:${id}`, type: "event_reminder", event_id: id, payload: { event_id: id }, now })) created += 1;
  }
  return created;
}

// From 09:00 campus time, one digest job per club with activity in the last 3 campus days (catch-up).
async function scan_digests(pool, now) {
  const hour = new Date(now.getTime() + 8 * 3_600_000).getUTCHours();
  if (hour < 9) return 0;
  const today = utc_to_campus_date(now);
  let created = 0;
  for (let back = 1; back <= 3; back += 1) {
    const date = utc_to_campus_date(new Date(now.getTime() - back * DAY));
    const [clubs] = await pool.query("SELECT id FROM clubs");
    for (const { id } of clubs) {
      const [[sent]] = [await pool.query("SELECT 1 AS sent FROM activity_digests WHERE club_id = ? AND campus_date = ?", [id, date])].map((r) => [r[0][0]]);
      if (sent) continue;
      const counts = await digest_counts(pool, id, date);
      if (!Object.values(counts).some(Boolean)) continue;
      if (await enqueue(pool, { action_key: `digest:${id}:${date}`, type: "activity_digest", payload: { club_id: id, campus_date: date }, now })) created += 1;
    }
  }
  void today;
  return created;
}

// Daily maintenance: purge old views.
async function maintenance(pool, now) {
  const [views] = await pool.query("DELETE FROM event_views WHERE viewed_at < ?", [to_mysql_utc(new Date(now.getTime() - 180 * DAY))]);
  // Live signals are only useful for the second after they are written.
  const [signals] = await pool.query("DELETE FROM live_signals WHERE created_at < ?", [to_mysql_utc(new Date(now.getTime() - DAY))]);
  return { views_purged: views.affectedRows, signals_purged: signals.affectedRows };
}

async function run_once(pool, now, { limit = 10 } = {}) {
  const jobs = await claim_due(pool, { now, limit });
  const outcomes = [];
  for (const job of jobs) outcomes.push(await run_job(pool, job, now));
  return outcomes;
}

export { digest_counts, maintenance, run_job, run_once, scan_digests, scan_reminders };
