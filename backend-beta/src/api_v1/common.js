import { randomUUID } from "node:crypto";
import { ApiError } from "../shared/errors.js";
import { from_mysql_utc, to_mysql_utc } from "../shared/slots.js";

// Small helpers shared by the v1 route modules.

const wrap = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// ISO UTC instant from a MySQL DATETIME string (null stays null).
function iso(value) {
  if (!value) return null;
  const text = String(value);
  return from_mysql_utc(text.includes(".") ? text : `${text}.000000`).toISOString();
}

const to_db = (date) => to_mysql_utc(date);

async function load_user(pool, user_id) {
  const [rows] = await pool.query(
    "SELECT id, name, email, student_id, platform_role FROM users WHERE id = ?", [user_id]);
  return rows[0] || null;
}

async function load_memberships(db, user_id) {
  const [rows] = await db.query(
    `SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at
     FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? ORDER BY m.club_id`, [user_id]);
  return rows.map(membership_dto);
}

const membership_dto = (row) => ({
  club_id: row.club_id, club_name: row.club_name, role: row.role, version: Number(row.version ?? 1), joined_at: iso(row.joined_at),
});

const user_dto = (row) => ({
  id: row.id, name: row.name, email: row.email, student_id: row.student_id, platform_role: row.platform_role,
});

// Resolves the signed-in user from the session on every request (privileges are
// read from the database, never from the session).
function identify(pool) {
  return wrap(async (req, _res, next) => {
    const id = req.session?.user_id;
    req.user = id ? await load_user(pool, id) : null;
    if (id && !req.user) delete req.session.user_id;
    next();
  });
}

function require_user(req, _res, next) {
  if (!req.user) return next(new ApiError("AUTHENTICATION_REQUIRED", "Sign in to continue."));
  next();
}

function require_admin(req, _res, next) {
  if (!req.user) return next(new ApiError("AUTHENTICATION_REQUIRED", "Sign in to continue."));
  if (req.user.platform_role !== "venue_admin") return next(new ApiError("FORBIDDEN", "Only venue administrators can do this."));
  next();
}

// Route parameters: strict positive integers or 404 (no oracle for bad IDs).
function id_param(req, name) {
  const value = req.params[name];
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ApiError("NOT_FOUND", "That resource does not exist.");
  }
  return Number(value);
}

function page_meta(rows_total, { page, page_size }) {
  return { page, page_size, total: Number(rows_total) };
}

async function audit(conn, { actor, entity_type, entity_id, action, details = {}, now }) {
  await conn.query(
    "INSERT INTO audit_logs (action_id, actor_user_id, entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), actor ?? null, entity_type, entity_id, action, JSON.stringify(details), to_db(now)]);
}

// Notification rows are written inside the source transaction. The legacy NOT
// NULL columns (event_title, message) are filled from title and body.
async function notify(conn, { users, type, title, body, event_id = null, booking_id = null, club_id = null, club_join_request_id = null, key, now, exclude = null }) {
  const recipients = [...new Set(users)].filter((id) => id !== exclude).slice(0, 1500);
  for (const user_id of recipients) {
    await conn.query(
      `INSERT IGNORE INTO notifications (user_id, event_id, booking_id, club_id, club_join_request_id, type, dedup_key, title, body, event_title, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user_id, event_id, booking_id, club_id, club_join_request_id, type, `${key}:${user_id}`, title, body, title.slice(0, 255), body.slice(0, 1000), to_db(now)]);
  }
  return recipients.length;
}

export { audit, id_param, identify, iso, load_memberships, load_user, membership_dto, notify, page_meta, require_admin, require_user, to_db, user_dto, wrap };
