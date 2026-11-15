// Committee requests wait for the president (beta-feedback.md, migration 011).
// awaiting_president and returned bookings never count as busy; that rule lives
// in the overlap queries, which filter on status = 'confirmed'.

export async function up(ctx) {
  await ctx.query(`ALTER TABLE bookings
    MODIFY status ENUM('pending','confirmed','rejected','cancelled','awaiting_president','returned')
    NOT NULL DEFAULT 'confirmed'`);
  await ctx.query(`ALTER TABLE events
    MODIFY status ENUM('draft','published','cancelled','awaiting_president')
    NOT NULL DEFAULT 'published'`);
  for (const table of ["bookings", "events"]) {
    await ctx.add_column(table, "signoff_requested_by", "INT NULL");
    await ctx.add_column(table, "signoff_decided_by", "INT NULL");
    await ctx.add_column(table, "signoff_decided_at", "DATETIME(6) NULL");
    await ctx.add_column(table, "signoff_reason", "VARCHAR(500) NULL");
  }
}
