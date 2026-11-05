## 1. Baseline and shared design

- [x] 1.1 Capture the current key journeys at desktop and phone widths. Add isolated fixtures for populated reports and approval queues, empty results, restricted states, and long titles.
- [x] 1.2 Define visual tokens and reusable page headings, action hierarchy, status labels, and loading, empty, and error patterns. Check normal and large text contrast.
- [x] 1.3 Replace the clipped mobile navigation with a visible role-aware menu, current section, and account actions. Verify keyboard operation, focus return, and 320 px reflow.
- [x] 1.4 Prioritize sign-in and account creation forms on narrow screens. Keep preview-only instructions compact and distinct.

## 2. Student and venue journeys

- [x] 2.1 Improve event cards and filters, make event links identifiable, and simplify single-page pagination.
- [x] 2.2 Group event details and place eligibility, deadline, and join or leave actions together. Verify available, full, waitlisted, closed, cancelled, and failed-action states.
- [x] 2.3 Improve venue card readability. Build a desktop week overview and narrow day view with named slot controls, explicit busy and past states, and preserved campus week context.
- [x] 2.4 Carry venue, date, and time into a booking summary. Group the request fields and validate the form layout, error placement, and preservation of input.

## 3. Organizer, admin, and secondary pages

- [x] 3.1 Promote the organizer's request action. Separate event and booking states, clarify reports access, and organize editing and cancellation by purpose.
- [x] 3.2 Design the booking review queue for populated and empty states. Verify pending count, labels, decision reason, conflicts, and the distinction between approval and publication.
- [x] 3.3 Bring profile, memberships, registrations, and notifications onto shared patterns. Add next steps to relevant empty states and distinguish an empty inbox from no unread notifications.

## 4. Reports

- [x] 4.1 Add only the free Material UI and MUI X Charts Community dependencies needed by reporting and apply the shared visual tokens.
- [x] 4.2 Add club and period context, a concise summary, labelled daily action and horizontal venue-hours charts, exact-value tables, and a current participant table.
- [x] 4.3 Verify values, units, series labels, history cutoff, long labels, empty data, recorded zeros, and failed fetches. Check chart and table usability on mobile and without pointer hover.

## 5. Acceptance

- [x] 5.1 Review screenshots at 320, 390, 768, 1024, and 1440 CSS px. Check 200% zoom, keyboard focus, contrast, and chart reduced-motion behavior if applicable.
- [x] 5.2 Run frontend build, lint, and tests. Exercise event discovery through details, venue selection through request, organizer and admin review, and report filtering. Record fixture and real API verification separately. Fixture acceptance completed; real API verification is deferred until the v1 provider is available and remains a release dependency in frontend-alpha/INTEGRATION.md.
