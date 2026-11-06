-- One-time additive migration for worker health reporting.
CREATE TABLE worker_heartbeats (
  worker_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  PRIMARY KEY (worker_id)
) ENGINE=InnoDB;
