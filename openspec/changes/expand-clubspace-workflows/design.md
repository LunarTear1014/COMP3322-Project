## Context

Active application: `frontend-alpha/` React/Vite, `backend-alpha/` Express/mysql2, and `src/db/` MySQL. Alpha currently implements event browse/create, availability, profile read/update and health. Account identity, membership, registration and organizer controls need completion. The routing/SQL refactor was reverted; only a future refactor is specified here.

The supplied course guideline identifies database design, asynchronous processing, visualization, aesthetics and meaningful business logic as complexity examples (p.2), and production stability, best practices, UI/UX and documentation as assessment dimensions (p.5). Its stated Beta dates include November 6 and presentation dates November 20/23/27; confirm current Moodle scheduling. No fixed hours or grade guarantee is implied.

## Goals / Non-Goals

**Goals:** define implementable account/approval/waitlist/notification/calendar/report workflows, safe schema upgrades and explicit backend/frontend contracts. Give another developer enough detail to implement without guessing race conditions or state transitions.

**Non-Goals:** all exclusions in proposal.md. This package does not implement anything or authorize deployment.

## Decisions

### D1. One modular API and one worker

Use Node.js 22, Express, mysql2 and MySQL 8.4/InnoDB. Separate routers -> controllers -> services -> repositories -> SQL constants. Services own transactions; repositories accept the same passed connection and never begin nested transactions. A separate worker uses the same codebase and database. No Redis or microservices are needed for this deployment.

### D2. Explicit role scopes

`users.platform_role` is `student|venue_admin`; committee privileges remain in memberships, scoped to one club. A venue administrator reviews all venues, but cannot decide requests for a club where they are committee. Current database records authorize each mutation; sessions contain identity, not authority. Public registration cannot appoint privileged users. Appointment occurs through an operator-only provisioning procedure.

### D3. Separate request state and event state

Booking: pending -> confirmed/rejected/cancelled; confirmed -> cancelled. Rejected/cancelled are terminal. Event: draft -> published/cancelled; published -> cancelled. Approval leaves the event draft. Pending requests do not hold venues. Publication requires confirmed venue, future start and open registration deadline. Rejected requests retain private drafts; rescheduling creates a new request. Freeze venue/time/capacity/visibility/deadline after publication; permit title/description edits.

### D4. Lock existing parent rows

Lock order is **venue -> club -> booking -> event -> participations**, ascending ID within each type. All booking changes first lock their venue. Membership and event/participation mutations lock their club. Skip unneeded earlier lock types, but never acquire them later. Revalidate immutable locator relationships after acquiring locks. Club serialization intentionally favors clear correctness at course-scale over maximal throughput, including when no conflicting row exists yet.

### D5. Durable in-app notification intent

Business transactions append history/audit and a job/outbox row. The worker delivers in-app messages with recipient/deduplication uniqueness and retryable leases. No external network calls occur inside business transactions. Reminders are generated before the start, catch up after downtime and suppress cancelled/ineligible recipients. At-least-once processing with idempotent visible delivery is sufficient.

### D6. UTC and versioned wire formats

Persist DATETIME(6) as UTC; set every DB session to `+00:00`. API instants use ISO UTC `Z`; display and fixed slots use `Asia/Hong_Kong`. Request date/slot are campus-local and server-resolved. Ranges are `[from,to)`. `/api/v1` uses numeric IDs and common envelopes. Replace every frontend request atomically; legacy business endpoints return 410. Keep `/api/health`.

### D7. MySQL sessions and CSRF

Use express-session with express-mysql-session, migration-managed sessions table, host-only HttpOnly SameSite=Lax cookie, Secure in production, rolling eight-hour idle expiry, regenerate on login and destroy on logout. Every mutation requires exact APP_ORIGIN and a session-bound CSRF header, including login/register. Use asynchronous Node scrypt with versioned parameters, throttling and bounded hashing concurrency. See backend handoff for exact parameters and adapter behavior.

### D8. Honest reporting

Report current joined/waitlisted counts, historical registration actions by Hong Kong day and confirmed booked hours clipped to the requested window. Registration history is required because a current-state row alone cannot recover trends after leave/rejoin. Do not present attendance or no-show rates: no attendance collection is included.

## Risks / Trade-offs

- Large scope -> review commitments before implementation; document any approved reduction.
- Club-level locks -> short transactions, query indexes, race/load tests; future optimization needs a new locking design.
- Ambiguous Alpha timezones -> operator-confirmed backfill, never server-locale guessing.
- No recovery/email verification -> local project accounts only; no assertion of verified university identity.
- Worker downtime -> durable queue, retry/dead-letter visibility, future-event catch-up.
- MySQL DDL implicit commits -> per-step migrations/checksums and tested snapshot restore, not a transactional rollback promise.
- Legacy API breakage -> coordinated frontend/backend deployment and cache invalidation.

## Migration Plan

Run preflight, additive schema, approved UTC backfills, consistency checks, then constraints and maintenance-window release. Preserve IDs, foreign keys, existing confirmed bookings and published events. Backfill actor IDs as NULL/legacy, never invent decision actors. Existing placeholder passwords require explicit credential provisioning. Take a tested backup; prefer forward fixes after new writes. See database.md for exact field/index operations and rollback limits.

## Open Questions

Review the proposal's product decisions. Deployment gates: actual MySQL version, existing datetime timezone, Linux VM memory/TLS/ports and current instructor deployment instructions.

## References

Primary references checked while preparing this proposal:

- [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [MySQL implicit commits](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)
- [Express sessions](https://expressjs.com/en/resources/middleware/session/)
- [MySQL session adapter](https://github.com/chill117/express-mysql-session)
- [Node crypto](https://nodejs.org/api/crypto.html)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

References support mechanisms; workflow policies and numeric limits are project design choices.
