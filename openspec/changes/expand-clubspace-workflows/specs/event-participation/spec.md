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

### Requirement: Organizers see who joined or quit
The system SHALL let the club committee and president of an event's club list its participants with each person's current club role (member, committee, president or none) and read a newest-first history of who joined, quit, were promoted from the waitlist or were cancelled, with whole-event totals. Other users, including venue administrators, SHALL NOT see it.

#### Scenario: Join, quit and rejoin
- **WHEN** a student joins, withdraws and joins again
- **THEN** the committee's history shows three entries newest first, and the summary counts one person joined, one quit and one rejoined

#### Scenario: Promotion and filtering
- **WHEN** a waitlisted student is promoted and the committee filters the history by `promoted` or `quit`
- **THEN** only entries of that action are returned while the summary still covers the whole event

#### Scenario: Not an organizer
- **WHEN** a plain member, a student or a venue administrator requests the participation history
- **THEN** 403 is returned

### Requirement: Members-only registration approval
A plain member registering for a members-only event SHALL create a pending join request that allocates no seat or waitlist place. Committee members and the president of the event's club SHALL register directly, and public events SHALL stay automatic. The committee SHALL accept or reject each request; accepting SHALL apply the current capacity and waitlist rules with the student's own `allow_waitlist` choice.

#### Scenario: Member requests a members-only event
- **WHEN** a plain member registers for a published members-only event before the deadline
- **THEN** 202 returns status `requested`, the committee and president are notified, and joined and waitlisted counts are unchanged

#### Scenario: Accept into a full event
- **WHEN** the committee accepts a request for a full event whose student did not allow the waitlist
- **THEN** 409 EVENT_FULL is returned and the request stays pending

#### Scenario: Requests close with the event
- **WHEN** an event with pending requests is cancelled, or a requester leaves the club or withdraws
- **THEN** each pending request is closed and none can be accepted afterwards
