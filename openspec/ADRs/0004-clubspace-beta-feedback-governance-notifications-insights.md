# ADR 0004: Club governance, live notifications, tags and event effectiveness

Status: DRAFT; requires proposal review. Date: 2026-11-16. Changes: expand-clubspace-workflows (backend, `handoff/beta-feedback.md`), refresh-clubspace-visual-design (screens). Amends ADR 0001's role, notification and reporting decisions.

## Context

The beta interviews asked for: (1) an aesthetic update, already covered by ADR 0003; (2) instant notifications for every club-related action; (3) a difference between what the president and the committee can do; (4) event filters and club-added tags; and (5) a report on how effective events are, such as participation rate and promotion effect. ADR 0001 had no president, delivered notifications through a 5-second worker poll and a 30-second inbox poll, excluded WebSockets and attendance, and reported no turnout.

## Decisions

| Decision | Chosen approach and reason | Alternatives considered |
| --- | --- | --- |
| Club roles | Add `president` (one per club, enforced by a unique generated column). The president manages roles, transfers the presidency, signs off committee venue requests and publications, and alone cancels published events. Operators appoint only a club's first president. | Committee-equal president (rejected: the feedback asks for a difference); president approval of every edit (rejected: blocks routine text fixes). |
| Sign-off model | New states: booking `awaiting_president`, then `pending` or `returned`; event `awaiting_president`, then `published` or back to `draft`. Awaiting bookings never hold a venue or reach admins. The president's own actions skip sign-off. | A separate approvals table (rejected: duplicates state already on the rows); after-the-fact veto (rejected: students would see events that might be withdrawn). |
| Live delivery | Write immediate notifications in the source transaction. Push them over server-sent events from an API hub that tails the notifications table every second, with Last-Event-ID replay and 60-second polling as fallback. | WebSockets (rejected: two-way not needed, harder through the proxy); Redis pub/sub (rejected: new infrastructure for one VM); a faster worker poll (rejected: still not instant, and load grows with frequency). |
| Notification coverage | A notification matrix covers every club action. Committee members get joins, leaves and membership changes as one 09:00 Hong Kong daily digest per club. Actors are never notified of their own action, except confirmation of their own registration. | Notify every join and leave (rejected by the product owner: too noisy). |
| Tags | Admins keep a shared campus tag list (1–3 per event) for campus-wide filters. Clubs keep up to 30 of their own tags (0–5 per event) for description and search. Tags stay editable after publication. | Free-form tags only (rejected: duplicates break filtering); a single fixed category (rejected: too coarse). |
| Turnout | Add check-in: committee opens a window from 30 minutes before start to 2 hours after end, with a 4-digit code (rate-limited) or committee marking. Turnout is reported only where check-in happened. | Fill rate only (rejected: can't show who came); QR or location check-in (rejected: more scope and privacy cost). |
| Promotion effect | Track event views with source, de-duplicated per 30 minutes, kept 180 days and reported only in aggregate. The report shows view-to-join conversion, joins in the 24 hours after publication, waitlist promotion counts, speed and attendance, and comparisons by tag, weekday and slot, with groups under 3 events flagged. | No view tracking (rejected: announcement impact can't be measured otherwise). |

## Consequences

The schema gains a membership role and version, sign-off columns and states, four tag tables, attendance and views tables, and digest bookkeeping (migrations 010–014). The API gains the governance, tag, check-in, view, stream and effectiveness endpoints. The proxy must allow long-lived SSE responses. Committee venue requests take an extra step whenever the president is slow, which the sign-off queue and immediate notification mitigate. View tracking is new personal data, limited by aggregation and retention. The activity report from ADR 0001 is unchanged and still makes no attendance claim; turnout lives only in the effectiveness report.
