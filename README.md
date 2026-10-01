# COMP3322 Project — Alpha local setup

This repository contains the Alpha ClubSpace prototype. The active application
is split into three parts:

```text
frontend-alpha/  React + Vite single-page application
backend-alpha/   Express API
src/db/          MySQL schema and repeatable demo data
```

The local request flow is:

```text
React frontend (port 5173) → Vite /api proxy → Express API (port 3000) → MySQL
```

## Prerequisites

- Node.js 22 or later
- MySQL running locally on port `3306`
- A MySQL client, such as the `mysql` command-line client, MySQL Workbench, or
  Sequel Ace

If MySQL is not installed yet, install and start it using your operating
system's preferred package manager or installer. For example, on macOS with
Homebrew:

```bash
brew install mysql
brew services start mysql
```

## First-time database setup

1. Connect to your local MySQL server with an administrative account. This can
   be done through any SQL client. With the MySQL command-line client, for
   example:

   ```bash
   mysql -u root -p
   ```

   Use your installation's host, port, and root-password settings. A fresh
   Homebrew MySQL installation commonly starts with an empty root password.

2. Create the project database and its application user. Replace
   `choose-a-local-password` with a private local password.

   ```sql
   CREATE DATABASE IF NOT EXISTS clubspace
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci;

   CREATE USER IF NOT EXISTS 'clubspace_app'@'localhost'
     IDENTIFIED BY 'choose-a-local-password';

   CREATE USER IF NOT EXISTS 'clubspace_app'@'127.0.0.1'
     IDENTIFIED BY 'choose-a-local-password';

   GRANT ALL PRIVILEGES ON clubspace.* TO 'clubspace_app'@'localhost';
   GRANT ALL PRIVILEGES ON clubspace.* TO 'clubspace_app'@'127.0.0.1';
   FLUSH PRIVILEGES;
   ```

3. Run [`src/db/schema.sql`](src/db/schema.sql), then
   [`src/db/seed.sql`](src/db/seed.sql), against the `clubspace` database. In a
   GUI client, open each file and execute all queries. With the MySQL CLI:

   ```bash
   mysql -u clubspace_app -p clubspace < src/db/schema.sql
   mysql -u clubspace_app -p clubspace < src/db/seed.sql
   ```

   > `schema.sql` drops and recreates the project tables. Use it only when you
   > intentionally want to reset local development data.

4. Create the untracked local backend configuration:

   ```bash
   cp .env.example .env
   ```

   Update the password in `.env` to match the one used for `clubspace_app`:

   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_NAME=clubspace
   DB_USER=clubspace_app
   DB_PASSWORD=choose-a-local-password
   DEMO_USER_ID=1
   ```

   `.env` is ignored by Git and must never be committed.

## Run locally

Open two terminals from the repository root.

### Terminal 1 — API

```bash
cd backend-alpha
npm install
npm run dev
```

The API is ready when the terminal prints:

```text
API on http://localhost:3000
```

Verify the database connection at:

```text
http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok"}
```

### Terminal 2 — frontend

```bash
cd frontend-alpha
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

`frontend-alpha/vite.config.js` proxies browser requests beginning with `/api`
to the API at `http://localhost:3000`, so no API URL or browser CORS setup is
needed for local development.

## Alpha API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Confirm API-to-MySQL connectivity |
| `GET` | `/api/events` | Browse saved events |
| `POST` | `/api/events` | Create an event and venue booking together |
| `GET` | `/api/venues?date=YYYY-MM-DD` | Show venue availability for a date |
| `GET` | `/api/profile` | Load the Alpha demo profile |
| `PUT` | `/api/profile` | Update the Alpha demo profile |

The API validates requests and returns `422` for invalid input and `409` when a
venue time slot is already booked.

## Verify the end-to-end Alpha flow

1. Start MySQL, the API, and the frontend.
2. In the frontend, choose an available venue and time slot.
3. Create an event with a future date.
4. Refresh the Events and Venues pages.
5. In any SQL client, confirm the saved rows:

   ```sql
   SELECT e.id, e.title, c.name AS club, v.name AS venue, e.start_time
   FROM events e
   JOIN clubs c ON c.id = e.club_id
   JOIN bookings b ON b.id = e.booking_id
   JOIN venues v ON v.id = b.venue_id
   ORDER BY e.id;
   ```

This demonstrates the required React → Express → MySQL → React Alpha path.

## Reset local demo data

To reset local project data, stop the API and run `schema.sql` followed by
`seed.sql` again using your MySQL client. This permanently removes local rows
created after the last seed, including test bookings and events.
