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
The server runs the `main` branch of
[the GitHub repository](https://github.com/LunarTear1014/COMP3322-Project),
cloned to `~/clubspace-pg19`; nothing is edited or uploaded by hand, so the
deployed code always matches GitHub. Compose builds the beta frontend and
Express backend on the Ubuntu server and runs them with MySQL. Only HTTP on
port 80 is published. The MySQL data lives in the Compose `db_data` volume.
The frontend talks only to `/api/v1`. On every `docker compose up`, a one-shot
`migrate` service applies the tracked migrations before the API and worker
start; on an empty database it builds the full v1 schema on top of
`schema.sql`.

1. Push the commits you want to deploy to `main` on GitHub. Connect to
   HKUVPN, then open an SSH session on the Group 19 server from your Mac:

   ```bash
   workspace='/Volumes/Crucial P510 Gen 5 2TB NVMe 2280 M.2/Development/ClubSpace'
   ssh -i "$workspace/.ssh/id_rsa" -o IdentitiesOnly=yes \
     -o "UserKnownHostsFile=$workspace/.ssh/known_hosts" ubuntu@c3322-pg19.cs.hku.hk
   ```

2. Paste this block into the SSH session. Use the same block for the first
   deployment and for every update. It:
   - clones the repository on the first run, or pulls the latest `main`
     (fast-forward only) on later runs. If `~/clubspace-pg19` holds an older
     archive deployment, it is moved aside and its `.env` is kept;
   - refuses to deploy if tracked files were edited on the server;
   - generates `.env` (database passwords and session secret) if it is
     missing;
   - backs up the database if it is running, then starts Compose;
   - waits for the demo data and prints the deployed commit.

   ```bash
   (
     set -eu
     umask 022
     repo=https://github.com/LunarTear1014/COMP3322-Project.git
     app="$HOME/clubspace-pg19"
     old=
     cd "$HOME"
     if [ ! -d "$app/.git" ]; then
       if [ -e "$app" ]; then
         old="$app-archive-$(date -u +%Y%m%dT%H%M%SZ)"
         mv "$app" "$old"
         printf 'Moved the old archive deployment to %s\n' "$old"
       fi
       git clone --branch main "$repo" "$app"
       if [ -n "$old" ] && [ -e "$old/.env" ]; then cp -p "$old/.env" "$app/.env"; fi
     fi
     cd "$app"
     if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
       printf 'Tracked files were edited on the server. Make the change on GitHub instead; discard it here with: git checkout -- .\n' >&2
       exit 1
     fi
     git checkout -q main
     git pull --ff-only origin main
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
     if docker compose ps --status running -q db | grep -q .; then
       mkdir -p "$HOME/clubspace-backups"
       backup="$HOME/clubspace-backups/clubspace-$(date -u +%Y%m%dT%H%M%SZ).sql"
       (
         umask 077
         docker compose exec -T db sh -c 'exec mysqldump --single-transaction --routines --triggers -u root -p"$MYSQL_ROOT_PASSWORD" clubspace' > "$backup"
       )
       test -s "$backup"
       printf 'Database backup: %s\n' "$backup"
     fi
     docker compose up -d --build
     curl -fsS --retry 20 --retry-all-errors --retry-delay 2 \
       --connect-timeout 2 --max-time 5 http://127.0.0.1/api/health
     printf '\n'
     docker wait "$(docker compose ps -a -q seed)" >/dev/null
     docker compose logs --no-log-prefix seed
     docker compose ps -a
     git log -1 --format='Deployed %h (%cs): %s'
   )
   ```

   When the block finishes, open the HTTP URL in a browser and sign in with a
   demo account below. The block needs `git` on the server (`git --version`); Ubuntu server images
   include it. Run `docker image prune -f` and `docker builder prune -f` now and
   then to free disk space from old images and builds.

### Demo accounts and data

On an empty database the one-shot `seed` service
([`backend-beta/src/ops/demo_seed.js`](backend-beta/src/ops/demo_seed.js))
creates 5 clubs, 5 venues and 25 events through the real API: 6 past events
with check-ins (for the reports), 15 upcoming events (one full with a
waitlist, members-only events with pending requests), one cancelled event and
three still in the approval workflow. Every account uses the password
**`clubspacetest123`**; the names are fictional and the addresses use the
reserved `.example` domain. To use another password, add
`DEMO_ACCOUNT_PASSWORD=...` (12+ characters) to `.env` before the first
deployment; `DEMO_ACCOUNT_PASSWORD=` with no value deploys without demo data.
The repository is public, so anyone on HKUVPN who reads this can sign in to
the demo accounts, including the venue administrator.

| Account | Role |
| --- | --- |
| `admin@clubspace.example` | Venue administrator (approves venue requests) |
| `president.<club>@clubspace.example` | President |
| `committee1.<club>@clubspace.example`, `committee2.<club>@…` | Committee |
| `member1.<club>@clubspace.example` to `member3.<club>@…` | Member |
| `student1@clubspace.example` to `student6@…` | Student with no club (1 to 3 have a pending join request) |

`<club>` is `photo` (Photography Society), `film` (Film Society), `debate`
(Debate Club), `hiking` (Hiking Club) or `robotics` (Robotics Lab). Good
places to start: `president.photo` has an event awaiting sign-off,
`committee1.debate` has one waiting for the president to publish,
`admin` has a venue request to decide, and the Hiking Club's Lion Rock
Sunrise Hike is full with two people on the waitlist.

### Give another account organizer access

Normally the club's president appoints committee members in the app
(Organizer → Your clubs → Members and roles). For an operator override,
register an account on the website, then paste this block in the SSH session
and enter the account's email when prompted. Sign out and back in to see
Organizer.

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

### Event cover images and migrations

Event cover images are stored under `COVER_DIR` (`/app/data/covers` in the
backend container) on the named Docker volume `cover_data`. Back it up with
the database volume: `docker run --rm -v clubspace-pg19_cover_data:/data -v
"$PWD":/backup alpine tar -czf /backup/covers.tgz -C /data .`. A scheduled
sweep removes files that no event references.

Schema changes after the beta baseline are ordered migrations in
`backend-beta/db/migrations`. The `migrate` Compose service runs them on every
`docker compose up`, before the API and worker start; back up the database
before deploying a release that adds one. The runner takes a
database lock, verifies the checksum of each applied file, and records each
version only after it finishes. Set `MIGRATION_DB_USER` and
`MIGRATION_DB_PASSWORD` when the application account has no DDL rights.
`APP_ORIGIN` (default `http://c3322-pg19.cs.hku.hk`) must match the address
users open, because the v1 API rejects other origins.

### Worker, provisioning and testing

The `worker` Compose service sends reminders and daily club digests, and keeps a
heartbeat in `worker_heartbeats`; run exactly one. The demo data covers
accounts on a fresh database. For a database without it, give every club
without a president a generated fictional one with
`docker compose exec backend node src/ops/provision-dev.js` (set
`DEV_ACCOUNT_PASSWORD` or note the generated password it prints once). The first
migration of a database with legacy bookings needs
`LEGACY_DATETIME_TIMEZONE=Asia/Taipei` to be set to confirm how times were stored.

Backend tests: `cd backend-beta && npm test` runs the unit tests. The database
tests run only against a disposable database: create one (its name must contain
`test`), put `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD`
and `TEST_DB_NAME` in a file outside the repository, and run
`TEST_ENV_FILE=/path/to/that/file npm test`. The tests drop and recreate tables
inside that database only and refuse `DB_NAME` or any name without `test`.
Frontend tests: `cd frontend-beta && npm test`, `npm run lint`, `npm run build`.

### Assign a venue administrator

Register a separate account on the website first. An administrator who is also
committee for a club cannot decide that club's requests. Run this after the
migrations, because they add `platform_role`. In the server SSH session, paste
this block and enter the registered administrator's email:

```bash
(
  set -eu
  cd "$HOME/clubspace-pg19"
  printf 'Registered venue administrator email: '
  IFS= read -r administrator_email
  docker compose exec -T -e ADMIN_EMAIL="$administrator_email" backend node --input-type=module - <<'NODE'
import pool from './src/config/db.js';
try {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const [result] = await pool.execute("UPDATE users SET platform_role='venue_admin' WHERE email=?", [email]);
  if (!result.affectedRows) throw new Error('Register this email on the website first.');
  console.log('Venue administrator access is ready.');
} finally { await pool.end(); }
NODE
)
```

### Retry a failed notification job

A job that used up its attempts stays `failed` and is never retried on its own.
After fixing the cause, queue it again; the command writes an audit entry with
the operator name you give:

```bash
docker compose exec -T backend node src/ops/retry-notification-job.js JOB_ID "your name"
```

### Start over with a fresh database

This deletes every account, club, event, notification and uploaded cover on
the server. Back up first if anything should be kept. In the server SSH
session:

```bash
(
  set -eu
  cd "$HOME/clubspace-pg19"
  mkdir -p "$HOME/clubspace-backups"
  if docker compose ps --status running db | grep -q db; then
    umask 077
    docker compose exec -T db sh -c 'exec mysqldump --single-transaction --routines --triggers -u root -p"$MYSQL_ROOT_PASSWORD" clubspace' \
      > "$HOME/clubspace-backups/clubspace-before-reset-$(date -u +%Y%m%dT%H%M%SZ).sql"
  fi
  docker compose down -v
)
```

Then run step 2 above again. It rebuilds the images, creates the schema and
catalog, runs the migrations and creates the demo accounts and events.

### Update the deployment

Push to `main` on GitHub, then run step 2 again. It backs up the database,
pulls the new commits and rebuilds; the `migrate` service applies any new
migrations before the API and worker start, and the demo data is left alone.

If `migrate` exits with an error, the API and worker do not start; read
`docker compose logs migrate`. The runner refuses a changed checksum or an
interrupted migration; do not blindly retry. Restore the backup or inspect
the partial schema before continuing. A database that still holds beta-era
bookings (stored as UTC+8 local time) needs `LEGACY_DATETIME_TIMEZONE=Asia/Taipei`
in `.env` for its first migration; a fresh database needs nothing.

## Beta interview submission

The course guideline requires the beta source code as a ZIP file in the
Moodle submission box before the interview starts. It also requires the beta
source to be committed and pushed to the team GitHub repository using a tag.

Prepare the ZIP from the final, tagged beta source so it contains the
proposal, frontend, backend, database schema, Dockerfiles, Compose file, and
README. Keep generated dependencies, database volumes, SSH keys, and real
secrets out of the ZIP. The server deploys straight from GitHub (see
"Deploy to the Group 19 server").

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

   For an existing beta database, first apply the legacy SQL files in order; they preserve
   existing records, add club join-request notifications, notify organizers
   about any join requests already pending, and create the club action log.
   The action log records actions from the time migration 004 is applied. With
   the MySQL CLI:

   ```bash
   mysql -u clubspace_app -p clubspace < backend-beta/db/legacy-sql/001-normalize-event-registration-statuses.sql
   mysql -u clubspace_app -p clubspace < backend-beta/db/legacy-sql/002-club-join-request-notifications.sql
   mysql -u clubspace_app -p clubspace < backend-beta/db/legacy-sql/003-backfill-pending-join-request-notifications.sql
   mysql -u clubspace_app -p clubspace < backend-beta/db/legacy-sql/004-club-action-log.sql
   ```

   Then apply the tracked migrations, after a backup, with
   `cd backend-beta && LEGACY_DATETIME_TIMEZONE=Asia/Taipei node src/ops/migrate.js`.

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

The frontend uses only the versioned API under `/api/v1`; its contract is in
[`handoff/api.md`](openspec/changes/expand-clubspace-workflows/handoff/api.md)
and [`handoff/beta-feedback.md`](openspec/changes/expand-clubspace-workflows/handoff/beta-feedback.md).
The unversioned beta routes below stay mounted for compatibility only; no page
calls them, and new features exist only on `/api/v1`.

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

This demonstrates the React → Express → MySQL → React path.

## Reset local demo data

To reset local project data, stop the API and run `schema.sql` followed by
`seed.sql` again using your MySQL client. This permanently removes local rows
created after the last seed, including test bookings and events.
