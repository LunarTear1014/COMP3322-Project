# Implementation checklist

Reference implementation plan: recipients may use their own development and tracking tools. No agent-coordination setup is required. Design-only: no checkbox below is completed. Follow dependencies in order. Each item requires implementation evidence, not merely a document update. Backend/database providers must publish passing contract tests before frontend integration. Personal ownership is agreed by the team, not assigned here.

## 1. Review and shared contract

- [x] 1.1 Review proposed feature scope/non-goals and proposal questions with team/instructor; record approved defaults or revise specs/ADR before coding.
- [ ] 1.2 Confirm deployment schedule/VM resources/TLS, MySQL8.4 and legacy datetime timezone; record preflight inputs without secrets.
- [ ] 1.3 Agree API enums/DTOs/error codes and schema field mapping across backend/frontend/database; create contract fixtures from api.md.
- [x] 1.4 Add runnable verification scripts and a disposable MySQL test database configuration; document commands and destructive-test isolation.

## 2. Database provider

- [x] 2.1 Implement checksummed migration runner with database advisory lock and partial-DDL detection; test rerun/checksum/interruption failures.
- [x] 2.2 Implement legacy integrity preflight for overlaps, relationships, capacities and normalized identities; verify it refuses bad fixtures.
- [x] 2.3 Add workflow role/status/version/actor/deadline/participation fields and support tables with keys/collations from database.md.
- [x] 2.4 Implement operator-confirmed one-time UTC backfill and legacy defaults without invented decisions/history; test already-UTC and Hong Kong-local datasets.
- [x] 2.5 Add stronger constraints/indexes after preflight; EXPLAIN overlap, queue, job and report queries; compare preserved IDs/counts.
- [x] 2.6 Repair fresh schema's invalid users.role index and define consistent fresh-install/upgrade migration baselines; verify both end with identical schema/version.
- [x] 2.7 Add secure development account/privilege provisioning and password-hash generation; test placeholders cannot authenticate and no fixed production admin is seeded.

## 3. Backend foundation

- [ ] 3.1 Separate startup/app/router/controller/service/repository/query modules without changing runtime behavior prematurely; add characterization contract tests.
- [x] 3.2 Implement transaction helper, UTC connection setup, global lock order, bounded retry and original-error preservation; test rollback/release/uncertain commit.
- [x] 3.3 Implement JSON/query validation, request IDs, error envelopes,404/405 handling (410 for retired legacy URLs only after the coordinated cutover) and bounded body parsing.
- [x] 3.4 Implement server-side session adapter/config and CSRF/Origin middleware; verify cookies, token renewal, restart persistence and logout.
- [ ] 3.5 Implement password hashing/verification, normalized registration/login, dummy path, hash queue and throttling; benchmark target memory/latency.
- [x] 3.6 Implement current-user profile/session/config endpoints and DB-backed identity/permission helpers; verify no DEMO_USER_ID bypass.
- [x] 3.7 Implement persistent club membership endpoints with protected committee/active-registration leave rules; pass scoped access and membership race tests.
- [x] 3.8 Implement committee-scoped club join requests with approval/rejection and pending state in the member and organizer interfaces (requested 2026-11-06, ported from `beta-interview` 1da6a47 into v1). Evidence: `src/api_v1/join_requests.db.test.js` (202 request, committee-only list, concurrent review, digest audit, withdrawal); frontend `myEvents.ui.test.jsx`.
- [x] 3.9 Implement committee approval/rejection for members-only event join requests, preserving capacity, waitlist ordering, withdrawal and notifications; public event joins remain automatic. Evidence: `join_requests.db.test.js` (requested state, committee direct registration, EVENT_FULL keeps the request, accept to joined and waitlisted, promotion, withdraw/leave/cancel close requests, closed on lost membership); frontend `joinRequests.ui.test.jsx`, `registration.test.js`.

## 4. Booking/event backend

- [x] 4.1 Implement slot/date validation and Hong Kong-to-UTC mapping; test impossible dates, future boundaries and fixed slots.
- [x] 4.2 Implement atomic pending booking+draft creation with actor/audit/job writes; test injected mid-transaction failures.
- [x] 4.3 Implement admin review queue/decision, no self-decision, versioning and confirmed overlap check; pass independent-connection R1.
- [x] 4.4 Implement event visibility/list/detail/managed routes with bounded filters and private-draft protection; pass response contract tests.
- [x] 4.5 Implement draft/published edit limits and independent publish transition; test stale versions and approval not publishing.
- [x] 4.6 Implement idempotent atomic cancellation across booking/event/participation/history/jobs; test no promotion, after-start limits and R4.

## 5. Participation backend

- [x] 5.1 Implement current participation/history repositories, registration eligibility and one-row idempotency; test cross-session persistence.
- [x] 5.2 Implement capacity/waitlist limits and queue ordering under sentinel locks; pass final-seat R2.
- [x] 5.3 Implement withdrawal and promoteLocked including ineligible legacy candidates and deadline rules; pass FIFO/new-arrival R3.
- [x] 5.4 Implement my-registration and protected participant-list contracts; test privacy, pagination, computed queue positions and R5 membership race.
- [x] 5.5 Verify cancellation/withdraw/rejoin actions append only actual transitions and preserve meaningful current-versus-history counts.

## 6. Background processing backend

- [x] 6.1 Implement source-transaction outbox job writes and internal payload validation/snapshot recipients; prove rollback leaves no orphan job.
- [x] 6.2 Implement due claims, lease tokens/reclaim, conditional completion, retry delays/max-attempt handling and failed-job operator visibility.
- [x] 6.3 Implement deduplicated in-app delivery, historical-message policy and own-inbox/read endpoints; pass replay/ownership tests.
- [x] 6.4 Implement event reminder scan and late-registration/promotion reminder path with shared visible dedup key; test deadline/start/cancel/downtime boundaries.
- [ ] 6.5 Implement worker heartbeat/shutdown and operator retry procedure; pass crash/fencing R7-R9 and verify one supported worker process in Compose.

## 7. Calendar/reporting backend

- [x] 7.1 Implement full-interval calendar reads, anonymous private busy blocks, pending exclusion and31day bounds; test cross-midnight legacy data.
- [x] 7.2 Implement committee-only current counts, history daily actions/zero-fill/cutoff and clipped venue-hours aggregates; test no join multiplication/attendance claims.
- [ ] 7.3 Freeze passing API fixtures/contract tests for frontend use; record provider schema version and tested commit.

## 8. Frontend integration

- [ ] 8.1 Implement shared API/auth/CSRF/error handling and login/register/profile flows; remove fake fallback profile/state.
- [ ] 8.2 Replace hardcoded club/venue/membership data and persist join/leave with meaningful409 guidance.
- [ ] 8.3 Implement event discovery/details/registration/waitlist/my-registration screens with authoritative states and preserved input on conflict.
- [ ] 8.4 Replace organizer placeholder with managed drafts, edit/publish/cancel and participant views; use expected versions.
- [ ] 8.5 Implement admin pending-review queue/rejection reasons/conflict behavior with no self-decision UX.
- [ ] 8.6 Implement weekly campus-time calendar and slot-to-request flow, including private blocks and keyboard alternative.
- [ ] 8.7 Implement inbox/unread polling and report charts/tables with history cutoff and honest metric labels.
- [ ] 8.8 Update every Alpha fetch in one coordinated v1 cutover, then retire legacy routes with 410 (legacy routes stay mounted until then); test401/403/404/409/410/422/429/503, mobile/keyboard/deep links and stale requests. Progress (2026-11-16): every frontend fetch now goes to `/api/v1` (adapter removed; real-stack smoke test on a fresh Compose database covered register, sign-in, club request and review, members-only request and accept, the action log, and live inbox updates over SSE). Open: 410 retirement of the legacy routes and the full error-status walk.

## 9. Release and handoff verification

- [x] 9.1 Run full MySQL race/migration/restart suite in verification.md; collect final rows, commands and commit/image versions.
- [ ] 9.2 Implement production Compose/API/worker/frontend routing, secrets template, migration account/runtime privileges and schema-version startup gate.
- [ ] 9.3 Prove clean Linux deployment, persisted restart, TLS/session/proxy behavior, worker health, backup restore and documented rollback limitations.
- [ ] 9.4 Update README, API/ER/system diagrams, final coursework PDF and app credits to shipped scope; rehearse role-based demo and member explanations.
- [ ] 9.5 Review the implemented scope and release evidence with the team before merge; record outstanding limitations in the final handoff.

## 10. Beta feedback additions (see handoff/beta-feedback.md)

- [x] 10.1 Add migrations 010–014 (president role and constraint, sign-off states, tags, attendance and views, notification types and digests). Run them against fresh and Alpha-copy databases, and have the operator provision each club's first president.
- [x] 10.2 Implement `GovernanceService`: role changes, presidency transfer, booking and publication sign-off, and president-only cancellation of published events. Test that two presidents are impossible, the 403s, stale versions, and that awaiting bookings are never busy or seen by admins.
- [x] 10.3 Move immediate notification types into their source transactions, following the matrix. Add the `event_published`, `signoff_*`, `role_changed`, `club_updated`, `checkin_opened` and `activity_digest` types, the 09:00 HKT digest job and its catch-up. Test that the actor is excluded, dedup holds and nothing is sent on rollback.
- [x] 10.4 Implement `NotificationStreamHub` and `GET /notifications/stream`: 1 s tail, Last-Event-ID replay, heartbeat, per-user connection cap and proxy settings. Test delivery under 2 s, reconnect with no gaps or duplicates, and isolation between users.
- [x] 10.5 Implement campus and club tags, event tagging on create and edit, the `tag` filter and tag-aware keyword search. Test limits, cross-club tags, retired tags and the combination with other filters.
- [x] 10.6 Implement check-in (open, code, mark and unmark, window, rate limit, joined-only) and view tracking (sources, 30-minute dedup, 180-day purge).
- [x] 10.7 Implement `GET /clubs/:id/reports/effectiveness` with named SQL. Verify against hand-built fixtures: join, leave and rejoin; a promoted no-show; no check-in; a group under 3; and views by source.
- [ ] 10.8 Frontend parts of these features are tracked in `refresh-clubspace-visual-design` (section 8).

## 11. Club management and live updates on v1

- [x] 11.1 Port the beta's remove-member, leave-committee and president action log with undo to v1 on `club_action_log`; v1 role, presidency and join-request decisions write log entries. Evidence: `src/api_v1/club_actions.db.test.js` (removal ends members-only places and promotes, undo of removal, step-down, version bumps, later-action block, president-only log, join-request undo, presidency undo).
- [x] 11.2 Push live page hints over the SSE stream (`live_signals`, migration 017): seats, waitlist, state, join requests and check-in refresh open screens without a reload. Evidence: `stream_hub.test.js` (public versus club audience, coalescing, no SSE id), `live_signals.db.test.js` (hints per action, none on rollback), frontend `liveSignals.ui.test.jsx`; real stack: a withdrawal updated another user's open event page within 2 s.
