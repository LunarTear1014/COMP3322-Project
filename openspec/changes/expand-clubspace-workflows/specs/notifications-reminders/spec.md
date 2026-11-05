## ADDED Requirements

### Requirement: Transactional intent
Business changes SHALL commit notification jobs in the same transaction as their domain changes.

#### Scenario: Crash before delivery
- **WHEN** API commits a cancellation then the worker stops
- **THEN** the durable intent survives and is processed after restart

#### Scenario: Domain rollback
- **WHEN** booking transaction rolls back
- **THEN** no notification job for that uncommitted request remains

### Requirement: Retry and fencing
The worker SHALL use bounded retry and expiring token leases, acknowledge conditionally and deduplicate visible delivery per recipient/action.

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
