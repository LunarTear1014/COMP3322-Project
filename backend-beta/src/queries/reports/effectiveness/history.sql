-- Every participation transition for the given events, in order. Counts are derived in the service, never stored.
SELECT h.id, h.event_id, h.user_id, h.action, h.from_status, h.occurred_at
FROM participation_history h
WHERE h.event_id IN (?)
ORDER BY h.id
