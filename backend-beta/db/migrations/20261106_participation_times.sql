-- Preserve known registration times; legacy confirmation times are unknown.
ALTER TABLE participations
  ADD COLUMN last_registered_at TIMESTAMP(6) NULL DEFAULT NULL,
  ADD COLUMN queued_at TIMESTAMP(6) NULL DEFAULT NULL,
  ADD COLUMN confirmed_at TIMESTAMP(6) NULL DEFAULT NULL,
  DROP INDEX idx_participations_waitlist_order,
  ADD INDEX idx_participations_waitlist_order (event_id,status,queued_at,user_id);
UPDATE participations SET last_registered_at=joined_at,
  queued_at=IF(status='waitlisted',joined_at,NULL);
