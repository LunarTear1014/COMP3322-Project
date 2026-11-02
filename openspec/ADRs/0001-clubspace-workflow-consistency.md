# ADR 0001: ClubSpace workflow consistency and delivery

Status: DRAFT; requires proposal review. Date:2026-11-03. Change:expand-clubspace-workflows.

## Context

Venue approval and student admission must stay correct under concurrent requests. Membership is club-scoped, notifications must survive restarts, and another developer will implement the plan. Alpha currently bypasses these workflows and contains name-based/demo-user shortcuts.

## Decisions and alternatives

| Decision | Chosen approach and reason | Alternative considered |
| --- | --- | --- |
| Application boundaries | Modular monolith plus worker; clear transaction ownership with manageable deployment | Microservices add distributed consistency/deployment work without needed value |
| Concurrency | Existing venue/club sentinel rows, shared lock order, short READ COMMITTED transactions | Unlocked count/check fails races; locking only found conflicts misses initially empty sets; finer-grained locking requires more elaborate eligibility coordination |
| Approval/publication | Pending doesn't hold; explicit approve then publish | Pending holds invite stale reservations; automatic publish removes organizer review step |
| Queue | One current row and immutable transition history; FIFO timestamp/user tie-break | Storing mutable numeric positions causes many updates; current row alone loses trends |
| Notifications | MySQL durable outbox/jobs plus deduplicated in-app messages | API-only timers lose intent on restart; external queue/email increases infrastructure/scope |
| Accounts | DB sessions, CSRF and club-specific membership permissions | Demo identity is unsafe; global organizer role cannot distinguish clubs |
| Wire contract | Coordinated /api/v1 cutover | Silent name/enum changes on existing contracts confuse frontend and preserve insecure paths |
| Schema upgrades | Additive fields/backfills then constraints with snapshot recovery | Re-running destructive schema loses data; transaction-only DDL rollback is not reliable |
| Time | UTC persistence and explicit Hong Kong slot conversion | Server/browser-local interpretation produces inconsistent week/day boundaries |

## Consequences

Club writes serialize more than a highly scalable design would; keep transactions short and test throughput. API+frontend must deploy together; old callers receive410. Published schedule/eligibility changes require replacement event requests. The first release has no verified-university accounts, payments, attendance or email. Reminder execution is at least once but visible delivery deduplicates. History before cutover is explicitly incomplete. These are bounded design choices, not omissions for implementers to fill in without review.

## Review and verification

Acceptance depends on the proposal questions and real MySQL final-seat/approval/membership/worker races. OpenSpec validation checks document structure only. Do not mark this ADR accepted or archive the change until human review and verified implementation/merge.
