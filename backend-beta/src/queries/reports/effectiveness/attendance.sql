-- Check-in rows per event (pre-aggregated: one row per attendee, no joins).
SELECT event_id, user_id FROM event_attendance WHERE event_id IN (?)
