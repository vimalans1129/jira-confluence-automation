# Module 10 Completion Report

## Instruction Files
```
Mode   LastWriteTime       Length Name
----   -------------       ------ ----
-a---- 08-10-2026 16:10:55  16576 creating-instructions.agent.md
-a---- 08-10-2026 16:29:43   2769 fetch-jira-issues.agent.md
-a---- 08-10-2026 16:03:09   3331 generate-status-report.agent.md
-a---- 08-10-2026 16:29:47   2032 main.agent.md
```

## main.agent.md Contents
~~~markdown
# Instructions Catalog

Entry point for all agent instruction files in this folder. Read the matching file before starting a task.

Each entry below is an instruction file with a one-line description. Optional sub-fields after `+`:
- **Keywords** — trigger words/phrases: if user's request matches, load this instruction.
- **Target** — file glob pattern: if current file or context matches, consider this instruction relevant.
- **Exceptions** — edge cases or clarifications that don't fit in the one-liner.

---

- [`./Instructions/generate-status-report.agent.md`](./generate-status-report.agent.md) — Fill out the weekly status report for the Teradata → Databricks migration and deliver it as a PowerPoint (.pptx) deck.
  + Keywords: status report, weekly report, RAG, milestone progress, pptx deck
  + Target: `reports/**`
  + Exceptions: Markdown is only an intermediate draft, never the final output.

- [`./Instructions/creating-instructions.agent.md`](./creating-instructions.agent.md) — Create, update, and wire up instructions, skills, and IDE entry points (prompts/rules).
  + Keywords: create instruction, update instruction, new instruction, add skill, bootstrap instructions, prompt wrapper, copilot-instructions
  + Target: `Instructions/**`, `.github/**`
  + Exceptions: IDE is VS Code + GitHub Copilot; this project's folder is `Instructions/` (capital I).

- [`./Instructions/fetch-jira-issues.agent.md`](./fetch-jira-issues.agent.md) — Fetch issue data from the Jira Cloud REST API and format it into `Issue` objects (input, processing steps, output, constraints).
  + Keywords: jira, fetch issues, jira api, jira client, changelog, ADF, issue mapping, pagination
  + Target: `**/jira_client.py`, `**/models.py`, `tests/**/test_jira*.py`
  + Exceptions: endpoint specifics stay in `jira_client.py`; metrics/RAG logic is out of scope.

## Conventions

- Naming: `[action-verb]-[subject].agent.md`.
- Add every new instruction file to the catalog above (with Keywords).
~~~

## Sample Instruction
- File: fetch-jira-issues.agent.md
- Contents:
~~~markdown
- Fetch and format issue data from the Jira Cloud REST API into `Issue` objects. Endpoint specifics live only in `jira_client.py`.
- **Input format**:
  + Env/`.env`: `JIRA_BASE_URL` (e.g. `https://acme.atlassian.net`), `JIRA_EMAIL`, `JIRA_API_TOKEN`.
  + `config.yaml`: `project_key`, optional `jql` override, `story_points_field` (e.g. `customfield_10016`), `blocked_statuses`, `timezone`.
  + Runtime: reporting period `start`/`end` (tz-aware, Monday–Sunday).
  + Default JQL: `project = <KEY> AND (updated >= <start> OR statusCategory != Done) ORDER BY key`.
- **Processing steps**:
  + Authenticate with Basic auth (email + API token). Never log credentials.
  + Search with `GET /rest/api/3/search/jql`, limited `fields`: key, summary, issuetype, status, parent, duedate, created, resolutiondate, updated, labels, flagged, story points field.
  + Paginate with `nextPageToken` until `isLast` is true.
  + Request `expand=changelog`; if truncated, fall back to `GET /rest/api/3/issue/{key}/changelog`. Derive Done-transition date and Flagged/Blocked entry date.
  + Fetch latest comment only for blocked/flagged issues.
  + Convert ADF bodies to plain text: paragraphs → newlines, lists → `- `, mentions → display name, unknown nodes → inner text.
  + Map raw issue to `Issue` dataclass (`models.py`); parse timestamps into configured timezone.
  + Strip control characters, collapse whitespace in text fields.
  + Retry on 429 (honor `Retry-After`) and 5xx/network errors with exponential backoff, max 5 attempts, then raise.
- **Output format**: `list[Issue]` ordered by key.
  + `key`: str, e.g. `PROJ-123`.
  + `summary`: plain-text str.
  + `type`: Epic/Story/Bug/Task.
  + `status`, `status_category`: str; category is To Do / In Progress / Done.
  + `epic_key`: str or `None` (`None` → "Unassigned to epic").
  + `story_points`: float or `None` (caller falls back to issue counts).
  + `due`, `created`, `resolved`, `updated`: tz-aware ISO 8601 or `None`.
  + `done_at`, `blocked_since`: datetime or `None`, from changelog.
  + `flagged`: bool.
  + `labels`: list[str].
  + `latest_comment`: plain-text str or `None`.
- **Constraints**:
  + Other modules consume `Issue` only, never raw Jira JSON.
  + Request only needed `fields`; no comments/changelog for unrelated issues.
  + Raise clear errors for auth failure (401/403), bad project key, missing story points field.
  + Warn, don't fail, on missing story points and issues without epic.
  + Never log secrets; apply redaction filter to logs and error messages.
  + Missing/null fields map to `None`, never `KeyError`.
  + Unit tests use recorded fixtures (search, changelog, ADF comments), no network calls.
  + Python 3.10+, `requests` only for HTTP.
~~~
