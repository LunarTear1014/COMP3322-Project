## ADDED Requirements

### Requirement: Versioned wire contract
The API SHALL use /api/v1 for business endpoints, structured envelopes and machine-readable enums, retaining health. The unversioned legacy `/api/...` routes SHALL stay mounted alongside `/api/v1` until a coordinated cutover; new features SHALL be available only under `/api/v1`.

#### Scenario: Legacy client before cutover
- **WHEN** a client calls a legacy `/api/...` URL while legacy routes are still mounted
- **THEN** it keeps its legacy behaviour and legacy envelope, and none of the new v1 features are reachable through it

#### Scenario: Invalid fields
- **WHEN** a mutation contains an undeclared property
- **THEN** 422 VALIDATION_FAILED includes a field error

### Requirement: Server backed frontend state
The React SPA SHALL replace hardcoded membership/registration/profile fallbacks with authoritative API state.

#### Scenario: Database unavailable
- **WHEN** profile or event fetch fails
- **THEN** an error/retry state appears rather than fabricated successful demo data

### Requirement: Role journeys and conflict recovery
The SPA SHALL expose separate student/committee/admin flows and recover from stale metadata without silently replaying mutations.

#### Scenario: Approval UI
- **WHEN** admin approves a request
- **THEN** organizer sees confirmed booking with a separate publish action

#### Scenario: Stale edit
- **WHEN** save returns409 STALE_VERSION
- **THEN** unsaved input is preserved and user is offered a refresh

### Requirement: Calendar and accessible reporting
The SPA SHALL display campus-time calendar/reporting and responsive keyboard-usable alternatives with labels beyond color.

#### Scenario: Keyboard use
- **WHEN** a keyboard-only user selects an available slot
- **THEN** a labelled booking form is reachable without a pointer

#### Scenario: Chart alternative
- **WHEN** a user cannot interpret the chart
- **THEN** equivalent counts/table and metric definitions remain available
