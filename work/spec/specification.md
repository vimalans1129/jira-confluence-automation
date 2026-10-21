# Feature Specification: Weekly Status Report Generator

**Feature Branch**: `001-weekly-status-report`
**Created**: 2026-10-21
**Status**: Draft
**Source**: [project_spec.md](../project_spec.md) (post-interview v1.0)
**Constitution**: [constitution.md](./constitution.md)
**Input**: Automate the weekly stakeholder status report for a 10-person Teradata → Databricks migration team by pulling data from Jira Cloud and producing a PowerPoint (`.pptx`) deck with overall RAG status, milestone progress, and key risks and issues with mitigation plans.

## Overview

The delivery manager currently prepares the weekly status report by hand. This feature produces the report from Jira data with one command and a short review. It gives consistent, rule-based RAG (Red/Amber/Green) status with manual override, and shows week-over-week trends.

### Goals

- Reduce manual report preparation to a single run plus a short review.
- Provide consistent, rule-based RAG status, with a documented manual override.
- Show week-over-week trends.

### Non-Goals (v1)

- Scheduling or automatic distribution (email, Teams, Slack).
- Per-person workload or performance reporting.
- Writing back to Jira.
- A web user interface.

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
- Q: How is it run? → A: Manually, once a week.
- Q: Is an LLM involved? → A: Optionally, for an executive summary that the user always reviews before sending.
- Q: How is history kept? → A: Weekly snapshots stored locally.
- Q: Privacy? → A: No individual names in the deck.

### Open Items

- [NEEDS CLARIFICATION: exact Jira project key, board ID, and the field IDs for Flagged and Story Points; to be discovered through the validation check (FR-028).]
- [NEEDS CLARIFICATION: whether Epics consistently have due dates set; RAG rules depend on them.]
- [NEEDS CLARIFICATION: LLM provider, if the optional summary is used.]
- [NEEDS CLARIFICATION: number of weeks shown on the trend slide; proposed default is 6.]
- Resolved 2026-10-21: this feature remains a command-line tool with file-based snapshots and no web UI. The stack in `constitution.md` is being revised separately and will be aligned before planning.

## User Scenarios & Testing

### User Story 1 - Generate the weekly deck (Priority: P1)

As the delivery manager, I run one command for a given week and receive a PowerPoint deck with executive summary, milestone progress, completed work, planned work, and key risks and issues, so that I can review and send it to stakeholders without manual data gathering.

**Why this priority**: This is the core value of the feature; without it there is no report.

**Independent Test**: Run the generator against a fixture Jira dataset and verify the deck contains all required slides with the expected figures.

**Acceptance Scenarios**:

1. **Given** valid Jira credentials and a configured project, **When** the user generates the report without specifying a week, **Then** a deck is produced for the default reporting week with a title slide, executive summary, milestone progress, completed this week, planned next week, and key risks and issues slides.
2. **Given** the user specifies a week by any date in it, **When** the report is generated, **Then** the period is the Monday to Sunday week containing that date, in the configured time zone.
3. **Given** a project with up to about 5,000 issues, **When** the report is generated, **Then** the run completes in under 2 minutes.
4. **Given** the same Jira data, configuration, and overrides, **When** the report is generated twice without the LLM summary, **Then** the two decks have identical content.

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
7. **Given** an override for an Epic or the overall project with a reason, **When** the report is generated, **Then** the deck shows the overridden status and notes it (for example "Manually set to Amber: vendor dependency").
8. **Given** an override without a reason, **When** the report is generated, **Then** the run fails with a clear error naming the invalid override.
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

1. **Given** a previous week's snapshot exists, **When** the report is generated, **Then** RAG changes are shown with arrows (▲ ▼ ▬) and percent-complete deltas are shown per Epic.
2. **Given** no previous snapshot, **When** the report is generated, **Then** deltas display "n/a".
3. **Given** a report is generated for a week that already has a snapshot, **When** the run completes, **Then** that week's snapshot is overwritten, not duplicated.
4. **Given** several weeks of snapshots, **When** the report is generated, **Then** the trend slide shows RAG and percent complete over the past N weeks.

---

### User Story 5 - Reviewed LLM executive summary (Priority: P3)

As the delivery manager, I can optionally have a draft executive summary written for me, edit it, and include it in the deck, so that narrative preparation is faster without risking unreviewed content.

**Why this priority**: It is optional polish; the deterministic report is complete without it.

**Independent Test**: Enable the summary option, confirm a draft file is created and no deck contains it until the user opts to include it.

**Acceptance Scenarios**:

1. **Given** the summary option is not enabled, **When** the report is generated, **Then** no call is made to any external LLM service.
2. **Given** the summary option is enabled, **When** the report is generated, **Then** an editable draft summary file is written for the week and no unreviewed summary is placed in the deck.
3. **Given** the user has reviewed or edited the draft, **When** the user generates the report with the use-summary option, **Then** the reviewed text appears in the executive summary slide.
4. **Given** data is sent to the LLM, **When** the request is built, **Then** it contains only aggregated, name-free data.

---

### User Story 6 - Validate the setup (Priority: P2)

As the delivery manager, I can check that my Jira connection and configuration are correct before generating a report, so that I find setup problems early.

**Why this priority**: It prevents confusing failures during report generation and discovers the field IDs left open above.

**Independent Test**: Run the validation check with good and bad credentials, project keys, and field settings.

**Acceptance Scenarios**:

1. **Given** valid credentials and configuration, **When** the validation check runs, **Then** it confirms connectivity, project, board, and Story Points field, and reports the discovered Flagged field ID.
2. **Given** invalid credentials, an unknown project key, or a missing Story Points field, **When** the validation check runs, **Then** it reports a clear, specific error for each problem.

---

### Edge Cases

- Story points are missing on many issues: fall back to issue counts and warn.
- An Epic has no child issues: show it with zero totals and no division errors.
- Jira rate limiting (HTTP 429) or transient failures occur: retry with backoff, honoring `Retry-After`; fail clearly after the retry limit.
- Partial data problems (for example an issue missing a parent Epic): continue, and surface warnings in the console and the deck appendix.
- A table has more rows than fit on a slide: continue it across additional slides and truncate long text with an ellipsis.
- The reporting week spans a month or year boundary, or a daylight-saving change: week boundaries are computed in the configured time zone.
- The overrides file names an Epic that does not exist: warn and ignore that entry.
- Issues without an Epic: group them under a clearly labeled "No Epic" group.
- Comment bodies use Atlassian Document Format: convert to plain text before display.

## Requirements

### Functional Requirements

#### Data extraction

- **FR-001**: System MUST authenticate to Jira Cloud (REST API v3) using email and API token supplied through environment variables or a git-ignored `.env` file.
- **FR-002**: System MUST fetch all issues in the configured project, with pagination, including key, summary, type, status, status category, Epic or parent, story points, due date, created, resolved, updated, flagged state, and labels.
- **FR-003**: System MUST determine what was completed and what changed within the reporting week from the issue changelog, resolution date, or status transitions.
- **FR-004**: The Story Points field ID MUST be configurable.
- **FR-005**: System MUST handle rate limiting and transient errors with bounded retries and backoff.
- **FR-006**: System MUST fetch the latest comment only for flagged or blocked tickets, to minimize API calls.

#### Reporting period

- **FR-007**: The default period MUST be the most recent completed or current Monday to Sunday week.
- **FR-008**: Users MUST be able to select any week by date and to set the time zone, with the configured time zone as the default.

#### Metrics and derivations

- **FR-009**: Milestone progress per Epic MUST show total and completed story points, percent complete, issue counts by status category, Epic due date, days to due date, and week-over-week percent delta.
- **FR-010**: Completed this week MUST list issues that moved to Done in the period, grouped by Epic, with story-point totals.
- **FR-011**: Planned next week MUST list In Progress or To Do issues that are due next week or are in the active sprint, grouped by Epic.
- **FR-012**: Risks and issues MUST list all open Flagged or Blocked issues with age in days (time since flagged or since entering Blocked), Epic, and mitigation text.
- **FR-013**: Overdue work MUST be identified as open issues with a due date before the period end.
- **FR-014**: Bugs MUST be summarized as opened during the week, closed during the week, and currently open.

#### RAG calculation

- **FR-015**: RAG MUST be evaluated per Epic and rolled up to overall status as the worst Epic status, unless overridden.
- **FR-016**: Red MUST apply when an Epic is past due and not complete, or any blocker has been open more than 5 days, or planned completion is below 70%.
- **FR-017**: Amber MUST apply when any blocker is open, or more than 10% of due-dated work is overdue, and no Red condition applies.
- **FR-018**: Green MUST apply when no Red or Amber condition applies.
- **FR-019**: All RAG thresholds MUST be configurable.
- **FR-020**: Planned completion MUST be points completed to date divided by points expected by now, assuming linear progress from the Epic start (earliest child created or started) to the Epic due date; Epics without a due date are excluded from this rule and flagged "no due date".
- **FR-021**: The calculated RAG and its triggering reasons MUST be shown.
- **FR-022**: Users MUST be able to override RAG for any Epic or for the overall project through an overrides file, with a mandatory reason; the deck MUST show the overridden status and note the override.

#### Snapshots and trends

- **FR-023**: After each run, the system MUST persist one snapshot per week containing per-Epic RAG, points total and done, blocker count, and overall RAG.
- **FR-024**: The report MUST compare with the previous snapshot to show RAG change arrows and percent-complete deltas, or "n/a" when none exists.
- **FR-025**: Re-running for the same week MUST overwrite that week's snapshot.

#### Optional LLM summary

- **FR-026**: The LLM summary MUST be off by default and enabled only by explicit user choice.
- **FR-027**: A draft summary MUST be written to an editable file and included in the deck only when the user explicitly chooses to use the reviewed summary; only aggregated, name-free data may be sent to the LLM.

#### Validation

- **FR-028**: System MUST provide a validation check for Jira connectivity, project, board, Story Points field, and discovery of the Flagged field ID.

#### Deck generation

- **FR-029**: The deck MUST be 16:9 with a clean default design and consistent RAG colors (green, amber, red).
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

- **FR-031**: Long tables MUST continue across slides, and text MUST be truncated with an ellipsis to fit.
- **FR-032**: Issue keys MUST be hyperlinks to Jira.

#### Privacy

- **FR-033**: No assignee or reporter names may appear anywhere in the deck, including mitigation text.
- **FR-034**: Jira mention markup and account names in comments MUST be replaced with a neutral placeholder before output.
- **FR-035**: Mitigation text MUST be truncated to a configurable length, with a default of 300 characters.

#### Configuration

- **FR-036**: Non-secret settings (Jira base URL, project key, board ID, Story Points field, blocked statuses, report name, time zone, week start, comment length, RAG thresholds, output paths) MUST be held in a committed configuration file.
- **FR-037**: Blocked status names MUST be configurable and matched case-insensitively.

### Non-Functional Requirements

- **NFR-001 Security**: Credentials come only from environment variables or a git-ignored `.env`, and are never logged or written to output or snapshots. Snapshots and output are git-ignored by default.
- **NFR-002 Reliability**: Authentication failure, a bad project key, and a missing Story Points field produce clear errors. Partial data problems appear as warnings in the console and the deck appendix.
- **NFR-003 Performance**: A full run for a project of up to about 5,000 issues completes in under 2 minutes.
- **NFR-004 Determinism**: The same Jira data, configuration, and overrides produce the same deck, excluding the LLM summary.
- **NFR-005 Portability**: Runs on Windows, macOS, and Linux.
- **NFR-006 Testability**: Business logic (metrics, RAG) is separated from input and output so it can be unit tested with fixture data.
- **NFR-007 Observability**: A verbose mode provides detailed logging, and a dry-run mode prints computed metrics and RAG without creating a deck or snapshot.

### Key Entities

- **Issue**: A Jira Epic, Story, Task, or Bug with key, summary, type, status, status category, parent Epic, story points, due date, created, resolved and updated dates, flagged state, and labels.
- **Epic (Workstream)**: A milestone grouping child issues; has a due date, a start date derived from its earliest child, points totals, percent complete, and a RAG status.
- **Blocker (Risk or Issue)**: An open Issue that is Flagged or in a Blocked status; has an age in days and mitigation text taken from its latest comment.
- **Reporting Period**: A Monday to Sunday week in a given time zone.
- **RAG Status**: Red, Amber, or Green, with triggering reasons and an optional manual override and reason.
- **Override**: A user-supplied RAG value with a required reason, for one Epic or the overall project.
- **Snapshot**: A per-week record of per-Epic and overall RAG, points total and done, and blocker count, used for trends.
- **Executive Summary**: Optional narrative text drafted by an LLM, reviewed and edited by the user before inclusion.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A single run produces a deck containing every slide listed in FR-030 for a real project week.
- **SC-002**: Overall and per-Epic RAG match the rules in FR-016 to FR-018 at every threshold boundary, and overrides are clearly shown.
- **SC-003**: Every open Flagged or Blocked ticket appears with its age and mitigation from the latest comment, or an explicit "No mitigation recorded" marker.
- **SC-004**: No individual names appear anywhere in the generated deck.
- **SC-005**: A second week's run shows trend deltas against the first.
- **SC-006**: Without the summary option, no external LLM call is made.
- **SC-007**: Credentials never appear in logs, output, or snapshots.
- **SC-008**: Manual preparation time is reduced to one run plus a short review.

## Assumptions

- The Scrum board and project key are known, and the user has permission to read issues, comments, and the changelog.
- Epics are used consistently as workstreams, and issues are linked to them through the parent or Epic link.
- The Flagged field is a custom Jira field whose ID differs per instance.
- Atlassian search and API endpoints may change; endpoint specifics are isolated in a dedicated client module.

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Epics lack due dates, so RAG rules cannot be evaluated | Flag "no due date" in the deck and console; document the convention |
| 2 | Story points are missing on many issues | Fall back to issue counts and warn |
| 3 | Blocker comments are empty or are not mitigation plans | Show a warning marker and prompt the owner before review |
| 4 | Comments leak names or sensitive information | Sanitizer, length cap, and review before sending |
| 5 | Risks outside Jira's flagged or blocked state are missed | Overrides can carry manual notes; a manual risk list is a future option |
| 6 | Atlassian API changes | Isolate endpoint details in the Jira client module |
| 7 | The linear planned-completion model misjudges back-loaded plans | Configurable thresholds and manual override |

## Phased Delivery

1. **Phase 1, MVP**: Configuration, Jira client, metrics, RAG, slides 1 to 6, run command, tests.
2. **Phase 2**: Snapshots, trend slide, overrides.
3. **Phase 3**: Optional LLM summary with review flow, appendix, polish.
4. **Future ideas**: Scheduling, email or Teams delivery, corporate template, manual risk register, burndown charts.
