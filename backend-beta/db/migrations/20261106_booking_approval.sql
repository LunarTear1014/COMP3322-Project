-- Stop old API and worker processes and back up before applying once.
-- MySQL DDL commits implicitly; inspect any partial failure before retrying.
ALTER TABLE users ADD COLUMN platform_role ENUM('student','venue_admin') NOT NULL DEFAULT 'student';
ALTER TABLE bookings
  MODIFY COLUMN status ENUM('pending','confirmed','rejected','cancelled') NOT NULL DEFAULT 'pending',
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN requested_by INT NULL,
  ADD COLUMN decided_by INT NULL,
  ADD COLUMN decided_at DATETIME(6) NULL,
  ADD COLUMN decision_reason VARCHAR(500) NULL,
  ADD CONSTRAINT fk_bookings_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_bookings_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE events
  MODIFY COLUMN status ENUM('draft','published','cancelled') NOT NULL DEFAULT 'draft',
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN registration_closes_at DATETIME NULL;
CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  action_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id INT NULL, entity_type ENUM('booking','event','membership') NOT NULL,
  entity_id INT NOT NULL, action VARCHAR(80) NOT NULL, details JSON NOT NULL,
  created_at DATETIME(6) NOT NULL, PRIMARY KEY (id), UNIQUE KEY uq_audit_action (action_id),
  INDEX idx_audit_entity_time (entity_type,entity_id,created_at),
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
