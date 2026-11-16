// Live change hints for the SSE stream (beta-feedback.md section 4,
// "Live page updates"). A row says only that an event's seats, state or
// check-in changed; clients refetch through the normal authorized routes,
// so the stream never carries counts, names or other data. Rows are
// ephemeral: the worker purges those older than a day.

export async function up(ctx) {
  await ctx.create_table("live_signals", `CREATE TABLE live_signals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    topic ENUM('event', 'attendance') NOT NULL,
    event_id INT NOT NULL,
    club_id INT NOT NULL,
    public BOOLEAN NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_live_signals_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
