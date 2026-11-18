# ClubSpace

**University club event and venue management platform.** COMP3322 Group
Project, Group 19 (PG19).

| | |
| --- | --- |
| **Live deployment** | **https://c3322-pg19.cs.hku.hk** (connect to HKUVPN first; the certificate is self-signed, so accept the browser warning once) |
| Demo password | `clubspacetest123` for every [demo account](#demo-accounts) |
| Source | https://github.com/LunarTear1014/COMP3322-Project (`main` is what is deployed) |
| Proposal | [`proposal/Proposal.md`](proposal/Proposal.md) |
| Architecture and ER diagram | [`ARCHITECTURE.md`](ARCHITECTURE.md) |

**Contents:**
[Overview](#overview) ·
[Course requirements](#how-clubspace-meets-the-course-requirements) ·
[Architecture](#architecture) ·
[Demo accounts](#demo-accounts) ·
[Rebuild from scratch (TAs)](#rebuild-from-scratch-for-tas-and-examiners) ·
[Group 19 server](#deploy-to-the-group-19-server) ·
[Operations](#operations) ·
[Local development](#local-development) ·
[Tests](#tests) ·
[API](#api) ·
[Credits](#credits-and-academic-integrity)

## Overview

ClubSpace coordinates university club events, venue requests and student
participation. Club committee members prepare events and request venues; the
club president signs off; a venue administrator approves the booking without
double-booking a room; the event is then published. Students browse events,
register (or join a waitlist when an event is full), check in on the day, and
get live notifications. Club leaders see attendance and effectiveness
reports.

Team (details in the [proposal](proposal/Proposal.md)): Chan Ka Ho Charlie,
Lucien Balthazar Neale, Chan Ka Hei Aubrey.

### Features

- **Accounts:** register, sign in, edit a profile, delete an account. Sessions
  are cookies stored in MySQL, with CSRF tokens and origin checks on every
  change.
- **Clubs and roles:** members, committee and one president per club. Joining
  a club is a request that the committee accepts or rejects. The president
  promotes committee members and can hand over the presidency.
- **Venues and bookings:** weekly venue calendars with three campus slots
  (10:00–12:00, 13:00–15:00, 16:00–18:00 HKT). A venue administrator approves or
  rejects requests; one confirmed booking per venue and slot is enforced in the
  database, and an administrator cannot decide their own club's request.
- **Event workflow:** draft → president sign-off → venue approval → publish,
  with edit, cancel, cover images (JPEG/WebP up to 5 MB), campus and club tags,
  and public or members-only visibility.
- **Participation:** registration with capacity limits and an automatically
  promoted waitlist; requests to join members-only events; check-in codes
  during the event window; "My registrations".
- **Real-time updates:** Server-Sent Events push notifications, seat counts,
  waitlist changes and check-ins to open pages without a reload.
- **Background worker:** event reminders, daily club digests and clean-up jobs,
  with retries and a heartbeat.
- **Reports:** attendance and effectiveness charts per club (fill rate,
  turnout, drop-outs, view-to-join).
- **Club action log:** a history of committee actions with undo.
- **Credits page** at `/credits` for third-party libraries and assets.

## How ClubSpace meets the course requirements

| Requirement | ClubSpace |
| --- | --- |
| SPA with React, Angular or Vue 3; responsive | React 19 + React Router 7 + MUI, built with Vite ([`frontend-beta/`](frontend-beta/)); layouts adapt from phone to desktop with bottom tabs on small screens |
| Node.js + Express RESTful API with correct status codes | Express 5 ([`backend-beta/`](backend-beta/)), versioned REST API under `/api/v1` using 200, 201, 202, 204, 400, 401, 403, 404, 409, 413, 415, 422, 429, 500 and 503 (see [API](#api)) |
| MySQL only | MySQL 8.4; schema in [`backend-beta/db/schema.sql`](backend-beta/db/schema.sql) plus ordered migrations in [`backend-beta/db/migrations/`](backend-beta/db/migrations/) |
| Docker Compose on a Linux VM | [`compose.yaml`](compose.yaml) with [`frontend-beta/Dockerfile`](frontend-beta/Dockerfile) and [`backend-beta/Dockerfile`](backend-beta/Dockerfile); starts with `docker compose up -d --build`; MySQL port 3306 is not published |
| No real secrets committed | `.env` is git-ignored; [`.env.example`](.env.example) is the template and the deployment steps generate random passwords |
| README with the public deployment URL and deployment instructions | This file: [live URL](#clubspace), [rebuild guide](#rebuild-from-scratch-for-tas-and-examiners) |
| Credits page for third-party code | `/credits` in the app ([`Credits.jsx`](frontend-beta/src/pages/Credits.jsx)) |

## Architecture

```text
Browser ──HTTPS :443──▶ web (nginx: built React SPA, proxies /api/; :80 redirects)
                           │
                           ▼
                      backend (Express, /api/v1, SSE stream) ──▶ db (MySQL 8.4, volume db_data)
                      worker  (reminders, digests, clean-up)  ──▶ db
                      migrate (one-shot: applies schema migrations)
                      seed    (one-shot: demo data on an empty database)
```

Cover images live on the `cover_data` volume shared by `backend` and `worker`.
The ER diagram and design notes are in [`ARCHITECTURE.md`](ARCHITECTURE.md).

```text
frontend-beta/   React + Vite SPA, its Dockerfile and nginx/ config
backend-beta/    Express API, worker, ops scripts, MySQL schema, migrations, tests
openspec/        Specifications and the v1 API contract
proposal/        Project proposal
compose.yaml     Docker Compose deployment (all six services)
.env.example     Template for the untracked .env
```

## Demo accounts

On an empty database the one-shot `seed` service
([`backend-beta/src/ops/demo_seed.js`](backend-beta/src/ops/demo_seed.js))
creates 5 clubs, 5 venues, 37 accounts and 25 events through the real API:
6 past events with check-ins (for the reports), 15 upcoming events (one full
with a waitlist, members-only events with pending requests), one cancelled
event and three still in the approval workflow. Every account uses the
password **`clubspacetest123`**; the names are fictional and the addresses use
the reserved `.example` domain.

**Password for every account: `clubspacetest123`**

**Venue administrator:** `admin@clubspace.example` (approves or rejects venue
requests).

**Club accounts.** Each club has one president, two committee members and
three members:

| Club | President | Committee | Members |
| --- | --- | --- | --- |
| Photography Society | `president.photo@clubspace.example` | `committee1.photo@clubspace.example`<br>`committee2.photo@clubspace.example` | `member1.photo@clubspace.example`<br>`member2.photo@clubspace.example`<br>`member3.photo@clubspace.example` |
| Film Society | `president.film@clubspace.example` | `committee1.film@clubspace.example`<br>`committee2.film@clubspace.example` | `member1.film@clubspace.example`<br>`member2.film@clubspace.example`<br>`member3.film@clubspace.example` |
| Debate Club | `president.debate@clubspace.example` | `committee1.debate@clubspace.example`<br>`committee2.debate@clubspace.example` | `member1.debate@clubspace.example`<br>`member2.debate@clubspace.example`<br>`member3.debate@clubspace.example` |
| Hiking Club | `president.hiking@clubspace.example` | `committee1.hiking@clubspace.example`<br>`committee2.hiking@clubspace.example` | `member1.hiking@clubspace.example`<br>`member2.hiking@clubspace.example`<br>`member3.hiking@clubspace.example` |
| Robotics Lab | `president.robotics@clubspace.example` | `committee1.robotics@clubspace.example`<br>`committee2.robotics@clubspace.example` | `member1.robotics@clubspace.example`<br>`member2.robotics@clubspace.example`<br>`member3.robotics@clubspace.example` |

Some members belong to a second club: `member1.photo` is also in Film
Society, `member2.hiking` in Robotics Lab, `member3.debate` in Photography
Society, and `student4` in Hiking Club.

**Students:** `student1@clubspace.example` to `student6@clubspace.example`.
`student1`, `student2` and `student3` have pending requests to join
Photography Society, Robotics Lab and Hiking Club; `student5` and `student6`
belong to no club.

**What to try with each role:**

| Sign in as | Try |
| --- | --- |
| `admin@clubspace.example` | Admin → approve or reject the pending venue request for Film Society's Animation Night |
| `president.photo@clubspace.example` | Organizer → sign off the venue request for the Exhibition Planning Meeting that `committee1.photo` drafted; accept `student1`'s join request; promote a member to committee |
| `president.debate@clubspace.example` | Publish Debate Workshop: Rebuttals, which `committee1.debate` sent for approval |
| `committee1.debate@clubspace.example` | Create an event and request a venue; review the join requests for the members-only Inter-Hall Debate Trials |
| `member1.hiking@clubspace.example` | Events → Lion Rock Sunrise Hike is full with two people on the waitlist; My registrations lists your events |
| `student1@clubspace.example` | Browse events, register for a public event, watch the seat count update live in a second browser |

To use another password, put `DEMO_ACCOUNT_PASSWORD=...` (12+ characters) in
`.env` before the first start; `DEMO_ACCOUNT_PASSWORD=` with no value starts
without demo data. The repository is public, so anyone on HKUVPN who reads
this can sign in to the demo accounts, including the venue administrator.

## Rebuild from scratch (for TAs and examiners)

These steps rebuild the whole project, including a new MySQL database with the
demo data, from the public repository. They work on the Group 19 server and on
any other Linux machine (or macOS with Docker Desktop).

**You need:** Docker Engine with the Compose v2 plugin (`docker compose
version`), `git` and `openssl`; about 4 GB of RAM and 4 GB of free disk; and
internet access to GitHub, Docker Hub and npm during the build. Nothing else
(no Node.js or MySQL) is installed on the host.

1. **Get the code.**

   ```bash
   git clone https://github.com/LunarTear1014/COMP3322-Project.git clubspace
   cd clubspace
   ```

2. **Create `.env` with random secrets.** Compose refuses to start without
   it; it is git-ignored and never committed.

   ```bash
   (umask 077; printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_PASSWORD=%s\nSESSION_SECRET=%s\n' \
     "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env)
   ```

   **Only if you are not on c3322-pg19.cs.hku.hk**, also tell the app which
   address you will open, because the API rejects requests from any other
   origin. For example, to use http://localhost:8080:

   ```bash
   printf 'APP_ORIGIN=http://localhost:8080\nWEB_PORT=8080\nWEB_HTTPS_PORT=8443\n' >> .env
   ```

   `APP_ORIGIN` must match the browser's address bar exactly (scheme, host and
   port; no trailing slash). Leave out `WEB_PORT` to serve on port 80, in which
   case use `APP_ORIGIN=http://localhost`. An `http://` address serves plain
   HTTP only; an `https://` one (the default, `https://c3322-pg19.cs.hku.hk`)
   serves HTTPS with a self-signed certificate the web container issues on
   its first start, and redirects port 80 to it. `WEB_HTTPS_PORT` (default
   443) only moves the HTTPS port off 443 so it cannot clash with another
   service.

3. **Build and start.**

   ```bash
   docker compose up -d --build
   ```

   The first build takes about 3–5 minutes. Compose starts MySQL, applies the
   schema and migrations (`migrate`), starts the API and worker, serves the
   site on port 443 (HTTPS) and 80, or `WEB_PORT` for an `http://`
   `APP_ORIGIN`, and loads the demo data (`seed`).

4. **Check it.**

   ```bash
   curl -fsS http://127.0.0.1:${WEB_PORT:-80}/api/health; echo
   docker wait "$(docker compose ps -a -q seed)" >/dev/null
   docker compose logs --no-log-prefix seed
   docker compose ps -a
   ```

   Expected: `{"status":"ok"}`; the seed log ends with the list of 37 demo
   accounts; `db`, `backend`, `worker` and `web` are running (healthy);
   `migrate` and `seed` show `Exited (0)`, which is correct for one-shot jobs.
   If you set `WEB_PORT` in `.env`, run `export WEB_PORT=8080` first so the
   `curl` line uses the same port.

5. **Open the site** at https://c3322-pg19.cs.hku.hk (or your `APP_ORIGIN`)
   and sign in with a [demo account](#demo-accounts). On HTTPS the browser
   warns that the self-signed certificate is not trusted, which is expected
   (course server guide, Option A): choose Advanced → Proceed.

**Start again from an empty database** (deletes all data and uploaded covers,
then rebuilds and re-seeds):

```bash
docker compose down -v
docker compose up -d --build
```

**Stop without deleting data:** `docker compose down`. **Free disk space**
from old builds: `docker image prune -f` and `docker builder prune -f`.

### Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Set MYSQL_PASSWORD in .env` (Compose stops before starting) | `.env` is missing; do step 2 in the repository folder. |
| Pages load but sign-in or any change fails with "origin" or 403 | `APP_ORIGIN` does not match the address in the browser. Fix `.env`, then `docker compose up -d`. |
| `bind: address already in use` on port 80 or 443 | Another service uses the port. Set `WEB_PORT`, `WEB_HTTPS_PORT` and `APP_ORIGIN` as in step 2. |
| The browser says the connection is not private | Expected on HTTPS: the certificate is self-signed. Choose Advanced → Proceed once per browser. |
| "Continue with Google" is missing | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not both in `.env`; Google sign-in is optional, password sign-in always works. See [Google sign-in](#google-sign-in). |
| `backend` and `worker` never start | `migrate` failed: read `docker compose logs migrate`. |
| Seed log says `Skipping demo data: The database already has events.` | The database volume is not empty. Use `docker compose down -v` to start again. |
| Changed the MySQL passwords in `.env` after the first start | MySQL keeps the passwords it was created with. Restore the old `.env` or start again with `down -v`. |

## Deploy to the Group 19 server

The server runs `main` of the GitHub repository, cloned to `~/clubspace-pg19`.
Nothing is edited or uploaded by hand, so the deployed code always matches
GitHub. The site is served over HTTPS on port 443 with a self-signed
certificate (Option A of the course server guide), because Google sign-in
needs an `https` redirect URI; port 80 redirects to it. The web container
issues the certificate on its first start and keeps it on the `web_certs`
volume. The server allows Docker only, so everything runs in containers.

1. Push the commits you want to deploy to `main` on GitHub. Connect to
   HKUVPN, then open an SSH session with the group's private key:

   ```bash
   ssh -i ~/.ssh/id_rsa -o IdentitiesOnly=yes ubuntu@c3322-pg19.cs.hku.hk
   ```

   The first time, type `yes` to trust the server.

2. Paste this block into the SSH session. Use the same block for the first
   deployment and for every update. It:
   - clones the repository on the first run, or pulls the latest `main`
     (fast-forward only) on later runs. If `~/clubspace-pg19` holds an older
     deployment that is not a git clone, it is moved aside and its `.env` is
     kept;
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
     curl -kfsS --retry 5 --retry-all-errors --retry-delay 2 \
       --connect-timeout 2 --max-time 5 https://127.0.0.1/api/health
     printf '\n'
     if ! grep -q '^GOOGLE_CLIENT_SECRET=.' .env; then
       printf 'Google sign-in is off: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not in .env\n'
     fi
     docker wait "$(docker compose ps -a -q seed)" >/dev/null
     docker compose logs --no-log-prefix seed
     docker compose ps -a
     git log -1 --format='Deployed %h (%cs): %s'
   )
   ```

   When the block finishes, open https://c3322-pg19.cs.hku.hk, accept the
   self-signed certificate and sign in with a demo account. Run `docker image prune -f` and `docker builder prune -f`
   now and then; the server has 8.6 GB of disk.

### Google sign-in

Google sign-in is optional and off until both credentials are in the
server's `.env` (git-ignored; never commit them or copy the downloaded
`client_secret_*.json` to the server).

1. In Google Cloud Console → APIs & Services → Credentials, open the web
   OAuth client and add:
   - Authorized JavaScript origin: `https://c3322-pg19.cs.hku.hk`
   - Authorized redirect URI: `https://c3322-pg19.cs.hku.hk/api/auth/google/callback`

   Keep `http://localhost:5173/api/auth/google/callback` for local
   development. Google refuses plain `http` redirect URIs for any host other
   than localhost, which is why the server uses HTTPS. While the OAuth
   consent screen is in **Testing**, only the listed test users can sign in;
   add the markers' accounts or publish the app (the `openid`, `email` and
   `profile` scopes need no Google review).
   To publish, fill in Branding with the home page
   `https://c3322-pg19.cs.hku.hk`, the privacy policy
   `https://c3322-pg19.cs.hku.hk/privacy`, the terms
   `https://c3322-pg19.cs.hku.hk/terms` (both public pages in the app) and
   the authorised domain `hku.hk`. Do not upload a logo: that requires
   Google's verification.
2. On your computer, print the two `.env` lines from the downloaded JSON:

   ```bash
   python3 -c 'import json,sys;w=json.load(open(sys.argv[1]))["web"];print("GOOGLE_CLIENT_ID="+w["client_id"]);print("GOOGLE_CLIENT_SECRET="+w["client_secret"])' ~/Downloads/client_secret_*.json
   ```

3. In the SSH session, append them to `~/clubspace-pg19/.env` (for example
   with `nano ~/clubspace-pg19/.env`), make sure `.env` has no
   `APP_ORIGIN=http://...` line left from the HTTP deployment, then run the
   deploy block again (or `docker compose up -d` in `~/clubspace-pg19`).

The site loads Google's OpenID configuration once and caches it; sign-ins
are only sent to Google when a user clicks the button, so the server does not
poll an outside service.

### Update the deployment

Push to `main` on GitHub, then run step 2 again. It backs up the database,
pulls the new commits and rebuilds; the `migrate` service applies any new
migrations before the API and worker start, and existing data (including the
demo data) is left alone.

If `migrate` exits with an error, the API and worker do not start; read
`docker compose logs migrate`. The runner refuses a changed checksum or an
interrupted migration; do not blindly retry. Restore the backup or inspect
the partial schema before continuing.

### Start over with a fresh database

This deletes every account, club, event, notification and uploaded cover on
the server, after saving a backup. Then run step 2 again; it recreates the
schema and the demo data.

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

### Restore a backup

Backups are plain SQL dumps in `~/clubspace-backups`. To load one into the
running database (this replaces the tables it contains):

```bash
cd ~/clubspace-pg19
docker compose exec -T db sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" clubspace' < ~/clubspace-backups/FILE.sql
```

## Operations

All commands run in `~/clubspace-pg19` on the server (or the repository
folder of a rebuild).

### Cover images, migrations and environment

Event cover images are stored under `COVER_DIR` (`/app/data/covers` in the
backend container) on the `cover_data` volume. Back it up with the database:
`docker run --rm -v clubspace-pg19_cover_data:/data -v "$PWD":/backup alpine
tar -czf /backup/covers.tgz -C /data .`. A scheduled sweep removes files that
no event references.

The demo events get generated cover images from
[`backend-beta/db/demo-images/`](backend-beta/db/demo-images/) when `seed`
fills a fresh database. A database seeded before those images existed gets
them with this command, which only fills demo events that have no cover and
is safe to run again:

```bash
docker compose exec -T backend node src/ops/attach-demo-covers.js
```

The `club-*.jpg` images in the same folder are not used yet, because clubs
have no image field.

Schema changes after the baseline are ordered migrations in
`backend-beta/db/migrations`. The `migrate` service runs them on every
`docker compose up`, before the API and worker start. The runner takes a
database lock, verifies the checksum of each applied file, and records each
version only after it finishes.

| `.env` variable | Purpose |
| --- | --- |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | MySQL root and application passwords (required) |
| `SESSION_SECRET` | Signs session cookies (required) |
| `APP_ORIGIN` | Exact site address; default `https://c3322-pg19.cs.hku.hk`. `https://` serves HTTPS with a self-signed certificate; `http://` serves plain HTTP |
| `WEB_PORT` | Host port for HTTP; default `80` |
| `WEB_HTTPS_PORT` | Host port for HTTPS; default `443` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; both unset keeps it off ([Google sign-in](#google-sign-in)) |
| `SESSION_COOKIE_SECURE` | Override for the Secure cookie flag (`true`/`false`); by default it follows the scheme of `APP_ORIGIN` |
| `DEMO_ACCOUNT_PASSWORD` | Demo account password; default `clubspacetest123`, empty to skip demo data |
| `LEGACY_DATETIME_TIMEZONE` | Only for migrating a pre-v1 database that stored bookings in local time (`Asia/Taipei`) |

### Worker

The `worker` service sends reminders and daily club digests, and keeps a
heartbeat in `worker_heartbeats`; run exactly one. A job that used up its
attempts stays `failed`. After fixing the cause, queue it again (the command
writes an audit entry with the operator name you give):

```bash
docker compose exec -T backend node src/ops/retry-notification-job.js JOB_ID "your name"
```

For a database without demo data, `docker compose exec backend node
src/ops/provision-dev.js` gives every club without a president a generated
fictional one (set `DEV_ACCOUNT_PASSWORD` or note the password it prints once).

### Assign a venue administrator

Register the account on the website first. An administrator who is also
committee for a club cannot decide that club's requests. Paste this block and
enter the registered email:

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

Club roles are normally managed in the app: the president appoints committee
members under Organizer → Your clubs → Members and roles.

## Local development

For hot reload while developing. To run the whole stack locally without
installing anything but Docker, follow the
[rebuild guide](#rebuild-from-scratch-for-tas-and-examiners) with
`APP_ORIGIN=http://localhost` instead.

**Prerequisites:** Node.js 22 or later, MySQL 8.4 on port 3306, and a MySQL
client (the `mysql` CLI, MySQL Workbench or Sequel Ace). On macOS:
`brew install mysql && brew services start mysql`.

1. **Create the database and user** as a MySQL administrator (for example
   `mysql -u root -p`). Replace `choose-a-local-password`:

   ```sql
   CREATE DATABASE IF NOT EXISTS clubspace CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER IF NOT EXISTS 'clubspace_app'@'localhost' IDENTIFIED BY 'choose-a-local-password';
   CREATE USER IF NOT EXISTS 'clubspace_app'@'127.0.0.1' IDENTIFIED BY 'choose-a-local-password';
   GRANT ALL PRIVILEGES ON clubspace.* TO 'clubspace_app'@'localhost';
   GRANT ALL PRIVILEGES ON clubspace.* TO 'clubspace_app'@'127.0.0.1';
   ```

2. **Configure the backend.** `.env` is git-ignored; never commit it.

   ```bash
   cd backend-beta
   cp .env.example .env    # then set DB_PASSWORD and a random SESSION_SECRET
   npm ci
   ```

3. **Build the schema and demo data** in the empty database (from
   `backend-beta`, with the values from `.env`):

   ```bash
   mysql -u clubspace_app -p clubspace < db/schema.sql
   mysql -u clubspace_app -p clubspace < db/deployment-seed.sql
   node --env-file=.env src/ops/migrate.js
   DEMO_ACCOUNT_PASSWORD=clubspacetest123 node --env-file=.env src/ops/seed-demo.js
   ```

   `schema.sql` drops and recreates the baseline tables. To reset local data,
   drop and recreate the `clubspace` database, then repeat this step.

4. **Run** in two terminals from the repository root:

   ```bash
   cd backend-beta && npm run dev
   ```

   ```bash
   cd frontend-beta && npm ci && npm run dev
   ```

   Open http://localhost:5173. Vite proxies `/api` to `http://localhost:3000`
   (set `CLUBSPACE_API_TARGET` to change it). `http://localhost:3000/api/health`
   returns `{"status":"ok"}` when the API can reach MySQL. The local
   `APP_ORIGIN` in `backend-beta/.env.example` is already
   `http://localhost:5173`. For Google sign-in locally, set `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET` in `backend-beta/.env`; the OAuth client already
   lists `http://localhost:5173/api/auth/google/callback`.

## Tests

- **Backend:** `cd backend-beta && npm test` runs the unit tests. Database
  tests run only against a disposable database whose name contains `test`:
  put `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD` and
  `TEST_DB_NAME` in a file outside the repository and run
  `TEST_ENV_FILE=/path/to/that/file npm test`. They refuse `DB_NAME` or any
  name without `test`.
- **Frontend:** `cd frontend-beta && npm test`, `npm run lint`, `npm run build`.

## API

The SPA uses only the versioned REST API under **`/api/v1`**. The full
contract (DTOs, filters, every error code) is in
[`handoff/api.md`](openspec/changes/expand-clubspace-workflows/handoff/api.md)
with the additions in
[`handoff/beta-feedback.md`](openspec/changes/expand-clubspace-workflows/handoff/beta-feedback.md).

**Conventions.** JSON bodies; success is `{ "data": ..., "meta": ... }` and
errors are `{ "error": { "code", "message", "fields", "request_id" } }`. The
session is an HttpOnly cookie; every change also needs the `X-CSRF-Token`
header (from `GET /auth/csrf` or the sign-in response) and an `Origin` equal
to `APP_ORIGIN`. Times are ISO 8601 UTC.

| Status | Used for |
| --- | --- |
| `200` / `201` / `202` / `204` | Read or update / created / request queued for approval (join requests) / no body |
| `400` | Malformed JSON |
| `401` | Not signed in, or wrong credentials |
| `403` | Not allowed, bad CSRF token or origin, deciding your own club's request |
| `404` | Missing, or hidden from this user |
| `409` | Conflicts: venue slot taken, event full, stale version, invalid state |
| `413` / `415` / `422` | Upload too large / not JPEG or WebP / validation failed |
| `429` | Rate limited (with `Retry-After`) |
| `500` / `503` | Unexpected error / database unavailable |

| Area | Endpoints (relative to `/api/v1`) |
| --- | --- |
| Auth and profile | `GET /auth/csrf`, `POST /auth/register`, `POST /auth/login`, `GET /auth/session`, `POST /auth/logout`, `GET`/`PATCH /profile` |
| Clubs | `GET /clubs`, `GET /me/memberships`, `PUT`/`DELETE /clubs/:id/membership`, `GET /clubs/:id/join-requests`, `POST /clubs/:id/join-requests/:request_id/review`, `GET /clubs/:id/members`, `PATCH /clubs/:id/members/:user_id`, `POST /clubs/:id/presidency` |
| Venues and bookings | `GET /venues`, `GET /venues/:id/calendar`, `GET /bookings`, `POST /bookings/:id/decision`, `POST /bookings/:id/signoff` |
| Events | `GET`/`POST /events`, `GET`/`PATCH /events/:id`, `POST /events/:id/publish`, `POST /events/:id/signoff`, `POST /events/:id/cancel`, `PUT`/`DELETE /events/:id/cover`, `GET /me/events`, `GET /me/signoffs` |
| Participation | `POST`/`DELETE /events/:id/registration`, `GET /me/registrations`, `GET /events/:id/participants`, `GET /events/:id/join-requests`, `POST /events/:id/join-requests/:user_id/decision` |
| Check-in | `POST /events/:id/checkin`, `POST /events/:id/attendance`, `GET /events/:id/attendance`, `PUT`/`DELETE /events/:id/attendance/:user_id` |
| Tags | `GET`/`POST /tags`, `PATCH /tags/:id`, `GET`/`POST /clubs/:id/tags`, `DELETE /clubs/:id/tags/:tag_id` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `GET /notifications/stream` (Server-Sent Events) |
| Reports | `GET /clubs/:id/reports`, `GET /clubs/:id/reports/effectiveness`, `POST /events/:id/views` |

`GET /api/health` (outside v1) returns `{"status":"ok"}` or `503`. The older
unversioned beta routes (documented in
[`backend-beta/API.md`](backend-beta/API.md)) are still mounted for
compatibility, but no page uses them.

## Credits and academic integrity

Third-party libraries, UI components and assets are credited on the in-app
[credits page](https://c3322-pg19.cs.hku.hk/credits) (`/credits`). All project
code was written by the team members listed above, with AI tools used as
allowed by the course policy.
