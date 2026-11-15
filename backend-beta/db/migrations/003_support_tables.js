// Support tables from database.md section 3. `notifications` already exists in
// the beta and is extended by 014 instead of being recreated here.

const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export async function up(ctx) {
  await ctx.create_table("sessions", `CREATE TABLE sessions (
    session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    expires INT UNSIGNED NOT NULL,
    data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    PRIMARY KEY (session_id),
    INDEX idx_sessions_expires (expires)
  ) ENGINE=InnoDB`);

  await ctx.create_table("participation_history", `CREATE TABLE participation_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    actor_user_id INT NULL,
    action_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action ENUM('joined','waitlisted','left','promoted','cancelled') NOT NULL,
    from_status ENUM('joined','waitlisted','left','cancelled') NULL,
    to_status ENUM('joined','waitlisted','left','cancelled') NOT NULL,
    reason VARCHAR(100) NULL,
    occurred_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_history_action_user (action_id, event_id, user_id),
    INDEX idx_history_event_time (event_id, occurred_at, id),
    CONSTRAINT fk_history_event FOREIGN KEY (event_id) REFERENCES events(id),
    CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_history_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
  ) ${TABLE_OPTIONS}`);

  await ctx.create_table("audit_logs", `CREATE TABLE audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    action_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_id INT NULL,
    entity_type ENUM('booking','event','membership') NOT NULL,
    entity_id INT NOT NULL,
    action VARCHAR(80) NOT NULL,
    details JSON NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_audit_action (action_id),
    INDEX idx_audit_entity_time (entity_type, entity_id, created_at),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
  ) ${TABLE_OPTIONS}`);

  await ctx.create_table("notification_jobs", `CREATE TABLE notification_jobs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    action_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    type ENUM('booking_requested','booking_decided','registration_changed',
      'event_changed','event_cancelled','event_reminder','activity_digest') NOT NULL,
    event_id INT NULL,
    booking_id INT NULL,
    payload JSON NOT NULL,
    status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
    due_at DATETIME(6) NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    lock_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    locked_until DATETIME(6) NULL,
    last_error VARCHAR(1000) NULL,
    created_at DATETIME(6) NOT NULL,
    completed_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_jobs_action_key (action_key),
    INDEX idx_jobs_due (status, due_at, id),
    INDEX idx_jobs_lease (status, locked_until, id),
    CONSTRAINT fk_jobs_event FOREIGN KEY (event_id) REFERENCES events(id),
    CONSTRAINT fk_jobs_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
    CONSTRAINT chk_jobs_attempts CHECK (attempts <= 5)
  ) ${TABLE_OPTIONS}`);

  await ctx.create_table("worker_heartbeats", `CREATE TABLE worker_heartbeats (
    worker_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    last_seen_at DATETIME(6) NOT NULL,
    PRIMARY KEY (worker_id)
  ) ENGINE=InnoDB`);

  await ctx.create_table("schema_metadata", `CREATE TABLE schema_metadata (
    metadata_key VARCHAR(64) NOT NULL,
    metadata_value VARCHAR(255) NOT NULL,
    PRIMARY KEY (metadata_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
