# Backend implementation contract

Proposed behavior, not implemented code. Read API and database handoffs together with this document.

## 1. Module/service map

| Planned path | Responsibility |
| --- | --- |
| `backend-alpha/index.js` | Config, startup/shutdown |
| `backend-alpha/app.js` | Injectable factory, middleware and router composition |
| `routes/{auth,clubs,events,bookings,venues,notifications,reports}.js` | Method/path mapping only |
| `controllers/*.js` | DTO validation and HTTP serialization |
| `services/*.js` | Authorization, workflows and transaction ownership |
| `repositories/*.js` | Parameterized operations accepting pool/transaction connection |
| `queries/*.js` | SQL constants, grouped by resource, no HTTP dependencies |
| `middleware/*.js` | Auth, CSRF, request ID, validation and error handling |
| `jobs/*.js`, `worker.js` | Durable claims, delivery, reminders and shutdown |
| `src/db/migrations/` | Ordered migration scripts/checksums |

Services: AuthService, MembershipService, BookingService, EventService, ParticipationService, NotificationService, CalendarService, ReportService, NotificationWorker. Preserve snake_case style. Services start transactions; repositories never nest transactions or switch a supplied connection back to pool. Imports must not start HTTP or open live DB connections. Inject clock, pool, hasher and session store for tests.

## 2. Transport/session security

Middleware order: request ID -> bounded JSON parser (64KiB) -> session -> Origin/CSRF on mutations -> identity -> DTO validation -> controller/service -> error handler. Mutations use application/json, including `{}` on DELETE/empty actions. Reject unknown fields, array/repeated scalar queries, unsafe/nonpositive integer IDs and unsupported enums. Return400 malformed JSON,413 oversized,415 wrong media type,422 invalid DTO; unexpected500 is sanitized with request ID.

CSRF: GET `/auth/csrf` creates anonymous session/token. Every browser mutation including login/register requires exact APP_ORIGIN and session-matching X-CSRF-Token. Login regenerates session ID/token and saves before success. Logout destroys row/cookie. Stale-token clients refresh state, never automatically replay uncertain mutations.

Use express-session + express-mysql-session, migration-created sessions table and createDatabaseTable:false. Cookie clubspace.sid, path /, host-only, HttpOnly, SameSite=Lax, Secure in HTTPS production; rolling8h idle expiry, cleanup15min. Trust only deployed reverse proxy. Session stores identity/CSRF, not privileges. Every request loads current database roles. DEMO_USER_ID must disappear from production logic.

Passwords: 12-128 Unicode characters, no trimming; async Node scrypt N131072/r8/p1/maxmem256MiB, random16-byte salt,64-byte result, encoded version/parameters. Timing-safe comparison; dummy hash for unknown email; legacy placeholders fail normally. Hash concurrency2/process, queue10, overflow503 AUTH_BUSY. Benchmark VM memory. Throttle login/register:10 attempts per email+IP/15min,100/IP/15min;429 Retry-After. Only one API replica is promised. No email verification/reset/OAuth.

## 3. Shared transaction/lock protocol

Acquire connection -> next transaction READ COMMITTED -> begin -> lock existing parents -> revalidate state -> writes+history/audit/jobs -> commit -> response -> release. Rollback/release on failure; preserve original error if rollback fails. No network calls inside transactions.

Global order: **venue -> club -> booking -> event -> participation**, ascending IDs within a type. Booking create/decision/edit/publish/cancel lock venue then club and existing children. Membership and participation lock club then event. Worker delivery locks club then event. Skip unneeded earlier types but never acquire them later. Locate immutable relationships before locking, then reread/verify. All writers honor club sentinel locking, including membership changes and jobs. This handles empty conflict/participation sets without relying on gap locks; coarse club write serialization is a deliberate course-scale trade-off.

1213 deadlock/1205 timeout: rollback/release then retry entire transaction twice maximum with25-100ms then100-250ms jitter. Re-evaluate versions/permissions each time. Exhaustion503 TRANSACTION_RETRY_EXHAUSTED. Never automatically retry uncertain commit/connection loss; client refetches before another write. Sessions use a separate adapter connection outside domain locks.

## 4. Identity/membership rules

Public register accepts name1-100 code points, student_id1-50 `[A-Za-z0-9-]+`, normalized trimmed/lowercase email<=254 and password. Unique email/student_id, role student only, no auto-login. Login generic401 for unknown/wrong credentials, returns user/current memberships/new CSRF token. Privileged appointment/account deletion have no public endpoints.

Membership PUT creates member idempotently, never downgrades committee. DELETE absent is idempotent. Committee leave409 COMMITTEE_MEMBERSHIP_PROTECTED. Ordinary member leave409 ACTIVE_MEMBER_REGISTRATIONS while holding future published members-only joined/waitlisted registration in that club; withdraw first. Public registrations do not block leaving. Club sentinel serializes leave versus registration.

Published metadata, including members-only events, is discoverable by authenticated users; membership gates registration. Drafts only committee of that club and venue admins. Cancelled metadata is also available to historical participants; unrelated users receive404. Participant identities only committee. Global venue_admin does not imply committee/report privileges. Self-approval/rejection forbidden when admin is committee of requesting club.

## 5. Create request and event

Server resolves campus date+slot to UTC. Validate real/future date, active venue, capacity1..min(venue capacity,500), deadline future and <=start (default start). Input uses IDs, never club/venue names.

Lock venue->club; verify committee; read confirmed overlaps (`existing.start < end AND existing.end > start`). Conflict409 VENUE_UNAVAILABLE; pending overlaps allowed. Insert pending booking(version1/requester) and draft event(version1/matching club+interval); append booking.requested audit and booking_requested job with eligible admin IDs (exclude committee of requesting club); commit201. No reservation/publication yet.

No creation idempotency key: React disables duplicate submit; uncertain responses require refetch managed events before retry. Duplicate pending requests are possible; conflicting confirmed bookings must never be possible.

## 6. Review request

Approve/reject requires expected booking version; reject reason1-500 trimmed chars. Lock venue->club->booking->event. Check current admin role/no self-decision. Stale version409 STALE_VERSION; require pending+draft+future start+active venue, otherwise409 INVALID_STATE. Approval repeats overlap check under venue lock; conflict leaves request pending. Set confirmed/rejected, decided_by/at/reason, increment booking version, append audit and decision job for current committee. Event remains draft. Expired is derived for pending past starts, no extra status. Rejected/cancelled requests are terminal, no resubmit.

## 7. Edit/publish/cancel

Edit/publish lock venue->club->booking->event, require committee and expected event version. Draft with pending/confirmed booking allows title/description/capacity/visibility/deadline. Published allows title/description only; other editable draft fields409 PUBLISHED_FIELDS_FROZEN. Rejected/cancelled draft requests409 INVALID_STATE. Club/venue/time cannot change. Empty patch422. Increment metadata version; append audit; published edits snapshot joined/waitlisted audience in event_changed job.

Publish requires draft+confirmed+active venue+future start/deadline and valid capacity. Set published/version+1/audit; no campus-wide broadcast. Repeated old publish409 stale/state conflict.

Cancel allowed before start for relevant committee or global venue admin. Already cancelled returns200 unchanged even with old expected_version. First cancellation requires current version. Event->cancelled/version+1; pending/confirmed booking->cancelled/version+1; rejected/already cancelled booking unchanged. Joined/waitlisted rows->cancelled, each with history. Capture affected recipients before changes; insert cancellation job/audit; commit atomically and release slot. Never promote on cancellation. After start409 EVENT_STARTED unless already cancelled. No hard delete.

## 8. Register/withdraw/promote

Register locks club->event. Require published+confirmed, now<deadline/start, current membership for members_only. Existing joined/waitlisted returns200 unchanged (same queue order, no new effects). Left may rejoin as new lifecycle. One participation/user/event, not one per click.

Under locks, count joined and first promote any earlier eligible waiters into vacancies. Then admit new student if free; otherwise allow_waitlist=true produces waitlisted if waiting<500; else409 EVENT_FULL/WAITLIST_FULL. Record last_registered_at, queued_at/confirmed_at, clear left_at; append history/action UUID and registration_changed job. Registration does not alter event metadata version. Return authoritative counts/own state/queue position.

Withdraw locks club->event. Before start active->left/history/job. Absent/left returns200 left without effects; cancelled event returns200 cancelled without promotion; active after start409 EVENT_STARTED. Joined withdrawal before deadline promotes; after deadline leaves vacancy. Waitlisted withdrawal only removes that queue entry.

promoteLocked assumes club/event held, published+confirmed and open registration. Query waiting ordered queued_at ASC,user_id ASC. Revalidate membership; ineligible becomes left/history reason membership_ineligible, continue. Earliest eligible->joined/confirmed_at/history/job until capacity. Normal membership leave prevents ineligibility; defensive behavior covers migration/operator repairs. New arrivals cannot jump the queue. Compute queue position, never store/rewrite numeric positions. Overlapping personal event registrations are allowed.

## 9. Jobs/notifications/reminders

Types: booking_requested, booking_decided, registration_changed, event_changed, event_cancelled, event_reminder. Source transaction inserts unique action key and JSON entity IDs/recipient snapshot; no request dumps/secrets. Event change/cancel captures joined+waitlisted IDs at action time; decision captures current committee. Fan-out max1500 IDs; event joined max500+waiting max500; admin/committee provisioning max500 each.

Poll5s, default single-job concurrency; claim only available execution slots (at most10 if explicitly configured), using due jobs using FOR UPDATE SKIP LOCKED; set processing, attempts+1, UUID token,120s lease, commit claim before domain locks. Reclaim expired leases only while attempts<5; an expired fifth-attempt lease becomes failed with lease_expired_last_attempt, never attempts6. Delivery transaction locks club/event, inserts UNIQUE(user_id,dedup_key) messages, conditionally completes matching-token job. Zero matched completion ->rollback delivery. Duplicate insert is successful replay. Never hold claim-job locks while acquiring club locks; target transactions<10s. At-least-once execution with idempotent visible results, not exactly-once execution.

Failure delays5/30/120/600s; fifth failure->failed with sanitized last_error<=1000. SIGTERM stops intake, finishes/rolls back within30s, stale lease recovers after crash. Operator-only failed-job retry, no public processing endpoints. Event_changed suppresses if cancelled. Decision/cancellation/registration messages describe historical actions; click-through always refetches current state.

Reminder scanner60s: select published confirmed starts in(now,now+24h]; lock club/event and ensure one event-level reminder job. Delivery selects current joined only and rechecks future/status. Late join/promotion within24h emits recipient-specific reminder job. Both share visible key reminder:<event_id>:<user_id>. Suppress cancelled/started/no-longer-joined. Downtime catch-up only before start. Leave/rejoin does not produce another reminder for same event/user.

Inbox own rows only; mark-read WHERE notification.id+actor.id, mismatch404, repeated mark preserves first read_at. No arbitrary send endpoint.

## 10. Calendar/reports/query inventory

Calendar reads complete UTC intervals overlapping range; never combines requested date with TIME_FORMAT. Confirmed private-draft booking exposes venue/time/busy with null title/event/club. Published metadata visible to signed-in users; pending never blocks availability. Review/managed endpoints show authorized pending detail separately.

Committee-only club report: published/cancelled events starting in range, current joined/waitlisted counts, daily historical actions for those events, confirmed club-booked hours clipped to range. Day buckets Asia/Hong_Kong(+08), independent of installed named-timezone tables. Action counts include repeat registrations, distinct from unique students/current counts. No attendance. Preaggregate sources before joins to avoid count multiplication.

Required named queries: auth/profile; lockVenue/Club/Booking/Event; membership/blockingRegistration; confirmedOverlaps; create/decide/publish/edit/cancel; activeCounts/ownRegistration/orderedWaitlist/queuePosition; history/audit/job inserts; claim/reclaim/complete/fail; notification list/read; calendar; currentCounts/dailyActions/venueHours reports. Values use placeholders; identifier/sort fragments use allowlists. EXPLAIN overlap/queue/job/report queries before release.

## 11. Runtime and operational contract

Required DB config, SESSION_SECRET>=32 random bytes, APP_ORIGIN, NODE_ENV/PORT. Missing production secret/origin/DB config fails startup. DB sessions UTC; campus display Hong Kong. Pin tested Node22/MySQL8.4 releases at implementation. Do not read/copy/commit local .env into the worktree.

Log request IDs, route template, status, duration, transaction retries/job outcomes, never passwords/cookies/tokens/PII payloads. DB health failure503 sanitized; no false-success empty business data. Worker heartbeat at least60s; release requires last_seen<2min and no unresolved failed jobs. Graceful HTTP shutdown drains then closes pool/session store. Both processes require matching schema version.
