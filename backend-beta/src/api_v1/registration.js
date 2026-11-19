import { randomUUID } from "node:crypto";
import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { PAGE_QUERY, pagination, validate_body, validate_query } from "../shared/validate.js";
import { define_route } from "./router.js";
import { id_param, iso, notify, page_meta, require_user, signal, to_db, wrap } from "./common.js";
import { enqueue } from "../jobs/queue.js";
import { QUEUE_LIMIT, event_dto, event_rows, load_event, needs_approval, normalize_status, tags_for } from "./event_model.js";

const REGISTER = { allow_waitlist: { kind: "bool", required: true } };
const DECISION = { decision: { kind: "enum", values: ["accept", "reject"], required: true }, reason: { kind: "string", min: 1, max: 500 } };
const asDate = (text) => new Date(`${String(text).replace(" ", "T")}Z`);
const WAITING = ["waitlisted", "pending"];
const DAY_MS = 86_400_000;

// A student who becomes joined inside the 24 hour window gets their own reminder job (shared visible key).
async function late_reminder(conn, event, user_id, now) {
  const start = asDate(event.start_time);
  if (start > now && start - now <= DAY_MS) {
    await enqueue(conn, { action_key: `reminder-user:${event.id}:${user_id}`, type: "event_reminder", event_id: event.id, payload: { event_id: event.id, user_id }, now });
  }
}

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
    await late_reminder(conn, event, row.user_id, now);
    free -= 1;
  }
  return promoted;
}

async function result_for(conn, event_id, user_id) {
  const [[mine]] = await conn.query("SELECT status, queued_at, user_id FROM participations WHERE event_id = ? AND user_id = ?", [event_id, user_id]);
  const [[{ joined_count }]] = await conn.query("SELECT COUNT(*) AS joined_count FROM participations WHERE event_id = ? AND status = 'joined'", [event_id]);
  const [[{ waitlisted_count }]] = await conn.query("SELECT COUNT(*) AS waitlisted_count FROM participations WHERE event_id = ? AND status IN ('waitlisted', 'pending')", [event_id]);
  let status = normalize_status(mine?.status ?? "left");
  if (!["joined", "waitlisted"].includes(status)) {
    const [[request]] = await conn.query("SELECT status FROM event_join_requests WHERE event_id = ? AND user_id = ?", [event_id, user_id]);
    if (request?.status === "pending") status = "requested";
  }
  let queue_position = null;
  if (status === "waitlisted") {
    const [[{ position }]] = await conn.query(
      "SELECT COUNT(*) AS position FROM participations WHERE event_id = ? AND status IN ('waitlisted', 'pending') AND (queued_at < ? OR (queued_at = ? AND user_id <= ?))", [event_id, mine.queued_at, mine.queued_at, user_id]);
    queue_position = Number(position);
  }
  return { event_id, status, queue_position, joined_count: Number(joined_count), waitlisted_count: Number(waitlisted_count) };
}

// With the club and event locked: earlier waiters take free seats first, then
// the student joins, queues, or is refused. Writes the participation row,
// history, late reminder and promotion notices. Returns { to, promoted }.
async function allocate(conn, event, { user_id, actor, allow_waitlist, mine, current, now, action_id }) {
  const promoted = await promote_locked(conn, event, { actor, now, action_id });
  const [[{ joined }]] = await conn.query("SELECT COUNT(*) AS joined FROM participations WHERE event_id = ? AND status = 'joined'", [event.id]);
  const [[{ waiting }]] = await conn.query("SELECT COUNT(*) AS waiting FROM participations WHERE event_id = ? AND status IN ('waitlisted', 'pending')", [event.id]);
  let to;
  if (Number(joined) < Number(event.capacity) && Number(waiting) === 0) to = "joined";
  else if (!allow_waitlist) throw new ApiError("EVENT_FULL", "This event is full.");
  else if (Number(waiting) >= QUEUE_LIMIT) throw new ApiError("WAITLIST_FULL", "The waitlist is full.");
  else to = "waitlisted";
  const t = to_db(now);
  if (mine) {
    await conn.query(
      `UPDATE participations SET status = ?, last_registered_at = ?, queued_at = ?, confirmed_at = ?, left_at = NULL WHERE event_id = ? AND user_id = ?`,
      [to, t, to === "waitlisted" ? t : null, to === "joined" ? t : null, event.id, user_id]);
  } else {
    await conn.query(
      `INSERT INTO participations (user_id, event_id, status, last_registered_at, queued_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, event.id, to, t, to === "waitlisted" ? t : null, to === "joined" ? t : null]);
  }
  if (to === "joined") await late_reminder(conn, event, user_id, now);
  await history(conn, { event_id: event.id, user_id, actor, action_id, action: to, from: mine ? (current === "none" ? null : current) : null, to, now });
  for (const promoted_id of promoted) {
    await notify(conn, { users: [promoted_id], type: "registration_changed", event_id: event.id, club_id: event.club_id, now, key: `registration:${action_id}`, title: `You got a seat: ${event.title}`, body: "A place opened up and you moved off the waitlist." });
  }
  return { to, promoted };
}

// Register, withdraw, my registrations and participants.
function create_registration_router({ pool, clock }) {
  const router = express.Router();

  define_route(router, "/events/:event_id/registration", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, REGISTER);
      if (req.user.platform_role === "venue_admin") throw new ApiError("FORBIDDEN", "Venue administrators manage events and can't register for them.");
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
        if (["joined", "waitlisted"].includes(current)) return { code: 200, result: await result_for(conn, id, req.user.id) };
        if (asDate(event.registration_closes_at) <= now || asDate(event.start_time) <= now) throw new ApiError("REGISTRATION_CLOSED", "Registration has closed.");
        const [[membership]] = await conn.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, event.club_id]);
        const member_role = membership?.role ?? null;
        if (event.visibility === "members_only" && !member_role) throw new ApiError("MEMBERSHIP_REQUIRED", "Join this club to register.");
        if (needs_approval(event.visibility, member_role)) {
          // Plain members ask the committee; nothing is allocated yet.
          const [[request]] = await conn.query("SELECT status FROM event_join_requests WHERE event_id = ? AND user_id = ? FOR UPDATE", [id, req.user.id]);
          if (request?.status === "pending") return { code: 200, result: await result_for(conn, id, req.user.id) };
          await conn.query(
            `INSERT INTO event_join_requests (event_id, user_id, status, allow_waitlist, requested_at) VALUES (?, ?, 'pending', ?, ?)
             ON DUPLICATE KEY UPDATE status = 'pending', allow_waitlist = VALUES(allow_waitlist), requested_at = VALUES(requested_at),
               reviewed_by = NULL, reviewed_at = NULL, reason = NULL`, [id, req.user.id, body.allow_waitlist, to_db(now)]);
          const [committee] = await conn.query("SELECT user_id FROM memberships WHERE club_id = ? AND role IN ('committee', 'president')", [event.club_id]);
          await notify(conn, { users: committee.map((row) => row.user_id), type: "event_join_request", event_id: id, club_id: event.club_id, now,
            key: `event-request:${id}:${req.user.id}:${to_db(now)}`, exclude: req.user.id,
            title: `${req.user.name} asked to join ${event.title}`, body: "Members-only event. Accept or reject the request." });
          await notify(conn, { users: [req.user.id], type: "registration_changed", event_id: id, club_id: event.club_id, now,
            key: `event-request-sent:${id}:${req.user.id}:${to_db(now)}`, title: `Request sent: ${event.title}`, body: "The committee will accept or reject it." });
          await signal(conn, { event_id: id, club_id: event.club_id, public: false, now });
          return { code: 202, result: await result_for(conn, id, req.user.id) };
        }
        const action_id = randomUUID();
        const { to } = await allocate(conn, event, { user_id: req.user.id, actor: req.user.id, allow_waitlist: body.allow_waitlist, mine, current, now, action_id });
        await notify(conn, { users: [req.user.id], type: "registration_changed", event_id: id, club_id: event.club_id, now, key: `registration:${action_id}`, title: to === "joined" ? `You’re going to ${event.title}` : `You’re on the waitlist for ${event.title}`, body: to === "joined" ? "Your seat is confirmed." : "We’ll tell you if a seat opens." });
        await signal(conn, { event_id: id, club_id: event.club_id, now });
        return { code: 201, result: await result_for(conn, id, req.user.id) };
      });
      res.status(out.code).json({ data: out.result });
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
        if (!["joined", "waitlisted"].includes(current)) {
          const [withdrawn] = await conn.query("UPDATE event_join_requests SET status = 'withdrawn' WHERE event_id = ? AND user_id = ? AND status = 'pending'", [id, req.user.id]);
          if (withdrawn.affectedRows) {
            await signal(conn, { event_id: id, club_id: event.club_id, public: false, now });
            return result_for(conn, id, req.user.id);
          }
        }
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
        await signal(conn, { event_id: id, club_id: event.club_id, now });
        return result_for(conn, id, req.user.id);
      });
      res.json({ data: result });
    })],
  });

  define_route(router, "/me/registrations", {
    get: [require_user, wrap(async (req, res) => {
      const query = validate_query(req.query, { ...PAGE_QUERY, status: { kind: "enum", values: ["requested", "joined", "waitlisted", "left", "cancelled"] } });
      const { page, page_size } = pagination(query);
      const now = clock();
      const wanted = { joined: ["joined"], waitlisted: WAITING, left: ["left", "unsuccessful"], cancelled: ["cancelled"] }[query.status] ?? null;
      const requested = "e.id IN (SELECT jr.event_id FROM event_join_requests jr WHERE jr.user_id = ? AND jr.status = 'pending')";
      const registered = `e.id IN (SELECT event_id FROM participations mine WHERE mine.user_id = ?${wanted ? " AND mine.status IN (?)" : ""})`;
      const [where, params] = query.status === "requested" ? [requested, [req.user.id]]
        : wanted ? [registered, [req.user.id, wanted]]
          : [`(${registered} OR ${requested})`, [req.user.id, req.user.id]];
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM events e WHERE ${where}`, params);
      const rows = await event_rows(pool, { viewer_id: req.user.id, where, params, order: "e.start_time DESC, e.id DESC", limit: page_size, offset: (page - 1) * page_size });
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
        `SELECT p.*, u.name, u.email, u.student_id, m.role AS club_role,
           (SELECT COUNT(*) FROM participations q WHERE q.event_id = p.event_id AND q.status IN ('waitlisted', 'pending')
              AND (q.queued_at < p.queued_at OR (q.queued_at = p.queued_at AND q.user_id <= p.user_id))) AS position,
           EXISTS (SELECT 1 FROM event_attendance a WHERE a.event_id = p.event_id AND a.user_id = p.user_id) AS checked_in
         FROM participations p JOIN users u ON u.id = p.user_id
         LEFT JOIN memberships m ON m.user_id = p.user_id AND m.club_id = ?
         WHERE p.event_id = ? AND p.status IN (?)
         ORDER BY p.last_registered_at, p.user_id LIMIT ? OFFSET ?`, [found.row.club_id, id, wanted, page_size, (page - 1) * page_size]);
      res.json({ data: rows.map((row) => ({
        user: { id: row.user_id, name: row.name, email: row.email, student_id: row.student_id },
        club_role: row.club_role ?? null,
        status: normalize_status(row.status), queue_position: WAITING.includes(row.status) ? Number(row.position) : null,
        last_registered_at: iso(row.last_registered_at), confirmed_at: iso(row.confirmed_at), left_at: iso(row.left_at),
        checked_in: Boolean(Number(row.checked_in)),
      })), meta: page_meta(total, { page, page_size }) });
    })],
  });

  // Who joined, quit, was promoted or lost the event, newest first, plus whole-event totals.
  // "rejoined" = a user whose joined/promoted entry comes after one of their own left entries.
  define_route(router, "/events/:event_id/participation-history", {
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const query = validate_query(req.query, { ...PAGE_QUERY, action: { kind: "enum", values: ["joined", "waitlisted", "left", "quit", "promoted", "cancelled"] } });
      const { page, page_size } = pagination(query);
      const found = await load_event(pool, req.user, id, clock());
      if (!found) throw new ApiError("NOT_FOUND", "That event does not exist.");
      const club_id = found.row.club_id;
      const [[role]] = await pool.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
      if (!role || !["committee", "president"].includes(role.role)) throw new ApiError("FORBIDDEN", "Only the club committee can see who joined or quit.");
      const action = query.action === "quit" ? "left" : query.action;
      const where = action ? "h.event_id = ? AND h.action = ?" : "h.event_id = ?";
      const args = action ? [id, action] : [id];
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM participation_history h WHERE ${where}`, args);
      const [rows] = await pool.query(
        `SELECT h.id, h.action, h.from_status, h.to_status, h.reason, h.occurred_at, h.user_id, h.actor_user_id,
           u.name, u.student_id, m.role AS club_role, a.name AS actor_name
         FROM participation_history h JOIN users u ON u.id = h.user_id
         LEFT JOIN users a ON a.id = h.actor_user_id
         LEFT JOIN memberships m ON m.user_id = h.user_id AND m.club_id = ?
         WHERE ${where} ORDER BY h.occurred_at DESC, h.id DESC LIMIT ? OFFSET ?`, [club_id, ...args, page_size, (page - 1) * page_size]);
      const [[sum]] = await pool.query(
        `SELECT
           COUNT(DISTINCT CASE WHEN action IN ('joined', 'promoted') THEN user_id END) AS joined_people,
           COUNT(DISTINCT CASE WHEN action = 'left' THEN user_id END) AS quit_people,
           COUNT(DISTINCT CASE WHEN action = 'promoted' THEN user_id END) AS promoted,
           COUNT(DISTINCT CASE WHEN action IN ('joined', 'promoted') AND EXISTS (
             SELECT 1 FROM participation_history l WHERE l.event_id = h.event_id AND l.user_id = h.user_id AND l.action = 'left'
               AND (l.occurred_at < h.occurred_at OR (l.occurred_at = h.occurred_at AND l.id < h.id))) THEN user_id END) AS rejoined_people
         FROM participation_history h WHERE h.event_id = ?`, [id]);
      const [[now_in]] = await pool.query(
        `SELECT SUM(status = 'joined') AS joined, SUM(status IN ('waitlisted', 'pending')) AS waiting FROM participations WHERE event_id = ?`, [id]);
      res.json({
        data: rows.map((row) => ({
          id: Number(row.id), action: row.action, from_status: row.from_status, to_status: row.to_status,
          occurred_at: iso(row.occurred_at), reason: row.reason,
          user: { id: row.user_id, name: row.name, student_id: row.student_id },
          club_role: row.club_role ?? null,
          by: row.actor_user_id && row.actor_user_id !== row.user_id ? { id: row.actor_user_id, name: row.actor_name } : null,
        })),
        summary: {
          joined_people: Number(sum.joined_people), quit_people: Number(sum.quit_people), rejoined_people: Number(sum.rejoined_people),
          promoted: Number(sum.promoted), currently_joined: Number(now_in.joined ?? 0), currently_waitlisted: Number(now_in.waiting ?? 0),
        },
        meta: page_meta(total, { page, page_size }),
      });
    })],
  });

  // Members-only join requests: committee list and decision.
  const committee_event = async (db, user, id) => {
    const found = await load_event(db, user, id, clock());
    if (!found) throw new ApiError("NOT_FOUND", "That event does not exist.");
    const [[role]] = await db.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [user.id, found.row.club_id]);
    if (!role || !["committee", "president"].includes(role.role)) throw new ApiError("FORBIDDEN", "Only the club committee can review join requests.");
    return found;
  };

  define_route(router, "/events/:event_id/join-requests", {
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const { page, page_size } = pagination(validate_query(req.query, PAGE_QUERY));
      await committee_event(pool, req.user, id);
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM event_join_requests WHERE event_id = ? AND status = 'pending'", [id]);
      const [rows] = await pool.query(
        `SELECT r.user_id, r.allow_waitlist, r.requested_at, u.name, u.email, u.student_id FROM event_join_requests r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ? AND r.status = 'pending' ORDER BY r.requested_at, r.user_id LIMIT ? OFFSET ?`, [id, page_size, (page - 1) * page_size]);
      res.json({ data: rows.map((row) => ({
        user: { id: row.user_id, name: row.name, email: row.email, student_id: row.student_id },
        allow_waitlist: Boolean(row.allow_waitlist), requested_at: iso(row.requested_at),
      })), meta: page_meta(total, { page, page_size }) });
    })],
  });

  // Accepting uses the current capacity and waitlist rules (the request's own
  // allow_waitlist choice) until the event starts; a request made before the
  // deadline can still be accepted after it. A full event without waitlist
  // consent returns EVENT_FULL and leaves the request pending.
  define_route(router, "/events/:event_id/join-requests/:user_id/decision", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const user_id = id_param(req, "user_id");
      const body = validate_body(req.body, DECISION);
      const now = clock();
      const { row: ref } = await committee_event(pool, req.user, id);
      const result = await with_transaction(pool, async (conn) => {
        await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [ref.club_id]);
        const [[event]] = await conn.query("SELECT e.*, b.status AS b_status FROM events e JOIN bookings b ON b.id = e.booking_id WHERE e.id = ? FOR UPDATE", [id]);
        const [[reviewer]] = await conn.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, event.club_id]);
        if (!reviewer || !["committee", "president"].includes(reviewer.role)) throw new ApiError("FORBIDDEN", "Only the club committee can review join requests.");
        const [[request]] = await conn.query("SELECT status, allow_waitlist FROM event_join_requests WHERE event_id = ? AND user_id = ? FOR UPDATE", [id, user_id]);
        if (!request) throw new ApiError("NOT_FOUND", "That join request does not exist.");
        if (request.status !== "pending") throw new ApiError("INVALID_STATE", "Someone has already reviewed this request.");
        const decide = (status) => conn.query("UPDATE event_join_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, reason = ? WHERE event_id = ? AND user_id = ?",
          [status, req.user.id, to_db(now), body.reason ?? null, id, user_id]);
        if (body.decision === "reject") {
          await decide("rejected");
          await notify(conn, { users: [user_id], type: "registration_changed", event_id: id, club_id: event.club_id, now, key: `event-request-decided:${id}:${user_id}:${to_db(now)}`,
            title: `Request not accepted: ${event.title}`, body: body.reason ? `The committee said: ${body.reason}` : "The committee did not accept your request." });
          await signal(conn, { event_id: id, club_id: event.club_id, public: false, now });
          return result_for(conn, id, user_id);
        }
        if (event.status === "cancelled") throw new ApiError("INVALID_STATE", "This event was cancelled.");
        if (event.status !== "published" || event.b_status !== "confirmed") throw new ApiError("INVALID_STATE", "This event isn’t open for registration.");
        if (asDate(event.start_time) <= now) throw new ApiError("EVENT_STARTED", "This event has already started.");
        const [[member]] = await conn.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [user_id, event.club_id]);
        if (!member) {
          await decide("cancelled");
          return { cancelled: true };
        }
        const [[mine]] = await conn.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ? FOR UPDATE", [id, user_id]);
        const current = normalize_status(mine?.status ?? "none");
        await decide("accepted");
        if (!["joined", "waitlisted"].includes(current)) {
          const action_id = randomUUID();
          const { to } = await allocate(conn, event, { user_id, actor: req.user.id, allow_waitlist: Boolean(request.allow_waitlist), mine, current, now, action_id });
          await notify(conn, { users: [user_id], type: "registration_changed", event_id: id, club_id: event.club_id, now, key: `registration:${action_id}`,
            title: to === "joined" ? `Request accepted: you’re going to ${event.title}` : `Request accepted: you’re on the waitlist for ${event.title}`,
            body: to === "joined" ? "Your seat is confirmed." : "We’ll tell you if a seat opens." });
        }
        await signal(conn, { event_id: id, club_id: event.club_id, now });
        return result_for(conn, id, user_id);
      });
      // Outside the transaction so the cancelled request stays recorded.
      if (result.cancelled) throw new ApiError("MEMBERSHIP_REQUIRED", "This student is no longer a club member, so the request was closed.");
      res.json({ data: result });
    })],
  });

  return router;
}

export { create_registration_router, promote_locked };
