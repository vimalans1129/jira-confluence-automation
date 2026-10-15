- Calculate the weekly status report metrics (backlog.md §2.3, FR-7 to FR-12) with `tools/calculate_metrics.py` instead of computing by hand.
- **When to use**:
  + The user asks for milestone progress, completed this week, planned next week, blockers, overdue work, or bug counts for the weekly report.
  + Not for RAG status, snapshots/deltas, or fetching from Jira — out of scope for the tool.
- **Invocation**:
  + `python tools/calculate_metrics.py <issues_file> [--week-of YYYY-MM-DD] [--timezone TZ] [--blocked-statuses S [S ...]] [--format json|text] [--out FILE]`
  + `issues_file`: JSON list of issues (or `{"issues": [...]}`) with `Issue` fields: key, summary, type, status, status_category, epic_key, story_points, due, created, resolved, updated, done_at, blocked_since, flagged, optional `in_active_sprint`. Epics are issues with type `Epic`.
  + `--week-of`: any date in the reporting week (default: today); week is Monday–Sunday.
  + `--timezone`: IANA name (default `UTC`); non-UTC on Windows needs `pip install tzdata`.
  + `--blocked-statuses`: case-insensitive status names (default `Blocked`); use the `blocked_statuses` from `config.yaml`.
  + PowerShell example: `python tools\calculate_metrics.py issues.json --week-of 2026-10-09 --format text`
- **Output**: JSON (default) with `period`, `milestone_progress`, `completed_this_week`, `planned_next_week`, `blockers`, `overdue`, `bugs`, `warnings`; or a text summary. Warnings are also printed to stderr.
- **Presenting results**:
  + Report the script's numbers verbatim; do not recompute.
  + Always surface warnings (issues without epic, missing story points, epics without due date).
- **Constraints**:
  + Always run the tool; never present hand-calculated metrics.
  + Do not modify `tools/calculate_metrics.py` as part of a metrics request.
