import pool from "../../config/db.js";

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

export {
  create_user,
  find_user_by_email,
  find_user_by_id,
};
