// President role (beta-feedback.md section 1, migration 010).
// The beta schema already allows role = 'president'. This adds the per-row
// version and the database-level rule of at most one president per club.
// The operator sets a club's first president; this migration never infers one.
import { MigrationError } from "../../src/db/migrate.js";

export async function up(ctx) {
  const duplicates = await ctx.query(
    `SELECT club_id, COUNT(*) AS presidents FROM memberships
     WHERE role = 'president' GROUP BY club_id HAVING COUNT(*) > 1`);
  if (duplicates.length) {
    throw new MigrationError("PREFLIGHT_FAILED",
      `Clubs with more than one president: ${duplicates.map((row) => row.club_id).join(", ")}. `
      + "Repair them before migrating; no winner is chosen automatically.");
  }

  await ctx.query(`ALTER TABLE memberships
    MODIFY role ENUM('member','committee','president') NOT NULL DEFAULT 'member'`);
  await ctx.add_column("memberships", "version", "INT UNSIGNED NOT NULL DEFAULT 1");
  await ctx.add_column("memberships", "president_club_id",
    "INT AS (IF(role = 'president', club_id, NULL)) STORED");
  await ctx.add_index("memberships", "uq_memberships_one_president", "president_club_id", { unique: true });
}
