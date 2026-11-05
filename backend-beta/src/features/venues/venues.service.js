import pool from "../../config/db.js";
import { TIMESLOTS, timeslot_bounds } from "../../shared/timeslots.js";

async function list_venues_with_availability(date) {
  const day_end = new Date(`${date}T00:00:00Z`);
  day_end.setUTCDate(day_end.getUTCDate() + 1);
  const next_date = day_end.toISOString().slice(0, 10);

  const [venues] = await pool.query(
    "SELECT id, name, location, capacity, description FROM venues ORDER BY id",
  );
  const [bookings] = await pool.query(
    `SELECT venue_id, start_time, end_time
     FROM bookings
     WHERE status = 'confirmed' AND start_time < ? AND end_time > ?`,
    [`${next_date} 00:00:00`, `${date} 00:00:00`],
  );

  return venues.map((venue) => ({
    ...venue,
    timeslots: TIMESLOTS.map((time) => {
      const slot = timeslot_bounds(date, time);
      const available = !bookings.some(
        (booking) =>
          booking.venue_id === venue.id &&
          booking.start_time < slot.end &&
          booking.end_time > slot.start,
      );
      return { time, available };
    }),
  }));
}

export { list_venues_with_availability };
