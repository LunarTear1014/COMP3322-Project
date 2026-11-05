import pool from "../../config/db.js";

const demo_user_id = Number(process.env.DEMO_USER_ID || 1);

async function list_clubs() {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.description,
      m.user_id IS NOT NULL AS is_member, m.role
     FROM clubs c
     LEFT JOIN memberships m
       ON m.club_id = c.id AND m.user_id = ?
     ORDER BY c.name`,
    [demo_user_id],
  );
  return rows.map((club) => ({
    ...club,
    is_member: Boolean(club.is_member),
  }));
}

async function list_memberships() {
  const [rows] = await pool.query(
    `SELECT c.id AS club_id, c.name, c.description, m.role, m.joined_at
     FROM memberships m
     JOIN clubs c ON c.id = m.club_id
     WHERE m.user_id = ?
     ORDER BY c.name`,
    [demo_user_id],
  );
  return rows;
}

async function join_club(club_id) {
  const [[club]] = await pool.query(
    "SELECT id, name FROM clubs WHERE id = ?",
    [club_id],
  );
  if (!club) {
    return { ok: false, reason: "not_found" };
  }

  try {
    await pool.query(
      "INSERT INTO memberships (user_id, club_id) VALUES (?, ?)",
      [demo_user_id, club_id],
    );
    return {
      ok: true,
      membership: {
        club_id: club.id,
        name: club.name,
        role: "member",
      },
    };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return { ok: false, reason: "already_member" };
    }
    throw error;
  }
}

async function leave_club(club_id) {
  const [result] = await pool.query(
    "DELETE FROM memberships WHERE user_id = ? AND club_id = ?",
    [demo_user_id, club_id],
  );
  if (result.affectedRows > 0) {
    return { ok: true };
  }

  const [[club]] = await pool.query("SELECT id FROM clubs WHERE id = ?", [
    club_id,
  ]);
  return club
    ? { ok: false, reason: "not_a_member" }
    : { ok: false, reason: "not_found" };
}

export { join_club, leave_club, list_clubs, list_memberships };
