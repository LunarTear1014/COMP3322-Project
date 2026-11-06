-- Add contract metadata without assigning invented types to existing messages.
ALTER TABLE notifications
  ADD COLUMN booking_id INT NULL,
  ADD COLUMN type VARCHAR(40) NOT NULL DEFAULT 'legacy',
  ADD INDEX idx_notifications_unread (user_id,read_at,id),
  ADD CONSTRAINT fk_notifications_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
