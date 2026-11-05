# ADR 0002: ClubSpace responsive design and reporting

Status: DRAFT. Date: 2026-11-05. Change: improve-clubspace-frontend-design.

## Context

ClubSpace's mobile navigation hides destinations, the calendar compresses a week of slots into narrow cards, and report figures rely on fixed pixel scales. The project requires free MUI components for figures.

## Decision

Use a visible mobile menu with active section and role-aware destinations. Present venue availability by day on phones and by week at wide widths, using the same slot states and request parameters. Create shared visual tokens and use Material UI tables and MUI X Charts Community for reporting. Retain exact table values alongside charts.

## Alternatives considered

- A horizontally scrolling navigation strip and weekly calendar maintain one layout but hide key actions at phone widths.
- Fixed-width CSS bars have fewer dependencies but require custom axes, labels, and responsive handling.
- A sitewide MUI migration would expand the scope beyond the report figures and shared design improvements needed for this change.

## Consequences

The UI must keep day, week, venue, and selected slot consistent across layouts. Reports gain a chart dependency and need production build verification. Exact values and textual states remain available independently of chart interaction. The existing authorization, booking, and reporting contracts are the basis for validation.
