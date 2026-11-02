## ADDED Requirements

### Requirement: Atomic pending creation
The system SHALL atomically create one pending booking and linked draft event for an authorized committee request and record notification intent.

#### Scenario: Initial request
- **WHEN** committee submits valid event/slot data
- **THEN** 201 returns pending booking and draft event, with no public event publication

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
The system SHALL publish only a confirmed draft with future start/deadline, freeze published scheduling/eligibility fields and version metadata edits.

#### Scenario: Approval alone
- **WHEN** a pending request is approved
- **THEN** the event remains private draft until explicit publication

#### Scenario: Frozen published capacity
- **WHEN** committee changes published capacity
- **THEN** the request returns409 PUBLISHED_FIELDS_FROZEN

### Requirement: Cancellation consistency
The system SHALL cancel an event and related active participation atomically, release pending/confirmed bookings and never promote during cancellation.

#### Scenario: Cancel full event
- **WHEN** committee cancels a published event with joined and waiting students
- **THEN** event and active participations become cancelled, booking releases, cancellation intent persists and no student is promoted

#### Scenario: Repeat cancellation
- **WHEN** an already-cancelled event is cancelled with an old version
- **THEN** 200 current state is returned without duplicate history/jobs
