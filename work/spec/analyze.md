# Analysis: Weekly Status Report Generator

**Date**: 2026-10-21
**Inputs**: [constitution.md](./constitution.md), [specification.md](./specification.md), [plan.md](./plan.md), [tasks.md](./tasks.md)
**Scope**: 46 tasks (P0: 9, P1: 20, P2: 5, P3: 6, P4: 6). Read-only analysis; no source documents were changed.

## Summary

The three documents are largely aligned and every FR, NFR, DEF and SC maps to at least one task. The main problems are an ordering conflict around settings and validation, a few acceptance criteria that do not cover stated requirements, and several missing artifacts (report data contract, error shape, data retention, operational files).

| Category | Count |
|----------|-------|
| Contradictions | 6 |
| Gaps | 12 |
| Missing artifacts | 10 |
| High-complexity tasks | 9 |

Earlier note: my previous message said "36 tasks"; the correct count is 44.

## Complexity, risks and dependencies per task

Complexity: Low is under half a day of focused work, Medium is one to three days, High is more than three days or has significant uncertainty.

### Phase 0

| Task | Complexity | Main risks | Dependencies |
|------|-----------|------------|--------------|
| T0.1 Library spike | Medium | Deck library lacks hyperlinks or pagination, forcing a switch late | none |
| T0.2 Reorganize scaffold | Low | Deleting files the user still wants; verify against git before removal | T0.1 |
| T0.3 Packages and tooling | Medium | Node 24 and toolchain version drift between local and CI | T0.2 |
| T0.4 Compose, env, migrations | Medium | Migration tool limits (forward-only, partial indexes) | T0.3 |
| T0.5 Backend skeleton | Medium | Error shape not yet specified (see gap G-03) | T0.4 |
| T0.6 Authentication | High | CSRF and cookie settings differ between dev (HTTP) and production; rate limiter behind a proxy | T0.5 |
| T0.7 Login page and API client | Low | CSRF token bootstrap on first load | T0.6 |
| T0.8 CI and README | Medium | Needs a Docker-capable runner; audit failures blocking unrelated work | T0.3, T0.4 |

### Phase 1

| Task | Complexity | Main risks | Dependencies |
|------|-----------|------------|--------------|
| T1.1 Period and time zone | Medium | DST and month or year boundaries | T0.3 |
| T1.2 Metrics | High | Many interacting rules (basis, reopen, Epic moves, sprint fallback) | T1.1 |
| T1.3 Blockers and age | Medium | Reconstructing flag and status events from changelogs | T1.1 |
| T1.4 RAG and roll-up | High | Formula edge cases in DEF-03; most business-critical logic | T1.2, T1.3 |
| T1.5 Sanitizer | Medium | Name detection is never complete; false confidence | T0.3 |
| T1.6 Settings with defaults | Medium | Ordering against T1.11 (see C-01) | T0.5 |
| T1.7 Validation and discovery | Medium | Real Jira field names differ per instance; no stored "validated" state (see G-01) | T1.6, T1.8 |
| T1.8 Jira client core | High | Retry and backoff correctness; schema strictness vs real payloads | T0.5, T1.6 |
| T1.9 Changelog, comments, sprint, ADF | High | Changelog truncation, ADF node variety, Agile API absent on some projects | T1.8 |
| T1.10 History cache and sync | High | Cache invalidation, overlap window, deletion reconciliation | T1.9, T1.11 |
| T1.11 Persistence migrations | Medium | Schema changes later in P2 and P3 need careful forward-only migrations | T0.4 |
| T1.12 Mock server and fixtures | Medium | Mock drifts from real Jira; needed earlier than listed (see C-05) | T1.8 |
| T1.13 Job runner and orchestration | High | Races on the one-active-job rule; recovery and timeout handling | T1.4, T1.5, T1.10, T1.11 |
| T1.14 Report API routes | Medium | Large report payloads; leaking raw data | T1.13, T0.6 |
| T1.15 Deck slides 1 to 6 | High | Layout overflow, pagination, 25-slide cap, no shared report contract (see A-01) | T1.4, T1.5, T0.1 |
| T1.16 Deck regeneration | Low | Stale report data if overrides change (see G-04) | T1.15 |
| T1.17 Dashboard and Report pages | Medium | Accessibility and empty states across many views | T1.14, T0.7 |
| T1.18 Progress, dry run, download | Medium | Job polling and download in the browser | T1.17, T1.16 |
| T1.19 E2E and M1 verification | Medium | Needs validation state seeded (see G-01) | T1.18, T1.12 |

### Phase 2

| Task | Complexity | Main risks | Dependencies |
|------|-----------|------------|--------------|
| T2.1 Snapshots and comparison | Medium | Skipped weeks, absent Epics, rerun replacement | T1.13 |
| T2.2 Trend API, chart, slide 7 | Medium | Chart text alternative and slide rendering | T2.1, T1.15, T1.17 |
| T2.3 Override storage and audit | Medium | Audit must exclude secrets and names | T1.13, T1.11 |
| T2.4 Overrides page and display | Medium | Roll-up with overrides must follow DEF-10 | T2.3, T1.17, T1.15 |
| T2.5 Concurrency and E2E | Low | Flaky concurrency test | T2.1 to T2.4 |

### Phase 3

| Task | Complexity | Main risks | Dependencies |
|------|-----------|------------|--------------|
| T3.1 Settings page with audit | Medium | Secrets accidentally shown; ambiguous-field UX | T1.6, T1.7, T2.3 |
| T3.2 LLM client | Medium | Payload leak of summaries or comments; provider differences | T1.6 |
| T3.3 Summary draft and approval | Medium | Approval must mark deck stale and never leak unapproved text | T3.2, T1.14 |
| T3.4 Summary UI | Low | Clear default-off behavior | T3.3, T1.17 |
| T3.5 Appendix slide 8 | Low | Content volume against the slide cap | T1.15, T2.4 |
| T3.6 Accessibility and M3 verification | Medium | Automated checks catch only part of WCAG | T3.1 to T3.5 |

### Phase 4

| Task | Complexity | Main risks | Dependencies |
|------|-----------|------------|--------------|
| T4.1 Benchmark in CI | High | Missing targets need rework of cache or queries; runner variance | T1.12 |
| T4.2 Determinism test | Medium | Hidden nondeterminism (ordering, timestamps) | T3.5 |
| T4.3 Security review | Medium | Findings may force changes in earlier phases | T3.6 |
| T4.4 E2E suite completion | Medium | Suite runtime and flakiness | T3.6 |
| T4.5 Documentation | Medium | Drift from implementation | T3.6 |
| T4.6 Release | Low | Unverified success criteria found late | T4.1 to T4.5 |

### Critical path

T0.1, T0.2, T0.3, T0.4, T0.5, T1.6, T1.8, T1.9, T1.10, T1.13, T1.14, T1.17, T1.18, T1.19, then T2.1, T2.2, T3.x and T4.1 to T4.6. The Jira client chain (T1.8 to T1.10) is the longest high-complexity run and the biggest schedule risk. Domain logic (T1.1 to T1.5) and the sanitizer can proceed in parallel with it.

## Contradictions

| ID | Where | Issue | Suggested fix |
|----|-------|-------|---------------|
| C-01 | T1.6 vs T1.11 | T1.6 says the settings table exists, but the `setting` migration is created in T1.11, which T1.6 does not depend on | Add T1.11 as a dependency of T1.6, or move the `setting` migration into T1.6 |
| C-02 | Plan Phase 3 vs tasks T1.7 and specification phases | The plan puts the validation endpoint, field discovery and "block generation until validated" in Phase 3; the tasks put them in P1 (T1.7) and the specification phase list puts them in Phase 1 | Align all three on Phase 1 for the endpoint and the block, Phase 3 for the settings page |
| C-03 | FR-036 vs DEF-01 | FR-036 lists "week start" as a configurable setting, but DEF-01 fixes weeks as Monday to Sunday | Remove "week start" from FR-036 or define it in DEF-01 |
| C-04 | Plan data model vs FR-042 and FR-022 | Overrides change RAG after a report is computed, but only summary approval marks the stored deck stale | Define that override changes also mark the deck stale and update the stored report |
| C-05 | T1.12 vs T1.9 and T1.10 | The mock server comes after T1.8 and no task that needs it depends on it, yet T1.9 and T1.10 are tested against Jira fixtures and a concurrency cap | Make T1.12 a dependency of T1.10, or build fixtures inside T1.9 and T1.10 |
| C-06 | Slide 2 and FR-009 vs P1 scope | Slide 2 shows "change vs last week" and slide 3 a week-over-week delta, but snapshots arrive in P2 | State that P1 shows "n/a" for these and test that behavior |

## Gaps

| ID | Gap | Affected | Suggested fix |
|----|-----|----------|---------------|
| G-01 | The "validation has passed once" state is not stored anywhere and has no data-model entry; M1 end-to-end needs it, yet the validation UI is in P3 | FR-052, T1.7, T1.19, T3.1 | Store it as a setting; seed it in tests; add a minimal validate call in the M1 flow |
| G-02 | No task for the logout endpoint listed in the API outline | T0.6, plan API | Add logout to T0.6 acceptance criteria |
| G-03 | The error response shape (FR-040) is never defined, only "consistent" | T0.5, all routes | Define fields (code, message, correlationId, details) in the specification |
| G-04 | No rule for regenerating the report or deck after an override or settings change | FR-022, FR-042 | See C-04; add an acceptance criterion in T2.4 |
| G-05 | FR-034 covers issue summaries as well as comments, but T1.5 acceptance criteria mention only mentions, names and mitigation text | T1.5 | Add issue summaries to the criteria |
| G-06 | SC-003 requires an explicit "No mitigation recorded" marker; no task states it | T1.15, T1.17 | Add to T1.15 and T1.17 criteria |
| G-07 | Edge case "override names an Epic that does not exist: warn and ignore" has no task criterion | T2.3, T2.4 | Add to T2.3 |
| G-08 | Edge case "Epic with no child issues, no division errors" is only partly covered (T1.4 roll-up) | T1.2 | Add a metrics test for zero-child Epics |
| G-09 | Warnings must appear in the UI, the log and the deck appendix; only the UI and appendix have tasks | NFR-002, T1.13, T3.5 | Add logging of warnings to T1.13 |
| G-10 | No data retention or storage limit for stored decks, job payloads, history and snapshots, all kept in PostgreSQL | FR-046, T1.11 | Specify retention (for example keep all snapshots, last N decks and jobs) |
| G-11 | Settings changes in P1 (saving discovered IDs) are not audited, while FR-047 requires it; audit tables arrive in P2 | FR-047, T1.7, T2.3 | Move the `audit_entry` migration to T1.11 and audit from the first save |
| G-12 | Several FRs are only partly traced: FR-014 bug counts, FR-032 hyperlink base URL, FR-037 matching, FR-039 forms have no explicit acceptance criteria | T1.2, T1.15, T1.6 | Add one criterion each |

## Missing artifacts

| ID | Artifact | Why it matters |
|----|----------|----------------|
| A-01 | Shared report data contract (types or schema for the computed report) | Domain logic, API, deck and UI all depend on it; T1.15 can start before it exists |
| A-02 | API contract (OpenAPI or typed route definitions) with the error shape | The plan has only an outline table |
| A-03 | Dockerfiles for backend and frontend, and `.dockerignore` and `.gitignore` | Compose covers only PostgreSQL; deployment behind HTTPS is expected |
| A-04 | CI workflow file path and definition (for example `.github/workflows`) | T0.8 names behavior but not the artifact |
| A-05 | Seed or demo data and a documented way to run against the mock Jira locally | Needed for demos and for SC-009 |
| A-06 | Quality checklist for the specification (the SpecKit checklist phase) | Not produced; only clarify and analyze exist |
| A-07 | Initial settings defaults file with every RAG threshold and default | FR-019 and FR-036 refer to "versioned defaults" without a listing |
| A-08 | Logging redaction rules and a list of fields never logged | NFR-001 and NFR-007 depend on it |
| A-09 | Time zone handling decision (list of allowed zones, library) | T1.1 depends on it |
| A-10 | Task for pinning and updating the `module3-task` and other unrelated repository content; not required, but the scaffold cleanup in T0.2 should list exactly which files to delete | Avoids accidental deletions |

## Spec edge cases without a task

- A bad project key is covered by T1.7 and T1.8; the database being unavailable is covered by T0.5.
- Overrides for a missing Epic (G-07) and zero-child Epics (G-08) lack explicit acceptance criteria.
- Month, year and daylight-saving boundaries are covered by T1.1.
- Partial data warnings reach the UI and deck appendix but not the log (G-09).

## Resolution status

Fixes applied on 2026-10-21 to the specification, plan and tasks:

- **Resolved**: C-01 to C-06, G-01 to G-12, A-01, A-03, A-04, A-05, A-07, A-08, A-09.
- **Partly resolved**: A-02, the error shape is now defined in FR-040 but no OpenAPI file is planned; the typed report model (T1.0) covers the data side.
- **Not addressed**: A-06 (quality checklist) and A-10 (exact file list for the T0.2 cleanup); both can be done on request.
- **Numbering**: new tasks are T0.9 and T1.0, so the total is now 46. The complexity tables above do not list them: T0.9 is Low and T1.0 is Medium.

## Recommended actions

1. Fix C-01 to C-06 in the plan and tasks (small edits).
2. Add the report data contract (A-01) as a new first task in Phase 1 and make T1.15 depend on it.
3. Add criteria for G-02, G-05, G-06, G-07, G-08, G-09 and G-12 to the existing tasks.
4. Decide retention (G-10) and the error shape (G-03) in the specification.
5. Add tasks for Dockerfiles and ignore files (A-03) and the CI workflow file (A-04).
6. Move the `audit_entry` migration into T1.11 (G-11).
