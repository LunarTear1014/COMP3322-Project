import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { PAGE_QUERY, pagination, validate_body, validate_query } from "../shared/validate.js";
import { define_route } from "./router.js";
import { end_members_only_places, list_actions, log_action, undo_action } from "./club_actions.js";
import { promote_locked } from "./registration.js";
import { audit, id_param, iso, membership_dto, notify, page_meta, require_admin, require_user, to_db, wrap } from "./common.js";

const WAITING = "('waitlisted', 'pending')";

async function committee_of(db, user_id, club_id, { lock = false } = {}) {
  const [rows] = await db.query(
    `SELECT role, version FROM memberships WHERE user_id = ? AND club_id = ?${lock ? " FOR UPDATE" : ""}`, [user_id, club_id]);
  return rows[0] || null;
}
const is_committee = (membership) => ["committee", "president"].includes(membership?.role);

async function committee_ids(db, club_id) {
  const [rows] = await db.query("SELECT user_id FROM memberships WHERE club_id = ? AND role IN ('committee', 'president')", [club_id]);
  return rows.map((row) => row.user_id);
}

const REVIEW = { decision: { kind: "enum", values: ["accept", "reject"], required: true } };
const join_request_dto = (club_id, id) => ({ id, club_id, status: "pending" });

const MEMBER_PATCH = { role: { kind: "enum", values: ["member", "committee"], required: true }, expected_version: { kind: "int", min: 1, required: true } };
const PRESIDENCY = { to_user_id: { kind: "int", min: 1, required: true }, expected_version: { kind: "int", min: 1, required: true } };
const TAG_BODY = { name: { kind: "string", min: 1, max: 24, required: true } };
const CAMPUS_TAG = { slug: { kind: "string", min: 1, max: 32, required: true, lowercase: true, pattern: /^[a-z0-9-]+$/ }, name: { kind: "string", min: 1, max: 40, required: true } };
const CAMPUS_TAG_PATCH = { name: { kind: "string", min: 1, max: 40 }, retired: { kind: "bool" } };

// Clubs, memberships, governance (president-only role changes), venues and tags.
function create_clubs_router({ pool, clock }) {
  const router = express.Router();

  define_route(router, "/clubs", {
    get: [require_user, wrap(async (req, res) => {
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM clubs");
      const [rows] = await pool.query(
        `SELECT c.id, c.name, c.description, m.role AS my_role,
           EXISTS(SELECT 1 FROM club_join_requests r WHERE r.club_id = c.id AND r.user_id = ? AND r.status = 'pending') AS request_pending
         FROM clubs c LEFT JOIN memberships m ON m.club_id = c.id AND m.user_id = ? ORDER BY c.id LIMIT ? OFFSET ?`,
        [req.user.id, req.user.id, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map((row) => ({ id: row.id, name: row.name, description: row.description, my_role: row.my_role,
        request_status: !row.my_role && Number(row.request_pending) ? "pending" : null })), meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/me/memberships", {
    get: [require_user, wrap(async (req, res) => {
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM memberships WHERE user_id = ?", [req.user.id]);
      const [rows] = await pool.query(
        `SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id
         WHERE m.user_id = ? ORDER BY m.club_id LIMIT ? OFFSET ?`, [req.user.id, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map(membership_dto), meta: page_meta(total, query) });
    })],
  });

  // Joining asks the committee. A current member (any role) gets their
  // membership back unchanged; a pending request is returned as is.
  define_route(router, "/clubs/:club_id/membership", {
    put: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const now = clock();
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        const existing = await committee_of(conn, req.user.id, club_id, { lock: true });
        if (existing) {
          const [[row]] = await conn.query(
            `SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? AND m.club_id = ?`, [req.user.id, club_id]);
          return { status: 200, data: membership_dto(row) };
        }
        const [[pending]] = await conn.query(
          "SELECT id FROM club_join_requests WHERE user_id = ? AND club_id = ? AND status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE", [req.user.id, club_id]);
        if (pending) return { status: 200, data: join_request_dto(club_id, pending.id) };
        const [inserted] = await conn.query("INSERT INTO club_join_requests (user_id, club_id, status, requested_at) VALUES (?, ?, 'pending', ?)", [req.user.id, club_id, to_db(now)]);
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "member.requested", details: { user_id: req.user.id, request_id: inserted.insertId }, now });
        // Actionable, so immediate rather than in the daily digest.
        await notify(conn, { users: await committee_ids(conn, club_id), type: "club_join_request", club_id, club_join_request_id: inserted.insertId, now,
          key: `club-request:${inserted.insertId}`, title: `${req.user.name} wants to join ${club.name}`, body: "Approve or reject the request." });
        return { status: 202, data: join_request_dto(club_id, inserted.insertId) };
      });
      res.status(result.status).json({ data: result.data });
    })],
    delete: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        const membership = await committee_of(conn, req.user.id, club_id, { lock: true });
        if (!membership) {
          // Withdraws a pending join request, if any (its committee notifications go with it).
          await conn.query("DELETE FROM club_join_requests WHERE user_id = ? AND club_id = ? AND status = 'pending'", [req.user.id, club_id]);
          return;
        }
        if (membership.role === "president") throw new ApiError("PRESIDENT_TRANSFER_REQUIRED", "Transfer the presidency before leaving the club.");
        if (membership.role === "committee") throw new ApiError("COMMITTEE_MEMBERSHIP_PROTECTED", "Committee members can’t leave here. Ask the president to change your role first.");
        const [blocking] = await conn.query(
          `SELECT 1 FROM participations p JOIN events e ON e.id = p.event_id
           WHERE p.user_id = ? AND e.club_id = ? AND e.visibility = 'members_only' AND e.status = 'published' AND e.start_time > ?
             AND p.status IN ('joined', 'waitlisted', 'pending') LIMIT 1`, [req.user.id, club_id, to_db(clock())]);
        if (blocking.length) throw new ApiError("ACTIVE_MEMBER_REGISTRATIONS", "Withdraw from this club’s members-only events before leaving.");
        await conn.query("DELETE FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
        await conn.query(
          `UPDATE event_join_requests r JOIN events e ON e.id = r.event_id SET r.status = 'withdrawn'
           WHERE r.user_id = ? AND e.club_id = ? AND r.status = 'pending'`, [req.user.id, club_id]);
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "member.left", details: { user_id: req.user.id }, now: clock() });
      });
      res.status(204).end();
    })],
  });

  define_route(router, "/clubs/:club_id/join-requests", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", mine ? "Only the committee can review join requests." : "That club does not exist.");
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM club_join_requests WHERE club_id = ? AND status = 'pending'", [club_id]);
      const [rows] = await pool.query(
        `SELECT r.id, r.requested_at, u.id AS user_id, u.name, u.email, u.student_id FROM club_join_requests r JOIN users u ON u.id = r.user_id
         WHERE r.club_id = ? AND r.status = 'pending' ORDER BY r.requested_at, r.id LIMIT ? OFFSET ?`,
        [club_id, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map((row) => ({ id: row.id, club_id, status: "pending", requested_at: iso(row.requested_at),
        user: { id: row.user_id, name: row.name, email: row.email, student_id: row.student_id } })), meta: page_meta(total, query) });
    })],
  });

  // Committee decision on a club join request. The path matches the legacy
  // route so the inbox's Approve and Reject buttons work on both providers.
  define_route(router, "/clubs/:club_id/join-requests/:request_id/review", {
    post: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const request_id = id_param(req, "request_id");
      const body = validate_body(req.body, REVIEW);
      const now = clock();
      const data = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        const mine = await committee_of(conn, req.user.id, club_id);
        if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", mine ? "Only the committee can review join requests." : "That club does not exist.");
        const [[request]] = await conn.query("SELECT id, user_id, status FROM club_join_requests WHERE id = ? AND club_id = ? FOR UPDATE", [request_id, club_id]);
        if (!request) throw new ApiError("NOT_FOUND", "That join request does not exist.");
        if (request.status !== "pending") throw new ApiError("INVALID_STATE", "Someone has already reviewed this request.");
        const accepted = body.decision === "accept";
        await conn.query("UPDATE club_join_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
          [accepted ? "accepted" : "rejected", req.user.id, to_db(now), request_id]);
        if (accepted && !(await committee_of(conn, request.user_id, club_id, { lock: true }))) {
          await conn.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'member')", [request.user_id, club_id]);
          // member.joined feeds the committee's daily digest.
          await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "member.joined", details: { user_id: request.user_id, request_id }, now });
        }
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: accepted ? "request.accepted" : "request.rejected", details: { user_id: request.user_id, request_id }, now });
        await log_action(conn, { club, actor_id: req.user.id, target_id: request.user_id, type: accepted ? "join_request_accepted" : "join_request_rejected",
          description: `${accepted ? "Accepted" : "Rejected"} a membership request.`, details: { request_id, decision: body.decision } });
        // The other committee members' Approve and Reject buttons would be stale.
        await conn.query("DELETE FROM notifications WHERE club_join_request_id = ?", [request_id]);
        await notify(conn, { users: [request.user_id], type: "club_membership", club_id, now, key: `club-request-decided:${request_id}`,
          title: accepted ? `You’re in: ${club.name}` : `${club.name} declined your request`,
          body: accepted ? "Your join request was approved. Members-only events are open to you now." : "Your join request was not approved." });
        return { id: request_id, club_id, status: accepted ? "accepted" : "rejected" };
      });
      res.json({ data });
    })],
  });

  define_route(router, "/clubs/:club_id/members", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const query = pagination(validate_query(req.query, { ...PAGE_QUERY, role: { kind: "enum", values: ["member", "committee", "president"] } }));
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", mine ? "Only the committee can see members." : "That club does not exist.");
      const role = validate_query(req.query, { ...PAGE_QUERY, role: { kind: "enum", values: ["member", "committee", "president"] } }).role ?? null;
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM memberships WHERE club_id = ? AND (? IS NULL OR role = ?)", [club_id, role, role]);
      const [rows] = await pool.query(
        `SELECT m.user_id, u.name, m.role, m.version, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.club_id = ? AND (? IS NULL OR m.role = ?) ORDER BY FIELD(m.role, 'president', 'committee', 'member'), m.user_id LIMIT ? OFFSET ?`,
        [club_id, role, role, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map((row) => ({ club_id, role: row.role, version: row.version, joined_at: row.joined_at, user: { id: row.user_id, name: row.name } })), meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/clubs/:club_id/members/:user_id", {
    patch: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const target_id = id_param(req, "user_id");
      const body = validate_body(req.body, MEMBER_PATCH);
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        const actor = club && await committee_of(conn, req.user.id, club_id, { lock: true });
        if (!club || !actor) throw new ApiError("NOT_FOUND", "That club does not exist.");
        if (actor.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can change roles.");
        const target = await committee_of(conn, target_id, club_id, { lock: true });
        if (!target) throw new ApiError("NOT_FOUND", "That person is not a member.");
        if (target.role === "president") throw new ApiError("FORBIDDEN", "Transfer the presidency instead.");
        if (Number(target.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This member changed. Refresh and try again.");
        if (target.role !== body.role) {
          await conn.query("UPDATE memberships SET role = ?, version = version + 1 WHERE user_id = ? AND club_id = ?", [body.role, target_id, club_id]);
          const now = clock();
          await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "role.changed", details: { user_id: target_id, from: target.role, to: body.role }, now });
          await log_action(conn, body.role === "committee"
            ? { club, actor_id: req.user.id, target_id, type: "member_promoted", description: "Promoted a regular member to committee." }
            : { club, actor_id: req.user.id, target_id, type: "member_demoted", description: "Demoted a committee member to regular member status." });
          const committee = await committee_ids(conn, club_id);
          await notify(conn, {
            users: [target_id, ...committee], type: "role_changed", club_id, now, exclude: req.user.id,
            key: `role_changed:${club_id}:${target_id}:${Number(target.version) + 1}`,
            title: `Role change in ${club.name}`, body: body.role === "committee" ? "A member joined the committee." : "A committee member returned to member.",
          });
        }
        const [[row]] = await conn.query(
          "SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? AND m.club_id = ?", [target_id, club_id]);
        return membership_dto(row);
      });
      res.json({ data: result });
    })],
    // Committee and president remove a plain member (beta "kick"). Their
    // upcoming members-only places end and pending requests close.
    delete: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const target_id = id_param(req, "user_id");
      const now = clock();
      await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        const actor = club && await committee_of(conn, req.user.id, club_id, { lock: true });
        if (!club || !actor) throw new ApiError("NOT_FOUND", "That club does not exist.");
        if (!is_committee(actor)) throw new ApiError("FORBIDDEN", "Only the committee can remove members.");
        if (target_id === req.user.id) throw new ApiError("INVALID_STATE", "You can’t remove yourself.");
        const target = await committee_of(conn, target_id, club_id, { lock: true });
        if (!target) throw new ApiError("NOT_FOUND", "That person is not a member.");
        if (target.role !== "member") throw new ApiError("FORBIDDEN", "Only plain members can be removed. Ask the president to change their role first.");
        await end_members_only_places(conn, { club_id, user_id: target_id, actor: req.user.id, now, promote_locked });
        await conn.query("DELETE FROM memberships WHERE user_id = ? AND club_id = ?", [target_id, club_id]);
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "member.left", details: { user_id: target_id, removed: true }, now });
        await log_action(conn, { club, actor_id: req.user.id, target_id, type: "member_removed", description: "Removed a regular member from the club." });
        await notify(conn, { users: [target_id], type: "club_membership", club_id, now, key: `removed:${club_id}:${target_id}:${to_db(now)}`,
          title: `You were removed from ${club.name}`, body: "A committee member removed you from the club. Its members-only events are closed to you." });
      });
      res.status(204).end();
    })],
  });

  // A committee member steps down to member (beta "leave committee").
  define_route(router, "/clubs/:club_id/committee", {
    delete: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const now = clock();
      const data = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        const mine = club && await committee_of(conn, req.user.id, club_id, { lock: true });
        if (!club || !mine) throw new ApiError("NOT_FOUND", "That club does not exist.");
        if (mine.role === "president") throw new ApiError("PRESIDENT_TRANSFER_REQUIRED", "Transfer the presidency before leaving the committee.");
        if (mine.role !== "committee") throw new ApiError("INVALID_STATE", "You are not on the committee.");
        await conn.query("UPDATE memberships SET role = 'member', version = version + 1 WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "role.changed", details: { user_id: req.user.id, from: "committee", to: "member", self: true }, now });
        await log_action(conn, { club, actor_id: req.user.id, target_id: req.user.id, type: "committee_left", description: "Left the committee and returned to regular member status." });
        await notify(conn, { users: await committee_ids(conn, club_id), type: "role_changed", club_id, now, exclude: req.user.id,
          key: `committee_left:${club_id}:${req.user.id}:${to_db(now)}`, title: `Role change in ${club.name}`, body: `${req.user.name} left the committee and is now a member.` });
        const [[row]] = await conn.query("SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? AND m.club_id = ?", [req.user.id, club_id]);
        return membership_dto(row);
      });
      res.json({ data });
    })],
  });

  // The president's action log and undo.
  define_route(router, "/clubs/:club_id/actions", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!mine) throw new ApiError("NOT_FOUND", "That club does not exist.");
      if (mine.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can see the club’s action log.");
      const { rows, total } = await list_actions(pool, club_id, query);
      res.json({ data: rows, meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/clubs/:club_id/actions/:action_id/undo", {
    post: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const action_id = id_param(req, "action_id");
      await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        const mine = club && await committee_of(conn, req.user.id, club_id, { lock: true });
        if (!club || !mine) throw new ApiError("NOT_FOUND", "That club does not exist.");
        if (mine.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can undo club actions.");
        await undo_action(conn, { club, action_id, actor_id: req.user.id, now: clock(), committee_ids, promote_locked });
      });
      const { rows } = await list_actions(pool, club_id, { page: 1, page_size: 1 });
      res.json({ data: { undone: action_id, latest: rows[0] ?? null } });
    })],
  });

  define_route(router, "/clubs/:club_id/presidency", {
    post: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const body = validate_body(req.body, PRESIDENCY);
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        // Lock both membership rows in ascending user_id order.
        const ids = [req.user.id, body.to_user_id].sort((a, b) => a - b);
        const [rows] = await conn.query("SELECT user_id, role, version FROM memberships WHERE club_id = ? AND user_id IN (?) ORDER BY user_id FOR UPDATE", [club_id, ids]);
        const mine = rows.find((row) => row.user_id === req.user.id);
        const to = rows.find((row) => row.user_id === body.to_user_id);
        if (!mine) throw new ApiError("NOT_FOUND", "That club does not exist.");
        if (mine.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can transfer the presidency.");
        if (!to) throw new ApiError("NOT_FOUND", "That person is not a member.");
        if (to.user_id === req.user.id || to.role !== "committee") throw new ApiError("INVALID_STATE", "Choose a committee member as the next president.");
        if (Number(to.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This member changed. Refresh and try again.");
        await conn.query("UPDATE memberships SET role = 'committee', version = version + 1 WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
        await conn.query("UPDATE memberships SET role = 'president', version = version + 1 WHERE user_id = ? AND club_id = ?", [to.user_id, club_id]);
        const now = clock();
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "presidency.transferred", details: { from: req.user.id, to: to.user_id }, now });
        await log_action(conn, { club, actor_id: req.user.id, target_id: to.user_id, type: "presidency_transferred",
          description: "Transferred the presidency to another committee member.", details: { previous_president_id: req.user.id, new_president_id: to.user_id } });
        await notify(conn, {
          users: await committee_ids(conn, club_id), type: "role_changed", club_id, now, exclude: req.user.id,
          key: `presidency:${club_id}:${to.user_id}:${Number(to.version) + 1}`, title: `New president of ${club.name}`, body: "The presidency was transferred.",
        });
        const read = async (user_id) => {
          const [[row]] = await conn.query("SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? AND m.club_id = ?", [user_id, club_id]);
          return membership_dto(row);
        };
        return { previous: await read(req.user.id), current: await read(to.user_id) };
      });
      res.json({ data: result });
    })],
  });

  // Venues
  define_route(router, "/venues", {
    get: [require_user, wrap(async (req, res) => {
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM venues");
      const [rows] = await pool.query("SELECT id, name, location, description, capacity, is_active FROM venues ORDER BY id LIMIT ? OFFSET ?", [query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) })), meta: page_meta(total, query) });
    })],
  });

  // Tags
  define_route(router, "/tags", {
    get: [require_user, wrap(async (_req, res) => {
      const [rows] = await pool.query("SELECT id, slug, name FROM campus_tags WHERE retired_at IS NULL ORDER BY name");
      res.json({ data: rows });
    })],
    post: [require_admin, wrap(async (req, res) => {
      const body = validate_body(req.body, CAMPUS_TAG);
      try {
        const [result] = await pool.query("INSERT INTO campus_tags (slug, name) VALUES (?, ?)", [body.slug, body.name]);
        res.status(201).json({ data: { id: result.insertId, slug: body.slug, name: body.name } });
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY") throw new ApiError("VALIDATION_FAILED", "That tag already exists.", { fields: { slug: "Already in use." } });
        throw error;
      }
    })],
  });
  define_route(router, "/tags/:tag_id", {
    patch: [require_admin, wrap(async (req, res) => {
      const tag_id = id_param(req, "tag_id");
      const body = validate_body(req.body, CAMPUS_TAG_PATCH, { at_least_one_of: ["name", "retired"] });
      const [result] = await pool.query(
        "UPDATE campus_tags SET name = COALESCE(?, name), retired_at = CASE WHEN ? IS NULL THEN retired_at WHEN ? THEN COALESCE(retired_at, ?) ELSE NULL END WHERE id = ?",
        [body.name ?? null, body.retired ?? null, body.retired ?? null, to_db(clock()), tag_id]);
      if (!result.affectedRows) throw new ApiError("NOT_FOUND", "That tag does not exist.");
      const [[row]] = await pool.query("SELECT id, slug, name FROM campus_tags WHERE id = ?", [tag_id]);
      res.json({ data: row });
    })],
  });

  define_route(router, "/clubs/:club_id/tags", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const [rows] = await pool.query("SELECT id, name FROM club_tags WHERE club_id = ? ORDER BY name_key", [club_id]);
      res.json({ data: rows });
    })],
    post: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const body = validate_body(req.body, TAG_BODY);
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        const mine = await committee_of(conn, req.user.id, club_id);
        if (!is_committee(mine)) throw new ApiError("FORBIDDEN", "Only the committee can add club tags.");
        const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM club_tags WHERE club_id = ?", [club_id]);
        if (Number(n) >= 30) throw new ApiError("VALIDATION_FAILED", "A club can have at most 30 tags.", { fields: { name: "Too many tags." } });
        try {
          const [insert] = await conn.query("INSERT INTO club_tags (club_id, name) VALUES (?, ?)", [club_id, body.name]);
          const now = clock();
          await notify(conn, { users: await committee_ids(conn, club_id), type: "club_updated", club_id, now, exclude: req.user.id, key: `club_tag:${insert.insertId}`, title: `${club.name} tags changed`, body: `Tag “${body.name}” was added.` });
          return { id: insert.insertId, name: body.name };
        } catch (error) {
          if (error.code === "ER_DUP_ENTRY") throw new ApiError("VALIDATION_FAILED", "That tag already exists.", { fields: { name: "Already in use." } });
          throw error;
        }
      });
      res.status(201).json({ data: result });
    })],
  });
  define_route(router, "/clubs/:club_id/tags/:tag_id", {
    delete: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const tag_id = id_param(req, "tag_id");
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", "Only the committee can remove club tags.");
      await pool.query("DELETE FROM club_tags WHERE id = ? AND club_id = ?", [tag_id, club_id]);
      res.status(204).end();
    })],
  });

  return router;
}

export { WAITING, committee_ids, committee_of, create_clubs_router, is_committee };
