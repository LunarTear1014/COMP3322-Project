# ClubSpace

ClubSpace: a club-management web app where students join clubs and venue admins manage venues and bookings.

## Language

### Identity & access

**Identity Provider (IdP)**:
An external service that verifies who a person is; the app only supports Google.
_Avoid_: OAuth provider, social login

**Linked Account**:
A single User record that can be signed into both with a password and through the IdP, matched by verified email.
_Avoid_: merged account, connected account

**OIDC Subject (sub)**:
The IdP's stable, never-reused identifier for one Google account; the primary key for matching a Google sign-in to a User.
_Avoid_: Google ID, open ID

**Profile Completion**:
The one-time step where a new Google-signed-in user supplies the details the IdP doesn't provide (student ID).
_Avoid_: onboarding, extra signup

**Student**:
A User whose platform role is `student`; joins clubs and books venues.
_Avoid_: member, user (when role matters)

**Venue Admin**:
A User whose platform role is `venue_admin`; manages venues and bookings.
_Avoid_: admin (ambiguous), owner
