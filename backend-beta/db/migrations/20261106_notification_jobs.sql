-- One-time additive migration for existing beta databases. Back up first.
-- MySQL DDL commits implicitly; do not rerun after a partial failure without inspection.
ALTER TABLE notifications ADD COLUMN dedup_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY uq_notifications_recipient_key (user_id, dedup_key);

CREATE TABLE `notification_jobs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `action_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `type` ENUM('booking_requested','booking_decided','registration_changed',
                'event_changed','event_cancelled','event_reminder') NOT NULL,
    `event_id` INT NULL,
    `booking_id` INT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
    `due_at` DATETIME(6) NOT NULL,
    `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `lock_token` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `locked_until` DATETIME(6) NULL,
    `last_error` VARCHAR(1000) NULL,
    `created_at` DATETIME(6) NOT NULL,
    `completed_at` DATETIME(6) NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_jobs_action_key` (`action_key`),
    INDEX `idx_jobs_due` (`status`,`due_at`,`id`),
    INDEX `idx_jobs_lease` (`status`,`locked_until`,`id`),
    FOREIGN KEY (`event_id`) REFERENCES `events` (`id`),
    FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`),
    CHECK (`attempts` <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


