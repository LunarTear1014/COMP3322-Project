# 01: Schema — nullable `student_id` + `google_sub` column, sentinel password support

**What to build:** The database is ready to hold Google-linked Users. A migration adds a nullable `google_sub` column (the OIDC Subject) and relaxes `student_id` to nullable so a Google-created User can exist before Profile Completion. New password-based registration is unchanged (student ID still required at the API layer). Nothing user-visible changes yet.

**Blocked by:** None (can start immediately).

**Status:** ready-for-human

- [x] A new numbered migration adds `google_sub VARCHAR(255) NULL` to `users` and a unique index on it, and makes `student_id` nullable (MODIFY in same migration).
- [x] `db/schema.sql` baseline is updated to match, so a fresh database and a migrated database have the same shape.
- [x] Registration (`POST /auth/register`) still requires `student_id` — API-layer validation unchanged; only the DB constraint relaxes.
- [x] Password login still works for all existing (seeded/demo) accounts.
- [x] Sentinel value `oauth$no-password` is agreed as the shared constant for ticket 03; a password login attempt against it fails cleanly.
- [x] Migrations tests pass: new migration loads in order, is additive-only, runs against a recording context.
- [x] Full backend test suite green (needs DB for db tests). *(183/184; the one failure is the pre-existing `baseline.db.test.js` upgrade-database grant gap, unrelated to this change.)*

## Comments

**Review follow-ups applied** (code-review pass): schema-version startup pins in `src/index.js` / `src/worker.js` / `src/ops/seed-demo.js` bumped to `018_google_identity`; sentinel recognition moved into `password_hasher.verify` (single enforcement point, dummy-path derivation preserved so login timing does not leak which accounts are Google-only); corrected the harness comment's invariant (the scrypt hasher never *emits* the sentinel — it is not that users can't type it).
