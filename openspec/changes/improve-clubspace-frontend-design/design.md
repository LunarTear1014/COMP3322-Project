## Context

The React/Vite frontend has a shared shell and styling, with the key screens implemented in `frontend-alpha/src/App.jsx`. The audit reviewed desktop and narrow viewports using read-only fixtures. Populated approval and reporting screens were absent from those fixtures. This change depends on the route, role, and API rules in the workflow handoff at `../expand-clubspace-workflows/`.

## Goals / Non-Goals

**Goals:** Improve aesthetics, readability, responsiveness, and clarity. Make the next action obvious and retain meaningful state and recovery information across screen sizes.

**Non-Goals:** Change workflows, API payloads, role permissions, persisted data, or time rules. Introduce premium components, animation work, or a wholesale UI framework migration.

## Decisions

1. **Create a small shared visual system.** Define semantic tokens for typography, spacing, surfaces, text, action emphasis, status, and focus. Reuse a page heading pattern, primary action style, status labels, and loading, empty, and error presentations. Give discovery more visual emphasis on event title and date, while organizer and admin lists favor density and quick comparison.
2. **Use task-first mobile layouts.** Put account forms ahead of introductory copy at phone widths. Expose all role-appropriate destinations in a visible mobile menu with a current-section indicator and keyboard focus management. Group profile and sign-out under account controls. Keep the calendar venue and week visible. Offer one day of readable, selectable slots at narrow widths and retain the weekly overview at wide widths. Keep day, week, and selection in sync through viewport changes.
3. **Present workflow state in plain language.** Keep event state, booking state, and the viewer's registration state separate. Put an eligibility-aware action beside availability and the registration deadline. Carry the chosen venue, campus date, and slot into a visible booking summary. Derive past slot eligibility using Hong Kong campus time, and continue using server busy intervals and decisions for availability. Show technical error identifiers only as secondary diagnostics when useful.
4. **Use MUI selectively for reports.** Use `@mui/x-charts` Community `BarChart` for daily registration actions and a horizontal bar chart for confirmed venue hours. Use Material UI tables for exact values and current participant counts. Keep series labels and units visible. Use the same report data for figures and tables. At narrow widths, reduce tick density and contain scrolling inside the table if needed. Keep empty results separate from errors and from populated series containing zero values.
5. **Review against representative data.** Use isolated fixtures for populated, empty, long-content, and restricted states. Do not treat fixture observations as evidence of successful live mutations. Repeat the key journeys with the real API when it is available.

## Risks / Trade-offs

- A menu adds an interaction on mobile. Keep high-frequency destinations easy to identify and keep the active section visible.
- A one-day view trades simultaneous comparison for readability. Preserve the week context and provide efficient day and week navigation.
- Chart packages add dependencies. Scope imports to reports, check the production build, and verify mobile labels using the longest realistic venue names and date ranges.
- Visual polish can conceal workflow problems. Verify behavior and accessibility alongside screenshots, including the approval/publication distinction and the registration recovery states.

## Verification

Review at 320, 390, 768, 1024, and 1440 CSS px. Capture discovery, event detail, venue selection and prefilled request, organizer, populated and empty admin queues, and populated and empty reports. Walk the navigation, slot selection, and forms by keyboard. Check long titles, 200% zoom, contrast, reduced motion if charts animate, and consistency between reports and their tables. Run the frontend build, lint, and existing tests. Record any cases waiting on real API integration.
