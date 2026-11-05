# Implementation checklist

Reference implementation plan: recipients may use their own development and tracking tools. No agent-coordination setup is required. Design-only: no checkbox below is completed. Follow dependencies in order. Each item requires implementation evidence, not merely a document update. Backend/database providers must publish passing contract tests before frontend integration. Personal ownership is agreed by the team, not assigned here.

## 1. Review and shared contract

- [ ] 1.1 Review proposed feature scope/non-goals and proposal questions with team/instructor; record approved defaults or revise specs/ADR before coding.
- [ ] 1.2 Confirm deployment schedule/VM resources/TLS, MySQL8.4 and legacy datetime timezone; record preflight inputs without secrets.
- [ ] 1.3 Agree API enums/DTOs/error codes and schema field mapping across backend/frontend/database; create contract fixtures from api.md.
- [ ] 1.4 Add runnable verification scripts and a disposable MySQL test database configuration; document commands and destructive-test isolation.

## 2. Database provider

- [ ] 2.1 Implement checksummed migration runner with database advisory lock and partial-DDL detection; test rerun/checksum/interruption failures.
- [ ] 2.2 Implement legacy integrity preflight for overlaps, relationships, capacities and normalized identities; verify it refuses bad fixtures.
- [ ] 2.3 Add workflow role/status/version/actor/deadline/participation fields and support tables with keys/collations from database.md.
- [ ] 2.4 Implement operator-confirmed one-time UTC backfill and legacy defaults without invented decisions/history; test already-UTC and Hong Kong-local datasets.
- [ ] 2.5 Add stronger constraints/indexes after preflight; EXPLAIN overlap, queue, job and report queries; compare preserved IDs/counts.
- [ ] 2.6 Repair fresh schema's invalid users.role index and define consistent fresh-install/upgrade migration baselines; verify both end with identical schema/version.
- [ ] 2.7 Add secure development account/privilege provisioning and password-hash generation; test placeholders cannot authenticate and no fixed production admin is seeded.

## 3. Backend foundation

- [ ] 3.1 Separate startup/app/router/controller/service/repository/query modules without changing runtime behavior prematurely; add characterization contract tests.
- [ ] 3.2 Implement transaction helper, UTC connection setup, global lock order, bounded retry and original-error preservation; test rollback/release/uncertain commit.
- [ ] 3.3 Implement JSON/query validation, request IDs, error envelopes,404/405/410 handling and bounded body parsing.
- [ ] 3.4 Implement server-side session adapter/config and CSRF/Origin middleware; verify cookies, token renewal, restart persistence and logout.
- [ ] 3.5 Implement password hashing/verification, normalized registration/login, dummy path, hash queue and throttling; benchmark target memory/latency.
- [ ] 3.6 Implement current-user profile/session/config endpoints and DB-backed identity/permission helpers; verify no DEMO_USER_ID bypass.
- [ ] 3.7 Implement persistent club membership endpoints with protected committee/active-registration leave rules; pass scoped access and membership race tests.

## 4. Booking/event backend

- [ ] 4.1 Implement slot/date validation and Hong Kong-to-UTC mapping; test impossible dates, future boundaries and fixed slots.
- [ ] 4.2 Implement atomic pending booking+draft creation with actor/audit/job writes; test injected mid-transaction failures.
- [ ] 4.3 Implement admin review queue/decision, no self-decision, versioning and confirmed overlap check; pass independent-connection R1.
- [ ] 4.4 Implement event visibility/list/detail/managed routes with bounded filters and private-draft protection; pass response contract tests.
- [ ] 4.5 Implement draft/published edit limits and independent publish transition; test stale versions and approval not publishing.
- [ ] 4.6 Implement idempotent atomic cancellation across booking/event/participation/history/jobs; test no promotion, after-start limits and R4.

## 5. Participation backend

- [ ] 5.1 Implement current participation/history repositories, registration eligibility and one-row idempotency; test cross-session persistence.
- [ ] 5.2 Implement capacity/waitlist limits and queue ordering under sentinel locks; pass final-seat R2.
- [ ] 5.3 Implement withdrawal and promoteLocked including ineligible legacy candidates and deadline rules; pass FIFO/new-arrival R3.
- [ ] 5.4 Implement my-registration and protected participant-list contracts; test privacy, pagination, computed queue positions and R5 membership race.
- [ ] 5.5 Verify cancellation/withdraw/rejoin actions append only actual transitions and preserve meaningful current-versus-history counts.

## 6. Background processing backend

- [ ] 6.1 Implement source-transaction outbox job writes and internal payload validation/snapshot recipients; prove rollback leaves no orphan job.
- [ ] 6.2 Implement due claims, lease tokens/reclaim, conditional completion, retry delays/max-attempt handling and failed-job operator visibility.
- [ ] 6.3 Implement deduplicated in-app delivery, historical-message policy and own-inbox/read endpoints; pass replay/ownership tests.
- [ ] 6.4 Implement event reminder scan and late-registration/promotion reminder path with shared visible dedup key; test deadline/start/cancel/downtime boundaries.
- [ ] 6.5 Implement worker heartbeat/shutdown and operator retry procedure; pass crash/fencing R7-R9 and verify one supported worker process in Compose.

## 7. Calendar/reporting backend

- [ ] 7.1 Implement full-interval calendar reads, anonymous private busy blocks, pending exclusion and31day bounds; test cross-midnight legacy data.
- [ ] 7.2 Implement committee-only current counts, history daily actions/zero-fill/cutoff and clipped venue-hours aggregates; test no join multiplication/attendance claims.
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
