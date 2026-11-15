## ADDED Requirements

### Requirement: Campus tag list
The system SHALL keep a campus-wide list of tags (for example Sports, Arts, Academic, Free food), each with a stable lowercase slug and a display name. Only venue administrators SHALL create, rename or retire campus tags. A retired tag SHALL stay on existing events, but SHALL NOT be offered for new events.

#### Scenario: Student lists tags
- **WHEN** a signed-in user requests the campus tags
- **THEN** the active tags are returned sorted by display name

#### Scenario: Committee member creates a campus tag
- **WHEN** a committee member who is not a venue administrator creates a campus tag
- **THEN** the request returns 403 FORBIDDEN

### Requirement: Club tag vocabulary
Each club SHALL be able to keep up to 30 club tags of its own (1–24 characters, unique per club ignoring case). The club's committee and president SHALL manage them. Club tags SHALL describe events on that club's pages and in keyword search, but SHALL NOT appear as campus-wide filters.

#### Scenario: Duplicate club tag
- **WHEN** a committee member adds "Film" while the club already has "film"
- **THEN** the request returns 409 with a field error on `name`

### Requirement: Tagging events
An event SHALL carry 1–3 active campus tags and 0–5 of its own club's tags. Committee members and the president SHALL set them on create and edit, both in draft and after publication. Tag changes SHALL NOT be frozen by publication, and SHALL NOT notify participants.

#### Scenario: Event without a campus tag
- **WHEN** an event is created with no campus tag
- **THEN** the request returns 422 with a field error on `campus_tags`

#### Scenario: Another club's tag
- **WHEN** an event is tagged with a club tag that belongs to a different club
- **THEN** the request returns 422 and no tags change

### Requirement: Filter events by tag
`GET /events` SHALL accept repeated `tag` parameters with campus tag slugs and return events carrying any of them, combined with every other filter. Keyword search `q` SHALL also match campus and club tag names. Event and EventSummary responses SHALL include their campus and club tags.

#### Scenario: Filter by two tags
- **WHEN** a student filters by `tag=sports&tag=free-food` for this week
- **THEN** the list contains this week's visible events tagged Sports or Free food, sorted as usual

#### Scenario: Search a club tag
- **WHEN** a student searches "darkroom", which is only a club tag
- **THEN** events carrying that club tag are returned
