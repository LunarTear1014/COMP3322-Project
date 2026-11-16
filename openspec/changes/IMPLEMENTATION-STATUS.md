# Implementation status

Branch: `worktree-agent-ace44ab10ef85bdb2` (from `beta-interview`). Targets: `backend-beta/`, `frontend-beta/` (not the alpha folders).
Last updated: 2026-11-16 (second run, disposable MySQL available).

Legend: done = code and a passing test prove it (ticked). partial = some code exists but the task is not met. missing = nothing relevant.

## Test database

A disposable MySQL 8.4.13 (`clubspace-test-mysql`, port 3307) is used for every DB test. Settings come from `TEST_ENV_FILE=<path to test.env>`
(loaded by `backend-beta/test/db_guard.js`, never printed or committed). The guard refuses any database whose name lacks "test" or equals
`DB_NAME`/`clubspace`; `reset_tables` only drops tables inside it. One extra database, `<TEST_DB_NAME>_upgrade`, is created and dropped by
`src/db/baseline.db.test.js`. Run `TEST_ENV_FILE=... npm test` in `backend-beta` (serial, `--test-concurrency=1`). Without the variable the
DB tests are skipped. Last full run: 164 tests pass.

## expand-clubspace-workflows

| Task | Status | Evidence | Gaps |
| --- | --- | --- | --- |
| 1.1 scope review | done | Product owner approved 2026-11-16; decisions recorded below | |
| 1.2 deployment and timezone preflight | partial | legacy timezone confirmed Asia/Taipei (UTC+8); MySQL 8.4 verified on an 8.4.13 container | deployment schedule, VM resources and TLS not provided |
| 1.3 contract fixtures | partial | DTO shapes asserted in the `*.db.test.js` files | no frozen fixture files generated from api.md |
| 1.4 verification scripts, disposable DB | done | `test/db_guard.js`, `test/db_helper.js`, `test/v1_harness.js`, `scripts/run_migrations_dev.mjs`, README "Testing" | |
| 2.1 migration runner | done | `src/db/migrate.js`, `src/ops/migrate.js`; fake-connection tests plus `migrate.db.test.js` on MySQL (apply, rerun no-op, lock contention, president constraint) | |
| 2.2 integrity preflight | done | `src/db/preflight.js`, `db/migrations/001_preflight.js`; `legacy_upgrade.db.test.js` refuses overlaps, mismatched intervals, over-capacity and colliding identities | |
| 2.3 workflow fields and tables | done | `002_workflow_columns.js`, `003_support_tables.js` executed on MySQL | |
| 2.4 one-time UTC backfill | done | `004_backfill_utc.js` (Asia/Taipei, Asia/Hong_Kong or UTC; marker and shift in one transaction); tests: Taipei shift, already-UTC, interrupted rerun never double-shifts, refusal without `LEGACY_DATETIME_TIMEZONE` | |
| 2.5 constraints, indexes, EXPLAIN | done | `005_constraints_indexes.js`; `explain.db.test.js` (9 hot queries use an index); IDs and counts preserved in `legacy_upgrade.db.test.js` | composite booking/event interval FK not added (see Deviations) |
| 2.6 fresh and upgrade baselines | done | `baseline.db.test.js`: no `users.role` index; fresh and upgraded databases have identical columns, indexes, constraints, foreign keys and migration checksums | |
| 2.7 secure provisioning | done | `src/ops/dev_provisioning.js`, `provision-dev.js`; `provisioning.db.test.js` (placeholders cannot log in, no admin seeded, admin refuses production, env password) | the beta `provision-starter-accounts.js` still carries two committed hashes (pre-existing) |
| 3.1 module split | partial | `src/app.js`, `src/middleware/*`, `src/api_v1/*` (routes with services inline), `src/db/*`, `src/jobs/*` | no separate controller and repository layers; SQL sits in route modules |
| 3.2 transaction helper | done | `src/db/transaction.js`; fake-pool tests plus every v1 write | |
| 3.3 validation and envelopes | done | `src/middleware/*`, `src/shared/validate.js`, `src/app.test.js`; 410 for retired URLs deferred to the coordinated cutover (decision below, spec updated) | |
| 3.4 sessions and CSRF | done | `src/api_v1/session_store.js` (MySQL), `middleware/csrf.js`; `auth.db.test.js` (regeneration, token rotation, logout row removal, restart persistence, stale token) | |
| 3.5 hashing and throttling | partial | `password_hasher.js` wired into login and register (`auth.db.test.js`: generic errors, throttle 429); 177 ms per hash locally | memory and latency not benchmarked on the target VM |
| 3.6 profile, session, config | done | `src/api_v1/auth.js`, `router.js`; no `DEMO_USER_ID` in v1; privileges read per request (tested) | |
| 3.7 membership endpoints | done | `src/api_v1/clubs.js`; `registration.db.test.js` (protected leave, active registrations, R5 race), `governance.db.test.js` | |
| 4.1 slot and date validation | done | `src/shared/slots.js`, `validate.test.js` | |
| 4.2 atomic pending booking and draft | done | `events.js` create; a failed create leaves no rows (tag failure after inserts) | |
| 4.3 admin review | done | `events.db.test.js` (R1 one confirmed, conflict leaves pending, stale, self-decision, reason required) | |
| 4.4 event visibility, list, detail | done | hidden drafts 404, filters, wildcards literal, 422 for repeats | |
| 4.5 edit and publish | done | frozen fields, stale versions, approval is not publication, R6 | |
| 4.6 cancellation | done | atomic, idempotent, no promotion, after-start rejected, slot released | |
| 5.1 registration and history | done | `registration.js`; cross-session persistence, idempotent repeat, one confirmation | |
| 5.2 capacity and waitlist | done | final-seat race R2; queue limit constant 500 | the 500-entry limit is not exercised with 500 rows |
| 5.3 withdrawal and promoteLocked | done | FIFO, R3 race, ineligible legacy waiter skipped with a reason, deadline rules | |
| 5.4 my registration and participants | done | committee-only, admin alone 403, ordering and positions, R5 | |
| 5.5 history only for real transitions | done | repeat registration and repeat cancel add no rows; history counts asserted | |
| 6.1 outbox writes | done | `src/jobs/queue.js`; rollback leaves no orphan job | |
| 6.2 claims, leases, retries | done | `jobs.db.test.js`: exclusive claim R7, fenced ack, 5/30/120/600 s delays, last-attempt lease expiry, failed-job requeue with audit | |
| 6.3 deduplicated delivery and inbox | done | unique `(user_id, dedup_key)`, replay tests, own-inbox and read endpoints | |
| 6.4 reminders | done | 24 h scan, late joins and promotions share one visible key, started and cancelled suppressed, downtime catch-up | |
| 6.5 worker lifecycle | partial | `src/worker.js` (heartbeat, SIGTERM stop), Compose `worker` service, crash recovery R8, reminder versus cancel R9 | SIGTERM drain within 30 s not tested |
| 7.1 calendar | done | `engagement.db.test.js`: confirmed only, anonymous drafts, 31-day bound, cross-midnight legacy interval | |
| 7.2 club report | done | zero-filled Hong Kong days, clipped hours, no attendance fields, committee-only | |
| 7.3 frozen contract fixtures | missing | | |
| 8.1-8.8 frontend integration | partial | the frontend already speaks v1 in fixtures mode (see refresh); `--mode v1` against the real backend was smoke-tested by hand (sign-in, Explore, organizer home; see INTEGRATION.md) but the full UI walk was not done | 8.8 coordinated cutover not done, by decision |
| 9.1 full MySQL suite | done | 164 tests on MySQL 8.4.13 incl. R1-R9 and migration and restart; command above | |
| 9.2 production Compose and gate | partial | `compose.yaml` worker and `cover_data`, schema gate in `index.js` and `worker.js`, `APP_ORIGIN` | migration account and runtime privilege split, secrets template |
| 9.3-9.5 | missing | | needs a Linux VM |
| 10.1 migrations 010-014 | done | run on fresh and upgraded MySQL; the unique constraint rejects a second president | first presidents provisioned by `provision-dev.js` (names below) |
| 10.2 GovernanceService | done | `clubs.js`, `events.js`, `governance.db.test.js` (403s, stale versions, two presidents impossible, concurrent transfer, sign-off, awaiting never busy nor visible to admins) | |
| 10.3 live notifications | done | matrix types written in source transactions with the actor excluded; digest job 09:00 HKT with catch-up | `event_changed` is never emitted: after publication only title, description and tags change and the matrix excludes them |
| 10.4 notification stream | done | hub mounted on `/api/v1/notifications/stream` with session auth; `engagement.db.test.js` delivers over real HTTP within 2 s | |
| 10.5 tags | done | campus and club tags, filters, keyword search, limits, retired tags | |
| 10.6 check-in and views | done | window, code, joined-only, 5 attempts per 10 min, marks, view dedup, 180-day purge | |
| 10.7 effectiveness report | done | named SQL in `src/queries/reports/effectiveness/`; hand-built fixtures (join/leave/rejoin, promoted no-show, no check-in, group under 3, views by source) | |
| 10.8 | n/a | tracked in visual refresh section 8 | |

## refresh-clubspace-visual-design

| Task | Status | Evidence | Gaps |
| --- | --- | --- | --- |
| 0.1 | done | already ticked | |
| 0.2 | missing | | product owner action |
| 5.1 cover migration | partial | `db/migrations/015_events_cover.js` (nullable `cover_key`, `cover_alt`, `cover_updated_at`) | not run on MySQL (B1) |
| 5.2 cover service | done | `backend-beta/src/features/covers/cover_service.js` (multer memory 5 MB, sharp decode/format/size, orientation, metadata strip, 3:2 crop, card/full WebP, random keys); `cover_service.test.js` 14 tests incl. EXIF GPS removal, PNG-as-JPEG 415, 800x600 422, 5 MB+ 413, replace/remove, orphan sweep | |
| 5.3 cover routes | missing | `cover_upload()` middleware ready and tested via multipart probe route | needs v1 events/auth/permissions (B1) |
| 5.4 DTO and cleanup | partial | `cover_dto`, `delete_cover_files`, `sweep_orphan_covers` | not wired to events DTO or worker (no worker yet) |
| 5.5 volume and docs | done | `compose.yaml` (`cover_data` volume, `COVER_DIR`), `backend-beta/Dockerfile`, README "Event cover images and migrations"; `docker compose config` passes | not exercised on the server |
| 5.6 cover contract tests | partial | service-level scenarios (413, 415, 422, EXIF, replace/remove) pass | 403, 404, 409 STALE_VERSION/INVALID_STATE need DB-backed routes |
| 1.1 split App.jsx | done | `frontend-beta/src/{App.jsx,pages/*,components/common.jsx,hooks/resources.js,lib/roles.js}`; code moved verbatim by a script; `npm test` 18 + 21 pass, `npm run build` ok, lint warnings unchanged in kind (0 errors) | long single-line components were kept as is; they are rebuilt page by page in 2-4 |
| 1.2 tokens, fonts, title, favicon | done | `src/styles/{tokens,theme,components,app}.css`, `index.html`, `public/favicon.svg`; `tests/design.test.js` (4 tests incl. no literal colours in any page or component stylesheet); `App.css` re-tokenised (123 literals replaced by hue/lightness mapping) and checked in the fixture preview | the old page markup keeps its old class names until each page is rebuilt (2-4); local additions `--scrim`, `--sheen-*` documented in tokens.css |
| 1.3 lucide and base components | done | `src/components/ui/{Button,StatusChip,TextField,Toast,EmptyState,BottomSheet}.jsx`; `tests/components.ui.test.jsx` (13 tests: busy, chips as words, label/hint/error linking, live region, 5 s, pause, Undo and expiry, focus trap/return, Escape, scrim); focus rings, 44 px and reduced motion come from `components.css`/`app.css` | |
| 1.4 fixtures | done | `frontend-beta/dev/fixtures.js` (5 clubs, covers with SVG art route, approved/rejected/pending drafts, past event, inbox with 3 unread), `src/lib/club.js`; `tests/fixtures.test.js` | |
| 2.1 navigation | done | `src/components/nav/{AppHeader,TabBar,AccountMenu,navigation}.jsx`, `src/hooks/useMediaQuery.js`, `src/App.jsx`; four tabs on phones, header links at 768 px and up, account control with Profile/Organizer/Admin/Sign out, badge hidden at 0 and read as "N unread"; UI tests for tab bar, badge, account menu Escape/focus; checked at 390 px in the fixture preview | club management moved to `/organizer/clubs`; `/clubs` is the new directory |
| 2.2 scroll padding and nav tests | done | `src/styles/layout.css` (`scroll-padding-bottom`, `--bars-height`), `tests/workflows.ui.test.jsx` updated | |
| 3.1 URL-synced filters and sheet | done | `src/lib/eventFilters.js`, `src/components/FilterChips.jsx`, `src/pages/Events.jsx`; `tests/eventFilters.test.js` (8) and `tests/discovery.ui.test.jsx` (6: chips to API and URL params, reload restores, sheet apply and count, filtered-empty with Clear filters, API failure not shown as empty, reversed range blocked) | "My clubs" chip omitted: `/events` accepts a single `club_id` |
| 3.2 EventCard | done | `src/components/EventCard.jsx` (date tile, club colour, meter with Almost full at 85%, stickers, cover `<img width=600 height=400 alt="" loading=lazy>` or aria-hidden art, one link per card); asserted in `discovery.ui.test.jsx` | no layout-shift measurement in a real browser; checked visually in the fixture preview |
| 3.3 event page | done | `src/pages/EventDetail.jsx`, `src/components/StickyActionBar.jsx`, `src/lib/{registration,ics}.js`, `src/styles/event.css`; `tests/registration.test.js` (9) and `tests/eventPage.ui.test.jsx` (9: state cards, Join/Join waitlist bodies, 409 next to the action with refetch, restrictions say why, .ics download, Undo sends nothing and expiry sends DELETE once, phone sticky bar with aria-live and reserved height); checked at desktop and 390 px in the fixture preview | the leave request is lost if the tab closes during the 5 s Undo window (by design) |
| 3.4 My events and Clubs directory | done | `src/pages/{Registrations,ClubsDirectory,Profile}.jsx`, `src/lib/myEvents.js`; `tests/myEvents.ui.test.jsx` (tabs with counts, URL tab, arrow keys, empty states, join toast, leave needs an in-page confirm, Profile has no join or leave); club management moved to `/organizer/clubs` | member and event counts on club cards appear only if the API supplies them (the v1 Club DTO has none) |
| 3.5 Inbox | done | `src/pages/Notifications.jsx`, `src/lib/notificationTypes.js` (every type from beta-feedback section 3 has an icon and label; day groups in campus time); tests in `myEvents.ui.test.jsx` | no bulk-read endpoint exists: Mark all as read sends one PATCH per unread message on the page and reports failures |
| 4.1 SlotPicker | done | `src/components/SlotPicker.jsx`, `src/lib/slots.js`, `src/pages/CreateEvent.jsx`; `tests/request.ui.test.jsx` (past/booked/available from full intervals, week and slot in the URL, 409 shown above the slots with refresh and fields kept) | |
| 4.2 three-step request | done | step, venue, week, date and slot in the URL; inline errors, venue capacity check, review step; tests above plus the updated copy-details and calendar-carry tests in `workflows.ui.test.jsx` | cover uploader slot is added in 6.1 |
| 4.3 organizer home, stepper, manage event | done | `src/pages/{Organizer,ManageEvent}.jsx`, `src/lib/lifecycle.js`, `src/components/LifecycleStepper.jsx`; `tests/organizer.ui.test.jsx` (steps from booking and event state, Needs action first, publish sends expected_version, in-page cancel confirm, rejected reason, tab in URL) | |
| 4.4 admin queue and review panel | done | `src/pages/Admin.jsx` (table, review dialog with the venue's day, capacity line, reason required to reject, own-club block, expired disabled); tests in `organizer.ui.test.jsx` and `workflows.ui.test.jsx` | capacity check shows only when the booking DTO carries `capacity` |
| 6.1 CoverUploader | done | `src/components/CoverUploader.jsx`, `src/lib/cover.js`, multipart support in `src/api.js`, wired into request step 2 (uploaded after the event is created) and Manage event > Edit (Replace, Remove); `tests/cover.ui.test.jsx` (6), `tests/apiForm.test.js` | no byte-level progress (fetch has none): indeterminate progress and a busy button; only proven against fixtures, the real cover routes need the DB-backed backend (B1); hidden when the legacy `/api` provider is used |
| 6.2 render covers | done | `<img>` with width/height and alt on the event page, `alt=""` plus lazy loading below the first two cards, aria-hidden fallback art (`EventCard`, `EventDetail`; asserted in `discovery.ui.test.jsx`, `eventPage.ui.test.jsx`) | |
| 7.1 screens at five widths, both themes | partial | contrast test `tests/contrast.test.js`; browser measurement: no horizontal overflow at 320/390/768/1024/1440 on 11 routes (fixed a table `.cs-sr` overflow); spot screenshots at desktop and 390 px | no stored screenshot set, no canvas comparison, dark mode checked only as the browser pane's scheme |
| 7.2 keyboard walk, 200% zoom, reduced motion | partial | focus order, Escape, focus return, arrow keys covered by UI tests; reduced-motion rules in `components.css` and `app.css` | no manual keyboard and zoom walk recorded |
| 7.3 run builds, record results | done | `frontend-beta/INTEGRATION.md` "Verification record"; backend 79 and frontend 45 node plus 79 vitest tests pass, build ok, lint 0 errors | real-provider run not possible (B1), recorded as such; there was no "missing filters" note in the beta to remove |
| 8.1 notification stream client | done | `src/hooks/useLiveInbox.js`, `src/App.jsx`; `tests/liveInbox.ui.test.jsx` (5: stream URL, badge and toast from pushed events, refetch event, 60 s fallback on error and stop on reopen, close on unmount, 60 s poll without EventSource); `Last-Event-ID` is sent by the browser on reconnect; inbox page refresh is 60 s | against a fake EventSource only; the real stream route is not mounted in the API (needs v1 auth, B1). The legacy `/api` provider (production mode) has no stream, so it keeps its 30 s poll |
| 8.2 role-aware organizer UI | done | `src/components/SignoffQueue.jsx`, `src/pages/{Organizer,ManageEvent,ClubTools}.jsx`; role chips, the president's sign-off queue (send on, return with a required reason), "Waiting for the president" and returned-reason states, members page (appoint, remove, transfer behind an in-page confirmation), cancel of a published event only for the president or an admin; `tests/feedback.ui.test.jsx` | proven against fixtures and unit stubs, not walked through against the real v1 backend in a browser |
| 8.3 tags | done | `src/components/TagPicker.jsx` (1-3 campus tags, up to 5 club tags, add club tag), tag chips and `tag` in the URL, tags on cards and the event page; tests in `feedback.ui.test.jsx` | club tags are not shown on a club page (no club page exists) |
| 8.4 check-in | done | `src/components/CheckinPanel.jsx` (Open check-in, large code with a spoken label, attendee list with mark and unmark) and the student Check in action with code entry and field error on the event page | the student action sits in the sticky bar on phones and the side card on desktop |
| 8.5 effectiveness report and views | done | `src/pages/Effectiveness.jsx`, `src/EffectivenessChart.jsx` (MUI bar chart plus exact tables, definitions, "Not recorded" and "Too few events"); `POST /events/:id/views` with the entry-point source (explore, club, inbox, my_events, share) | |
| 8.6 fixtures and canvas states | partial | fixtures: sign-off queue, awaiting and returned events, check-in event with attendance, effectiveness report, tags, members with versions, and a live-toast SSE route (`dev/fixtures.js`, `?preview=president`) | the key-screens canvas artifact is outside this repository and was not updated |

## Base commits from teammates

`beta-interview` already contains the president action log with undo, demote and kick, role-change notifications and club join requests (`clubs.service.js`, `club_action_log.js`, migrations in `db/legacy-sql/`). They count toward 10.2 and 10.3 as partial (president-only role changes and some immediate notifications exist, on unversioned `/api` routes without versions, sign-off, tags, SSE) and are built on, not duplicated.

## Decisions

- **Legacy routes stay (2026-11-16).** The unversioned `/api/...` routes remain mounted next to `/api/v1`; they are not retired with 410 until a coordinated cutover. Specs updated (`api-frontend-contract`, `handoff/api.md`, `design.md`, `proposal.md`, tasks 3.3 and 8.8). New features exist only on `/api/v1`. Both share one session and cookie.
- **Legacy timezone (2026-11-16).** Existing DATETIME values are Asia/Taipei local time (UTC+8, no DST); migration 004 shifts them once with `LEGACY_DATETIME_TIMEZONE=Asia/Taipei`. Because legacy routes stay, their SQL now stores UTC and adds 8 hours on reads (`shared/timeslots.js`, `events.service.js`, `venues.service.js`), proven by `legacy_compat.db.test.js`.
- **First presidents (2026-11-16): generated.** `src/ops/provision-dev.js` creates one fictional president per club without one (never promoting an existing committee member), with `.example` emails, unique `PRES-nnn` student IDs and a password from `DEV_ACCOUNT_PASSWORD` or generated at run time. Generated presidents: Photography Society: Chan Hiu Tung (`president.club1@clubspace.example`); Film Society: Leung Ka Ho (`president.club2@clubspace.example`); Debate Club: Wong Tsz Yan (`president.club3@clubspace.example`); preview fixtures only: Chess & Strategy: Lam Man Kit, Hiking Club: Cheung Yuk Ching, Robotics Lab: Ng Chun Wai.
- **Join approval on v1 (2026-11-16).** Ported from `beta-interview` (1da6a47, requested 2026-11-06): v1 `PUT /clubs/:id/membership` now creates a committee-reviewed request (202) instead of joining at once, which also closes the bypass of the legacy routes' approval. Members-only event registration by a plain member creates a pending request that the committee accepts or rejects (`/events/:id/join-requests`); committee and president register directly, public events stay automatic. Migration `016_join_requests`. Tasks 3.8 and 3.9.
- **Ported from `beta-interview` 1da6a47 (2026-11-16):** Docker image includes `db/migrations`, worker healthcheck, `retry-notification-job.js`, `/api/health` 503 body, campus-date `today()` for the legacy routes, and the backup-then-migrate redeploy procedure. Not ported: its separate `features/*/v1*.js` API, `express-mysql-session`, date-named SQL migrations and `migrate-workflows.js` (superseded by `src/api_v1/`, the MySQL session store and migrations 001–016), its 410 retirement of legacy routes (legacy routes stay, decision above) and its Hong Kong local-time storage (main converts to UTC).
- `campus_tag_ids` is optional on create and defaults to Social (the spec lists 1..3 as required) so existing clients keep working.
- Tab destinations are unconfirmed; the current choice is kept.

## Deviations

- `memberships.president_club_id` is VIRTUAL, not STORED: MySQL rejects a stored generated column over `club_id` because of its `ON DELETE CASCADE` foreign key. The unique index still enforces one president per club.
- The composite booking/event interval foreign key (database.md section 2) is not added: the legacy edit flow rewrites both rows in two statements. The service layer keeps them equal.
- Legacy `participations` keep `pending`/`unsuccessful` beside the spec's statuses; v1 reads map them to waitlisted and left.

- **Frontend cutover to v1 (2026-11-16).** The frontend calls only `/api/v1` in every build mode; the `mainBackend.js` adapter, the legacy club page and `WorkflowUnavailable` are gone. Legacy `/api` routes stay mounted but unused; no 410 yet. The beta's club management (remove a member, leave the committee, the president's action log and undo) moved to v1 (`src/api_v1/club_actions.js`) on the same `club_action_log` table; promotion stays president-only per club-governance, where the beta also let committee promote. Fresh deployments run migrations through the Compose `migrate` service.
- Club management moved to `/organizer/clubs` and `/clubs` became the directory (tab destinations still an open review decision).
- Migration numbering: workflow migrations 002, 003 plus 010-015 (feedback and covers); 001, 004-006 (tracking is in the runner; backfill, constraints, cutover marker) are not written. Legacy loose SQL moved to `db/legacy-sql/`.
- Beta `participations` keeps its `pending`/`unsuccessful` vocabulary next to the spec's `waitlisted`/`left`/`cancelled` (superset enum in 002) until a cutover mapping migration exists.
- `bookings.status` and `events.status` keep legacy defaults (`confirmed`/`published`) in 002 so the beta API keeps working.
- Mark all as read sends one PATCH per message (no bulk endpoint). Club cards show counts only if the API supplies them.

