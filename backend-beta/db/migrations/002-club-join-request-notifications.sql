ALTER TABLE `notifications`
    ADD COLUMN `club_id` INT NULL AFTER `event_id`,
    ADD COLUMN `club_join_request_id` INT NULL AFTER `club_id`,
    ADD CONSTRAINT `fk_notifications_club`
        FOREIGN KEY (`club_id`)
        REFERENCES `clubs` (`id`)
        ON DELETE CASCADE,
    ADD CONSTRAINT `fk_notifications_club_join_request`
        FOREIGN KEY (`club_join_request_id`)
        REFERENCES `club_join_requests` (`id`)
        ON DELETE CASCADE;
