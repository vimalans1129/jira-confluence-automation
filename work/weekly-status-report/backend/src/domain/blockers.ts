import type { Blocker, ReportWarning } from "../contract/index.js";
import { existedAt, isFlaggedAt, sortedTransitions, stateAt, type DomainIssue } from "./model.js";

const DAY_MS = 86_400_000;

export function matchesBlockedStatus(status: string, blockedStatuses: readonly string[]): boolean {
  const wanted = status.trim().toLowerCase();
  return blockedStatuses.some((s) => s.trim().toLowerCase() === wanted);
}

export interface BlockerOptions {
  asOf: Date;
  blockedStatuses: readonly string[];
}

export interface DetectedBlocker {
  issue: DomainIssue;
  reason: Blocker["reason"];
  since: Date | null;
  ageDays: number;
}

export interface BlockerResult {
  blockers: DetectedBlocker[];
  warnings: ReportWarning[];
}

function sinceBlockedStatus(issue: DomainIssue, status: string, asOf: Date): Date | null {
  let found: Date | null = null;
  for (const t of sortedTransitions(issue)) {
    if (t.at.getTime() > asOf.getTime()) break;
    if (t.to.toLowerCase() === status.toLowerCase()) found = t.at;
  }
  return found;
}

export function detectBlockers(
  issues: readonly DomainIssue[],
  { asOf, blockedStatuses }: BlockerOptions,
): BlockerResult {
  const blocked = new Set(blockedStatuses.map((s) => s.trim().toLowerCase()));
  const blockers: DetectedBlocker[] = [];
  const warnings: ReportWarning[] = [];

  for (const issue of issues) {
    if (!existedAt(issue, asOf)) continue;
    const state = stateAt(issue, asOf);
    if (state.category === "Done") continue;

    const flag = isFlaggedAt(issue, asOf);
    const inBlockedStatus = blocked.has(state.status.trim().toLowerCase());
    if (!flag.flagged && !inBlockedStatus) continue;

    const candidates: Date[] = [];
    if (flag.flagged && flag.since) candidates.push(flag.since);
    if (inBlockedStatus) {
      const at = sinceBlockedStatus(issue, state.status, asOf);
      if (at) candidates.push(at);
    }
    const eventAt = candidates.length
      ? new Date(Math.max(...candidates.map((c) => c.getTime())))
      : null;

    let since = eventAt;
    if (!since) {
      since = issue.updated;
      warnings.push({
        code: "BLOCKER_AGE_FALLBACK",
        message: `Blocker age for ${issue.key} is based on the last update because no flag or Blocked event was found.`,
      });
    }

    blockers.push({
      issue,
      reason: flag.flagged ? "flagged" : "blocked-status",
      since,
      ageDays: Math.max(0, Math.floor((asOf.getTime() - since.getTime()) / DAY_MS)),
    });
  }

  blockers.sort((a, b) => b.ageDays - a.ageDays || a.issue.key.localeCompare(b.issue.key));
  return { blockers, warnings };
}
