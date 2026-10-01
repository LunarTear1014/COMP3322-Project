# COMP3322 Group Project Proposal

## 1. Team Members

| Member                 | Student Number |
| ---------------------- | -------------- |
| Chan Ka Ho Charlie     | 3035927104     |
| Lucien Balthazar Neale | 3036720486     |
| Chan Ka Hei Aubrey     | 3036388381     |

## 2. Project Title

**ClubSpace — University Club Event & Venue Management Platform**

## 3. Project Description

ClubSpace is a web application that allows university clubs to reserve venues, organize events, and manage student participation. Club committee members can create events and book suitable venues while avoiding conflicting bookings. Students can discover upcoming events, filter them by criteria such as club, date, or venue, and join events that they are eligible to attend. Events may be open to all students or restricted to members of the organizing club.

The target users are **university students** and **club committee members**. Students use the system to discover and join events, while committee members use it to organize events and manage their club's bookings and participants.

## 4. Feature List

### Must-have

- **User accounts and club membership**
  - Register, login, logout, and manage personal information.
  - Join and leave clubs.
  - Support membership in multiple clubs.
  - Distinguish ordinary members from club committee members.

- **Venue booking**
  - Browse available venues and timeslots.
  - Book a venue for a specific date and time.
  - Prevent conflicting bookings.
  - Allow authorized organizers to cancel their bookings.

- **Event management**
  - Create an event associated with a venue booking.
  - Set event title, description, date/time, and visibility.
  - Support public and club-members-only events.
  - Allow organizers to edit or cancel their events.

- **Event discovery and participation**
  - Browse upcoming and past events.
  - Filter events by date, club, venue, and visibility.
  - View event details.
  - Join and leave eligible events.
  - Prevent duplicate registrations and unauthorized participation.
  - Allow organizers to view participants.

- **Validation and authorization**
  - Validate important input on both client and server.
  - Enforce permissions for club and event management.
  - Maintain database integrity and provide appropriate API responses.

### Nice-to-have

- Event capacity and waitlists.
- Asynchronous notifications when events are changed or cancelled.
- Event reviews.
- External payment system to pay an event's entry fee

## 5. Technology Stack

| Area            | Technology                   |
| --------------- | ---------------------------- |
| Frontend        | React                        |
| Backend         | Node.js + Express            |
| API             | RESTful API                  |
| Database        | MySQL                        |
| Deployment      | Linux VM + Docker Compose    |
| Version Control | Git + GitHub                 |
| Authentication  | Session-based authentication |

## 6. Preliminary Team Task Allocation

| Member                     | Primary Responsibilities                                               |
| -------------------------- | ---------------------------------------------------------------------- |
| **Chan Ka Ho Charlie**     | Backend/API, authentication, authorization, event business logic       |
| **Lucien Balthazar Neale** | React frontend, UI components, pages, event browsing and participation |
| **Chan Ka Hei Aubrey**     | MySQL database design, venue/booking logic, Docker deployment          |

All members will participate in integration, testing, debugging, documentation, and code review.

## 7. Problem & Target User Context

University clubs often need to coordinate venues, event information, and student participation. These activities can become difficult to manage when booking information and event announcements are handled separately.

ClubSpace brings these activities into one web application. Committee members can organize events and reserve venues, while students can discover relevant events and register for them. A web application is suitable because students and organizers can access the system through a browser without installing specialized software.

## 8. High-level Workflow

### Club committee member

1. Log in and access the club management area.
2. Create an event and enter its basic information.
3. Select a venue and date/time.
4. View whether the venue is available.
5. Confirm the booking and publish the event.
6. Manage participants or cancel the event when necessary.

### Student

1. Log in.
2. Browse upcoming events.
3. Filter events according to their interests.
4. Open an event to view its details.
5. Join the event if they satisfy its participation requirements.
6. View their joined events and past participation.

If an event is cancelled, its availability is removed from the event listing and participants can be informed through the optional notification feature.

## 9. Anticipated Learning Challenges & Self-assessment

As most team members have limited experience with modern web development, the project will involve a significant learning curve. The main anticipated challenges are:

### 1. Learning and integrating the full web development stack

The team will need to learn how React, Node.js, Express, RESTful APIs, and MySQL work together. Integrating the frontend, backend, and database may initially be challenging.

**Plan:** The team will first build a small end-to-end feature, such as displaying events from the database in the React frontend, before gradually adding more functionality. Team members will also share knowledge and document useful findings during development.

### 2. Implementing authentication and authorization

The team has limited experience implementing user authentication and controlling access to features based on roles and club membership. This is particularly important because different users will have different permissions.

**Plan:** The team will study authentication and authorization early in the project and implement a simple login system before developing protected features. Permissions will be tested with different user roles throughout development.

### 3. Handling more complex application logic

Features such as preventing conflicting venue bookings, restricting members-only events, and maintaining consistent event and booking information require more than basic CRUD operations.

**Plan:** The team will identify the main business rules before implementation and develop these features incrementally. Important edge cases, such as overlapping bookings and unauthorized event registration, will be tested explicitly.
