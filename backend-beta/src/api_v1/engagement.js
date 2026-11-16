import { randomInt } from "node:crypto";
import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError, validation_error } from "../shared/errors.js";
import { PAGE_QUERY, pagination, validate_body, validate_query } from "../shared/validate.js";
import { create_throttle } from "../features/users/password_hasher.js";
import { define_route } from "./router.js";
import { signal, id_param, iso, notify, page_meta, require_user, to_db, wrap } from "./common.js";
import { committee_of, is_committee } from "./clubs.js";
import { build_report, parse_range } from "./effectiveness.js";
import { load_event } from "./event_model.js";

const asDate = (text) => new Date(`${String(text).replace(" ", "T")}Z`);
const SOURCES = ["explore", "club", "inbox", "my_events", "share", "other"];
const BEFORE_MS = 30 * 60_000;
const AFTER_MS = 2 * 3_600_000;
const BUCKET_MS = 30 * 60_000;

const window_of = (event) => ({ opens: new Date(asDate(event.start_time).getTime() - BEFORE_MS), closes: new Date(asDate(event.end_time).getTime() + AFTER_MS) });

const attendance_dto = (row) => ({ event_id: row.event_id, user_id: row.user_id, method: row.method, checked_in_at: iso(row.checked_in_at), marked_by: row.marked_by ?? null });

async function managed_event(pool, user, id, clock) {
  const found = await load_event(pool, user, id, clock());
  if (!found) throw new ApiError("NOT_FOUND", "That event does not exist.");
  const mine = await committee_of(pool, user.id, found.row.club_id);
  if (!is_committee(mine)) throw new ApiError("FORBIDDEN", "Only the club committee can do this.");
  return found.row;
}

// Check-in, attendance, view tracking and the effectiveness report.
function create_engagement_router({ pool, clock }) {
  const router = express.Router();
  const attempts = create_throttle({ limit: 5, window_ms: 10 * 60_000, now: () => clock().getTime() });

  define_route(router, "/events/:event_id/checkin", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      validate_body(req.body, {});
      await managed_event(pool, req.user, id, clock);
      const result = await with_transaction(pool, async (conn) => {
        const [[event]] = await conn.query("SELECT * FROM events WHERE id = ? FOR UPDATE", [id]);
        const now = clock();
        const { opens, closes } = window_of(event);
        if (event.status !== "published") throw new ApiError("INVALID_STATE", "Only published events have check-in.");
        if (now < opens || now > closes) throw new ApiError("INVALID_STATE", "Check-in opens 30 minutes before the start and closes 2 hours after the end.");
        if (!event.checkin_code) {
          const code = String(randomInt(0, 10_000)).padStart(4, "0");
          await conn.query("UPDATE events SET checkin_code = ?, checkin_opened_at = COALESCE(checkin_opened_at, ?) WHERE id = ?", [code, to_db(now), id]);
          event.checkin_code = code;
          const [joined] = await conn.query("SELECT user_id FROM participations WHERE event_id = ? AND status = 'joined'", [id]);
          await signal(conn, { topic: "attendance", event_id: id, club_id: event.club_id, public: false, now });
          await notify(conn, { users: joined.map((row) => row.user_id), type: "checkin_opened", event_id: id, club_id: event.club_id, now, exclude: req.user.id, key: `checkin_opened:${id}`, title: `Check-in is open: ${event.title}`, body: "Enter the code shown by the organizers." });
        }
        return { code: event.checkin_code, opens_at: opens.toISOString(), closes_at: closes.toISOString() };
      });
      res.json({ data: result });
    })],
  });

  define_route(router, "/events/:event_id/attendance", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, { code: { kind: "string", min: 4, max: 4, required: true, pattern: /^\d{4}$/ } });
      const key = `${req.user.id}:${id}`;
      const found = await load_event(pool, req.user, id, clock());
      if (!found) throw new ApiError("NOT_FOUND", "That event does not exist.");
      const [[event]] = await pool.query("SELECT * FROM events WHERE id = ?", [id]);
      const now = clock();
      const { opens, closes } = window_of(event);
      const [[mine]] = await pool.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ?", [id, req.user.id]);
      if (mine?.status !== "joined") throw new ApiError("FORBIDDEN", "Only people who joined can check in.");
      const [[existing]] = await pool.query("SELECT * FROM event_attendance WHERE event_id = ? AND user_id = ?", [id, req.user.id]);
      if (existing) return res.json({ data: attendance_dto(existing) });
      if (now < opens || now > closes || !event.checkin_code) throw new ApiError("INVALID_STATE", "Check-in isn’t open for this event.");
      attempts.hit(key); // 5 attempts per user and event per 10 minutes
      if (body.code !== event.checkin_code) throw validation_error({ code: "That code doesn’t match. Ask the organizers." });
      attempts.reset(key);
      await pool.query("INSERT IGNORE INTO event_attendance (event_id, user_id, method, checked_in_at) VALUES (?, ?, 'code', ?)", [id, req.user.id, to_db(now)]);
      await signal(pool, { topic: "attendance", event_id: id, club_id: event.club_id, public: false, now });
      const [[row]] = await pool.query("SELECT * FROM event_attendance WHERE event_id = ? AND user_id = ?", [id, req.user.id]);
      res.status(201).json({ data: attendance_dto(row) });
    })],
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      await managed_event(pool, req.user, id, clock);
      const [[{ joined }]] = await pool.query("SELECT COUNT(*) AS joined FROM participations WHERE event_id = ? AND status = 'joined'", [id]);
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM event_attendance WHERE event_id = ?", [id]);
      const [rows] = await pool.query(
        `SELECT a.*, u.name FROM event_attendance a JOIN users u ON u.id = a.user_id WHERE a.event_id = ? ORDER BY a.checked_in_at, a.user_id LIMIT ? OFFSET ?`,
        [id, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: { joined_at_open: Number(joined), attended: Number(total), records: rows.map((row) => ({ ...attendance_dto(row), user: { id: row.user_id, name: row.name } })) }, meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/events/:event_id/attendance/:user_id", {
    put: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const user_id = id_param(req, "user_id");
      validate_body(req.body, {});
      const event = await managed_event(pool, req.user, id, clock);
      const [[mine]] = await pool.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ?", [id, user_id]);
      if (mine?.status !== "joined") throw new ApiError("INVALID_STATE", "Only people who joined can be marked present.");
      await pool.query(
        "INSERT INTO event_attendance (event_id, user_id, method, checked_in_at, marked_by) VALUES (?, ?, 'marked', ?, ?) ON DUPLICATE KEY UPDATE event_id = event_id",
        [id, user_id, to_db(clock()), req.user.id]);
      await signal(pool, { topic: "attendance", event_id: id, club_id: event.club_id, public: false, now: clock() });
      const [[row]] = await pool.query("SELECT * FROM event_attendance WHERE event_id = ? AND user_id = ?", [id, user_id]);
      res.json({ data: attendance_dto(row) });
    })],
    delete: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const user_id = id_param(req, "user_id");
      const event = await managed_event(pool, req.user, id, clock);
      await pool.query("DELETE FROM event_attendance WHERE event_id = ? AND user_id = ?", [id, user_id]);
      await signal(pool, { topic: "attendance", event_id: id, club_id: event.club_id, public: false, now: clock() });
      res.status(204).end();
    })],
  });

  define_route(router, "/events/:event_id/views", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, { source: { kind: "enum", values: SOURCES, required: true } });
      const now = clock();
      if (!(await load_event(pool, req.user, id, now))) throw new ApiError("NOT_FOUND", "That event does not exist.");
      const bucket = new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);
      // The unique key (event, user, 30-minute bucket) deduplicates silently.
      await pool.query("INSERT IGNORE INTO event_views (event_id, user_id, source, viewed_at, bucket) VALUES (?, ?, ?, ?, ?)", [id, req.user.id, body.source, to_db(now), to_db(bucket)]);
      res.status(204).end();
    })],
  });

  define_route(router, "/clubs/:club_id/reports/effectiveness", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const range = parse_range(req.query);
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", "Only the committee can view reports.");
      res.json({ data: await build_report(pool, { club_id, ...range }) });
    })],
  });

  return router;
}

export { create_engagement_router };
