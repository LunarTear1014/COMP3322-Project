# COMP3322 Group Project Proposal

**Status: Proposed revision for team and instructor review.** The expanded workflows below describe the intended scope. The implementation and verification status is summarized in Section 10.

## 1. Team Members

| Member | Student Number |
| --- | --- |
| Chan Ka Ho Charlie | 3035927104 |
| Lucien Balthazar Neale | 3036720486 |
| Chan Ka Hei Aubrey | 3036388381 |

## 2. Project Title

**ClubSpace — University Club Event & Venue Management Platform**

## 3. Project Description

ClubSpace is a web application for coordinating university club events, venue requests, and student participation. Club committee members prepare events and request suitable venues. Venue administrators review requests and prevent conflicting confirmed bookings. Once a request is approved, the organizer can publish the event. Students can discover events, register if eligible, and join a waitlist when an event is full.

The intended users are **students**, **club committee members**, and **venue administrators**. A student may belong to multiple clubs. Committee permissions apply within the relevant club, while venue administrators review requests across clubs subject to the conflict-of-interest rule below.

## 4. Proposed Feature List

### Must-have

- **Accounts, profiles, and club membership**
  - Register, sign in, sign out, and update a persistent profile.
  - Join and leave multiple clubs, with club-specific committee permissions. Explain when an active members-only registration prevents leaving.
  - Enforce authorization and validation on the server.
- **Venue requests and approval**
  - Browse venue information and availability in a weekly calendar using the three campus timeslots.
  - Create a pending venue request and event draft together. A pending request does not reserve the venue.
  - Allow a venue administrator to approve or reject a request with an appropriate reason. Recheck overlaps when approving, and prevent an administrator from deciding a request for their own committee club.
- **Event management**
  - Publish an event separately after venue approval, and allow authorized organizers to edit or cancel it.
  - Support public and club-members-only events, participant lists, and a new request when rescheduling.
  - Cancel the associated booking and active participation together when an event is cancelled.
- **Discovery and participation**
  - Browse upcoming and past published events and filter by club, venue, visibility, and date.
  - Register or withdraw subject to eligibility, deadlines, and capacity. Prevent duplicate current registrations.
  - Offer a first-in, first-out waitlist and promote the next eligible student when a place becomes available.
- **Notifications and reminders**
  - Deliver persistent in-app notifications for relevant workflow changes and scheduled event reminders through a background worker.
  - Preserve notification requests with the related business change and support retries and duplicate prevention.
- **Calendar and organizer reports**
  - Show confirmed venue availability in a responsive weekly calendar. Private bookings expose a busy interval without unnecessary event details.
  - Show registration counts, registration action trends, and booked venue hours with charts and equivalent data tables. Registration actions are not attendance.
- **Reliability and deployment**
  - Use a layered API with separate SQL query modules, persistent sessions, data-preserving database migrations, and consistent errors.
  - Test concurrent booking decisions and registration for the last place, worker recovery, and deployment on a Linux VM with Docker Compose.

### Proposed bonus

- **Google sign-in.** Subject to agreement on the core scope and a separate specification, use Google Identity Services alongside email/password login. Verify the Google identity on the backend, collect the student ID during onboarding, and use the same local session and authorization rules. Existing users must prove access to their account before linking it.

### Future possibilities

QR attendance, email delivery, event reviews, poster uploads, payments, recurring events, equipment reservations, and live push notifications.

## 5. Technology Stack

| Area | Technology |
| --- | --- |
| Frontend | React and Vite |
| Backend | Node.js and Express |
| API | RESTful API, with a proposed `/api/v1` contract |
| Database | MySQL |
| Background processing | Notification and reminder worker |
| Deployment | Linux VM and Docker Compose |
| Version control | Git and GitHub |
| Authentication | Session-based authentication; Google sign-in is a proposed bonus |

## 6. Preliminary Team Task Allocation

| Member | Primary Responsibilities |
| --- | --- |
| **Chan Ka Ho Charlie** | Backend/API, authentication, authorization, and event business logic |
| **Lucien Balthazar Neale** | React frontend, UI components, pages, event browsing, and participation |
| **Chan Ka Hei Aubrey** | MySQL database design, venue/booking logic, and Docker deployment |

All members will participate in integration, testing, debugging, documentation, and code review. Detailed assignments and the expanded scope remain subject to team agreement.

## 7. Problem & Target User Context

University clubs need to coordinate venue availability, event information, and student participation. When these activities are managed separately, organizers can face conflicting bookings and students may struggle to find relevant events or know their registration status.

ClubSpace brings these activities into one browser-based application. It gives students a place to discover eligible events, organizers a way to manage their events, and venue administrators a review process for requests.

## 8. High-level Workflow

### Club committee member

1. Sign in, choose a venue and future campus timeslot, and submit an event draft with a venue request.
2. Review the request status and any rejection reason. For a different time or venue, start a new request.
3. After approval, publish the event separately.
4. Manage event details and participants, or cancel the event when necessary.

### Venue administrator

1. Review pending requests and their event and venue details.
2. Approve or reject an eligible request. The system rechecks availability before approval and records the decision.
3. Leave publication to the organizer after approval.

### Student

1. Sign in and browse or filter events.
2. Open an event to review its details, eligibility, and availability.
3. Register or join the waitlist, and view the resulting status under personal registrations.
4. Withdraw when needed and receive relevant in-app notifications and reminders.

## 9. Anticipated Learning Challenges & Self-assessment

- **Full-stack integration.** Connect React, Express, MySQL, and the worker through agreed API contracts. Build and test the first complete journey from sign-in and venue request through approval, publication, and registration.
- **Authentication and authorization.** Implement persistent sessions and test student, committee, and venue-administrator permissions, including club boundaries and session security.
- **Transactions and concurrency.** Design locking and transactions for conflicting approvals, final-seat registration, waitlist promotion, and cancellation. Reproduce races using independent MySQL connections.
- **Asynchronous processing and data.** Preserve existing data during migrations and test worker retries, duplicate prevention, interruption, and restart recovery.
- **Usable visualization and team integration.** Make the calendar and reports readable on mobile and desktop, provide accessible table alternatives, and verify real data against the documented contract.

## 10. Implementation and Review Status

The current beta provides a React frontend and an Express backend with account, club, event, venue, participation, and notification workflows. The frontend also has a read-only fixture preview for planned v1 screens. The current backend uses unversioned routes and in-memory sessions, and its booking flow combines booking and publication.

Separate venue approval and publication, the planned v1 API, durable sessions and worker, migrations, and organizer reports require further implementation and integration. Fixture previews do not establish persistence, authorization, or successful live transactions. The team will verify the complete journey and deployment with real services before presenting these capabilities as completed.

The expanded scope and Google sign-in bonus require team and instructor review. OpenSpec documents under `openspec/changes/` provide the proposed behavior, technical contracts, and verification checklist.
