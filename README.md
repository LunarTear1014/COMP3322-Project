# COMP3322 Project

The ClubSpace workspace contains the beta frontend, the original frontend, and the backend:

```text
frontend-beta/   Latest React + Vite application
frontend-alpha/  Original React + Vite application
backend-beta/    Express API and MySQL schema/demo data
```

The local request flow is:

```text
React frontend (port 5173) → Vite /api proxy → Express API (port 3000) → MySQL
```

## Deploy to the Group 19 server

Open **http://c3322-pg19.cs.hku.hk** over HKUVPN after deployment.
Compose builds the beta frontend and Express backend on the Ubuntu server and
runs them with MySQL. Only HTTP on port 80 is published. The MySQL data lives
in the Compose `db_data` volume.

1. Connect to HKUVPN, then paste this block on your Mac. It uploads the
   archive and opens an SSH session on the Group 19 server.

   ```bash
   workspace='/Volumes/Crucial P510 Gen 5 2TB NVMe 2280 M.2/Development/ClubSpace'
   scp -i "$workspace/.ssh/id_rsa" -o IdentitiesOnly=yes \
     -o "UserKnownHostsFile=$workspace/.ssh/known_hosts" \
     "$workspace/clubspace-pg19-server.tar.gz" ubuntu@c3322-pg19.cs.hku.hk:~/ &&
   ssh -i "$workspace/.ssh/id_rsa" -o IdentitiesOnly=yes \
     -o "UserKnownHostsFile=$workspace/.ssh/known_hosts" ubuntu@c3322-pg19.cs.hku.hk
   ```

2. Paste this block into the SSH session. It unpacks the archive, generates
   the deployment credentials, starts Compose, and provisions a regular
   member and a committee account. Later runs reuse the existing `.env`
   and starter accounts.

   ```bash
   (
     set -eu
     umask 022
     tar -xzf "$HOME/clubspace-pg19-server.tar.gz" -C "$HOME"
     cd "$HOME/clubspace-pg19"
     if [ ! -e .env ]; then
       db_root_password=$(openssl rand -hex 24)
       db_app_password=$(openssl rand -hex 24)
       app_session_secret=$(openssl rand -hex 32)
       (
         umask 077
         set -C
         printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_PASSWORD=%s\nSESSION_SECRET=%s\n' \
           "$db_root_password" "$db_app_password" "$app_session_secret" > .env
       )
     fi
     docker compose up -d --build
     curl -fsS --retry 20 --retry-all-errors --retry-delay 2 \
       --connect-timeout 2 --max-time 5 http://127.0.0.1/api/health
     printf '\n'
     if [ ! -e .starter-accounts-ready ]; then
       docker compose exec -T backend node src/ops/provision-starter-accounts.js
       touch .starter-accounts-ready
     fi
     docker compose ps
   )
   ```

   When the block finishes, open the HTTP URL in a browser.

### Starter accounts

Both accounts belong to Photography Society. Use the initial password shared
with the group.

| Account | Club role |
| --- | --- |
| `member@clubspace.test` | Regular member |
| `committee@clubspace.test` | Committee member with Organizer access |

### Give another account organizer access

The first boot creates the tables and starter clubs and venues. Register an
account on the website, then paste this block in the SSH session and enter
the account's email when prompted. Sign out and back in to see Organizer.

```bash
(
  set -eu
  cd "$HOME/clubspace-pg19"
  printf 'Registered organizer email: '
  IFS= read -r organizer_email
  docker compose exec -T -e ORGANIZER_EMAIL="$organizer_email" \
    backend node --input-type=module - <<'NODE'
import pool from './src/config/db.js';

try {
  const email = process.env.ORGANIZER_EMAIL.trim().toLowerCase();
  const [[target]] = await pool.execute(
    "SELECT u.id AS user_id, c.id AS club_id FROM users u CROSS JOIN clubs c WHERE u.email = ? AND c.name = 'Photography Society'",
    [email],
  );
  if (!target) throw new Error('Register this email on the website first.');
  await pool.execute(
    "INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'committee') ON DUPLICATE KEY UPDATE role = IF(role = 'president', 'president', 'committee')",
    [target.user_id, target.club_id],
  );
  console.log('Organizer access is ready for Photography Society.');
} finally {
  await pool.end();
}
NODE
)
```

Use `docker compose up -d --build` again for code updates. Keep the
`db_data` volume and back it up before schema changes. The initialization
scripts run only for an empty database.

## Local development

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
cd frontend-beta
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

The beta frontend proxies `/api` to `http://localhost:3000` for development and
build preview. Set `CLUBSPACE_API_TARGET` before starting Vite if the backend runs
elsewhere. The beta's live client uses the API provided by `backend-beta`.
Creating an event books the venue and publishes immediately on this provider.
See the [beta integration notes](frontend-beta/INTEGRATION.md) for fixture
preview and the planned v1 workflows.

## API routes

| Method | Route                         | Purpose                                    |
| ------ | ----------------------------- | ------------------------------------------ |
| `GET`  | `/api/health`                 | Confirm API-to-MySQL connectivity          |
| `GET`  | `/api/events`                 | Browse saved events                        |
| `GET`  | `/api/events/mine`             | List your joined, waitlisted, and past event participation (signed-in users) |
| `GET` | `/api/events/:event_id/participants` | List joined and waitlisted participants (organizing club committee or president) |
| `POST` | `/api/events`                 | Create an event and venue booking together (committee or president of the club) |
| `PATCH` | `/api/events/:event_id` | Edit an event and its booking (organizing club committee or president; notifies signups) |
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
Organizing club committee members and presidents can also edit event details.
Edits update the event and venue booking together, reject conflicting venue
times, update the event capacity to match the selected venue, and notify
participants and waitlisted users. They can view event participants, including
waitlisted users, from the event details.

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
