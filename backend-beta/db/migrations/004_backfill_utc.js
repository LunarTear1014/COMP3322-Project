// One-time UTC backfill and legacy defaults (database.md sections 4 and 5).
//
// Legacy bookings/events times are naive DATETIME values in campus local time.
// Product-owner decision 2026-11-16: that local time is Asia/Taipei (UTC+8, no
// DST). The operator confirms it explicitly with LEGACY_DATETIME_TIMEZONE
// (Asia/Taipei, Asia/Hong_Kong or UTC); without it a database that has legacy
// rows refuses to migrate. The shift and its marker are written in one
// transaction, so a rerun after an interruption can never shift twice.
import { MigrationError } from "../../src/db/migrate.js";

const OFFSET_HOURS = { "Asia/Taipei": 8, "Asia/Hong_Kong": 8, UTC: 0 };
const MARKER = "legacy_times_utc";

export async function up(ctx) {
  await ctx.query("SET time_zone = '+00:00'"); // TIMESTAMP columns are read as UTC
  const [{ n: rows }] = await ctx.query(
    "SELECT (SELECT COUNT(*) FROM bookings) + (SELECT COUNT(*) FROM events) AS n");
  const zone = process.env.LEGACY_DATETIME_TIMEZONE;
  if (Number(rows) > 0 && !(zone in OFFSET_HOURS)) {
    throw new MigrationError("PREFLIGHT_FAILED",
      "Set LEGACY_DATETIME_TIMEZONE to Asia/Taipei, Asia/Hong_Kong or UTC to confirm how legacy times were stored.");
  }
  const offset = OFFSET_HOURS[zone] ?? 0;

  for (const table of ["bookings", "events"]) {
    await ctx.query(`ALTER TABLE ${table}
      MODIFY start_time DATETIME(6) NOT NULL, MODIFY end_time DATETIME(6) NOT NULL`);
  }
  await ctx.query("ALTER TABLE participations MODIFY left_at DATETIME(6) NULL");

  const done = await ctx.query("SELECT 1 FROM schema_metadata WHERE metadata_key = ?", [MARKER]);
  if (!done.length) {
    await ctx.query("START TRANSACTION");
    try {
      if (offset) {
        for (const table of ["bookings", "events"]) {
          await ctx.query(`UPDATE ${table}
            SET start_time = start_time - INTERVAL ? HOUR, end_time = end_time - INTERVAL ? HOUR`, [offset, offset]);
        }
      }
      await ctx.query("INSERT INTO schema_metadata (metadata_key, metadata_value) VALUES (?, ?)",
        [MARKER, zone || "UTC"]);
      await ctx.query("COMMIT");
    } catch (error) {
      await ctx.query("ROLLBACK");
      throw error;
    }
  }

  // Legacy defaults: no invented actors, decisions or history.
  await ctx.query("UPDATE events SET registration_closes_at = start_time WHERE registration_closes_at IS NULL");
  await ctx.query(`UPDATE participations SET last_registered_at = CAST(joined_at AS DATETIME(6))
    WHERE last_registered_at IS NULL`);
  await ctx.query(`UPDATE participations SET queued_at = CAST(joined_at AS DATETIME(6))
    WHERE queued_at IS NULL AND status IN ('pending', 'waitlisted')`);
  await ctx.query(`UPDATE participations SET confirmed_at = CAST(joined_at AS DATETIME(6))
    WHERE confirmed_at IS NULL AND status = 'joined'`);
  await ctx.query(`INSERT IGNORE INTO schema_metadata (metadata_key, metadata_value)
    VALUES ('history_complete_from', DATE_FORMAT(UTC_TIMESTAMP(6), '%Y-%m-%dT%H:%i:%s.%fZ'))`);
}
