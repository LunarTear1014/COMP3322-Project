import { randomUUID } from "node:crypto";

export async function recordParticipation(connection, { eventId, userId, actorId, action, fromStatus, toStatus, reason = null }) {
  await connection.query(`INSERT INTO participation_history
    (event_id,user_id,actor_user_id,action_id,action,from_status,to_status,reason,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`,
  [eventId, userId, actorId, randomUUID(), action, fromStatus ?? null, toStatus, reason]);
}

export async function recordCancellation(connection, eventId, actorId) {
  await connection.query(`INSERT INTO participation_history
    (event_id,user_id,actor_user_id,action_id,action,from_status,to_status,occurred_at)
    SELECT event_id,user_id,?,?,'cancelled',status,'cancelled',UTC_TIMESTAMP(6)
    FROM participations WHERE event_id=? AND status IN ('joined','waitlisted')`,
  [actorId, randomUUID(), eventId]);
}
