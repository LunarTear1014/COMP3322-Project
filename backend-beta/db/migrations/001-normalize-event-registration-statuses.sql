ALTER TABLE `participations`
    MODIFY `status` ENUM(
        'joined',
        'left',
        'waitlisted',
        'pending',
        'unsuccessful'
    ) NOT NULL DEFAULT 'joined';

UPDATE `participations`
SET `status` = 'pending'
WHERE `status` = 'waitlisted';

UPDATE `participations`
SET `status` = 'unsuccessful'
WHERE `status` = 'left';

UPDATE `participations` p
JOIN `events` e ON e.id = p.event_id
SET p.`status` = 'unsuccessful',
    p.`left_at` = COALESCE(p.`left_at`, CURRENT_TIMESTAMP(6))
WHERE e.`status` = 'cancelled'
  AND p.`status` IN ('joined', 'pending');

ALTER TABLE `participations`
    MODIFY `status` ENUM('joined', 'pending', 'unsuccessful')
    NOT NULL DEFAULT 'joined';
