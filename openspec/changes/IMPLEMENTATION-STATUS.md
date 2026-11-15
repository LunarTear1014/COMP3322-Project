# Implementation status

Branch: `worktree-agent-ace44ab10ef85bdb2` (from `beta-interview`). Targets: `backend-beta/`, `frontend-beta/` (not the alpha folders).
Last updated: 2026-11-16. Audit baseline: backend `npm test` 6 pass, frontend `npm test` 18 node + 21 vitest pass, build ok, lint 5 warnings (react set-state-in-effect).

Legend: done = code and a passing test prove it (ticked). partial = some code exists but the task is not met. missing = nothing relevant. blocked = needs the disposable MySQL database (see Blockers).

## Blockers

- **B1 test database.** The configured MySQL user (`clubspace_app`) has `ALL` on `clubspace` only; `CREATE DATABASE clubspace_test_agent` fails with `ER_DBACCESS_DENIED_ERROR`. Per the run rules I did not use root, change grants, or touch `clubspace`. DB-dependent tests are written to skip unless `TEST_DB_NAME` names a disposable database (guard: name must contain `test` and differ from `DB_NAME`), so they have **not been run**. Any task whose proof needs them is not ticked.
- MySQL server reports version `26.7.0`, not 8.4. Spec text pins 8.4. The `compose.yaml` image is `mysql:8.4`.

## Audit of the beta (what really exists)

`backend-beta` is smaller than the brief suggested. It has: session auth (register/login/logout/me/update/delete, scrypt, in-memory sessions), clubs, join requests, presidency, committee appoint/demote, kick, an undoable club action log, events that are created already confirmed and published, participation with a FIFO-ish waitlist (`participations.status` joined/pending/unsuccessful, no history table), notifications (rows written inline, no jobs), venues. It has **no** `/api/v1`, booking approval, bookings API, calendar, reports, jobs/worker, migration runner, request IDs, CSRF, versions, tags, check-in or covers. Unversioned `/api/*` routes are used by `frontend-beta/src/mainBackend.js`, which adapts v1-shaped calls onto them. The frontend already has a fixtures-mode v1 preview.

## expand-clubspace-workflows

| Task | Status | Evidence | Gaps |
| --- | --- | --- | --- |
| 1.1 scope review | partial | Product owner approved implementation 2026-11-16 (run brief) | Proposal questions not individually recorded |
| 1.2 deployment/timezone preflight | missing | | needs operator input |
| 1.3 contract fixtures | missing | | |
| 1.4 verification scripts, test DB config | partial | `test/db_guard.js` (disposable-DB guard), `src/db/*.db.test.js` skip unless `TEST_DB_NAME` | no runnable DB; command docs pending |
| 2.1 migration runner | partial | `src/db/migrate.js`, `src/ops/migrate.js`; 8 fake-connection tests in `src/db/migrate.test.js` (order, checksum, resume after interrupted DDL, lock contention, version gate); real-DB test `src/db/migrate.db.test.js` written, NOT RUN (B1). Legacy loose SQL moved to `db/legacy-sql/` | advisory lock and information_schema helpers unproven on MySQL |
| 2.2 integrity preflight | missing | | |
| 2.3 workflow fields | partial | `db/migrations/002_workflow_columns.js`, `003_support_tables.js`; shape tests in `db/migrations/migrations.test.js` | not executed on MySQL (B1) |
| 2.4 UTC backfill | missing | | |
| 2.5 constraints/indexes | missing | | |
| 2.6 fresh schema baseline | partial | `schema.sql` has no invalid `users.role` index | no version table/baseline |
| 2.7 secure provisioning | partial | `src/ops/provision-starter-accounts.js` | not hash-generation tool, placeholders untested |
| 3.1 module split | partial | `src/features/*` routes/service split | no app factory, controllers/repos/queries; no characterization tests |
| 3.2 transaction helper | done | `src/db/transaction.js` (READ COMMITTED, retry 1213/1205 twice, lock-order helper, uncertain commit), `src/db/pool.js` (UTC pool); `src/db/transaction.test.js` 9 tests with a fake pool | legacy services keep hand-written transactions; real-MySQL deadlock injection not run (B1) |
| 3.3 validation/envelopes | partial | `src/app.js`, `src/middleware/{request_id,json_body,error_handler}.js`, `src/shared/{errors,validate}.js`; `src/app.test.js` (8 tests: 404/405+Allow, 400/413/415/422, sanitized 500, request id) | 410 retired-URL handling not enabled (legacy `/api` routes still serve the beta frontend); v1 resources not yet mounted |
| 3.4 session/CSRF | partial | `src/middleware/csrf.js`, `/api/v1/auth/csrf`; tests in `src/app.test.js` (Origin, token, stable token) | MySQL session store, login regeneration, restart persistence, logout: not done (B1) |
| 3.5 hashing | partial | `src/features/users/password_hasher.js` (scrypt N=131072/r=8/p=1, versioned format, legacy verify and rehash flag, dummy path for unknown email, concurrency 2 / queue 10 / 503 AUTH_BUSY, 10-per-15-min throttle); `password_hasher.test.js` 10 tests; benchmark on this Mac: one hash 177 ms | not wired into login/registration (no v1 auth); VM memory benchmark (2 x 128 MiB) not done |
| 3.6 profile/session endpoints | partial | `/api/auth/*` | not v1; `DEMO_USER_ID` only in `.env.example` |
| 3.7 membership endpoints | partial | `clubs.routes.js` join/leave/committee | different model (join requests); not v1 |
| 4.1 slot/date validation, HK to UTC | done | `src/shared/slots.js`, `src/shared/validate.js`; `src/shared/validate.test.js` (impossible dates, HK midnight, future boundary, fixed slots) | |
| 4.2-4.6 booking/event backend | missing | beta creates confirmed+published event in one step | blocked by B1 for proof |
| 5.1-5.5 participation backend | partial | `events.service.js` register/withdraw/promote with `FOR UPDATE` | no history, capacity rules, idempotency tests |
| 6.1-6.5 background processing | missing | | |
| 7.1-7.3 calendar/reporting | missing | | |
| 8.1-8.8 frontend integration | partial | fixtures v1 preview; `mainBackend.js` adapter; 21 UI tests | live v1 provider absent |
| 9.1-9.5 release | missing | `compose.yaml` runs web+backend+db only | |
| 10.1 migrations 010-014 | partial | `db/migrations/010`-`014` (additive, idempotent helpers); 010 preflight tested with a fake | not executed on fresh or Alpha-copy MySQL (B1); operator must provision first presidents |
| 10.4 notification stream | done | `src/features/notifications/{stream_hub,stream.routes,notifications.repository}.js`; `stream_hub.test.js` 8 tests (headers, auth, delivery well under 2 s, isolation, Last-Event-ID replay without gaps or duplicates, refetch over 200, connection cap 429, heartbeat, late lower id); nginx location in `frontend-beta/nginx.conf` | repository SQL and the real session-based `authenticate` are untested on MySQL (B1); hub is not yet mounted in `index.js` because v1 auth does not exist |
| 10.2-10.3, 10.5-10.7 | missing | beta has president transfer/demote/kick in `clubs.service.js` (different API) | |
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
| 4.1-4.4, 6.1-8.6 | missing | | |

## Decisions

(none yet)

## Deviations

(none yet)
