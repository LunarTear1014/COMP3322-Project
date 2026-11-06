import { randomUUID } from "node:crypto";

export async function audit(connection, actorId, entityType, entityId, action, details = {}) {
  await connection.query(`INSERT INTO audit_logs
    (action_id,actor_user_id,entity_type,entity_id,action,details,created_at)
    VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(6))`,
  [randomUUID(), actorId, entityType, entityId, action, JSON.stringify(details)]);
}
