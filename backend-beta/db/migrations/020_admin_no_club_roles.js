// Venue administrators hold no club role (not member, committee or president)
// and are never attendees. Migrations here are additive, so this one only
// checks the rule: it refuses to run while any venue admin still has a club
// membership or a pending join request, and names them. The operator clears
// them first with `node src/ops/clear-admin-club-roles.js --apply`.
import { MigrationError } from "../../src/db/migrate.js";

export async function up(ctx) {
  const memberships = await ctx.query(
    `SELECT u.id AS user_id, u.email, m.club_id, m.role FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE u.platform_role = 'venue_admin'
     ORDER BY u.id, m.club_id`);
  const requests = await ctx.query(
    `SELECT u.id AS user_id, u.email, r.club_id FROM club_join_requests r
     JOIN users u ON u.id = r.user_id WHERE u.platform_role = 'venue_admin' AND r.status = 'pending'
     ORDER BY u.id, r.club_id`);
  if (memberships.length || requests.length) {
    const lines = [
      ...memberships.map((row) => `user ${row.user_id} (${row.email}) is ${row.role} of club ${row.club_id}`),
      ...requests.map((row) => `user ${row.user_id} (${row.email}) has a pending request to join club ${row.club_id}`),
    ];
    throw new MigrationError("PREFLIGHT_FAILED",
      `Venue administrators still hold club roles: ${lines.join("; ")}. `
      + "Run `docker compose run --rm migrate node src/ops/clear-admin-club-roles.js` (dry run), then again with --apply. "
      + "A venue admin who is a club president blocks it: give that club a new president first.");
  }
}
