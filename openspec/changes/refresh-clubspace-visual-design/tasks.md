## 0. Prerequisites

- [x] 0.1 Archive `improve-clubspace-frontend-design` so the `frontend-design` requirements exist to modify. Accept ADR 0003. (Archived 2026-11-13. The cover decisions are confirmed; the tab destinations and cover limits are still open in `proposal.md`.)
- [ ] 0.2 Share the benchmark, design system and key-screens artifacts with the team, and confirm the review decisions in `proposal.md`.

## 1. Foundations (frontend only)

- [x] 1.1 Split `App.jsx` into `src/pages/` and `src/components/` with no behaviour change. Keep `npm test`, `npm run build` and `npm run lint` passing.
- [x] 1.2 Add `src/styles/tokens.css` from the design system and port the component styles. Remove literal colours from page CSS. Set the title "ClubSpace", the favicon from `clubspace-mark.svg`, `theme-color`, and Google Fonts with `preconnect`.
- [x] 1.3 Add `lucide-react`. Build the `Button`, `StatusChip`, `TextField`, `Toast`, `EmptyState` and `BottomSheet` components, with hover, press, focus and reduced-motion states.
- [x] 1.4 Extend fixtures with club colours, covers, needs-action organizer events and unread counts.

## 2. Navigation

- [x] 2.1 Replace the disclosure menu with `TabBar` below 768 px and header links above it. Move Profile, Organizer, Admin and Sign out into the account menu. Hide the badge at 0 unread.
- [x] 2.2 Add `scroll-padding-bottom` for the fixed bars. Update the navigation UI tests for the tab bar and account menu.

## 3. Discovery and events

- [x] 3.1 Add URL-synced `FilterChips` and a filter sheet for `club_id`, `venue_id`, `visibility`, `from`/`to` and `phase`. Add the filtered-empty state.
- [x] 3.2 Rebuild `EventCard` with the date tile, club colour, capacity meter, stickers and cover or fallback. The whole card is a link; there's no layout shift.
- [x] 3.3 Rebuild the event page: one-line time, registration state cards, `StickyActionBar` below 768 px, `.ics` Add to calendar, and an Undo toast for leaving.
- [x] 3.4 Build My events (Upcoming, Waitlist, Past) and the Clubs directory. Move join and leave out of Profile.
- [x] 3.5 Restyle Inbox with grouped, typed notifications and "Mark all as read".

## 4. Organizer and admin

- [x] 4.1 Replace the request form's date and slot inputs with `SlotPicker` fed by `/config` and the venue calendar. Show 409 inline and keep the other fields.
- [x] 4.2 Split the request into Venue and time, Event details and Review, with step state in the URL.
- [x] 4.3 Build the organizer home (Needs action, Upcoming, Past) and `LifecycleStepper`. Restructure Manage event into Overview, Edit and People with an in-page cancel confirmation.
- [x] 4.4 Build the admin queue table and review panel with the venue's day, capacity check, and a reason required to reject.

## 5. Event covers (backend)

- [x] 5.1 Write the additive migration `events_add_cover` (`cover_key`, `cover_alt`, `cover_updated_at`, all nullable). Run it against fresh and Alpha-copy databases.
- [x] 5.2 Add `multer` (memory storage, 5 MB limit) and `sharp`. Implement the cover service: decode, format and size checks, auto-orient, strip metadata, 3:2 crop, `card` and `full` WebP, random keys under `COVER_DIR`.
- [x] 5.3 Add the routes `PUT|DELETE /api/v1/events/:id/cover` (Origin, CSRF, committee check, `expected_version`, state check, rate limit) and `GET /api/v1/events/:id/cover/:size` (event visibility check, private caching, ETag).
- [x] 5.4 Add `cover` to the Event and EventSummary DTOs. Delete files after commit, and add the worker's daily orphan sweep.
- [x] 5.5 Add the named Docker volume for `COVER_DIR` and include it in backups. Document it in the README.
- [x] 5.6 Add contract tests for every `event-covers` scenario: 413, 415, 422, 403, 404, 409 STALE_VERSION and INVALID_STATE, EXIF removal, replace and remove cleanup.

## 6. Event covers (frontend)

- [x] 6.1 Add `CoverUploader` to request step 2 and Manage event › Edit: client-side type, size and dimension checks, alt text defaulting to the title, progress, Replace and Remove.
- [x] 6.2 Render covers as `<img>` with width, height and alt text, and lazy loading below the first screen.

## 7. Acceptance

- [ ] 7.1 Capture screens at 320, 390, 768, 1024 and 1440 CSS px in light and dark mode, and compare them with the key-screens canvas.
- [ ] 7.2 Walk the tabs, filters, sheet, slot picker, request steps, join, leave with Undo, and the admin review using only the keyboard. Check 200% zoom, contrast and reduced motion.
- [x] 7.3 Run the frontend and backend build, lint and tests. Record fixture and real-API verification separately in `frontend-alpha/INTEGRATION.md`, and remove the "missing filters" follow-up note.

## 8. Beta feedback screens (backend in expand-clubspace-workflows section 10)

- [x] 8.1 Notification stream client: SSE with Last-Event-ID, badge and toast updates, and 60 s polling fallback. Remove the 30 s polling.
- [x] 8.2 Role-aware organizer UI: role chips, the president's sign-off queue on Organizer home, "Waiting for the president" and returned-reason states, the members page (appoint, remove, transfer with confirmation), and president-only Cancel event.
- [x] 8.3 Tags: campus tag chips in filters (`tag` in the URL), tags on cards, the event page and the club page, and a tag picker in request step 2 and Edit, with create-club-tag.
- [x] 8.4 Check-in: Open check-in, the large code and attendee list with mark and unmark on Manage event, and a student Check in action in the sticky bar with code entry.
- [x] 8.5 Effectiveness report page with MUI charts and tables, metric definitions, "Not recorded" and too-few states. Send `POST /events/:id/views` with the source from every entry point.
- [ ] 8.6 Add these states to fixtures and the key-screens canvas: sign-off queue, check-in, report, live toast.
