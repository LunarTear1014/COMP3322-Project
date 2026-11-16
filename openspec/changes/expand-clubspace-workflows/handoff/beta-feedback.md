# Beta feedback addendum (2026-11-16)

The beta interviews asked for five things. This addendum gives the exact contracts for the backend parts. Where it conflicts with another handoff file, this file wins; the conflicting lines in those files point here.

| # | Feedback | Where it lands |
| --- | --- | --- |
| 1 | Aesthetic update | `refresh-clubspace-visual-design` (frontend) |
| 2 | Instant notifications; every club action notifies | specs `notifications-reminders` · sections 3–4 below |
| 3 | President vs committee | spec `club-governance` · sections 1–2 |
| 4 | Event filters and tags | spec `event-tags` · the v1 filters already exist; tags in sections 1–2 |
| 5 | Event effectiveness report | spec `event-effectiveness` · sections 1, 2 and 5 |

Decisions confirmed by the product owner: the president alone manages roles and cancels published events, and signs off committee venue requests and publications. Tags are a shared campus list plus each club's own tags. Committee members get joins and leaves as a daily digest. Turnout uses check-in. Promotion effect covers announcement impact, waitlist promotions, and comparison by tag and timing.

## 1. Database (additive migrations after the workflow series)

| Migration | Change |
| --- | --- |
| `010_club_president` | `memberships.role` ENUM('member','committee','president'); add `version INT UNSIGNED NOT NULL DEFAULT 1`. Add the generated column `president_club_id INT AS (IF(role='president', club_id, NULL)) STORED` with `UNIQUE(president_club_id)`, which enforces one president per club. The operator sets each club's first president; never infer one. |
| `011_signoff_states` | `bookings.status` adds `awaiting_president` and `returned`; `events.status` adds `awaiting_president`. Add `signoff_requested_by INT NULL`, `signoff_decided_by INT NULL`, `signoff_decided_at DATETIME(6) NULL` and `signoff_reason VARCHAR(500) NULL` to both tables. `awaiting_president` and `returned` bookings never count as busy. |
| `012_tags` | `campus_tags(id, slug VARCHAR(32) UNIQUE, name VARCHAR(40), retired_at NULL)`; `club_tags(id, club_id FK, name VARCHAR(24), name_key VARCHAR(24) AS (LOWER(name)) STORED, UNIQUE(club_id, name_key))`; `event_campus_tags(event_id, campus_tag_id, PK both)`; `event_club_tags(event_id, club_tag_id, PK both)`. Seed the campus tags Academic, Arts, Career, Culture, Free food, Music, Social, Sports, Tech, Volunteering. Backfill existing events with Social. |
| `013_attendance_views` | `events`: `checkin_code CHAR(4) NULL`, `checkin_opened_at DATETIME(6) NULL`. `event_attendance(event_id, user_id, method ENUM('code','marked'), checked_in_at, marked_by NULL, PK(event_id,user_id))`. `event_views(id, event_id, user_id, source ENUM('explore','club','inbox','my_events','share','other'), viewed_at, bucket DATETIME(6), UNIQUE(event_id,user_id,bucket))`, where `bucket` = `viewed_at` floored to 30 minutes. Add `INDEX(event_id, viewed_at)`. |
| `016_join_requests` | `event_join_requests(event_id, user_id PK, status ENUM('pending','accepted','rejected','withdrawn','cancelled'), allow_waitlist, requested_at DATETIME(6), reviewed_by, reviewed_at, reason VARCHAR(500))`. Creates `club_join_requests` and `notifications.club_join_request_id` only where the legacy SQL 002 never ran. |
| `014_notifications_live` | Extend `notifications.type` with the new types in section 3. Add `club_id INT NULL`. `activity_digests(club_id, campus_date, PRIMARY KEY(club_id, campus_date))` records digests already sent. |

Purge `event_views` older than 180 days in the worker's daily maintenance. `participation_history` already supplies joined-at-start, drop-outs and promotions; don't add counters.

## 2. API additions (base `/api/v1`)

| Method/path | Auth | Request | Success |
| --- | --- | --- | --- |
| PATCH /clubs/:id/members/:user_id | president | `{role:'member'|'committee', expected_version}` | 200 Membership |
| POST /clubs/:id/presidency | president | `{to_user_id, expected_version}` (target must be committee) | 200 `{previous:Membership, current:Membership}` |
| GET /clubs/:id/members | committee | `role?, page, page_size` | 200 Membership[] with user `{id,name}` |
| POST /bookings/:id/signoff | president | `{decision:'send'|'return', reason?, expected_version}`; a reason is required to return | 200 Booking |
| POST /events/:id/signoff | president | `{decision:'publish'|'return', reason?, expected_version}` | 200 Event |
| POST /events/:id/publish | committee | unchanged body. From the president it publishes; from other committee it returns 200 Event in `awaiting_president` | 200 Event |
| POST /events/:id/cancel | president/admin | unchanged; a committee member on a published event gets 403 | 200 Event |
| GET /me/signoffs | president | `page, page_size` | 200 `{bookings:Booking[], events:Event[]}` awaiting this president |
| GET /tags | user | none | 200 `CampusTag[] {id,slug,name}` |
| POST /tags · PATCH /tags/:id | admin | `{slug,name}` · `{name?, retired?}` | 201/200 CampusTag |
| GET /clubs/:id/tags · POST · DELETE /clubs/:id/tags/:tag_id | user · committee · committee | `{name}` | 200/201/204 |
| GET /events | user | adds repeatable `tag=<slug>` (OR across tags; AND with other filters, max 5) | unchanged |
| POST/PATCH /events | committee | adds `campus_tag_ids[1..3]` and `club_tag_ids[0..5]`; tags are editable after publication | unchanged |
| GET /notifications/stream | user | header `Last-Event-ID?` | `text/event-stream` (section 4) |
| POST /events/:id/checkin | committee | `{}`: opens check-in, idempotent within the window | 200 `{code, opens_at, closes_at}` |
| POST /events/:id/attendance | user | `{code}` | 201 created or 200 existing Attendance |
| PUT/DELETE /events/:id/attendance/:user_id | committee | `{}` | 200 Attendance / 204 |
| GET /events/:id/attendance | committee | `page, page_size` | 200 `{joined_at_open, attended, records:Attendance[]}` |
| POST /events/:id/views | user | `{source}` | 204 (deduplicated silently) |
| GET /clubs/:id/reports/effectiveness | committee | `from, to` (max 93 days) | 200 EffectivenessReport |

DTO changes: Membership gains `role:'member'|'committee'|'president'` and `version`. Event and EventSummary gain `campus_tags:CampusTag[]`, `club_tags:{id,name}[]` and `signoff:{requested_by,reason}|null`. Booking `status` adds `awaiting_president` and `returned`. New error codes: 409 `PRESIDENT_TRANSFER_REQUIRED`; 429 on check-in code attempts (5 per user and event per 10 minutes). The check-in code comes from `crypto.randomInt` and is only returned to committee.

EffectivenessReport: `{club_id, from, to, events:[{event_id, title, start_at, capacity, joined_at_start, fill_rate, peak_waitlist, ever_joined, dropped_out, dropout_rate, checkin_recorded:boolean, attended|null, turnout|null, no_shows|null, promotions, median_promotion_wait_hours|null, promoted_attended|null, views, unique_viewers, views_by_source:{explore,club,inbox,my_events,share,other}, view_to_join|null, joins_24h_after_publish}], by_tag:[{slug,name,events,avg_fill_rate,avg_turnout|null,too_few:boolean}], by_weekday:[…], by_slot:[…]}`.

- `joined_at_start` = participants whose latest history action before `start_at` is a join or promotion.
- `view_to_join` = distinct viewers who joined after viewing ÷ `unique_viewers`.
- Rates are 0–1 with 3 decimal places. A group with fewer than 3 events has `too_few: true`.

## 3. Notification matrix

The actor is never a recipient, except where noted. D = immediate (written in the source transaction); J = worker job.

| Action | Type | Recipients | How |
| --- | --- | --- | --- |
| Committee submits a venue request | `signoff_requested` | president | D |
| President sends on / returns a request | `signoff_decided` | requester | D |
| Request reaches the admin queue | `booking_requested` | venue admins | D |
| Admin approves / rejects | `booking_decided` | club committee + president | D |
| Committee asks to publish | `signoff_requested` | president | D |
| President publishes / returns | `signoff_decided` | requester | D |
| Event published | `event_published` | all club members (fan-out max 1500) | D |
| Event details edited (title/description/tags excluded) | `event_changed` | joined + waitlisted | D |
| Event cancelled | `event_cancelled` | joined + waitlisted + committee + president | D |
| Join / waitlist / promotion / leave (own) | `registration_changed` | that student (confirmation of own action included) | D |
| Promotion caused by another's withdrawal | `registration_changed` | promoted student | D |
| Role changed / presidency transferred | `role_changed` | affected user(s) + rest of committee | D |
| Club tags changed | `club_updated` | committee + president | D |
| Student asks to join a club | `club_join_request` (with `join_request_id`) | committee + president | D |
| Club join request accepted / rejected | `club_membership` | requester; other reviewers' request items are removed | D |
| Member asks to join a members-only event | `event_join_request` | committee + president | D |
| Event join request sent / accepted / rejected | `registration_changed` | requester | D |
| Joins, leaves, new and departed members | `activity_digest` | committee + president, 09:00 HKT, only if activity | J |
| Check-in opened | `checkin_opened` | joined students | D |
| 24h reminder | `event_reminder` | joined students | J |

Deduplication keys stay `type:<entity>:<action_id>:<user_id>`; for digests, `digest:<club_id>:<campus_date>`.

## 4. Live delivery

- **Writes.** Immediate notifications are inserted in the source transaction (replacing the outbox job for those types). The worker keeps reminders, digests, maintenance and the retry/lease rules for those jobs.
- **Stream.** `NotificationStreamHub` in the API process tails `notifications` every 1 s with `WHERE id > :last_seen_max ORDER BY id LIMIT 500`. It pushes each row to the connected SSE clients for `user_id`, as `id: <notification id>` with `event: notification` and data `{notification, unread_count}`. Because it reads the shared table, rows written by the worker or by another API process are delivered the same way.
- **Connections.** The stream is authenticated by session cookie, and needs no CSRF because it's a GET. Allow at most 3 connections per user and send a heartbeat `: ping` every 25 s. On connect with `Last-Event-ID`, replay the user's rows with a greater id (max 200, then tell the client to refetch). Use `X-Accel-Buffering: no` and disable compression on this route.
- **Proxy.** Raise the proxy read timeout to at least 60 s for `/api/v1/notifications/stream`.

## 5. Backend services

- **Governance.** `GovernanceService` owns role changes, presidency transfer (lock order: club, then both membership rows by ascending user_id) and both sign-offs. Sign-off reuses the booking/event locks and version rules from D3/D4. Sending a request on rechecks the slot is still in the future, but not venue conflicts; those remain the admin's check.
- **Tags.** `TagService` validates tag ownership and limits; the tag-filter query uses `EXISTS` on `event_campus_tags`.
- **Check-in.** `AttendanceService` enforces the window from `start_at - 30 min` to `end_at + 2 h`, joined-only check-in, the rate limit and idempotent inserts. `checkin_code` is cleared after the window.
- **Report.** `EffectivenessReportService` computes from `participation_history`, `event_attendance` and `event_views` with named SQL in `queries/reports/effectiveness/*.sql`, and checks the result against hand-built fixtures (join, leave and rejoin; promoted no-show; an event with no check-in; and a group of fewer than 3).
