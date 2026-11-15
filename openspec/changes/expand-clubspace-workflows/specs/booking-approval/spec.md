## ADDED Requirements

### Requirement: Atomic pending creation
The system SHALL atomically create one booking and linked draft event for an authorized committee or president request, and record its notifications. The booking SHALL start as `pending` when the president submits it and as `awaiting_president` when another committee member does (see `club-governance`).

#### Scenario: Initial request
- **WHEN** the president submits valid event/slot data
- **THEN** 201 returns a pending booking and a draft event, with no public event publication

#### Scenario: Request needing sign-off
- **WHEN** a committee member who is not president submits valid event/slot data
- **THEN** 201 returns an `awaiting_president` booking and a draft event, and the booking is excluded from the admin queue and from calendar busy blocks

#### Scenario: Creation fails halfway
- **WHEN** event insertion fails after booking insertion
- **THEN** booking, event, audit and job changes all roll back

### Requirement: Conflicting request decisions
Pending requests SHALL not reserve a venue; approval SHALL serialize on its venue and reject confirmed overlaps.

#### Scenario: Empty venue race
- **WHEN** two conflicting pending requests for an otherwise empty venue are approved concurrently
- **THEN** only one confirms and the other receives409 while remaining pending

#### Scenario: Adjacent intervals
- **WHEN** one confirmed booking ends at the requested start
- **THEN** the intervals do not conflict

### Requirement: Independent administrator decision
The system SHALL restrict decisions to venue admins not committee of the requesting club, require reject reasons and enforce optimistic versions.

#### Scenario: Self decision
- **WHEN** an admin is committee of the requesting club
- **THEN** approve or reject returns403 SELF_DECISION_FORBIDDEN

#### Scenario: Stale review
- **WHEN** a decision includes an obsolete booking version
- **THEN** the system returns409 STALE_VERSION without another decision

### Requirement: Publication and edit rules
The system SHALL publish only a confirmed draft with future start/deadline, published either by the president or through the president's sign-off on a committee publish. It SHALL freeze published scheduling/eligibility fields and version metadata edits.

#### Scenario: Approval alone
- **WHEN** a pending request is approved
- **THEN** the event remains private draft until explicit publication

#### Scenario: Frozen published capacity
- **WHEN** committee changes published capacity
- **THEN** the request returns409 PUBLISHED_FIELDS_FROZEN

### Requirement: Cancellation consistency
The system SHALL cancel an event and related active participation atomically, release awaiting, pending and confirmed bookings, and never promote during cancellation. Cancelling a published event SHALL be limited to the club's president and venue administrators.

#### Scenario: Cancel full event
- **WHEN** the president cancels a published event with joined and waiting students
- **THEN** event and active participations become cancelled, booking releases, cancellation intent persists and no student is promoted

#### Scenario: Repeat cancellation
- **WHEN** an already-cancelled event is cancelled with an old version
- **THEN** 200 current state is returned without duplicate history/jobs
