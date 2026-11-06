import pool from "../../config/db.js";

const localInstant = value => value ? new Date(`${value.replace(" ", "T")}+08:00`).toISOString() : null;
const utcInstant = value => value ? new Date(`${value.replace(" ", "T")}Z`).toISOString() : null;

const select = `SELECT e.id,e.title,e.description,e.status,e.version,e.visibility,e.capacity,
  DATE_FORMAT(e.start_time,'%Y-%m-%d %H:%i:%s') AS start_local,
  DATE_FORMAT(e.end_time,'%Y-%m-%d %H:%i:%s') AS end_local,
  DATE_FORMAT(COALESCE(e.registration_closes_at,e.start_time),'%Y-%m-%d %H:%i:%s') AS deadline_local,
  e.start_time <= DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 8 HOUR) AS started,
  COALESCE(e.registration_closes_at,e.start_time) > DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 8 HOUR) AS registration_open,
  c.id AS club_id,c.name AS club_name,v.id AS venue_id,v.name AS venue_name,v.capacity AS venue_capacity,
  b.id AS booking_id,b.status AS booking_status,b.version AS booking_version,b.decision_reason,
  DATE_FORMAT(b.decided_at,'%Y-%m-%d %H:%i:%s.%f') AS decided_utc,
  (SELECT COUNT(*) FROM participations p WHERE p.event_id=e.id AND p.status='joined') AS joined_count,
  (SELECT COUNT(*) FROM participations p WHERE p.event_id=e.id AND p.status='waitlisted') AS waitlisted_count,
  mine.status AS own_status,
  UNIX_TIMESTAMP(COALESCE(mine.last_registered_at,mine.joined_at)) AS own_joined_epoch,
  UNIX_TIMESTAMP(mine.confirmed_at) AS own_confirmed_epoch,UNIX_TIMESTAMP(mine.left_at) AS own_left_epoch,
  CASE WHEN mine.status='waitlisted' THEN 1 + (SELECT COUNT(*) FROM participations q
    WHERE q.event_id=e.id AND q.status='waitlisted' AND (COALESCE(q.queued_at,q.joined_at)<COALESCE(mine.queued_at,mine.joined_at)
      OR (COALESCE(q.queued_at,q.joined_at)=COALESCE(mine.queued_at,mine.joined_at) AND q.user_id<mine.user_id))) ELSE NULL END AS queue_position,
  COALESCE(manager.role IN ('committee','president'),0) AS is_manager,
  manager.user_id IS NOT NULL AS is_member,
  EXISTS(SELECT 1 FROM event_join_requests r WHERE r.event_id=e.id AND r.user_id=manager.user_id AND r.status='pending') AS request_pending,
  EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND actor.platform_role='venue_admin') AS is_admin
  FROM events e JOIN clubs c ON c.id=e.club_id JOIN bookings b ON b.id=e.booking_id
  JOIN venues v ON v.id=b.venue_id LEFT JOIN memberships manager ON manager.club_id=e.club_id AND manager.user_id=?
  LEFT JOIN participations mine ON mine.event_id=e.id AND mine.user_id=?`;

function present(row) {
  const joined = Number(row.joined_count), waiting = Number(row.waitlisted_count);
  const own = row.request_pending ? "pending" : row.own_status || "none";
  const manager = Boolean(row.is_manager), admin = Boolean(row.is_admin);
  const reason = row.status === "cancelled" ? "EVENT_CANCELLED" : row.status !== "published" || row.booking_status !== "confirmed" ? "NOT_PUBLISHED" :
    row.started || !row.registration_open ? "REGISTRATION_CLOSED" : row.visibility === "members_only" && !row.is_member ? "MEMBERSHIP_REQUIRED" :
      ["joined", "waitlisted", "pending"].includes(own) ? "ALREADY_REGISTERED" : joined >= row.capacity ? (waiting >= 500 ? "WAITLIST_FULL" : "EVENT_FULL") : null;
  const booking = { id: row.booking_id, status: row.booking_status, version: row.booking_version,
    expired: row.booking_status === "pending" && Boolean(row.started) };
  if (manager || admin) Object.assign(booking, { decision_reason: row.decision_reason, decided_at: utcInstant(row.decided_utc) });
  return { id: row.id, club: { id: row.club_id, name: row.club_name }, venue: { id: row.venue_id, name: row.venue_name, capacity: row.venue_capacity },
    title: row.title, description: row.description, start_at: localInstant(row.start_local), end_at: localInstant(row.end_local),
    registration_closes_at: localInstant(row.deadline_local), visibility: row.visibility, state: row.status,
    phase: row.started ? "past" : "upcoming", version: row.version, capacity: row.capacity, joined_count: joined, waitlisted_count: waiting,
    my_registration: { status: own, queue_position: row.queue_position == null ? null : Number(row.queue_position) },
    eligibility: { can_register: reason === null, can_waitlist: reason === "EVENT_FULL", reason }, booking,
    can_manage: manager, can_cancel: manager || admin };
}

export async function getEvent(userId, eventId) {
  const [[row]] = await pool.query(`${select} WHERE e.id=?`, [userId, userId, userId, eventId]);
  if (!row || (row.status !== "published" && !row.is_manager && !row.is_admin && !row.own_status)) return null;
  return present(row);
}

export async function queryEvents(userId, { managed = false, page, pageSize, clubId, venueId, visibility, phase, state, from, to, search }) {
  if (managed && clubId) {
    const [[member]] = await pool.query("SELECT role FROM memberships WHERE club_id=? AND user_id=?", [clubId, userId]);
    if (!["committee", "president"].includes(member?.role)) return { forbidden: true };
  }
  const where = [managed ? "manager.role IN ('committee','president')" : "e.status='published'"];
  const args = [];
  if (clubId) { where.push("e.club_id=?"); args.push(clubId); }
  if (venueId) { where.push("b.venue_id=?"); args.push(venueId); }
  if (visibility) { where.push("e.visibility=?"); args.push(visibility); }
  if (state) { where.push("e.status=?"); args.push(state); }
  if (phase) where.push(`e.start_time ${phase === "past" ? "<=" : ">"} DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 8 HOUR)`);
  if (from) { where.push("e.start_time >= DATE_ADD(?,INTERVAL 8 HOUR)"); args.push(from); }
  if (to) { where.push("e.start_time < DATE_ADD(?,INTERVAL 8 HOUR)"); args.push(to); }
  if (search) { where.push("LOCATE(?,LOWER(CONCAT_WS(' ',e.title,e.description,c.name,v.name)))>0"); args.push(search.toLowerCase()); }
  const clause = where.join(" AND ");
  const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM events e JOIN clubs c ON c.id=e.club_id
    JOIN bookings b ON b.id=e.booking_id JOIN venues v ON v.id=b.venue_id
    LEFT JOIN memberships manager ON manager.club_id=e.club_id AND manager.user_id=? WHERE ${clause}`, [userId, ...args]);
  const [rows] = await pool.query(`${select} WHERE ${clause} ORDER BY e.start_time,e.id LIMIT ? OFFSET ?`,
    [userId, userId, userId, ...args, pageSize, (page - 1) * pageSize]);
  return { data: rows.map(present), meta: { page, page_size: pageSize, total: Number(count.total) } };
}

export async function queryMyRegistrations(userId, { page, pageSize, status }) {
  const predicate = status === 'pending' ? "requests.status='pending'" : status ? "mine.status=? AND COALESCE(requests.status,'')<>'pending'" : "(mine.user_id IS NOT NULL OR requests.status='pending')";
  const filter = status && status !== 'pending' ? [status] : [];
  const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM events e
    LEFT JOIN participations mine ON mine.event_id=e.id AND mine.user_id=?
    LEFT JOIN event_join_requests requests ON requests.event_id=e.id AND requests.user_id=? WHERE ${predicate}`, [userId,userId,...filter]);
  const [rows] = await pool.query(`${select} LEFT JOIN event_join_requests requests ON requests.event_id=e.id AND requests.user_id=? WHERE ${predicate} ORDER BY e.start_time DESC,e.id DESC LIMIT ? OFFSET ?`,
    [userId,userId,userId,userId,...filter,pageSize,(page-1)*pageSize]);
  return { data:rows.map(row => ({ event:present(row), status:row.request_pending ? 'pending' : row.own_status,
    queue_position:row.queue_position == null ? null : Number(row.queue_position),
    last_registered_at:row.own_joined_epoch == null ? null : new Date(Number(row.own_joined_epoch)*1000).toISOString(),
    confirmed_at:row.own_confirmed_epoch == null ? null : new Date(Number(row.own_confirmed_epoch)*1000).toISOString(),
    left_at:row.own_left_epoch == null ? null : new Date(Number(row.own_left_epoch)*1000).toISOString() })),
    meta:{page,page_size:pageSize,total:Number(count.total)} };
}

export async function queryParticipants(eventId, { page, pageSize, status }) {
  const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM participations WHERE event_id=? AND status=?",[eventId,status]);
  const [rows] = await pool.query(`SELECT p.user_id,p.status,u.name,u.email,u.student_id,
    UNIX_TIMESTAMP(COALESCE(p.last_registered_at,p.joined_at)) AS joined_epoch,
    UNIX_TIMESTAMP(p.confirmed_at) AS confirmed_epoch,UNIX_TIMESTAMP(p.left_at) AS left_epoch,
    CASE WHEN p.status='waitlisted' THEN 1+(SELECT COUNT(*) FROM participations q WHERE q.event_id=p.event_id AND q.status='waitlisted'
      AND (COALESCE(q.queued_at,q.joined_at)<COALESCE(p.queued_at,p.joined_at)
        OR (COALESCE(q.queued_at,q.joined_at)=COALESCE(p.queued_at,p.joined_at) AND q.user_id<p.user_id))) ELSE NULL END AS queue_position
    FROM participations p JOIN users u ON u.id=p.user_id WHERE p.event_id=? AND p.status=?
    ORDER BY COALESCE(p.last_registered_at,p.joined_at),p.user_id LIMIT ? OFFSET ?`,[eventId,status,pageSize,(page-1)*pageSize]);
  return {data:rows.map(row=>({user:{id:row.user_id,name:row.name,email:row.email,student_id:row.student_id},status:row.status,
    queue_position:row.queue_position == null ? null : Number(row.queue_position),
    last_registered_at:row.joined_epoch == null ? null : new Date(Number(row.joined_epoch)*1000).toISOString(),
    confirmed_at:row.confirmed_epoch == null ? null : new Date(Number(row.confirmed_epoch)*1000).toISOString(),
    left_at:row.left_epoch == null ? null : new Date(Number(row.left_epoch)*1000).toISOString()})),
    meta:{page,page_size:pageSize,total:Number(count.total)}};
}
