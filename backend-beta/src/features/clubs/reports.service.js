import pool from "../../config/db.js";

const DAY = 86400000;
const toSql = ms => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const actions = ["joined", "waitlisted", "left", "promoted", "cancelled"];

export function parseReportRange(from, to) {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  if (typeof from !== "string" || typeof to !== "string" || !iso.test(from) || !iso.test(to)) return null;
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 93 * DAY) return null;
  // Date.parse normalizes impossible dates; enforce a round trip to reject them.
  const canonical = value => value.replace(/(?:\.\d{1,3})?Z$/, suffix => suffix === "Z" ? ".000Z" : `${suffix.slice(0, -1).padEnd(4, "0")}Z`);
  if (new Date(start).toISOString() !== canonical(from) || new Date(end).toISOString() !== canonical(to)) return null;
  return { start, end };
}

export async function clubReport(clubId, userId, range) {
  const [[club]] = await pool.query("SELECT id FROM clubs WHERE id=?", [clubId]);
  if (!club) return { reason: "not_found" };
  const [[member]] = await pool.query("SELECT role FROM memberships WHERE club_id=? AND user_id=?", [clubId, userId]);
  if (!["committee", "president"].includes(member?.role)) return { reason: "forbidden" };
  const from = toSql(range.start), to = toSql(range.end);
  const [events] = await pool.query(`SELECT e.id AS event_id,e.title,e.status AS state,e.capacity,
    (SELECT COUNT(*) FROM participations p WHERE p.event_id=e.id AND p.status='joined') AS joined_count,
    (SELECT COUNT(*) FROM participations p WHERE p.event_id=e.id AND p.status='waitlisted') AS waitlisted_count
    FROM events e WHERE e.club_id=? AND e.status IN ('published','cancelled')
      AND e.start_time >= DATE_ADD(?,INTERVAL 8 HOUR) AND e.start_time < DATE_ADD(?,INTERVAL 8 HOUR)
    ORDER BY e.start_time,e.id`, [clubId, from, to]);
  const [history] = await pool.query(`SELECT DATE_FORMAT(DATE_ADD(h.occurred_at,INTERVAL 8 HOUR),'%Y-%m-%d') AS day,
    h.action,COUNT(*) AS count FROM participation_history h JOIN events e ON e.id=h.event_id
    WHERE e.club_id=? AND e.status IN ('published','cancelled')
      AND e.start_time >= DATE_ADD(?,INTERVAL 8 HOUR) AND e.start_time < DATE_ADD(?,INTERVAL 8 HOUR)
      AND h.occurred_at >= ? AND h.occurred_at < ? GROUP BY day,h.action`, [clubId, from, to, from, to]);
  const daily = new Map();
  for (let day = Math.floor((range.start + 8 * 3600000) / DAY); day <= Math.floor((range.end - 1 + 8 * 3600000) / DAY); day++) {
    const date = new Date(day * DAY).toISOString().slice(0, 10);
    daily.set(date, { date, ...Object.fromEntries(actions.map(action => [action, 0])) });
  }
  for (const row of history) if (daily.has(row.day) && actions.includes(row.action)) daily.get(row.day)[row.action] = Number(row.count);
  const [hours] = await pool.query(`SELECT v.id AS venue_id,v.name AS venue_name,
    ROUND(SUM(TIMESTAMPDIFF(SECOND,GREATEST(b.start_time,DATE_ADD(?,INTERVAL 8 HOUR)),
      LEAST(b.end_time,DATE_ADD(?,INTERVAL 8 HOUR))))/3600,2) AS hours
    FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.club_id=? AND b.status='confirmed'
      AND b.start_time < DATE_ADD(?,INTERVAL 8 HOUR) AND b.end_time > DATE_ADD(?,INTERVAL 8 HOUR)
    GROUP BY v.id,v.name ORDER BY v.name,v.id`, [from, to, clubId, to, from]);
  const [[cutoff]] = await pool.query("SELECT timestamp_value FROM workflow_metadata WHERE name='history_complete_from'");
  if (!cutoff) throw new Error("Participation history cutoff missing");
  return { data: { club_id: clubId, from: new Date(range.start).toISOString(), to: new Date(range.end).toISOString(),
    campus_timezone: "Asia/Hong_Kong", events, daily_actions: [...daily.values()],
    venue_hours: hours.map(row => ({ ...row, hours: Number(row.hours) })),
    history_complete_from: `${cutoff.timestamp_value.replace(" ", "T")}Z` } };
}
