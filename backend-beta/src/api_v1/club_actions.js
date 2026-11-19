import { randomUUID } from "node:crypto";
import { ApiError } from "../shared/errors.js";
import { parse_action_details, record_club_action } from "../shared/club_action_log.js";
import { audit, notify, signal, to_db } from "./common.js";

// The president's club action log (club_action_log, from the beta) on v1.
// v1 role, membership and join-request actions write the same rows the
// legacy routes wrote, so one log and one undo cover both. Undo is a port of
// the legacy undo_club_action onto a v1 transaction, with three fixes: the
// presidency check passed its parameters in the wrong order, role changes now
// bump memberships.version, and notifications carry a type.

const UNDOABLE = new Set([
  "join_request_accepted", "join_request_rejected", "member_promoted", "member_demoted",
  "member_removed", "committee_left", "presidency_transferred",
]);

async function log_action(conn, { club, actor_id, target_id = null, type, description, details = {} }) {
  return record_club_action(conn, {
    club_id: club.id, club_name: club.name, actor_user_id: actor_id, target_user_id: target_id,
    action_type: type, description, undoable: UNDOABLE.has(type), details,
  });
}

const action_dto = (row) => ({
  id: Number(row.id),
  type: row.action_type,
  description: row.description,
  actor: { id: row.actor_user_id, name: row.actor_name },
  target: row.target_user_id ? { id: row.target_user_id, name: row.target_name } : null,
  undoable: Boolean(row.undoable) && !row.undone_at,
  created_at: new Date(Number(row.created_epoch) * 1000).toISOString(),
  undone_at: row.undone_epoch ? new Date(Number(row.undone_epoch) * 1000).toISOString() : null,
});

async function list_actions(db, club_id, { page, page_size }, { can_undo = true } = {}) {
  const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM club_action_log WHERE club_id = ?", [club_id]);
  const [rows] = await db.query(
    `SELECT id, actor_user_id, actor_name, target_user_id, target_name, action_type, description, undoable, details,
       UNIX_TIMESTAMP(created_at) AS created_epoch, undone_at, UNIX_TIMESTAMP(undone_at) AS undone_epoch
     FROM club_action_log WHERE club_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [club_id, page_size, (page - 1) * page_size]);
  // Offer Undo only while no later row touched the same members (see undo_action).
  const oldest = rows.length ? Math.min(...rows.map((row) => Number(row.id))) : 0;
  const [newer] = rows.length
    ? await db.query("SELECT id, target_user_id, details FROM club_action_log WHERE club_id = ? AND id > ? ORDER BY id", [club_id, oldest])
    : [[]];
  const superseded = (row) => {
    const mine = new Set(touched_users(row));
    return newer.some((later) => Number(later.id) > Number(row.id) && touched_users(later).some((id) => mine.has(id)));
  };
  return { rows: rows.map((row) => ({ ...action_dto(row), undoable: can_undo && action_dto(row).undoable && !superseded(row) })), total: Number(total) };
}

const changed = () => new ApiError("INVALID_STATE", "Things changed since this action, so it can’t be undone safely.");

// Everyone whose role or membership a log row touched. A presidency transfer
// touches both presidents, but only the new one is its target_user_id, and an
// undo row lists the members it rewound in details.affected_user_ids.
function touched_users(row) {
  const details = parse_action_details(row.details);
  return [row.target_user_id, details.previous_president_id, details.new_president_id, ...(details.affected_user_ids ?? [])]
    .filter((id) => id != null).map(Number);
}

// Any later row that touched one of `affected`, including an undo of a later
// action, means the state this action produced has been superseded.
async function later_action_for(conn, club_id, action_id, affected) {
  const [rows] = await conn.query(
    "SELECT id, target_user_id, details FROM club_action_log WHERE club_id = ? AND id > ? ORDER BY id", [club_id, action_id]);
  const wanted = new Set(affected.map(Number));
  return rows.find((row) => touched_users(row).some((id) => wanted.has(id))) ?? null;
}

async function set_role(conn, club_id, user_id, role) {
  await conn.query("UPDATE memberships SET role = ?, version = version + 1 WHERE club_id = ? AND user_id = ?", [role, club_id, user_id]);
}

// Students who lose membership keep no members-only place: upcoming
// registrations end (with history and promotion) and pending requests close.
async function end_members_only_places(conn, { club_id, user_id, actor, now, promote_locked }) {
  const action_id = randomUUID();
  const [events] = await conn.query(
    `SELECT e.* FROM participations p JOIN events e ON e.id = p.event_id
     WHERE p.user_id = ? AND e.club_id = ? AND e.visibility = 'members_only' AND e.status = 'published' AND e.start_time > ?
       AND p.status IN ('joined', 'waitlisted', 'pending') ORDER BY e.id FOR UPDATE`, [user_id, club_id, to_db(now)]);
  for (const event of events) {
    const [[mine]] = await conn.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ? FOR UPDATE", [event.id, user_id]);
    const from = mine.status === "joined" ? "joined" : "waitlisted";
    await conn.query("UPDATE participations SET status = 'left', left_at = ? WHERE event_id = ? AND user_id = ?", [to_db(now), event.id, user_id]);
    await conn.query(
      `INSERT INTO participation_history (event_id, user_id, actor_user_id, action_id, action, from_status, to_status, reason, occurred_at)
       VALUES (?, ?, ?, ?, 'left', ?, 'left', 'membership_removed', ?)`, [event.id, user_id, actor, action_id, from, to_db(now)]);
    await signal(conn, { event_id: event.id, club_id, now });
    if (from === "joined" && new Date(`${event.registration_closes_at.replace(" ", "T")}Z`) > now) {
      for (const promoted of await promote_locked(conn, event, { actor, now, action_id })) {
        await notify(conn, { users: [promoted], type: "registration_changed", event_id: event.id, club_id, now, key: `registration:${action_id}`,
          title: `You got a seat: ${event.title}`, body: "A place opened up and you moved off the waitlist." });
      }
    }
  }
  await conn.query(
    `UPDATE event_join_requests r JOIN events e ON e.id = r.event_id SET r.status = 'withdrawn'
     WHERE r.user_id = ? AND e.club_id = ? AND r.status = 'pending'`, [user_id, club_id]);
  return events.length;
}

async function undo_action(conn, { club, action_id, actor_id, now, committee_ids, promote_locked }) {
  const [[action]] = await conn.query("SELECT * FROM club_action_log WHERE id = ? AND club_id = ? FOR UPDATE", [action_id, club.id]);
  if (!action) throw new ApiError("NOT_FOUND", "That action does not exist.");
  if (!action.undoable || action.undone_at) throw new ApiError("INVALID_STATE", "This action can’t be undone.");
  const details = parse_action_details(action.details);
  const affected = action.action_type === "presidency_transferred"
    ? [details.previous_president_id, details.new_president_id] : [action.target_user_id];
  if (await later_action_for(conn, club.id, action.id, affected)) {
    throw new ApiError("INVALID_STATE", "A later action affects this member, so this one can no longer be undone.");
  }
  const role_of = async (user_id) => {
    const [[row]] = await conn.query("SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE", [club.id, user_id]);
    return row?.role ?? null;
  };

  switch (action.action_type) {
    case "join_request_accepted":
    case "join_request_rejected": {
      const [[request]] = await conn.query("SELECT id, status FROM club_join_requests WHERE id = ? AND club_id = ? AND user_id = ? FOR UPDATE",
        [details.request_id, club.id, action.target_user_id]);
      const expected = action.action_type === "join_request_accepted" ? "accepted" : "rejected";
      if (!request || request.status !== expected) throw changed();
      if (expected === "accepted") {
        if ((await role_of(action.target_user_id)) !== "member") throw changed();
        await end_members_only_places(conn, { club_id: club.id, user_id: action.target_user_id, actor: actor_id, now, promote_locked });
        await conn.query("DELETE FROM memberships WHERE club_id = ? AND user_id = ?", [club.id, action.target_user_id]);
      }
      const [[other]] = await conn.query("SELECT id FROM club_join_requests WHERE club_id = ? AND user_id = ? AND status = 'pending' AND id <> ? LIMIT 1",
        [club.id, action.target_user_id, request.id]);
      if (other) throw changed();
      await conn.query("UPDATE club_join_requests SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?", [request.id]);
      await notify(conn, { users: await committee_ids(conn, club.id), type: "club_join_request", club_id: club.id, club_join_request_id: request.id, now,
        key: `club-request-reopened:${request.id}:${action.id}`, title: `Join request: ${club.name}`,
        body: `${action.target_name || "A student"} has a membership request pending again.` });
      break;
    }
    case "member_promoted":
      if ((await role_of(action.target_user_id)) !== "committee") throw changed();
      await set_role(conn, club.id, action.target_user_id, "member");
      break;
    case "member_demoted":
    case "committee_left":
      if ((await role_of(action.target_user_id)) !== "member") throw changed();
      await set_role(conn, club.id, action.target_user_id, "committee");
      break;
    case "member_removed":
      if ((await role_of(action.target_user_id)) !== null) throw changed();
      await conn.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'member')", [action.target_user_id, club.id]);
      break;
    case "presidency_transferred": {
      const ids = [details.previous_president_id, details.new_president_id].sort((a, b) => a - b);
      await conn.query("SELECT user_id FROM memberships WHERE club_id = ? AND user_id IN (?) ORDER BY user_id FOR UPDATE", [club.id, ids]);
      if ((await role_of(details.previous_president_id)) !== "committee" || (await role_of(details.new_president_id)) !== "president") throw changed();
      // Demote first: the unique president index allows one president per club.
      await set_role(conn, club.id, details.new_president_id, "committee");
      await set_role(conn, club.id, details.previous_president_id, "president");
      break;
    }
    default:
      throw new ApiError("INVALID_STATE", "This action can’t be undone.");
  }

  await notify(conn, { users: affected, type: "role_changed", club_id: club.id, now, key: `undo:${action.id}`,
    title: `Club action undone: ${club.name}`, body: `An action affecting your role or membership in ${club.name} was undone by the president.` });
  await conn.query("UPDATE club_action_log SET undone_at = CURRENT_TIMESTAMP, undone_by = ? WHERE id = ?", [actor_id, action.id]);
  await log_action(conn, { club, actor_id, target_id: action.target_user_id, type: "action_undone", description: `Undid action #${action.id}: ${action.description}`,
    details: { undone_action_id: Number(action.id), affected_user_ids: affected.map(Number) } });
  await audit(conn, { actor: actor_id, entity_type: "membership", entity_id: club.id, action: "action.undone", details: { action_id: action.id, type: action.action_type }, now });
}

export { end_members_only_places, list_actions, log_action, undo_action };
