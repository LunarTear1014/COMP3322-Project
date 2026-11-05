-- Catalog for a new server database. The deployment steps provision starter accounts.
INSERT INTO clubs (name, description) VALUES
  ('Photography Society', 'A campus community for students interested in photography.'),
  ('Film Society', 'Film screenings and discussions for university students.'),
  ('Debate Club', 'Practice debates and public-speaking workshops.');

INSERT INTO venues (name, location, capacity, description) VALUES
  ('Lok Yew Hall', 'Main Campus', 80, 'A flexible hall for student activities.'),
  ('Main Building Room 230', 'Main Building', 35, 'A seminar room in the Main Building.'),
  ('GoldenScene Cinema', 'Kennedy Town', 120, 'A cinema for screenings and talks.');
