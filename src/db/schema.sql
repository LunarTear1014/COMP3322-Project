SET FOREIGN_KEY_CHECKS = 0;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS `participations`;
DROP TABLE IF EXISTS `events`;
DROP TABLE IF EXISTS `bookings`;
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
    `role` ENUM('member', 'committee') NOT NULL DEFAULT 'member',
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
-- BOOKINGS
-- ================================================================

CREATE TABLE `bookings` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `venue_id` INT NOT NULL,
    `club_id` INT NOT NULL,
    `start_time` DATETIME NOT NULL,
    `end_time` DATETIME NOT NULL,
    `status` ENUM('confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),

    -- Needed so (id, club_id) can be referenced by events.
    UNIQUE KEY `uk_bookings_id_club` (`id`, `club_id`),

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
    `status` ENUM('published', 'cancelled') NOT NULL DEFAULT 'published',
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
    `status` ENUM('joined', 'left', 'waitlisted') NOT NULL DEFAULT 'joined',
    `joined_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `left_at` TIMESTAMP NULL DEFAULT NULL,

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

    INDEX `idx_participations_user_status`
        (`user_id`, `status`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ================================================================
-- ADDITIONAL INDEXES
-- ================================================================

CREATE INDEX `idx_users_role`
    ON `users` (`role`);

CREATE INDEX `idx_users_created_at`
    ON `users` (`created_at`);

CREATE INDEX `idx_clubs_created_at`
    ON `clubs` (`created_at`);

CREATE INDEX `idx_venues_capacity`
    ON `venues` (`capacity`);

CREATE INDEX `idx_bookings_time_range`
    ON `bookings` (`start_time`, `end_time`);
