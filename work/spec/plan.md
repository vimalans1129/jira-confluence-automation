# Implementation Plan: Weekly Status Report Generator

**Branch**: `001-weekly-status-report`
**Date**: 2026-10-21
**Specification**: [specification.md](./specification.md)
**Constitution**: [constitution.md](./constitution.md)

## Summary

Build a web application that pulls Jira Cloud data for one project and board, computes milestone progress and rule-based RAG status per Epic, stores weekly snapshots, and produces an on-screen dashboard plus a downloadable PowerPoint deck. The backend is the only component that talks to Jira, the database, and the optional LLM provider.

## Technical Context

| Item | Decision |
|------|----------|
| Frontend | React 18, Vite, TypeScript |
| Backend | Node.js 24 LTS (pinned in `.nvmrc`), Express, TypeScript |
| Database | PostgreSQL 15 in Docker (pinned image `postgres:15`) |
| Package manager | `npm` with committed lockfiles |
| Jira access | Jira Cloud REST API v3, email and API token from server environment variables |
| Deck generation | A Node.js PowerPoint library, chosen in Phase 0 (candidate: `pptxgenjs`) |
| Validation | A schema library shared by routes and Jira client (candidate: `zod`) |
| Migrations | A forward-only migration tool, chosen in Phase 0 (candidate: `node-pg-migrate`) |
| Testing | Unit tests (Vitest), API tests against a PostgreSQL 15 container, component tests (React Testing Library), end-to-end tests (Playwright), Jira mocked in all tests |
| Quality gates | ESLint, Prettier, TypeScript `strict`, `npm audit`, all run in CI |
| Target scale | About 5,000 issues: cold run 120 s or less, warm run 30 s or less (NFR-003, DEF-15) |
| Users | A small delivery team sharing one access level; one project, one board |
| Access control | Single administrator password (hash in `APP_ADMIN_PASSWORD_HASH`), signed `HttpOnly` session cookie, login rate limiting, CSRF protection; password hashing library chosen in Phase 0 (candidate: `argon2`) |
| LLM | OpenAI-compatible chat completions client over HTTPS, optional, configured by `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` |
| Project location | Existing `weekly-status-report/` folder, used as the repository root for the application |

## Constitution Check

| Principle | How the plan complies |
|-----------|-----------------------|
| Specification first | Every task traces to an FR, NFR, or user story (see Traceability) |
| Security first | Server-side Jira access, schema validation, parameterized SQL, sanitizer, secrets only in environment variables, dependency audit in CI |
| Respect the Atlassian APIs | Dedicated Jira client with pagination, 429 handling, and bounded retries; read-only in v1 |
| Test-driven quality | Tests are written with or before each module; real PostgreSQL in route tests |
| Simplicity | One repository, two packages, no extra services; no queue system, jobs run in-process |
| Reproducible environments | Docker Compose, `.env.example`, forward-only migrations, pinned versions |
| Observability | Structured logs, correlation IDs, central error handler, health endpoint, job history in the database |

**Deviations to note**: the constitution mentions audit logging for Atlassian writes and Confluence; v1 does no writes and no Confluence work, so only the audit log for overrides and settings (FR-047) applies.

## Project Structure

```text
weekly-status-report/        # existing folder, reused as the application root
  frontend/
    src/
      api/           # single API client module
      components/    # RagBadge, MilestoneTable, RisksTable, TrendChart
      pages/         # Login, Dashboard, Report, Overrides, Settings
      hooks/
    tests/
  backend/
    src/
      config/        # environment and settings loading and validation
      middleware/    # correlation ID, auth, CSRF, rate limit, error handler, validation
      routes/        # /api/v1 handlers, no business logic
      services/      # report orchestration, snapshots, overrides, summary
      domain/        # pure logic: week, metrics, rag, sanitize
      clients/       # jira client, llm client
      repositories/  # SQL access
      deck/          # slide builders
      jobs/          # in-process job runner
    migrations/
    tests/
  shared/            # shared types, if needed
  docker-compose.yml
  .env.example
```

The existing prototype files in `weekly-status-report/` are all empty. Phase 0 keeps the `backend/` and `frontend/` layout, converts the placeholder `.js` and `.jsx` files to TypeScript (`.ts` and `.tsx`), and removes the Python `wsr/` package, `requirements.txt`, the file-based `snapshots/` and `output/` folders, `config.yaml`, and `overrides.yaml`, as decided in the specification.

## Phases and Milestones

### Phase 0 - Foundations (Milestone M0)

**Goal**: A reproducible empty stack with quality gates.

- Confirm the library choices (deck, validation, migrations, password hashing) with a short spike; all specification questions are already resolved.
- Reorganize `weekly-status-report/` as described under Project Structure.
- Create the `frontend/` and `backend/` packages with TypeScript `strict`, ESLint, and Prettier.
- Add `docker-compose.yml` with PostgreSQL 15, `.env.example` (including `JIRA_*`, `APP_ADMIN_PASSWORD_HASH`, session secret, and optional `LLM_*` variables), and a migration runner.
- Add the backend skeleton: Express app, central error handler, structured logging with correlation IDs, `/api/v1/health` with a database check.
- Add authentication: password sign-in, signed session cookie, login rate limiting, CSRF protection, and a guard on every route except health and sign-in (FR-048 to FR-051), with a minimal Login page.
- Add CI running lint, type check, tests, and `npm audit`.
- Add a README with the documented start commands.

**Exit criteria (M0)**: `docker compose up`, `npm install`, and `npm run dev` start the stack; health endpoint reports the database; unauthenticated calls to protected routes are rejected; CI is green. Covers FR-045, FR-048 to FR-051, NFR-005, NFR-007, SC-009.

### Phase 1 - MVP: Report generation (Milestone M1)

**Goal**: Generate a correct report for a chosen week and download slides 1 to 6.

1. **Domain logic (pure, test-first)**
   - Week boundaries and time zone handling (DEF-01, FR-007, FR-008).
   - Metrics: milestone progress, completed this week, planned next week, overdue, bugs, using DEF-02, DEF-05, DEF-06, and DEF-07 (FR-009 to FR-014).
   - Blocker detection and age (DEF-04, FR-012).
   - RAG rules, planned-completion formula, overall roll-up (DEF-03, DEF-08 to DEF-10, FR-015 to FR-021), with the worked examples from the definitions written as tests first.
   - Sanitizer and truncation for comments (FR-033 to FR-035).
2. **Jira client**
   - Authentication, JQL search with pagination and `expand=changelog`, changelog completion for truncated issues, latest comment for blockers, ADF to plain text, Agile API for the active sprint, retries and 429 handling, and the Jira error codes of DEF-13 (FR-001 to FR-006, FR-005).
   - History cache: derived per-issue history stored with the Jira `updated` value, incremental sync with a 5-minute overlap, concurrency capped at 5, periodic key reconciliation (FR-055, DEF-14).
   - Recorded fixtures and mocks for every call, plus the mock server for the reference benchmark (DEF-15), built early so the smoke benchmark runs from this phase.
3. **Persistence and jobs**
   - Migrations for job history, issue history, snapshots, and stored decks (FR-042, FR-043, FR-046, FR-055).
   - In-process job runner with statuses queued, running, succeeded, and failed; one active job per week enforced by a unique partial index; startup recovery of interrupted jobs and a 10-minute timeout.
4. **API**
   - Schema-validated routes: start generation, job status, report data, deck download (FR-040 to FR-042).
5. **Deck**
   - Slides 1 to 6 with RAG colors, hyperlinks to Jira, pagination, and truncation (FR-029 to FR-032).
6. **Frontend**
   - Dashboard and Report pages, loading, empty, and error states, generation progress (FR-038, FR-039).
7. **Dry run** (FR-044).

**Exit criteria (M1)**: With mocked Jira, a user generates a report, sees it on screen, and downloads a deck with slides 1 to 6; RAG matches every threshold boundary test; no names appear in the deck or API responses. Covers user stories 1 to 3, SC-001 to SC-004.

### Phase 2 - Trends and overrides (Milestone M2)

**Goal**: Week-over-week history and manual control of RAG.

- Snapshot persistence replacing the current week's row, and comparison with the most recent earlier snapshot (FR-023 to FR-025, DEF-11).
- Delta and arrow display, with "n/a" when no history exists (FR-024).
- Trend chart on the dashboard and trend slide 7, showing 6 weeks by default and configurable from 4 to 12 (FR-030, FR-054).
- Overrides: table, API, Overrides page, mandatory reason validation (FR-022), and display in dashboard and deck.
- Audit log for override changes (FR-047).
- Concurrency rule: reject duplicate generation for the same week.

**Exit criteria (M2)**: Two consecutive weeks produce correct deltas and a trend; overrides appear with their reason everywhere; every override change is audited. Covers user story 4, SC-002, SC-005.

### Phase 3 - Summary, settings, and appendix (Milestone M3)

**Goal**: Optional LLM summary with review, validation tooling, and the appendix.

- Settings page and validation endpoint: connectivity, project, board, Story Points field and Flagged field discovery by name, saving discovered IDs, and blocking report generation until validation has passed once (FR-028, FR-052, user story 6).
- Settings persistence with audit entries (FR-036, FR-047).
- LLM client behind an explicit option, using the OpenAI-compatible interface and sending only the DEF-12 fields; draft storage, edit, and approval flow; deck uses only approved text; prompts and responses not logged (FR-026, FR-027, FR-053).
- Appendix slide 8 with RAG rules, data notes, warnings, and override notes (FR-030).
- Accessibility pass for UI and deck (FR-039).

**Exit criteria (M3)**: With the option off, no external LLM call is made; with it on, an unapproved summary never reaches the deck; the settings page reports specific errors for each bad input. Covers user stories 5 and 6, SC-006.

### Phase 4 - Hardening and release (Milestone M4)

**Goal**: Prove non-functional requirements and ship.

- Run the DEF-15 reference benchmark in CI: cold run at most 120 seconds, warm run at most 30 seconds, deck at most 10 seconds, dashboard API p95 at most 500 ms; fix hotspots (NFR-003).
- Determinism test with a fixed reference time, excluding the slide 1 generated date (NFR-004).
- Security review: secrets never in logs, responses, database, or snapshots (SC-007), dependency audit clean, input validation coverage.
- End-to-end tests for each primary flow.
- Documentation: operations guide (including password and session secret rotation, FR-056), configuration reference, LLM provider approval note, RAG rules reference.
- Release tag and handover.

**Exit criteria (M4)**: All success criteria SC-001 to SC-009 verified; CI green; documentation complete.

## Milestone Summary

| Milestone | Phase | Deliverable | Key evidence |
|-----------|-------|-------------|--------------|
| M0 | 0 | Reproducible stack and CI | Health endpoint, green CI |
| M1 | 1 | Generate and download report (slides 1 to 6) | Boundary tests, deck smoke test, no-names test |
| M2 | 2 | Trends and overrides | Two-week delta test, audit entries |
| M3 | 3 | LLM summary flow, settings page, appendix | No-LLM-call test, approval gate test |
| M4 | 4 | Hardened release | Performance, determinism, and security checks |

## Data Model (initial)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `report_job` | Tracked generation runs | `id`, `week_start`, `status`, `started_at`, `finished_at`, `warnings`, `dry_run`, `payload` (computed report) |
| `issue_history` | Cached derived Jira history | `issue_key` (unique), `jira_updated`, `transitions`, `flag_events`, `points_events`, `synced_at` |
| `sync_state` | Last successful Jira sync | `id`, `last_sync_at`, `last_reconcile_at` |
| `report_deck` | Stored deck per week | `week_start` (unique), `file_name`, `content`, `generated_at`, `stale` |
| `snapshot` | One row per week | `week_start` (unique), `overall_rag`, `payload`, `created_at`, `updated_at` |
| `snapshot_epic` | Per-Epic values for a snapshot | `snapshot_id`, `epic_key`, `rag`, `points_total`, `points_done`, `blocker_count` |
| `rag_override` | Manual overrides | `id`, `scope`, `epic_key`, `rag`, `reason`, `week_start`, `created_at` |
| `summary_draft` | LLM drafts and approvals | `id`, `week_start`, `text`, `approved`, `updated_at` |
| `audit_entry` | Changes to overrides and settings | `id`, `entity`, `change`, `created_at` |
| `setting` | Editable report settings (secrets and connection values stay in environment variables) | `key`, `value`, `updated_at` |

All tables carry `created_at` and `updated_at`, use explicit foreign keys and indexes, and are changed only through migrations.

## API Outline

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/health` | Application and database health (public) |
| POST | `/api/v1/auth/login` | Sign in with the shared password (public, rate limited) |
| POST | `/api/v1/auth/logout` | End the session |
| POST | `/api/v1/reports` | Start generation for a week (with optional dry run) |
| GET | `/api/v1/reports/{id}` | Job status and warnings |
| GET | `/api/v1/reports/{id}/data` | Computed report for the dashboard |
| GET | `/api/v1/reports/{id}/deck` | Download the stored PowerPoint deck |
| POST | `/api/v1/reports/{id}/deck` | Regenerate the deck from stored report data, without Jira calls (for example after approving a summary) |
| GET | `/api/v1/snapshots` | Snapshots for trends |
| GET, POST, DELETE | `/api/v1/overrides` | Manage overrides |
| GET, PUT | `/api/v1/settings` | Read and update non-secret settings |
| POST | `/api/v1/validate` | Jira connectivity and configuration check |
| GET, PUT, POST | `/api/v1/summary` | Draft, edit, and approve the executive summary |

## Traceability

| User story | Requirements | Phase |
|------------|--------------|-------|
| 1 Generate the weekly deck | FR-001 to FR-014, FR-029 to FR-032, FR-038 to FR-045, FR-055, DEF-01 to DEF-10, DEF-13 to DEF-16 | 1 |
| 2 RAG with override | FR-015 to FR-022 | 1 and 2 |
| 3 Risks and mitigation | FR-006, FR-012, FR-033 to FR-035 | 1 |
| 4 Trends | FR-023 to FR-025, FR-054, DEF-11 | 2 |
| 5 Reviewed LLM summary | FR-026, FR-027, FR-053, DEF-12 | 3 |
| 6 Validate the setup | FR-028, FR-036, FR-045, FR-052 | 3 (health in 0) |
| Access control (cross-cutting) | FR-048 to FR-051, FR-056 | 0 (rotation docs in 4) |
| Persistence and audit (cross-cutting) | FR-046, FR-047 | 1 to 3 |
| Non-functional | NFR-001 to NFR-007 | 0 and 4 |

## Testing Strategy

- **Unit**: week logic, metrics, RAG at every threshold boundary, blocker detection, sanitizer, snapshot deltas.
- **Integration**: routes and repositories against PostgreSQL 15 in Docker; Jira client against recorded fixtures.
- **Component**: logic-bearing React components and forms.
- **End-to-end**: generate and download, create override, two-week trend, summary approval, settings validation.
- **Non-functional**: performance (5,000 issues), determinism, no-secrets-in-logs scan, no-names scan on deck and API output.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Unresolved formulas cause rework | Resolved in DEF-01 to DEF-16; each definition becomes unit tests written first |
| Jira data does not match assumptions (no Epic due dates, missing points, no active sprint) | Run the validation endpoint against a real project early; the specification defines fallbacks and warnings for each case |
| Deck library lacks needed features (hyperlinks, pagination) | Prototype slides 3 and 6 in Phase 0 before committing |
| Performance of changelog and comment calls | Single changelog read per issue, cached derived history with incremental sync, concurrency cap of 5, comment calls only for blockers; benchmark targets in DEF-15 checked from Phase 1 |
| Shared-password access is weak for a shared deployment | Strong hashing, rate limiting, HTTPS behind a proxy, short session lifetime; single sign-on is out of scope for now and would need a new specification |
| Historical weeks use current Jira data and may differ from what was originally reported | Documented as best effort (DEF-01); stored snapshots remain the record of what was reported |
| Scope creep from out-of-scope items | Keep the Non-Goals list in the specification as the gate |

## Resolved Decisions

All items that previously blocked Phase 0 are resolved in the specification:

| Former open item | Decision | Where |
|------------------|----------|-------|
| Sign-in and access control | Single shared password, hashed, signed session cookie, rate limiting, CSRF protection; no roles | FR-048 to FR-051 |
| Jira project key, board ID, field IDs | Deployment configuration; Story Points and Flagged fields discovered by name through the validation check, which must pass before reports can be generated | FR-028, FR-052 |
| Formulas and definitions | Defined for period, basis, overdue, planned completion, blocker age, moved to Done, sprint, roll-up, deltas, LLM data, Jira errors, history cache, benchmark, and linked issues | DEF-01 to DEF-16 |
| LLM provider and trend weeks | OpenAI-compatible interface configured by environment variables; 6 weeks by default, 4 to 12 configurable | FR-053, FR-054 |
| Build location | Reuse `weekly-status-report/` as the application root and remove the Python and file-based prototype leftovers | Project Structure |
