// Adds the nullable/defaulted workflow fields from database.md section 2.
// Additive only: no row is rewritten, no legacy status or default changes, and
// times stay as stored until the operator-confirmed UTC backfill (004).
//
// Deviation (IMPLEMENTATION-STATUS "Decisions"): bookings.status and
// events.status keep their legacy defaults (confirmed / published) so the beta
// API keeps working; v1 writes always set the status explicitly.

export async function up(ctx) {
  await ctx.add_column("users", "platform_role",
    "ENUM('student','venue_admin') NOT NULL DEFAULT 'student'");
  await ctx.add_column("venues", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE");

  await ctx.query(`ALTER TABLE bookings
    MODIFY status ENUM('pending','confirmed','rejected','cancelled') NOT NULL DEFAULT 'confirmed'`);
  await ctx.add_column("bookings", "version", "INT UNSIGNED NOT NULL DEFAULT 1");
  await ctx.add_column("bookings", "requested_by", "INT NULL");
  await ctx.add_column("bookings", "decided_by", "INT NULL");
  await ctx.add_column("bookings", "decided_at", "DATETIME(6) NULL");
  await ctx.add_column("bookings", "decision_reason", "VARCHAR(500) NULL");

  await ctx.query(`ALTER TABLE events
    MODIFY status ENUM('draft','published','cancelled') NOT NULL DEFAULT 'published'`);
  await ctx.add_column("events", "version", "INT UNSIGNED NOT NULL DEFAULT 1");
  await ctx.add_column("events", "registration_closes_at", "DATETIME(6) NULL");
  await ctx.add_column("events", "created_by", "INT NULL");

  // Transitional superset: legacy beta values (pending, unsuccessful) stay valid
  // until the cutover maps them to waitlisted / left / cancelled.
  await ctx.query(`ALTER TABLE participations
    MODIFY status ENUM('joined','pending','unsuccessful','left','waitlisted','cancelled')
    NOT NULL DEFAULT 'joined'`);
  await ctx.add_column("participations", "last_registered_at", "DATETIME(6) NULL");
  await ctx.add_column("participations", "queued_at", "DATETIME(6) NULL");
  await ctx.add_column("participations", "confirmed_at", "DATETIME(6) NULL");

  await ctx.add_index("users", "idx_users_platform_role", "platform_role");
  await ctx.add_index("memberships", "idx_memberships_club_role", "club_id, role, user_id");
  await ctx.add_index("bookings", "idx_bookings_venue_status_time", "venue_id, status, start_time, end_time");
  await ctx.add_index("bookings", "idx_bookings_review", "status, created_at, id");
  await ctx.add_index("events", "idx_events_club_status_start", "club_id, status, start_time, id");
  await ctx.add_index("events", "idx_events_reminder", "status, start_time, id");
}
