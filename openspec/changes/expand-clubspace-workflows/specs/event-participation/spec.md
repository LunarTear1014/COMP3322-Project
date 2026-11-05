## ADDED Requirements

### Requirement: Authoritative eligibility
The system SHALL persist participation only for published confirmed events before deadline/start and enforce current members-only membership.

#### Scenario: Deadline boundary
- **WHEN** registration occurs at exactly registration_closes_at
- **THEN** 409 REGISTRATION_CLOSED is returned

#### Scenario: Nonmember registration
- **WHEN** a nonmember requests a known published members-only event
- **THEN** 409 MEMBERSHIP_REQUIRED is returned

### Requirement: Capacity under concurrency
The system SHALL serialize admission and keep joined count at or below capacity, with at most one row per user/event.

#### Scenario: Final seat race
- **WHEN** two distinct students request the final seat simultaneously
- **THEN** one joins and the other waits or receives full, never overbooking

#### Scenario: Duplicate request
- **WHEN** a joined or waitlisted student repeats registration
- **THEN** 200 returns original state/queue order with no duplicate history

### Requirement: FIFO waitlist
The system SHALL cap waiting at500, order waiters by queued_at then user_id and give existing eligible waiters priority over new arrivals.

#### Scenario: Withdrawal promotion
- **WHEN** a confirmed student withdraws while registration is open
- **THEN** the earliest eligible waiter receives the vacancy and promotion history/job

#### Scenario: Rejoin loses old priority
- **WHEN** a waiting student withdraws and rejoins a full event
- **THEN** the student receives a new queue time at the tail

#### Scenario: Ineligible repaired legacy row
- **WHEN** the first waiter is no longer eligible due to operator/migration repair
- **THEN** that row becomes left and the next eligible waiter is considered

### Requirement: Withdrawal and cancellation
Withdrawal SHALL be idempotent for absent/left states, permit withdrawal until start and suppress promotion after deadline or cancellation.

#### Scenario: Vacancy after deadline
- **WHEN** a joined student withdraws after deadline but before start
- **THEN** the student becomes left and no waiter is promoted

#### Scenario: Cancellation race
- **WHEN** registration or withdrawal races with event cancellation
- **THEN** the final cancelled event has no joined or waitlisted participant

### Requirement: Private participants and history
The system SHALL restrict participant identities to club committee and append history for actual state transitions without inventing pre-migration history.

#### Scenario: History after repeat join
- **WHEN** an active registration POST is repeated
- **THEN** current row is unchanged and no extra historical action appears

#### Scenario: Persisted state
- **WHEN** a student reloads or logs in on another browser
- **THEN** their actual database registration is returned
