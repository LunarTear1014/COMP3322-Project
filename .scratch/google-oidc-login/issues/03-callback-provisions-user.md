# 03: Callback provisions the User

**What to build:** A completed Google round-trip signs you in. The callback matches the OIDC Subject to an existing user (`google_sub`), falls back to verified-email matching (Linked Account: an existing password account whose email Google reports verified is linked by setting `google_sub`), or creates a new user (sentinel password, null `student_id`, `platform_role` 'student'). The session regenerates and carries `user_id`, exactly like password login.

**Callback route (registered in Google Cloud Console):** the redirect URI is `http://localhost:5173/api/auth/google/callback` in dev — the frontend origin, `/api` prefix proxied to the backend by Vite (`frontend-beta/vite.config.js`) and by nginx in production. Implement `GET /api/auth/google/callback` to match it exactly (no trailing slash). The post-login redirect must be a relative path or built from `APP_ORIGIN`, never the backend's own origin: in dev the browser is on `localhost:5173` and `localhost:3000` is not reachable as a page URL. On the HKU deployment (plain HTTP, non-localhost) Google refuses the flow — password login stays the path there per ADR-0001.

**Blocked by:** 02 (Wire `openid-client` with env-flagged routes).

**Status:** ready-for-agent

- [ ] Match by `google_sub` first; `google_sub` always wins over email (survives a Google-side email change).
- [ ] Email fallback only when the ID token's `email_verified` is true; unverified email → friendly error redirect, no account touched.
- [ ] Email match links the existing row (`google_sub` set); the row keeps its password, roles and memberships.
- [ ] No match → INSERT: email, name from claims, `NO_PASSWORD_SENTINEL` password, null `student_id`, `platform_role` 'student'. Duplicate-email race or duplicate `google_sub` race → friendly error redirect, not a 500.
- [ ] Session handling mirrors password login: `session.regenerate()`, set `user_id`, rotate CSRF, redirect to `/`.
- [ ] Provisioning is transactional (match/link/create + session writes must not half-apply).
- [ ] Tests at the auth API seam: sub-match signs in an existing linked user; verified-email links a password account; new user created with sentinel + null student_id; unverified email rejected; generic 401-equivalent error redirect paths.
