# ClubSpace backend API

## Connection and conventions

The development API defaults to `http://localhost:3000`. Business routes use `/api/v1` and return `{data}` with optional pagination `meta`; errors use `{error:{code,message,fields,request_id}}`. A successful `204` has no response body. Retired unversioned business routes return `410 API_VERSION_RETIRED`; unknown routes return `404`.

Obtain `GET /api/v1/auth/csrf` before the first mutation. Send its session cookie, JSON content type, `Origin` exactly matching `APP_ORIGIN`, and `X-CSRF-Token` for every mutation, including registration and login. Login regenerates the session and returns its replacement CSRF token. Do not replay uncertain mutations automatically. Cookies are HttpOnly, SameSite=Lax and expire after eight idle hours. Sessions persist in MySQL; production cookies are secure unless `SESSION_COOKIE_SECURE=false` for the chosen HTTP deployment.

## Routes

| Method and path | Behavior | Success |
| --- | --- | --- |
| `GET /api/v1/auth/csrf` | Returns a session-bound CSRF token. | `200` `{data:{csrf_token}}` |
| `POST /api/v1/auth/register` | Registers `name`, `email`, `student_id`, and a 12–128 character `password`; does not sign in. | `201` user |
| `POST /api/v1/auth/login` | Signs in with `email` and `password`, regenerating the session and CSRF token. | `200` `{data:{user,memberships,csrf_token}}` |
| `GET /api/v1/auth/session` | Returns the signed-in user, memberships and CSRF token. | `200`; signed out `401` |
| `POST /api/v1/auth/logout` | Destroys the current session. | `204` |
| `GET /api/v1/profile` | Returns the signed-in user's profile without credentials. | `200`; signed out `401` |
| `PATCH /api/v1/profile` | Updates `name` and/or `email` for the signed-in user. | `200`; duplicate email `409`; invalid or extra fields `422` |
| `GET /api/v1/config` | Returns Hong Kong timezone and configured slots. | `200` |
| `GET /api/v1/clubs` | Signed-in club list, ordered by ID; includes the caller's `my_role` and pagination metadata. | `200` |
| `GET /api/v1/me/memberships` | Signed-in caller's club memberships with role and UTC join time; supports `page` and `page_size` (1–100). | `200` |
| `PUT /api/v1/clubs/:id/membership` | Send `{}` to request club membership; repeated requests remain pending and existing memberships retain their role. | `202` pending, `200` if already pending or a member |
| `GET /api/v1/clubs/:id/join-requests` | Committee-only pending club membership requests. | `200`; non-committee `403` |
| `POST /api/v1/clubs/:id/join-requests/:request_id/decision` | Committee sends `{"decision":"accept"}` or `{"decision":"reject"}`. Acceptance grants regular membership. | `200`; non-committee `403` |
| `DELETE /api/v1/clubs/:id/membership` | Send `{}` to leave; absent membership is idempotent. Committee members and members with future active members-only registrations cannot leave. | `204`; protected membership `409` |
| `GET /api/v1/venues` | Signed-in paginated venue list. | `200` |
| `GET /api/v1/venues/:id/calendar?from=<UTC>&to=<UTC>` | Returns confirmed bookings overlapping the half-open UTC range, up to 31 days. Draft event details are hidden and pending bookings are excluded. | `200`; invalid range `422` |
| `GET /api/v1/notifications` | Owner-only inbox; accepts `page`, `page_size` (1–100) and `unread_only` (`true`/`false`). `meta.unread_count` counts all unread messages, independent of the page and filter. | `200` with UTC timestamps and pagination metadata |
| `PATCH /api/v1/notifications/:id/read` | Owner-only; send `{}`. Repeated reads retain the original timestamp. | `200` notification; foreign or missing ID `404` |

Notifications created before the metadata migration have `type: "legacy"` rather than a guessed type.

The event and venue-review screens also use these v1 routes:

| Method and path | Behavior |
| --- | --- |
| `GET /api/v1/events`, `GET /api/v1/me/events`, `GET /api/v1/events/:id` | Authenticated, paginated event discovery, manageable events, and visibility-scoped details. |
| `POST /api/v1/events` | Creates a pending booking and draft using `club_id`, `venue_id`, `date`, `slot_id`, `title`, `description`, `visibility`, `capacity`, and optional UTC `registration_closes_at`. |
| `PATCH /api/v1/events/:id`, `POST /api/v1/events/:id/publish`, `POST /api/v1/events/:id/cancel` | Versioned edits and transitions; cancellation also requires `reason`. |
| `POST` or `DELETE /api/v1/events/:id/registration` | Public events join/waitlist immediately. Members-only events create a committee review request; DELETE withdraws a pending or active registration. |
| `GET /api/v1/events/:id/join-requests` | Committee-only paginated pending requests for a members-only event. |
| `POST /api/v1/events/:id/join-requests/:user_id/decision` | Committee sends `{"decision":"accept"}` or `{"decision":"reject"}`. Acceptance registers or waitlists the member according to capacity and their waitlist choice. |
| `GET /api/v1/me/registrations` | Paginated own registrations, including pending members-only requests, optionally filtered by status; returns the last registration and confirmation times where known. |
| `GET /api/v1/events/:id/participants` | Committee-only paginated list, filtered by `status`; includes contact details and queue position where applicable. |
| `GET /api/v1/bookings`, `POST /api/v1/bookings/:id/decision` | Venue-admin review and versioned approve/reject; rejection requires a reason. |

The beta frontend uses these v1 business routes. Earlier unversioned club management, password-change and account-deletion endpoints have no v1 replacement and are retired.

Legacy participation confirmation times are returned as `null` when the old data cannot establish whether a participant joined directly or was promoted. New joins and promotions record confirmation times explicitly.

`GET /api/health` returns `200 {"status":"ok"}` when MySQL is reachable, or `503 {"status":"unavailable"}` otherwise.

Booking requests and decisions, event edits and cancellations, and registration changes queue in-app notifications for the worker; delivery is asynchronous. The worker scans for events starting within 24 hours and also queues reminders for late joins and promotions. Reminder delivery rechecks the event and participation state.

`GET /api/v1/clubs/:club_id/reports?from=<UTC>&to=<UTC>` returns the club's events and their current joined/waitlisted counts, daily participation actions, confirmed venue hours clipped to the half-open range, and `history_complete_from`. Both dates must be UTC ISO 8601 instants, `from` must precede `to`, and the range may not exceed 93 days. The route returns `401` when signed out, `403` for non-committee members, `404` for an unknown club, and `422` for an invalid range. History before the cutoff is incomplete; these figures do not measure attendance.

Existing beta databases must stop old writers and use the [redeployment procedure](../README.md#redeploy-an-updated-archive), which saves a backup and runs the ordered, checksummed migration runner. Before the first migration, an integrity preflight checks relationships, confirmed overlaps, capacities, waitlist size, normalized identity conflicts and event/booking state. The runner takes a database advisory lock and stops on a checksum mismatch or an interrupted DDL sequence; inspect and repair a partial migration before proceeding. Fresh installations receive the same tracked migration baseline in `db/schema.sql`. A trusted operator must separately assign a venue administrator; no existing account is silently promoted. The beta stores event times as Hong Kong local datetimes; start checks use UTC+08:00 and do not perform the OpenSpec's planned UTC backfill.

The worker publishes a heartbeat used by its Compose health check. Failed deliveries retry after 5, 30, 120 and 600 seconds; after the fifth failed attempt the job requires operator review. A trusted operator can review failed jobs in `notification_jobs` and run `node src/ops/retry-notification-job.js JOB_ID VENUE_ADMIN_USER_ID` inside the backend container. Retry is limited to failed jobs, resets the lease and attempt counter, and records an audit entry. There is no public retry endpoint.
