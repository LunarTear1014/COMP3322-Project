import pool from "../../config/db.js";

async function find_user_by_id(user_id) {
  const [[user]] = await pool.query(
    "SELECT id, name, email, student_id FROM users WHERE id = ?",
    [user_id],
  );
  return user;
}

async function find_user_by_id_for_auth(user_id) {
  const [[user]] = await pool.query(
    "SELECT id, name, email, student_id, password_hash FROM users WHERE id = ?",
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

async function update_user_account(
  user_id,
  { name, email, password_hash },
) {
  try {
    await pool.query(
      "UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?",
      [name, email, password_hash, user_id],
    );
    return { ok: true };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return { ok: false, reason: "duplicate_email" };
    }
    throw error;
  }
}

async function delete_user(user_id) {
  const [result] = await pool.query("DELETE FROM users WHERE id = ?", [
    user_id,
  ]);
  return result.affectedRows > 0;
}

export {
  create_user,
  delete_user,
  find_user_by_id_for_auth,
  find_user_by_email,
  find_user_by_id,
  update_user_account,
};
