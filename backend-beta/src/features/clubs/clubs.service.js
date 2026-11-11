import pool from "../../config/db.js";
import {
  parse_action_details,
  record_club_action,
} from "../../shared/club_action_log.js";

async function list_clubs(user_id = null) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.description,
      m.user_id IS NOT NULL AS is_member, m.role,
      (SELECT r.status
       FROM club_join_requests r
       WHERE r.club_id = c.id AND r.user_id = ?
       ORDER BY r.requested_at DESC, r.id DESC
       LIMIT 1) AS request_status,
      CASE WHEN m.role IN ('committee', 'president') THEN
        (SELECT COUNT(*) FROM club_join_requests pending
         WHERE pending.club_id = c.id AND pending.status = 'pending')
      ELSE 0 END AS pending_request_count
     FROM clubs c
     LEFT JOIN memberships m
       ON m.club_id = c.id AND m.user_id = ?
     ORDER BY c.name`,
    [user_id, user_id],
  );
  return rows.map((club) => ({
    ...club,
    is_member: Boolean(club.is_member),
  }));
}

async function list_memberships(user_id = null) {
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

async function join_club(club_id, user_id) {
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

    const [[membership]] = await connection.query(
      "SELECT user_id FROM memberships WHERE user_id = ? AND club_id = ?",
      [user_id, club_id],
    );
    if (membership) {
      await connection.rollback();
      return { ok: false, reason: "already_member" };
    }

    const [[pending_request]] = await connection.query(
      `SELECT id FROM club_join_requests
       WHERE user_id = ? AND club_id = ? AND status = 'pending'
       LIMIT 1`,
      [user_id, club_id],
    );
    if (pending_request) {
      await connection.rollback();
      return { ok: false, reason: "already_pending" };
    }

    const [result] = await connection.query(
      "INSERT INTO club_join_requests (user_id, club_id) VALUES (?, ?)",
      [user_id, club_id],
    );
    const [[requester]] = await connection.query(
      "SELECT name FROM users WHERE id = ?",
      [user_id],
    );
    const [organizers] = await connection.query(
      `SELECT user_id FROM memberships
       WHERE club_id = ? AND role IN ('committee', 'president')`,
      [club_id],
    );
    for (const organizer of organizers) {
      await connection.query(
        `INSERT INTO notifications
          (user_id, club_id, club_join_request_id, event_title, message)
         VALUES (?, ?, ?, ?, ?)`,
        [
          organizer.user_id,
          club_id,
          result.insertId,
          `Join request: ${club.name}`,
          `${requester.name} requested to join ${club.name}.`,
        ],
      );
    }
    await connection.commit();
    return { ok: true, request_id: result.insertId, club_name: club.name };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function list_join_requests(club_id, user_id) {
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
  const [requests] = await pool.query(
    `SELECT r.id, r.user_id, u.name, r.requested_at
     FROM club_join_requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.club_id = ? AND r.status = 'pending'
     ORDER BY r.requested_at, r.id`,
    [club_id],
  );
  return { ok: true, requests };
}

async function review_join_request(club_id, request_id, user_id, decision) {
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

    const [[reviewer]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [user_id, club_id],
    );
    if (!["committee", "president"].includes(reviewer?.role)) {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }

    const [[request]] = await connection.query(
      `SELECT id, user_id FROM club_join_requests
       WHERE id = ? AND club_id = ? AND status = 'pending'
       FOR UPDATE`,
      [request_id, club_id],
    );
    if (!request) {
      await connection.rollback();
      return { ok: false, reason: "request_not_found" };
    }

    if (decision === "accept") {
      await connection.query(
        "INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'member')",
        [request.user_id, club_id],
      );
    }
    await connection.query(
      `UPDATE club_join_requests
       SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decision === "accept" ? "accepted" : "rejected", user_id, request_id],
    );
    await connection.query(
      `INSERT INTO notifications
        (user_id, club_id, event_title, message)
       VALUES (?, ?, ?, ?)`,
      [
        request.user_id,
        club_id,
        decision === "accept"
          ? `Join request accepted: ${club.name}`
          : `Join request unsuccessful: ${club.name}`,
        decision === "accept"
          ? `Your request to join ${club.name} was successful.`
          : `Your request to join ${club.name} was unsuccessful.`,
      ],
    );
    await connection.query(
      "DELETE FROM notifications WHERE club_join_request_id = ?",
      [request_id],
    );
    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      target_user_id: request.user_id,
      action_type: decision === "accept"
        ? "join_request_accepted"
        : "join_request_rejected",
      description: `${decision === "accept" ? "Accepted" : "Rejected"} a membership request.`,
      undoable: true,
      details: { request_id, decision },
    });
    await connection.commit();
    return { ok: true, decision };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function leave_club(club_id, user_id) {
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
    const [[membership]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [user_id, club_id],
    );
    if (membership?.role === "president") {
      await connection.rollback();
      return { ok: false, reason: "president_must_transfer" };
    }
    if (!membership) {
      await connection.rollback();
      return { ok: false, reason: "not_a_member" };
    }
    await connection.query(
      "DELETE FROM memberships WHERE user_id = ? AND club_id = ?",
      [user_id, club_id],
    );
    if (membership.role === "committee") {
      await record_club_action(connection, {
        club_id,
        club_name: club.name,
        actor_user_id: user_id,
        target_user_id: user_id,
        action_type: "committee_left_club",
        description: "Left the club and ended committee membership.",
      });
    }
    await connection.commit();
    return { ok: true };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
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
    const [[membership]] = await connection.query(
      "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
      [club_id, user_id],
    );
    if (membership?.role !== "committee") {
      await connection.rollback();
      return membership
        ? { ok: false, reason: "not_committee" }
        : { ok: false, reason: "not_a_member" };
    }
    await connection.query(
      "UPDATE memberships SET role = 'member' WHERE club_id = ? AND user_id = ?",
      [club_id, user_id],
    );
    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      target_user_id: user_id,
      action_type: "committee_left",
      description: "Left the committee and returned to regular member status.",
      undoable: true,
    });
    await connection.commit();
    return { ok: true };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function promote_club_member(club_id, member_user_id, user_id) {
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
    await connection.query(
      `INSERT INTO notifications (user_id, club_id, event_title, message)
       VALUES (?, ?, ?, ?)`,
      [
        member_user_id,
        club_id,
        `Committee role: ${club.name}`,
        `You have been made a committee member of ${club.name}.`,
      ],
    );
    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      target_user_id: member_user_id,
      action_type: "member_promoted",
      description: "Promoted a regular member to committee.",
      undoable: true,
    });
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
      "SELECT id, name FROM clubs WHERE id = ? FOR UPDATE",
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
    await connection.query(
      `INSERT INTO notifications (user_id, club_id, event_title, message)
       VALUES (?, ?, ?, ?)`,
      [
        member_user_id,
        club_id,
        `Committee role changed: ${club.name}`,
        `Your committee role in ${club.name} was removed. You remain a club member.`,
      ],
    );
    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      target_user_id: member_user_id,
      action_type: "member_demoted",
      description: "Demoted a committee member to regular member status.",
      undoable: true,
    });
    await connection.commit();
    return { ok: true };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function remove_club_member(club_id, member_user_id, user_id) {
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

    const [[organizer]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [user_id, club_id],
    );
    if (!["committee", "president"].includes(organizer?.role)) {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }
    if (member_user_id === user_id) {
      await connection.rollback();
      return { ok: false, reason: "cannot_remove_self" };
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
      return { ok: false, reason: "not_regular_member" };
    }

    await connection.query(
      "DELETE FROM memberships WHERE user_id = ? AND club_id = ?",
      [member_user_id, club_id],
    );
    await connection.query(
      `INSERT INTO notifications (user_id, club_id, event_title, message)
       VALUES (?, ?, ?, ?)`,
      [
        member_user_id,
        club_id,
        `Membership ended: ${club.name}`,
        `You have been removed from ${club.name}.`,
      ],
    );
    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      target_user_id: member_user_id,
      action_type: "member_removed",
      description: "Removed a regular member from the club.",
      undoable: true,
    });
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
    await record_club_action(connection, {
      club_id: result.insertId,
      club_name: name.trim(),
      actor_user_id: user_id,
      action_type: "club_created",
      description: "Created the club and became its president.",
      undoable: false,
    });
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
    await connection.query(
      `INSERT INTO notifications (user_id, club_id, event_title, message)
       VALUES (?, ?, ?, ?)`,
      [
        target_user_id,
        club_id,
        `President role: ${club.name}`,
        `You have been made the president of ${club.name}.`,
      ],
    );
    await connection.query(
      `INSERT INTO notifications (user_id, club_id, event_title, message)
       VALUES (?, ?, ?, ?)`,
      [
        user_id,
        club_id,
        `Committee role: ${club.name}`,
        `You are now a committee member of ${club.name}.`,
      ],
    );
    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      target_user_id: target_user_id,
      action_type: "presidency_transferred",
      description: "Transferred the presidency to another committee member.",
      undoable: true,
      details: { previous_president_id: user_id, new_president_id: target_user_id },
    });
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

    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      action_type: "club_deleted",
      description: "Deleted the club.",
      undoable: false,
    });
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

async function list_club_actions(club_id, user_id) {
  const [[club]] = await pool.query(
    "SELECT id, name FROM clubs WHERE id = ?",
    [club_id],
  );
  if (!club) return { ok: false, reason: "not_found" };
  const [[membership]] = await pool.query(
    "SELECT role FROM memberships WHERE club_id = ? AND user_id = ?",
    [club_id, user_id],
  );
  if (membership?.role !== "president") {
    return { ok: false, reason: "forbidden" };
  }
  const [actions] = await pool.query(
    `SELECT id, actor_name, target_name, action_type, description,
       undoable, created_at, UNIX_TIMESTAMP(created_at) AS created_epoch,
       undone_at
     FROM club_action_log
     WHERE club_id = ?
     ORDER BY created_at DESC, id DESC`,
    [club_id],
  );
  return { ok: true, actions };
}

async function undo_club_action(club_id, action_id, user_id) {
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
    const [[president]] = await connection.query(
      "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
      [club_id, user_id],
    );
    if (president?.role !== "president") {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }
    const [[action]] = await connection.query(
      `SELECT id, actor_user_id, target_user_id, target_name, action_type, description,
         undoable, details, undone_at
       FROM club_action_log
       WHERE id = ? AND club_id = ?
       FOR UPDATE`,
      [action_id, club_id],
    );
    if (!action) {
      await connection.rollback();
      return { ok: false, reason: "action_not_found" };
    }
    if (!action.undoable || action.undone_at) {
      await connection.rollback();
      return { ok: false, reason: "not_undoable" };
    }
    const details = parse_action_details(action.details);
    const affectedUsers = action.action_type === "presidency_transferred"
      ? [details.previous_president_id, details.new_president_id]
      : [action.target_user_id];
    for (const affectedUser of affectedUsers) {
      const [[existingUser]] = await connection.query(
        "SELECT id FROM users WHERE id = ?",
        [affectedUser],
      );
      if (!existingUser) {
        await connection.rollback();
        return { ok: false, reason: "state_changed" };
      }
      const [[laterAction]] = await connection.query(
        `SELECT id FROM club_action_log
         WHERE club_id = ? AND id > ? AND target_user_id = ?
           AND undone_at IS NULL AND action_type <> 'action_undone'
         LIMIT 1`,
        [club_id, action.id, affectedUser],
      );
      if (laterAction) {
        await connection.rollback();
        return { ok: false, reason: "later_action_exists" };
      }
    }

    if (action.action_type === "join_request_accepted" ||
        action.action_type === "join_request_rejected") {
      const [[request]] = await connection.query(
        `SELECT id, status FROM club_join_requests
         WHERE id = ? AND club_id = ? AND user_id = ?
         FOR UPDATE`,
        [details.request_id, club_id, action.target_user_id],
      );
      const expectedStatus = action.action_type === "join_request_accepted"
        ? "accepted"
        : "rejected";
      if (!request || request.status !== expectedStatus) {
        await connection.rollback();
        return { ok: false, reason: "state_changed" };
      }
      if (expectedStatus === "accepted") {
        const [[membership]] = await connection.query(
          "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
          [club_id, action.target_user_id],
        );
        if (membership?.role !== "member") {
          await connection.rollback();
          return { ok: false, reason: "state_changed" };
        }
        await connection.query(
          "DELETE FROM memberships WHERE club_id = ? AND user_id = ?",
          [club_id, action.target_user_id],
        );
      }
      const [[otherPendingRequest]] = await connection.query(
        `SELECT id FROM club_join_requests
         WHERE club_id = ? AND user_id = ? AND status = 'pending' AND id <> ?
         LIMIT 1`,
        [club_id, action.target_user_id, request.id],
      );
      if (otherPendingRequest) {
        await connection.rollback();
        return { ok: false, reason: "state_changed" };
      }
      await connection.query(
        `UPDATE club_join_requests
         SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
         WHERE id = ?`,
        [request.id],
      );
      const [organizers] = await connection.query(
        `SELECT user_id FROM memberships
         WHERE club_id = ? AND role IN ('committee', 'president')`,
        [club_id],
      );
      for (const organizer of organizers) {
        await connection.query(
          `INSERT INTO notifications
            (user_id, club_id, club_join_request_id, event_title, message)
           VALUES (?, ?, ?, ?, ?)`,
          [
            organizer.user_id,
            club_id,
            request.id,
            `Join request: ${club.name}`,
            `${action.target_name || "A student"} has a membership request pending again.`,
          ],
        );
      }
    } else if (action.action_type === "member_promoted" ||
               action.action_type === "member_demoted" ||
               action.action_type === "member_removed" ||
               action.action_type === "committee_left") {
      const [[membership]] = await connection.query(
        "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
        [club_id, action.target_user_id],
      );
      if (action.action_type === "member_promoted" && membership?.role === "committee") {
        await connection.query(
          "UPDATE memberships SET role = 'member' WHERE club_id = ? AND user_id = ?",
          [club_id, action.target_user_id],
        );
      } else if (
        (action.action_type === "member_demoted" && membership?.role === "member") ||
        (action.action_type === "committee_left" && membership?.role === "member")
      ) {
        await connection.query(
          "UPDATE memberships SET role = 'committee' WHERE club_id = ? AND user_id = ?",
          [club_id, action.target_user_id],
        );
      } else if (action.action_type === "member_removed" && !membership) {
        await connection.query(
          "INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'member')",
          [action.target_user_id, club_id],
        );
      } else {
        await connection.rollback();
        return { ok: false, reason: "state_changed" };
      }
    } else if (action.action_type === "presidency_transferred") {
      const [[previousPresident]] = await connection.query(
        "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
        [details.previous_president_id, club_id],
      );
      const [[newPresident]] = await connection.query(
        "SELECT role FROM memberships WHERE club_id = ? AND user_id = ? FOR UPDATE",
        [details.new_president_id, club_id],
      );
      if (previousPresident?.role !== "committee" || newPresident?.role !== "president") {
        await connection.rollback();
        return { ok: false, reason: "state_changed" };
      }
      await connection.query(
        "UPDATE memberships SET role = 'president' WHERE club_id = ? AND user_id = ?",
        [club_id, details.previous_president_id],
      );
      await connection.query(
        "UPDATE memberships SET role = 'committee' WHERE club_id = ? AND user_id = ?",
        [club_id, details.new_president_id],
      );
    } else {
      await connection.rollback();
      return { ok: false, reason: "not_undoable" };
    }

    const notificationMessage = `An action affecting your role or membership in ${club.name} was undone by the president.`;
    for (const affectedUser of affectedUsers) {
      await connection.query(
        `INSERT INTO notifications (user_id, club_id, event_title, message)
         VALUES (?, ?, ?, ?)`,
        [
          affectedUser,
          club_id,
          `Club action undone: ${club.name}`,
          notificationMessage,
        ],
      );
    }
    await connection.query(
      "UPDATE club_action_log SET undone_at = CURRENT_TIMESTAMP, undone_by = ? WHERE id = ?",
      [user_id, action_id],
    );
    await record_club_action(connection, {
      club_id,
      club_name: club.name,
      actor_user_id: user_id,
      target_user_id: action.target_user_id,
      action_type: "action_undone",
      description: `Undid action #${action_id}: ${action.description}`,
    });
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
  list_join_requests,
  review_join_request,
  leave_club,
  list_clubs,
  list_memberships,
  list_club_members,
  promote_club_member,
  demote_club_member,
  remove_club_member,
  leave_committee,
  create_club,
  transfer_presidency,
  delete_club,
  list_club_actions,
  undo_club_action,
};
