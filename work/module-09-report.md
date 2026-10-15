# Module 09 Completion Report

## Tracked Files
```
backlog.md
project_spec.md
```

## Backlog Commit History
```
4556c15 Add implementation backlog
```

## backlog.md Contents
~~~markdown
# Weekly Status Report Generator — Implementation Backlog

Source: [project_spec.md](./project_spec.md)

**Legend** — Delivery phase: `P1` MVP, `P2` snapshots/overrides/trend, `P3` LLM summary/appendix/polish.
Priority: `M` Must, `S` Should, `C` Could.
Strategy: reach an end-to-end deck from real Jira data as early as possible (walking skeleton first), then deepen.

---

## Phase 1 — Setup

- [ ] [P1][M] Create repo layout per spec §9: `wsr/` package, `tests/`, `config.yaml`, `overrides.yaml`, `.env.example`, `requirements.txt`, `README.md`
- [ ] [P1][M] Add `pyproject.toml` with `wsr` console entry point (`wsr = wsr.cli:main`), Python 3.10+ (NFR-5)
- [ ] [P1][M] Pin dependencies: `requests`, `python-pptx`, `PyYAML`, `python-dotenv`, `pytest`
- [ ] [P1][M] Add `.gitignore` for `.env`, `snapshots/`, `output/` (NFR-1)
- [ ] [P1][M] Implement `config.py`: load `config.yaml`, merge env vars/`.env`, validate required keys, apply defaults (§7)
- [ ] [P1][M] Define dataclasses in `models.py`: `Issue`, `Epic`, `Blocker`, `EpicMetrics`, `Snapshot`
- [ ] [P1][S] Set up logging with `--verbose` support and a secret-redaction filter (NFR-1, NFR-7)
- [ ] [P1][S] Set up CI (lint + pytest) on Windows/Linux/macOS (NFR-5)
- [ ] [P1][M] Create fixture directory with recorded Jira responses (search, changelog, comments in ADF) and a synthetic project dataset
- [ ] [P1][C] Add pre-commit hooks (ruff/black)

## Phase 2 — Core Features

### 2.1 Jira client (`jira_client.py`)
- [ ] [P1][M] Auth with email + API token via Basic auth (FR-1)
- [ ] [P1][M] Search via `GET /rest/api/3/search/jql` with cursor pagination and limited `fields` (FR-2, §10)
- [ ] [P1][M] Map fields to `Issue`: key, summary, type, status, status category, parent/epic, story points (configurable ID), due, created, resolved, updated, flagged, labels (FR-2, FR-4)
- [ ] [P1][M] Fetch changelog (`expand=changelog`, fall back to per-issue endpoint) to derive Done transitions and flagged/Blocked entry dates (FR-3)
- [ ] [P1][M] Fetch latest comment for blocked/flagged tickets only (§10)
- [ ] [P1][M] Convert ADF comment bodies to plain text (§10)
- [ ] [P1][M] Retry with backoff on 429 (`Retry-After`) and 5xx/transient errors (FR-5)
- [ ] [P1][M] Clear errors for auth failure, bad project key, missing story points field (NFR-2)
- [ ] [P1][S] Fall back to issue counts when story points are missing; emit warning (Risk 2)
- [ ] [P1][S] Isolate all endpoint specifics in this module (Risk 6)

### 2.2 Reporting period
- [ ] [P1][M] Compute Monday–Sunday week bounds in configured timezone (FR-6)
- [ ] [P1][M] Default week selection (latest completed/current) and `--week-of` parsing (FR-6)
- [ ] [P1][M] Derive ISO week label `YYYY-Www` for paths and snapshots

### 2.3 Metrics (`metrics.py`, pure functions — NFR-6)
- [ ] [P1][M] Milestone progress per epic: total/done points, % complete, counts by status category, due date, days to due (FR-7)
- [ ] [P1][M] Completed this week grouped by epic with point totals (FR-8)
- [ ] [P1][M] Planned next week (In Progress/To Do due next week or in active sprint), grouped by epic (FR-9)
- [ ] [P1][M] Blockers/risks detection: not Done and Flagged or status in `blocked_statuses` (case-insensitive), with age in days (FR-10, §6.1)
- [ ] [P1][M] Overdue work: open issues with due date before period end (FR-11)
- [ ] [P1][S] Bugs opened vs closed in week and currently open (FR-12)
- [ ] [P1][M] Handle issues with no epic (group as "Unassigned to epic") and warn

### 2.4 RAG engine (`rag.py`)
- [ ] [P1][M] Implement planned-completion linear model; exclude epics without due date and flag "no due date" (FR-16)
- [ ] [P1][M] Red rules: epic past due & incomplete; blocker age > threshold; planned completion < threshold (§4.4)
- [ ] [P1][M] Amber rules: any open blocker; overdue % > threshold (§4.4)
- [ ] [P1][M] Green default; overall = worst epic RAG (§4.4)
- [ ] [P1][M] Read thresholds from YAML config (FR-13)
- [ ] [P1][M] Emit human-readable trigger reasons, e.g. "Red: 2 blockers > 5 days" (FR-15)

### 2.5 Sanitization (`sanitize.py`)
- [ ] [P1][M] Replace ADF mention nodes and `@name`/account-ID patterns with "the team" (§6.2, FR-25)
- [ ] [P1][M] Truncate mitigation text to `comment_max_chars` with ellipsis (§6.2)
- [ ] [P1][M] Show "⚠ No mitigation recorded" and add CLI warning when no comment exists (§6.2)
- [ ] [P1][S] Strip assignee/reporter names from any text reaching the deck

### 2.6 Deck generation (`deck.py`) — slides 1–6 first (P1)
- [ ] [P1][M] Base 16:9 layout, fonts, RAG color palette, helper functions for tables/text
- [ ] [P1][M] Slide 1: Title (project name, week range, generated date)
- [ ] [P1][M] Slide 2: Executive summary (overall RAG, highlights; change vs last week when available)
- [ ] [P1][M] Slide 3: Milestone progress table per epic (RAG, % complete, points, due date, delta)
- [ ] [P1][M] Slide 4: Completed this week grouped by epic
- [ ] [P1][M] Slide 5: Planned next week grouped by epic
- [ ] [P1][M] Slide 6: Key risks & issues (item, workstream, age, mitigation)
- [ ] [P1][M] Pagination of long tables and ellipsis truncation (FR-23)
- [ ] [P1][S] Jira hyperlinks on issue keys (FR-24)
- [ ] [P2][S] Slide 7: Trend of RAG/% complete over last N weeks, default 6, configurable
- [ ] [P3][S] Slide 8: Appendix (RAG rules, data notes/warnings, override notes)

### 2.7 CLI (`cli.py`)
- [ ] [P1][M] `wsr validate`: check connectivity, project, board, story points field; discover Flagged field ID (§8, §10)
- [ ] [P1][M] `wsr generate` with `--week-of`, `--config`, `--out`, `--verbose`
- [ ] [P1][M] Orchestrate flow: config → fetch → models → metrics → RAG → deck (§9)
- [ ] [P1][M] Default output path `output/YYYY-Www/Weekly_Status_<project>_<YYYY-MM-DD>.pptx`
- [ ] [P1][S] `--dry-run`: print metrics/RAG to console, create no deck or snapshot (NFR-7)
- [ ] [P1][S] Collect and print warnings summary at end of run (NFR-2)

### 2.8 Overrides & snapshots (P2)
- [ ] [P2][M] Load `overrides.yaml` (global and per-week); require `reason` for each override (FR-14)
- [ ] [P2][M] Apply overrides to epics/overall; show "Manually set to X: reason" alongside calculated RAG (FR-14, FR-15)
- [ ] [P2][M] `snapshots.py`: write `snapshots/YYYY-Www.json` with per-epic RAG, points, blockers, overall RAG (FR-17)
- [ ] [P2][M] Idempotent overwrite when re-running same week (FR-19)
- [ ] [P2][M] Load previous snapshot; compute RAG change arrows (▲ ▼ ▬) and % deltas; "n/a" if none (FR-18)
- [ ] [P2][M] Snapshot schema versioning field for future compatibility

### 2.9 LLM executive summary (P3, `summary.py`)
- [ ] [P3][S] Define provider-agnostic `SummaryProvider` interface with config for provider/model/API key (FR-22)
- [ ] [P3][S] Build aggregated, name-free prompt payload (no assignees, no raw comments by default) with opt-in flag (FR-22)
- [ ] [P3][S] `--llm-summary`: write draft to `output/<week>/summary.md`; do not build a final deck (FR-20, FR-21)
- [ ] [P3][S] `--use-summary`: include reviewed summary on slide 2; refuse if file is missing/unreviewed (FR-21)
- [ ] [P3][S] Guarantee no LLM call or import occurs without `--llm-summary` (AC-6)
- [ ] [P3][C] Implement one concrete provider adapter once chosen (open item)

## Phase 3 — Integration

- [ ] [P1][M] End-to-end run against a real Jira project week; verify all slides 1–6 render (AC-1)
- [ ] [P1][M] Run `wsr validate` against real Jira; record project key, board ID, Flagged and Story Points field IDs in `config.yaml` (§14)
- [ ] [P1][M] Verify epic/parent linkage works on the real instance (Jira Cloud parent vs Epic Link)
- [ ] [P1][S] Check epic due-date coverage on real data; document convention (Risk 1)
- [ ] [P1][S] Review real blocker comments for name leakage; tune sanitizer
- [ ] [P2][M] Run two consecutive weeks end-to-end and confirm trend deltas (AC-5)
- [ ] [P2][S] Verify idempotent re-run and overrides appear correctly in a real deck
- [ ] [P3][S] End-to-end LLM draft → edit → `--use-summary` flow with the chosen provider
- [ ] [P1][S] Performance check on ~5,000 issues: under 2 minutes (NFR-3); optimize requests/fields if needed
- [ ] [P1][S] Cross-platform sanity run on Windows, macOS, Linux

## Phase 4 — Testing

- [ ] [P1][M] Unit: RAG thresholds at each boundary (just below, at, above) for Red and Amber rules
- [ ] [P1][M] Unit: planned-completion calculation incl. missing due date and zero-length epic span
- [ ] [P1][M] Unit: blocker detection (flagged, Blocked case-insensitive, Done excluded, custom statuses)
- [ ] [P1][M] Unit: week boundaries, timezone edges, DST/year-end ISO week labels
- [ ] [P1][M] Unit: comment sanitization (mentions, ADF nodes, names, truncation, empty comment)
- [ ] [P1][M] Unit: metrics (progress, completed, planned, overdue, bugs) on fixture data
- [ ] [P1][M] Client tests with mocked responses: pagination, 429 `Retry-After`, 5xx retry, auth failure, missing field
- [ ] [P1][M] ADF-to-text conversion tests
- [ ] [P1][M] Config validation tests (missing keys, defaults, env loading)
- [ ] [P2][M] Unit: override application, required reason, per-week vs global precedence
- [ ] [P2][M] Unit: snapshot write/read, overwrite idempotency, delta and "n/a" handling
- [ ] [P1][M] Smoke test: generate deck from fixtures; assert slide count and absence of assignee/reporter names (§11)
- [ ] [P1][S] Determinism test: same inputs produce identical deck content (NFR-4)
- [ ] [P1][M] Security test: credentials absent from logs, output, and snapshots (AC-7)
- [ ] [P3][S] Test that no network/LLM call happens without `--llm-summary` (AC-6)
- [ ] [P3][S] Test `--use-summary` gating when the summary file is missing
- [ ] [P1][S] Verify `--dry-run` writes no deck or snapshot
- [ ] [P1][C] Visual review of generated deck for text overflow on long tables

## Phase 5 — Documentation

- [ ] [P1][M] `README.md`: install, configure, run `wsr validate` and `wsr generate`, output locations
- [ ] [P1][M] `.env.example` and commented `config.yaml` covering every option
- [ ] [P1][M] Document Jira prerequisites: API token creation, required read permissions, Flagged/Story Points field discovery
- [ ] [P1][S] Document conventions: epics as workstreams, epic due dates, blocker comment as mitigation plan
- [ ] [P2][S] Document `overrides.yaml` format and snapshot behavior (idempotent, git-ignored)
- [ ] [P3][S] Document LLM summary review flow, privacy guarantees, provider configuration
- [ ] [P1][S] Document RAG rules and how to tune thresholds
- [ ] [P3][S] Appendix content spec: data notes and warnings text
- [ ] [P1][S] Troubleshooting section (auth, 429s, missing fields, no epic links)
- [ ] [P3][C] Weekly runbook for the Delivery Manager (pre-review checklist: no-mitigation warnings, overrides, summary review)
- [ ] [P3][C] Record future ideas: scheduling, email/Teams delivery, corporate template, manual risk register, burndown charts

---

## Open Items (from spec §14)

- [ ] Confirm Jira project key, board ID, Flagged and Story Points field IDs (via `wsr validate`)
- [ ] Confirm epics consistently have due dates
- [ ] Choose LLM provider (interface is provider-agnostic until decided)
- [ ] Confirm trend slide weeks (default 6)
~~~
