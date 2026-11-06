import { Router } from "express";
import pool from "../../config/db.js";

const router = Router();
const error = (req, res, status, code, message, fields = {}) =>
  res.status(status).json({ error: { code, message, fields, request_id: req.id } });
const isId = value => typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const toInstant = value => value == null ? null : new Date(Number(value) * 1000).toISOString();
const present = row => ({ id: row.id, type: row.type, event_id: row.event_id, booking_id: row.booking_id,
  title: row.event_title, body: row.message, created_at: toInstant(row.created_epoch), read_at: toInstant(row.read_epoch) });
const columns = "id,type,event_id,booking_id,event_title,message,UNIX_TIMESTAMP(created_at) AS created_epoch,UNIX_TIMESTAMP(read_at) AS read_epoch";

router.get("/notifications", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to view notifications.");
  const { page = "1", page_size = "20", unread_only = "false" } = req.query;
  if (Object.keys(req.query).some(key => !["page", "page_size", "unread_only"].includes(key)) ||
      !isId(page) || !isId(page_size) || Number(page_size) > 100 || !["true", "false"].includes(unread_only) ||
      !Number.isSafeInteger((Number(page) - 1) * Number(page_size))) {
    return error(req, res, 422, "VALIDATION_FAILED", "Invalid notification filters.");
  }
  try {
    const unread = unread_only === "true";
    const userId = req.session.user_id;
    const [[counts]] = await pool.query(`SELECT COUNT(*) AS all_count,
      COALESCE(SUM(read_at IS NULL),0) AS unread_count FROM notifications WHERE user_id=?`, [userId]);
    const [rows] = await pool.query(`SELECT ${columns} FROM notifications WHERE user_id=?
      ${unread ? "AND read_at IS NULL" : ""} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    [userId, Number(page_size), (Number(page) - 1) * Number(page_size)]);
    return res.json({ data: rows.map(present), meta: { page: Number(page), page_size: Number(page_size),
      total: Number(unread ? counts.unread_count : counts.all_count), unread_count: Number(counts.unread_count) } });
  } catch {
    return error(req, res, 503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable.");
  }
});

router.patch("/notifications/:id/read", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to update notifications.");
  if (!isId(req.params.id) || !req.body || Array.isArray(req.body) || typeof req.body !== "object" || Object.keys(req.body).length) {
    return error(req, res, 422, "VALIDATION_FAILED", "Provide a valid notification ID and an empty object.");
  }
  try {
    await pool.query("UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=? AND user_id=?", [req.params.id, req.session.user_id]);
    const [[row]] = await pool.query(`SELECT ${columns} FROM notifications WHERE id=? AND user_id=?`, [req.params.id, req.session.user_id]);
    if (!row) return error(req, res, 404, "NOT_FOUND", "Notification not found.");
    return res.json({ data: present(row) });
  } catch {
    return error(req, res, 503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable.");
  }
});

router.all("/notifications", (req, res) => {
  res.setHeader("Allow", "GET, HEAD");
  return error(req, res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
});
router.all("/notifications/:id/read", (req, res) => {
  res.setHeader("Allow", "PATCH");
  return error(req, res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
});

export default router;
