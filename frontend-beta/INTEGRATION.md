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
