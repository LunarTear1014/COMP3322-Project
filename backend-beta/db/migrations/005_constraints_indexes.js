// Stronger constraints and indexes, applied after the backfill (database.md
// section 2). The composite booking/event interval FK is deliberately not
// added: the legacy beta edit flow rewrites booking and event times in two
// statements, which an immediate composite FK would reject. The service layer
// keeps the two in step instead (IMPLEMENTATION-STATUS, Deviations).

async function add_check(ctx, table, name, expression) {
  if (await ctx.constraint_exists(table, name)) return;
  await ctx.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression})`);
}

export async function up(ctx) {
  await ctx.query("ALTER TABLE events MODIFY registration_closes_at DATETIME(6) NOT NULL");
  await ctx.query("ALTER TABLE participations MODIFY last_registered_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)");
  await add_check(ctx, "bookings", "chk_bookings_version", "version >= 1");
  await add_check(ctx, "events", "chk_events_version", "version >= 1");
  await add_check(ctx, "events", "chk_events_closes_before_start", "registration_closes_at <= start_time");
  await add_check(ctx, "events", "chk_events_capacity_max", "capacity <= 500");

  await ctx.add_index("participations", "idx_participations_waitlist", "event_id, status, queued_at, user_id");
  await ctx.add_index("participations", "idx_participations_user_event", "user_id, status, event_id");
  await ctx.add_index("notifications", "idx_notifications_inbox", "user_id, created_at, id");
  for (const [table, name, from, to] of [
    ["bookings", "fk_bookings_requested_by", "requested_by", "users"],
    ["bookings", "fk_bookings_decided_by", "decided_by", "users"],
    ["events", "fk_events_created_by", "created_by", "users"],
  ]) {
    if (!(await ctx.constraint_exists(table, name))) {
      await ctx.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${from}) REFERENCES ${to}(id) ON DELETE RESTRICT`);
    }
  }
}
