import express from "express";
import { ApiError } from "../shared/errors.js";
import { CAMPUS_TIMEZONE, utc_to_campus_date } from "../shared/slots.js";
import { assert_range, parse_utc_instant, validate_query } from "../shared/validate.js";
import { define_route } from "./router.js";
import { id_param, iso, require_admin, require_user, to_db, wrap } from "./common.js";
import { build_event_visits } from "./event_visits.js";
import { committee_of, is_committee } from "./clubs.js";

const RANGE = { from: { kind: "instant", required: true }, to: { kind: "instant", required: true } };
const pad = (n) => String(n).padStart(2, "0");

// Venue calendar and the club activity report.
function create_calendar_router({ pool, clock }) {
  const router = express.Router();

  define_route(router, "/venues/:venue_id/calendar", {
    get: [require_user, wrap(async (req, res) => {
      const venue_id = id_param(req, "venue_id");
      const query = validate_query(req.query, RANGE);
      const from = parse_utc_instant(query.from);
      const to = parse_utc_instant(query.to);
      assert_range(from, to, 31);
      const [[venue]] = await pool.query("SELECT id FROM venues WHERE id = ?", [venue_id]);
      if (!venue) throw new ApiError("NOT_FOUND", "That venue does not exist.");
      // Full intervals that overlap the range, so cross-midnight legacy bookings still block. Pending never does.
      const [rows] = await pool.query(
        `SELECT b.start_time, b.end_time, b.club_id, e.id AS event_id, e.title, e.status AS event_status
         FROM bookings b LEFT JOIN events e ON e.booking_id = b.id
         WHERE b.venue_id = ? AND b.status = 'confirmed' AND b.start_time < ? AND b.end_time > ? ORDER BY b.start_time, b.id`,
        [venue_id, to_db(to), to_db(from)]);
      res.json({ data: {
        venue_id, from: from.toISOString(), to: to.toISOString(), campus_timezone: CAMPUS_TIMEZONE,
        bookings: rows.map((row) => {
          const published = row.event_status === "published";
          return { start_at: iso(row.start_time), end_at: iso(row.end_time), busy: true, event_id: published ? row.event_id : null, title: published ? row.title : null, club_id: published ? row.club_id : null };
        }),
      } });
    })],
  });

  // Venue schedule for venue administrators: every confirmed booking that
  // overlaps the range, across all venues (or one), in time order, with the
  // event's state and registrations. Pending requests are only counted; they
  // never hold a slot and are reviewed on the booking queue.
  define_route(router, "/admin/schedule", {
    get: [require_admin, wrap(async (req, res) => {
      const query = validate_query(req.query, { ...RANGE, venue_id: { kind: "id" } });
      const from = parse_utc_instant(query.from);
      const to = parse_utc_instant(query.to);
      assert_range(from, to, 31);
      const venue_id = query.venue_id ?? null;
      const [rows] = await pool.query(
        `SELECT b.id AS booking_id, b.venue_id, v.name AS venue_name, v.capacity AS venue_capacity,
           b.club_id, c.name AS club_name, b.start_time, b.end_time,
           e.id AS event_id, e.title, e.status AS event_state, e.visibility, e.capacity,
           (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.status = 'joined') AS joined_count,
           (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.status = 'waitlisted') AS waitlisted_count
         FROM bookings b
         JOIN venues v ON v.id = b.venue_id
         JOIN clubs c ON c.id = b.club_id
         LEFT JOIN events e ON e.booking_id = b.id
         WHERE b.status = 'confirmed' AND b.start_time < ? AND b.end_time > ? AND (? IS NULL OR b.venue_id = ?)
         ORDER BY b.start_time, v.name, b.id`,
        [to_db(to), to_db(from), venue_id, venue_id]);
      const [[{ pending }]] = await pool.query(
        `SELECT COUNT(*) AS pending FROM bookings
         WHERE status = 'pending' AND start_time > ? AND start_time < ? AND end_time > ? AND (? IS NULL OR venue_id = ?)`,
        [to_db(clock()), to_db(to), to_db(from), venue_id, venue_id]);
      res.json({ data: {
        from: from.toISOString(), to: to.toISOString(), campus_timezone: CAMPUS_TIMEZONE, venue_id,
        pending_requests: Number(pending),
        bookings: rows.map((row) => ({
          booking_id: row.booking_id, start_at: iso(row.start_time), end_at: iso(row.end_time),
          venue: { id: row.venue_id, name: row.venue_name, capacity: Number(row.venue_capacity) },
          club: { id: row.club_id, name: row.club_name },
          event: row.event_id ? {
            id: row.event_id, title: row.title, state: row.event_state, visibility: row.visibility,
            capacity: Number(row.capacity), joined_count: Number(row.joined_count), waitlisted_count: Number(row.waitlisted_count),
          } : null,
        })),
      } });
    })],
  });

  define_route(router, "/clubs/:club_id/reports", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const query = validate_query(req.query, RANGE);
      const from = parse_utc_instant(query.from);
      const to = parse_utc_instant(query.to);
      assert_range(from, to, 93);
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", "Only the committee can view reports.");
      const [events] = await pool.query(
        `SELECT e.id AS event_id, e.title, e.status AS state, e.capacity,
           (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.status = 'joined') AS joined_count,
           (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.status IN ('waitlisted', 'pending')) AS waitlisted_count
         FROM events e WHERE e.club_id = ? AND e.status IN ('published', 'cancelled') AND e.start_time >= ? AND e.start_time < ? ORDER BY e.start_time, e.id`,
        [club_id, to_db(from), to_db(to)]);
      // Actions are pre-aggregated per day before any join, so counts never multiply.
      const [actions] = await pool.query(
        `SELECT DATE(DATE_ADD(h.occurred_at, INTERVAL 8 HOUR)) AS day, h.action, COUNT(*) AS n
         FROM participation_history h JOIN events e ON e.id = h.event_id
         WHERE e.club_id = ? AND e.status IN ('published', 'cancelled') AND e.start_time >= ? AND e.start_time < ?
           AND h.occurred_at >= ? AND h.occurred_at < ? GROUP BY day, h.action`,
        [club_id, to_db(from), to_db(to), to_db(from), to_db(to)]);
      const by_day = new Map();
      for (const row of actions) {
        const day = String(row.day).slice(0, 10);
        const entry = by_day.get(day) ?? { joined: 0, waitlisted: 0, left: 0, promoted: 0, cancelled: 0 };
        entry[row.action] = Number(row.n);
        by_day.set(day, entry);
      }
      const daily = [];
      const last = utc_to_campus_date(new Date(to.getTime() - 1));
      for (let cursor = utc_to_campus_date(from); cursor <= last;) {
        daily.push({ date: cursor, ...(by_day.get(cursor) ?? { joined: 0, waitlisted: 0, left: 0, promoted: 0, cancelled: 0 }) });
        const next = new Date(`${cursor}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        cursor = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
      }
      // Confirmed hours, clipped to the window, per venue.
      const [hours] = await pool.query(
        `SELECT v.id AS venue_id, v.name AS venue_name,
           SUM(TIMESTAMPDIFF(SECOND, GREATEST(b.start_time, ?), LEAST(b.end_time, ?))) / 3600 AS hours
         FROM bookings b JOIN venues v ON v.id = b.venue_id
         WHERE b.club_id = ? AND b.status = 'confirmed' AND b.start_time < ? AND b.end_time > ? GROUP BY v.id, v.name ORDER BY v.id`,
        [to_db(from), to_db(to), club_id, to_db(to), to_db(from)]);
      const [[meta]] = await pool.query("SELECT metadata_value AS value FROM schema_metadata WHERE metadata_key = 'history_complete_from'");
      const visits = await build_event_visits(pool, club_id, events.map((row) => row.event_id));
      res.json({ data: {
        club_id, from: from.toISOString(), to: to.toISOString(), campus_timezone: CAMPUS_TIMEZONE,
        events: events.map((row) => ({ ...row, joined_count: Number(row.joined_count), waitlisted_count: Number(row.waitlisted_count) })),
        event_visits: { events: visits.rows, totals: visits.totals },
        daily_actions: daily,
        venue_hours: hours.map((row) => ({ venue_id: row.venue_id, venue_name: row.venue_name, hours: Math.round(Number(row.hours) * 100) / 100 })),
        history_complete_from: meta?.value ?? null,
      } });
    })],
  });
  void clock;
  return router;
}

export { create_calendar_router };
