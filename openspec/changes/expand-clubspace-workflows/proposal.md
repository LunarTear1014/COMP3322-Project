# Expand ClubSpace event and venue workflows

Status: **DRAFT FOR REVIEW**. Prepared 2026-11-03 (Asia/Taipei). Baseline `aa4fb7d`.
This proposal is not approval to implement or change the instructor-agreed scope.

## Why

Alpha connects event creation, venue browsing and a demo profile to MySQL, but memberships/registration remain React state and booking has no approval lifecycle. The review requested sufficient system depth; connected approval, fair queueing, reliable notifications and useful visual reporting supply demonstrable business rules and asynchronous processing.

## What Changes

- Complete baseline commitments: session accounts, persistent memberships/registrations, club-specific permissions, participant management and event editing/cancellation.
- Add a venue administrator, request review with reasons, optimistic versions, and publication after approval. Pending requests do not hold a venue.
- Promote event capacity and FIFO waitlists to proposed core; serialize competing registrations and automatically promote eligible waiting students on withdrawal.
- Persist notification intent in business transactions; process in-app notifications and reminders in a restart-safe worker with retry/deduplication.
- Add a weekly venue calendar and organizer reporting based on registrations and booked hours.
- Plan resource routers, controllers, services, repositories and a dedicated SQL query folder. The previously reverted refactor is **not reinstated by this documentation change**.
- **BREAKING:** use ID-based `/api/v1` contracts and structured envelopes; replace Alpha name-based payloads and demo-user identity. Update React in the same release. Keep `/api/health`; old business endpoints return 410 after cutover.
- **BREAKING:** event creation produces a pending booking and draft event, not immediate reservation/publication.
- Plan data-preserving migrations, production sessions/worker, audit/history and real MySQL verification.
- **Beta feedback (2026-11-16):** add a club president who manages roles, signs off committee venue requests and publications, and alone cancels published events. Deliver notifications live over server-sent events, and notify every club-related action (joins and leaves as a daily committee digest). Add campus and club event tags with a tag filter. Add attendance check-in, event view tracking and an event effectiveness report. Details: `handoff/beta-feedback.md`.

## Capabilities

### New Capabilities

- `identity-membership`: real sessions, profiles, memberships and scoped authorization.
- `booking-approval`: atomic event/request creation, review, editing, publication and cancellation.
- `event-participation`: eligibility, persistent registration, capacity, queue ordering and promotion.
- `notifications-reminders`: durable jobs, in-app delivery, retries and reminders.
- `calendar-reporting`: privacy-aware scheduling and organizer aggregate reports.
- `api-frontend-contract`: versioned REST, validation/errors and React integration.
- `club-governance`: president role, role management, sign-off and president-only cancellation.
- `event-tags`: campus tag list, club tags, event tagging and tag filters.
- `event-effectiveness`: attendance check-in, view tracking and the effectiveness report.
- `schema-deployment`: upgrade/backfill safety, production processes and release gates.

### Modified Capabilities

None. No existing OpenSpec capability specifications are initialized in the baseline. New specifications describe both completion of baseline commitments and expanded behavior.

## Impact

| Area | Planned impact |
| --- | --- |
| Backend | Layered modules, accounts, transactions, workflow services, worker and consistent errors |
| Database | Extend users/bookings/events/participations; add sessions, history, jobs, notifications and audit tables |
| Frontend | Account screens, persistent actions, organizer/admin workflows, calendar, inbox and reports |
| Operations | Linux Compose with API/worker/MySQL, UTC, secure sessions, migrations and backup/restore |
| Handoff | Backend algorithms, exact API contracts, schema changes, UI mapping, acceptance tests and ordered tasks |

## Non-goals

Payment/proofs, OAuth, equipment, recurring events, QR or location-based attendance (check-in uses a 4-digit code or committee marking), reviews, email, WebSockets (live delivery uses server-sent events) and self-service admin appointments. Event cover images are specified in `refresh-clubspace-visual-design`. Keep the existing three fixed campus timeslots. These are separate future proposals.

## Decisions requiring review

1. Pending requests do not reserve; approval rechecks conflicts.
2. A global venue-admin reviews requests but cannot decide a club's request when they are committee of that club.
3. Approval and publication are separate; published venue/time/capacity/visibility/deadline are frozen.
4. Rescheduling/retrying a rejected request creates a new request; no series or resubmission workflow.
5. Accept the `/api/v1` breaking cutover and the expanded course scope.
6. Beta feedback, confirmed 2026-11-16: the president role and sign-off, the live notification matrix with a daily digest, the shared campus tags plus club tags, and check-in-based turnout. President sign-off applies to every venue request and every publication by a committee member who is not president (confirmed 2026-11-16).

Defaults are fully specified below; implementers must not invent alternatives without a reviewed spec change. This is a proposed scope inferred from the latest discussion, not a claim that every feature was individually approved.
