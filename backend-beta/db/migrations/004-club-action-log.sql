CREATE TABLE `club_action_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `club_id` INT NOT NULL,
    `club_name` VARCHAR(255) NOT NULL,
    `actor_user_id` INT NULL,
    `actor_name` VARCHAR(255) NOT NULL,
    `target_user_id` INT NULL,
    `target_name` VARCHAR(255) NULL,
    `action_type` VARCHAR(64) NOT NULL,
    `description` VARCHAR(1000) NOT NULL,
    `undoable` BOOLEAN NOT NULL DEFAULT FALSE,
    `details` JSON NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `undone_at` TIMESTAMP NULL DEFAULT NULL,
    `undone_by` INT NULL,

    PRIMARY KEY (`id`),
    INDEX `idx_club_action_log_club_created` (`club_id`, `created_at`, `id`),
    INDEX `idx_club_action_log_target` (`club_id`, `target_user_id`, `id`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
