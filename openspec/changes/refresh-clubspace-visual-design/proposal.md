# Refresh ClubSpace visual design

## Why

The beta delivered by `improve-clubspace-frontend-design` is accessible and responsive, but a competitor benchmark (Airbnb, Luma, Eventbrite, Meetup, CampusGroups/Anthology Engage, 25Live, Cal.com) found that it reads as an administration tool rather than an app students want to open:

- Event cards are text-only and give date, club, venue and capacity the same weight, with no imagery or club identity.
- On a 375 px phone the Join button sits below the first screen, and navigation is a disclosure menu that hides where you are.
- The event list offers keyword search and Upcoming/Past only. The course proposal's must-have filters (date, club, venue, visibility) are missing from the UI, although `GET /events` already accepts them.
- The venue request asks for venue, date and slot in three separate dropdowns, so a taken slot appears only as a 409 after submitting.
- Organizers see a flat event list with no "what needs my attention" view, and admins decide on bookings without seeing the venue's day.
- `Inter` is declared but never loaded, and the browser tab reads "frontend-alpha".

The product owner chose a **playful** tone, a **bottom tab bar** on phones and **real event cover uploads**.

## What Changes

- Adopt the ClubSpace design system (tokens, brand book, logo, 17 component specs) as the frontend's single visual source, including light and dark themes.
- Replace phone navigation with a four-tab bottom bar (Explore, My events, Clubs, Inbox). Move Profile, Organizer and Admin under the header's account control. **BREAKING** for UI tests that drive the disclosure menu.
- Add the missing event filters as URL-synced chips and a filter sheet, plus designed filtered-empty states.
- Rebuild the event card (date tile, club colour, capacity meter, cover) and the event page (sticky action bar on phones, one-line time, registration state cards, Add to calendar).
- Add a Clubs directory tab, moving join and leave out of Profile, and restyle Inbox and My events.
- Replace the request form's date and slot inputs with an availability-aware slot picker, and split the request into three steps.
- Add an organizer home ("Needs action" first), an event lifecycle stepper, and an admin review panel that shows the venue's whole day.
- Add organizer-uploaded **event covers**: a new API capability with server-side validation, EXIF stripping, resized WebP renditions, authorized serving and a generated fallback.

## Capabilities

### New Capabilities

- `event-covers`: upload, replace, remove and serve an event's cover image, and expose it on event DTOs.

### Modified Capabilities

- `frontend-design`: phone navigation becomes a bottom tab bar, and the venue request uses an availability-aware slot picker. New requirements cover the design system, event filters, the sticky event action, cover presentation, the Clubs directory and the organizer and admin work views.

## Impact

- `frontend-alpha/`: most screens change. `App.jsx` is split into `src/pages/` and `src/components/`. New dependency: `lucide-react`. Fonts load from Google Fonts. Fixtures gain cover, club-colour and needs-action states.
- `backend-alpha/` (v1 provider): new routes `PUT|DELETE /api/v1/events/:id/cover` and `GET /api/v1/events/:id/cover/:size`; new dependencies `multer` and `sharp`; an `event.cover` field on Event and EventSummary.
- `src/db/`: one non-destructive migration adding nullable cover columns to `events`.
- Deployment: a named Docker volume for cover files, included in backups.
- The calendar, reporting, authorization, booking and registration contracts from `expand-clubspace-workflows` are unchanged and remain prerequisites. `improve-clubspace-frontend-design` is archived (2026-11-13), so its `frontend-design` requirements exist to modify.

## References

- ADR 0003 (this change) supersedes ADR 0002's mobile navigation decision.
- Design artifacts are private until shared from their Share menu: UX benchmark https://claude.ai/artifact/GyH9uGHmb2dJw4ULkZkiv3 · design system https://claude.ai/artifact/PfyRVsb3J3SW48qwvHunF6 · key screens canvas https://claude.ai/artifact/SpRxLxvbcSiRV8ViCaNzie

## Review decisions

Confirmed by the product owner on 2026-11-13:

- Cover uploads break the JSON-only mutation rule as a documented exception, recorded in `../expand-clubspace-workflows/handoff/api.md`.
- Covers are served only through the API, with event visibility applied.
- The product owner implements the cover backend (section 5 of `tasks.md`).
- `improve-clubspace-frontend-design` is archived, and its requirements are in `openspec/specs/frontend-design/spec.md`.

Still open: confirm the four tab destinations and that organizer and admin tools live under the account control. Confirm the cover limits (JPEG or WebP, 5 MB, at least 1200×800).
