## ADDED Requirements

### Requirement: Session accounts
The system SHALL register only student-role accounts, persist sessions in MySQL, regenerate session identity on login and invalidate it on logout.

#### Scenario: Public registration rejects privilege escalation
- **WHEN** a registration includes platform_role or committee rights
- **THEN** the request is rejected with422 and no privileged account is created

#### Scenario: Session survives API restart
- **WHEN** a logged-in user requests their session after API restart within idle expiry
- **THEN** the same authenticated identity is returned from persisted session storage

#### Scenario: Logout invalidates identity
- **WHEN** a user logs out and reuses the old cookie
- **THEN** a protected request receives401

### Requirement: Mutation protection
Every browser mutation SHALL validate configured Origin and a session-bound CSRF token, including login and registration.

#### Scenario: Forged mutation
- **WHEN** a mutation has an absent or invalid CSRF token
- **THEN** the system returns403 without business writes

#### Scenario: Login rotation
- **WHEN** a valid anonymous session logs in
- **THEN** the session ID and CSRF token change and the response returns the replacement token

### Requirement: Club scoped authority
The system SHALL derive committee and president permissions from current membership in the target club, and venue administration from a separate global role. A president holds all committee permissions for their club, plus the president-only actions in `club-governance`.

#### Scenario: Other club management
- **WHEN** committee of club A attempts to manage a published event of club B
- **THEN** the request returns403 and no event changes

#### Scenario: Admin is not committee
- **WHEN** a venue admin without target club committee membership requests its participant list
- **THEN** the request returns403

### Requirement: Persistent membership lifecycle
The system SHALL persist club membership through committee-approved join requests and idempotent leave, allow role changes only by an operator or the club's president, and serialize eligibility-sensitive membership writes with registrations.

#### Scenario: Repeated join
- **WHEN** a committee member or president joins the same club again
- **THEN** the original role is returned without downgrade

#### Scenario: Club membership request
- **WHEN** a nonmember asks to join a club
- **THEN** 202 returns one pending join request, the committee and president are notified immediately, and the student is not a member until a committee member accepts it

#### Scenario: Self-appointment
- **WHEN** a member sends a request that would raise their own role
- **THEN** the request returns 403 FORBIDDEN and the role is unchanged

#### Scenario: Member leave with protected registration
- **WHEN** a member with upcoming members-only active participation leaves that club
- **THEN** the system returns409 ACTIVE_MEMBER_REGISTRATIONS

#### Scenario: Concurrent leave and join
- **WHEN** club leave and members-only registration execute concurrently
- **THEN** they cannot both commit a state containing active registration by a nonmember

### Requirement: Profile and credentials
The system SHALL expose only the current user profile, hash passwords using the specified asynchronous policy, and throttle authentication.

#### Scenario: Credential privacy
- **WHEN** a user reads session or profile data
- **THEN** password hashes and session IDs are absent

#### Scenario: Legacy placeholder
- **WHEN** login is attempted using a seeded placeholder hash
- **THEN** the result is generic401 rather than authentication or server failure

### Requirement: Club membership requests
The committee and president of a club SHALL list its pending join requests and accept or reject each one exactly once. Accepting SHALL create a `member` membership; rejecting SHALL leave the student a nonmember. The requester SHALL be notified of the decision. A nonmember's leave SHALL withdraw their pending request. Joins counted in the daily digest SHALL be accepted requests.

#### Scenario: Concurrent review
- **WHEN** two committee members decide the same pending request at once
- **THEN** exactly one decision succeeds and the other returns 409 INVALID_STATE

#### Scenario: Member reviews a request
- **WHEN** a plain member of the club lists or decides its join requests
- **THEN** the request returns 403 FORBIDDEN and nothing changes
