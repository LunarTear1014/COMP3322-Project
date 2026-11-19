import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { PAGE_QUERY, pagination, validate_body, validate_query } from "../shared/validate.js";
import { define_route } from "./router.js";
import { end_members_only_places, log_action } from "./club_actions.js";
import { promote_locked } from "./registration.js";
import { audit, id_param, iso, notify, page_meta, require_user, to_db, wrap } from "./common.js";

// A committee member's request to remove a plain member needs the president's
// sign-off. The president removes immediately. Both paths share remove_member.
//
// Request statuses: pending -> approved | rejected | withdrawn | void.
//  - approved: the member was removed, by the president's decision, or by the
//    president removing the member directly while a request was open.
//  - void: the president approved but the member had already left or was
//    promoted, so the removal could not go ahead.

const STATUSES = ["pending", "approved", "rejected", "withdrawn", "void"];
const REASON = { kind: "string", min: 1, max: 500 };
const CREATE = { reason: REASON };
const DECISION = { decision: { kind: "enum", values: ["approve", "reject"], required: true }, reason: REASON, expected_version: { kind: "int", min: 1, required: true } };
const LIST_QUERY = { ...PAGE_QUERY, status: { kind: "enum", values: STATUSES } };

async function role_of(db, user_id, club_id, { lock = false } = {}) {
  const [rows] = await db.query(`SELECT role, version FROM memberships WHERE user_id = ? AND club_id = ?${lock ? " FOR UPDATE" : ""}`, [user_id, club_id]);
  return rows[0] || null;
}

async function president_ids(db, club_id) {
  const [rows] = await db.query("SELECT user_id FROM memberships WHERE club_id = ? AND role = 'president'", [club_id]);
  return rows.map((row) => row.user_id);
}

const request_dto = (row) => ({
  id: row.id, club_id: row.club_id, status: row.status, version: Number(row.version), reason: row.reason ?? null,
  created_at: iso(row.created_at), decided_at: iso(row.decided_at), decision_reason: row.decision_reason ?? null,
  user: { id: row.user_id, name: row.user_name },
  requested_by: row.requested_by ? { id: row.requested_by, name: row.requester_name } : null,
  decided_by: row.decided_by ? { id: row.decided_by, name: row.decider_name } : null,
});

const SELECT = `SELECT r.*, u.name AS user_name, q.name AS requester_name, d.name AS decider_name
  FROM member_removal_requests r JOIN users u ON u.id = r.user_id
  LEFT JOIN users q ON q.id = r.requested_by LEFT JOIN users d ON d.id = r.decided_by`;

async function load_request(db, id, { lock = false } = {}) {
  const [[row]] = await db.query(`${SELECT} WHERE r.id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return row ? request_dto(row) : null;
}

// The president's actionable inbox items go once a request is decided.
const clear_request_notifications = (conn, request_id) => conn.query("DELETE FROM notifications WHERE member_removal_request_id = ?", [request_id]);

// The removal itself, for a locked plain member. The caller has checked the target.
async function remove_member(conn, { club, target_id, actor_id, now, request = null }) {
  await end_members_only_places(conn, { club_id: club.id, user_id: target_id, actor: actor_id, now, promote_locked });
  await conn.query("DELETE FROM memberships WHERE user_id = ? AND club_id = ?", [target_id, club.id]);
  await audit(conn, { actor: actor_id, entity_type: "membership", entity_id: club.id, action: "member.left", details: { user_id: target_id, removed: true, request_id: request?.id ?? null }, now });
  const requester = request?.requested_by;
  await log_action(conn, { club, actor_id, target_id, type: "member_removed",
    description: requester && requester.id !== actor_id
      ? `Removed a regular member from the club, as requested by ${requester.name}.` : "Removed a regular member from the club.",
    details: request ? { request_id: request.id, requested_by: requester?.id ?? null } : {} });
  await notify(conn, { users: [target_id], type: "club_membership", club_id: club.id, now, key: `removed:${club.id}:${target_id}:${to_db(now)}`,
    title: `You were removed from ${club.name}`, body: "A committee member removed you from the club. Its members-only events are closed to you." });
}

// Closes the open request for a member the president removed directly.
async function approve_open_request(conn, { club, target_id, president, now }) {
  const [[open]] = await conn.query("SELECT id FROM member_removal_requests WHERE club_id = ? AND user_id = ? AND status = 'pending' FOR UPDATE", [club.id, target_id]);
  if (!open) return null;
  await conn.query("UPDATE member_removal_requests SET status = 'approved', decided_by = ?, decided_at = ?, version = version + 1 WHERE id = ?", [president.id, to_db(now), open.id]);
  return open.id;
}

async function notify_requester(conn, { club, request, president, now, approved, reason = null }) {
  if (!request.requested_by) return;
  await notify(conn, { users: [request.requested_by.id], type: "member_removal_decided", club_id: club.id, now, exclude: president.id,
    key: `removal-decided:${request.id}`,
    title: approved ? `Removal approved: ${club.name}` : `Removal not approved: ${club.name}`,
    body: approved ? `${president.name} approved removing ${request.user.name}.`
      : `${president.name} did not approve removing ${request.user.name}.${reason ? ` Reason: ${reason}` : ""}` });
}

async function lock_club(conn, club_id, user_id) {
  const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
  const actor = club && await role_of(conn, user_id, club_id, { lock: true });
  if (!club || !actor) throw new ApiError("NOT_FOUND", "That club does not exist.");
  return { club, actor };
}
const committee_only = (actor, text) => { if (!["committee", "president"].includes(actor.role)) throw new ApiError("FORBIDDEN", text); };


// DELETE /clubs/:club_id/members/:user_id, registered by the members route in clubs.js.
function member_delete_handlers({ pool, clock }) {
  // Committee ask for a removal (202, pending the president). The president removes at once (204).
  return [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const target_id = id_param(req, "user_id");
      const body = validate_body(req.body ?? {}, CREATE);
      const now = clock();
      const result = await with_transaction(pool, async (conn) => {
        const { club, actor } = await lock_club(conn, club_id, req.user.id);
        committee_only(actor, "Only the committee can remove members.");
        if (target_id === req.user.id) throw new ApiError("INVALID_STATE", "You can’t remove yourself.");
        const target = await role_of(conn, target_id, club_id, { lock: true });
        if (!target) throw new ApiError("NOT_FOUND", "That person is not a member.");
        if (target.role !== "member") throw new ApiError("FORBIDDEN", "Only plain members can be removed. Ask the president to change their role first.");
        if (actor.role === "president") {
          const request_id = await approve_open_request(conn, { club, target_id, president: req.user, now });
          const request = request_id ? await load_request(conn, request_id) : null;
          await remove_member(conn, { club, target_id, actor_id: req.user.id, now, request });
          if (request) {
            await clear_request_notifications(conn, request_id);
            await notify_requester(conn, { club, request, president: req.user, now, approved: true });
          }
          return null;
        }
        const [[open]] = await conn.query("SELECT id FROM member_removal_requests WHERE club_id = ? AND user_id = ? AND status = 'pending' FOR UPDATE", [club_id, target_id]);
        if (open) return load_request(conn, open.id);
        const [insert] = await conn.query(
          "INSERT INTO member_removal_requests (club_id, user_id, requested_by, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
          [club_id, target_id, req.user.id, body.reason ?? null, to_db(now)]);
        const request = await load_request(conn, insert.insertId);
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "removal.requested", details: { user_id: target_id, request_id: request.id }, now });
        await log_action(conn, { club, actor_id: req.user.id, target_id, type: "removal_requested", description: "Asked the president to remove a regular member.",
          details: { request_id: request.id, reason: body.reason ?? null } });
        await notify(conn, { users: await president_ids(conn, club_id), type: "member_removal_request", club_id, member_removal_request_id: request.id, now,
          key: `removal-request:${request.id}`, title: `Removal request: ${club.name}`, body: `${req.user.name} asked to remove ${request.user.name}.` });
        return request;
      });
      if (!result) return res.status(204).end();
      res.status(202).json({ data: result });
    })];
}

function register_removal_routes(router, { pool, clock }) {
  define_route(router, "/clubs/:club_id/removal-requests", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const query = pagination(validate_query(req.query, LIST_QUERY));
      const status = validate_query(req.query, LIST_QUERY).status ?? "pending";
      const mine = await role_of(pool, req.user.id, club_id);
      if (!mine) throw new ApiError("NOT_FOUND", "That club does not exist.");
      committee_only(mine, "Only the committee can see removal requests.");
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM member_removal_requests WHERE club_id = ? AND status = ?", [club_id, status]);
      const [rows] = await pool.query(`${SELECT} WHERE r.club_id = ? AND r.status = ? ORDER BY r.created_at, r.id LIMIT ? OFFSET ?`,
        [club_id, status, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map(request_dto), meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/clubs/:club_id/removal-requests/:request_id/decision", {
    post: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const request_id = id_param(req, "request_id");
      const body = validate_body(req.body, DECISION);
      if (body.decision === "reject" && !body.reason) throw new ApiError("VALIDATION_FAILED", "Say why you are not approving this.", { fields: { reason: "A reason is required to reject." } });
      const now = clock();
      const outcome = await with_transaction(pool, async (conn) => {
        const { club, actor } = await lock_club(conn, club_id, req.user.id);
        if (actor.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can decide removal requests.");
        const request = await load_request(conn, request_id, { lock: true });
        if (!request || request.club_id !== club_id) throw new ApiError("NOT_FOUND", "That removal request does not exist.");
        if (request.status !== "pending") throw new ApiError("INVALID_STATE", "This request has already been decided.");
        if (request.version !== body.expected_version) throw new ApiError("STALE_VERSION", "This request changed. Refresh and try again.");
        const decide = (status, reason) => conn.query(
          "UPDATE member_removal_requests SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, version = version + 1 WHERE id = ?",
          [status, req.user.id, to_db(now), reason ?? null, request_id]);
        if (body.decision === "reject") {
          await decide("rejected", body.reason);
          await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "removal.rejected", details: { user_id: request.user.id, request_id }, now });
          await log_action(conn, { club, actor_id: req.user.id, target_id: request.user.id, type: "removal_rejected",
            description: `Did not approve a removal request${request.requested_by ? ` from ${request.requested_by.name}` : ""}.`, details: { request_id, reason: body.reason } });
          await clear_request_notifications(conn, request_id);
          await notify_requester(conn, { club, request, president: req.user, now, approved: false, reason: body.reason });
          return { request_id };
        }
        const target = await role_of(conn, request.user.id, club_id, { lock: true });
        if (!target || target.role !== "member") {
          // The member left, or was promoted, since the request. Either way it can't
          // go ahead (only plain members are removed), so it closes for good (void).
          await decide("void", target ? "The member is no longer a plain member." : "The member had already left the club.");
          await clear_request_notifications(conn, request_id);
          return { stale: target ? "That person is no longer a plain member, so they can’t be removed. The request is closed." : "That person has already left the club. The request is closed." };
        }
        await decide("approved", body.reason);
        await remove_member(conn, { club, target_id: request.user.id, actor_id: req.user.id, now, request });
        await clear_request_notifications(conn, request_id);
        await notify_requester(conn, { club, request, president: req.user, now, approved: true });
        return { request_id };
      });
      // The void mark must commit, so the error is raised after the transaction.
      if (outcome.stale) throw new ApiError("INVALID_STATE", outcome.stale);
      res.json({ data: await load_request(pool, outcome.request_id) });
    })],
  });

  define_route(router, "/clubs/:club_id/removal-requests/:request_id", {
    // The requester (or the president) withdraws a pending request.
    delete: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const request_id = id_param(req, "request_id");
      const now = clock();
      const data = await with_transaction(pool, async (conn) => {
        const { club, actor } = await lock_club(conn, club_id, req.user.id);
        committee_only(actor, "Only the committee can withdraw removal requests.");
        const request = await load_request(conn, request_id, { lock: true });
        if (!request || request.club_id !== club_id) throw new ApiError("NOT_FOUND", "That removal request does not exist.");
        if (actor.role !== "president" && request.requested_by?.id !== req.user.id) throw new ApiError("FORBIDDEN", "Only the person who asked can withdraw this request.");
        if (request.status !== "pending") throw new ApiError("INVALID_STATE", "This request has already been decided.");
        await conn.query("UPDATE member_removal_requests SET status = 'withdrawn', decided_by = ?, decided_at = ?, version = version + 1 WHERE id = ?", [req.user.id, to_db(now), request_id]);
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "removal.withdrawn", details: { user_id: request.user.id, request_id }, now });
        await log_action(conn, { club, actor_id: req.user.id, target_id: request.user.id, type: "removal_withdrawn", description: "Withdrew a removal request.", details: { request_id } });
        await clear_request_notifications(conn, request_id);
        return load_request(conn, request_id);
      });
      res.json({ data });
    })],
  });
}

export { member_delete_handlers, register_removal_routes };
