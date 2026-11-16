import { from_mysql_utc } from "../../shared/slots.js";

// Reads for the live stream. `pool` must be the UTC pool (src/db/pool.js) so
// TIMESTAMP/DATETIME strings are UTC.

const COLUMNS = `id, user_id, event_id, booking_id, club_id, club_join_request_id,
  type, title, body, event_title, message, created_at, read_at`;

function iso(text) {
  if (!text) return null;
  return from_mysql_utc(String(text).includes(".") ? text : `${text}.000000`).toISOString();
}

function to_dto(row) {
  return {
    id: Number(row.id),
    type: row.type ?? "legacy",
    event_id: row.event_id ?? null,
    booking_id: row.booking_id ?? null,
    club_id: row.club_id ?? null,
    join_request_id: row.club_join_request_id ?? null,
    title: row.title ?? row.event_title,
    body: row.body ?? row.message,
    created_at: iso(row.created_at),
    read_at: iso(row.read_at),
  };
}

function create_notifications_repository(pool) {
  return {
    async max_id() {
      const [[row]] = await pool.query("SELECT COALESCE(MAX(id), 0) AS id FROM notifications");
      return Number(row.id);
    },
    async fetch_after(id, limit) {
      const [rows] = await pool.query(
        `SELECT ${COLUMNS} FROM notifications WHERE id > ? ORDER BY id ASC LIMIT ?`, [id, limit]);
      return rows.map((row) => ({ ...row, id: Number(row.id) }));
    },
    async fetch_for_user_after(user_id, id, limit) {
      const [rows] = await pool.query(
        `SELECT ${COLUMNS} FROM notifications WHERE user_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
        [user_id, id, limit]);
      return rows.map((row) => ({ ...row, id: Number(row.id) }));
    },
    async unread_count(user_id) {
      const [[row]] = await pool.query(
        "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL", [user_id]);
      return Number(row.unread);
    },
    to_dto,
  };
}

export { create_notifications_repository, to_dto };
