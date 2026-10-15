# Module 08 Completion Report

## Tracked Files
```
project_spec.md
```

## Spec Commit History
```
a4b063f Add project spec for weekly status report generator
```

## project_spec.md Contents
~~~~markdown
# Weekly Status Report Generator — Technical Specification

**Project:** Teradata → Databricks Migration
**Owner:** Delivery Manager
**Status:** Draft v1.0 (post-interview)

---

## 1. Purpose & Goals

Automate the weekly stakeholder status report for a 10-person Teradata-to-Databricks migration team. The tool pulls data from Jira Cloud and generates a PowerPoint (.pptx) deck covering overall RAG status, milestone progress, key risks/issues and mitigation plans.

**Goals**
- Cut manual report preparation to a single CLI command plus a short review.
- Give consistent, rule-based RAG status with manual override.
- Show week-over-week trends.

**Non-goals (v1)**
- Scheduling/automatic distribution (email, Teams, Slack).
- Per-person workload or performance reporting.
- Writing back to Jira.
- Web UI.

## 2. Audience

| Audience | Primary interests |
|---|---|
| Business stakeholders | Overall RAG, milestone progress, key risks |
| IT leadership team | Issues/blockers, mitigation plans, delivery trend |

The deck must be readable by non-technical stakeholders. No individual names appear in the deck (team/workstream level only).

## 3. Scope Decisions (from interview)

| Topic | Decision |
|---|---|
| Jira | Jira Cloud, API token authentication |
| Structure | One Jira project, one Scrum board |
| Milestones/workstreams | Epics (e.g., Discovery, Schema Conversion, Data Migration, ETL/SQL Conversion, Validation, Cutover) |
| Issue types | Standard only: Epic, Story, Task, Bug |
| Risks/issues | Derived from tickets that are **Flagged (impediment)** or in status **Blocked** |
| Mitigation plan | Latest comment on the blocked/flagged ticket |
| Effort measure | Story points |
| Workflow | Standard: To Do / In Progress / Done |
| Reporting period | Calendar week, Monday–Sunday (independent of sprints) |
| Output | PowerPoint (.pptx), clean default design (no corporate template) |
| Execution | Manual CLI run weekly |
| Language | Python |
| LLM | Optional executive summary, always reviewed by the user before sending |
| History | Weekly snapshots stored locally for week-over-week trends |
| Privacy | No individual names in the deck |

## 4. Functional Requirements

### 4.1 Data extraction (Jira)
- **FR-1** Authenticate to Jira Cloud via REST API v3 using email + API token (from environment variables / `.env`, never committed).
- **FR-2** Fetch all issues in the configured project via JQL, with pagination, including: key, summary, type, status, status category, epic/parent, story points, due date, created, resolved, updated, flagged state, labels, and latest comment.
- **FR-3** Fetch issue changelog (or `resolutiondate` / status transitions) to determine what was completed and what changed within the reporting week.
- **FR-4** Story points field ID is configurable (custom field differs per Jira instance).
- **FR-5** Handle API rate limiting (HTTP 429, `Retry-After`) and transient errors with retries/backoff.

### 4.2 Reporting period
- **FR-6** Default period is the most recent completed or current Monday–Sunday week; CLI accepts `--week-of YYYY-MM-DD` to select any week and `--timezone` (default from config).

### 4.3 Metrics & derivations
- **FR-7 Milestone progress (per epic/workstream):** total vs completed story points, % complete, issue counts by status category, epic due date, days to due date, week-over-week % delta.
- **FR-8 Completed this week:** issues transitioned to Done in the period, grouped by epic, with story point totals.
- **FR-9 Planned next week:** issues In Progress or To Do that are due next week or are in the active sprint, grouped by epic.
- **FR-10 Risks/issues:** all open issues that are Flagged or Blocked, with age in days (time since flagged / entered Blocked), epic, and mitigation text (latest comment).
- **FR-11 Overdue work:** open issues with a due date before the period end.
- **FR-12 Bugs:** opened vs closed during the week and currently open (shown as a summary count).

### 4.4 RAG calculation
Default rules, configurable in YAML, evaluated per epic and rolled up to overall status (overall = worst epic status, unless overridden).

| Status | Condition (any of) |
|---|---|
| **Red** | Epic past its due date and not complete; **or** any blocker open > 5 days; **or** planned story-point completion < 70% |
| **Amber** | Any open blocker; **or** > 10% of due-dated work overdue |
| **Green** | None of the above |

- **FR-13** Thresholds (days, percentages) are configurable.
- **FR-14** Manual override: an overrides file (`overrides.yaml`) lets the user set RAG for any epic or the overall project with a required reason. The deck shows overridden status and notes the override (e.g., "Manually set to Amber: …").
- **FR-15** The calculated RAG and its triggering reasons are shown (e.g., "Red: 2 blockers > 5 days").
- **FR-16** "Planned completion" is defined as: points completed to date ÷ points expected by now, assuming linear progress between epic start (earliest child created/started) and epic due date. Epics without a due date are excluded from this rule and flagged "no due date".

### 4.5 Weekly snapshots / trends
- **FR-17** After each run, persist a snapshot (JSON, one file per week, `snapshots/YYYY-Www.json`) containing per-epic RAG, points total/done, blockers count, and overall RAG.
- **FR-18** The report compares against the previous snapshot to show RAG change arrows (▲ ▼ ▬) and % complete deltas. If none exists, show "n/a".
- **FR-19** Re-running for the same week overwrites that week's snapshot (idempotent).

### 4.6 LLM executive summary (optional)
- **FR-20** Enabled with `--llm-summary`. Off by default; deterministic output otherwise.
- **FR-21** The generator produces a draft summary in an editable file (`output/<week>/summary.md`); the user reviews/edits, then runs with `--use-summary` to include it in the deck. The deck is never produced with an unreviewed LLM summary.
- **FR-22** Only aggregated, name-free data is sent to the LLM (no assignees, no raw comment bodies unless the user opts in). The provider and API key are configurable.

### 4.7 Deck generation (PowerPoint)
Built with `python-pptx`, 16:9, clean default design, consistent colors (RAG: green/amber/red).

| # | Slide | Content |
|---|---|---|
| 1 | Title | Project name, reporting week range, generated date |
| 2 | Executive summary | Overall RAG (with change vs last week), key highlights, optional LLM summary |
| 3 | Milestone progress | Table/chart per epic: RAG, % complete, points done/total, due date, delta |
| 4 | Completed this week | Grouped by epic, with point totals |
| 5 | Planned next week | Grouped by epic |
| 6 | Key risks & issues | Table: item (key + summary), workstream, age, mitigation plan |
| 7 | Trend (optional) | RAG/% complete over past N weeks from snapshots |
| 8 | Appendix | RAG rules, data notes, override notes |

- **FR-23** Long tables paginate across slides; text is truncated with ellipsis to fit.
- **FR-24** Issue keys are included as hyperlinks to Jira.
- **FR-25** No assignee/reporter names appear anywhere in the deck (including mitigation text excerpts — see 6.2).

## 5. Non-Functional Requirements

- **NFR-1 Security:** Credentials only from environment variables or a git-ignored `.env`; never logged. Snapshots and output are git-ignored by default.
- **NFR-2 Reliability:** Clear errors for auth failure, bad project key, missing story points field; partial data issues are surfaced as warnings in the CLI and the appendix.
- **NFR-3 Performance:** Full run for a project of up to ~5,000 issues completes in under 2 minutes.
- **NFR-4 Determinism:** Same Jira data + config + overrides produce the same deck (excluding the LLM summary).
- **NFR-5 Portability:** Python 3.10+, runs on Windows, macOS and Linux.
- **NFR-6 Testability:** Business logic (metrics, RAG) is separated from I/O to allow unit testing with fixture data.
- **NFR-7 Observability:** `--verbose` logging; `--dry-run` prints computed metrics/RAG to the console without creating a deck or snapshot.

## 6. Data & Privacy Rules

### 6.1 Blocker identification
An issue is a blocker/risk when it is not Done **and** either the Jira `Flagged` field (impediment) is set **or** its status name is `Blocked`. Statuses are matched case-insensitively and are configurable.

### 6.2 Mitigation text
- Taken from the most recent comment on the blocker ticket.
- Because comments may contain names (e.g., @mentions), the tool must replace Jira mention markup/account names with a neutral placeholder (e.g., "the team") before output.
- If a blocker has no comment, display "⚠ No mitigation recorded", and list it in the CLI warnings so the owner can add one before the review.
- Comment text is truncated to a configurable length (default 300 chars).

## 7. Configuration

`config.yaml` (committed, no secrets):

```yaml
jira:
  base_url: https://<your-domain>.atlassian.net
  project_key: TDM
  board_id: 123
  story_points_field: customfield_10016
  blocked_statuses: ["Blocked"]
report:
  project_name: "Teradata → Databricks Migration"
  timezone: "Asia/Kolkata"
  week_start: monday
  comment_max_chars: 300
rag:
  amber:
    overdue_pct_gt: 10
  red:
    blocker_age_days_gt: 5
    planned_completion_pct_lt: 70
    epic_past_due: true
paths:
  snapshots_dir: snapshots
  output_dir: output
```

`.env` (git-ignored): `JIRA_EMAIL`, `JIRA_API_TOKEN`, optional `LLM_API_KEY`.

`overrides.yaml` (optional, per week or global):

```yaml
overall: { rag: Amber, reason: "Vendor dependency on cutover date" }
epics:
  "Data Migration": { rag: Red, reason: "Cluster capacity not approved" }
```

## 8. CLI Interface

```
wsr generate [--week-of YYYY-MM-DD] [--config config.yaml] [--overrides overrides.yaml]
             [--llm-summary] [--use-summary] [--dry-run] [--verbose] [--out PATH]
wsr validate        # checks Jira connectivity, project, board, story points field
```

Default output: `output/YYYY-Www/Weekly_Status_<project>_<YYYY-MM-DD>.pptx`

## 9. Architecture

```
wsr/
  cli.py              # argument parsing, orchestration
  config.py           # load/validate YAML + env
  jira_client.py      # REST calls, pagination, retries
  models.py           # Issue, Epic, Blocker, Snapshot dataclasses
  metrics.py          # progress, completed, planned, overdue, bugs
  rag.py              # rule engine + overrides
  snapshots.py        # read/write weekly JSON
  sanitize.py         # strip names/mentions from comment text
  summary.py          # optional LLM summary drafting
  deck.py             # python-pptx slide builders
tests/                # fixtures + unit tests
config.yaml
overrides.yaml
.env.example
requirements.txt
README.md
```

**Flow:** load config → fetch issues + changelog → build models → compute metrics → compute RAG → apply overrides → load previous snapshot → (optional summary) → render deck → save snapshot.

**Dependencies:** `requests` (or `httpx`), `python-pptx`, `PyYAML`, `python-dotenv`, `pytest`, optional LLM SDK.

## 10. Jira API Notes

- Search: `GET /rest/api/3/search/jql` (cursor pagination) with `fields` limited to what is needed.
- Changelog: request `expand=changelog` or use `/rest/api/3/issue/{key}/changelog` where needed.
- Comments: `/rest/api/3/issue/{key}/comment?orderBy=-created&maxResults=1` for blocked tickets only (minimizes calls).
- Flagged: usually custom field "Flagged" (`customfield_100xx`) — field ID discovered by `wsr validate` and stored in config.
- Comment bodies use Atlassian Document Format (ADF) — convert to plain text.

## 11. Testing & Acceptance Criteria

**Testing**
- Unit tests for RAG rules (each threshold boundary), overrides, blocker detection, week boundaries/timezone, comment sanitization, snapshot delta.
- Mocked Jira responses (recorded fixtures) for client tests.
- Smoke test: generate a deck from fixtures and assert slide count and that no assignee names appear.

**Acceptance criteria**
1. `wsr generate` produces a .pptx with all slides from 4.7 for a real project week.
2. Overall and per-epic RAG match the rules in 4.4; overrides are shown clearly.
3. Blocked/flagged tickets appear with age and mitigation from the latest comment.
4. No individual names appear in the output.
5. Second week's run shows trend deltas vs the first.
6. Without `--llm-summary`, no external LLM call is made.
7. Credentials never appear in logs, output or snapshots.

## 12. Risks & Assumptions

| # | Item | Mitigation |
|---|---|---|
| 1 | Epics lack due dates → RAG rules can't evaluate | Flag "no due date" in deck and CLI warning; document convention |
| 2 | Story points missing on many issues | Fall back to issue counts; warn |
| 3 | Blocker comments are not mitigation plans or are empty | Show warning marker; prompt owner pre-review |
| 4 | Comments leak names/sensitive info | Sanitizer + length cap + review before sending |
| 5 | Without risk issue types, risks outside Jira's flag/blocked state are missed | Overrides file can support manual notes (future: add manual risk list) |
| 6 | Atlassian API changes (search endpoints) | Isolate in `jira_client.py` |
| 7 | "Planned completion" linear model can misjudge back-loaded plans | Thresholds configurable; override available |

**Assumptions:** The Scrum board and project key are known; the user has API access to read issues, comments and changelog; Epics are used consistently as workstreams and issues are linked to them (parent/epic link).

## 13. Phased Delivery

1. **Phase 1 – MVP:** config, Jira client, metrics, RAG, deck (slides 1–6), CLI, tests.
2. **Phase 2:** snapshots + trend slide, overrides.
3. **Phase 3:** optional LLM summary with review flow, appendix, polish.
4. **Future ideas:** scheduling, email/Teams delivery, corporate template, manual risk register, burndown charts.

## 14. Open Items

- Exact Jira project key, board ID, Flagged and Story Points field IDs (to be discovered via `wsr validate`).
- Whether epics have due dates consistently set.
- LLM provider choice (if the optional summary is used).
- Number of weeks shown on the trend slide (proposed: 6).
~~~~
