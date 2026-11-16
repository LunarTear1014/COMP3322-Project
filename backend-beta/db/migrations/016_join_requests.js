// Committee approval of club membership and of members-only event
// registration (identity-membership "Club membership requests",
// event-participation "Members-only registration approval").
//
// club_join_requests already exists in the beta baseline (legacy SQL 002);
// it is created here only for databases that never applied that file.
// event_join_requests is new: one row per event and student, reused when a
// student asks again after a rejection or withdrawal.

const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export async function up(ctx) {
  await ctx.create_table("club_join_requests", `CREATE TABLE club_join_requests (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    club_id INT NOT NULL,
    status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    INDEX idx_club_join_requests_club_status (club_id, status, requested_at),
    INDEX idx_club_join_requests_user_club (user_id, club_id, requested_at),
    CONSTRAINT fk_club_join_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_club_join_requests_club FOREIGN KEY (club_id) REFERENCES clubs (id) ON DELETE CASCADE,
    CONSTRAINT fk_club_join_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`);

  if (await ctx.add_column("notifications", "club_join_request_id", "INT NULL")) {
    await ctx.query(`ALTER TABLE notifications ADD CONSTRAINT fk_notifications_club_join_request
      FOREIGN KEY (club_join_request_id) REFERENCES club_join_requests (id) ON DELETE CASCADE`);
  }

  await ctx.create_table("event_join_requests", `CREATE TABLE event_join_requests (
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('pending', 'accepted', 'rejected', 'withdrawn', 'cancelled') NOT NULL DEFAULT 'pending',
    allow_waitlist BOOLEAN NOT NULL DEFAULT TRUE,
    requested_at DATETIME(6) NOT NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME(6) NULL,
    reason VARCHAR(500) NULL,
    PRIMARY KEY (event_id, user_id),
    INDEX idx_event_join_requests_pending (event_id, status, requested_at, user_id),
    INDEX idx_event_join_requests_user (user_id, status),
    CONSTRAINT fk_event_join_requests_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
    CONSTRAINT fk_event_join_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_event_join_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`);
}
