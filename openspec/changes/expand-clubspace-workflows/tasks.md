# Implementation checklist

Reference implementation plan: recipients may use their own development and tracking tools. No agent-coordination setup is required. Follow dependencies in order. Each item requires implementation evidence, not merely a document update. Backend/database providers must publish passing contract tests before frontend integration. Personal ownership is agreed by the team, not assigned here.

## 1. Review and shared contract

- [ ] 1.1 Review proposed feature scope/non-goals and proposal questions with team/instructor; record approved defaults or revise specs/ADR before coding.
- [ ] 1.2 Confirm deployment schedule/VM resources/TLS, MySQL8.4 and legacy datetime timezone; record preflight inputs without secrets.
- [ ] 1.3 Agree API enums/DTOs/error codes and schema field mapping across backend/frontend/database; create contract fixtures from api.md.
- [ ] 1.4 Add runnable verification scripts and a disposable MySQL test database configuration; document commands and destructive-test isolation.

## 2. Database provider

Progress (2026-11-06): a checksummed runner takes a database advisory lock, records started/applied state and refuses unexpected schema, changed checksums or interrupted DDL; fresh schemas carry the same tracked baseline. An integrity preflight checks relationships, overlaps, capacities, waitlists, normalized identity conflicts and lifecycle states before the first migration. On a disposable populated copy of the `beta-v1` schema, the preflight and all eight migrations passed; IDs, roles, statuses, timestamps and a legacy notification survived, and rerunning skipped all eight migrations. Fresh and upgraded databases matched in the checked column definitions, indexes and constraint names. A fresh isolated Compose stack started healthy, provisioned both starter roles and retained records after restart. Tasks 2.1–2.6 remain open pending the remaining integrity coverage, UTC backfill, full schema equivalence and restore verification.

Scope note (2026-11-06): the user requested that UTC backfill and restore verification be deferred for the current work. The application continues to store event datetimes as Hong Kong local time; these OpenSpec requirements are not marked complete.

- [ ] 2.1 Implement checksummed migration runner with database advisory lock and partial-DDL detection; test rerun/checksum/interruption failures.
- [ ] 2.2 Implement legacy integrity preflight for overlaps, relationships, capacities and normalized identities; verify it refuses bad fixtures.
- [ ] 2.3 Add workflow role/status/version/actor/deadline/participation fields and support tables with keys/collations from database.md.
- [ ] 2.4 Implement operator-confirmed one-time UTC backfill and legacy defaults without invented decisions/history; test already-UTC and Hong Kong-local datasets.
- [ ] 2.5 Add stronger constraints/indexes after preflight; EXPLAIN overlap, queue, job and report queries; compare preserved IDs/counts.
- [ ] 2.6 Repair fresh schema's invalid users.role index and define consistent fresh-install/upgrade migration baselines; verify both end with identical schema/version.
- [ ] 2.7 Add secure development account/privilege provisioning and password-hash generation; test placeholders cannot authenticate and no fixed production admin is seeded.

## 3. Backend foundation

Changed requirement (2026-11-06): the user requested committee approval or rejection of club membership requests, and committee review of event registrations for members-only events. Public event registration remains automatic and the waitlist remains available. These requirements supersede the original immediate club-join behavior and require coordinated API, UI and persistence changes.

- [x] 3.8 Implement committee-scoped club join requests with approval/rejection and pending state in the member and organizer interfaces. Evidence: `workflow.http.test.js` checks pending requests, scoped access and approval; `workflows.ui.test.jsx` exercises the committee action.
- [ ] 3.9 Implement committee approval/rejection for members-only event join requests, preserving capacity, waitlist ordering, withdrawal and notifications; public event joins remain automatic. Progress: HTTP checks cover pending, scoped review, rejection, waitlisting after approval and promotion; the frontend review action is covered by `workflows.ui.test.jsx`. Broader concurrency and lifecycle verification remains.

Progress (2026-11-06): sessions now persist in MySQL with an eight-hour rolling cookie. Mutation requests require an exact configured Origin, JSON and a per-session CSRF token; login regenerates and saves the session/token before responding. The beta frontend uses v1 registration, login, session, logout, profile and CSRF endpoints; unversioned business routes now return 410. Disposable HTTP tests verify retirement, registration without auto-login, token rotation, foreign-origin and invalid-token rejection, session survival across API restart, logout, profile privacy and role-escalation rejection. Tasks remain open pending remaining security and deployment checks.

- [ ] 3.1 Separate startup/app/router/controller/service/repository/query modules without changing runtime behavior prematurely; add characterization contract tests.
- [ ] 3.2 Implement transaction helper, UTC connection setup, global lock order, bounded retry and original-error preservation; test rollback/release/uncertain commit.
- [ ] 3.3 Implement JSON/query validation, request IDs, error envelopes,404/405/410 handling and bounded body parsing.
- [ ] 3.4 Implement server-side session adapter/config and CSRF/Origin middleware; verify cookies, token renewal, restart persistence and logout.
- [ ] 3.5 Implement password hashing/verification, normalized registration/login, dummy path, hash queue and throttling; benchmark target memory/latency.
- [ ] 3.6 Implement current-user profile/session/config endpoints and DB-backed identity/permission helpers; verify no DEMO_USER_ID bypass.
- [ ] 3.7 Implement persistent club membership endpoints with protected committee/active-registration leave rules; pass scoped access and membership race tests.

## 4. Booking/event backend

Progress (2026-11-06): requests create pending bookings and private drafts with audit and notification intent. A separate venue admin can review them under the venue lock; approval leaves a draft, and committee publication is versioned. Cancellation updates the booking and active registrations atomically with history and notification intent. Event, booking, registration, club and membership screens call v1 routes with scoped details and bounded pagination. Disposable-MySQL and HTTP tests cover overlapping approval races, private drafts, self-decision, stale versions, publication, cancellation, final-seat registration, membership races, idempotent joins and protected committee leave. An upgrade fixture preserved existing records through the additive migrations. These tasks remain open pending the remaining coordinated v1 routes, complete lock/migration protocol, broader security and end-to-end verification.

- [ ] 4.1 Implement slot/date validation and Hong Kong-to-UTC mapping; test impossible dates, future boundaries and fixed slots.
- [x] 4.2 Implement atomic pending booking+draft creation with actor/audit/job writes; test injected mid-transaction failures. Evidence: `backend-beta/src/features/events/events.mysql.test.js` verifies recipient/actor audit and an injected event-insert failure leaves booking, audit and job counts unchanged; `workflow.http.test.js` checks the v1 draft response.
- [ ] 4.3 Implement admin review queue/decision, no self-decision, versioning and confirmed overlap check; pass independent-connection R1.
- [ ] 4.4 Implement event visibility/list/detail/managed routes with bounded filters and private-draft protection; pass response contract tests.
- [ ] 4.5 Implement draft/published edit limits and independent publish transition; test stale versions and approval not publishing.
- [ ] 4.6 Implement idempotent atomic cancellation across booking/event/participation/history/jobs; test no promotion, after-start limits and R4.

## 5. Participation backend

Progress (2026-11-06): v1 registration, withdrawal, own-registration and committee participant-list routes are connected to the frontend. New registrations and promotions persist distinct registration, queue and confirmation timestamps; legacy confirmation times remain unknown rather than invented. Disposable HTTP checks cover participant-list authorization, UTC timestamps and current registration state. Tasks remain open pending the complete lock protocol, v1-only cutover and full race/contract verification.

- [ ] 5.1 Implement current participation/history repositories, registration eligibility and one-row idempotency; test cross-session persistence.
- [ ] 5.2 Implement capacity/waitlist limits and queue ordering under sentinel locks; pass final-seat R2.
- [ ] 5.3 Implement withdrawal and promoteLocked including ineligible legacy candidates and deadline rules; pass FIFO/new-arrival R3.
- [ ] 5.4 Implement my-registration and protected participant-list contracts; test privacy, pagination, computed queue positions and R5 membership race.
- [ ] 5.5 Verify cancellation/withdraw/rejoin actions append only actual transitions and preserve meaningful current-versus-history counts.

## 6. Background processing backend

Progress (2026-11-06): beta booking, edit, cancellation and registration transactions write notification intent; a Compose worker claims leases, delivers deduplicated inbox messages and scans/queues reminders. The worker exposes a database heartbeat and a local operator-only retry command records an audit entry. The frontend uses the v1 paginated inbox, including full unread counts and owner-only read actions. Disposable-MySQL and HTTP coverage exercises rollback, replay, stale-token fencing, cancellation suppression, all five retry outcomes, worker restart, audited retry, inbox pagination and read ownership. `reminders.mysql.test.js` also checks concurrent scanner/promotion delivery, suppression after withdrawal/start, future-versus-past catch-up, fixed-clock boundaries at 24 hours, one minute and the exact start, and a coordinated reminder/cancellation race with post-cancellation suppression. A fresh isolated Compose stack delivered an actual registration notification and all four services reported healthy. These tasks remain open pending the complete lock protocol and full crash/restart verification.

Live local demonstration (2026-11-06): a fresh isolated Compose deployment created and approved an event request, published it, registered a member, observed the worker-delivered registration notification through the v1 inbox, and marked it read. The web, API, worker and database services all reported healthy. The administrator role used for this demonstration was assigned only in the disposable local database.

- [ ] 6.1 Implement source-transaction outbox job writes and internal payload validation/snapshot recipients; prove rollback leaves no orphan job.
- [ ] 6.2 Implement due claims, lease tokens/reclaim, conditional completion, retry delays/max-attempt handling and failed-job operator visibility.
- [ ] 6.3 Implement deduplicated in-app delivery, historical-message policy and own-inbox/read endpoints; pass replay/ownership tests.
- [ ] 6.4 Implement event reminder scan and late-registration/promotion reminder path with shared visible dedup key; test deadline/start/cancel/downtime boundaries.
- [ ] 6.5 Implement worker heartbeat/shutdown and operator retry procedure; pass crash/fencing R7-R9 and verify one supported worker process in Compose.

## 7. Calendar/reporting backend

Progress (2026-11-06): the v1 API and organizer screen expose committee-scoped reports using current participation counts, recorded transitions, zero-filled campus days, clipped confirmed booking hours and a history cutoff. Disposable-MySQL coverage checks authorization, repeated joins, empty days, independent aggregates and a clipped interval. Calendar and shared-contract work remain open.

- [x] 7.1 Implement full-interval calendar reads, anonymous private busy blocks, pending exclusion and 31-day bounds; test cross-midnight legacy data. Evidence: `workflow.http.test.js` checks pending exclusion, anonymous confirmed drafts, publication, adjacent intervals, a cross-midnight booking, impossible dates and the 31-day boundary.
- [x] 7.2 Implement committee-only current counts, history daily actions/zero-fill/cutoff and clipped venue-hours aggregates; test no join multiplication/attendance claims. Evidence: `events.mysql.test.js` covers repeated actions, two current participants, empty days, cutoff, half-hour clipping and absence of attendance fields; `workflow.http.test.js` checks v1 committee access and rejects venue-admin-only access.
- [ ] 7.3 Freeze passing API fixtures/contract tests for frontend use; record provider schema version and tested commit.

## 8. Frontend integration

- [ ] 8.1 Implement shared API/auth/CSRF/error handling and login/register/profile flows; remove fake fallback profile/state.
- [ ] 8.2 Replace hardcoded club/venue/membership data and persist join/leave with meaningful409 guidance.
- [ ] 8.3 Implement event discovery/details/registration/waitlist/my-registration screens with authoritative states and preserved input on conflict.
- [ ] 8.4 Replace organizer placeholder with managed drafts, edit/publish/cancel and participant views; use expected versions.
- [ ] 8.5 Implement admin pending-review queue/rejection reasons/conflict behavior with no self-decision UX.
- [ ] 8.6 Implement weekly campus-time calendar and slot-to-request flow, including private blocks and keyboard alternative.
- [ ] 8.7 Implement inbox/unread polling and report charts/tables with history cutoff and honest metric labels.
- [ ] 8.8 Update every Alpha fetch in one coordinated v1 cutover; test401/403/404/409/410/422/429/503, mobile/keyboard/deep links and stale requests.

## 9. Release and handoff verification

- [ ] 9.1 Run full MySQL race/migration/restart suite in verification.md; collect final rows, commands and commit/image versions.
- [ ] 9.2 Implement production Compose/API/worker/frontend routing, secrets template, migration account/runtime privileges and schema-version startup gate.
- [ ] 9.3 Prove clean Linux deployment, persisted restart, TLS/session/proxy behavior, worker health, backup restore and documented rollback limitations.
- [ ] 9.4 Update README, API/ER/system diagrams, final coursework PDF and app credits to shipped scope; rehearse role-based demo and member explanations.
- [ ] 9.5 Review the implemented scope and release evidence with the team before merge; record outstanding limitations in the final handoff.
