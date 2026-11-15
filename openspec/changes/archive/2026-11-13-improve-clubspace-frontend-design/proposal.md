# Improve ClubSpace frontend design

## Why

The frontend audit found that students must scan equally weighted details to decide whether to join an event, and organizers and venue administrators lack clear visual cues for their next action. At a 390 px viewport, 742 px of navigation was contained in a 358 px strip. The calendar offered past slots as available, and empty reports rendered blank chart areas and header-only tables.

## What Changes

- Establish a shared visual system for typography, spacing, color, surfaces, focus, actions, and status labels. Retain the calm blue direction and give event discovery a distinct campus identity.
- Make sign-in and primary navigation easy to find on phones. Clarify event cards, registration decisions, and the handoff from venue availability to a booking request.
- Give organizer and admin pages clear action priorities, separately labelled lifecycle states, and informative empty states. Apply the same feedback patterns to profile, registrations, and notifications.
- Use free MUI X Charts Community for report figures and Material UI tables for exact values. Explain units, date ranges, empty results, and the distinction between registration actions and attendance.
- Verify with populated and empty preview fixtures, keyboard navigation, contrast checks, and captures at mobile, tablet, and desktop widths.

## Capabilities

### New Capabilities

- `frontend-design`: Responsive navigation, visual hierarchy, clear booking and registration presentation, and readable report figures.

### Modified Capabilities

None. This is a presentation change built on the workflows specified by `expand-clubspace-workflows`.

## Impact

`frontend-alpha/` owns the work. The existing API contracts, campus timezone, role permissions, booking and publication transitions, and report metric definitions are prerequisites. No backend schema, API, session, or authorization changes are required. Populate local preview fixtures to review representative states while real integration is pending. The proposal does not include new product features, premium MUI packages, or a sitewide component migration.

## Review decisions

The proposed mobile pattern is a visible navigation menu and a day-first venue calendar. The proposed reporting pattern uses a daily action chart, a horizontal venue-hours chart, and tables for exact values. Review these patterns against populated examples before implementation sign-off.
