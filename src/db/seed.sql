INSERT INTO clubs (name, description) VALUES
  ('Photography Society', 'A campus community for students interested in photography.'),
  ('Film Society', 'Film screenings and discussions for university students.'),
  ('Debate Club', 'Practice debates and public-speaking workshops.');

INSERT INTO venues (name, location, capacity, description) VALUES
  ('Lok Yew Hall', 'Main Campus', 80, 'A flexible hall for student activities.'),
  ('Main Building Room 230', 'Main Building', 35, 'A seminar room in the Main Building.'),
  ('GoldenScene Cinema', 'Kennedy Town', 120, 'A cinema for screenings and talks.');

-- These demo accounts are only for the Alpha environment. Authentication will
-- replace the placeholder password hashes before Beta.
INSERT INTO users (email, password_hash, name, student_id, role) VALUES
  ('charlie@example.com', 'alpha-demo-only', 'Charlie Chan', 'S0000001', 'student'),
  ('organizer@example.com', 'alpha-demo-only', 'Alex Organizer', 'S0000002', 'admin');

INSERT INTO memberships (user_id, club_id, role)
SELECT 2, id, 'committee' FROM clubs WHERE name = 'Photography Society';

INSERT INTO bookings (venue_id, club_id, start_time, end_time)
SELECT v.id, c.id,
  TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 5 DAY), '16:00:00'),
  TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 5 DAY), '18:00:00')
FROM venues v CROSS JOIN clubs c
WHERE v.name = 'Lok Yew Hall' AND c.name = 'Photography Society';

INSERT INTO bookings (venue_id, club_id, start_time, end_time)
SELECT v.id, c.id,
  TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '16:00:00'),
  TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '18:00:00')
FROM venues v CROSS JOIN clubs c
WHERE v.name = 'GoldenScene Cinema' AND c.name = 'Film Society';

INSERT INTO bookings (venue_id, club_id, start_time, end_time)
SELECT v.id, c.id,
  TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '13:00:00'),
  TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '15:00:00')
FROM venues v CROSS JOIN clubs c
WHERE v.name = 'Main Building Room 230' AND c.name = 'Debate Club';

INSERT INTO events (booking_id, club_id, title, description, start_time, end_time, visibility, capacity)
SELECT b.id, b.club_id, 'Photography Society Gathering',
  'A casual photography walk for students interested in taking better campus photos.',
  b.start_time, b.end_time, 'public', v.capacity
FROM bookings b
JOIN clubs c ON c.id = b.club_id
JOIN venues v ON v.id = b.venue_id
WHERE c.name = 'Photography Society';

INSERT INTO events (booking_id, club_id, title, description, start_time, end_time, visibility, capacity)
SELECT b.id, b.club_id, 'Film Society Screening',
  'Watch a selected film with other students, followed by a group discussion.',
  b.start_time, b.end_time, 'members_only', v.capacity
FROM bookings b
JOIN clubs c ON c.id = b.club_id
JOIN venues v ON v.id = b.venue_id
WHERE c.name = 'Film Society';

INSERT INTO events (booking_id, club_id, title, description, start_time, end_time, visibility, capacity)
SELECT b.id, b.club_id, 'Debate Club Meeting',
  'A practice debate for students who want to improve public-speaking skills.',
  b.start_time, b.end_time, 'public', v.capacity
FROM bookings b
JOIN clubs c ON c.id = b.club_id
JOIN venues v ON v.id = b.venue_id
WHERE c.name = 'Debate Club';
