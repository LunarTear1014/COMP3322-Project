import express from "express";
import pool from "./db.js";

const app = express();
app.use(express.json());

const TIMESLOTS = ["10:00 - 12:00", "13:00 - 15:00", "16:00 - 18:00"];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const demo_user_id = Number(process.env.DEMO_USER_ID || 1);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function display_visibility(visibility) {
  return visibility === "members_only" ? "Members only" : "Public";
}

function database_visibility(visibility) {
  return visibility === "Members only" ? "members_only" : "public";
}

function make_timeslot(start_time, end_time) {
  return `${start_time.slice(0, 5)} - ${end_time.slice(0, 5)}`;
}

function timeslot_bounds(date, timeslot) {
  if (!TIMESLOTS.includes(timeslot)) return null;
  const [start, end] = timeslot.split(" - ");
  return {
    start: `${date} ${start}:00`,
    end: `${date} ${end}:00`,
  };
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

function invalid_request(res, message) {
  return res.status(422).json({ message });
}

function database_error(res, error) {
  console.error(error);
  return res.status(500).json({ message: "Database request failed." });
}

// A quick way to check that the API can talk to MySQL.
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (error) {
    database_error(res, error);
  }
});

// GET /api/events
app.get("/api/events", async (_req, res) => {
  try {
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
    res.json(rows.map(event_response));
  } catch (error) {
    database_error(res, error);
  }
});

// POST /api/events: book the venue and create the event in one transaction.
app.post("/api/events", async (req, res) => {
  const { club, title, description, date, venue, timeslot, visibility } = req.body;

  if (typeof club !== "string" || club.trim() === "") {
    return invalid_request(res, "Club is required");
  }
  if (typeof title !== "string" || title.trim() === "") {
    return invalid_request(res, "Event title is required");
  }
  if (typeof description !== "string" || description.trim() === "") {
    return invalid_request(res, "Event description is required");
  }
  if (typeof date !== "string" || !DATE_FORMAT.test(date)) {
    return invalid_request(res, "Date must look like 2026-10-06");
  }
  if (date < today()) {
    return invalid_request(res, "The date cannot be in the past");
  }
  if (typeof venue !== "string" || venue.trim() === "") {
    return invalid_request(res, "Venue is required");
  }
  const bounds = timeslot_bounds(date, timeslot);
  if (!bounds) {
    return invalid_request(res, "Unknown timeslot");
  }
  if (!["Public", "Members only"].includes(visibility)) {
    return invalid_request(res, "Visibility must be Public or Members only");
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [[club_row]] = await connection.query(
      "SELECT id FROM clubs WHERE name = ?",
      [club]
    );
    if (!club_row) {
      await connection.rollback();
      return invalid_request(res, "Unknown club");
    }

    const [[venue_row]] = await connection.query(
      "SELECT id, capacity FROM venues WHERE name = ?",
      [venue]
    );
    if (!venue_row) {
      await connection.rollback();
      return invalid_request(res, "Unknown venue");
    }

    // The overlap check rejects every booking that intersects this time range.
    const [conflicts] = await connection.query(
      `SELECT id FROM bookings
       WHERE venue_id = ? AND status = 'confirmed'
         AND start_time < ? AND end_time > ?
       FOR UPDATE`,
      [venue_row.id, bounds.end, bounds.start]
    );
    if (conflicts.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        message: `${venue} is already booked on ${date}, ${timeslot}`,
      });
    }

    const [booking_result] = await connection.query(
      `INSERT INTO bookings (venue_id, club_id, start_time, end_time)
       VALUES (?, ?, ?, ?)`,
      [venue_row.id, club_row.id, bounds.start, bounds.end]
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
      ]
    );

    await connection.commit();
    res.status(201).json({
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
    });
  } catch (error) {
    if (connection) await connection.rollback();
    database_error(res, error);
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/venues?date=2026-10-06
app.get("/api/venues", async (req, res) => {
  const date = req.query.date || today();
  if (!DATE_FORMAT.test(date)) {
    return invalid_request(res, "Date must look like 2026-10-06");
  }

  const day_end = new Date(`${date}T00:00:00Z`);
  day_end.setUTCDate(day_end.getUTCDate() + 1);
  const next_date = day_end.toISOString().slice(0, 10);

  try {
    const [venues] = await pool.query(
      "SELECT id, name, location, capacity FROM venues ORDER BY id"
    );
    const [bookings] = await pool.query(
      `SELECT venue_id,
        TIME_FORMAT(start_time, '%H:%i') AS start_time,
        TIME_FORMAT(end_time, '%H:%i') AS end_time
       FROM bookings
       WHERE status = 'confirmed' AND start_time < ? AND end_time > ?`,
      [`${next_date} 00:00:00`, `${date} 00:00:00`]
    );

    res.json(
      venues.map((venue) => ({
        ...venue,
        timeslots: TIMESLOTS.map((time) => {
          const slot = timeslot_bounds(date, time);
          const available = !bookings.some(
            (booking) =>
              booking.venue_id === venue.id &&
              `${date} ${booking.start_time}:00` < slot.end &&
              `${date} ${booking.end_time}:00` > slot.start
          );
          return { time, available };
        }),
      }))
    );
  } catch (error) {
    database_error(res, error);
  }
});

// The demo user is used until the login feature supplies an authenticated user id.
app.get("/api/profile", async (_req, res) => {
  try {
    const [[profile]] = await pool.query(
      "SELECT name, email FROM users WHERE id = ?",
      [demo_user_id]
    );
    if (!profile) {
      return res.status(404).json({ message: "Demo user was not found." });
    }
    res.json(profile);
  } catch (error) {
    database_error(res, error);
  }
});

app.put("/api/profile", async (req, res) => {
  const { name, email } = req.body;
  if (typeof name !== "string" || name.trim() === "") {
    return invalid_request(res, "Name is required");
  }
  if (typeof email !== "string" || !email.includes("@")) {
    return invalid_request(res, "Enter a valid email address");
  }

  try {
    const [result] = await pool.query(
      "UPDATE users SET name = ?, email = ? WHERE id = ?",
      [name.trim(), email.trim(), demo_user_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Demo user was not found." });
    }
    res.json({ name: name.trim(), email: email.trim() });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "That email address is already in use." });
    }
    database_error(res, error);
  }
});

const port = Number(process.env.PORT || 3000);

async function start() {
  try {
    await pool.query("SELECT 1");
    app.listen(port, () => console.log(`API on http://localhost:${port}`));
  } catch (error) {
    console.error("Could not connect to MySQL. Check .env and start MySQL.");
    console.error(error.message);
    process.exit(1);
  }
}

start();
