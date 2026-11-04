# Refactor plan: split `src/index.js` into `src/features/<name>/`

Goal: move the monolithic `src/index.js` (313 lines, 6 endpoints, all helpers inline) into
per-feature modules. Constraints: **behavior-preserving**, **no new dependencies**, keep
**snake_case** names, **routes + service per feature** (no controller/repository layers).

`tests/api.test.js` (27 characterization tests; resets the database and spawns
`node src/index.js` itself) is the safety net for every step below.

---

## 1. Features and helpers

Endpoints group into 4 features:

| Feature | Routes |
| ------- | ------ |
| health  | `GET /api/health` |
| events  | `GET /api/events`, `POST /api/events` |
| venues  | `GET /api/venues` |
| profile | `GET /api/profile`, `PUT /api/profile` |

Helper inventory and usage:

| Helper | Defined | Used by | Shared (2+)? |
| ------ | ------- | ------- | ------------ |
| `database_error` | index.js:55 | health, events, venues, profile | **yes** |
| `invalid_request` | index.js:51 | events (POST), venues, profile (PUT) | **yes** |
| `TIMESLOTS` | index.js:7 | events (via timeslot_bounds), venues | **yes** |
| `DATE_FORMAT` | index.js:8 | events (POST), venues | **yes** |
| `today` | index.js:11 | events (event_response, POST past-date check), venues (default date) | **yes** |
| `timeslot_bounds` | index.js:27 | events (POST), venues (availability) | **yes** |
| `display_visibility` | index.js:15 | events only (event_response) | no |
| `database_visibility` | index.js:19 | events only (POST) | no |
| `make_timeslot` | index.js:23 | events only (event_response) | no |
| `event_response` | index.js:36 | events only (GET) | no |
| `demo_user_id` | index.js:9 | profile only | no |

## 2. Feature-boundary crossings

- **events → bookings/venues/clubs tables**: `POST /api/events` inserts into `bookings`
  (index.js:170) and its overlap check queries `bookings` (index.js:156); the events SELECT
  joins `clubs`, `bookings`, `venues` (index.js:73–89). The events feature owns
  venue-booking logic that arguably belongs to a bookings/venues domain — kept as-is
  (behavior-preserving), but noted.
- **venues → bookings table**: `GET /api/venues` reads `bookings` to compute availability
  (index.js:227) — the same crossing from the other direction. Bookings are the shared,
  cross-feature data; the clean seam is the shared timeslots module, not the DB tables.
- **Shared HTTP error helpers**: `invalid_request` / `database_error` are used by every
  feature → must live in a shared module, not inside any feature.
- **Shared timeslot concept**: `TIMESLOTS`, `DATE_FORMAT`, `today`, `timeslot_bounds` are
  used by both events and venues → shared module.
- **`demo_user_id`**: a global "until login exists" concept; scoped to profile for now.
- **`pool`**: every feature's service imports `config/db.js` directly — acceptable; no
  repository layer per constraints.

## 3. Suspicious behavior (observed, NOT fixed)

1. **Trim mismatch in POST /api/events** (index.js:106–123): club/venue are validated with
   `.trim() === ""` but the DB lookup uses the raw untrimmed value — `" Photography Society "`
   passes validation then fails with "Unknown club"/"Unknown venue". Title/description ARE
   trimmed before insert; club/venue are not trimmed anywhere.
2. **UTC vs DB-timezone mismatch**: `today()` uses `toISOString()` (UTC, index.js:12), while
   seed bookings use MySQL `CURDATE()` (server-local time). Near midnight (or if the DB TZ
   differs from UTC), "past date" checks, `Upcoming/Past` status, and the venues default
   date can disagree by a day.
3. **GET /api/venues ignores multi-day bookings** (index.js:244–245): availability compares
   `` `${date} ${booking.start_time}:00` `` — a booking whose `end_time` falls on the *next*
   day is rewritten as same-day, so a venue booked overnight can show as available.
4. **Invalid calendar dates pass the regex** (index.js:8): `2026-02-30`, `2026-13-01` match
   `/^\d{4}-\d{2}-\d{2}$/`; depending on MySQL sql_mode the insert then errors → 500 instead
   of 422. Same regex hole in GET /api/venues (index.js:215), where JS Date normalization can
   also shift the computed next-day window.
5. **Rollback in catch can itself throw** (index.js:204–206): if the connection died,
   `await connection.rollback()` rejects inside the catch (unhandled); rollback is also
   invoked even when `beginTransaction` never succeeded.
6. **`demo_user_id` is unvalidated** (index.js:9): `Number("abc")` → NaN → all profile
   queries silently match nothing (GET 404s, PUT 404s) instead of failing loudly.
7. **Email validation is only `.includes("@")`** (index.js:277); the 409 path catches any
   `ER_DUP_ENTRY` on the users table, so a future duplicate `student_id` violation would
   also report "That email address is already in use."
8. **No calendar validation on the venue-day window** (index.js:219–221): for an invalid
   `date` query param, `new Date(\`${date}T00:00:00Z\`)` normalizes (2026-02-30 →
   2026-03-02), so the booking window queried can be the wrong day.
9. **Booking-overlap race**: the `SELECT … FOR UPDATE` gap-lock behavior depends on the
   transaction isolation level; under READ COMMITTED, two concurrent identical POSTs may
   both pass the conflict check (only row locks exist, no gap lock).
10. **Same-day events stay "Upcoming" all day** (index.js:47): status is date-based, not
    end-time-based.
11. **No 404/error middleware**: unmatched routes return Express's default HTML, not JSON.
12. **Title length unvalidated**: a `title` longer than VARCHAR(255) reaches the DB → 500
    instead of 422.
13. **Test placeholders** (tests/api.test.js:341–345, 395–398): the two profile-404 tests
    are `assert.ok(true)` — they assert nothing; they pass regardless of app behavior.

## 4. Target tree

```
src/
  index.js                    # app shell only: express, json middleware, mount routers, start()
  config/
    db.js                     # unchanged
  shared/
    http.js                   # invalid_request, database_error
    timeslots.js              # TIMESLOTS, DATE_FORMAT, today, timeslot_bounds
  features/
    health/
      health.routes.js        # GET /api/health
    events/
      events.validation.js    # POST /api/events field validation (same checks, same order)
      events.routes.js        # GET /api/events, POST /api/events (handlers verbatim)
      events.service.js       # event_response, display_visibility, database_visibility,
                              #   make_timeslot, list_events, create_event
    venues/
      venues.routes.js        # GET /api/venues
      venues.service.js       # list_venues_with_availability
    profile/
      profile.routes.js       # GET /api/profile, PUT /api/profile
      profile.service.js      # demo_user_id, get_profile, update_profile
```

Notes:

- Each `*.routes.js` exports an `express.Router` mounted in `index.js`. Routers carry their
  full `/api/...` paths and are mounted at root, so route strings stay byte-identical.
- Feature services import `pool` from `config/db.js` and the shared modules; features never
  import each other.
- Health has no service (single inline handler) — `health.routes.js` only.
- `events.validation.js` holds the POST field checks verbatim (same messages, same order);
  it is a split of the existing `if` chain, not a new validation scheme.

## 5. Ordered steps (app runs + `npm test` green after EVERY step)

Each step is copy-verbatim + add imports/exports only. No logic edits.

1. **Extract `src/shared/http.js`**: move `invalid_request`, `database_error` verbatim;
   index.js imports them. Run `npm test`.
2. **Extract `src/shared/timeslots.js`**: move `TIMESLOTS`, `DATE_FORMAT`, `today`,
   `timeslot_bounds` verbatim; index.js imports them. Run `npm test`.
3. **Create `src/features/events/`**: move `event_response`, `display_visibility`,
   `database_visibility`, `make_timeslot` into `events.service.js`; move the POST field
   validation chain into `events.validation.js`; move both `/api/events` handlers into
   `events.routes.js` (Router calling the service functions that wrap the existing SQL);
   mount in index.js; delete the moved code. Run `npm test`.
4. **Create `src/features/venues/`**: move the `GET /api/venues` handler into
   `venues.routes.js` + `venues.service.js`; mount; delete from index.js. Run `npm test`.
5. **Create `src/features/profile/`**: move `demo_user_id` and both `/api/profile` handlers
   into `profile.routes.js` + `profile.service.js`; mount; delete from index.js.
   Run `npm test`.
6. **Create `src/features/health/`**: move `GET /api/health` into `health.routes.js`; mount.
   Run `npm test`.
7. **Final cleanup**: index.js is now app shell (express, `express.json()`, four `app.use`
   mounts, `start()`); grep for dead code; run `npm test`; confirm the "creates event"
   test still passes (proves the transaction path survived the move intact).

## Verification

- After every step: `npm test` → 27/27 pass (the tests spawn `node src/index.js` themselves,
  so "app runs" is verified by the suite).
- Final: `node src/index.js` boots manually; `grep -n "app.get\|app.post\|app.put"
  src/index.js` returns nothing (all routes moved); no helper is defined twice
  (`grep -rn "function invalid_request" src/` → exactly one hit).
