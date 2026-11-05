# COMP3322 Project — Local setup

The active ClubSpace application is split into three parts:

```text
frontend-alpha/  React + Vite single-page application
backend-beta/    Express API and MySQL schema/demo data
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

3. Run [`backend-beta/db/schema.sql`](backend-beta/db/schema.sql), then
   [`backend-beta/db/seed.sql`](backend-beta/db/seed.sql), against the `clubspace` database. In a
   GUI client, open each file and execute all queries. With the MySQL CLI:

   ```bash
   mysql -u clubspace_app -p clubspace < backend-beta/db/schema.sql
   mysql -u clubspace_app -p clubspace < backend-beta/db/seed.sql
   ```

   > `schema.sql` drops and recreates the project tables. Use it only when you
   > intentionally want to reset local development data.

4. Create the untracked local backend configuration:

   ```bash
   cd backend-beta
   cp .env.example .env
   ```

   Update the password in `.env` to match the one used for `clubspace_app`:

   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_NAME=clubspace
   DB_USER=clubspace_app
   DB_PASSWORD=choose-a-local-password
   SESSION_SECRET=choose-a-random-local-secret
   ```

   `.env` is ignored by Git and must never be committed.

## Run locally

Open two terminals from the repository root.

### Terminal 1 — API

```bash
cd backend-beta
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
{ "status": "ok" }
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

## API routes

| Method | Route                         | Purpose                                    |
| ------ | ----------------------------- | ------------------------------------------ |
| `GET`  | `/api/health`                 | Confirm API-to-MySQL connectivity          |
| `GET`  | `/api/events`                 | Browse saved events                        |
| `POST` | `/api/events`                 | Create an event and venue booking together (committee or president of the club) |
| `DELETE` | `/api/events/:event_id` | Cancel an event (organizing club committee or president; notifies signups) |
| `GET` | `/api/notifications` | List signed-in user's notifications |
| `PATCH` | `/api/notifications/:notification_id/read` | Mark a notification as read |
| `GET`  | `/api/venues?date=YYYY-MM-DD` | Show venue availability for a date         |
| `GET`  | `/api/clubs`                  | Browse clubs and your membership roles     |
| `POST` | `/api/clubs`                  | Create a club (creator becomes president)   |
| `GET`  | `/api/memberships`            | List your club memberships                 |
| `POST` | `/api/clubs/:club_id/membership` | Request to join a club                   |
| `GET`  | `/api/clubs/:club_id/join-requests` | List pending requests (committee or president) |
| `POST` | `/api/clubs/:club_id/join-requests/:request_id/review` | Accept or reject a request |
| `DELETE` | `/api/clubs/:club_id/membership` | Leave a club                            |
| `DELETE` | `/api/clubs/:club_id/committee` | Leave the committee but remain a member |
| `GET`  | `/api/clubs/:club_id/members` | List club members (committee only)          |
| `POST` | `/api/clubs/:club_id/members/:user_id/committee` | Promote a member to committee (committee or president) |
| `DELETE` | `/api/clubs/:club_id/members/:user_id/committee` | President demotes committee member to regular member |
| `POST` | `/api/clubs/:club_id/presidency` | Transfer presidency to an existing committee member (requires typing the club name) |
| `DELETE` | `/api/clubs/:club_id`       | Delete a club and its events/bookings (president only; requires typing the club name) |
| `POST` | `/api/auth/register`          | Create an account with name, email, student ID, and password |
| `POST` | `/api/auth/login`             | Log in with email and password             |
| `GET`  | `/api/auth/me`                | Return the currently logged-in account     |
| `PUT`  | `/api/auth/me`                | Update name/email; password changes require current password |
| `DELETE` | `/api/auth/me`              | Delete the account and its memberships and event signups (requires password) |
| `POST` | `/api/auth/logout`            | Log out                                    |

Passwords are stored as salted scrypt hashes. Login state uses a local
in-memory session and is cleared when the API restarts; account records remain
in MySQL. Logged-in committee members and presidents can view their club's
roster or promote members to committee. Club creators become president;
presidents can transfer the role to a committee member or delete their club.
Both destructive actions require typing the exact club name. Registration and password changes
require matching confirmation fields. Changing a password and deleting an
account require the current password; editing a name or email does not.
Deleting an account also removes its memberships and event signups through the
database foreign-key cascades. Committee members can leave their committee
role while remaining ordinary club members; the roster is loaded on demand
inside a collapsible list and can be filtered by member name.
Joining a club requires a signed-in user to request membership. Requests are
stored in `club_join_requests`; club committee members and presidents receive
an in-app pending-request count and can accept or reject requests. Accepting
creates a regular membership, while a rejected user can request again.

The API validates requests and returns `422` for invalid input and `409` when a
venue time slot is already booked.
Only signed-in committee members and presidents can book venues and create
events for clubs where they hold those roles. A user with those roles in
multiple clubs can book for any of them; regular members can still join events
but cannot make venue bookings.
Event signups are capped at the venue capacity recorded for the event. Full
events show an `Event full` label and allow users to join the waitlist. When a
joined participant leaves, the earliest waitlisted participant is promoted
automatically. Waitlist order is based on signup time, and users can leave the
waitlist at any time. Joining an event or its waitlist requires signing in.
Organizing club committee members and presidents can cancel their events.
Cancellation releases the venue booking and creates persistent in-app
notifications for all current participants and waitlisted users. Signed-in
users can see and mark notifications as read on the Events page.

## Verify the end-to-end flow

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
