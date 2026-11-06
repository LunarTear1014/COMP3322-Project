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
     "$workspace/clubspace-pg19-server-20261106.tar.gz" ubuntu@c3322-pg19.cs.hku.hk:~/ &&
   ssh -i "$workspace/.ssh/id_rsa" -o IdentitiesOnly=yes \
     -o "UserKnownHostsFile=$workspace/.ssh/known_hosts" ubuntu@c3322-pg19.cs.hku.hk
   ```

2. For a **new, empty server database**, paste this block into the SSH session.
   It unpacks the archive, creates credentials, starts Compose, and provisions
   a regular member and a committee account. For an existing database, use
   the redeployment procedure below instead.

   ```bash
   (
     set -eu
     umask 022
     tar -xzf "$HOME/clubspace-pg19-server-20261106.tar.gz" -C "$HOME"
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

Keep the `db_data` volume. The initialization scripts run only for an empty
database; use the redeployment procedure below when updating an existing one.

### Assign a venue administrator

Register a separate account first. An administrator who is also committee
for a club cannot decide that club's requests. In the server SSH session,
paste this block and enter the registered administrator's email:

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

### Redeploy an updated archive

Upload the updated `clubspace-pg19-server-20261106.tar.gz` using the Mac commands
above. This procedure stops the application, saves a database backup, then
runs the tracked migrations. The `--legacy-hkt` flag records that the prior
beta's event datetimes were Hong Kong local time. If that is not true for your
database, stop and investigate before running it.

```bash
(
  set -eu
  tar -xzf "$HOME/clubspace-pg19-server-20261106.tar.gz" -C "$HOME"
  cd "$HOME/clubspace-pg19"
  docker compose stop web backend worker
  docker compose up -d db
  attempts=0
  until docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -u "$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT 1" >/dev/null 2>&1'; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      printf 'Database did not become ready. Check docker compose logs db.\n' >&2
      exit 1
    fi
    sleep 2
  done
  mkdir -p "$HOME/clubspace-backups"
  backup="$HOME/clubspace-backups/clubspace-$(date -u +%Y%m%dT%H%M%SZ).sql"
  umask 077
  docker compose exec -T db sh -c 'exec mysqldump --single-transaction --routines --triggers -u root -p"$MYSQL_ROOT_PASSWORD" clubspace' > "$backup"
  test -s "$backup"
  docker compose build backend
  docker compose run --rm --no-deps backend node src/ops/migrate-workflows.js --legacy-hkt
  docker compose up -d --build
  curl -fsS --retry 20 --retry-all-errors --retry-delay 2 \
    --connect-timeout 2 --max-time 5 http://127.0.0.1/api/health
  printf '\n'
  docker compose ps
  printf 'Database backup: %s\n' "$backup"
)
```

The server's existing `.env` and database volume supply its credentials and
data. If the MySQL recovery setup uses `compose.override.yaml` and the
`db_recovery` volume, keep that override in the project directory for
subsequent deployments. The migration runner refuses a changed checksum or an
interrupted migration; do not blindly retry after such an error. The backup
must be restored or the partial schema inspected before continuing.

Before applying the first migration to an older database, the runner checks
relationships, booking overlaps, capacities, waitlist size, normalized
identities and event/booking states. If it reports records requiring repair,
keep the application stopped and resolve them with a database backup available.
This release retains Hong Kong local event datetimes; `--legacy-hkt` confirms
that storage convention and does not convert existing dates to UTC. The planned
OpenSpec UTC backfill and its verification are still outstanding.

## Beta interview submission

The course guideline requires the beta source code as a ZIP file in the
Moodle submission box before the interview starts. It also requires the beta
source to be committed and pushed to the team GitHub repository using a tag.

Prepare the ZIP from the final, tagged beta source so it contains the
proposal, frontend, backend, database schema, Dockerfiles, Compose file, and
README. Keep generated dependencies, database volumes, SSH keys, and real
secrets out of the ZIP. The server transfer `.tar.gz` is the deployment
package.

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
   APP_ORIGIN=http://localhost:5173
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
Creating an event submits a pending venue request and private draft; an independent venue administrator must approve it before the organizer can publish. See the [beta integration notes](frontend-beta/INTEGRATION.md) for fixture preview.

## API routes

The beta frontend uses the versioned `/api/v1` business API. See the [API documentation](backend-beta/API.md) for authentication, sessions, events, venue review, memberships, notifications and reports. `GET /api/health` remains available for health checks. Earlier unversioned business routes return `410 API_VERSION_RETIRED`.

Committee members submit event and venue requests. An independent venue administrator reviews the request; approval leaves the event as a draft until the organizer publishes it. Club membership requires committee approval. Public event registrations are automatic; for members-only events the committee reviews join requests before places or waitlist positions are assigned. Eligible waitlisted members are promoted when a place becomes available. A background worker delivers in-app notifications and reminders.

## Verify the end-to-end flow

1. Start MySQL, the API, and the frontend.
2. In the frontend, choose an available venue and time slot.
3. As a committee member, create an event with a future date.
4. Sign in as an independent venue administrator and approve the request, then sign in as the organizer and publish the event.
5. Refresh the Events and Venues pages and confirm the saved rows in a SQL client:

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
