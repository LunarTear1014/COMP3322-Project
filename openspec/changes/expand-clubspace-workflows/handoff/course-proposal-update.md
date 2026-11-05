# Suggested coursework proposal amendment

Draft for team/instructor review. Do not overwrite proposal/Proposal.md until agreed.

## Revised description

ClubSpace coordinates university club events from venue request through approval, publication and student registration. Committee members submit venue requests, venue administrators resolve competing requests, and students register for eligible events or join capacity-limited waitlists. Durable notifications and reminders communicate workflow changes; a weekly calendar and organizer reports summarize bookings and participation.

## Proposed must-have scope

1. Complete current account, membership, scoped authorization and persistent participation commitments.
2. Pending/approved/rejected/cancelled venue requests with reasons and no self-approval.
3. Separate event publication and atomic cancellation.
4. Capacity, fair FIFO waitlists, automatic promotion and concurrent-request protection.
5. Persistent in-app notifications and scheduled reminders through a background worker.
6. Responsive weekly availability calendar and organizer registration/venue-use reports.
7. Layered API with separate query modules, data-preserving migrations and verified production deployment.

## Nice-to-have / future proposals

QR attendance, OAuth, email delivery, reviews, poster uploads, payments, recurring events, equipment allocation and live push. Do not begin these while proposed core is incomplete.

## Complexity rationale

| Guideline example | Demonstrable work |
| --- | --- |
| Database complexity | Related lifecycle records, history, sessions, jobs and constraints |
| Asynchronous processing | Durable notifications, reminders, retry and restart recovery |
| Visualization | Venue calendar and registration/booked-hours reports |
| Business logic | Approval/publication separation, eligibility, capacity and FIFO promotion |
| UI/UX | Distinct student/committee/admin journeys and recoverable error states |

## Learning challenges and evidence

Transaction/locking design: reproduce final-seat and competing-approval races against real MySQL. Background delivery: test crashes and duplicate jobs. Team integration: contract-first API examples, schema review and shared E2E demo. Allocate responsibilities jointly, keeping database/backend dependencies ahead of frontend integration.

The local guideline gives no mandatory work-hour minimum and instructor retains complexity judgment. It lists Beta November6 and presentations November20/23/27; verify current Moodle notices and agree a feasible revised scope. Do not describe draft plans as completed features or promise an assessment result.
