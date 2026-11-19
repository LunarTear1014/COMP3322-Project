import express from "express";
import { ApiError } from "../shared/errors.js";
import { PAGE_QUERY, pagination, validate_query } from "../shared/validate.js";
import { to_dto } from "../features/notifications/notifications.repository.js";
import { define_route } from "./router.js";
import { id_param, page_meta, require_user, to_db, wrap } from "./common.js";

const COLUMNS = "id, user_id, event_id, booking_id, club_id, club_join_request_id, member_removal_request_id, type, title, body, event_title, message, created_at, read_at";

// Own inbox only. Marking read is idempotent and keeps the first read_at;
// DELETE on the same path marks it unread again (MSG-01).
function create_notifications_router({ pool, clock }) {
  const router = express.Router();

  define_route(router, "/notifications", {
    get: [require_user, wrap(async (req, res) => {
      const query = validate_query(req.query, { ...PAGE_QUERY, unread_only: { kind: "bool" } });
      const { page, page_size } = pagination(query);
      const only = query.unread_only === true;
      const [[{ unread }]] = await pool.query("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL", [req.user.id]);
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?${only ? " AND read_at IS NULL" : ""}`, [req.user.id]);
      const [rows] = await pool.query(
        `SELECT ${COLUMNS} FROM notifications WHERE user_id = ?${only ? " AND read_at IS NULL" : ""} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [req.user.id, page_size, (page - 1) * page_size]);
      res.json({ data: rows.map(to_dto), meta: { ...page_meta(total, { page, page_size }), unread_count: Number(unread) } });
    })],
  });

  // Marks every unread notification the viewer owns, across all pages.
  define_route(router, "/notifications/read-all", {
    post: [require_user, wrap(async (req, res) => {
      const [result] = await pool.query("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", [to_db(clock()), req.user.id]);
      res.json({ data: { marked: Number(result.affectedRows), unread_count: 0 } });
    })],
  });

  define_route(router, "/notifications/:notification_id/read", {
    patch: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "notification_id");
      const [result] = await pool.query("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", [to_db(clock()), id, req.user.id]);
      const [rows] = await pool.query(`SELECT ${COLUMNS} FROM notifications WHERE id = ? AND user_id = ?`, [id, req.user.id]);
      if (!rows.length) throw new ApiError("NOT_FOUND", "That notification does not exist.");
      void result;
      res.json({ data: to_dto(rows[0]) });
    })],
    delete: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "notification_id");
      await pool.query("UPDATE notifications SET read_at = NULL WHERE id = ? AND user_id = ?", [id, req.user.id]);
      const [rows] = await pool.query(`SELECT ${COLUMNS} FROM notifications WHERE id = ? AND user_id = ?`, [id, req.user.id]);
      if (!rows.length) throw new ApiError("NOT_FOUND", "That notification does not exist.");
      res.json({ data: to_dto(rows[0]) });
    })],
  });

  return router;
}

export { create_notifications_router };
