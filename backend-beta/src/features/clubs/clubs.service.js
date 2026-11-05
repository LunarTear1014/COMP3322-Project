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
  const [[membership]] = await pool.query(
    "SELECT role FROM memberships WHERE user_id = ? AND club_id = ?",
    [user_id, club_id],
  );
  if (membership?.role === "president") {
    return { ok: false, reason: "president_must_transfer" };
  }

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
  if (!["committee", "president"].includes(membership?.role)) {
    return { ok: false, reason: "forbidden" };
  }

  const [members] = await pool.query(
    `SELECT u.id AS user_id, u.name, m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.club_id = ?
     ORDER BY u.name`,
    [club_id],
  );
  return { ok: true, members };
}

async function leave_committee(club_id, user_id) {
  const [result] = await pool.query(
    `UPDATE memberships
     SET role = 'member'
     WHERE club_id = ? AND user_id = ? AND role = 'committee'`,
    [club_id, user_id],
  );
  if (result.affectedRows > 0) {
    return { ok: true };
  }

  const [[club]] = await pool.query("SELECT id FROM clubs WHERE id = ?", [
    club_id,
  ]);
  if (!club) {
    return { ok: false, reason: "not_found" };
  }

  const [[membership]] = await pool.query(
    "SELECT role FROM memberships WHERE club_id = ? AND user_id = ?",
    [club_id, user_id],
  );
  return membership
    ? { ok: false, reason: "not_committee" }
    : { ok: false, reason: "not_a_member" };
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
    if (!["committee", "president"].includes(membership?.role)) {
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
    if (target.role !== "member") {
      await connection.rollback();
      return { ok: false, reason: "already_has_role" };
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

async function demote_club_member(club_id, member_user_id, user_id) {
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
    if (membership?.role !== "president") {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }
    if (member_user_id === user_id) {
      await connection.rollback();
      return { ok: false, reason: "cannot_demote_self" };
    }

    const [[target]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [member_user_id, club_id],
    );
    if (!target) {
      await connection.rollback();
      return { ok: false, reason: "not_a_member" };
    }
    if (target.role !== "committee") {
      await connection.rollback();
      return { ok: false, reason: "not_committee" };
    }

    await connection.query(
      "UPDATE memberships SET role = 'member' WHERE user_id = ? AND club_id = ?",
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

async function create_club({ name, description }, user_id) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.query(
      "INSERT INTO clubs (name, description) VALUES (?, ?)",
      [name.trim(), description.trim() || null],
    );
    await connection.query(
      "INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'president')",
      [user_id, result.insertId],
    );
    await connection.commit();
    return {
      ok: true,
      club: {
        id: result.insertId,
        name: name.trim(),
        description: description.trim() || null,
        is_member: true,
        role: "president",
      },
    };
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      return { ok: false, reason: "duplicate_name" };
    }
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function transfer_presidency(club_id, target_user_id, user_id, confirmation) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[club]] = await connection.query(
      "SELECT id, name FROM clubs WHERE id = ? FOR UPDATE",
      [club_id],
    );
    if (!club) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }
    if (confirmation !== club.name) {
      await connection.rollback();
      return { ok: false, reason: "confirmation_mismatch" };
    }
    const [[president]] = await connection.query(
      "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
      [club_id, user_id],
    );
    if (president?.role !== "president") {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }
    if (target_user_id === user_id) {
      await connection.rollback();
      return { ok: false, reason: "cannot_transfer_to_self" };
    }
    const [[target]] = await connection.query(
      "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
      [club_id, target_user_id],
    );
    if (!target || target.role !== "committee") {
      await connection.rollback();
      return { ok: false, reason: "target_not_committee" };
    }

    await connection.query(
      "UPDATE memberships SET role = 'committee' WHERE club_id = ? AND user_id = ?",
      [club_id, user_id],
    );
    await connection.query(
      "UPDATE memberships SET role = 'president' WHERE club_id = ? AND user_id = ?",
      [club_id, target_user_id],
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

async function delete_club(club_id, user_id, confirmation) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[club]] = await connection.query(
      "SELECT id, name FROM clubs WHERE id = ? FOR UPDATE",
      [club_id],
    );
    if (!club) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }
    if (confirmation !== club.name) {
      await connection.rollback();
      return { ok: false, reason: "confirmation_mismatch" };
    }
    const [[membership]] = await connection.query(
      "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
      [club_id, user_id],
    );
    if (membership?.role !== "president") {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }

    await connection.query("DELETE FROM events WHERE club_id = ?", [club_id]);
    await connection.query("DELETE FROM bookings WHERE club_id = ?", [club_id]);
    await connection.query("DELETE FROM memberships WHERE club_id = ?", [
      club_id,
    ]);
    await connection.query("DELETE FROM clubs WHERE id = ?", [club_id]);
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
  demote_club_member,
  leave_committee,
  create_club,
  transfer_presidency,
  delete_club,
};
