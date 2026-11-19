import { randomUUID } from "node:crypto";
import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError, validation_error } from "../shared/errors.js";
import { resolve_slot } from "../shared/slots.js";
import { PAGE_QUERY, assert_range, pagination, parse_utc_instant, validate_body, validate_query } from "../shared/validate.js";
import { define_route } from "./router.js";
import { signal, audit, id_param, notify, page_meta, require_admin, require_user, to_db, wrap } from "./common.js";
import { committee_ids } from "./clubs.js";
import { access, event_dto, event_rows, load_event, tags_for } from "./event_model.js";

const COMMITTEE = ["committee", "president"];
const SLOT_IDS = ["morning", "afternoon", "evening"];

const CREATE = {
  club_id: { kind: "int", min: 1, required: true },
  venue_id: { kind: "int", min: 1, required: true },
  title: { kind: "string", min: 1, max: 255, required: true },
  description: { kind: "string", min: 1, max: 10000, required: true },
  date: { kind: "date", required: true },
  slot_id: { kind: "enum", values: SLOT_IDS, required: true },
  visibility: { kind: "enum", values: ["public", "members_only"], required: true },
  capacity: { kind: "int", min: 1, max: 500, required: true },
  registration_closes_at: { kind: "instant" },
  campus_tag_ids: { kind: "id_array", min: 1, max: 3 },
  club_tag_ids: { kind: "id_array", min: 0, max: 5 },
};
const EDIT = {
  expected_version: { kind: "int", min: 1, required: true },
  title: { ...CREATE.title, required: false }, description: { ...CREATE.description, required: false },
  capacity: { ...CREATE.capacity, required: false }, visibility: { ...CREATE.visibility, required: false },
  registration_closes_at: { kind: "instant" },
  campus_tag_ids: CREATE.campus_tag_ids, club_tag_ids: CREATE.club_tag_ids,
};
const VERSIONED = { expected_version: { kind: "int", min: 1, required: true } };
const CANCEL = { ...VERSIONED, reason: { kind: "string", min: 1, max: 500, required: true } };
const DECISION = { ...VERSIONED, decision: { kind: "enum", values: ["approve", "reject"], required: true }, reason: { kind: "string", min: 1, max: 500 } };
const BOOKING_SIGNOFF = { ...VERSIONED, decision: { kind: "enum", values: ["send", "return"], required: true }, reason: { kind: "string", min: 1, max: 500 } };
const EVENT_SIGNOFF = { ...VERSIONED, decision: { kind: "enum", values: ["publish", "return"], required: true }, reason: { kind: "string", min: 1, max: 500 } };

const asDate = (text) => new Date(`${String(text).replace(" ", "T")}Z`);

async function member_role(db, user_id, club_id, lock = false) {
  const [rows] = await db.query(`SELECT role FROM memberships WHERE user_id = ? AND club_id = ?${lock ? " FOR UPDATE" : ""}`, [user_id, club_id]);
  return rows[0]?.role ?? null;
}

async function president_id(db, club_id) {
  const [rows] = await db.query("SELECT user_id FROM memberships WHERE club_id = ? AND role = 'president'", [club_id]);
  return rows[0]?.user_id ?? null;
}

async function admin_ids(db, excluded_club_id) {
  const [rows] = await db.query(
    `SELECT u.id FROM users u WHERE u.platform_role = 'venue_admin'
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.club_id = ? AND m.role IN ('committee', 'president'))`, [excluded_club_id]);
  return rows.map((row) => row.id);
}

// Campus tags must exist and be active; club tags must belong to the event's club.
async function set_tags(conn, event_id, club_id, { campus_tag_ids, club_tag_ids }) {
  if (campus_tag_ids) {
    const [found] = await conn.query("SELECT id FROM campus_tags WHERE id IN (?) AND retired_at IS NULL", [campus_tag_ids]);
    if (found.length !== campus_tag_ids.length) throw validation_error({ campus_tag_ids: "Choose active campus tags." });
    await conn.query("DELETE FROM event_campus_tags WHERE event_id = ?", [event_id]);
    for (const id of campus_tag_ids) await conn.query("INSERT INTO event_campus_tags (event_id, campus_tag_id) VALUES (?, ?)", [event_id, id]);
  }
  if (club_tag_ids) {
    if (club_tag_ids.length) {
      const [found] = await conn.query("SELECT id FROM club_tags WHERE id IN (?) AND club_id = ?", [club_tag_ids, club_id]);
      if (found.length !== club_tag_ids.length) throw validation_error({ club_tag_ids: "Use your own club’s tags." });
    }
    await conn.query("DELETE FROM event_club_tags WHERE event_id = ?", [event_id]);
    for (const id of club_tag_ids) await conn.query("INSERT INTO event_club_tags (event_id, club_tag_id) VALUES (?, ?)", [event_id, id]);
  }
}

const read_event = async (db, user, id, now) => (await load_event(db, user, id, now)).dto;

// Events, bookings, publication and sign-off.
function create_events_router({ pool, clock }) {
  const router = express.Router();

  // ---- create / list / detail -------------------------------------------------
  define_route(router, "/events", {
    post: [require_user, wrap(async (req, res) => {
      const body = validate_body(req.body, CREATE);
      // Every event carries 1–3 campus tags (event-tags spec); there is no silent default.
      if (!body.campus_tag_ids) throw validation_error({ campus_tag_ids: "Choose 1 to 3 campus tags." });
      const now = clock();
      const { start, end } = resolve_slot(body.date, body.slot_id, now);
      let closes = start;
      if (body.registration_closes_at) {
        closes = parse_utc_instant(body.registration_closes_at);
        if (closes <= now || closes > start) throw validation_error({ registration_closes_at: "Registration must close in the future and before the event starts." });
      }
      const event_id = await with_transaction(pool, async (conn) => {
        // Lock order: venue, club, then existing bookings (via the overlap read).
        const [[venue]] = await conn.query("SELECT id, name, capacity, is_active FROM venues WHERE id = ? FOR UPDATE", [body.venue_id]);
        if (!venue || !venue.is_active) throw validation_error({ venue_id: "Choose an active venue." });
        if (body.capacity > Math.min(venue.capacity, 500)) throw validation_error({ capacity: `${venue.name} holds up to ${Math.min(venue.capacity, 500)} people.` });
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [body.club_id]);
        const role = club && await member_role(conn, req.user.id, body.club_id);
        if (!club || !COMMITTEE.includes(role)) throw new ApiError(club ? "FORBIDDEN" : "NOT_FOUND", club ? "Only the club committee can request a venue." : "That club does not exist.");
        const [clash] = await conn.query(
          "SELECT id FROM bookings WHERE venue_id = ? AND status = 'confirmed' AND start_time < ? AND end_time > ? FOR UPDATE", [venue.id, to_db(end), to_db(start)]);
        if (clash.length) throw new ApiError("VENUE_UNAVAILABLE", "That slot was just booked. Pick another time.");

        const president = await president_id(conn, body.club_id);
        const awaiting = role !== "president" && president !== null;
        const [booking] = await conn.query(
          `INSERT INTO bookings (venue_id, club_id, start_time, end_time, status, version, requested_by, signoff_requested_by)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [venue.id, body.club_id, to_db(start), to_db(end), awaiting ? "awaiting_president" : "pending", req.user.id, awaiting ? req.user.id : null]);
        const [event] = await conn.query(
          `INSERT INTO events (booking_id, club_id, title, description, start_time, end_time, visibility, status, capacity, version, registration_closes_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, 1, ?, ?)`,
          [booking.insertId, body.club_id, body.title, body.description, to_db(start), to_db(end), body.visibility, body.capacity, to_db(closes), req.user.id]);
        await set_tags(conn, event.insertId, body.club_id, { campus_tag_ids: body.campus_tag_ids, club_tag_ids: body.club_tag_ids });
        await audit(conn, { actor: req.user.id, entity_type: "booking", entity_id: booking.insertId, action: "booking.requested", details: { event_id: event.insertId, awaiting_president: awaiting }, now });
        if (awaiting) {
          await notify(conn, { users: [president], type: "signoff_requested", club_id: body.club_id, event_id: event.insertId, booking_id: booking.insertId, now, key: `signoff_requested:b${booking.insertId}:1`, title: `Venue request needs your sign-off: ${body.title}`, body: `${req.user.name} asked for ${venue.name}.` });
        } else {
          await notify(conn, { users: await admin_ids(conn, body.club_id), type: "booking_requested", event_id: event.insertId, booking_id: booking.insertId, now, exclude: req.user.id, key: `booking_requested:${booking.insertId}:1`, title: `Venue request: ${body.title}`, body: `${club.name} requested ${venue.name}.` });
        }
        return event.insertId;
      });
      res.status(201).json({ data: await read_event(pool, req.user, event_id, now) });
    })],

    get: [require_user, wrap(async (req, res) => {
      const query = validate_query(req.query, {
        ...PAGE_QUERY, q: { kind: "string", min: 0, max: 100 }, club_id: { kind: "id" }, venue_id: { kind: "id" },
        visibility: { kind: "enum", values: ["public", "members_only"] }, phase: { kind: "enum", values: ["upcoming", "past"] },
        from: { kind: "instant" }, to: { kind: "instant" }, tag: { kind: "string", min: 1, max: 32 },
      }, { repeatable: ["tag"] });
      const { page, page_size } = pagination(query);
      const now = clock();
      if ((query.from === undefined) !== (query.to === undefined)) throw validation_error({ from: "Send from and to together." });
      const tags = query.tag === undefined ? [] : [].concat(query.tag);
      if (tags.length > 5) throw validation_error({ tag: "Use at most 5 tags." });
      const where = ["e.status = 'published'", "b.status = 'confirmed'"];
      const params = [];
      const add = (sql, ...values) => { where.push(sql); params.push(...values); };
      add(query.phase === "past" ? "e.start_time < ?" : "e.start_time >= ?", to_db(now));
      if (query.club_id) add("e.club_id = ?", query.club_id);
      if (query.venue_id) add("v.id = ?", query.venue_id);
      if (query.visibility) add("e.visibility = ?", query.visibility);
      if (query.from) {
        const from = parse_utc_instant(query.from);
        const to = parse_utc_instant(query.to);
        assert_range(from, to, 93);
        add("e.start_time >= ? AND e.start_time < ?", to_db(from), to_db(to));
      }
      if (tags.length) {
        add(`EXISTS (SELECT 1 FROM event_campus_tags ect JOIN campus_tags ct ON ct.id = ect.campus_tag_id WHERE ect.event_id = e.id AND ct.slug IN (?))`, tags);
      }
      if (query.q) {
        const like = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
        add(`(e.title LIKE ? OR e.description LIKE ? OR c.name LIKE ? OR v.name LIKE ?
          OR EXISTS (SELECT 1 FROM event_campus_tags ect JOIN campus_tags ct ON ct.id = ect.campus_tag_id WHERE ect.event_id = e.id AND ct.name LIKE ?)
          OR EXISTS (SELECT 1 FROM event_club_tags ecl JOIN club_tags cl ON cl.id = ecl.club_tag_id WHERE ecl.event_id = e.id AND cl.name LIKE ?))`, like, like, like, like, like, like);
      }
      const joined = where.join(" AND ");
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM events e JOIN clubs c ON c.id = e.club_id JOIN bookings b ON b.id = e.booking_id JOIN venues v ON v.id = b.venue_id WHERE ${joined}`, params);
      const rows = await event_rows(pool, { viewer_id: req.user.id, where: joined, params, order: query.phase === "past" ? "e.start_time DESC, e.id DESC" : "e.start_time ASC, e.id ASC", limit: page_size, offset: (page - 1) * page_size });
      const tag_map = await tags_for(pool, rows.map((row) => row.id));
      res.json({ data: rows.map((row) => event_dto(row, tag_map.get(row.id), now, { detail: false })), meta: page_meta(total, { page, page_size }) });
    })],
  });

  define_route(router, "/me/events", {
    get: [require_user, wrap(async (req, res) => {
      const query = validate_query(req.query, { ...PAGE_QUERY, club_id: { kind: "id" }, state: { kind: "enum", values: ["draft", "awaiting_president", "published", "cancelled"] } });
      const { page, page_size } = pagination(query);
      const now = clock();
      const [mine] = await pool.query("SELECT club_id FROM memberships WHERE user_id = ? AND role IN ('committee', 'president')", [req.user.id]);
      const clubs = mine.map((row) => row.club_id);
      if (query.club_id && !clubs.includes(query.club_id)) throw new ApiError("FORBIDDEN", "You don’t manage that club.");
      if (!clubs.length) return res.json({ data: [], meta: page_meta(0, { page, page_size }) });
      const where = ["e.club_id IN (?)"];
      const params = [query.club_id ? [query.club_id] : clubs];
      if (query.state) { where.push("e.status = ?"); params.push(query.state); }
      const joined = where.join(" AND ");
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM events e WHERE ${joined}`, params);
      const rows = await event_rows(pool, { viewer_id: req.user.id, where: joined, params, order: "e.start_time DESC, e.id DESC", limit: page_size, offset: (page - 1) * page_size });
      const tag_map = await tags_for(pool, rows.map((row) => row.id));
      res.json({ data: rows.map((row) => event_dto(row, tag_map.get(row.id), now, { manages: true })), meta: page_meta(total, { page, page_size }) });
    })],
  });

  define_route(router, "/events/:event_id", {
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const found = await load_event(pool, req.user, id, clock());
      if (!found) throw new ApiError("NOT_FOUND", "That event does not exist.");
      res.json({ data: found.dto });
    })],
    patch: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, EDIT, { at_least_one_of: ["title", "description", "capacity", "visibility", "registration_closes_at", "campus_tag_ids", "club_tag_ids"] });
      const now = clock();
      await mutate_event(pool, req, id, async (conn, ctx) => {
        const { event, booking } = ctx;
        if (!COMMITTEE.includes(ctx.role)) throw new ApiError("FORBIDDEN", "Only the club committee can edit this event.");
        if (Number(event.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This event changed. Refresh and try again.");
        if (["rejected", "returned", "cancelled"].includes(booking.status) || event.status === "cancelled") throw new ApiError("INVALID_STATE", "This event can’t be edited.");
        const frozen = ["capacity", "visibility", "registration_closes_at"].filter((key) => body[key] !== undefined);
        if (event.status !== "draft" && frozen.length) throw new ApiError("PUBLISHED_FIELDS_FROZEN", "After publishing, only the title, description and tags can change.", { fields: Object.fromEntries(frozen.map((key) => [key, "Can’t change after publishing."])) });
        const sets = []; const values = [];
        const set = (column, value) => { sets.push(`${column} = ?`); values.push(value); };
        if (body.title !== undefined) set("title", body.title);
        if (body.description !== undefined) set("description", body.description);
        if (body.visibility !== undefined) set("visibility", body.visibility);
        if (body.capacity !== undefined) {
          if (body.capacity > Math.min(ctx.venue.capacity, 500)) throw validation_error({ capacity: `${ctx.venue.name} holds up to ${Math.min(ctx.venue.capacity, 500)} people.` });
          set("capacity", body.capacity);
        }
        if (body.registration_closes_at !== undefined) {
          const closes = parse_utc_instant(body.registration_closes_at);
          if (closes <= now || closes > asDate(event.start_time)) throw validation_error({ registration_closes_at: "Registration must close in the future and before the event starts." });
          set("registration_closes_at", to_db(closes));
        }
        if (sets.length) await conn.query(`UPDATE events SET ${sets.join(", ")}, version = version + 1 WHERE id = ?`, [...values, id]);
        else await conn.query("UPDATE events SET version = version + 1 WHERE id = ?", [id]);
        await set_tags(conn, id, event.club_id, body);
        await signal(conn, { event_id: id, club_id: event.club_id, public: event.status === "published", now });
        await audit(conn, { actor: req.user.id, entity_type: "event", entity_id: id, action: "event.edited", details: { fields: Object.keys(body).filter((key) => key !== "expected_version") }, now });
      });
      res.json({ data: await read_event(pool, req.user, id, now) });
    })],
  });

  // ---- publish / cancel -----------------------------------------------------
  define_route(router, "/events/:event_id/publish", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, VERSIONED);
      const now = clock();
      await mutate_event(pool, req, id, async (conn, ctx) => {
        const { event, booking } = ctx;
        if (!COMMITTEE.includes(ctx.role)) throw new ApiError("FORBIDDEN", "Only the club committee can publish.");
        if (Number(event.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This event changed. Refresh and try again.");
        if (event.status !== "draft" || booking.status !== "confirmed" || ctx.venue.is_active !== 1) throw new ApiError("INVALID_STATE", "Only an approved draft can be published.");
        if (asDate(event.start_time) <= now || asDate(event.registration_closes_at) <= now) throw new ApiError("INVALID_STATE", "The event or its registration deadline has already passed.");
        const president = await president_id(conn, event.club_id);
        if (ctx.role === "president" || president === null) {
          await conn.query("UPDATE events SET status = 'published', version = version + 1 WHERE id = ?", [id]);
          await audit(conn, { actor: req.user.id, entity_type: "event", entity_id: id, action: "event.published", now });
          await signal(conn, { event_id: id, club_id: event.club_id, now });
          await announce(conn, event, req.user.id, now);
        } else {
          await conn.query("UPDATE events SET status = 'awaiting_president', signoff_requested_by = ?, signoff_reason = NULL, version = version + 1 WHERE id = ?", [req.user.id, id]);
          await audit(conn, { actor: req.user.id, entity_type: "event", entity_id: id, action: "event.publish_requested", now });
          await signal(conn, { event_id: id, club_id: event.club_id, public: false, now });
          await notify(conn, { users: [president], type: "signoff_requested", club_id: event.club_id, event_id: id, now, key: `signoff_requested:e${id}:${Number(event.version) + 1}`, title: `Publish ${event.title}?`, body: `${req.user.name} asked to publish this event.` });
        }
      });
      res.json({ data: await read_event(pool, req.user, id, now) });
    })],
  });

  async function announce(conn, event, actor, now) {
    const [members] = await conn.query("SELECT user_id FROM memberships WHERE club_id = ? LIMIT 1500", [event.club_id]);
    await notify(conn, { users: members.map((row) => row.user_id), type: "event_published", club_id: event.club_id, event_id: event.id, now, exclude: actor, key: `event_published:${event.id}`, title: `New event: ${event.title}`, body: "A club you belong to just published an event." });
  }

  define_route(router, "/events/:event_id/signoff", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, EVENT_SIGNOFF);
      if (body.decision === "return" && !body.reason) throw validation_error({ reason: "Say why you are returning it." });
      const now = clock();
      await mutate_event(pool, req, id, async (conn, ctx) => {
        const { event } = ctx;
        if (ctx.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can sign off.");
        if (Number(event.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This event changed. Refresh and try again.");
        if (event.status !== "awaiting_president") throw new ApiError("INVALID_STATE", "Nothing is waiting for sign-off.");
        if (body.decision === "publish") {
          if (asDate(event.start_time) <= now || asDate(event.registration_closes_at) <= now) throw new ApiError("INVALID_STATE", "The event or its registration deadline has already passed.");
          await conn.query("UPDATE events SET status = 'published', signoff_decided_by = ?, signoff_decided_at = ?, signoff_reason = NULL, version = version + 1 WHERE id = ?", [req.user.id, to_db(now), id]);
          await announce(conn, event, req.user.id, now);
        } else {
          await conn.query("UPDATE events SET status = 'draft', signoff_decided_by = ?, signoff_decided_at = ?, signoff_reason = ?, version = version + 1 WHERE id = ?", [req.user.id, to_db(now), body.reason, id]);
        }
        await audit(conn, { actor: req.user.id, entity_type: "event", entity_id: id, action: `event.signoff_${body.decision}`, details: { reason: body.reason ?? null }, now });
        await signal(conn, { event_id: id, club_id: event.club_id, public: body.decision === "publish", now });
        await notify(conn, { users: [event.signoff_requested_by], type: "signoff_decided", club_id: event.club_id, event_id: id, now, exclude: req.user.id, key: `signoff_decided:e${id}:${Number(event.version) + 1}`, title: body.decision === "publish" ? `${event.title} was published` : `${event.title} was returned`, body: body.decision === "publish" ? "The president published your event." : body.reason });
      });
      res.json({ data: await read_event(pool, req.user, id, now) });
    })],
  });

  define_route(router, "/events/:event_id/cancel", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, CANCEL);
      const now = clock();
      await mutate_event(pool, req, id, async (conn, ctx) => {
        const { event, booking } = ctx;
        const admin = req.user.platform_role === "venue_admin";
        const allowed = admin || ctx.role === "president" || (ctx.role === "committee" && ["draft", "awaiting_president"].includes(event.status));
        if (!allowed) throw new ApiError("FORBIDDEN", ctx.role ? "Only the president can cancel a published event." : "You can’t cancel this event.");
        if (event.status === "cancelled") return; // idempotent, even with an old version
        if (Number(event.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This event changed. Refresh and try again.");
        if (asDate(event.start_time) <= now) throw new ApiError("EVENT_STARTED", "This event has already started.");
        const [people] = await conn.query("SELECT user_id, status FROM participations WHERE event_id = ? AND status IN ('joined', 'waitlisted', 'pending') ORDER BY user_id FOR UPDATE", [id]);
        await conn.query("UPDATE events SET status = 'cancelled', version = version + 1 WHERE id = ?", [id]);
        if (["pending", "confirmed", "awaiting_president"].includes(booking.status)) {
          await conn.query("UPDATE bookings SET status = 'cancelled', version = version + 1 WHERE id = ?", [booking.id]);
        }
        const action_id = randomUUID();
        for (const person of people) {
          const from = person.status === "joined" ? "joined" : "waitlisted";
          await conn.query("UPDATE participations SET status = 'cancelled', left_at = ? WHERE user_id = ? AND event_id = ?", [to_db(now), person.user_id, id]);
          await conn.query(
            `INSERT INTO participation_history (event_id, user_id, actor_user_id, action_id, action, from_status, to_status, reason, occurred_at)
             VALUES (?, ?, ?, ?, 'cancelled', ?, 'cancelled', 'event_cancelled', ?)`, [id, person.user_id, req.user.id, action_id, from, to_db(now)]);
        }
        // Pending members-only requests close with the event; those students hear about it too.
        const [requesters] = await conn.query("SELECT user_id FROM event_join_requests WHERE event_id = ? AND status = 'pending' FOR UPDATE", [id]);
        await conn.query("UPDATE event_join_requests SET status = 'cancelled' WHERE event_id = ? AND status = 'pending'", [id]);
        await audit(conn, { actor: req.user.id, entity_type: "event", entity_id: id, action: "event.cancelled", details: { reason: body.reason }, now });
        await signal(conn, { event_id: id, club_id: event.club_id, public: event.status === "published", now });
        const committee = await committee_ids(conn, event.club_id);
        await notify(conn, { users: [...people.map((person) => person.user_id), ...requesters.map((row) => row.user_id), ...committee], type: "event_cancelled", club_id: event.club_id, event_id: id, now, key: `event_cancelled:${id}`, title: `Cancelled: ${event.title}`, body: body.reason });
      });
      res.json({ data: await read_event(pool, req.user, id, now) });
    })],
  });

  // ---- bookings -------------------------------------------------------------
  define_route(router, "/bookings", {
    get: [require_admin, wrap(async (req, res) => {
      const query = validate_query(req.query, { ...PAGE_QUERY, status: { kind: "enum", values: ["pending", "confirmed", "rejected", "cancelled"] }, venue_id: { kind: "id" } });
      const { page, page_size } = pagination(query);
      const now = clock();
      const where = ["(? IS NULL OR b.status = ?)", "(? IS NULL OR b.venue_id = ?)"];
      const params = [query.status ?? null, query.status ?? null, query.venue_id ?? null, query.venue_id ?? null];
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM bookings b WHERE ${where.join(" AND ")}`, params);
      const [rows] = await pool.query(
        `SELECT b.*, e.id AS event_id, e.title AS event_title, e.capacity FROM bookings b JOIN events e ON e.booking_id = b.id
         WHERE ${where.join(" AND ")} ORDER BY b.created_at, b.id LIMIT ? OFFSET ?`, [...params, page_size, (page - 1) * page_size]);
      res.json({ data: rows.map((row) => booking_dto(row, now, { title: true })), meta: page_meta(total, { page, page_size }) });
    })],
  });

  define_route(router, "/bookings/:booking_id/decision", {
    post: [require_admin, wrap(async (req, res) => {
      const id = id_param(req, "booking_id");
      const body = validate_body(req.body, DECISION);
      if (body.decision === "reject" && !body.reason) throw validation_error({ reason: "Give a reason for rejecting." });
      const now = clock();
      const [[found]] = await pool.query("SELECT b.venue_id, b.club_id, e.id AS event_id FROM bookings b JOIN events e ON e.booking_id = b.id WHERE b.id = ?", [id]);
      if (!found) throw new ApiError("NOT_FOUND", "That request does not exist.");
      await with_transaction(pool, async (conn) => {
        await conn.query("SELECT id FROM venues WHERE id = ? FOR UPDATE", [found.venue_id]);
        await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [found.club_id]);
        const [[booking]] = await conn.query("SELECT * FROM bookings WHERE id = ? FOR UPDATE", [id]);
        const [[event]] = await conn.query("SELECT * FROM events WHERE id = ? FOR UPDATE", [found.event_id]);
        if (await member_role(conn, req.user.id, booking.club_id)) {
          if (COMMITTEE.includes(await member_role(conn, req.user.id, booking.club_id))) throw new ApiError("SELF_DECISION_FORBIDDEN", "You can’t decide a request for your own club.");
        }
        if (Number(booking.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This request changed. Refresh and try again.");
        if (booking.status !== "pending" || event.status !== "draft" || asDate(booking.start_time) <= now) throw new ApiError("INVALID_STATE", "This request can no longer be decided.");
        if (body.decision === "approve") {
          const [clash] = await conn.query("SELECT id FROM bookings WHERE venue_id = ? AND status = 'confirmed' AND id <> ? AND start_time < ? AND end_time > ? FOR UPDATE", [booking.venue_id, id, booking.end_time, booking.start_time]);
          if (clash.length) throw new ApiError("VENUE_UNAVAILABLE", "The venue is no longer available. Review the updated request before trying again.");
        }
        const status = body.decision === "approve" ? "confirmed" : "rejected";
        await conn.query("UPDATE bookings SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, version = version + 1 WHERE id = ?", [status, req.user.id, to_db(now), body.reason ?? null, id]);
        await audit(conn, { actor: req.user.id, entity_type: "booking", entity_id: id, action: `booking.${status}`, details: { reason: body.reason ?? null }, now });
        await signal(conn, { event_id: event.id, club_id: booking.club_id, public: false, now });
        await notify(conn, { users: await committee_ids(conn, booking.club_id), type: "booking_decided", club_id: booking.club_id, event_id: event.id, booking_id: id, now, exclude: req.user.id, key: `booking_decided:${id}:${Number(booking.version) + 1}`, title: body.decision === "approve" ? `Venue approved: ${event.title}` : `Venue request rejected: ${event.title}`, body: body.reason ?? (body.decision === "approve" ? "Publish the event when you are ready." : "The request was rejected.") });
      });
      const [[row]] = await pool.query("SELECT b.*, e.id AS event_id, e.title AS event_title, e.capacity FROM bookings b JOIN events e ON e.booking_id = b.id WHERE b.id = ?", [id]);
      res.json({ data: booking_dto(row, now, { title: true }) });
    })],
  });

  define_route(router, "/bookings/:booking_id/signoff", {
    post: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "booking_id");
      const body = validate_body(req.body, BOOKING_SIGNOFF);
      if (body.decision === "return" && !body.reason) throw validation_error({ reason: "Say why you are returning it." });
      const now = clock();
      const [[found]] = await pool.query("SELECT b.venue_id, b.club_id, e.id AS event_id FROM bookings b JOIN events e ON e.booking_id = b.id WHERE b.id = ?", [id]);
      if (!found) throw new ApiError("NOT_FOUND", "That request does not exist.");
      await with_transaction(pool, async (conn) => {
        await conn.query("SELECT id FROM venues WHERE id = ? FOR UPDATE", [found.venue_id]);
        await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [found.club_id]);
        const [[booking]] = await conn.query("SELECT * FROM bookings WHERE id = ? FOR UPDATE", [id]);
        const [[event]] = await conn.query("SELECT * FROM events WHERE id = ? FOR UPDATE", [found.event_id]);
        const role = await member_role(conn, req.user.id, booking.club_id);
        if (role !== "president") throw new ApiError(role ? "FORBIDDEN" : "NOT_FOUND", "Only the president can sign off.");
        if (Number(booking.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This request changed. Refresh and try again.");
        if (booking.status !== "awaiting_president") throw new ApiError("INVALID_STATE", "Nothing is waiting for sign-off.");
        // Sending on only rechecks that the slot is still in the future; venue conflicts stay the admin's check.
        if (body.decision === "send" && asDate(booking.start_time) <= now) throw new ApiError("INVALID_STATE", "That slot is in the past.");
        const status = body.decision === "send" ? "pending" : "returned";
        await conn.query("UPDATE bookings SET status = ?, signoff_decided_by = ?, signoff_decided_at = ?, signoff_reason = ?, version = version + 1 WHERE id = ?", [status, req.user.id, to_db(now), body.reason ?? null, id]);
        await audit(conn, { actor: req.user.id, entity_type: "booking", entity_id: id, action: `booking.signoff_${body.decision}`, details: { reason: body.reason ?? null }, now });
        await signal(conn, { event_id: event.id, club_id: booking.club_id, public: false, now });
        const version = Number(booking.version) + 1;
        await notify(conn, { users: [booking.signoff_requested_by ?? booking.requested_by], type: "signoff_decided", club_id: booking.club_id, event_id: event.id, booking_id: id, now, exclude: req.user.id, key: `signoff_decided:b${id}:${version}`, title: body.decision === "send" ? `Sent to the venue team: ${event.title}` : `Returned: ${event.title}`, body: body.reason ?? "The president sent your request to the venue administrators." });
        if (body.decision === "send") {
          await notify(conn, { users: await admin_ids(conn, booking.club_id), type: "booking_requested", event_id: event.id, booking_id: id, now, key: `booking_requested:${id}:${version}`, title: `Venue request: ${event.title}`, body: "A club request is waiting for review." });
        }
      });
      const [[row]] = await pool.query("SELECT b.*, e.id AS event_id, e.title AS event_title, e.capacity FROM bookings b JOIN events e ON e.booking_id = b.id WHERE b.id = ?", [id]);
      res.json({ data: booking_dto(row, now, { title: true }) });
    })],
  });

  define_route(router, "/me/signoffs", {
    get: [require_user, wrap(async (req, res) => {
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const now = clock();
      const [clubs] = await pool.query("SELECT club_id FROM memberships WHERE user_id = ? AND role = 'president'", [req.user.id]);
      if (!clubs.length) return res.json({ data: { bookings: [], events: [] } });
      const ids = clubs.map((row) => row.club_id);
      const [bookings] = await pool.query(
        `SELECT b.*, e.id AS event_id, e.title AS event_title, e.capacity FROM bookings b JOIN events e ON e.booking_id = b.id
         WHERE b.club_id IN (?) AND b.status = 'awaiting_president' ORDER BY b.id LIMIT ? OFFSET ?`, [ids, query.page_size, (query.page - 1) * query.page_size]);
      const rows = await event_rows(pool, { viewer_id: req.user.id, where: "e.club_id IN (?) AND e.status = 'awaiting_president'", params: [ids], order: "e.id", limit: query.page_size, offset: (query.page - 1) * query.page_size });
      const tag_map = await tags_for(pool, rows.map((row) => row.id));
      res.json({ data: { bookings: bookings.map((row) => booking_dto(row, now, { title: true })), events: rows.map((row) => event_dto(row, tag_map.get(row.id), now, { manages: true })) } });
    })],
  });

  return router;
}

function booking_dto(row, now, { title = false } = {}) {
  const start = asDate(row.start_time);
  const iso_of = (value) => (value ? new Date(`${String(value).replace(" ", "T")}Z`).toISOString() : null);
  const dto = {
    id: row.id, event_id: row.event_id, club_id: row.club_id, venue_id: row.venue_id,
    start_at: iso_of(row.start_time), end_at: iso_of(row.end_time), status: row.status, version: Number(row.version),
    requested_by: row.requested_by, created_at: iso_of(row.created_at), decided_by: row.decided_by, decided_at: iso_of(row.decided_at),
    decision_reason: row.decision_reason, expired: row.status === "pending" && start <= now,
  };
  if (title) { dto.event_title = row.event_title; dto.capacity = row.capacity; }
  return dto;
}

// Locks venue, club, booking, event (in that order) for an event write and passes the rows to `work`.
async function mutate_event(pool, req, event_id, work) {
  const [[ref]] = await pool.query(
    "SELECT e.club_id, e.booking_id, b.venue_id FROM events e JOIN bookings b ON b.id = e.booking_id WHERE e.id = ?", [event_id]);
  const role_first = ref && await member_role(pool, req.user.id, ref.club_id);
  const admin = req.user.platform_role === "venue_admin";
  if (!ref) throw new ApiError("NOT_FOUND", "That event does not exist.");
  await with_transaction(pool, async (conn) => {
    const [[venue]] = await conn.query("SELECT id, name, capacity, is_active FROM venues WHERE id = ? FOR UPDATE", [ref.venue_id]);
    await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [ref.club_id]);
    const [[booking]] = await conn.query("SELECT * FROM bookings WHERE id = ? FOR UPDATE", [ref.booking_id]);
    const [[event]] = await conn.query("SELECT * FROM events WHERE id = ? FOR UPDATE", [event_id]);
    const role = await member_role(conn, req.user.id, ref.club_id);
    // Hidden drafts look like missing events to people who may not see them.
    const visible = event.status === "published" || role || admin
      || (event.status === "cancelled" && (await conn.query("SELECT 1 FROM participations WHERE event_id = ? AND user_id = ?", [event_id, req.user.id]))[0].length);
    if (!visible) throw new ApiError("NOT_FOUND", "That event does not exist.");
    void role_first;
    await work(conn, { venue, booking, event, role });
  });
}

export { COMMITTEE, admin_ids, booking_dto, create_events_router, mutate_event, president_id };
