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

- [`./Instructions/calculate-compound-interest.agent.md`](./calculate-compound-interest.agent.md) — Calculate compound interest with `tools/compound_interest.py` (when to use, CLI arguments, how to present results).
  + Keywords: compound interest, future value, final amount, interest earned, principal, annual rate
  + Target: `tools/compound_interest.py`
  + Exceptions: no simple interest, recurring contributions, variable rates, or loan amortization.

- [`./Instructions/calculate-weekly-metrics.agent.md`](./calculate-weekly-metrics.agent.md) — Calculate weekly status report metrics with `tools/calculate_metrics.py` (when to use, CLI arguments, input format, how to present results).
  + Keywords: weekly metrics, milestone progress, completed this week, planned next week, blockers, overdue, bugs opened closed
  + Target: `tools/calculate_metrics.py`
  + Exceptions: no RAG, snapshots/deltas, or Jira fetching; input is a JSON issue export.

## Conventions

- Naming: `[action-verb]-[subject].agent.md`.
- Add every new instruction file to the catalog above (with Keywords).
