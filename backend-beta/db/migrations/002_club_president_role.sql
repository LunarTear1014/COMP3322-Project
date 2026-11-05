ALTER TABLE memberships
  MODIFY COLUMN role ENUM('member', 'committee', 'president')
  NOT NULL DEFAULT 'member';
