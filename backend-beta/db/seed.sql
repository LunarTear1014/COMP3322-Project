INSERT INTO clubs (name, description) VALUES
  ('Photography Society', 'A campus community for students interested in photography.'),
  ('Film Society', 'Film screenings and discussions for university students.'),
  ('Debate Club', 'Practice debates and public-speaking workshops.');

INSERT INTO venues (name, location, capacity, description) VALUES
  ('Lok Yew Hall', 'Main Campus', 80, 'A flexible hall for student activities.'),
  ('Main Building Room 230', 'Main Building', 35, 'A seminar room in the Main Building.'),
  ('GoldenScene Cinema', 'Kennedy Town', 120, 'A cinema for screenings and talks.');

-- Development-only demo accounts. Passwords: CharlieLocal2026! and
-- OrganizerLocal2026! respectively.
INSERT INTO users (email, password_hash, name, student_id) VALUES
  ('charlie@example.com', '232c0fa173295bd8f6ebe22978c9fbe5:5ad08920e1c270163fdd5b410fbb966fc09ed3e4de4265e899738b8b64813d584c96d5683473e4f107dd0d6baf011bfa9af20bef3235786a181190be723063b3', 'Charlie Chan', 'S0000001'),
  ('organizer@example.com', '1d7fb7f0939660b36734642fddcd67a0:2ce7718aa8b020350a5496f1ed737b08507dc6d7bf5b7c49f4ac1f62d46ec8e66fe9775ebff31875bcee1c2600abc7608fe42d719c2ddc83b19687cadfb9c6be', 'Alex Organizer', 'S0000002');

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
