-- Apply once to an existing beta database before deploying the matching API.
-- MySQL DDL commits implicitly; take and verify a backup first.
-- This expands the enum without changing any existing rows.
ALTER TABLE participations
  MODIFY COLUMN status ENUM('joined', 'left', 'waitlisted', 'cancelled')
  NOT NULL DEFAULT 'joined';
