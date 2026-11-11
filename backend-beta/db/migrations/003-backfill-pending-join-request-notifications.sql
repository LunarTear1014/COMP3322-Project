INSERT INTO `notifications`
    (`user_id`, `club_id`, `club_join_request_id`, `event_title`, `message`)
SELECT
    m.`user_id`,
    c.`id`,
    r.`id`,
    CONCAT('Join request: ', c.`name`),
    CONCAT(requester.`name`, ' requested to join ', c.`name`, '.')
FROM `club_join_requests` r
JOIN `clubs` c ON c.`id` = r.`club_id`
JOIN `users` requester ON requester.`id` = r.`user_id`
JOIN `memberships` m
    ON m.`club_id` = c.`id`
   AND m.`role` IN ('committee', 'president')
WHERE r.`status` = 'pending'
  AND NOT EXISTS (
      SELECT 1
      FROM `notifications` n
      WHERE n.`user_id` = m.`user_id`
        AND n.`club_join_request_id` = r.`id`
  );
