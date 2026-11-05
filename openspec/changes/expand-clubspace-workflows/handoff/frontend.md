# Frontend handoff

Target is existing `frontend-alpha/` React/Vite SPA. Preserve useful components/styles; replace Alpha-only browser state and name-based requests. No UI implementation is included in this proposal.

## 1. Shared client and account state

Create an API client using `/api/v1`, same-origin cookies (`credentials:'same-origin'`), JSON envelopes, request IDs and CSRF headers for every mutation. GET CSRF before first login/register action. Keep token in memory; never save session IDs/tokens/passwords in localStorage. Login returns replacement token. GET session bootstraps current user/memberships;401 routes to login with a same-origin return path. No fabricated demo profile if request fails.

Use shared auth/membership state and refetch after changes. Backend responses are authoritative for counts, permissions and queue position. A route guard improves UX but does not replace backend authorization. Abort/discard stale calendar/filter requests. Distinguish initial loading, background refresh, empty, offline/server error, validation error and forbidden. Do not replace a failed fetch with an empty successful list.

## 2. Page and endpoint mapping

| Page/route | Existing/new | API/actions | Required states |
| --- | --- | --- | --- |
| /login, /register | New | csrf, login/register | submitting,429 retry,field errors,invalid credentials |
| /events | Extend EventsPage | GET events/config | filters,page metadata,upcoming/past,published only |
| /events/:id | Extract details panel | GET event,POST/DELETE registration | membership required,joined,waiting position,closed,full,cancelled |
| /profile | Extend ProfilePage | GET/PATCH profile,clubs,my memberships,PUT/DELETE membership | persisted account,join/leave,blocking registration explanation |
| /me/registrations | New | GET me/registrations | joined/waitlisted/past/left/cancelled |
| /venues | Extend VenuePage | GET venues/config | capacity/location,choose calendar |
| /venues/:id/calendar | New/extend availability | GET calendar | week navigation,busy/private blocks,available slots |
| /bookings/new | Update BookingPage | POST events | ID selectors,capacity,deadline,pending confirmation |
| /organizer | Replace PlaceholderPage | GET me/events | club selector,draft/pending/confirmed/rejected/published/cancelled |
| /organizer/events/:id | New | GET/PATCH event,publish,cancel,participants | version/conflict,decision reason,participant filters |
| /admin/bookings | New | GET bookings,POST decision | pending queue,expired,self-decision disabled,conflict |
| /notifications | New | GET inbox,PATCH read | pagination,unread count,historic message,target unavailable |
| /organizer/clubs/:id/reports | New | GET report | period,counts/trend/venue hours,history cutoff |

Use committee memberships to populate organizer club choices; all venue names/IDs from API. Remove hardcoded all_clubs, venue_options and student_clubs initial membership. Join/leave persistence must survive refresh, logout/login and another browser session.

## 3. Workflow presentation

Creation confirmation says “Request submitted; venue approval pending.” Administrator approval does not publish. Organizer sees separate booking state and event lifecycle and a publish action only when confirmed. Reject reason remains visible; rescheduling starts a new request with copied fields but no inherited booking ID. No unsupported in-place venue/time edits.

Event details distinguish “Join event”, “Join waitlist”, “Leave event”, “Leave waitlist”, “Registration closed” and “Members only”. Use server eligibility including can_register/can_waitlist, but revalidate every write. Queue position shown as approximate current snapshot; refetch after action and on focus. Display full/cancelled/stale409 clearly without silently retrying.

Published edit forms expose title/description only; drafts include capacity/visibility/deadline. Version fields travel with edit/decision/cancel;409 STALE_VERSION prompts refresh and preserves unsaved content. Destructive cancel asks for reason and explains impact. This is a product confirmation, not an agent permission gate.

## 4. Calendar/report details

Display all dates in configured Asia/Hong_Kong, not browser-local timezone. Use local-calendar boundaries converted to UTC: a Hong Kong week boundary00:00 is previous-day16:00Z. Show slot labels10-12/13-15/16-18 from config. Full busy intervals can cover multiple slots; do not assume stored bookings fit same-day slots. Private draft blocks say “Reserved” with no club/event identity. Pending requests appear only in authorized managed/review screens and do not mark public slots busy.

Reports: summary counts, daily-action chart with clear legend (join/waitlist/leave/promote/cancel are actions, not attendance), current participant table and booked-hour chart. Show units/date range and history_complete_from warning for older periods. Give data table/text alternatives to charts. Never derive success/attendance percentages from registration counts.

## 5. Refresh and accessibility

Poll unread inbox count/list every30s only while signed in and page visible; pause on hidden/unmounted tab and refetch on focus. Calendar refetch on week/venue change and after managed booking mutations. No claimed live push. Background delivery is eventual, so pending inbox delivery must not roll back UI success.

Responsive layouts for phone/desktop; keyboard-accessible filters/actions/calendar alternatives, labelled inputs, visible focus, inline field errors, status text beyond color and live region for completed actions. Tables on narrow screens remain readable. Disable submit during request; don't automatically replay POST after network timeout. Every page has retry UI and handles401/403/404/409/422/429/503 distinctly where relevant.

## 6. Integration cutover

Coordinate API v1+schema+frontend release. Existing fetch calls in EventsPage/BookingPage/ProfilePage/VenuePage all change together. Vite's /api proxy can stay, production reverse proxy must use same origin. Clear stale asset cache; ensure SPA deep links serve index.html without swallowing /api errors. Contract tests/mocks use the exact API handoff examples. Do not ship a frontend expecting unavailable workflow endpoints or retain Alpha fake fallback data.
