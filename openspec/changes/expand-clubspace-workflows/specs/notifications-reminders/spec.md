## ADDED Requirements

### Requirement: Transactional intent
Business changes SHALL write their immediate notifications in the same transaction as their domain changes, and SHALL commit jobs for scheduled work (reminders and digests) in the same transaction.

#### Scenario: Crash before delivery
- **WHEN** the API commits a cancellation and then the process stops
- **THEN** the cancellation notifications already exist in recipients' inboxes, and any scheduled job survives and is processed after restart

#### Scenario: Domain rollback
- **WHEN** a booking transaction rolls back
- **THEN** no notification or job for that uncommitted request remains

### Requirement: Live delivery

A signed-in user with ClubSpace open SHALL receive each new notification within 2 seconds of the transaction that created it committing, through the server-sent events stream `GET /api/v1/notifications/stream`. The stream SHALL carry only the user's own notifications and their unread count.

#### Scenario: Notification while the inbox is closed
- **WHEN** a student is on Explore and their waitlist promotion commits
- **THEN** within 2 seconds the Inbox badge increments and a toast shows the promotion

#### Scenario: Another user's events
- **WHEN** two users are connected
- **THEN** neither stream ever carries the other user's notifications

### Requirement: Stream recovery

The notification stream SHALL resume from `Last-Event-ID` without gaps or duplicates after a reconnect, and SHALL send a heartbeat at least every 25 seconds. When the stream is unavailable, the client SHALL fall back to polling every 60 seconds.

#### Scenario: Reconnect after losing connection
- **WHEN** a client reconnects with the last event ID it received
- **THEN** it receives every notification created since then exactly once

### Requirement: Club action coverage
Every club-related action SHALL notify the people it affects, as listed in the notification matrix in `handoff/beta-feedback.md`. That covers sign-off requests and outcomes, booking requests and decisions, publication to club members, event changes, cancellations, registration and waitlist outcomes, role changes, and reminders. A user SHALL never be notified about their own action, apart from confirmation of the outcome of their own registration.

#### Scenario: Club publishes an event
- **WHEN** a club publishes an event
- **THEN** every member of that club except the actor receives a "new event" notification linking to it

#### Scenario: Role change
- **WHEN** the president appoints a member to committee
- **THEN** the appointed member and the other committee members are notified, and the president is not

### Requirement: Daily activity digest
Student joins and leaves on a club's events, and members joining or leaving the club, SHALL NOT notify committee members one by one. They SHALL be summarized in one digest per club per Hong Kong day, sent at 09:00 Hong Kong time for the previous day, to the committee and president. A club with no such activity SHALL receive no digest.

#### Scenario: Busy day
- **WHEN** 12 students join and 2 leave one event and 3 members join the club on Monday
- **THEN** at 09:00 on Tuesday each committee member and the president receive one digest with those counts per event and for the club

#### Scenario: Worker down at 09:00
- **WHEN** the worker restarts at 11:00
- **THEN** the overdue digest is sent once, and never twice for the same club and day

### Requirement: Retry and fencing
The worker SHALL use bounded retry and expiring token leases for scheduled jobs, acknowledge conditionally and deduplicate visible delivery per recipient/action.

#### Scenario: Replay after partial processing
- **WHEN** a job is delivered twice after a crash
- **THEN** only one notification per recipient/deduplication key exists

#### Scenario: Expired worker token
- **WHEN** an old worker finishes after another worker reclaimed its lease
- **THEN** conditional acknowledgement fails and old delivery transaction rolls back

#### Scenario: Repeated failure
- **WHEN** delivery fails five attempts
- **THEN** job becomes failed with a sanitized diagnostic for operator review

### Requirement: Reminder eligibility
The worker SHALL send at most one in-app reminder per event/user within24h before start and recheck current joined status and event lifecycle.

#### Scenario: Scanner and promotion race
- **WHEN** scanner and late promotion both enqueue reminders for one student
- **THEN** at most one visible reminder is stored

#### Scenario: Cancelled before dispatch
- **WHEN** a due reminder is processed after event cancellation
- **THEN** no reminder is created

#### Scenario: Restart catch up
- **WHEN** worker resumes after downtime
- **THEN** future eligible events catch up while started events are skipped

### Requirement: Inbox ownership
The system SHALL list/mark only the current user notifications and preserve first read_at on repeated updates.

#### Scenario: Foreign inbox object
- **WHEN** user updates another user notification
- **THEN** 404 is returned without modifying it

#### Scenario: Historic action message
- **WHEN** a historical registration notification is opened after cancellation
- **THEN** the UI fetches and shows current event state rather than granting access from the message
