# Weekly Status Report — Teradata → Databricks Migration

**Reporting period:** 2026-10-05 to 2026-10-11 (Mon–Sun)
**Prepared by:** Delivery Manager
**Date issued:** 2026-10-12

---

## 1. Overall Status

| Overall RAG | Change vs. last week | Reason |
|---|---|---|
| Amber | n/a | One open blocker on Data Migration (3 days); all other work is on track. |

## 2. Executive Summary

- **Highlights:** Three features were delivered this week: stored procedure conversion, historical table loads and the validation test plan.
- **Concerns:** Access to the production data source is not yet granted and has paused the next Data Migration loads.
- **Decisions / support needed:** Approval of production source access by 2026-10-14.

## 3. Milestone Progress

| Workstream (Epic) | RAG | % Complete | Δ vs. last week | Points done / total | Due date | RAG reason |
|---|---|---|---|---|---|---|
| Schema Conversion | Green | 80% | n/a | 64 / 80 | 2026-10-30 | On track |
| Data Migration | Amber | 40% | n/a | 60 / 150 | 2026-11-13 | Open blocker (3 days) |
| Validation | Green | 15% | n/a | 12 / 80 | 2026-12-04 | On track |

## 4. Completed This Week

- Schema Conversion: Stored procedure conversion finished and signed off (13 points).
- Data Migration: Historical reference tables loaded to Databricks (8 points).
- Validation: Test plan and reconciliation approach approved (5 points).

## 5. Planned Next Week

- Schema Conversion: Convert remaining views and complete review.
- Data Migration: Resume transactional table loads once source access is approved.
- Validation: Start building reconciliation scripts for migrated tables.

## 6. Key Risks & Issues

| # | Workstream | Risk / Issue | Days open | Impact | Mitigation plan | Owner (team) |
|---|---|---|---|---|---|---|
| 1 | Data Migration | Production source access not granted; transactional loads paused | 3 | Med | Access request escalated to the security team; approval targeted by 2026-10-14 | Platform team |

## 8. Notes

- **Manual overrides:** None
- **Data notes:** First report in this format, so week-over-week changes and trend are not available. Figures are illustrative placeholders; replace with Jira data before issuing.
