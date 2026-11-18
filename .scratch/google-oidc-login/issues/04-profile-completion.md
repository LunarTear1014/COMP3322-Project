# 04: Profile Completion gate

**What to build:** A new Google-signed-in user whose `student_id` is still null is prompted once for their student ID (PATCH `/profile` field added in this ticket's work) and only then enters the app normally; existing password users are unaffected.

**Blocked by:** 03 (Callback provisions the User).

**Status:** ready-for-agent

- [ ] Frontend detects a signed-in user with null `student_id` after sign-in and routes them to a Profile Completion step (PATCH to the profile endpoint with `student_id`).
- [ ] Profile Completion cannot be bypassed by visiting other routes directly while profile-incomplete.
- [ ] **Null-safe rendering** (carried from the ticket-01 code review): all `student_id` consumers render null without a broken UI until this ticket lands — `frontend-beta/src/pages/Profile.jsx:38` currently prints a dangling "Student ID:" label; `JoinRequestsPanel.jsx:50` and `ManageEvent.jsx:191` render empty cells. Guard or label these as part of this ticket's UI work.
- [ ] `POST /auth/register` still requires `student_id` (unchanged); the PATCH path accepts it for the OAuth-created user.

## Comments

Ticket 01 shipped the schema half (nullable `student_id`) without frontend null-guards, deliberately: rendering the null case is this ticket's UI slice.
