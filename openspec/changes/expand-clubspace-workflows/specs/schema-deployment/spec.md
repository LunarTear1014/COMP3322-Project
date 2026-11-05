## ADDED Requirements

### Requirement: Non destructive upgrades
Migrations SHALL preserve existing IDs/statuses/memberships and validate legacy timezone/integrity before stronger constraints.

#### Scenario: Existing Alpha upgrade
- **WHEN** a valid populated Alpha copy is migrated
- **THEN** IDs and existing confirmed/published states remain, with no invented admin actor

#### Scenario: Ambiguous timestamps
- **WHEN** operator has not declared legacy DATETIME timezone
- **THEN** UTC backfill is refused instead of guessing

### Requirement: Repeatability and constraints
Migrations SHALL use checksums/version tracking and handle partial DDL explicitly; fresh setup SHALL not index nonexistent users.role.

#### Scenario: Fresh schema
- **WHEN** clean setup executes schema and migrations
- **THEN** all statements succeed with the actual platform_role field

#### Scenario: Repeated upgrade
- **WHEN** a completed migration is rerun
- **THEN** it is verified/skipped and timestamps are not converted twice

### Requirement: Production process contract
Linux Docker Compose SHALL run matching frontend/API/worker/MySQL versions with persistent data, secure session config and observable worker health.

#### Scenario: App restart
- **WHEN** API and worker restart with preserved DB volume
- **THEN** registrations/sessions/jobs remain durable

#### Scenario: Missing secret
- **WHEN** production starts without SESSION_SECRET or APP_ORIGIN
- **THEN** startup fails with a safe config error

### Requirement: Verification gate
Release SHALL require real MySQL concurrency/migration tests and production-like E2E evidence, not OpenSpec structural validation alone.

#### Scenario: Documentation complete
- **WHEN** OpenSpec validation succeeds before code implementation
- **THEN** implementation tasks remain unchecked and release is not represented as verified

#### Scenario: Failed race gate
- **WHEN** a final-seat or competing-approval test fails
- **THEN** release/merge acceptance is blocked until fixed
