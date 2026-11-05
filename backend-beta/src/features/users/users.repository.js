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
    "SELECT id, name, email, student_id FROM users WHERE id = ?",
    [user_id],
  );
  return user;
}

async function find_user_by_email(email) {
  const [[user]] = await pool.query(
    "SELECT id, name, email, student_id, password_hash FROM users WHERE email = ?",
    [email],
  );
  return user;
}

async function create_user({ name, email, student_id, password_hash }) {
  try {
    const [result] = await pool.query(
      `INSERT INTO users (name, email, student_id, password_hash)
       VALUES (?, ?, ?, ?)`,
      [name, email, student_id, password_hash],
    );
    return { ok: true, user_id: result.insertId };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return {
        ok: false,
        reason: error.message.includes("student_id")
          ? "duplicate_student_id"
          : "duplicate_email",
      };
    }
    throw error;
  }
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

export {
  create_user,
  find_user_by_email,
  find_user_by_id,
  user_exists,
  update_user,
};
