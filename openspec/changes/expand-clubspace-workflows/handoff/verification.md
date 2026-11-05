# Verification and acceptance evidence

Documentation checks run while authoring do not constitute implementation tests. The implementer must record command, tested commit, database/image version, result and relevant screenshots/logs for every release gate.

## 1. Test layers

| Layer | Required evidence |
| --- | --- |
| Unit | Date/slot UTC conversion, impossible dates, validation, state transitions, hash verification, retry limits, reminder eligibility |
| HTTP contracts | Real Express app with controlled clock/database; statuses, envelopes, CSRF/cookies, ownership and every endpoint DTO |
| MySQL integration | MySQL8.4 schema/migration/query execution, real transactions/FKs/indexes, persisted sessions |
| Concurrency | At least two independent DB connections with coordinated barriers; verify final rows, not just HTTP messages |
| Worker | Lease expiry/reclaim, duplicate jobs, conditional completion fencing, retry/failure and restart catch-up |
| Frontend/E2E | Student/committee/admin journeys, mobile/keyboard, stale versions/errors, timezone |
| Deployment | Clean Linux/Compose install and upgrade with persisted volume, HTTPS cookie/proxy, deep links, worker heartbeat |

## 2. Mandatory backend cases

- Auth: registration can't assign privilege; duplicate email/student ID; generic invalid credentials; session regeneration; logout invalidation; restart-persistent session; CSRF/Origin on login and business mutations; no hash/token leaks; throttle and hash queue overflow.
- Authorization: committee A cannot edit club B; admin cannot decide own committee club; admin alone cannot list private participants/reports; another inbox item404; public join of members-only409; hidden draft404.
- Request states: creation yields pending+draft; approval leaves draft; rejection reason enforced; publish pending/rejected409; stale decisions409; past starts impossible to approve; edits freeze after publish; adjacent booking slots accepted.
- Cancellation: event+booking+all active participation changes atomic; no promotion; already cancelled has no duplicate history/job; cancelling rejected draft retains rejected booking state; after-start rejection.
- Registration: persistence across sessions; repeated request doesn't change queue; queue limit500; last seat cannot overbook; left rejoin at tail; withdrawal absent idempotent; deadline equality closed; waiting withdrawal leaves order correct; promotion ignores ineligible legacy candidate.
- Membership: leave blocked with members-only upcoming participation; public event doesn't block; committee leave protected; concurrent leave/register cannot both succeed in violating eligibility.
- Time: host/browser timezone differs, Hong Kong midnight/week boundary, legacy cross-midnight busy booking, invalid leap date, range max and half-open boundaries.
- Reports: preaggregations don't multiply counts; current counts differ from history actions; repeated joins count as actions; cancelled counts zero; hour clipping; date zero-fill/history cutoff; no attendance claim.

## 3. Race experiments (real MySQL required)

| ID | Coordinated experiment | Required invariant |
| --- | --- | --- |
| R1 | Two admins approve pending requests for same initially empty venue interval | One confirmed, other conflict/pending; no double-booking |
| R2 | Two students request final seat concurrently | One joined, other queued/full; joined<=capacity |
| R3 | Withdrawal and new registration race while earlier waiter exists | Earlier eligible waiter receives seat; new arrival cannot jump |
| R4 | Cancellation races with registration/withdrawal | Final cancelled event has no active participant; no post-cancel promotion |
| R5 | Member leaves club while registering for members-only event | Cannot commit nonmember with active eligible registration |
| R6 | Published edit/approval with same stale version | At most one transition using version; stale writer gets409 |
| R7 | Two workers claim/reclaim same job, first worker delayed past lease | Conditional acknowledgement/unique key prevents duplicate visible delivery |
| R8 | Crash after domain change but before job delivery, then restart | Intent survives, expected message eventually appears once |
| R9 | Deliver reminder while cancelling or withdrawing | Delivery serialized; later state refetch correct; no reminder generated after start |

Deadlock/timeout injection verifies whole-transaction retry, no duplicate history/jobs, resource release and bounded attempts. Uncertain commit test verifies no automatic replay of create POST.

## 4. Worker cases

Freeze clock at24h/1min/start and test recipient eligibility. Event scanner plus late join/promotion yields one reminder per event/user. Cancelling before reminder dispatch suppresses. After downtime future events catch up, already-started don't. Inject first through fifth failures and verify delay/status/last_error. Expired token cannot acknowledge another worker's job. SIGTERM drains within30s. Failed jobs and stale heartbeat visible to release operator.

## 5. Migration/deployment cases

Fresh schema must execute without nonexistent users.role index. Upgrade a populated Alpha copy preserving IDs/counts/memberships/statuses. Test operator-approved Hong Kong-local and already-UTC backfills; rerun must not double-shift. Reject conflicting normalized identities, orphaned/mismatched intervals/overlaps and oversized legacy capacity. Test interruption after each DDL step, checksum mismatch, migration lock contention, version gating and snapshot restore. No fake participation history backfill.

Run clean dependency install, backend tests, frontend build/lint, migration verification, Compose startup and browser journeys in production-like environment. Exact scripts are implementation tasks; do not claim nonexistent commands have passed. Fresh VM must serve direct SPA routes and /api distinctly; app restart preserves DB sessions/registrations/jobs. Worker/DB unavailable tests must not produce false-success business results.

## 6. Demo and review evidence

Demo with separate student, committee and administrator accounts: submit overlapping requests -> approve one -> publish -> fill capacity -> queue student -> withdraw/promote -> notification -> calendar and report. Show persisted state after reload and explain a race test. Every member should explain their own code and shared contracts. Cite any external components/snippets on app credits per guideline. Final coursework PDF/API/ER/system diagrams must describe actually shipped scope, not this unapproved draft.
