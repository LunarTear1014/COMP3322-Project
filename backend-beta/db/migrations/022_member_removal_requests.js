// Committee removals of club members wait for the president's sign-off.
// One row per request. A member can have at most one pending request per club
// (enforced by the route, not a unique key, so decided rows stay as history).
// notifications.member_removal_request_id lets the president's inbox item
// carry Approve and Reject buttons, like club_join_request_id does.

const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export async function up(ctx) {
  await ctx.create_table("member_removal_requests", `CREATE TABLE member_removal_requests (
    id INT NOT NULL AUTO_INCREMENT,
    club_id INT NOT NULL,
    user_id INT NOT NULL,
    requested_by INT NULL,
    reason VARCHAR(500) NULL,
    status ENUM('pending', 'approved', 'rejected', 'withdrawn', 'void') NOT NULL DEFAULT 'pending',
    decided_by INT NULL,
    decided_at DATETIME(6) NULL,
    decision_reason VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    INDEX idx_member_removal_club_status (club_id, status),
    INDEX idx_member_removal_club_user_status (club_id, user_id, status),
    CONSTRAINT fk_member_removal_club FOREIGN KEY (club_id) REFERENCES clubs (id) ON DELETE CASCADE,
    CONSTRAINT fk_member_removal_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_member_removal_requester FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_member_removal_decider FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`);

  if (await ctx.add_column("notifications", "member_removal_request_id", "INT NULL")) {
    await ctx.query(`ALTER TABLE notifications ADD CONSTRAINT fk_notifications_member_removal_request
      FOREIGN KEY (member_removal_request_id) REFERENCES member_removal_requests (id) ON DELETE CASCADE`);
  }
}
