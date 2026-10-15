# Instructions: Filling Out the Weekly Status Report

Use [template.md](../reports/template.md) each week for content and structure. See [example.md](../reports/example.md) for a completed report.

## Output format

- **Always produce the final report as a PowerPoint (.pptx) file**, 16:9, saved to `reports/status-report.pptx` (or `reports/status-report-<YYYY-MM-DD>.pptx` to keep history).
- Use one slide per section, in this order: Title (project, period, prepared by, issue date), Executive Summary (with an overall RAG badge), Milestone Progress, Completed This Week, Planned Next Week, Key Risks & Issues, Trend (optional), Notes.
- Tables (Milestone Progress, Key Risks & Issues, Trend) must be real PowerPoint tables; colour RAG cells Green/Amber/Red.
- Paginate long tables across slides; keep text readable (no overflow).
- Do not deliver Markdown as the final output. A `.md` draft may be used only as an intermediate step.
- Generate the deck with `python-pptx`; delete any temporary build script afterwards.

## General rules

- Audience is business stakeholders and IT leadership: use plain language, avoid jargon.
- **Never include individual names.** Refer to teams or workstreams only.
- Reporting period is the calendar week, Monday–Sunday.
- Keep each cell to one or two short sentences.
- Replace every `<placeholder>`; delete optional sections you don't use (Trend).

## RAG rules

| RAG | Criteria |
|---|---|
| **Red** | Epic past its due date and not complete; **or** any blocker open > 5 days; **or** planned story-point completion < 70% |
| **Amber** | Any open blocker; **or** > 10% of due-dated work overdue |
| **Green** | None of the above |

Overall RAG is the worst status justified by the workstreams, unless manually overridden. If you override, state it in section 8 with the reason (e.g., "Manually set to Amber: vendor dependency").

## Section by section

1. **Overall Status** — Set the RAG, the trend arrow versus last week (▲ improved, ▼ worsened, ▬ unchanged, n/a if no prior report), and a one-line reason.
2. **Executive Summary** — Two or three highlights, one or two concerns, and any decisions or support needed. Write "None" if there are no asks.
3. **Milestone Progress** — One row per epic/workstream. % complete = completed story points ÷ total story points. Δ is the change in percentage points versus last week. Include the epic due date and the reason for any Amber/Red.
4. **Completed This Week** — Outcomes delivered in the period, grouped by workstream, with story points.
5. **Planned Next Week** — The main focus per workstream.
6. **Key Risks & Issues** — List tickets that are Flagged or Blocked. Days open = days since flagged/blocked. Impact is Low, Med or High. Mitigation plan comes from the latest comment on the ticket; make sure it states an action and a target date.
7. **Trend** — Optional; last 4–6 weeks from previous reports.
8. **Notes** — Record overrides and data caveats (e.g., epics without due dates). Write "None" if not applicable.

## Before sending

- [ ] Dates and period are correct
- [ ] RAG matches the rules, or the override is explained
- [ ] No individual names
- [ ] Every Red/Amber item has a reason and mitigation
- [ ] Numbers are consistent between sections
