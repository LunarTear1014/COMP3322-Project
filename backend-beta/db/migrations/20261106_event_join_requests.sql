CREATE TABLE event_join_requests (
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('pending','accepted','rejected','withdrawn','cancelled') NOT NULL DEFAULT 'pending',
    allow_waitlist BOOLEAN NOT NULL DEFAULT TRUE,
    requested_at DATETIME(6) NOT NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME(6) NULL,
    PRIMARY KEY (event_id,user_id),
    INDEX idx_event_requests_pending (event_id,status,requested_at,user_id),
    CONSTRAINT fk_event_request_event FOREIGN KEY (event_id) REFERENCES events(id),
    CONSTRAINT fk_event_request_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_event_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
