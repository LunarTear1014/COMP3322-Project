# ADR 0003: ClubSpace playful visual system, bottom tabs and event covers

Status: DRAFT; requires proposal review. Date: 2026-11-13. Change: refresh-clubspace-visual-design. Supersedes the mobile navigation decision in ADR 0002.

## Context

The first beta (change improve-clubspace-frontend-design) is accessible and responsive, but a competitor review against Airbnb, Luma, Eventbrite, Meetup, CampusGroups/Anthology Engage, 25Live and Cal.com found that it reads as an administration tool. Every page uses the same white text card; event cards carry no imagery or club identity; the join action sits below the first screen on phones; the venue request asks for venue, date and slot in separate dropdowns, so conflicts appear only as a 409 after submission; and the event list omits the club, venue, visibility and date filters that the course proposal lists as must-haves and the v1 API already accepts. Students compare ClubSpace with consumer apps, not admin consoles.

## Decisions

| Decision | Chosen approach and reason | Alternatives considered |
| --- | --- | --- |
| Visual tone | Playful but legible: Bricolage Grotesque display, Lexend text, sticker cards (2px ink outline, hard offset shadow), pop fills (sun, coral, mint) with fixed meanings, and one colour per club assigned by `club_id % 8`. Student surfaces get the full treatment; organizer and admin surfaces use the same tokens flat. | Keep the calm blue beta look (rejected: reads as a tool); fully custom per-club theming (rejected: inconsistent and hard to keep accessible). |
| Source of truth | The ClubSpace design system artifact (tokens, brand book, 17 component specs, logo). The frontend imports its compiled `tokens.css` and mirrors its component class names. | Ad-hoc CSS variables in `App.css` (rejected: already drifting); a sitewide MUI theme (rejected in ADR 0002, still rejected). |
| Phone navigation | Persistent bottom tab bar with exactly four links: Explore, My events, Clubs, Inbox. Profile, Organizer and Admin move under the account control in the header. Desktop shows the same four as header links. | The visible disclosure menu from ADR 0002 (superseded: adds a tap to every switch and hides where you are); role-dependent tab sets (rejected: navigation should not change shape by role). |
| Event images | Real organizer uploads, processed server-side into 3:2 WebP renditions with EXIF stripped, stored on a Docker volume and served through an authorized route that applies event visibility. A generated club-colour cover is the fallback. | Generated covers only (rejected by the product owner: covers carry the event's identity); public object storage (rejected: draft and members-only events would leak, and the VM deployment has no object store). |
| Typography | Bricolage Grotesque 600–800 for display and Lexend 400–800 for text, from Google Fonts, with PingFang HK / Microsoft JhengHei / Noto Sans HK fallbacks for Chinese names. | Atkinson Hyperlegible (rejected after review: slashed zeros make every time such as 10:00 look struck through); Inter (declared in the beta but never loaded). |
| Colour constraints | No violet or lavender. Members-only is an inverted ink chip with a lock icon. Every text pair meets 4.5:1 in light and dark themes. | A lilac members-only colour (rejected: reads as generic AI styling and was the only state told apart by hue alone). |

## Consequences

The frontend gains `lucide-react` for icons and loads two web fonts; the backend gains `multer` and `sharp`, a cover column migration, three routes and a persistent volume. The event list, event detail and venue request must be rebuilt around the shared components, which is easier after `App.jsx` is split into page and component files. Navigation tests that assume the disclosure menu must be rewritten. Covers add a moderation and storage-growth concern: only committee members of the event's club can upload, replaced files are deleted, and size is capped. ADR 0002's day-first calendar and MUI reporting decisions remain in force.
