import { randomUUID } from "node:crypto";
import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { PAGE_QUERY, pagination, validate_body, validate_query } from "../shared/validate.js";
import { define_route } from "./router.js";
import { id_param, iso, notify, page_meta, require_user, to_db, wrap } from "./common.js";
import { QUEUE_LIMIT, event_dto, event_rows, load_event, normalize_status, tags_for } from "./event_model.js";

const REGISTER = { allow_waitlist: { kind: "bool", required: true } };
const asDate = (text) => new Date(`${String(text).replace(" ", "T")}Z`);
const WAITING = ["waitlisted", "pending"];

async function history(conn, { event_id, user_id, actor, action_id, action, from, to, reason = null, now }) {
  await conn.query(
    `INSERT INTO participation_history (event_id, user_id, actor_user_id, action_id, action, from_status, to_status, reason, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [event_id, user_id, actor, action_id, action, from, to, reason, to_db(now)]);
}

// With the club and event locked: seats that are free go to the earliest
// eligible waiters (FIFO by queued_at, user_id). Ineligible waiters leave with
// a history row. Returns the promoted user ids.
async function promote_locked(conn, event, { actor, now, action_id }) {
  const promoted = [];
  const [[{ joined }]] = await conn.query("SELECT COUNT(*) AS joined FROM participations WHERE event_id = ? AND status = 'joined'", [event.id]);
  let free = Number(event.capacity) - Number(joined);
  if (free <= 0 || event.status !== "published") return promoted;
  const [waiting] = await conn.query(
    "SELECT user_id FROM participations WHERE event_id = ? AND status IN ('waitlisted', 'pending') ORDER BY queued_at ASC, user_id ASC FOR UPDATE", [event.id]);
  for (const row of waiting) {
    if (free <= 0) break;
    if (event.visibility === "members_only") {
      const [member] = await conn.query("SELECT 1 FROM memberships WHERE user_id = ? AND club_id = ?", [row.user_id, event.club_id]);
      if (!member.length) {
        await conn.query("UPDATE participations SET status = 'left', left_at = ? WHERE user_id = ? AND event_id = ?", [to_db(now), row.user_id, event.id]);
        await history(conn, { event_id: event.id, user_id: row.user_id, actor, action_id, action: "left", from: "waitlisted", to: "left", reason: "membership_ineligible", now });
        continue;
      }
    }
    await conn.query("UPDATE participations SET status = 'joined', confirmed_at = ?, left_at = NULL WHERE user_id = ? AND event_id = ?", [to_db(now), row.user_id, event.id]);
    await history(conn, { event_id: event.id, user_id: row.user_id, actor, action_id, action: "promoted", from: "waitlisted", to: "joined", now });
    promoted.push(row.user_id);
    free -= 1;
  }
  return promoted;
}

async function result_for(conn, event_id, user_id) {
  const [[mine]] = await conn.query("SELECT status, queued_at, user_id FROM participations WHERE event_id = ? AND user_id = ?", [event_id, user_id]);
  const [[{ joined_count }]] = await conn.query("SELECT COUNT(*) AS joined_count FROM participations WHERE event_id = ? AND status = 'joined'", [event_id]);
  const [[{ waitlisted_count }]] = await conn.query("SELECT COUNT(*) AS waitlisted_count FROM participations WHERE event_id = ? AND status IN ('waitlisted', 'pending')", [event_id]);
  const status = normalize_status(mine?.status ?? "left");
  let queue_position = null;
  if (status === "waitlisted") {
    const [[{ position }]] = await conn.query(
      "SELECT COUNT(*) AS position FROM participations WHERE event_id = ? AND status IN ('waitlisted', 'pending') AND (queued_at < ? OR (queued_at = ? AND user_id <= ?))", [event_id, mine.queued_at, mine.queued_at, user_id]);
    queue_position = Number(position);
  }
  return { event_id, status, queue_position, joined_count: Number(joined_count), waitlisted_count: Number(waitlisted_count) };
}

// Register, withdraw, my registrations and participants.
function create_registration_router({ pool, clock }) {
  const router = express.Router();

  define_route(router, "/events/:event_id/registration", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, REGISTER);
      const now = clock();
      const [[ref]] = await pool.query("SELECT club_id FROM events WHERE id = ?", [id]);
      if (!ref || !(await load_event(pool, req.user, id, now))) throw new ApiError("NOT_FOUND", "That event does not exist.");
      const out = await with_transaction(pool, async (conn) => {
        await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [ref.club_id]);
        const [[event]] = await conn.query("SELECT e.*, b.status AS b_status FROM events e JOIN bookings b ON b.id = e.booking_id WHERE e.id = ? FOR UPDATE", [id]);
        if (event.status === "cancelled") throw new ApiError("INVALID_STATE", "This event was cancelled.");
        if (event.status !== "published" || event.b_status !== "confirmed") throw new ApiError("INVALID_STATE", "This event isn’t open for registration.");
        const [[mine]] = await conn.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ? FOR UPDATE", [id, req.user.id]);
        const current = normalize_status(mine?.status ?? "none");
        // Repeats change nothing: no new history, jobs or queue movement.
        if (["joined", "waitlisted"].includes(current)) return { created: false, result: await result_for(conn, id, req.user.id) };
        if (asDate(event.registration_closes_at) <= now || asDate(event.start_time) <= now) throw new ApiError("REGISTRATION_CLOSED", "Registration has closed.");
        if (event.visibility === "members_only") {
          const [member] = await conn.query("SELECT 1 FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, event.club_id]);
          if (!member.length) throw new ApiError("MEMBERSHIP_REQUIRED", "Join this club to register.");
        }
        const action_id = randomUUID();
        // Earlier waiters take free seats before a newcomer can.
        const promoted = await promote_locked(conn, event, { actor: req.user.id, now, action_id });
        const [[{ joined }]] = await conn.query("SELECT COUNT(*) AS joined FROM participations WHERE event_id = ? AND status = 'joined'", [id]);
        const [[{ waiting }]] = await conn.query("SELECT COUNT(*) AS waiting FROM participations WHERE event_id = ? AND status IN ('waitlisted', 'pending')", [id]);
        let to;
        if (Number(joined) < Number(event.capacity) && Number(waiting) === 0) to = "joined";
        else if (!body.allow_waitlist) throw new ApiError("EVENT_FULL", "This event is full.");
        else if (Number(waiting) >= QUEUE_LIMIT) throw new ApiError("WAITLIST_FULL", "The waitlist is full.");
        else to = "waitlisted";
        const t = to_db(now);
        if (mine) {
          await conn.query(
            `UPDATE participations SET status = ?, last_registered_at = ?, queued_at = ?, confirmed_at = ?, left_at = NULL WHERE event_id = ? AND user_id = ?`,
            [to, t, to === "waitlisted" ? t : null, to === "joined" ? t : null, id, req.user.id]);
        } else {
          await conn.query(
            `INSERT INTO participations (user_id, event_id, status, last_registered_at, queued_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.id, id, to, t, to === "waitlisted" ? t : null, to === "joined" ? t : null]);
        }
        await history(conn, { event_id: id, user_id: req.user.id, actor: req.user.id, action_id, action: to, from: mine ? (current === "none" ? null : current) : null, to, now });
        await notify(conn, { users: [req.user.id], type: "registration_changed", event_id: id, club_id: event.club_id, now, key: `registration:${action_id}`, title: to === "joined" ? `You’re going to ${event.title}` : `You’re on the waitlist for ${event.title}`, body: to === "joined" ? "Your seat is confirmed." : "We’ll tell you if a seat opens." });
        for (const user_id of promoted) {
          await notify(conn, { users: [user_id], type: "registration_changed", event_id: id, club_id: event.club_id, now, key: `registration:${action_id}`, title: `You got a seat: ${event.title}`, body: "A place opened up and you moved off the waitlist." });
        }
        return { created: true, result: await result_for(conn, id, req.user.id) };
      });
      res.status(out.created ? 201 : 200).json({ data: out.result });
    })],

    delete: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const now = clock();
      const [[ref]] = await pool.query("SELECT club_id FROM events WHERE id = ?", [id]);
      if (!ref) throw new ApiError("NOT_FOUND", "That event does not exist.");
      const result = await with_transaction(pool, async (conn) => {
        await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [ref.club_id]);
        const [[event]] = await conn.query("SELECT * FROM events WHERE id = ? FOR UPDATE", [id]);
        const [[mine]] = await conn.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ? FOR UPDATE", [id, req.user.id]);
        const current = normalize_status(mine?.status ?? "none");
        if (!mine) throw new ApiError("NOT_FOUND", "That event does not exist.");
        if (event.status === "cancelled" || !["joined", "waitlisted"].includes(current)) return result_for(conn, id, req.user.id);
        if (asDate(event.start_time) <= now) throw new ApiError("EVENT_STARTED", "This event has already started.");
        const action_id = randomUUID();
        await conn.query("UPDATE participations SET status = 'left', left_at = ? WHERE event_id = ? AND user_id = ?", [to_db(now), id, req.user.id]);
        await history(conn, { event_id: id, user_id: req.user.id, actor: req.user.id, action_id, action: "left", from: current, to: "left", now });
        await notify(conn, { users: [req.user.id], type: "registration_changed", event_id: id, club_id: event.club_id, now, key: `registration:${action_id}`, title: `You left ${event.title}`, body: "Your registration was withdrawn." });
        // A joined withdrawal before the deadline promotes; after it the seat stays free.
        if (current === "joined" && asDate(event.registration_closes_at) > now) {
          const promoted = await promote_locked(conn, event, { actor: req.user.id, now, action_id });
          for (const user_id of promoted) {
            await notify(conn, { users: [user_id], type: "registration_changed", event_id: id, club_id: event.club_id, now, key: `registration:${action_id}`, title: `You got a seat: ${event.title}`, body: "A place opened up and you moved off the waitlist." });
          }
        }
        return result_for(conn, id, req.user.id);
      });
      res.json({ data: result });
    })],
  });

  define_route(router, "/me/registrations", {
    get: [require_user, wrap(async (req, res) => {
      const query = validate_query(req.query, { ...PAGE_QUERY, status: { kind: "enum", values: ["joined", "waitlisted", "left", "cancelled"] } });
      const { page, page_size } = pagination(query);
      const now = clock();
      const wanted = { joined: ["joined"], waitlisted: WAITING, left: ["left", "unsuccessful"], cancelled: ["cancelled"] }[query.status] ?? null;
      const where = "mine.user_id = ?" + (wanted ? " AND mine.status IN (?)" : "");
      const params = wanted ? [req.user.id, wanted] : [req.user.id];
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM participations mine WHERE ${where}`, params);
      const rows = await event_rows(pool, { viewer_id: req.user.id, where: `e.id IN (SELECT event_id FROM participations mine WHERE ${where})`, params, order: "e.start_time DESC, e.id DESC", limit: page_size, offset: (page - 1) * page_size });
      const tag_map = await tags_for(pool, rows.map((row) => row.id));
      const [times] = await pool.query("SELECT event_id, last_registered_at, confirmed_at, left_at FROM participations WHERE user_id = ? AND event_id IN (?)", [req.user.id, rows.map((row) => row.id).concat(0)]);
      const by = new Map(times.map((row) => [row.event_id, row]));
      res.json({ data: rows.map((row) => {
        const dto = event_dto(row, tag_map.get(row.id), now, { detail: false });
        const t = by.get(row.id);
        return { event: dto, status: dto.my_registration.status, queue_position: dto.my_registration.queue_position, last_registered_at: iso(t?.last_registered_at), confirmed_at: iso(t?.confirmed_at), left_at: iso(t?.left_at) };
      }), meta: page_meta(total, { page, page_size }) });
    })],
  });

  define_route(router, "/events/:event_id/participants", {
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const query = validate_query(req.query, { ...PAGE_QUERY, status: { kind: "enum", values: ["joined", "waitlisted", "left", "cancelled"] } });
      const { page, page_size } = pagination(query);
      const found = await load_event(pool, req.user, id, clock());
      if (!found) throw new ApiError("NOT_FOUND", "That event does not exist.");
      const [[role]] = await pool.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, found.row.club_id]);
      if (!role || !["committee", "president"].includes(role.role)) throw new ApiError("FORBIDDEN", "Only the club committee can see participants.");
      const wanted = { joined: ["joined"], waitlisted: WAITING, left: ["left", "unsuccessful"], cancelled: ["cancelled"] }[query.status ?? "joined"];
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM participations WHERE event_id = ? AND status IN (?)", [id, wanted]);
      const [rows] = await pool.query(
        `SELECT p.*, u.name, u.email, u.student_id,
           (SELECT COUNT(*) FROM participations q WHERE q.event_id = p.event_id AND q.status IN ('waitlisted', 'pending')
              AND (q.queued_at < p.queued_at OR (q.queued_at = p.queued_at AND q.user_id <= p.user_id))) AS position
         FROM participations p JOIN users u ON u.id = p.user_id WHERE p.event_id = ? AND p.status IN (?)
         ORDER BY p.last_registered_at, p.user_id LIMIT ? OFFSET ?`, [id, wanted, page_size, (page - 1) * page_size]);
      res.json({ data: rows.map((row) => ({
        user: { id: row.user_id, name: row.name, email: row.email, student_id: row.student_id },
        status: normalize_status(row.status), queue_position: WAITING.includes(row.status) ? Number(row.position) : null,
        last_registered_at: iso(row.last_registered_at), confirmed_at: iso(row.confirmed_at), left_at: iso(row.left_at),
      })), meta: page_meta(total, { page, page_size }) });
    })],
  });

  return router;
}

export { create_registration_router, promote_locked };
