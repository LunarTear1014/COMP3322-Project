-- Published events of one club that start in [from, to).
SELECT e.id AS event_id, e.title, e.start_time, e.capacity, e.checkin_opened_at,
       (SELECT MIN(a.created_at) FROM audit_logs a
         WHERE a.entity_type = 'event' AND a.entity_id = e.id
           AND a.action IN ('event.published', 'event.signoff_publish')) AS published_at
FROM events e
WHERE e.club_id = ? AND e.status = 'published' AND e.start_time >= ? AND e.start_time < ?
ORDER BY e.start_time, e.id
