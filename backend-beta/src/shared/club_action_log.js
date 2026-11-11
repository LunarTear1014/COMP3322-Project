export async function record_club_action(connection, {
  club_id,
  club_name,
  actor_user_id,
  action_type,
  description,
  target_user_id = null,
  undoable = false,
  details = {},
}) {
  const [[actor]] = await connection.query(
    "SELECT name FROM users WHERE id = ?",
    [actor_user_id],
  );
  let target = null;
  if (target_user_id !== null) {
    [[target]] = await connection.query(
      "SELECT name FROM users WHERE id = ?",
      [target_user_id],
    );
  }
  const [result] = await connection.query(
    `INSERT INTO club_action_log
      (club_id, club_name, actor_user_id, actor_name, target_user_id,
       target_name, action_type, description, undoable, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      club_id,
      club_name,
      actor_user_id,
      actor?.name || "Unknown user",
      target_user_id,
      target?.name || null,
      action_type,
      description,
      undoable,
      JSON.stringify(details),
    ],
  );
  return result.insertId;
}

export function parse_action_details(value) {
  return typeof value === "string" ? JSON.parse(value) : value || {};
}
