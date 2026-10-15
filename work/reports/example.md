# Weekly Status Report — Teradata → Databricks Migration

**Reporting period:** 2026-10-05 to 2026-10-11 (Mon–Sun)
**Prepared by:** Delivery Manager
**Date issued:** 2026-10-12

---

## 1. Overall Status

| Overall RAG | Change vs. last week | Reason |
|---|---|---|
| Amber | ▬ | Open blocker on Data Migration; cutover date depends on a vendor. *(Manually set to Amber: vendor dependency on cutover date.)* |

## 2. Executive Summary

- **Highlights:** Schema Conversion reached 100%. ETL/SQL Conversion completed 21 points, the best week to date. Validation test plan approved.
- **Concerns:** Cluster capacity for Data Migration is not yet approved and has blocked work for 7 days.
- **Decisions / support needed:** Approval of additional Databricks cluster capacity by 2026-10-16.

## 3. Milestone Progress

| Workstream (Epic) | RAG | % Complete | Δ vs. last week | Points done / total | Due date | RAG reason |
|---|---|---|---|---|---|---|
| Discovery | Green | 100% | +0 pp | 40 / 40 | 2026-08-31 | Complete |
| Schema Conversion | Green | 100% | +8 pp | 85 / 85 | 2026-10-09 | Completed on time |
| Data Migration | Red | 52% | +4 pp | 78 / 150 | 2026-10-30 | Blocker open > 5 days |
| ETL/SQL Conversion | Amber | 61% | +11 pp | 122 / 200 | 2026-11-20 | Open dependency on data availability |
| Validation | Green | 18% | +6 pp | 18 / 100 | 2026-12-04 | On track |
| Cutover | Green | 0% | +0 pp | 0 / 60 | 2026-12-18 | Not started, on plan |

## 4. Completed This Week

- Schema Conversion: Final stored procedure and view conversions signed off (17 points).
- ETL/SQL Conversion: Two batch job families converted and unit tested (21 points).
- Validation: Test plan and reconciliation approach approved (6 points).

## 5. Planned Next Week

- Data Migration: Resume bulk loads once capacity is approved; continue historical table backlog.
- ETL/SQL Conversion: Begin conversion of reporting queries.
- Validation: Build reconciliation scripts for migrated tables.

## 6. Key Risks & Issues

| # | Workstream | Risk / Issue | Days open | Impact | Mitigation plan | Owner (team) |
|---|---|---|---|---|---|---|
| 1 | Data Migration | Cluster capacity not approved; bulk loads paused | 7 | High | Escalated to IT leadership; approval requested by 2026-10-16 | Platform team |
| 2 | ETL/SQL Conversion | Source extracts delivered late | 3 | Med | Agreed fixed delivery slot with source owners from 2026-10-13 | ETL team |

## 7. Trend (optional)

| Week | Overall RAG | % Complete | Open blockers |
|---|---|---|---|
| 2026-W41 | Amber | 52% | 2 |
| 2026-W40 | Amber | 48% | 1 |
| 2026-W39 | Green | 45% | 0 |

## 8. Notes

- **Manual overrides:** Overall set to Amber (calculated Red due to Data Migration) because the blocker has a committed resolution date.
- **Data notes:** None
