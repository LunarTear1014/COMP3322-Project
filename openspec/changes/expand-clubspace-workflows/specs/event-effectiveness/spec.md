## ADDED Requirements

### Requirement: Attendance check-in
For a published event, the club's committee or president SHALL be able to open check-in from 30 minutes before the start until 2 hours after the end. Opening check-in SHALL produce a 4-digit code. During that window a joined student SHALL be able to check in by entering the code, and committee members SHALL be able to mark or unmark joined students as attended. Only students joined at check-in time SHALL be checkable. A student SHALL have at most one attendance record per event.

#### Scenario: Student checks in with the code
- **WHEN** a joined student submits the correct code during the window
- **THEN** their attendance is recorded with method `code`, and repeating it returns the same record

#### Scenario: Wrong or guessed code
- **WHEN** a student submits wrong codes repeatedly
- **THEN** each attempt returns 422, and after 5 failures in 10 minutes the student receives 429 RATE_LIMITED

#### Scenario: Not joined
- **WHEN** a waitlisted or non-registered student submits the correct code
- **THEN** the request returns 409 INVALID_STATE and nothing is recorded

#### Scenario: Outside the window
- **WHEN** check-in is attempted more than 2 hours after the event ends
- **THEN** the request returns 409 INVALID_STATE

### Requirement: Event view tracking
The client SHALL report an event page view with its source (`explore`, `club`, `inbox`, `my_events`, `share` or `other`). The system SHALL store at most one view per user, event and 30-minute window, and keep raw views for 180 days. Reports SHALL show only aggregates, never which student viewed what.

#### Scenario: Reload within 30 minutes
- **WHEN** a student opens the same event twice within 30 minutes
- **THEN** one view is stored

#### Scenario: Opened from a notification
- **WHEN** a student opens an event from an inbox notification
- **THEN** the view is stored with source `inbox`

### Requirement: Per-event effectiveness metrics

The system SHALL give committee members and the president an effectiveness report for their club's events that started within a requested window of at most 93 days. Metrics SHALL come from participation history, attendance and views, not from current state alone. Per event it SHALL report fill, drop-out, turnout, waitlist-promotion and promotion-reach metrics as defined in `handoff/beta-feedback.md`. Turnout and no-shows SHALL be "not recorded" for events that never opened check-in.

#### Scenario: Turnout for an event without check-in
- **WHEN** an event in the window never opened check-in
- **THEN** its turnout and no-shows are "not recorded" and it is excluded from turnout averages

#### Scenario: Join, leave and rejoin before start
- **WHEN** a student joins, leaves and rejoins before the event starts
- **THEN** joined at start counts them once, and drop-outs do not count them

#### Scenario: Non-committee user requests the report
- **WHEN** a student who is not on the club's committee requests it
- **THEN** the request returns 403 FORBIDDEN

### Requirement: Effectiveness comparisons

The effectiveness report SHALL compare average fill rate and turnout by campus tag, weekday and time slot, labelling any group with fewer than 3 events as too few to compare.

#### Scenario: Small comparison group
- **WHEN** only two events in the window carry the Arts tag
- **THEN** the Arts row shows its counts and is labelled too few events to compare
