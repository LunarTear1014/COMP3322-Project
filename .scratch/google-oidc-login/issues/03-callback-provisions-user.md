# 03: Callback provisions the User

**What to build:** A completed Google round-trip signs you in. The callback matches the OIDC Subject to an existing user (`google_sub`), falls back to verified-email matching (Linked Account: an existing password account whose email Google reports verified is linked by setting `google_sub`), or creates a new user (sentinel password, null `student_id`, `platform_role` 'student'). The session regenerates and carries `user_id`, exactly like password login.

**Callback route (registered in Google Cloud Console):** the redirect URI is `http://localhost:5173/api/auth/google/callback` in dev — the frontend origin, `/api` prefix proxied to the backend by Vite (`frontend-beta/vite.config.js`) and by nginx in production. Implement `GET /api/auth/google/callback` to match it exactly (no trailing slash). The post-login redirect must be a relative path or built from `APP_ORIGIN`, never the backend's own origin: in dev the browser is on `localhost:5173` and `localhost:3000` is not reachable as a page URL. On the HKU deployment (plain HTTP, non-localhost) Google refuses the flow — password login stays the path there per ADR-0001.

**Blocked by:** 02 (Wire `openid-client` with env-flagged routes).

**Status:** ready-for-human

- [x] Match by `google_sub` first; `google_sub` always wins over email (survives a Google-side email change).
- [x] Email fallback only when the ID token's `email_verified` is true; unverified email → friendly error redirect, no account touched.
- [x] Email match links the existing row (`google_sub` set); the row keeps its password, roles and memberships. Email compares with `LOWER(TRIM(email))`, matching login's normalization. First link wins: a row already holding a *different* `google_sub` is not re-pointed — friendly redirect instead (`google_email_linked_elsewhere`); re-linking the same sub is idempotent.
- [x] No match → INSERT: email, name from claims, `NO_PASSWORD_SENTINEL` password, null `student_id`, `platform_role` 'student'. Duplicate-email race or duplicate `google_sub` race → friendly error redirect (`google_sign_in_busy`), not a 500.
- [x] Session handling mirrors password login: `session.regenerate()`, set `user_id`, rotate CSRF, `session.save()`, redirect to `/` (via `APP_ORIGIN`). The regenerate/save calls now live in `common.js` (`session_regenerate`/`session_save`), shared with `auth.js`.
- [x] Provisioning is transactional: match/link/create run inside one `with_transaction` (READ COMMITTED, deadlock retry). *Noted deviation:* the session writes sit outside the transaction — express-session's store cannot share the provisioning connection, so a crash between COMMIT and `session.save` would leave a created user not signed in. The failure is recoverable (a retry sub-matches and signs in) and matches how password login composes its transaction and session writes.
- [x] Tests at the auth API seam: sub-match signs in an existing linked user; verified-email links a password account; new user created with sentinel + null student_id; unverified email rejected; error-redirect mapping (race → `google_sign_in_busy`, provisioning failure → `google_unavailable`) driven through the mounted router; replayed callback → `google_invalid_handshake`. 7 DB integration tests (real MySQL, stub issuer minting signed RS256 ID tokens with PKCE verification), 10 provisioning unit tests, ticket 02's handshake suite updated.

## Comments

**Ticket-02 bug found and fixed while wiring the grant:** `google_setup.js` passed `{ clientSecret }` (camelCase) as the discovery *client-metadata* argument; openid-client v6 expects a bare secret string (→ `{ client_secret }`) or an explicit auth method. The camelCase object was silently ignored, so the token request carried no client authentication at all — Google would answer `invalid_client`. Fixed to pass the secret string (`client_secret_post` default). Both test stubs updated to match.

**Two grant-correctness fixes in `google.js`:** the callback URL is now reconstructed with the registered `app_origin` as its base (not a sentinel host), so the token request's `redirect_uri` is byte-identical to the one the code was issued for; and `claims.email_verified` is coerced with `=== true` rather than trusted.

**Review fixes applied** (code-review pass): email normalization in the link lookup; first-link-wins guard with its own error marker; shared `session_regenerate`/`session_save` helpers in `common.js` (removes the auth.js/google.js duplication); the `ER_DUP_ENTRY` catch extracted (`as_race`); unused `outcome` return value dropped; claims passed as one object instead of a field-by-field data clump; test names aligned with behavior; cookie surgery wrapped in a `cookie_of` helper. Spec-override note: `handoff/backend.md` section 2 says "No email verification/reset/OAuth" — superseded for this feature by ADR-0001 and the grilling-approved spec in `.scratch/google-oidc-login/`.
