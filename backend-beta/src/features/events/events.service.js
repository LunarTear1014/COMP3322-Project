import pool from "../../config/db.js";
import { today } from "../../shared/timeslots.js";

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
    status: row.date >= today() ? "Upcoming" : "Past",
  };
}

async function list_events() {
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
        COUNT(CASE WHEN p.status = 'joined' THEN 1 END) AS joined_count
      FROM events e
      JOIN clubs c ON c.id = e.club_id
      JOIN bookings b ON b.id = e.booking_id
      JOIN venues v ON v.id = b.venue_id
      LEFT JOIN participations p ON p.event_id = e.id
      WHERE e.status = 'published'
      GROUP BY e.id, e.title, e.description, e.start_time, e.end_time,
        e.visibility, c.name, v.name
      ORDER BY e.start_time ASC
    `);
  return rows.map(event_response);
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
}) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[club_row]] = await connection.query(
      "SELECT id FROM clubs WHERE name = ?",
      [club],
    );
    if (!club_row) {
      await connection.rollback();
      return { ok: false, reason: "unknown_club", message: "Unknown club" };
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

export { list_events, create_event };
