const TIMESLOTS = ["10:00 - 12:00", "13:00 - 15:00", "16:00 - 18:00"];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// Campus (UTC+8) calendar date. The UTC date is a day behind before 08:00
// in Hong Kong, which made today's events look past and today's slots unbookable.
function today(now = Date.now()) {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

// Booking and event times are stored in UTC. Legacy timeslots are campus-local
// (UTC+8), so the bounds are shifted to UTC here and reads add the offset back.
const CAMPUS_OFFSET_MS = 8 * 3_600_000;

function local_to_utc(date, time) {
  const utc = new Date(new Date(`${date}T${time}Z`).getTime() - CAMPUS_OFFSET_MS);
  return utc.toISOString().slice(0, 19).replace("T", " ");
}

function timeslot_bounds(date, timeslot) {
  // Reject impossible dates such as 2026-02-30 instead of rolling them over.
  if (typeof date !== "string" || !DATE_FORMAT.test(date) || !TIMESLOTS.includes(timeslot)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const [start, end] = timeslot.split(" - ");
  return {
    start: local_to_utc(date, `${start}:00`),
    end: local_to_utc(date, `${end}:00`),
  };
}

export { TIMESLOTS, DATE_FORMAT, today, timeslot_bounds, local_to_utc };
