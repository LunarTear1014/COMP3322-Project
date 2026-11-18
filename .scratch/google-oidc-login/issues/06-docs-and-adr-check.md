# 06: Docs + ADR cross-check

**What to build:** A fresh contributor can enable Google sign-in on localhost following the docs alone, and the written decisions still match what shipped.

**Blocked by:** 05 ("Continue with Google" button on AuthPage).

**Status:** ready-for-agent

- [ ] README dev-setup section: how to create Google OAuth credentials (authorized origin `http://localhost:5173`, redirect URI for the callback route), which `.env` keys to set, and the note that OAuth is localhost-only by design.
- [ ] `.env.example` gains `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` with a comment.
- [ ] ADR-0001 verified line-by-line against the shipped code; any drift fixed or the ADR superseded — no silent contradiction.
- [ ] GLOSSARY terms (IdP, Linked Account, OIDC Subject, Profile Completion) still match the implementation's naming.
- [ ] README's test instructions still accurate for the new test files.
