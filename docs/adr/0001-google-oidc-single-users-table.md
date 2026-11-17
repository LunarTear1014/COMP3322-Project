# 0001 — Google OIDC via email-matched rows in the single users table

We added Google sign-in without introducing a second identities table: a Google sign-in is matched to the existing `users` row by `google_sub` (stored in a new nullable column), falling back to exact email match when Google reports `email_verified`, and otherwise creates a new row in the same `users` table. Google-only users have the sentinel `oauth$no-password` in `password_hash` (which stays NOT NULL) and complete their profile (student ID) on first sign-in.

## Considered options

- **Separate `identities` table** (the standard multi-provider pattern): rejected as overkill — one IdP, one email namespace, no provider deletion/merge requirements in scope.
- **Passwordless-only OAuth**: rejected — demo/marker accounts are seeded with shared passwords, and Google OAuth cannot run on the plain-HTTP HKU deployment (Google requires HTTPS for non-localhost redirect URIs), so password login must keep working there.

## Consequences

- Email is a trust boundary: a Google-verified email grants control of the matching password account. Acceptable here because Google enforces `email_verified`; revisiting required if unverified-email IdPs are added.
- `student_id` becomes nullable; an OAuth-created user with no `student_id` is treated as profile-incomplete.
- OAuth is feature-flagged by env (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` unset = routes disabled), so deployments without credentials behave exactly as before.
