## ADDED Requirements

### Requirement: Responsive and accessible application navigation

ClubSpace SHALL provide clearly labelled primary navigation, active section identification, visible keyboard focus, and a layout that reflows to 320 CSS px without page-wide horizontal scrolling.

#### Scenario: Reach a role-specific page from a phone
- **WHEN** a signed-in organizer or venue administrator uses ClubSpace at 320 or 390 CSS px
- **THEN** a visible navigation control exposes all destinations permitted for their role
- **AND** the current section is identifiable without relying on color
- **AND** the control can be opened, navigated, and dismissed with the keyboard without losing focus

#### Scenario: Open an account form on a phone
- **WHEN** a guest opens sign-in or account creation on a narrow viewport
- **THEN** the form heading and fields precede supplementary campus copy
- **AND** local preview credentials are identifiable as sample credentials without obstructing the form

### Requirement: Consistent task hierarchy and feedback

ClubSpace SHALL use shared typography, spacing, focus, and action styles. Normal text SHALL reach at least 4.5:1 contrast and large text at least 3:1. Critical states SHALL have explicit text labels.

#### Scenario: Choose an event and decide whether to register
- **WHEN** a student browses events and opens an event detail
- **THEN** each result exposes a clearly identifiable link and scan-friendly date and venue
- **AND** the detail groups date, time, venue, capacity, and deadline for the registration decision
- **AND** the primary action and explanation match the student's registration state and eligibility

#### Scenario: Review organizer and admin work
- **WHEN** an organizer or administrator opens their workspace
- **THEN** the main action or queue is visually prominent
- **AND** event and booking status are separately labelled in user-facing language
- **AND** approval and publication are presented as separate decisions

#### Scenario: Encounter an empty list or a recoverable failure
- **WHEN** a list has no results or an action fails
- **THEN** the screen distinguishes empty, filtered-empty, loading, and error states where applicable
- **AND** it offers a relevant next step when one is available
- **AND** recoverable failures preserve user input and lead with a plain-language explanation

### Requirement: Clear venue availability and request handoff

ClubSpace SHALL show the selected venue, campus week, and slot state using Hong Kong time. Past slots SHALL be unavailable for selection. Slot names SHALL convey date and time to assistive technology.

#### Scenario: Select an available slot on a phone
- **WHEN** a committee member opens a venue calendar on a narrow screen
- **THEN** they can change day or week and select an eligible slot without scanning a compressed weekly grid
- **AND** the request page displays the carried venue, campus date, and time together before event fields

#### Scenario: Browse a past or booked slot
- **WHEN** a slot has passed or overlaps a server-provided busy interval
- **THEN** its state is explicit and it cannot be selected
- **AND** confirmed private bookings retain the existing anonymous busy presentation

### Requirement: Legible reports using free MUI components

ClubSpace SHALL use MUI X Charts Community for report figures and provide equivalent values in Material UI tables. It SHALL show the club, reporting period, metric units, and history coverage when relevant.

#### Scenario: Compare activity and confirmed venue use
- **WHEN** a committee member views a populated report
- **THEN** daily actions and confirmed hours by venue are shown as separately labelled bar charts
- **AND** exact chart values are available in tables and do not depend on hover or color
- **AND** current participant counts remain separate from historical registration actions, which are not labelled as attendance

#### Scenario: View a period with no results
- **WHEN** a report section has no observations for the selected period
- **THEN** it displays a meaningful empty state rather than a blank chart or a header-only table
- **AND** a populated series containing recorded zero values remains distinguishable from missing data or a failed request
