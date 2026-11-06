-- One-time additive migration; back up before applying. MySQL DDL commits implicitly.
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


