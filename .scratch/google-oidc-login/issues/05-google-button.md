# 05: "Continue with Google" button on AuthPage

**What to build:** The auth page shows a "Continue with Google" button that navigates the whole browser to `/api/v1/auth/google/start` (full-page redirect, no popup). The button is hidden when OAuth is disabled. IdP-side rejections and error redirects from the callback land back on the auth page with a friendly message.

**Blocked by:** 03 (Callback provisions the User).

**Status:** ready-for-agent

- [ ] Full-page redirect button on AuthPage next to the password form (MUI, consistent with existing styling).
- [ ] Frontend learns whether OAuth is enabled from the backend (e.g. a flag on the session/registration endpoint response) and hides the button when it is not.
- [ ] Callback error redirects produce a visible friendly message on the auth page (unverified email, IdP rejection, generic failure) — no console-only errors, no blank page.
- [ ] After a successful Google round-trip the app enters exactly as after password login (session bootstrap via `GET /auth/session`).
- [ ] Tests (vitest, matching existing frontend test idioms): button hidden when disabled, present when enabled, error message rendering.
