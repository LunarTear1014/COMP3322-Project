SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `event_join_requests`;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `notification_jobs`;
DROP TABLE IF EXISTS `participation_history`;
DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `workflow_metadata`;
DROP TABLE IF EXISTS `sessions`;
DROP TABLE IF EXISTS `worker_heartbeats`;
DROP TABLE IF EXISTS `schema_migrations`;
DROP TABLE IF EXISTS `participations`;
DROP TABLE IF EXISTS `events`;
DROP TABLE IF EXISTS `bookings`;
DROP TABLE IF EXISTS `club_join_requests`;
DROP TABLE IF EXISTS `memberships`;
DROP TABLE IF EXISTS `venues`;
DROP TABLE IF EXISTS `clubs`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS = 1;


-- ================================================================
-- USERS
-- ================================================================

CREATE TABLE `users` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `student_id` VARCHAR(50) NOT NULL,
    `platform_role` ENUM('student','venue_admin') NOT NULL DEFAULT 'student',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_users_email` (`email`),
    UNIQUE KEY `uk_users_student_id` (`student_id`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ================================================================
-- CLUBS
-- ================================================================

CREATE TABLE `clubs` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_clubs_name` (`name`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ================================================================
-- VENUES
-- ================================================================

CREATE TABLE `venues` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `location` VARCHAR(500) NOT NULL,
    `capacity` INT NOT NULL,
    `description` TEXT,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_venues_name` (`name`),

    CONSTRAINT `chk_venues_capacity`
        CHECK (`capacity` > 0)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ================================================================
-- MEMBERSHIPS
-- ================================================================

CREATE TABLE `memberships` (
    `user_id` INT NOT NULL,
    `club_id` INT NOT NULL,
    `role` ENUM('member', 'committee', 'president') NOT NULL DEFAULT 'member',
    `joined_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`user_id`, `club_id`),

    CONSTRAINT `fk_memberships_user`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`id`)
        ON DELETE CASCADE,

    CONSTRAINT `fk_memberships_club`
        FOREIGN KEY (`club_id`)
        REFERENCES `clubs` (`id`)
        ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- ================================================================
-- CLUB JOIN REQUESTS
-- ================================================================

CREATE TABLE `club_join_requests` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `club_id` INT NOT NULL,
    `status` ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
    `requested_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `reviewed_by` INT NULL,
    `reviewed_at` TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (`id`),
    INDEX `idx_club_join_requests_club_status`
        (`club_id`, `status`, `requested_at`),
    INDEX `idx_club_join_requests_user_club`
        (`user_id`, `club_id`, `requested_at`),

    CONSTRAINT `fk_club_join_requests_user`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`id`)
        ON DELETE CASCADE,

    CONSTRAINT `fk_club_join_requests_club`
        FOREIGN KEY (`club_id`)
        REFERENCES `clubs` (`id`)
        ON DELETE CASCADE,

    CONSTRAINT `fk_club_join_requests_reviewer`
        FOREIGN KEY (`reviewed_by`)
        REFERENCES `users` (`id`)
        ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ================================================================
-- BOOKINGS
-- ================================================================

CREATE TABLE `bookings` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `venue_id` INT NOT NULL,
    `club_id` INT NOT NULL,
    `start_time` DATETIME NOT NULL,
    `end_time` DATETIME NOT NULL,
    `status` ENUM('pending', 'confirmed', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `version` INT UNSIGNED NOT NULL DEFAULT 1,
    `requested_by` INT NULL,
    `decided_by` INT NULL,
    `decided_at` DATETIME(6) NULL,
    `decision_reason` VARCHAR(500) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),

    -- Needed so (id, club_id) can be referenced by events.
    UNIQUE KEY `uk_bookings_id_club` (`id`, `club_id`),
    CONSTRAINT `fk_bookings_requester` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_bookings_decider` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,

    CONSTRAINT `fk_bookings_venue`
        FOREIGN KEY (`venue_id`)
        REFERENCES `venues` (`id`)
        ON DELETE RESTRICT,

    CONSTRAINT `fk_bookings_club`
        FOREIGN KEY (`club_id`)
        REFERENCES `clubs` (`id`)
        ON DELETE CASCADE,

    CONSTRAINT `chk_bookings_time`
        CHECK (`end_time` > `start_time`),

    INDEX `idx_bookings_venue_time`
        (`venue_id`, `start_time`, `end_time`),

    INDEX `idx_bookings_club_time`
        (`club_id`, `start_time`, `end_time`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ================================================================
-- EVENTS
-- ================================================================

CREATE TABLE `events` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `booking_id` INT NOT NULL,
    `club_id` INT NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT,
    `start_time` DATETIME NOT NULL,
    `end_time` DATETIME NOT NULL,
    `visibility` ENUM('public', 'members_only') NOT NULL DEFAULT 'public',
    `status` ENUM('draft', 'published', 'cancelled') NOT NULL DEFAULT 'draft',
    `version` INT UNSIGNED NOT NULL DEFAULT 1,
    `registration_closes_at` DATETIME NULL,
    `capacity` INT NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),

    -- Ensures each booking can be associated with at most one event.
    UNIQUE KEY `uk_events_booking` (`booking_id`),

    -- The event's club must match the booking's club.
    CONSTRAINT `fk_events_booking_club`
        FOREIGN KEY (`booking_id`, `club_id`)
        REFERENCES `bookings` (`id`, `club_id`)
        ON DELETE RESTRICT,

    -- Also ensures club_id is a valid club independently.
    CONSTRAINT `fk_events_club`
        FOREIGN KEY (`club_id`)
        REFERENCES `clubs` (`id`)
        ON DELETE CASCADE,

    CONSTRAINT `chk_events_capacity`
        CHECK (`capacity` > 0),

    CONSTRAINT `chk_events_time`
        CHECK (`end_time` > `start_time`),

    INDEX `idx_events_club_time`
        (`club_id`, `start_time`),

    INDEX `idx_events_status_visibility`
        (`status`, `visibility`),

    INDEX `idx_events_time_range`
        (`start_time`, `end_time`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ================================================================
-- PARTICIPATIONS
-- ================================================================

CREATE TABLE `participations` (
    `user_id` INT NOT NULL,
    `event_id` INT NOT NULL,
    `status` ENUM('joined', 'left', 'waitlisted', 'cancelled') NOT NULL DEFAULT 'joined',
    `joined_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `last_registered_at` TIMESTAMP(6) NULL DEFAULT NULL,
    `queued_at` TIMESTAMP(6) NULL DEFAULT NULL,
    `confirmed_at` TIMESTAMP(6) NULL DEFAULT NULL,
    `left_at` TIMESTAMP(6) NULL DEFAULT NULL,

    PRIMARY KEY (`user_id`, `event_id`),

    CONSTRAINT `fk_participations_user`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`id`)
        ON DELETE CASCADE,

    CONSTRAINT `fk_participations_event`
        FOREIGN KEY (`event_id`)
        REFERENCES `events` (`id`)
        ON DELETE CASCADE,

    INDEX `idx_participations_event_status`
        (`event_id`, `status`),

    INDEX `idx_participations_waitlist_order`
        (`event_id`, `status`, `queued_at`, `user_id`),

    INDEX `idx_participations_user_status`
        (`user_id`, `status`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- ================================================================
-- NOTIFICATIONS
-- ================================================================

CREATE TABLE `notifications` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `event_id` INT NULL,
    `booking_id` INT NULL,
    `type` VARCHAR(40) NOT NULL DEFAULT 'legacy',
    `event_title` VARCHAR(255) NOT NULL,
    `message` VARCHAR(1000) NOT NULL,
    `dedup_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `read_at` TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_notifications_recipient_key` (`user_id`, `dedup_key`),
    INDEX `idx_notifications_user_created` (`user_id`, `created_at`),
    INDEX `idx_notifications_unread` (`user_id`, `read_at`, `id`),

    CONSTRAINT `fk_notifications_user`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`id`)
        ON DELETE CASCADE,

    CONSTRAINT `fk_notifications_event`
        FOREIGN KEY (`event_id`)
        REFERENCES `events` (`id`)
        ON DELETE SET NULL,
    CONSTRAINT `fk_notifications_booking`
        FOREIGN KEY (`booking_id`)
        REFERENCES `bookings` (`id`)
        ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE `participation_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` INT NOT NULL,
    `user_id` INT NOT NULL,
    `actor_user_id` INT NULL,
    `action_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `action` ENUM('joined','waitlisted','left','promoted','cancelled') NOT NULL,
    `from_status` ENUM('joined','waitlisted','left','cancelled') NULL,
    `to_status` ENUM('joined','waitlisted','left','cancelled') NOT NULL,
    `reason` VARCHAR(100) NULL,
    `occurred_at` DATETIME(6) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_history_action_user` (`action_id`,`event_id`,`user_id`),
    INDEX `idx_history_event_time` (`event_id`,`occurred_at`,`id`),
    FOREIGN KEY (`event_id`) REFERENCES `events` (`id`),
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `workflow_metadata` (
    `name` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `timestamp_value` DATETIME(6) NOT NULL,
    PRIMARY KEY (`name`)
) ENGINE=InnoDB;
INSERT INTO `workflow_metadata` (`name`,`timestamp_value`) VALUES ('history_complete_from',UTC_TIMESTAMP(6));

CREATE TABLE `sessions` (
    `session_id` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `expires` INT UNSIGNED NOT NULL,
    `data` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    PRIMARY KEY (`session_id`), INDEX `idx_sessions_expires` (`expires`)
) ENGINE=InnoDB;

CREATE TABLE `worker_heartbeats` (
    `worker_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `last_seen_at` DATETIME(6) NOT NULL,
    PRIMARY KEY (`worker_id`)
) ENGINE=InnoDB;

CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `action_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `actor_user_id` INT NULL,
    `entity_type` ENUM('booking','event','membership') NOT NULL,
    `entity_id` INT NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `details` JSON NOT NULL,
    `created_at` DATETIME(6) NOT NULL,
    PRIMARY KEY (`id`), UNIQUE KEY `uq_audit_action` (`action_id`),
    INDEX `idx_audit_entity_time` (`entity_type`,`entity_id`,`created_at`),
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE event_join_requests (
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('pending','accepted','rejected','withdrawn','cancelled') NOT NULL DEFAULT 'pending',
    allow_waitlist BOOLEAN NOT NULL DEFAULT TRUE,
    requested_at DATETIME(6) NOT NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME(6) NULL,
    PRIMARY KEY (event_id,user_id),
    INDEX idx_event_requests_pending (event_id,status,requested_at,user_id),
    CONSTRAINT fk_event_request_event FOREIGN KEY (event_id) REFERENCES events(id),
    CONSTRAINT fk_event_request_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_event_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `schema_migrations` (
    `version` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    `checksum` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `state` ENUM('started','applied') NOT NULL,
    `started_at` DATETIME(6) NOT NULL,
    `applied_at` DATETIME(6) NULL
) ENGINE=InnoDB;
INSERT INTO `schema_migrations` (`version`,`checksum`,`state`,`started_at`,`applied_at`) VALUES
  ('20261106_cancelled_participations.sql','d455dc8b655cfc49b099364bdb9bcdf5cd7f73e493bb1ad7aae9affebefe454d','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_notification_jobs.sql','adcea50377b72b347b97c7e6ca0594f894932ca2678f1f7806495425f30b0150','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_participation_history.sql','a5f9d6d416ad20ccdd4d52b8563143984c271d14fabf4ceade68f2889ad36b9f','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_booking_approval.sql','c6ae08816f13a2619bd0c642419ea5496f2fcfdafbc4dfc342887b1bf744585f','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_sessions.sql','502f01bffc0ebb5ab64b451f9e86692b22c513335fb240793430018f6e70e7ba','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_worker_heartbeats.sql','0fc9769aad695f3419cf4523ec588b18487f6c7301bbc180f92733a4cb3b5702','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_notification_contract.sql','d49dffeb1132d4147369ad3712fecf0bcf41c1d62da26e9e7114d4eb449e0310','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_participation_times.sql','82a8f5846bbc9873eb50350af623d135844ff882502696b4dfb8d257dc80bb2e','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)),
  ('20261106_event_join_requests.sql','aa107341a708d8fa027aa112dee099ae68a64c1e298aee7c149202241dfcbabd','applied',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));

-- ================================================================
-- ADDITIONAL INDEXES
-- ================================================================

CREATE INDEX `idx_users_created_at`
    ON `users` (`created_at`);

CREATE INDEX `idx_clubs_created_at`
    ON `clubs` (`created_at`);

CREATE INDEX `idx_venues_capacity`
    ON `venues` (`capacity`);

CREATE INDEX `idx_bookings_time_range`
    ON `bookings` (`start_time`, `end_time`);
