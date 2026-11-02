## ADDED Requirements

### Requirement: UTC overlap calendar
The system SHALL return confirmed overlapping intervals using UTC instants and campus-time display, excluding pending requests from busy blocks.

#### Scenario: Week boundary
- **WHEN** a Hong Kong week is requested from a browser in another timezone
- **THEN** the same UTC bounds and campus dates are used

#### Scenario: Legacy spanning interval
- **WHEN** a confirmed legacy booking crosses midnight
- **THEN** all overlapping requested slots are unavailable

### Requirement: Private draft protection
The calendar SHALL expose only anonymous busy boundaries for confirmed private drafts and published event metadata to authenticated users.

#### Scenario: Private draft block
- **WHEN** an unrelated signed-in student reads calendar with a confirmed draft
- **THEN** time/venue are busy but event_id/title/club_id are null

### Requirement: Defined reporting metrics
The system SHALL restrict club reports to committee, separate current counts from historical actions, clip booked hours and disclose history cutoff.

#### Scenario: Repeated participation actions
- **WHEN** a student joins, leaves and rejoins
- **THEN** history reports two joins while current joined count remains one

#### Scenario: Partial window
- **WHEN** a confirmed booking overlaps only part of report window
- **THEN** only clipped duration contributes booked hours

#### Scenario: Unavailable attendance
- **WHEN** no attendance collection exists
- **THEN** reports contain no attendance/no-show metric

### Requirement: Bounded queries
Calendar/report APIs SHALL validate half-open ranges and bound them to31/93 days with deterministic output.

#### Scenario: Oversized calendar
- **WHEN** a range exceeds31days
- **THEN** 422 is returned before an unbounded query

#### Scenario: Empty report day
- **WHEN** an in-range Hong Kong day has no actions
- **THEN** the daily series includes zero values
