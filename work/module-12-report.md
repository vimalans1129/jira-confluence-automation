# Module 12 Completion Report

## Instruction File
- Filename: Instructions/calculate-weekly-metrics.agent.md

```markdown
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
```

## Script File
- Filename: tools/calculate_metrics.py
- Language: Python

```python
"""Calculate weekly status report metrics (backlog.md section 2.3, FR-7 to FR-12).

Input is a JSON file containing a list of issues (or {"issues": [...]}) using the
`Issue` fields: key, summary, type, status, status_category, epic_key, story_points,
due, created, resolved, updated, done_at, blocked_since, flagged, labels and the
optional in_active_sprint.
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

UNASSIGNED = "Unassigned to epic"


def parse_dt(value, tz):
    """Parse an ISO 8601 date/datetime into a tz-aware datetime (naive values get tz)."""
    if not value:
        return None
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt.replace(tzinfo=tz) if dt.tzinfo is None else dt.astimezone(tz)


def parse_due(value, tz):
    dt = parse_dt(value, tz)
    return dt.date() if dt else None


def week_bounds(week_of: date) -> tuple[date, date]:
    """Monday-Sunday bounds of the week containing week_of."""
    monday = week_of - timedelta(days=week_of.weekday())
    return monday, monday + timedelta(days=6)


def in_range(d, start: date, end: date) -> bool:
    return d is not None and start <= d <= end


def normalize(raw: dict, tz) -> dict:
    cat = (raw.get("status_category") or "").strip().lower()
    done_at = parse_dt(raw.get("done_at"), tz)
    resolved = parse_dt(raw.get("resolved"), tz)
    return {
        "key": raw.get("key"),
        "summary": raw.get("summary") or "",
        "type": (raw.get("type") or "").strip(),
        "status": raw.get("status") or "",
        "category": cat,
        "is_done": cat == "done",
        "epic_key": raw.get("epic_key") or None,
        "points": raw.get("story_points"),
        "due": parse_due(raw.get("due"), tz),
        "created": parse_dt(raw.get("created"), tz),
        "updated": parse_dt(raw.get("updated"), tz),
        "done_at": done_at or resolved,
        "blocked_since": parse_dt(raw.get("blocked_since"), tz),
        "flagged": bool(raw.get("flagged")),
        "sprint": bool(raw.get("in_active_sprint")),
    }


def weight(issue: dict, use_points: bool) -> float:
    return (issue["points"] or 0) if use_points else 1


def iso(d):
    return d.isoformat() if d else None


def calculate_metrics(raw_issues, start: date, end: date, blocked_statuses, tz) -> dict:
    warnings = []
    issues = [normalize(r, tz) for r in raw_issues]
    epics = {i["key"]: i for i in issues if i["type"].lower() == "epic"}
    work = [i for i in issues if i["type"].lower() != "epic"]
    blocked_set = {s.strip().lower() for s in blocked_statuses}
    next_start, next_end = end + timedelta(days=1), end + timedelta(days=7)

    def group_name(i):
        return i["epic_key"] if i["epic_key"] else UNASSIGNED

    unassigned = [i["key"] for i in work if not i["epic_key"]]
    if unassigned:
        warnings.append(f"{len(unassigned)} issue(s) have no epic: {', '.join(unassigned)}")
    unknown = sorted({i["epic_key"] for i in work if i["epic_key"] and i["epic_key"] not in epics})
    if unknown:
        warnings.append(f"Epic(s) referenced but not in input: {', '.join(unknown)}")

    by_epic = defaultdict(list)
    for i in work:
        by_epic[group_name(i)].append(i)

    def label(key):
        return epics[key]["summary"] if key in epics else key

    # FR-7 milestone progress
    progress = []
    for key in sorted(set(by_epic) | set(epics)):
        items = by_epic.get(key, [])
        use_points = any(i["points"] is not None for i in items)
        if items and not use_points:
            warnings.append(f"{key}: no story points; using issue counts")
        elif use_points and any(i["points"] is None for i in items):
            warnings.append(f"{key}: some issues lack story points (counted as 0)")
        total = sum(weight(i, use_points) for i in items)
        done = sum(weight(i, use_points) for i in items if i["is_done"])
        due = epics[key]["due"] if key in epics else None
        if key in epics and due is None:
            warnings.append(f"{key}: epic has no due date")
        counts = defaultdict(int)
        for i in items:
            counts[i["category"] or "unknown"] += 1
        progress.append({
            "epic": key, "name": label(key), "basis": "points" if use_points else "issues",
            "total": total, "done": done,
            "percent_complete": round(done / total * 100, 1) if total else 0.0,
            "status_counts": dict(counts),
            "due": iso(due), "days_to_due": (due - end).days if due else None,
        })

    # FR-8 completed this week
    def grouped(selected, extra=None):
        out = []
        for key in sorted({group_name(i) for i in selected}):
            grp = [i for i in selected if group_name(i) == key]
            use_points = any(i["points"] is not None for i in by_epic[key])
            out.append({
                "epic": key, "name": label(key), "count": len(grp),
                "points": sum(i["points"] or 0 for i in grp),
                "issues": [{"key": i["key"], "summary": i["summary"], "status": i["status"],
                            "points": i["points"], "due": iso(i["due"]), **(extra(i) if extra else {})}
                           for i in sorted(grp, key=lambda x: x["key"])],
            })
        return out

    completed = [i for i in work if i["is_done"] and i["done_at"] and in_range(i["done_at"].date(), start, end)]

    # FR-9 planned next week
    planned = [i for i in work
               if i["category"] in ("to do", "in progress")
               and (in_range(i["due"], next_start, next_end) or i["sprint"])]

    # FR-10 blockers/risks
    def age(i):
        since = i["blocked_since"] or i["updated"]
        return max((end - since.date()).days, 0) if since else None

    blockers = [i for i in work
                if not i["is_done"] and (i["flagged"] or i["status"].strip().lower() in blocked_set)]
    blockers_out = grouped(blockers, lambda i: {
        "flagged": i["flagged"], "age_days": age(i),
    })
    flat_blockers = sorted(
        (b for g in blockers_out for b in ({**x, "epic": g["epic"]} for x in g["issues"])),
        key=lambda x: -(x["age_days"] or 0))

    # FR-11 overdue
    overdue = [i for i in work if not i["is_done"] and i["due"] and i["due"] < end]
    overdue_out = grouped(overdue, lambda i: {"days_overdue": (end - i["due"]).days})

    # FR-12 bugs
    bugs = [i for i in work if i["type"].lower() == "bug"]
    bug_metrics = {
        "opened": sum(1 for b in bugs if b["created"] and in_range(b["created"].date(), start, end)),
        "closed": sum(1 for b in bugs if b["is_done"] and b["done_at"] and in_range(b["done_at"].date(), start, end)),
        "currently_open": sum(1 for b in bugs if not b["is_done"]),
    }

    return {
        "period": {"start": iso(start), "end": iso(end),
                   "iso_week": f"{start.isocalendar().year}-W{start.isocalendar().week:02d}"},
        "milestone_progress": progress,
        "completed_this_week": grouped(completed),
        "planned_next_week": grouped(planned),
        "blockers": {"count": len(flat_blockers), "items": flat_blockers},
        "overdue": {"count": len(overdue), "by_epic": overdue_out},
        "bugs": bug_metrics,
        "warnings": warnings,
    }


def format_text(m: dict) -> str:
    p = m["period"]
    lines = [f"Week {p['iso_week']} ({p['start']} to {p['end']})", "", "Milestone progress:"]
    for e in m["milestone_progress"]:
        lines.append(f"  {e['epic'] if e['name'] == e['epic'] else e['epic'] + ' ' + e['name']}: {e['done']:g}/{e['total']:g} {e['basis']} "
                     f"({e['percent_complete']}%), due {e['due'] or 'n/a'}, days to due {e['days_to_due']}")
    for title, groups in (("Completed this week", m["completed_this_week"]),
                          ("Planned next week", m["planned_next_week"]),
                          ("Overdue", m["overdue"]["by_epic"])):
        lines += ["", f"{title}:"]
        for g in groups:
            lines.append(f"  {g['name']} ({g['count']} issues, {g['points']:g} pts)")
            lines += [f"    - {i['key']} {i['summary']}" for i in g["issues"]]
    lines += ["", f"Blockers/risks ({m['blockers']['count']}):"]
    lines += [f"  - {b['key']} [{b['epic']}] age {b['age_days']} days: {b['summary']}"
              for b in m["blockers"]["items"]]
    b = m["bugs"]
    lines += ["", f"Bugs: opened {b['opened']}, closed {b['closed']}, currently open {b['currently_open']}"]
    if m["warnings"]:
        lines += ["", "Warnings:"] + [f"  - {w}" for w in m["warnings"]]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Calculate weekly status report metrics from a JSON issue export.")
    parser.add_argument("issues_file", type=Path, help="JSON file with a list of issues (or {'issues': [...]})")
    parser.add_argument("--week-of", type=date.fromisoformat, default=None,
                        help="Any date (YYYY-MM-DD) in the reporting week; default: today in --timezone")
    parser.add_argument("--timezone", default="UTC", help="IANA timezone for week bounds (default: UTC)")
    parser.add_argument("--blocked-statuses", nargs="+", default=["Blocked"],
                        help="Status names treated as blocked, case-insensitive (default: Blocked)")
    parser.add_argument("--format", choices=["json", "text"], default="json", help="Output format (default: json)")
    parser.add_argument("--out", type=Path, default=None, help="Write output to this file instead of stdout")
    args = parser.parse_args()

    try:
        tz = timezone.utc if args.timezone.upper() == "UTC" else ZoneInfo(args.timezone)
    except Exception:
        parser.error(f"unknown timezone: {args.timezone} (on Windows, `pip install tzdata`)")
    try:
        data = json.loads(args.issues_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        parser.error(f"cannot read issues file: {exc}")
    raw = data.get("issues") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        parser.error("issues file must contain a list of issues")

    week_of = args.week_of or datetime.now(timezone.utc).astimezone(tz).date()
    start, end = week_bounds(week_of)
    metrics = calculate_metrics(raw, start, end, args.blocked_statuses, tz)
    output = json.dumps(metrics, indent=2) if args.format == "json" else format_text(metrics)

    if args.out:
        args.out.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    for w in metrics["warnings"]:
        print(f"WARNING: {w}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

## Script Execution Output
Command: `python tools\calculate_metrics.py --help`

```
usage: calculate_metrics.py [-h] [--week-of WEEK_OF] [--timezone TIMEZONE]
                            [--blocked-statuses BLOCKED_STATUSES [BLOCKED_STATUSES ...]]
                            [--format {json,text}] [--out OUT]
                            issues_file

Calculate weekly status report metrics from a JSON issue export.

positional arguments:
  issues_file           JSON file with a list of issues (or {'issues': [...]})

options:
  -h, --help            show this help message and exit
  --week-of WEEK_OF     Any date (YYYY-MM-DD) in the reporting week; default:
                        today in --timezone
  --timezone TIMEZONE   IANA timezone for week bounds (default: UTC)
  --blocked-statuses BLOCKED_STATUSES [BLOCKED_STATUSES ...]
                        Status names treated as blocked, case-insensitive
                        (default: Blocked)
  --format {json,text}  Output format (default: json)
  --out OUT             Write output to this file instead of stdout
```

## Script Execution With Sample Data
Sample input file: `tools/sample_issues.json`

```json
[
{"key":"E-1","summary":"Schema migration","type":"Epic","status":"In Progress","status_category":"In Progress","due":"2026-10-20"},
{"key":"E-2","summary":"Pipeline migration","type":"Epic","status":"To Do","status_category":"To Do","due":"2026-11-30"},
{"key":"A-1","summary":"Migrate customer tables","type":"Story","status":"Done","status_category":"Done","epic_key":"E-1","story_points":5,"done_at":"2026-10-07T10:00:00Z"},
{"key":"A-2","summary":"Migrate orders tables","type":"Story","status":"Blocked","status_category":"In Progress","epic_key":"E-1","story_points":3,"blocked_since":"2026-10-01T00:00:00Z","due":"2026-10-05"},
{"key":"A-3","summary":"Validate row counts","type":"Task","status":"To Do","status_category":"To Do","epic_key":"E-1","story_points":2,"due":"2026-10-14"},
{"key":"B-1","summary":"Port ETL job","type":"Story","status":"In Progress","status_category":"In Progress","epic_key":"E-2","story_points":8,"in_active_sprint":true,"flagged":true,"updated":"2026-10-06T00:00:00Z"},
{"key":"B-2","summary":"Rounding bug","type":"Bug","status":"To Do","status_category":"To Do","epic_key":"E-2","story_points":1,"created":"2026-10-08T00:00:00Z"},
{"key":"B-3","summary":"Old bug fixed","type":"Bug","status":"Done","status_category":"Done","epic_key":"E-2","story_points":1,"created":"2026-09-20T00:00:00Z","done_at":"2026-10-08T09:00:00Z"},
{"key":"C-1","summary":"Misc cleanup","type":"Task","status":"To Do","status_category":"To Do","story_points":1}
]
```

Command: `python tools\calculate_metrics.py tools\sample_issues.json --week-of 2026-10-09 --format text`

```
Week 2026-W41 (2026-10-05 to 2026-10-11)

Milestone progress:
  E-1 Schema migration: 5/10 points (50.0%), due 2026-10-20, days to due 9
  E-2 Pipeline migration: 1/10 points (10.0%), due 2026-11-30, days to due 50
  Unassigned to epic: 0/1 points (0.0%), due n/a, days to due None

Completed this week:
  Schema migration (1 issues, 5 pts)
    - A-1 Migrate customer tables
  Pipeline migration (1 issues, 1 pts)
    - B-3 Old bug fixed

Planned next week:
  Schema migration (1 issues, 2 pts)
    - A-3 Validate row counts
  Pipeline migration (1 issues, 8 pts)
    - B-1 Port ETL job

Overdue:
  Schema migration (1 issues, 3 pts)
    - A-2 Migrate orders tables

Blockers/risks (2):
  - A-2 [E-1] age 10 days: Migrate orders tables
  - B-1 [E-2] age 5 days: Port ETL job

Bugs: opened 1, closed 1, currently open 1

Warnings:
  - 1 issue(s) have no epic: C-1
```

stderr: `WARNING: 1 issue(s) have no epic: C-1`

Manually verified against the sample data: all figures above (progress, completed, planned, overdue, blockers, bugs) match hand calculations.
