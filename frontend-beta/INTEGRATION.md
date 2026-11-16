# Frontend beta integration

The default beta client uses the unversioned `/api` routes in `backend-beta`.
It sends the Express session cookie through the same-origin Vite proxy. The
backend is responsible for access checks, venue conflicts, and signup capacity.

The live UI supports account registration and sign-in, profile edits, club
membership requests and leave, event discovery, the weekly venue slot calendar,
organizer booking and publication in one action, event edits and cancellation,
participant lists, student registration and withdrawal, and notifications.
The backend sets event capacity from the selected venue.

The live provider has in-memory sessions. Separate venue approval and event
publication, configurable registration deadlines, and organizer reports depend
on the planned v1 provider. The live calendar shows unavailable campus slots
from the provider's daily availability endpoint.

Run `npm run dev:fixtures` for a read-only v1 preview. The preview login is
`preview@clubspace.test` with password `preview12345`. It uses sample data and
rejects business writes. `?preview=empty`, `?preview=error`, and
`?preview=student` expose additional preview states. Run `npm run dev -- --mode
v1` to connect the beta directly to a v1 provider when available.

## Verification record (visual refresh)

Fixture preview (`npm run dev:fixtures`, sample data, read-only), 2026-11-16:

- `npm test`: node tests and vitest UI tests pass; `npm run build` passes; `npm run lint` reports 0 errors
  (warnings: React effect and fast-refresh advice only).
- Contrast: `tests/contrast.test.js` checks the token pairs in light and dark (4.5:1 text, 3:1 focus ring and outlines).
- Layout: no horizontal page overflow at 320, 390, 768, 1024 and 1440 CSS px on Explore, event page, My events,
  Clubs, Inbox, Organizer, Manage event, request, Admin and Profile (measured in the browser pane with iframes).
- Screens were looked at in the fixture preview at desktop and 390 px. A full screenshot set against the key-screens
  canvas, a keyboard-only walk with 200% zoom, and reduced-motion checks in a real browser were not recorded.

Real provider: **not verified.** The legacy `/api` provider (`backend-beta`) was not run against MySQL in this
session, and the v1 cover, calendar, booking review and registration routes are not implemented there yet.
Covers, the admin queue, reports, SSE and tags therefore work only against the fixtures. The request flow's
multipart upload and the notification stream client are covered by unit tests with stubbed `fetch`.

Navigation changed: Clubs is a directory at `/clubs` (join and leave); club management moved to `/organizer/clubs`.
