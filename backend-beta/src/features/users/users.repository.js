import pool from "../../config/db.js";

// Returns whether a user row exists for the given id.
async function user_exists(user_id) {
  const [[row]] = await pool.query("SELECT id FROM users WHERE id = ?", [
    user_id,
  ]);
  return row !== undefined;
}

// Returns the user row { name, email }, or undefined when the id does not exist.
async function find_user_by_id(user_id) {
  const [[user]] = await pool.query(
    "SELECT name, email FROM users WHERE id = ?",
    [user_id],
  );
  return user;
}

// Updates the user row. Returns { ok: true, affected_rows } on success and
// { ok: false, reason: "duplicate_email" } on a unique-key violation on email;
// other database errors are rethrown.
async function update_user(user_id, name, email) {
  try {
    const [result] = await pool.query(
      "UPDATE users SET name = ?, email = ? WHERE id = ?",
      [name, email, user_id],
    );
    return { ok: true, affected_rows: result.affectedRows };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return { ok: false, reason: "duplicate_email" };
    }
    throw error;
  }
}

export { user_exists, find_user_by_id, update_user };
