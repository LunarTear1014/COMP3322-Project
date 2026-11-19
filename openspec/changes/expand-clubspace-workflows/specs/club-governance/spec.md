## ADDED Requirements

### Requirement: Club president role
Each club SHALL have at most one member with the role `president`, alongside the roles `committee` and `member`. A president SHALL hold every committee permission for that club. An operator SHALL appoint a club's first president through the provisioning procedure; after that, roles change only through the president actions below.

#### Scenario: Second president rejected
- **WHEN** an operation would leave a club with two presidents
- **THEN** it fails with 409 INVALID_STATE and no role changes

#### Scenario: President acts as committee
- **WHEN** a president creates, edits or publishes an event of their club
- **THEN** the action is authorized exactly as for a committee member, without needing sign-off

### Requirement: President manages roles
Only the club's president SHALL appoint a member to committee, return a committee member to member, or transfer the presidency. A transfer SHALL atomically make the target the president and the previous president a committee member. A president SHALL NOT leave the club or be demoted without first transferring the presidency.

#### Scenario: Appoint a committee member
- **WHEN** the president promotes a current member to committee with the current membership version
- **THEN** the member's role becomes committee, an audit entry is written and the member is notified

#### Scenario: Committee member tries to promote
- **WHEN** a committee member who is not president changes another member's role
- **THEN** the request returns 403 FORBIDDEN and no role changes

#### Scenario: Transfer the presidency
- **WHEN** the president transfers the presidency to a committee member
- **THEN** in one transaction the target becomes president and the former president becomes committee, and both, plus the rest of the committee, are notified

#### Scenario: President tries to leave
- **WHEN** the president leaves the club without transferring the presidency
- **THEN** the request returns 409 PRESIDENT_TRANSFER_REQUIRED

### Requirement: Sign-off on venue requests

A venue request submitted by a committee member who is not the president SHALL create its booking in `awaiting_president`. Such a booking SHALL NOT reach venue administrators and SHALL NOT hold the venue. The president SHALL either send it on (it becomes `pending`) or return it with a reason (it becomes `returned`, which is terminal). Requests the president submits SHALL start as `pending`.

#### Scenario: Committee member requests a venue
- **WHEN** a committee member submits a valid event and slot
- **THEN** 201 returns a draft event with an `awaiting_president` booking, the president is notified, and venue administrators see nothing yet

#### Scenario: President sends the request on
- **WHEN** the president approves an `awaiting_president` booking with its current version
- **THEN** the booking becomes `pending`, venue administrators are notified, and the requester is told it was sent

#### Scenario: Stale sign-off
- **WHEN** the president signs off with an obsolete version
- **THEN** the request returns 409 STALE_VERSION and nothing changes

### Requirement: Sign-off on publication

A publish by a committee member who is not the president SHALL move the event to `awaiting_president`. The president SHALL publish it or return it to `draft` with a reason. A publish by the president SHALL take effect directly.

#### Scenario: President returns a publication
- **WHEN** the president returns an event awaiting publication, with a reason
- **THEN** the event goes back to `draft`, it stays invisible to students, and the requester sees the reason

### Requirement: President-only cancellation of published events
Only the club's president SHALL cancel a published event. Committee members SHALL be able to cancel their club's draft and awaiting events. The venue administrator's existing cancellation authority stays unchanged.

#### Scenario: Committee member cancels a published event
- **WHEN** a committee member who is not president cancels a published event
- **THEN** the request returns 403 FORBIDDEN and the event stays published

#### Scenario: President cancels a published event
- **WHEN** the president cancels a published event with a reason and the current version
- **THEN** the existing atomic cancellation runs, and participants and committee are notified

### Requirement: Member removal and committee step-down
The president SHALL be able to remove a plain member from the club at once. A committee member SHALL only be able to request the removal, which needs the president's sign-off, and the president SHALL be notified. Removal ends that student's upcoming members-only registrations (promoting waiters as usual) and closes their pending event requests. A committee member SHALL be able to step down to member themselves. Neither action SHALL apply to the president.

#### Scenario: Committee member requests a removal
- **WHEN** a committee member asks to remove a plain member
- **THEN** a pending removal request is created, the president is notified with Approve and Reject, the member stays in the club and is not told, and asking again returns the same request

#### Scenario: President rejects a removal request
- **WHEN** the president rejects a pending request with a reason
- **THEN** the member stays, the requesting committee member is notified with the reason, and the action is logged

#### Scenario: Requester withdraws
- **WHEN** the committee member who asked withdraws a pending request
- **THEN** the request is closed as withdrawn and the president's actionable notification is removed

#### Scenario: Remove a member with a members-only seat
- **WHEN** the president removes (or approves the removal of) a plain member who holds a seat at an upcoming members-only event
- **THEN** the membership is deleted, the seat is released to the first eligible waiter, and the removed student is notified

#### Scenario: Committee member steps down
- **WHEN** a committee member leaves the committee
- **THEN** their role becomes member with a new version, and the rest of the committee is notified

### Requirement: President's action log and undo
Role changes, presidency transfers, member removals, step-downs and join-request decisions SHALL be recorded in the club's action log, which only the president can read. The president SHALL be able to undo a recorded action once, only while no later action affects the same member and the state still matches.

#### Scenario: Undo blocked by a later action
- **WHEN** the president undoes a promotion that was followed by a demotion of the same member
- **THEN** the request returns 409 INVALID_STATE and nothing changes
