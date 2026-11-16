-- Views per event, user and source, collapsed before any other join so counts cannot multiply.
SELECT event_id, user_id, source, COUNT(*) AS views, MIN(viewed_at) AS first_view_at
FROM event_views WHERE event_id IN (?)
GROUP BY event_id, user_id, source
