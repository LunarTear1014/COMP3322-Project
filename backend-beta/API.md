# ClubSpace backend API

This document describes the Express routes in `backend-beta` at repository commit `3e18510` (backend from `0b7efc3`). It is based on source inspection. The proposed versioned API is documented separately in [the OpenSpec API handoff](../openspec/changes/expand-clubspace-workflows/handoff/api.md).

## Connection and conventions

The development server defaults to `http://localhost:3000`, configurable with `PORT`. See the [project setup](../README.md) for the database and environment. Requests with bodies use `Content-Type: application/json`. The API returns JSON objects or arrays directly, with no common `data` envelope. Successful `204` responses have no body. Numeric path IDs must be positive safe integers.

Registration and login establish a `clubspace.sid` session cookie. Send this cookie on subsequent authenticated requests. The cookie is HttpOnly, SameSite=Lax, and expires after 24 hours. It is secure in production unless `SESSION_COOKIE_SECURE=false`. Sessions use the default in-memory store and do not survive a server restart. The current server does not implement the proposed v1 CSRF endpoint or its token protocol.

Most validation and application errors have the form `{"message":"..."}`. Common statuses include `401` for missing authentication, `403` for insufficient privileges, `404` for missing resources, `409` for conflicts, `422` for invalid input, and `500` for database errors. Some role-management operations also return `400`. See each route for exceptions. SQL datetime values returned by the current API are not the proposed v1 UTC instant format.

## Authentication and account

| Method and path | Request and behavior | Success |
| --- | --- | --- |
| `POST /api/auth/register` | JSON `name`, `email`, `student_id`, `password`, `confirm_password`. Creates an account and signs it in. Password length is 8–128 characters. | `201` user object and session cookie; duplicate email or student ID gives `409` |
| `POST /api/auth/login` | JSON `email`, `password`. | `200` user object and session cookie; incorrect credentials give `401` |
| `POST /api/auth/logout` | Destroys the session and clears the cookie. | `204` |
| `GET /api/auth/me` | Requires a session. | `200` user object or `401` |
| `PUT /api/auth/me` | Requires a session. JSON `name` and `email` are required. To change the password, also provide `current_password`, `new_password`, and matching `confirm_password`. | `200` updated user; incorrect current password gives `401`, duplicate email gives `409` |
| `DELETE /api/auth/me` | Requires a session and JSON `current_password`. Deletes the account and ends the session. | `204`; incorrect password gives `401` |

A user object contains `id`, `name`, `email`, and `student_id`. Email is trimmed and normalized to lowercase during registration and login.

Example login and authenticated request using a local cookie jar:

```sh
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"student@example.com","password":"example-password"}' \
  http://localhost:3000/api/auth/login
curl -b cookies.txt http://localhost:3000/api/auth/me
```

## Clubs and memberships

Roles are `member`, `committee`, and `president`. Club and user IDs in paths are positive integers.

| Method and path | Authentication and behavior | Success |
| --- | --- | --- |
| `GET /api/clubs` | Public. Returns clubs with `id`, `name`, `description`, `is_member`, `role`, `request_status`, and `pending_request_count` for the current session. | `200` array |
| `GET /api/memberships` | Returns the current session's memberships with `club_id`, `name`, `description`, `role`, and `joined_at`. An anonymous request returns an empty array. | `200` array |
| `POST /api/clubs` | Signed-in user supplies `name` and optional `description`. The creator becomes president. | `201` club; duplicate name `409` |
| `POST /api/clubs/:club_id/membership` | Signed-in user requests membership. Approval is required. | `202` with `status: "pending"`; duplicate membership or pending request `409` |
| `DELETE /api/clubs/:club_id/membership` | Removes the current membership. A president must transfer presidency or delete the club first. | `204`; president or non-member `409` |
| `GET /api/clubs/:club_id/join-requests` | Club committee or president lists pending requests. | `200` array of `id`, `user_id`, `name`, `requested_at` |
| `POST /api/clubs/:club_id/join-requests/:request_id/review` | Committee or president sends `{"decision":"accept"}` or `{"decision":"reject"}`. The requester is notified of the outcome. | `200` message; missing or no-longer-pending request `404` |
| `GET /api/clubs/:club_id/members` | Committee or president views the roster. | `200` array of `user_id`, `name`, `role` |
| `POST /api/clubs/:club_id/members/:user_id/committee` | Committee or president promotes another regular member. | `200` message; self-promotion `400`, existing role `409` |
| `DELETE /api/clubs/:club_id/members/:user_id/committee` | President removes another member's committee role. | `200` message; self-demotion `400`, wrong role `409` |
| `DELETE /api/clubs/:club_id/committee` | Committee member leaves the committee while retaining membership. | `200` message; non-committee `409` |
| `POST /api/clubs/:club_id/presidency` | President sends `user_id` as a positive integer string and `confirmation` equal to the exact club name. The target must already be committee. | `200` message; wrong confirmation `422`, ineligible target `409` |
| `DELETE /api/clubs/:club_id` | President sends JSON `confirmation` equal to the exact club name. Deletes the club and its associated events, bookings, and memberships. | `204`; wrong confirmation `422` |

The membership deletion route does not explicitly check the session before calling its service. With no session, the current service's undefined default references an unavailable variable and the route can return `500`; clients should sign in before calling it.

## Venues

`GET /api/venues?date=YYYY-MM-DD` is public. The optional date defaults to the current UTC date. The format is checked as a string pattern. The response is an array of venues with `id`, `name`, `location`, `capacity`, `description`, and `timeslots`. Each timeslot has `time` and `available`, based on overlapping confirmed bookings.

The fixed timeslot strings are `10:00 - 12:00`, `13:00 - 15:00`, and `16:00 - 18:00`.

## Events and participation

| Method and path | Authentication and behavior | Success |
| --- | --- | --- |
| `GET /api/events` | Public. Lists published events in start-time order. `?managed=true` requires a session and lists events managed by the user's club roles. | `200` array |
| `GET /api/events/mine` | Signed-in user's participation history. | `200` array |
| `GET /api/events/:event_id` | Published events are visible; organizers and users with participation can also access their relevant unpublished/cancelled event. | `200` event or `404` |
| `GET /api/events/:event_id/participants` | Organizing club's committee or president. | `200` array of joined and pending participants (`user_id`, `name`, `status`, `joined_at`) |
| `POST /api/events` | Organizing club's committee or president. Body and example below. Creates a confirmed booking and published event together. | `201` event; booking conflict `409`, unauthorized club `403` |
| `PATCH /api/events/:event_id` | Organizing club's committee or president. Send both `title` and `description` for a details-only edit. To change venue/time/visibility, also send `date`, `venue`, `timeslot`, and `visibility`. | `200` message; conflict or cancelled event `409` |
| `DELETE /api/events/:event_id` | Organizing club's committee or president cancels the event and booking and creates participant notifications. | `200` message; already cancelled `409` |
| `POST /api/events/:event_id/participation` | Signed-in user. Optional JSON boolean `allow_waitlist` defaults to `true`. Members-only events require club membership. | `201` joined or `202` pending, with `status` and `message`; already joined/pending or unavailable `409` |
| `DELETE /api/events/:event_id/participation` | Signed-in user withdraws from the event or waitlist. A joined user's withdrawal promotes the earliest waiting user when present. | `204`; no active participation `409` |

Participation statuses are `joined`, `pending` (including waitlist entries), and `unsuccessful` (withdrawn registrations and registrations for cancelled events). Event status `cancelled` remains separate. Leaving the waitlist or event, or cancelling an event, makes the registration unsuccessful; the user may register again while the event remains available.

The event list returns fields including `id`, `title`, `description`, `club`, `club_id`, `venue`, `venue_id`, `date`, `timeslot`, `visibility`, `capacity`, `joined_count`, `waitlisted_count`, `is_full`, `is_joined`, `participation_status`, `registration_status`, `event_status`, `booking_status`, `can_cancel`, and `status` (`Upcoming` or `Past`). Visibility is `Public` or `Members only`. `GET /api/events/mine` has a different participation-oriented shape. The list endpoint itself implements the `managed` filter only; the beta frontend adapter applies its discovery filters and pagination locally.

Create example (club and venue are names, not IDs):

```json
{
  "club": "Photography Club",
  "title": "Photography workshop",
  "description": "An introduction to campus photography.",
  "date": "2027-03-15",
  "venue": "Harbour Room",
  "timeslot": "10:00 - 12:00",
  "visibility": "Public"
}
```

Title, description, club, and venue must be nonempty. The date must match `YYYY-MM-DD` and cannot precede the server's current UTC date. Capacity is taken from the chosen venue. The creation response has fewer fields than the event list response.

## Notifications and health

| Method and path | Behavior | Success |
| --- | --- | --- |
| `GET /api/notifications` | Signed-in user receives up to 50 newest event and club join-request notifications, with `id`, `event_id`, `club_id`, `club_join_request_id`, `event_title`, `message`, `created_at`, `read_at`, and `created_epoch`. | `200` array |
| `PATCH /api/notifications/:notification_id/read` | Marks the signed-in user's own notification read. | `204`; unknown or another user's notification `404` |
| `GET /api/health` | Executes `SELECT 1` against MySQL. | `200 {"status":"ok"}` or `500` on database error |

Event edits and cancellations, new club join requests, and join-request decisions insert in-app notification records directly. Join-request notifications are sent to every club committee member and president and are removed after the request is reviewed; the requester receives a separate notification with the outcome. The planned background worker, scheduled reminders, venue approval flow, separate publish action, and v1 reports are not implemented by these routes.
