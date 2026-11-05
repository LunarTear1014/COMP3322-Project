# Frontend v1 integration checklist

The default frontend calls the v1 contract directly. A separate, read-only fixture mode is available for visual review and does not simulate successful business operations. The Alpha backend does not yet implement these routes. The application requires the backend provider's passing contract tests, a migrated database, configured session/CSRF origin and the notification worker before end-to-end verification. Vite proxies `/api` to localhost:3000. Production hosting must serve the SPA for deep links and route `/api` to the backend.

| Screen | Endpoints to verify |
| --- | --- |
| Session, login, registration, sign out | GET `/auth/csrf`, GET `/auth/session`, POST `/auth/login`, `/auth/register`, `/auth/logout` |
| Profile and membership | GET/PATCH `/profile`, GET `/clubs`, `/me/memberships`, PUT/DELETE `/clubs/:id/membership` |
| Events and personal registrations | GET `/events`, `/events/:id`, `/me/registrations`; POST/DELETE `/events/:id/registration` |
| Venues and calendar | GET `/venues`, `/config`, `/venues/:id/calendar` |
| New request and organizer | POST `/events`, GET `/me/events`, GET/PATCH `/events/:id`, POST `/events/:id/publish`, `/events/:id/cancel`, GET `/events/:id/participants` |
| Admin review | GET `/bookings`, POST `/bookings/:id/decision` |
| Inbox | GET `/notifications`, PATCH `/notifications/:id/read` |
| Reports | GET `/clubs/:id/reports` |

Integration must exercise the handoff's 401/403/404/409/410/422/429/503 cases, CSRF rotation, persistence across sessions, role boundaries, optimistic conflicts, uncertain mutation outcomes, mobile/keyboard behavior, calendar privacy and intervals, polling visibility/focus, reporting history cutoff, and direct-route hosting. Verify actual provider DTOs against `handoff/api.md`; no provider contract or browser journey has been verified here. Run `npm test`, `npm run build`, and `npm run lint` from this directory. `npm test` covers the API and preview fixtures, plus rendered React workflows using the isolated fixture responses.

Known frontend follow-ups: event list currently supports search and phase but not all documented club/venue/visibility/date filters; rescheduling requires manually entering a new request rather than copying a draft; club and venue selectors currently retrieve only the first 100 records; charts and all screens need real-data accessibility and browser testing. Task 8.8 and the end-to-end acceptance gates remain open.

For a local, read-only visual preview, run `npm run dev:fixtures` and sign in with `preview@clubspace.test` / `preview12345`. This mode serves isolated sample data and rejects business mutations; it does not connect to or authenticate against the backend. The regular `npm run dev` continues to use the backend proxy.


## Frontend design verification

On 2026-11-05, the local fixture preview was inspected at 320, 390, 768, 1024, and 1440 CSS px. Checked event discovery and details, registration states, mobile menu Escape and focus return, past and available calendar slots, request prefilling and failure preservation, organizer and admin queues, conflict and forbidden responses, populated and zero-valued reports, and report date filtering and the history cutoff. The report charts disable animation and their tables expose exact values without hover. The report chart bundle is loaded only on the report route.

Use `?preview=empty` or `?preview=error` on the report or booking review URL (`?preview=empty` also exercises the profile without memberships) to inspect those fixture responses. Use `?preview=student` on the events URL to review navigation for a student without committee membership. Event IDs 3–10 exercise waitlist, closed, cancelled, members-only, joined and long-title cases. These controls only apply when Vite runs in fixture mode.

Chrome was used to check 200% browser zoom on event discovery, the report charts, and the venue calendar after the in-app browser could not change zoom. The v1 API was not running on localhost:3000 and the existing Alpha backend does not expose the documented v1 routes. Successful real-API journeys, persisted data, and provider contracts therefore remain unverified. Verify those against the integrated backend before release.

### Remaining real-API acceptance

Run these checks against the integrated v1 service with disposable student, committee, and venue-administrator accounts. Record the tested commit, date, and outcome alongside the provider's contract-test result. Do not use fixture mode for this run.

| Journey | Real-API evidence still needed |
| --- | --- |
| Discovery and registration | Search published events, inspect eligibility, register or join a waitlist, reload, and verify the returned status and position. |
| Venue request | Select a future available slot, submit a draft as committee, and confirm the pending booking and selected Hong Kong time survive reload. |
| Review and publication | Review a disposable pending request as a different club's administrator, check conflict and reason handling, then publish separately as committee. |
| Reports | Change the date range and compare current counts, daily action totals, and confirmed hours in the charts and tables against the API response. |

Real-API result: **not run**. No service is listening on port 3000 in this checkout, and `backend-alpha/index.js` currently exposes the legacy `/api/*` routes rather than the `/api/v1` contract. Fixture-only tests do not establish persistence or backend authorization. The frontend-only acceptance for task 5.2 is complete against fixtures. These real-service checks remain a separate integration and release dependency until the provider is available.

Backend availability was rechecked against published `main` at commit `5acb4cd` on 2026-11-05. Its `backend-beta` still exposes the legacy `/api/events`, `/api/venues`, and `/api/profile` routes and uses a demo profile, so it cannot provide the v1 session, participation, review, or reporting contracts for task 5.2. The current feature-branch worktree was not changed by that read-only check.

Frontend-only acceptance was rerun on 2026-11-05. `npm run build` passed, `npm run lint` exited successfully with five React warnings, and `npm test` passed seven API/fixture tests and twelve rendered-workflow tests. Real-API result remains not run as stated above.
