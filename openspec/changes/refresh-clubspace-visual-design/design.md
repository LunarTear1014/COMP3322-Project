## Context

`improve-clubspace-frontend-design` is complete; its fixtures, accessibility work and MUI reports stay. This change restyles and restructures the screens on top of it. It is based on a competitor benchmark, the ClubSpace design system (tokens, brand book, 17 components, logo) and a key-screens canvas covering student, organizer and admin flows. All screens live in one 36 KB `frontend-alpha/src/App.jsx`, with long single-line components, and `App.css` is mostly minified lines that override each other. The v1 API contract in `../expand-clubspace-workflows/handoff/api.md` stays authoritative; only event covers extend it.

## Goals / Non-Goals

**Goals:** Make ClubSpace feel like a student app (playful, image-led, one obvious action per screen) without losing the beta's accessibility. Close the missing-filter gap. Prevent slot conflicts before submission where the data allows it. Give organizers and admins a "what needs me" view. Let organizers upload event covers safely.

**Non-Goals:** Change registration, booking, approval, publication or reporting rules. Add attendee lists to students ("who's going" avatars need a privacy review first). Add payments, reviews or a native app. Migrate the site to MUI.

## Decisions

1. **One visual source.** Copy the design system's compiled `tokens.css` into `frontend-alpha/src/styles/tokens.css`, and port its component stylesheet as plain CSS modules or class names (`cs-btn`, `cs-card`, `cs-chip`…) inside `src/components/`. Components read only tokens; no literal colours in components. Dark theme follows `prefers-color-scheme`, with `data-theme` as an override. `<meta name="theme-color">` and the page title ("ClubSpace") are set in `index.html`.
2. **Split before restyling.** Move each route into `src/pages/<Page>.jsx` and shared pieces into `src/components/`, with no behaviour change, and keep the existing tests green. Then restyle page by page. This keeps three developers out of each other's long lines.
3. **Bottom tab navigation.** Below 768 px a fixed `TabBar` renders four `<a>` links with `aria-current="page"` and an Inbox badge (hidden at 0, announced as "N unread"). At 768 px and above the same links sit in the header. Organizer, Admin, Profile and Sign out live in an account menu. The page sets `scroll-padding-bottom` equal to the bars, so focused fields are never hidden.
4. **Filters in the URL.** `Events` reads and writes `q`, `phase`, `club_id`, `venue_id`, `visibility`, `from` and `to` through `useSearchParams`. Quick chips map to presets (This week = campus Monday to next Monday in UTC instants). A `BottomSheet` (phone) or popover (desktop) holds the full set. Club and venue options come from the existing list endpoints.
5. **Event page action.** Below 768 px a `StickyActionBar` holds one action derived from `eligibility` and `my_registration`, and its info line is `aria-live="polite"`. Add to calendar generates an `.ics` file client-side from the event's UTC instants. Leaving an event uses an Undo toast (the DELETE is sent after 5 seconds unless undone) instead of `window.confirm`.
6. **Slot picker.** The request page fetches `/config` slots and `/venues/:id/calendar` for the chosen week and renders `SlotPicker`. Past and busy slots are disabled with their reason. The server's 409 stays authoritative and is shown inline above the slots, followed by a refresh. The request becomes three steps (venue and time, event details, review) in one route with step state in the URL.
7. **Organizer and admin views.** Organizer home groups `/me/events` into Needs action (approved drafts, rejected bookings), Upcoming and Past. `LifecycleStepper` derives its steps from the booking status and event state, never from dates alone. The admin review panel loads the venue's calendar for the request's campus day beside the queue.
8. **Covers: storage and processing.** `PUT /events/:id/cover` accepts `multipart/form-data`. This is a documented exception to the JSON-only mutation rule; Origin and CSRF checks still apply. `multer` uses memory storage capped at 5 MB, and `sharp` verifies the decoded format (JPEG or WebP, not just the extension), checks at least 1200×800, auto-orients, strips all metadata including GPS, centre-crops to 3:2 and writes `card` (600×400) and `full` (1200×800) WebP files named by a random 128-bit key under `COVER_DIR` (a named Docker volume). The database stores only the key, alt text and timestamps. Replace and remove delete old files after the transaction commits; a daily worker job deletes files with no row. Serving goes through `GET /events/:id/cover/:size`, which runs the same visibility check as `GET /events/:id` and returns 404 for hidden events, with `Cache-Control: private, max-age=86400` and an ETag on the key.
9. **Motion and icons.** CSS transitions on `transform` and `opacity` only, disabled under `prefers-reduced-motion`. Use the existing `motion` dependency for the Join → "You're going!" moment, sheets and toasts. Add `lucide-react` for icons; decorative icons get `aria-hidden`.

## Risks / Trade-offs

- **Bigger visual change, more regressions.** Mitigation: split first with no behaviour change; restyle per page behind the existing fixture tests; capture screenshots at 320/390/768/1024/1440 before and after.
- **Uploads add attack surface.** Mitigation: size cap before parsing, decoding by `sharp` (not trusting MIME or extension), metadata stripped, random filenames, no user-supplied paths, authorization reused from event edit, and rate limiting on the upload route.
- **Storage growth on a single VM.** Two WebP renditions are about 250 KB per event; old files are deleted on replace, and orphans are swept daily. The volume is added to backups.
- **Web fonts.** Two families add about 120 KB. Mitigation: `preconnect`, `display=swap`, and limited weights. Chinese names use system fonts.
- **A sticker style can feel loud on admin pages.** It applies only to student surfaces; organizer and admin views stay flat.

## Migration Plan

1. `improve-clubspace-frontend-design` is archived (done 2026-11-13). Accept this change and ADR 0003.
2. Frontend split (no visual change) → tokens and fonts → navigation → discovery → event page → request → organizer and admin.
3. Backend: migration `events_add_cover` (nullable `cover_key CHAR(32)`, `cover_alt VARCHAR(200)`, `cover_updated_at DATETIME(6)`), routes, DTO field, worker sweep, volume. Fresh and Alpha-copy databases both run the migration.
4. Frontend cover uploader and card presentation after the backend contract tests pass. Until then, fixtures supply covers and the fallback art is used.
5. Rollback: the UI can ship without covers (fallback art); the migration is additive and the columns can be left unused.

## Verification

Screens at 320, 390, 768, 1024 and 1440 CSS px in light and dark mode; keyboard-only walk of tabs, filters, sheets, slot picker and request steps; 200% zoom; contrast check of every token pair; reduced motion. Cover tests: oversize, undersize, wrong type renamed as JPEG, EXIF GPS removed, unauthorized upload (403), hidden event cover (404), replace deletes old files, and concurrent edits use `expected_version`. Run build, lint and tests, and record fixture and real-API results separately in `frontend-alpha/INTEGRATION.md`.
