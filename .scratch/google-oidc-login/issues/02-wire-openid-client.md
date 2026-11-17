# 02: Wire `openid-client` with env-flagged routes

**What to build:** Navigating to `GET /api/v1/auth/google/start` redirects the browser to Google's authorization endpoint and Google's redirect lands back on `GET /api/v1/auth/google/callback`, which completes a validated handshake (state + nonce + PKCE) — no user record is created yet. Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in the environment, both routes are 404 and the app behaves exactly as before.

**Blocked by:** 01 (Schema — nullable `student_id` + `google_sub` column, sentinel password support). Can start now that 01 is done.

**Status:** ready-for-agent

- [ ] `openid-client` is a dependency; discovery against Google's issuer happens once at startup (or lazily on first start request), not per-request.
- [ ] `GET /auth/google/start`: IP-throttled; generates state, nonce and PKCE verifier scoped to the session; stores them on the session; redirects (302) to Google with `openid email profile` scope.
- [ ] `GET /auth/google/callback`: validates state against the session, exchanges the code with the PKCE verifier, validates the ID token (issuer, audience, expiry, nonce).
- [ ] Handshake-only: a successful callback currently just redirects to `/` (provisioning is ticket 03); failure redirects to the app with an error marker, never a stack trace.
- [ ] Both routes 404 (and the start route performs no work) when the client ID/secret are unset; a callback arriving while disabled is also 404.
- [ ] Session-scoped handshake state is cleaned up after use (no replay of a used state).
- [ ] Tests: start/callback round-trip against a stubbed issuer or mocked discovery; disabled-flag 404; state-mismatch redirect. Seams agreed per the TDD skill before writing.
