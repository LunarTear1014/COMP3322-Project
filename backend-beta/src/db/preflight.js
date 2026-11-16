// Legacy data integrity checks that run before any workflow migration
// (database.md section 5). They only read. Any finding aborts the migration with
// a repair report; nothing is deleted and no winner is chosen automatically.

const CHECKS = [
  ["orphaned events (no matching booking for the same club)",
    `SELECT e.id FROM events e LEFT JOIN bookings b ON b.id = e.booking_id AND b.club_id = e.club_id WHERE b.id IS NULL`],
  ["event and booking times differ",
    `SELECT e.id FROM events e JOIN bookings b ON b.id = e.booking_id
     WHERE e.start_time <> b.start_time OR e.end_time <> b.end_time`],
  ["confirmed bookings overlap at the same venue",
    `SELECT a.id FROM bookings a JOIN bookings b ON a.venue_id = b.venue_id AND a.id < b.id
     WHERE a.status = 'confirmed' AND b.status = 'confirmed' AND a.start_time < b.end_time AND a.end_time > b.start_time`],
  ["event capacity above venue capacity",
    `SELECT e.id FROM events e JOIN bookings b ON b.id = e.booking_id JOIN venues v ON v.id = b.venue_id WHERE e.capacity > v.capacity`],
  ["capacity above 500",
    `SELECT id FROM events WHERE capacity > 500 UNION SELECT id FROM venues WHERE capacity > 500`],
  ["waiting list above 500",
    `SELECT event_id AS id FROM participations WHERE status IN ('pending', 'waitlisted') GROUP BY event_id HAVING COUNT(*) > 500`],
  ["participations pointing at missing events or users",
    `SELECT p.event_id AS id FROM participations p LEFT JOIN events e ON e.id = p.event_id LEFT JOIN users u ON u.id = p.user_id
     WHERE e.id IS NULL OR u.id IS NULL`],
  ["emails that collide after trimming and lowercasing",
    `SELECT MIN(id) AS id FROM users GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1`],
  ["student IDs that collide after trimming and lowercasing",
    `SELECT MIN(id) AS id FROM users GROUP BY LOWER(TRIM(student_id)) HAVING COUNT(*) > 1`],
];

// Returns [{ check, ids }] for every check that found rows.
export async function run_preflight(query) {
  const problems = [];
  for (const [check, sql] of CHECKS) {
    const rows = await query(sql);
    if (rows.length) problems.push({ check, ids: rows.slice(0, 20).map((row) => row.id) });
  }
  return problems;
}

export function format_report(problems) {
  return problems.map(({ check, ids }) => `${check}: ${ids.join(", ")}`).join("; ");
}
