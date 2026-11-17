# 02: Wire `openid-client` with env-flagged routes

**What to build:** Navigating to `GET /api/v1/auth/google/start` redirects the browser to Google's authorization endpoint and Google's redirect lands back on `GET /api/v1/auth/google/callback`, which completes a validated handshake (state + nonce + PKCE) — no user record is created yet. Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in the environment, both routes are 404 and the app behaves exactly as before.

**Blocked by:** 01 (Schema — nullable `student_id` + `google_sub` column, sentinel password support). Can start now that 01 is done.

**Status:** ready-for-human

- [x] `openid-client` is a dependency; discovery against Google's issuer happens lazily on first start request and is cached; a transient failure clears the cache and retries later (not per-request).
- [x] `GET /auth/google/start`: IP-throttled; regenerates the session, then generates state, nonce and PKCE verifier scoped to the session; stores them on the session; redirects (302) to Google with `openid email profile` scope.
- [x] `GET /auth/google/callback`: validates state against the session (single-use, cleared on both outcomes). Code exchange and ID-token validation land in ticket 03 (handshake-only here by design).
- [x] Handshake-only: a successful callback currently just redirects to `/` (provisioning is ticket 03); failure redirects to the app with an error marker, never a stack trace.
- [x] Both routes 404 with the real NOT_FOUND envelope (and the start route performs no work) when the client ID/secret are unset.
- [x] Session-scoped handshake state is cleaned up after use (no replay of a used state).
- [x] Tests: six over real HTTP against a local stub issuer through the app's real error handler — handshake contents, session scoping, state mismatch (with and without a session), disabled 404 envelope, throttle key.

## Comments

**Review fixes applied** (code-review pass): real NOT_FOUND envelope instead of a plain-object next() (which surfaced as 500 in production); the disabled-mode catch-all `router.use` was found to shadow every later v1 router (SSE suite caught it, reproduced minimally) and was replaced with path-scoped define_route 404s; session regeneration on start (fixation); redirect_uri pinned to the frontend-facing `/api/auth/google/callback` with the same router double-mounted (v1 + `/api/auth`) via `extra_mounts`; discovery made lazy/self-healing in `google_setup.js`; `wrap` and `ip_of` reuse instead of local copies; stub issuer port randomized.
