import pool from "../../config/db.js";

const demo_user_id = Number(process.env.DEMO_USER_ID || 1);

async function list_clubs(user_id = demo_user_id) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.description,
      m.user_id IS NOT NULL AS is_member, m.role
     FROM clubs c
     LEFT JOIN memberships m
       ON m.club_id = c.id AND m.user_id = ?
     ORDER BY c.name`,
    [user_id],
  );
  return rows.map((club) => ({
    ...club,
    is_member: Boolean(club.is_member),
  }));
}

async function list_memberships(user_id = demo_user_id) {
  const [rows] = await pool.query(
    `SELECT c.id AS club_id, c.name, c.description, m.role, m.joined_at
     FROM memberships m
     JOIN clubs c ON c.id = m.club_id
     WHERE m.user_id = ?
     ORDER BY c.name`,
    [user_id],
  );
  return rows;
}

async function join_club(club_id, user_id = demo_user_id) {
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
      [user_id, club_id],
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

async function leave_club(club_id, user_id = demo_user_id) {
  const [result] = await pool.query(
    "DELETE FROM memberships WHERE user_id = ? AND club_id = ?",
    [user_id, club_id],
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

async function list_club_members(club_id, user_id) {
  const [[club]] = await pool.query("SELECT id FROM clubs WHERE id = ?", [
    club_id,
  ]);
  if (!club) {
    return { ok: false, reason: "not_found" };
  }

  const [[membership]] = await pool.query(
    "SELECT role FROM memberships WHERE user_id = ? AND club_id = ?",
    [user_id, club_id],
  );
  if (membership?.role !== "committee") {
    return { ok: false, reason: "forbidden" };
  }

  const [members] = await pool.query(
    `SELECT u.id AS user_id, u.name, m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.club_id = ? AND m.user_id <> ?
     ORDER BY u.name`,
    [club_id, user_id],
  );
  return { ok: true, members };
}

async function promote_club_member(club_id, member_user_id, user_id) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[club]] = await connection.query(
      "SELECT id FROM clubs WHERE id = ? FOR UPDATE",
      [club_id],
    );
    if (!club) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }

    const [[membership]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [user_id, club_id],
    );
    if (membership?.role !== "committee") {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }
    if (member_user_id === user_id) {
      await connection.rollback();
      return { ok: false, reason: "cannot_promote_self" };
    }

    const [[target]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [member_user_id, club_id],
    );
    if (!target) {
      await connection.rollback();
      return { ok: false, reason: "not_a_member" };
    }
    if (target.role === "committee") {
      await connection.rollback();
      return { ok: false, reason: "already_committee" };
    }

    await connection.query(
      "UPDATE memberships SET role = 'committee' WHERE user_id = ? AND club_id = ?",
      [member_user_id, club_id],
    );
    await connection.commit();
    return { ok: true };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

export {
  join_club,
  leave_club,
  list_clubs,
  list_memberships,
  list_club_members,
  promote_club_member,
};
