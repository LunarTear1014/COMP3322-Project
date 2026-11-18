# Spec: Google OIDC sign-in (ClubSpace)

**Status:** ready-for-agent
**Source:** grilling session decisions + [ADR-0001](../../docs/adr/0001-google-oidc-single-users-table.md)

## Goal

Add Google OAuth 2.0 + OpenID Connect login as an alternative to password login. Coexists with the existing email/password flow; sessions, roles and the users table are unchanged in kind.

## Settled decisions

| Decision | Resolution |
|---|---|
| Coexist vs replace | Coexist — password login stays (markers/demo accounts; Google cannot run on the plain-HTTP HKU deployment) |
| Identity model | Single `users` table; match a Google sign-in by `google_sub` (OIDC Subject), else by verified email (Linked Account), else create |
| Email collision | Auto-link: Google guarantees `email_verified`; reject sign-in with a friendly error when email is not verified |
| Session | Same session kind as password login — callback regenerates the session and sets `user_id` |
| HTTPS | OAuth works on localhost only; the HKU server keeps password login |
| Secrets | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` (gitignored); both unset = OAuth routes disabled (404) |
| Library | `openid-client` — standard state/nonce/PKCE handling; never hand-rolled |
| Scopes | `openid email profile` only |
| Frontend UX | Full-page redirect; "Continue with Google" button on AuthPage |
| `student_id` | Profile Completion: one-time prompt after first Google sign-in (column is nullable since migration 018) |
| `password_hash` | Sentinel `NO_PASSWORD_SENTINEL` for Google-only users; column stays NOT NULL |

## Flow

1. AuthPage shows "Continue with Google" (hidden when OAuth is disabled).
2. `GET /api/v1/auth/google/start` → generate state + nonce + PKCE verifier (session-scoped), redirect to Google's authorization endpoint.
3. `GET /api/v1/auth/google/callback` → validate state/nonce, exchange code (PKCE), decode ID token claims.
4. Provision: `google_sub` match → verified-email link → create (sentinel password, null `student_id`); session regenerate + `user_id`; redirect to `/`.
5. Frontend session bootstrap: null `student_id` → Profile Completion step (PATCH student ID) before entering the app.

## Error handling

- State/nonce mismatch, code exchange failure, unverified email: redirect to the app with a friendly error message (no raw stack traces).
- OAuth disabled (`GOOGLE_CLIENT_ID`/`SECRET` unset): both routes 404; button hidden; app behaves exactly as before.
- Throttling: the start route gets IP-throttled like other unauthenticated endpoints.

## Out of scope

- Other IdPs; separate identities table; account unlinking/disconnect; HTTPS on the HKU deployment; refresh tokens (session-only).
