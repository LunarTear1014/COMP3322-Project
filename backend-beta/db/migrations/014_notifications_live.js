// Live notifications (beta-feedback.md, migration 014).
// The beta notifications table has no type, dedup key or title. Those columns
// are added as nullable so legacy rows stay valid. The legacy NOT NULL columns
// (event_title, message) remain; v1 writers fill them from title/body.
// notifications.club_id already exists (beta migration 002).

export async function up(ctx) {
  await ctx.add_column("notifications", "type", "VARCHAR(40) NULL");
  await ctx.add_column("notifications", "dedup_key",
    "VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL");
  await ctx.add_column("notifications", "title", "VARCHAR(255) NULL");
  await ctx.add_column("notifications", "body", "TEXT NULL");
  await ctx.add_column("notifications", "booking_id", "INT NULL");
  // NULL dedup keys (legacy rows) never collide in a MySQL unique index.
  await ctx.add_index("notifications", "uq_notifications_recipient_key", "user_id, dedup_key", { unique: true });
  await ctx.add_index("notifications", "idx_notifications_unread", "user_id, read_at, id");

  await ctx.create_table("activity_digests", `CREATE TABLE activity_digests (
    club_id INT NOT NULL,
    campus_date DATE NOT NULL,
    PRIMARY KEY (club_id, campus_date),
    CONSTRAINT fk_digests_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
