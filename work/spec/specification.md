# Feature Specification: Weekly Status Report Generator

**Feature Branch**: `001-weekly-status-report`
**Created**: 2026-10-21
**Status**: Draft
**Source**: [project_spec.md](../project_spec.md) (post-interview v1.0)
**Constitution**: [constitution.md](./constitution.md)
**Input**: Automate the weekly stakeholder status report for a 10-person Teradata → Databricks migration team by pulling data from Jira Cloud and producing a PowerPoint (`.pptx`) deck with overall RAG status, milestone progress, and key risks and issues with mitigation plans.

## Overview

The delivery manager currently prepares the weekly status report by hand. This feature is a web application (React frontend, Express backend, PostgreSQL database) that produces the report from Jira data in one action and a short review. It gives consistent, rule-based RAG (Red/Amber/Green) status with manual override, and shows week-over-week trends.

### Goals

- Reduce manual report preparation to a single run plus a short review.
- Provide consistent, rule-based RAG status, with a documented manual override.
- Show week-over-week trends.

### Non-Goals (v1)

- Scheduling or automatic distribution (email, Teams, Slack).
- Per-person workload or performance reporting.
- Writing back to Jira.
- Multiple Jira projects or boards (v1 supports one project and one board).
- Confluence integration, including publishing the report to Confluence.
- A corporate PowerPoint template (the clean default design is used).
- A manual risk register beyond Jira's flagged and blocked tickets.
- Burndown charts.

All items in this list, including the former future ideas, are out of scope for now and need a new specification before work starts.

### Audience

| Audience | Primary interests |
|----------|-------------------|
| Business stakeholders | Overall RAG, milestone progress, key risks |
| IT leadership team | Issues and blockers, mitigation plans, delivery trend |

The deck must be readable by non-technical stakeholders. No individual names appear in the deck; reporting is at team and workstream level only.

## Clarifications

### Session 2026-10-21 (from the stakeholder interview)

- Q: Which Jira product and authentication? → A: Jira Cloud with email and API token.
- Q: How is work structured? → A: One Jira project and one Scrum board; Epics are the milestones and workstreams (for example Discovery, Schema Conversion, Data Migration, ETL/SQL Conversion, Validation, Cutover).
- Q: Which issue types and workflow? → A: Epic, Story, Task, Bug only; statuses To Do, In Progress, Done.
- Q: What counts as a risk or issue? → A: Open tickets that are Flagged (impediment) or in status Blocked.
- Q: Where does the mitigation plan come from? → A: The latest comment on the blocked or flagged ticket.
- Q: What is the effort measure? → A: Story points.
- Q: What is the reporting period? → A: Calendar week, Monday to Sunday, independent of sprints.
- Q: What is the output format and design? → A: PowerPoint, clean default design, no corporate template.
- Q: How is it run? → A: On demand through the web application, once a week.
- Q: Is an LLM involved? → A: Optionally, for an executive summary that the user always reviews before sending.
- Q: How is history kept? → A: Weekly snapshots stored in the PostgreSQL database.
- Q: Privacy? → A: No individual names in the deck.

### Decisions on Former Open Items

- Resolved 2026-10-21 (access control): v1 has a single shared access level. See FR-048 to FR-051.
- Resolved 2026-10-21 (Jira identifiers): the project key, board ID, and field IDs are deployment configuration, not specification content. They are supplied through configuration and confirmed by the validation check (FR-028, FR-052).
- Resolved 2026-10-21 (Epic due dates): Epics without a due date are supported. The planned-completion rule is skipped for them and they are flagged "no due date" (FR-020).
- Resolved 2026-10-21 (formulas and definitions): see the Definitions section (DEF-01 to DEF-16).
- Resolved 2026-10-21 (LLM provider): the summary uses any OpenAI-compatible chat completions endpoint, configured through environment variables, so no provider is hard-coded (FR-053).
- Resolved 2026-10-21 (trend length): the trend shows the last 6 weeks by default, configurable from 4 to 12 (FR-054).
- Resolved 2026-10-21 (project location): the application is built in the existing `weekly-status-report/` folder. Its empty prototype files are replaced; the Python `wsr/` package, `requirements.txt`, file-based `snapshots/` and `output/` folders, `config.yaml`, and `overrides.yaml` are removed.
- Resolved 2026-10-21: the specification is aligned with `constitution.md`. The feature is a web application with a React 18 + Vite frontend, a Node.js + Express backend, and PostgreSQL 15 (Docker). The earlier command-line and file-based design is superseded.
- Resolved 2026-10-21: the application is operated on demand by a user, normally once a week; scheduling remains a non-goal.
- Resolved 2026-10-21: Confluence integration is out of scope for now; the application reads from Jira only.

## User Scenarios & Testing

### User Story 1 - Generate the weekly deck (Priority: P1)

As the delivery manager, I choose a week in the web application and generate a report with an on-screen dashboard and a downloadable PowerPoint deck covering executive summary, milestone progress, completed work, planned work, and key risks and issues, so that I can review and send it to stakeholders without manual data gathering.

**Why this priority**: This is the core value of the feature; without it there is no report.

**Independent Test**: Trigger report generation against a mocked Jira dataset through the API and the UI, and verify the dashboard figures and the downloaded deck contain all required slides with the expected values.

**Acceptance Scenarios**:

1. **Given** valid Jira credentials configured on the server, **When** the user generates the report without choosing a week, **Then** the dashboard shows the default reporting week and a deck can be downloaded with a title slide, executive summary, milestone progress, completed this week, planned next week, and key risks and issues slides.
2. **Given** the user selects a date, **When** the report is generated, **Then** the period is the Monday to Sunday week containing that date, in the configured time zone.
3. **Given** a project with up to about 5,000 issues, **When** the report is generated, **Then** the run meets the performance targets in NFR-003 and the UI shows progress and a final status.
4. **Given** the same Jira data, configuration, and overrides, **When** the report is generated twice without the LLM summary, **Then** the two decks have identical content.
5. **Given** a generation is in progress or has failed, **When** the user views the run, **Then** the UI shows loading, success, or a clear error state, never a blank screen.

---

### User Story 2 - Rule-based RAG status with manual override (Priority: P1)

As the delivery manager, I see a consistent RAG status per Epic and overall, with the reasons that triggered it, and I can override any status with a documented reason, so that stakeholders get a trustworthy status that reflects judgment the data cannot capture.

**Why this priority**: RAG status is the headline stakeholder metric.

**Independent Test**: Feed fixture data at each threshold boundary and verify the calculated RAG and its reasons; add an override and verify it is displayed with its reason.

**Acceptance Scenarios**:

1. **Given** an Epic past its due date and not complete, **When** RAG is calculated, **Then** the Epic is Red.
2. **Given** an Epic with a blocker open more than 5 days, **When** RAG is calculated, **Then** the Epic is Red with the reason shown (for example "Red: 2 blockers > 5 days").
3. **Given** an Epic whose planned story-point completion is below 70%, **When** RAG is calculated, **Then** the Epic is Red.
4. **Given** an Epic with any open blocker, or more than 10% of its due-dated work overdue, and no Red condition, **When** RAG is calculated, **Then** the Epic is Amber.
5. **Given** an Epic with none of the above conditions, **When** RAG is calculated, **Then** the Epic is Green.
6. **Given** several Epics with different statuses, **When** overall RAG is calculated without an override, **Then** overall RAG equals the worst Epic status.
7. **Given** an override for an Epic or the overall project with a reason saved in the web application, **When** the report is generated, **Then** the dashboard and deck show the overridden status and note it (for example "Manually set to Amber: vendor dependency").
8. **Given** an override submitted without a reason, **When** the user saves it, **Then** the API rejects it with a validation error and the UI shows the message next to the field.
9. **Given** an Epic without a due date, **When** RAG is calculated, **Then** the planned-completion rule is skipped for that Epic and it is flagged "no due date".

---

### User Story 3 - Key risks and issues with mitigation (Priority: P1)

As an IT leader, I see every open flagged or blocked ticket with its age, workstream, and mitigation plan, so that I know what needs attention and what is being done about it.

**Why this priority**: Risks and mitigation are a primary interest for the leadership audience.

**Independent Test**: Provide fixture tickets that are flagged, blocked, and neither, with and without comments; verify the risks table content.

**Acceptance Scenarios**:

1. **Given** an open ticket that is Flagged or has status Blocked (case-insensitive), **When** the report is generated, **Then** it appears in the risks table with its key, summary, workstream, and age in days.
2. **Given** a blocker with comments, **When** the report is generated, **Then** the mitigation shown is the most recent comment, truncated to the configured length (default 300 characters).
3. **Given** a comment that contains @mentions or account names, **When** it is shown as mitigation, **Then** the names are replaced with a neutral placeholder such as "the team".
4. **Given** a blocker with no comment, **When** the report is generated, **Then** the deck shows "⚠ No mitigation recorded" and the run lists it as a warning.
5. **Given** a ticket that is Done but still flagged, **When** the report is generated, **Then** it is not listed as a risk.

---

### User Story 4 - Week-over-week trends (Priority: P2)

As a stakeholder, I see how RAG and completion changed since last week and over recent weeks, so that I can judge the direction of delivery.

**Why this priority**: Trends add context but the report is usable without them.

**Independent Test**: Generate reports for two consecutive weeks and verify deltas and the trend slide.

**Acceptance Scenarios**:

1. **Given** an earlier week's snapshot exists in the database, **When** the report is generated, **Then** RAG changes are shown with arrows (▲ ▼ ▬) and percent-complete deltas are shown per Epic.
2. **Given** no previous snapshot, **When** the report is generated, **Then** deltas display "n/a".
3. **Given** a report is generated for a week that already has a snapshot, **When** the run completes, **Then** that week's snapshot is replaced, not duplicated.
4. **Given** several weeks of snapshots, **When** the report is generated, **Then** the dashboard trend chart and the trend slide show RAG and percent complete over the past N weeks.

---

### User Story 5 - Reviewed LLM executive summary (Priority: P3)

As the delivery manager, I can optionally have a draft executive summary written for me, edit it, and include it in the deck, so that narrative preparation is faster without risking unreviewed content.

**Why this priority**: It is optional polish; the deterministic report is complete without it.

**Independent Test**: Enable the summary option, confirm an editable draft is stored and no deck contains it until the user approves it.

**Acceptance Scenarios**:

1. **Given** the summary option is not enabled, **When** the report is generated, **Then** no call is made to any external LLM service.
2. **Given** the summary option is enabled, **When** the report is generated, **Then** an editable draft summary is saved for the week and shown in the UI, and no unreviewed summary is placed in the deck.
3. **Given** the user has reviewed or edited the draft and approved it, **When** the deck is generated, **Then** the approved text appears in the executive summary slide.
4. **Given** data is sent to the LLM, **When** the request is built, **Then** it contains only aggregated, name-free data.

---

### User Story 6 - Validate the setup (Priority: P2)

As the delivery manager, I can check from a settings page that my Jira connection and configuration are correct before generating a report, so that I find setup problems early.

**Why this priority**: It prevents confusing failures during report generation and discovers the Jira field IDs the reports depend on.

**Independent Test**: Call the validation endpoint and use the settings page with good and bad credentials, project keys, and field settings against a mocked Jira.

**Acceptance Scenarios**:

1. **Given** valid credentials and configuration, **When** the validation check runs, **Then** it confirms connectivity, project, board, and Story Points field, and reports the discovered Flagged field ID.
2. **Given** invalid credentials, an unknown project key, or a missing Story Points field, **When** the validation check runs, **Then** it reports a clear, specific error for each problem.
3. **Given** the application is running, **When** the health endpoint is called, **Then** it reports whether the database is reachable.

---

### Edge Cases

- Story points are missing on many issues: fall back to issue counts and warn.
- An Epic has no child issues: show it with zero totals and no division errors.
- Jira rate limiting (HTTP 429) or transient failures occur: retry with backoff, honoring `Retry-After`; fail clearly after the retry limit.
- Partial data problems (for example an issue missing a parent Epic): continue, and surface warnings in the UI, the application log, and the deck appendix.
- A table has more rows than fit on a slide: continue it across additional slides and truncate long text with an ellipsis.
- The reporting week spans a month or year boundary, or a daylight-saving change: week boundaries are computed in the configured time zone.
- An override names an Epic that does not exist: warn and ignore that entry.
- Two users trigger generation for the same week at the same time: the second request is rejected with a clear message (FR-043); it must not produce duplicate snapshots.
- The database is unavailable: the API returns a clear error and the health endpoint reports the failure.
- Issues without an Epic: group them under a clearly labeled "No Epic" group.
- Comment bodies use Atlassian Document Format: convert to plain text before display.

## Requirements

### Functional Requirements

#### Data extraction

- **FR-001**: The backend MUST authenticate to Jira Cloud (REST API v3) using email and API token supplied through server environment variables; credentials MUST NOT be sent to or stored in the browser, and the frontend MUST NOT call Jira directly.
- **FR-002**: System MUST fetch all issues in the configured project, with pagination, including key, summary, type, status, status category, Epic or parent, story points, due date, created, resolved, updated, flagged state, and labels.
- **FR-003**: System MUST determine what was completed and what changed within the reporting week from the stored issue history derived from the Jira changelog (FR-055); the resolution date may be used only to cross-check.
- **FR-004**: The Story Points field ID MUST be configurable as a report setting (FR-036), with discovery by name through the validation check (FR-052).
- **FR-005**: System MUST handle rate limiting and transient errors with bounded retries: up to 5 attempts with exponential backoff (base 1 second, maximum 30 seconds), honoring `Retry-After`, then fail with the error codes in DEF-13.
- **FR-006**: System MUST fetch the latest comment only for flagged or blocked tickets, to minimize API calls. Comments are used only for risk mitigation text; they are never used elsewhere and never sent to the LLM.
- **FR-055**: Jira history MUST be read once per issue and reused: the backend fetches issues with their changelog in paginated searches, stores a compact derived history per issue (status transitions, flag changes, story point changes, no author names) keyed by the Jira `updated` timestamp, and on later runs refetches only issues updated since the last successful sync (DEF-14).

#### Reporting period

- **FR-007**: The default period MUST be the most recent completed Monday to Sunday week; the current in-progress week MUST be selectable and is reported as of the current time (DEF-01).
- **FR-008**: Users MUST be able to select any week by date and to set the time zone, with the configured time zone as the default.

#### Metrics and derivations

- **FR-009**: Milestone progress per Epic MUST show total and completed story points, percent complete, issue counts by status category, Epic due date, days to due date, and week-over-week percent delta.
- **FR-010**: Completed this week MUST list issues that moved to Done in the period (DEF-05), grouped by Epic, with story-point totals.
- **FR-011**: Planned next week MUST list In Progress or To Do issues that are due in the following Monday to Sunday week or are in the active sprint (DEF-06), grouped by Epic.
- **FR-012**: Risks and issues MUST list all open Flagged or Blocked issues with blocker age in days (DEF-04), Epic, and mitigation text.
- **FR-013**: Overdue work MUST be identified as open issues with a due date before the period end.
- **FR-014**: Bugs MUST be summarized as opened during the week, closed during the week, and currently open, counting all project bugs regardless of Epic.

#### RAG calculation

- **FR-015**: RAG MUST be evaluated per Epic and rolled up to overall status as the worst status among Epics that are not complete and have work items (DEF-10), unless overridden.
- **FR-016**: Red MUST apply when an Epic is past due and not complete, or any blocker age exceeds 5 days, or planned completion (DEF-03) is below 70%.
- **FR-017**: Amber MUST apply when any blocker is open, or more than 10% of due-dated work is overdue (DEF-02), and no Red condition applies.
- **FR-018**: Green MUST apply when no Red or Amber condition applies.
- **FR-019**: All RAG thresholds MUST be configurable.
- **FR-020**: Planned completion MUST follow DEF-03; Epics without a due date are excluded from this rule and flagged "no due date".
- **FR-021**: The calculated RAG and its triggering reasons MUST be shown.
- **FR-022**: Users MUST be able to override RAG for any Epic or for the overall project through the web application, with a mandatory reason. An override applies to one reporting week only and does not carry forward; when a user opens a new week, the UI offers the previous week's overrides for confirmation. Overrides are stored in the database, and the dashboard and deck MUST show the overridden status and note the override.

#### Snapshots and trends

- **FR-023**: After each run, the system MUST persist one snapshot per week in PostgreSQL containing per-Epic RAG, points total and done, blocker count, and overall RAG.
- **FR-024**: The report MUST compare with the most recent earlier snapshot (even if weeks were skipped) to show RAG change arrows and percent-complete deltas (DEF-11), or "n/a" when no earlier snapshot exists or the Epic is absent from it.
- **FR-025**: Re-running for the same week MUST replace that week's snapshot.

#### Optional LLM summary

- **FR-026**: The LLM summary MUST be off by default and enabled only by explicit user choice.
- **FR-027**: A draft summary MUST be stored and shown in the UI for editing, and included in the deck only after the user explicitly approves it; only the fields listed in DEF-12 may be sent to the LLM.
- **FR-053**: The LLM client MUST use an OpenAI-compatible chat completions interface configured through `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`; the application MUST work with the summary feature unconfigured. Prompts and responses are not logged; only the approved text is stored.
- **FR-054**: The trend view and slide MUST show the last 6 weeks by default, configurable from 4 to 12 weeks.

#### Validation

- **FR-028**: System MUST provide a validation check, available through the API and the settings page, for Jira connectivity, project, board, Story Points field, and discovery of the Flagged field ID.
- **FR-052**: The validation check MUST discover the Story Points field (a numeric field named "Story Points" or "Story point estimate") and the Flagged field (named "Flagged") and offer to save the discovered IDs as settings. It selects automatically only when exactly one candidate matches; with several candidates it lists each with ID, name, and type and requires the user to choose; with none it reports an error. The project key and board ID are required configuration, and the application MUST refuse to generate reports until validation has passed once.

#### Access control

- **FR-048**: The application MUST require sign-in; v1 has one shared access level and no roles.
- **FR-049**: Sign-in MUST use a single administrator password stored only as a hash in server configuration (`APP_ADMIN_PASSWORD_HASH`), with a signed, `HttpOnly`, `SameSite=Strict`, secure-in-production session cookie and a configurable session lifetime (default 8 hours).
- **FR-050**: Sign-in attempts MUST be rate limited, and state-changing requests MUST be protected against cross-site request forgery.
- **FR-051**: Every `/api/v1` route except the health endpoint and sign-in MUST reject unauthenticated requests; the application is expected to run behind HTTPS in any shared environment. Single sign-on and per-user accounts are out of scope for now.
- **FR-056**: The operations guide MUST document rotating the administrator password hash and the session signing secret; changing the signing secret MUST invalidate all existing sessions.

#### Deck generation

- **FR-029**: The deck MUST be 16:9 with a clean default design and consistent RAG colors (green, amber, red). Design checklist: one title per slide, consistent margins, body text of at least 12 pt and titles of at least 24 pt, RAG always shown as text (for example "Red") alongside color, and a text alternative for any chart.
- **FR-030**: The deck MUST contain these slides in order:

| # | Slide | Content |
|---|-------|---------|
| 1 | Title | Project name, reporting week range, generated date |
| 2 | Executive summary | Overall RAG with change vs last week, key highlights, optional reviewed summary |
| 3 | Milestone progress | Per Epic: RAG, percent complete, points done and total, due date, delta |
| 4 | Completed this week | Grouped by Epic, with point totals |
| 5 | Planned next week | Grouped by Epic |
| 6 | Key risks and issues | Item (key and summary), workstream, age, mitigation plan |
| 7 | Trend (optional) | RAG and percent complete over past N weeks from snapshots |
| 8 | Appendix | RAG rules, data notes, override notes, warnings |

- **FR-031**: Long tables MUST continue across slides with at most 10 rows per slide, and text MUST be truncated with an ellipsis to fit. The deck is limited to 25 slides; if content exceeds this, the remainder is summarized as a count and a warning is recorded.
- **FR-032**: Issue keys MUST be hyperlinks to Jira.

#### Privacy

- **FR-033**: No assignee or reporter names may appear anywhere in the deck, including mitigation text.
- **FR-034**: Jira mention markup and account names in comments and issue summaries MUST be replaced with a neutral placeholder before output, and terms from a configurable name denylist MUST be redacted the same way. Epic names are treated as trusted workstream labels.
- **FR-035**: Mitigation text MUST be truncated to a configurable length, with a default of 300 characters.

#### Configuration

- **FR-036**: Settings follow a fixed precedence. Secrets and connection values (Jira base URL, email, API token, project key, board ID, database URL, session secret, administrator password hash, LLM variables) come from environment variables only and are read-only in the UI. Report settings (Story Points and Flagged field IDs, blocked statuses, report name, time zone, week start, comment length, RAG thresholds, trend weeks, name denylist) are stored in the database and edited on the settings page, with defaults defined in versioned code. All settings are validated on load and on save, and a committed `.env.example` lists every environment variable and contains no secrets.
- **FR-037**: Blocked status names MUST be configurable and matched case-insensitively.

#### Web application and API

- **FR-038**: The frontend MUST provide pages for a dashboard (overall RAG, milestone progress, trend), a report view (completed, planned, risks), RAG overrides, and settings with the validation check.
- **FR-039**: The frontend MUST show loading, empty, and error states for every asynchronous view, validate forms on the client, and meet WCAG 2.1 AA basics (keyboard navigation, labels, contrast); RAG MUST be shown with text or an icon as well as color.
- **FR-040**: The backend MUST expose a REST JSON API under `/api/v1` for reports, snapshots, overrides, validation, and deck download, with consistent status codes and a consistent error shape.
- **FR-041**: The backend MUST validate every request body and query string against a schema, and MUST validate Jira responses before use.
- **FR-042**: The deck MUST be generated by the backend, stored in the database (one per week, replaced on regeneration), and delivered to the browser as a download named `Weekly_Status_<project key>_<week start YYYY-MM-DD>.pptx`; the browser never receives Jira credentials or raw Jira payloads. Approving a summary marks the stored deck out of date, and the user regenerates it from the stored report data without new Jira calls.
- **FR-043**: Report generation MUST run as a tracked job whose status (queued, running, succeeded, failed), start and end time, warnings, and outcome are stored in the database and shown in the UI. Only one active job per week is allowed. On startup, jobs left queued or running are marked failed as "interrupted by restart", and a job that runs longer than 10 minutes is failed.
- **FR-044**: A dry-run mode MUST compute metrics and RAG and show them without creating a deck or snapshot.
- **FR-045**: The backend MUST expose a health endpoint that checks database connectivity.

#### Persistence

- **FR-046**: Snapshots, overrides, job history, approved summaries, and configuration changes made in the application MUST be stored in PostgreSQL 15 through versioned, forward-only migrations, using parameterized queries only.
- **FR-047**: Changes to overrides and settings MUST be recorded in an audit log with timestamp and the changed values, excluding secrets and individual names.

### Non-Functional Requirements

- **NFR-001 Security**: Credentials come only from server environment variables, and are never logged, returned by the API, or written to the database, output, or snapshots. Jira content is treated as untrusted and sanitized before rendering or storage. Dependencies with known high-severity vulnerabilities block a merge.
- **NFR-002 Reliability**: Authentication failure, a bad project key, a missing Story Points field, and database outages produce clear errors. Partial data problems appear as warnings in the UI, the application log, and the deck appendix.
- **NFR-003 Performance**: Measured with the reference benchmark in DEF-15 (5,000 issues): a cold run with no cached history completes in 120 seconds or less; a warm run using cached history completes in 30 seconds or less; deck generation takes 10 seconds or less; dashboard API responses from stored data take 500 ms or less at the 95th percentile.
- **NFR-004 Determinism**: The same Jira data, configuration, overrides, and reference time produce the same deck content, excluding the LLM summary and the generated-date text on slide 1.
- **NFR-005 Portability**: The application runs locally and in CI through Docker Compose, with PostgreSQL pinned to major version 15, and with a single documented set of commands to start the stack.
- **NFR-006 Testability**: Business logic (metrics, RAG) is separated from input and output so it can be unit tested with fixture data. Route tests run against a real PostgreSQL 15 container, frontend logic has component tests, each primary user flow has an end-to-end test, and no test depends on a live Jira instance.
- **NFR-007 Observability**: The backend uses structured logging with request correlation IDs, never logs secrets or personal data, and handles errors centrally.

### Definitions

- **DEF-01 Reporting period**: Monday 00:00 to Sunday 23:59:59 in the configured time zone. The reference time `as_of` is the end of the period, or the current time if the period has not ended. Past weeks are reported with current Jira data (best effort); issue state at period end is derived from the changelog where available.
- **DEF-02 Measurement basis and overdue percentage**: Points are used for an Epic when at least one child issue has story points; otherwise issue counts are used. Unestimated children contribute 0 points and are listed as a warning. Sub-tasks are excluded. Overdue percentage is the basis units of open issues with a due date before the period end, divided by the basis units of all due-dated issues in the Epic (open and Done), times 100; it is not evaluated if no issue has a due date.
- **DEF-03 Planned completion**: Epic start is the Epic's configured start-date field if set, otherwise the earliest first transition to In Progress among its children, otherwise the Epic creation date. Expected points are total points times the share of time elapsed, `clamp((as_of - start) / (due - start), 0, 1)`. Planned completion percent is points done at `as_of` divided by expected points, times 100. The rule is not evaluated, and noted as such, when the Epic has no due date, when the due date is not after the start, or when expected points are zero.
- **DEF-04 Blocker and age**: An open issue is a blocker when it is Flagged or its status matches a configured Blocked status. Blocker age is whole days from the most recent changelog event that set the flag or moved the issue into Blocked (and was not cleared since) to `as_of`. If the event cannot be found, the issue update date is used and a warning is recorded.
- **DEF-05 Moved to Done in the period**: An issue counts once when its status category is Done at `as_of` and its latest transition into Done falls inside the period. An issue reopened after completion and not Done at `as_of` is not counted.
- **DEF-06 Planned next week**: For the current or most recent week, issues in the active sprint (from the Jira Agile API for the configured board) or due in the next Monday to Sunday week; if no sprint is active, only the due-date rule is used and a warning is recorded. For older weeks only the due-date rule is used.
- **DEF-07 Percent complete**: Points done divided by total points (or issue counts per DEF-02), times 100. Displayed rounded to the nearest whole percent; deltas are computed from unrounded values and displayed in percentage points rounded to one decimal.
- **DEF-08 Epic past due**: The Epic due date is before the period end date and not all children are Done.
- **DEF-09 No Epic**: Issues without an Epic are grouped as "No Epic" and are excluded from RAG evaluation but included in completed, planned, risk, and bug lists.
- **DEF-10 Overall roll-up**: Overall RAG is the worst RAG among Epics that have at least one work item and are not fully Done. Fully Done Epics are shown as complete and Green; Epics with no work items are shown with a "no work items" note and excluded. If no Epic qualifies, overall RAG is Green.
- **DEF-11 Snapshot comparison**: The comparison basis is the most recent snapshot earlier than the current week. RAG arrows are ▲ for improved (Red to Amber or Green, Amber to Green), ▼ for worsened, ▬ for unchanged.
- **DEF-12 Data allowed to the LLM**: Overall RAG and per-Epic RAG with reasons, Epic names, points and issue counts, percent complete and deltas, blocker counts and ages, and week range. Issue summaries, comments, labels, assignees, and URLs are never sent. The organization is responsible for approving the configured provider; this is documented in the README.
- **DEF-13 Jira error handling**: Every Jira failure maps to a stable error code, a clear message, and a correlation ID in the standard error shape.

| Condition | Code | HTTP status returned | Message guidance |
|-----------|------|----------------------|------------------|
| Invalid, expired, or revoked token (Jira 401) | `JIRA_AUTH_FAILED` | 502 | Credentials rejected; check email and token |
| Missing permission (Jira 403) | `JIRA_FORBIDDEN` | 502 | Name the missing permission, for example Browse Projects |
| Unknown project or board (Jira 404) | `JIRA_NOT_FOUND` | 502 | Name the project key or board ID |
| Rate limit still exceeded after retries (429) | `JIRA_RATE_LIMITED` | 503 | Retry later |
| Jira 5xx or network failure after retries | `JIRA_UNAVAILABLE` | 503 | Jira is unavailable |
| Response fails schema validation | `JIRA_UNEXPECTED_RESPONSE` | 502 | Report the field that failed |

- **DEF-14 History cache and sync**: The first run reads all issues with changelog in pages of 100, with at most 5 concurrent requests; issues whose changelog is truncated by Jira are completed through the issue changelog endpoint. Each issue's derived history is stored with its Jira `updated` value. Later runs query issues with `updated` at or after the last successful sync (minus a 5-minute overlap) and replace the stored history of those issues. A failed sync does not advance the sync marker. Past-week state at `as_of` is computed from the stored history. Issues deleted in Jira are removed by a periodic full reconciliation of keys.
- **DEF-15 Reference benchmark**: A mocked Jira server serves 5,000 issues with an average of 12 changelog entries each, 100 issues per page, and 150 ms latency per request, with 5 concurrent requests. It runs on a 4 vCPU, 8 GB CI runner with PostgreSQL 15 in Docker. The benchmark is an automated test in Phase 4 and a smoke version runs earlier.
- **DEF-16 Linked and moved issues**: Only issues in the configured project are included; links to other projects are ignored. An issue is grouped under its current parent Epic at `as_of`, even if it moved between Epics during the week.

### Key Entities

- **Issue**: A Jira Epic, Story, Task, or Bug with key, summary, type, status, status category, parent Epic, story points, due date, created, resolved and updated dates, flagged state, and labels.
- **Epic (Workstream)**: A milestone grouping child issues; has a due date, a start date derived from its earliest child, points totals, percent complete, and a RAG status.
- **Blocker (Risk or Issue)**: An open Issue that is Flagged or in a Blocked status; has an age in days and mitigation text taken from its latest comment.
- **Reporting Period**: A Monday to Sunday week in a given time zone.
- **RAG Status**: Red, Amber, or Green, with triggering reasons and an optional manual override and reason.
- **Override**: A user-supplied RAG value with a required reason, for one Epic or the overall project, stored in the database.
- **Snapshot**: A per-week database record of per-Epic and overall RAG, points total and done, and blocker count, used for trends.
- **Report Job**: A tracked generation run with week, status, timing, warnings, the computed report, and a reference to its snapshot and deck.
- **Issue History**: Compact derived history of one Jira issue (status transitions, flag changes, story point changes) cached with the Jira `updated` value, without author names.
- **Stored Deck**: The generated PowerPoint file for one week, with its generation time and an out-of-date flag.
- **Executive Summary**: Optional narrative text drafted by an LLM, stored as a draft, reviewed and edited by the user before approval.
- **Audit Entry**: A record of a change to an override or setting.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A single generation action produces a dashboard and a downloadable deck containing every slide listed in FR-030 for a real project week.
- **SC-002**: Overall and per-Epic RAG match the rules in FR-016 to FR-018 at every threshold boundary, and overrides are clearly shown.
- **SC-003**: Every open Flagged or Blocked ticket appears with its age and mitigation from the latest comment, or an explicit "No mitigation recorded" marker.
- **SC-004**: No individual names appear anywhere in the generated deck or the API responses.
- **SC-005**: A second week's run shows trend deltas against the first.
- **SC-006**: Without the summary option, no external LLM call is made.
- **SC-007**: Credentials never appear in logs, API responses, the database, output, or snapshots.
- **SC-008**: Manual preparation time is reduced to one generation action plus a review of 15 minutes or less.
- **SC-009**: A new developer starts the full stack with the documented Docker Compose and `npm` commands and passes the test suite.

## Assumptions

- The Scrum board and project key are known, and the user has permission to read issues, comments, and the changelog.
- Epics are used consistently as workstreams, and issues are linked to them through the parent or Epic link.
- The Flagged field is a custom Jira field whose ID differs per instance.
- Atlassian search and API endpoints may change; endpoint specifics are isolated in a dedicated client module.
- The backend is the only component that talks to Jira, the database, and any LLM provider.

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Epics lack due dates, so RAG rules cannot be evaluated | Flag "no due date" in the UI and deck; document the convention |
| 2 | Story points are missing on many issues | Fall back to issue counts and warn |
| 3 | Blocker comments are empty or are not mitigation plans | Show a warning marker and prompt the owner before review |
| 4 | Comments leak names or sensitive information | Sanitizer, length cap, and review before sending |
| 5 | Risks outside Jira's flagged or blocked state are missed | Overrides can carry manual notes; a manual risk register is out of scope for now |
| 6 | Atlassian API changes | Isolate endpoint details in the Jira client module |
| 7 | The linear planned-completion model misjudges back-loaded plans | Configurable thresholds and manual override |
| 8 | Web exposure of Jira-derived data | Server-side only Jira access, schema validation, sanitization, and mandatory sign-in (FR-048 to FR-051) |

## Phased Delivery

1. **Phase 0, Foundations**: Docker Compose stack with PostgreSQL 15, migrations, CI, health endpoint, and sign-in.
2. **Phase 1, MVP**: Settings with code defaults, validation check, Jira client with history cache, metrics, RAG, generation API and job tracking, dashboard and report pages, deck slides 1 to 6, tests.
3. **Phase 2**: Snapshots in the database, trend chart and slide, overrides page with audit log.
4. **Phase 3**: Optional LLM summary with review and approval flow, appendix, settings page, polish.
5. **Phase 4**: Hardening and release.
6. **Out of scope for now**: Scheduling, email or Teams delivery, Confluence publishing, corporate template, manual risk register, burndown charts (see Non-Goals).
