## MODIFIED Requirements

### Requirement: Responsive and accessible application navigation

ClubSpace SHALL provide clearly labelled primary navigation, active section identification, visible keyboard focus, and a layout that reflows to 320 CSS px without page-wide horizontal scrolling. Below 768 CSS px, primary navigation SHALL be a persistent bottom tab bar with exactly four links: Explore, My events, Clubs and Inbox. From 768 CSS px up, the same four destinations SHALL appear as header links. Profile, sign-out and role tools (Organizer, Admin) SHALL be reached from an account control in the header.

#### Scenario: Switch sections as a student on a phone
- **WHEN** a signed-in student uses ClubSpace at 320 or 390 CSS px
- **THEN** a bottom tab bar shows Explore, My events, Clubs and Inbox as links on every student page
- **AND** the current tab is marked with `aria-current="page"` and identifiable without relying on color
- **AND** focused content is never hidden behind the tab bar or a sticky action bar

#### Scenario: Reach a role-specific page from a phone
- **WHEN** a signed-in organizer or venue administrator uses ClubSpace at 320 or 390 CSS px
- **THEN** the header's account control exposes all destinations permitted for their role
- **AND** the tab bar keeps the same four tabs regardless of role
- **AND** the account control can be opened, navigated and dismissed with the keyboard without losing focus

#### Scenario: See unread notifications
- **WHEN** the signed-in user has unread notifications
- **THEN** the Inbox tab shows the unread count, and assistive technology announces it as "N unread"
- **AND** no count is shown when there are no unread notifications

#### Scenario: Open an account form on a phone
- **WHEN** a guest opens sign-in or account creation on a narrow viewport
- **THEN** the form heading and fields precede supplementary campus copy
- **AND** local preview credentials are identifiable as sample credentials without obstructing the form

### Requirement: Clear venue availability and request handoff

ClubSpace SHALL show the selected venue, campus week and slot state using Hong Kong time. Past slots SHALL be unavailable for selection. Slot names SHALL convey date and time to assistive technology. The venue request SHALL let the organizer choose a slot only from the selected venue's configured slots for a campus day, with each slot shown as available, booked or past.

#### Scenario: Select an available slot on a phone
- **WHEN** a committee member opens a venue calendar or the venue request on a narrow screen
- **THEN** they can change day or week and select an eligible slot without scanning a compressed weekly grid
- **AND** the request displays the carried venue, campus date and time together before event fields

#### Scenario: Browse a past or booked slot
- **WHEN** a slot has passed or overlaps a server-provided busy interval
- **THEN** its state is explicit, booked slots name the holder when the calendar exposes it, and it cannot be selected
- **AND** confirmed private bookings retain the existing anonymous busy presentation

#### Scenario: Lose a slot to another club before submitting
- **WHEN** the organizer submits a request and the server responds 409 VENUE_UNAVAILABLE
- **THEN** the request shows the conflict inline above the slots, refreshes their availability and keeps every other field the organizer entered

## ADDED Requirements

### Requirement: Shared ClubSpace design system

ClubSpace SHALL style every screen from the ClubSpace design system tokens (colour, type, spacing, radius, shadow) in light and dark themes. Normal text SHALL reach at least 4.5:1 contrast, and large text and meaningful marks at least 3:1, in both themes. Each status SHALL be shown as a chip with a text label, never by color alone.

#### Scenario: View ClubSpace in dark mode
- **WHEN** the operating system or the user selects a dark theme
- **THEN** every screen uses the dark token values, and all text and status chips keep the required contrast

#### Scenario: Read a registration state without color
- **WHEN** an event shows Joined, Waitlisted with a queue position, Members only, Almost full or Cancelled
- **THEN** the state is written in words, with an icon where the design system defines one

### Requirement: Action emphasis and interaction states

Each screen SHALL present at most one primary action. Student-facing surfaces SHALL use the sticker card style, and organizer and admin surfaces the flat style. Interactive elements SHALL provide hover, pressed and focus-visible states, SHALL be at least 44 CSS px tall, and SHALL respect reduced motion.

#### Scenario: Prefer reduced motion
- **WHEN** the user has `prefers-reduced-motion: reduce`
- **THEN** hover lifts, press movement, sheet and toast animations are replaced by instant state changes, and no content stays hidden

#### Scenario: Organizer list
- **WHEN** an organizer opens their workspace
- **THEN** its cards use the flat style and the screen has one primary action

### Requirement: Event discovery filters

The event list SHALL let students filter by date range, club, venue, visibility, phase and campus tags, in addition to keyword search, using the v1 `EventFilters` parameters and the repeatable `tag` parameter. Event cards and the event page SHALL show the event's campus tags; the event page and the club page SHALL also show its club tags. The active filters SHALL be reflected in the page URL so a filtered view can be shared and survives a reload.

#### Scenario: Filter to this week's open events
- **WHEN** a student turns on the "This week" and "Open to everyone" filters
- **THEN** the list requests events with the corresponding `from`, `to` and `visibility` parameters
- **AND** the URL updates, and reopening it shows the same filters and results

#### Scenario: Filters match nothing
- **WHEN** the selected filters return no events
- **THEN** a filtered-empty state explains this and offers to clear the filters
- **AND** it is distinguishable from loading, an error, or a period with no events at all

### Requirement: Persistent event action on phones

Below 768 CSS px the event page SHALL keep its primary registration action, with spots left or waitlist size and the registration deadline, in a bar fixed above the tab bar. The action SHALL match the student's registration state and eligibility. Changes in that state SHALL be announced to assistive technology.

#### Scenario: Join an event from a phone
- **WHEN** a student opens an event with free places at 390 CSS px
- **THEN** a "Join event" action and the remaining places are visible without scrolling
- **AND** after joining, the bar shows the Joined state and an Add to calendar action, and a confirmation is announced

#### Scenario: Event is full or restricted
- **WHEN** the event is full with a waitlist, or members only for a non-member
- **THEN** the bar offers "Join waitlist" or "Join club to register" respectively, or states why no action is available

### Requirement: Event cover presentation

Event cards and the event page SHALL show the event's uploaded cover as an image with alt text and explicit dimensions, and SHALL show a decorative cover in the club's colour when no cover exists. Organizers SHALL be able to add, replace and remove a cover while creating or editing an event, with the image rules stated before upload and failures explained next to the uploader.

#### Scenario: Browse events with and without covers
- **WHEN** the event list contains events with and without uploaded covers
- **THEN** events with covers show their image, events without show the club-colour cover, and the layout does not shift as images load

#### Scenario: Upload a cover that is too small
- **WHEN** an organizer chooses an 800×600 image
- **THEN** the uploader rejects it before upload with "Covers need at least 1200×800"
- **AND** the rest of the event form keeps its values

### Requirement: Clubs directory

ClubSpace SHALL provide a Clubs destination listing the user's clubs with their role, and other clubs with member and event counts and a join action. Leaving a club SHALL be confirmed in the page or undoable, and committee memberships SHALL show that they cannot be left there.

#### Scenario: Join a club to unlock a members-only event
- **WHEN** a student who is not a member opens a members-only event and chooses "Join club to register"
- **THEN** they reach the club's join action, and after joining, the event offers "Join event"

### Requirement: Organizer work view

The organizer workspace SHALL list events that need an organizer decision before other events: approved drafts awaiting publication, rejected or returned requests with their reason, and, for the president, every request and publication awaiting their sign-off. It SHALL show each managed event's progress from request through approval and publication to the event date.

#### Scenario: Publish an approved draft
- **WHEN** a booking for an organizer's draft event is approved
- **THEN** the event appears under Needs action with a "Publish event" action, and its progress shows Approved as complete and Publish as current

### Requirement: Admin review context

The venue administrator's review SHALL show, for the request being reviewed, the venue's other slots on that campus day and whether the requested capacity fits the venue. Rejecting SHALL require a reason that is sent to the club.

#### Scenario: Review a request in context
- **WHEN** a venue administrator selects a pending request
- **THEN** the review shows the venue's slots for that day with this request marked, the capacity check, and Approve and Reject actions
- **AND** rejecting requires a reason that is sent to the club

### Requirement: Live notifications in the client

While a user is signed in, the client SHALL keep the notification stream open. On each new notification it SHALL update the Inbox badge and, unless the Inbox is open, show a toast with the notification's title and a link to it. If the stream fails, it SHALL fall back to polling every 60 seconds and resume streaming when it can. Toasts SHALL be announced politely and SHALL NOT steal focus.

#### Scenario: Promotion arrives while browsing
- **WHEN** a student on Explore is promoted from a waitlist
- **THEN** within 2 seconds the Inbox badge increments and a toast "You got a spot" links to the event

#### Scenario: Connection drops
- **WHEN** the stream disconnects
- **THEN** the client reconnects with the last event ID received, and no notification is shown twice

### Requirement: Role-aware actions

The interface SHALL show each club member's role and offer only the actions their role allows. Committee members SHALL see when their request or publication is waiting for the president, and the president's reason when it is returned. On a published event, only the president SHALL see Cancel event; committee members SHALL see that only the president can cancel.

#### Scenario: Committee member publishes
- **WHEN** a committee member who is not president presses Publish
- **THEN** the event shows "Waiting for the president" and the action becomes unavailable until the president decides

#### Scenario: Committee member views a published event
- **WHEN** a committee member who is not president manages a published event
- **THEN** no Cancel event action is shown, and the page says only the president can cancel

### Requirement: President club management

The president SHALL see a sign-off queue and the club's member list, with appoint, remove and transfer-presidency actions. Transferring the presidency SHALL require an in-page confirmation that names the new president.

#### Scenario: President signs off from a phone
- **WHEN** the president opens Organizer home with two items awaiting sign-off
- **THEN** both appear first under Needs action, each with Send or Publish and Return (reason required)

#### Scenario: Transfer the presidency
- **WHEN** the president chooses Transfer presidency for a committee member
- **THEN** a confirmation names that member and explains the president becomes committee, and nothing changes until it is confirmed

### Requirement: Tagging events in forms

The venue request and event edit forms SHALL let committee members choose 1–3 campus tags and 0–5 of their club's tags, and SHALL let them create a new club tag from the form. Tags SHALL remain editable after publication.

#### Scenario: No campus tag chosen
- **WHEN** an organizer continues without choosing a campus tag
- **THEN** the form shows "Choose at least one tag" next to the tag picker and keeps every other field

### Requirement: Event check-in

During the check-in window, the committee's Manage event page SHALL show an Open check-in action, then the 4-digit code in large type, and a list of joined students they can mark or unmark as attended, with a live count. During the same window, a joined student's event page SHALL offer Check in, which asks for the code.

#### Scenario: Student checks in
- **WHEN** a joined student enters the correct code during the window
- **THEN** the event page shows Checked in, and the committee's count increases

#### Scenario: Wrong code
- **WHEN** the student enters a wrong code
- **THEN** the field shows "That code doesn't match. Ask the organizer for today's code." and keeps focus

### Requirement: Event effectiveness report page

Committee members SHALL be able to open an effectiveness report for a period of up to 93 days. It SHALL show a summary (events, average fill rate, average turnout), per-event metrics (fill rate, drop-outs, turnout, waitlist promotions, views by source, view-to-join conversion), and comparisons by campus tag, weekday and time slot.

#### Scenario: Compare tags
- **WHEN** a committee member opens the report for the last 60 days
- **THEN** a bar chart and a table compare average fill rate and turnout per campus tag

### Requirement: Report clarity and view reporting

Every effectiveness chart SHALL have a table with the exact values, and every metric SHALL have a one-line definition. Events without check-in SHALL show turnout as "Not recorded", and groups with fewer than 3 events SHALL be labelled too few to compare. The client SHALL report each event page view with its source.

#### Scenario: Event without check-in
- **WHEN** an event in the period never opened check-in
- **THEN** its turnout reads "Not recorded" and its definition explains why

#### Scenario: Event opened from the inbox
- **WHEN** a student opens an event from a notification
- **THEN** the client records a view with source `inbox`
