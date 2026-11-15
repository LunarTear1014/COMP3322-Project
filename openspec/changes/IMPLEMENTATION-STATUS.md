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
| 3.5 hashing | partial | `passwords.js` scrypt N=16384 default | spec parameters, queue, throttle missing |
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
| 10.2-10.7 | missing | beta has president transfer/demote/kick in `clubs.service.js` (different API) | |
| 10.8 | n/a | tracked in visual refresh section 8 | |

## refresh-clubspace-visual-design

| Task | Status | Evidence | Gaps |
| --- | --- | --- | --- |
| 0.1 | done | already ticked | |
| 0.2 | missing | | product owner action |
| 1.1-8.6 | missing | `App.jsx` is a single 51 KB file using MUI | |

## Decisions

(none yet)

## Deviations

(none yet)
