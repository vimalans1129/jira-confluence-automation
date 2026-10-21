# Specification Review: Gaps, Contradictions, and Unclear Requirements

**Reviewed**: [constitution.md](./constitution.md), [specification.md](./specification.md), and [plan.md](./plan.md)
**Reviewer role**: Senior developer
**Date**: 2026-10-21
**Revision**: 3, after all findings from revisions 1 and 2 were resolved

## Summary

| Category | Total | Resolved | Partially resolved | Open |
|----------|-------|----------|--------------------|------|
| Contradictions | 9 | 9 | 0 | 0 |
| Gaps | 17 | 17 | 0 | 0 |
| Unclear requirements | 14 | 14 | 0 | 0 |
| New findings (revision 2) | 8 | 8 | 0 | 0 |
| **Total** | **48** | **48** | **0** | **0** |

**Verdict**: No open findings remain. The constitution, specification, and plan agree, and every item below points to the requirement or definition that resolves it. The next step is the analyze pass, then Phase 0 of the plan.

Severity: **Blocker** stops planning, **High** causes rework if guessed, **Medium** is a quality risk, **Low** is polish.

## 1. Contradictions

| ID | Severity | Resolution |
|----|----------|------------|
| C-01 | Blocker | The specification is a React, Express, PostgreSQL web application; the CLI design is removed. |
| C-02 | Blocker | Confluence is out of scope (Non-Goals); the constitution is scoped to Jira. |
| C-03 | High | TypeScript with `npm`; the plan converts the placeholder files. |
| C-04 | High | REST API, health endpoint, correlation IDs, and job status are requirements (FR-040, FR-043, FR-045, NFR-007). |
| C-05 | High | History lives in PostgreSQL (FR-023, FR-046). |
| C-06 | High | The constitution applies the audit and dry-run rule for Atlassian writes only if writes are added; settings and overrides are audited (FR-047). |
| C-07 | Medium | Comments are used only for risk mitigation and never sent to the LLM (FR-006, DEF-12). |
| C-08 | Medium | One term, blocker age (DEF-04). |
| C-09 | Medium | Default week is the most recent completed week (FR-007, DEF-01). |

## 2. Gaps

| ID | Severity | Resolution |
|----|----------|------------|
| G-01 | Blocker | One shared access level, mandatory sign-in (FR-048 to FR-051). |
| G-02 | High | Jira failure cases map to stable error codes, HTTP statuses, and messages (DEF-13); retry policy in FR-005. |
| G-03 | High | The changelog is the source for blocked time (DEF-04, DEF-14). |
| G-04 | High | Flag start comes from the latest uncleared changelog event (DEF-04). |
| G-05 | High | Points or counts basis with a zero-points fallback (DEF-02). |
| G-06 | High | Epic start rule (DEF-03). |
| G-07 | High | Sub-tasks excluded (DEF-02); cross-project links ignored and moved issues use the current Epic (DEF-16). |
| G-08 | High | Completed, empty, and not-started Epics (DEF-03, DEF-10). |
| G-09 | Medium | Defined measure and rounding (DEF-07). |
| G-10 | Medium | Comparison with the most recent earlier snapshot (FR-024, DEF-11). |
| G-11 | Medium | Past weeks are best effort; snapshots are the record (DEF-01). |
| G-12 | Medium | Sanitizer applies to comments and issue summaries, with a configurable name denylist; Epic names are trusted labels (FR-034). |
| G-13 | Medium | Prompts and responses are not logged (FR-053); the organization approves the provider, documented in the README (DEF-12). |
| G-14 | Medium | Deck naming, replacement, and database storage (FR-042). |
| G-15 | Medium | Settings validated on load and on save (FR-036). |
| G-16 | Low | Deck design checklist with minimum font sizes, text with RAG color, and chart text alternatives (FR-029). |
| G-17 | Low | The plan maps stories to requirements and milestones. |

## 3. Unclear Requirements

| ID | Severity | Resolution |
|----|----------|------------|
| U-01 | High | Planned-completion formula and zero case (DEF-03). |
| U-02 | High | Overdue numerator and denominator (DEF-02). |
| U-03 | High | Active sprint through the Agile API with a fallback (DEF-06). |
| U-04 | High | Final state at period end decides "moved to Done" (DEF-05). |
| U-05 | High | Worst-wins among incomplete Epics (DEF-10). |
| U-06 | Medium | All project bugs counted (FR-014). |
| U-07 | Medium | At most 10 rows per slide and 25 slides, with a warning when exceeded (FR-031). |
| U-08 | Medium | Reference benchmark: 5,000 issues, 12 changelog entries each, 150 ms latency, 4 vCPU runner; targets in NFR-003 (DEF-15). |
| U-09 | Medium | The slide 1 generated date is excluded from determinism (NFR-004). |
| U-10 | Medium | "n/a" rules (FR-024). |
| U-11 | Medium | Fields allowed to the LLM are listed (DEF-12). |
| U-12 | Medium | Node.js 24 LTS pinned in `.nvmrc` (plan, Technical Context). |
| U-13 | Low | Review target of 15 minutes or less (SC-008). |
| U-14 | Low | Deck design checklist (FR-029). |

## 4. Findings From Revision 2

| ID | Severity | Resolution |
|----|----------|------------|
| N-01 | Medium | Constitution v1.1.0 is scoped to Jira, with Confluence and write rules applying only if added. |
| N-02 | Medium | Precedence: secrets and connection values from environment variables only; report settings in the database with code defaults (FR-036). |
| N-03 | Medium | Startup recovery of interrupted jobs, 10-minute timeout, one active job per week (FR-043). |
| N-04 | Medium | Decks are stored per week; approving a summary marks the deck out of date and regeneration needs no Jira calls (FR-042, plan API outline). |
| N-05 | Medium | Overrides apply to one week and are offered for confirmation in the next (FR-022). |
| N-06 | Medium | Field discovery selects only a single match and otherwise requires a user choice (FR-052). |
| N-07 | High | Changelog read once per issue, derived history cached, incremental sync with overlap, concurrency cap of 5 (FR-055, DEF-14). |
| N-08 | Low | Rotation of the password hash and session secret is documented, and changing the secret invalidates sessions (FR-056). |

## 5. Recommended Next Steps

1. Run the Spec Kit analyze step across the constitution, specification, and plan to confirm they remain consistent.
2. Generate the task list from the plan, starting with Phase 0.
3. Re-run this review if the specification changes materially.
