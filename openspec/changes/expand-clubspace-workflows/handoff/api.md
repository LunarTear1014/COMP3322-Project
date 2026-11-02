# API contract v1

This is the implementation target, not a list of endpoints already implemented.

## 1. Common conventions

Base `/api/v1`. Cookies carry the session; never bearer tokens/localStorage. IDs are positive JSON safe integers; booleans are JSON booleans; enums lower_snake_case. All returned instants ISO8601 UTC with Z; campus dates YYYY-MM-DD in Asia/Hong_Kong. Database timestamps never appear as naive strings on wire. Money/attendance fields are absent.

Success: `{ "data": <object|array>, "meta": {...} }`; meta omitted for object responses unless specified. List meta `{page:1,page_size:20,total:42}`; page>=1, page_size1..100 default20; stable ordering below. Empty list is200. Mutation responses include authoritative state, not merely success:true. 204 has no body.

Error example:
```json
{"error":{"code":"STALE_VERSION","message":"This event changed. Refresh and try again.","fields":{},"request_id":"req-uuid"}}
```
Every error includes code/message/fields (object)/request_id; field errors map field name to string. A validation response must not disclose whether a private draft exists. Processing precedence: parse/media limits -> Origin/CSRF -> authentication -> syntactic DTO validation -> visibility lookup -> permission -> expected version -> business state. Auth endpoints exempt only authentication. Health/config/CSRF exempt mutation checks as GETs. Responses expose `X-Request-Id`.

| HTTP | Codes/meaning |
| --- | --- |
| 400 | INVALID_JSON |
| 401 | AUTHENTICATION_REQUIRED / INVALID_CREDENTIALS |
| 403 | FORBIDDEN / CSRF_INVALID / ORIGIN_INVALID / SELF_DECISION_FORBIDDEN |
| 404 | NOT_FOUND for missing or hidden private resource |
| 409 | STALE_VERSION, INVALID_STATE, VENUE_UNAVAILABLE, EVENT_FULL, WAITLIST_FULL, REGISTRATION_CLOSED, MEMBERSHIP_REQUIRED, ACTIVE_MEMBER_REGISTRATIONS, COMMITTEE_MEMBERSHIP_PROTECTED, PUBLISHED_FIELDS_FROZEN, EVENT_STARTED, EMAIL_IN_USE, STUDENT_ID_IN_USE |
| 410 | API_VERSION_RETIRED on old business URLs |
| 413/415/422 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE / VALIDATION_FAILED |
| 429 | RATE_LIMITED with Retry-After seconds |
| 500 | INTERNAL_ERROR (sanitized) |
| 503 | DATABASE_UNAVAILABLE / AUTH_BUSY / TRANSACTION_RETRY_EXHAUSTED |

All mutations require Content-Type: application/json, exact Origin=APP_ORIGIN and X-CSRF-Token. Empty action bodies are `{}`; unknown fields422. Missing expected_version422; obsolete version409. expected_version is resource metadata version (booking for decision; event for edit/publish/cancel), not registration count. Create POST has no automatic replay/idempotency guarantee. Registration, membership and withdrawal idempotency is explicitly defined below.

## 2. Endpoint inventory

Auth: public=anonymous allowed; user=authenticated; committee=committee of target club; admin=global venue_admin.

| Method/path (relative to base) | Auth | Request/query | Success |
| --- | --- | --- | --- |
| GET /config | public | none |200 Config |
| GET /auth/csrf | public | none |200 {csrf_token} + session cookie |
| POST /auth/register | public+CSRF | Register |201 User; no auto-login |
| POST /auth/login | public+CSRF | Login |200 {user,memberships,csrf_token} + regenerated cookie |
| GET /auth/session | user | none |200 {user,memberships,csrf_token} |
| POST /auth/logout | user |{}|204; session/cookie destroyed |
| GET /profile | user |none|200 User |
| PATCH /profile | user |{name?,email?}|200 User; duplicate email409 |
| GET /clubs | user |page,page_size|200 Club[] sorted id ASC |
| GET /me/memberships | user |page,page_size|200 Membership[] sorted club_id ASC |
| PUT /clubs/:club_id/membership | user |{}|201 created or200 existing Membership |
| DELETE /clubs/:club_id/membership | user |{}|204 absent/deleted; protected409 |
| GET /events | user |EventFilters|200 EventSummary[] sorted start_at,id ASC |
| GET /events/:id | user/scoped draft |none|200 Event |
| POST /events | committee |CreateEvent|201 Event with pending booking |
| PATCH /events/:id | committee |EditEvent|200 Event |
| POST /events/:id/publish | committee |{expected_version}|200 Event |
| POST /events/:id/cancel | committee/admin |{expected_version,reason}|200 Event |
| GET /me/events | user |club_id?,state?,page,page_size|200 manageable Event[]; other roles yield empty unless committee |
| POST /events/:id/registration | user |{allow_waitlist:boolean}|201 new lifecycle or200 existing RegistrationResult |
| DELETE /events/:id/registration | user |{}|200 RegistrationResult; absent is left |
| GET /me/registrations | user |status?,page,page_size|200 MyRegistration[] sorted event.start_at,id DESC |
| GET /events/:id/participants | committee |status?,page,page_size|200 Participant[] sorted last_registered_at,user_id ASC |
| GET /bookings | admin |status?,venue_id?,page,page_size|200 Booking[] sorted created_at,id ASC |
| POST /bookings/:id/decision | admin,not self |Decision|200 Booking; no publication |
| GET /venues | user |page,page_size|200 Venue[] sorted id ASC |
| GET /venues/:id/calendar | user |from,to|200 Calendar (max31days) |
| GET /notifications | user |unread_only?,page,page_size|200 Notification[]+meta.unread_count; created_at,id DESC |
| PATCH /notifications/:id/read | user/owner |{}|200 Notification; repeated read unchanged |
| GET /clubs/:id/reports | committee |from,to|200 ClubReport (max93days) |

Retain root `/api/health` outside v1:200 `{status:"ok"}` or503 `{status:"unavailable"}` with no internal details. Unsupported methods return structured405 and Allow header; unknown routes404. Retired `/api/events`, `/api/venues`, `/api/profile` and their old write methods return410; do not keep an insecure compatibility write path.

## 3. Request DTOs and filters

| DTO | Required/optional fields and validation |
| --- | --- |
| Register | name1..100 Unicode chars, email<=254 valid shape normalized trim/lowercase, student_id1..50 `[A-Za-z0-9-]+`, password12..128 chars untrimmed; no role |
| Login | email,password; strings nonempty; do not trim password |
| CreateEvent | club_id,venue_id positive ints; title trimmed1..255; description trimmed1..10000; date real campus YYYY-MM-DD; slot_id morning/afternoon/evening; visibility public/members_only; capacity int1..500 and<=venue; registration_closes_at optional UTC instant default start |
| EditEvent | expected_version positive int, at least one of title/description/capacity/visibility/registration_closes_at; same validation as create; published only title/description |
| Decision | expected_version positive int; decision approve/reject; reason optional string<=500 for approve, required trimmed1..500 for reject |
| Cancel | expected_version positive int; reason trimmed1..500 required; retained in audit/notifications |
| EventFilters | q trimmed<=100; club_id,venue_id; visibility; phase upcoming/past (default upcoming); from/to optional paired UTC instants; page/page_size. Only published events; cancelled history via own registration/managed routes |
| Date ranges | both UTC ISO8601 Z values, from<to, half-open; max31days calendar,93days report/event filter; reject impossible date/time or offset-less values |

/me/events state accepts draft/published/cancelled; only returns actor's committee clubs, optional club_id must be one of them else403. Booking status accepts pending/confirmed/rejected/cancelled; expired boolean derived. Registration status joined/waitlisted/left/cancelled. Participant filtering permits those values, default joined. Boolean queries only literal true/false. q search uses escaped LIKE literal wildcards or equivalent safe search; no unbounded SQL wildcard injection or arbitrary SQL sorts.

## 4. Response resources

User: `{id,name,email,student_id,platform_role}`. Membership: `{club_id,club_name,role:"member|committee",joined_at}`. Club: `{id,name,description,my_role:null|member|committee}`. Venue: `{id,name,location,description,capacity,is_active}`. No password_hash/session IDs.

Config:
```json
{"data":{"campus_timezone":"Asia/Hong_Kong","slots":[{"id":"morning","start":"10:00","end":"12:00"},{"id":"afternoon","start":"13:00","end":"15:00"},{"id":"evening","start":"16:00","end":"18:00"}]}}
```
Create:
```json
{"club_id":1,"venue_id":1,"title":"Photography workshop","description":"Campus photography practice","date":"2026-11-12","slot_id":"morning","visibility":"members_only","capacity":30,"registration_closes_at":"2026-11-11T16:00:00Z"}
```
Canonical Event (summary omits description/booking decision details, otherwise same names):
```json
{"data":{"id":12,"club":{"id":1,"name":"Photography Society"},"venue":{"id":1,"name":"Lok Yew Hall","capacity":80},"title":"Photography workshop","description":"Campus photography practice","start_at":"2026-11-12T02:00:00Z","end_at":"2026-11-12T04:00:00Z","registration_closes_at":"2026-11-11T16:00:00Z","visibility":"members_only","state":"draft","phase":"upcoming","version":1,"capacity":30,"joined_count":0,"waitlisted_count":0,"my_registration":{"status":"none","queue_position":null},"eligibility":{"can_register":false,"can_waitlist":false,"reason":"NOT_PUBLISHED"},"booking":{"id":14,"status":"pending","version":1,"expired":false,"decision_reason":null,"decided_at":null}}}
```
state is persisted lifecycle, phase derived from start_at>=now; frontend must not infer lifecycle from dates. my_registration.status none/joined/waitlisted/left/cancelled, queue_position one-based only waiting. eligibility reasons null/NOT_PUBLISHED/EVENT_CANCELLED/REGISTRATION_CLOSED/MEMBERSHIP_REQUIRED/EVENT_FULL/WAITLIST_FULL/ALREADY_REGISTERED; can_register means direct admission possible (seat available), not eligibility to queue; expose `can_waitlist:boolean` alongside can_register. Actual writes always recheck. Event eligibility/counts are advisory after response.

Booking: `{id,event_id,club_id,venue_id,start_at,end_at,status,version,requested_by,created_at,decided_by,decided_at,decision_reason,expired}`; actor IDs may be null on migrated records. Admin list contains draft title as extra `event_title`. Only authorized recipients get decision details. Public published event responses omit requester/decision actor IDs.

RegistrationResult:
```json
{"data":{"event_id":12,"status":"waitlisted","queue_position":1,"joined_count":30,"waitlisted_count":1}}
```
MyRegistration: `{event:EventSummary,status,queue_position,last_registered_at,confirmed_at,left_at}`. Participant (committee only): `{user:{id,name,email,student_id},status,queue_position,last_registered_at,confirmed_at,left_at}`. Default participant list must not expose password or private session information.

Calendar:
```json
{"data":{"venue_id":1,"from":"2026-11-08T16:00:00Z","to":"2026-11-15T16:00:00Z","campus_timezone":"Asia/Hong_Kong","bookings":[{"start_at":"2026-11-12T02:00:00Z","end_at":"2026-11-12T04:00:00Z","busy":true,"event_id":12,"title":"Photography workshop","club_id":1}]}}
```
Private draft blocks have event_id/title/club_id null; no pending blocks. Client overlays supplied fixed daily slots and uses full intervals for availability, including legacy cross-midnight intervals. Backend accepts only configured date/slot on creation.

Notification: `{id,type,event_id:null|int,booking_id:null|int,title,body,created_at,read_at:null|instant}`. Text is server-generated plain text, never executable HTML. List meta includes global own unread_count independent of unread_only/page. Historic notification can link to cancelled event; target GET handles current visibility.

ClubReport: `{club_id,from,to,campus_timezone,events:[{event_id,title,state,capacity,joined_count,waitlisted_count}],daily_actions:[{date,joined,waitlisted,left,promoted,cancelled}],venue_hours:[{venue_id,venue_name,hours}],history_complete_from}`. Include published/cancelled events starting in report window; daily_actions counts history transitions occurring in window for those events. Fill every Hong Kong calendar day intersecting window with zeros when no actions. Hours are decimal numbers rounded to2dp after summing clipped confirmed intervals for club. history_complete_from is migration cutover; historical action figures before it are not reconstructed. No attendance percentages.

## 5. Contract edge cases

- Invalid body/type422; stale metadata409; forbidden management403; private foreign draft404. A known published members-only event registration by nonmember409 MEMBERSHIP_REQUIRED.
- At exactly deadline no join/promotion; withdrawal still possible until start. At exactly start no active withdrawal or cancellation.
- Repeated active registration200 unchanged, first/new lifecycle201. Withdrawal absent/left200; cancelled event200 cancelled. Rejoin joins end of queue.
- Approval checks current venue, not the earlier calendar response. Adjacent intervals can coexist.
- Mutation success means committed business state, not already-delivered background notification. UI renders success then refetches inbox.
- Refetch after409/uncertain network outcome, preserving user-entered form data. No transparent POST replay.

## 6. Additional visibility and state details

GET event detail permits published metadata to any signed-in user, draft to relevant committee/admin only, and cancelled metadata to relevant committee/admin or a student with any historical participation row for that event. Other cancelled/draft objects return404. This permits own cancellation notifications/history without making all cancelled drafts public. Participant list still requires committee; admin role alone does not grant participant identities. `my_registration.status=none` is a wire-only absence state.

An existing joined/waitlisted user receives eligibility.can_register=false and can_waitlist=false with ALREADY_REGISTERED; the action offered is withdrawal. When eligible but full and waiting has space, can_waitlist=true and reason=EVENT_FULL. When directly admissible, can_register=true, can_waitlist=false and reason=null. Cancellation/state/deadline/membership reasons precede fullness. Eligibility responses never authorize a later mutation without another DB check.

Read-only GET endpoints accept no request body. GET /config is public and has no secrets. Logout requires a valid session/token; repeated logout after session destruction returns401 and the client clears local account state. Profile PATCH requires at least one field, name/email validation identical to registration, and forbids student_id/platform_role edits.

UTC strings accept exactly YYYY-MM-DDTHH:mm:ss[.1-6digits]Z with actual calendar validity. Implement conversion before comparisons; do not compare differently formatted timestamps lexicographically. Integers are not accepted as numeric strings in JSON bodies; URL/query identifiers are parsed strictly without trailing text. Whitespace-only fields are invalid after their stated trimming policy.
