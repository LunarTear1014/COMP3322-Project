# ClubSpace implementation handoff

**Status:** design-only, awaiting review. **Date:** 2026-11-03 (Asia/Taipei).
**Baseline:** `aa4fb7d`. **Change:** `expand-clubspace-workflows`.
**Branch:** `feature/expand-clubspace-workflows`, separate worktree.

This package is a reference handoff for the team. Recipients can read and implement it using their own tools; OpenSpec/Linear integration, agent coordination and session logging are not required.

## Reading order

| File | Reader and purpose |
| --- | --- |
| [proposal.md](proposal.md) | Everyone: proposed scope, exclusions and review decisions |
| [design.md](design.md) | Technical leads: architecture, invariants and trade-offs |
| [handoff/backend.md](handoff/backend.md) | Backend developer: services, permissions, algorithms, locks and worker |
| [handoff/api.md](handoff/api.md) | Backend/frontend: endpoint and payload contract |
| [handoff/database.md](handoff/database.md) | Database developer: columns, keys, migration/backfill rules |
| [handoff/frontend.md](handoff/frontend.md) | Frontend developer: page/state/API mapping |
| [specs/](specs/) | Everyone: normative behavior and acceptance scenarios |
| [handoff/verification.md](handoff/verification.md) | Test/release owner: concurrency and deployment evidence |
| [tasks.md](tasks.md) | Implementers: dependency-ordered checklist |
| [handoff/course-proposal-update.md](handoff/course-proposal-update.md) | Team: suggested coursework amendment |
| [ADR draft](../../ADRs/0001-clubspace-workflow-consistency.md) | Reviewers: key decisions and alternatives |

## Authority

Normative `specs/*/spec.md` requirements are acceptance criteria. API handoff defines wire formats; database handoff defines storage; backend handoff defines transaction algorithms. Resolve contradictions by updating the draft before implementation. Every implementation task remains unchecked. Structural OpenSpec validation does not prove that code works or migrations execute.

Backend owns service/transaction/worker logic; database owner reviews DDL, backfills and query plans; frontend owner builds against shared examples and provider contract tests. Personal team assignments require team agreement.

## Baseline observations

- `backend-alpha/index.js` contains six endpoints with SQL, demo identity and immediate confirm/publish.
- Membership and join/leave controls update React state only; organizer dashboard is a placeholder.
- `src/db/schema.sql` creates `idx_users_role` on nonexistent `users.role`; implementation must fix fresh setup.
- Seed password hashes are placeholders, not usable credentials. Legacy timestamps require an operator-confirmed timezone.
- No production migration runner or background notification worker currently exists; both are proposed implementation work.

No application code, production tables, live credentials, existing course proposal or Linear issue is changed by this package.
