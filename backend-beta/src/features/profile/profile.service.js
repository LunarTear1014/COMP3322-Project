import pool from "../../config/db.js";

// The demo user is used until the login feature supplies an authenticated user id.
const demo_user_id = Number(process.env.DEMO_USER_ID || 1);

// Returns the profile row, or null when the demo user does not exist.
async function get_profile() {
  const [[profile]] = await pool.query(
    "SELECT name, email FROM users WHERE id = ?",
    [demo_user_id],
  );
  return profile ?? null;
}

// Returns { ok: true, profile }, { ok: false, reason: "not_found" }, or
// { ok: false, reason: "duplicate_email" }. Other database errors are rethrown.
async function update_profile(name, email) {
  try {
    const [result] = await pool.query(
      "UPDATE users SET name = ?, email = ? WHERE id = ?",
      [name.trim(), email.trim(), demo_user_id],
    );
    if (result.affectedRows === 0) {
      return { ok: false, reason: "not_found" };
    }
    return { ok: true, profile: { name: name.trim(), email: email.trim() } };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return { ok: false, reason: "duplicate_email" };
    }
    throw error;
  }
}

export { get_profile, update_profile };
