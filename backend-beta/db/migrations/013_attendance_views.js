// Check-in and view tracking (beta-feedback.md, migration 013).
const OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export async function up(ctx) {
  await ctx.add_column("events", "checkin_code", "CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NULL");
  await ctx.add_column("events", "checkin_opened_at", "DATETIME(6) NULL");

  await ctx.create_table("event_attendance", `CREATE TABLE event_attendance (
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    method ENUM('code','marked') NOT NULL,
    checked_in_at DATETIME(6) NOT NULL,
    marked_by INT NULL,
    PRIMARY KEY (event_id, user_id),
    CONSTRAINT fk_attendance_event FOREIGN KEY (event_id) REFERENCES events(id),
    CONSTRAINT fk_attendance_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_attendance_marker FOREIGN KEY (marked_by) REFERENCES users(id)
  ) ${OPTIONS}`);

  // bucket is viewed_at floored to 30 minutes by the application, which makes
  // the unique key a per-user 30-minute dedup.
  await ctx.create_table("event_views", `CREATE TABLE event_views (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    source ENUM('explore','club','inbox','my_events','share','other') NOT NULL,
    viewed_at DATETIME(6) NOT NULL,
    bucket DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_event_views_bucket (event_id, user_id, bucket),
    INDEX idx_event_views_event_time (event_id, viewed_at),
    CONSTRAINT fk_views_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_views_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${OPTIONS}`);
}
