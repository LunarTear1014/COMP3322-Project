import pool from "../../config/db.js";
import { today } from "../../shared/timeslots.js";

const demo_user_id = Number(process.env.DEMO_USER_ID || 1);

function display_visibility(visibility) {
  return visibility === "members_only" ? "Members only" : "Public";
}

function database_visibility(visibility) {
  return visibility === "Members only" ? "members_only" : "public";
}

function make_timeslot(start_time, end_time) {
  return `${start_time.slice(0, 5)} - ${end_time.slice(0, 5)}`;
}

function event_response(row) {
  return {
    id: row.id,
    title: row.title,
    club: row.club,
    date: row.date,
    timeslot: make_timeslot(row.start_time, row.end_time),
    venue: row.venue,
    description: row.description,
    visibility: display_visibility(row.visibility),
    joined_count: Number(row.joined_count),
    is_joined: Boolean(row.is_joined),
    status: row.date >= today() ? "Upcoming" : "Past",
  };
}

async function list_events(user_id = demo_user_id) {
  const [rows] = await pool.query(`
      SELECT
        e.id,
        e.title,
        e.description,
        DATE_FORMAT(e.start_time, '%Y-%m-%d') AS date,
        TIME_FORMAT(e.start_time, '%H:%i') AS start_time,
        TIME_FORMAT(e.end_time, '%H:%i') AS end_time,
        e.visibility,
        c.name AS club,
        v.name AS venue,
        (SELECT COUNT(*)
         FROM participations p
         WHERE p.event_id = e.id AND p.status = 'joined') AS joined_count,
        EXISTS(
          SELECT 1
          FROM participations mine
          WHERE mine.event_id = e.id AND mine.user_id = ? AND mine.status = 'joined'
        ) AS is_joined
      FROM events e
      JOIN clubs c ON c.id = e.club_id
      JOIN bookings b ON b.id = e.booking_id
      JOIN venues v ON v.id = b.venue_id
      WHERE e.status = 'published'
      ORDER BY e.start_time ASC
    `, [user_id]);
  return rows.map(event_response);
}

async function join_event(event_id, user_id = demo_user_id) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[event]] = await connection.query(
      "SELECT id, club_id, visibility, status FROM events WHERE id = ? FOR UPDATE",
      [event_id],
    );
    if (!event) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }
    if (event.status !== "published") {
      await connection.rollback();
      return { ok: false, reason: "unavailable" };
    }

    if (event.visibility === "members_only") {
      const [[membership]] = await connection.query(
        "SELECT user_id FROM memberships WHERE user_id = ? AND club_id = ?",
        [user_id, event.club_id],
      );
      if (!membership) {
        await connection.rollback();
        return { ok: false, reason: "membership_required" };
      }
    }

    const [[participation]] = await connection.query(
      "SELECT status FROM participations WHERE user_id = ? AND event_id = ? FOR UPDATE",
      [user_id, event_id],
    );
    if (participation?.status === "joined") {
      await connection.rollback();
      return { ok: false, reason: "already_joined" };
    }
    if (participation) {
      await connection.query(
        `UPDATE participations
         SET status = 'joined', joined_at = CURRENT_TIMESTAMP, left_at = NULL
         WHERE user_id = ? AND event_id = ?`,
        [user_id, event_id],
      );
    } else {
      await connection.query(
        "INSERT INTO participations (user_id, event_id) VALUES (?, ?)",
        [user_id, event_id],
      );
    }

    await connection.commit();
    return { ok: true };
  } catch (error) {
    if (connection) await connection.rollback();
    return { ok: false, reason: "database", error };
  } finally {
    if (connection) connection.release();
  }
}

async function leave_event(event_id, user_id = demo_user_id) {
  const [result] = await pool.query(
    `UPDATE participations
     SET status = 'left', left_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND event_id = ? AND status = 'joined'`,
    [user_id, event_id],
  );
  if (result.affectedRows > 0) {
    return { ok: true };
  }

  const [[event]] = await pool.query("SELECT id FROM events WHERE id = ?", [
    event_id,
  ]);
  return event
    ? { ok: false, reason: "not_joined" }
    : { ok: false, reason: "not_found" };
}

// Book the venue and create the event in one transaction. Returns
// { ok: true, event },
// { ok: false, reason: "unknown_club" | "unknown_venue" | "conflict", message }, or
// { ok: false, reason: "database", error }.
// If the rollback itself fails, that error propagates to the caller (as before).
async function create_event({
  club,
  title,
  description,
  date,
  venue,
  timeslot,
  visibility,
  bounds,
  user_id,
}) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[club_row]] = await connection.query(
      "SELECT id FROM clubs WHERE name = ? FOR UPDATE",
      [club],
    );
    if (!club_row) {
      await connection.rollback();
      return { ok: false, reason: "unknown_club", message: "Unknown club" };
    }

    const [[membership]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [user_id, club_row.id],
    );
    if (!["committee", "president"].includes(membership?.role)) {
      await connection.rollback();
      return {
        ok: false,
        reason: "forbidden",
        message:
          "Only committee members or the president can book a venue for this club.",
      };
    }

    const [[venue_row]] = await connection.query(
      "SELECT id, capacity FROM venues WHERE name = ?",
      [venue],
    );
    if (!venue_row) {
      await connection.rollback();
      return { ok: false, reason: "unknown_venue", message: "Unknown venue" };
    }

    // The overlap check rejects every booking that intersects this time range.
    const [conflicts] = await connection.query(
      `SELECT id FROM bookings
       WHERE venue_id = ? AND status = 'confirmed'
         AND start_time < ? AND end_time > ?
       FOR UPDATE`,
      [venue_row.id, bounds.end, bounds.start],
    );
    if (conflicts.length > 0) {
      await connection.rollback();
      return {
        ok: false,
        reason: "conflict",
        message: `${venue} is already booked on ${date}, ${timeslot}`,
      };
    }

    const [booking_result] = await connection.query(
      `INSERT INTO bookings (venue_id, club_id, start_time, end_time)
       VALUES (?, ?, ?, ?)`,
      [venue_row.id, club_row.id, bounds.start, bounds.end],
    );
    const [event_result] = await connection.query(
      `INSERT INTO events
        (booking_id, club_id, title, description, start_time, end_time, visibility, capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        booking_result.insertId,
        club_row.id,
        title.trim(),
        description.trim(),
        bounds.start,
        bounds.end,
        database_visibility(visibility),
        venue_row.capacity,
      ],
    );

    await connection.commit();
    return {
      ok: true,
      event: {
        id: event_result.insertId,
        title: title.trim(),
        club,
        date,
        timeslot,
        venue,
        description: description.trim(),
        visibility,
        joined_count: 0,
        status: "Upcoming",
      },
    };
  } catch (error) {
    if (connection) await connection.rollback();
    return { ok: false, reason: "database", error };
  } finally {
    if (connection) connection.release();
  }
}

export { join_event, leave_event, list_events, create_event };
