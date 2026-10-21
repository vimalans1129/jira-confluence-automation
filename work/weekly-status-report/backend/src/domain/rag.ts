import type { Rag, RagChange, RagResult } from "../contract/index.js";
import { NOT_AVAILABLE } from "../contract/index.js";
import type { EpicStats } from "./metrics.js";
import type { DomainEpic, DomainIssue } from "./model.js";
import { startOfLocalDate } from "./period.js";

export interface RagThresholds {
  blockerRedDays: number;
  plannedCompletionRedBelow: number;
  overdueAmberAbovePercent: number;
}

export const DEFAULT_RAG_THRESHOLDS: RagThresholds = {
  blockerRedDays: 5,
  plannedCompletionRedBelow: 70,
  overdueAmberAbovePercent: 10,
};

const RANK: Record<Rag, number> = { Red: 0, Amber: 1, Green: 2 };

export interface EpicRagInput {
  stats: EpicStats;
  blockerAges: readonly number[];
  plannedCompletion: number | null;
  weekEnd: string;
  thresholds: RagThresholds;
}

export interface EpicRagResult {
  rag: RagResult;
  // False for complete Epics, Epics without work items, and No Epic (DEF-09, DEF-10).
  evaluated: boolean;
  notes: string[];
}

function result(calculated: Rag, reasons: string[]): RagResult {
  return { calculated, effective: calculated, reasons, overridden: false, overrideReason: null };
}

export function evaluateEpicRag(input: EpicRagInput): EpicRagResult {
  const { stats, blockerAges, plannedCompletion, weekEnd, thresholds } = input;

  if (stats.epicKey === null) {
    return { rag: result("Green", []), evaluated: false, notes: ["Excluded from RAG (No Epic)"] };
  }
  if (stats.noWorkItems) {
    return { rag: result("Green", []), evaluated: false, notes: ["No work items"] };
  }
  if (stats.complete) {
    return { rag: result("Green", ["Complete"]), evaluated: false, notes: [] };
  }

  const notes: string[] = [];
  const red: string[] = [];
  const amber: string[] = [];

  if (stats.dueDate === null) {
    notes.push("No due date: past-due and planned completion rules not evaluated");
  } else if (stats.dueDate < weekEnd) {
    red.push(`Epic is past due (${stats.dueDate}) and not complete`);
  }

  const oldest = blockerAges.length ? Math.max(...blockerAges) : null;
  if (oldest !== null && oldest > thresholds.blockerRedDays) {
    red.push(`Oldest blocker is ${oldest} days old (limit ${thresholds.blockerRedDays})`);
  }

  if (stats.dueDate !== null) {
    if (plannedCompletion === null) {
      notes.push("Planned completion not evaluated");
    } else if (plannedCompletion < thresholds.plannedCompletionRedBelow) {
      red.push(
        `Planned completion is ${plannedCompletion.toFixed(0)}% (minimum ${thresholds.plannedCompletionRedBelow}%)`,
      );
    }
  }

  if (blockerAges.length > 0) {
    amber.push(`${blockerAges.length} open blocker(s)`);
  }
  if (stats.overduePercent !== null && stats.overduePercent > thresholds.overdueAmberAbovePercent) {
    amber.push(
      `${stats.overduePercent.toFixed(0)}% of due-dated work is overdue (limit ${thresholds.overdueAmberAbovePercent}%)`,
    );
  }

  if (red.length) return { rag: result("Red", red), evaluated: true, notes };
  if (amber.length) return { rag: result("Amber", amber), evaluated: true, notes };
  return { rag: result("Green", []), evaluated: true, notes };
}

export interface PlannedCompletionInput {
  epic: DomainEpic;
  stats: Pick<EpicStats, "totalUnits" | "doneUnits">;
  workItems: readonly DomainIssue[];
  asOf: Date;
  timeZone: string;
}

// The due date is treated as the end of that day in the report time zone.
export function plannedCompletionPercent(input: PlannedCompletionInput): number | null {
  const { epic, stats, workItems, asOf, timeZone } = input;
  if (epic.dueDate === null) return null;

  let start: Date;
  if (epic.startDate) {
    start = startOfLocalDate(epic.startDate, timeZone);
  } else {
    const firsts: number[] = [];
    for (const issue of workItems) {
      const hits = issue.transitions.filter((t) => t.toCategory === "In Progress");
      if (hits.length) firsts.push(Math.min(...hits.map((t) => t.at.getTime())));
    }
    start = firsts.length ? new Date(Math.min(...firsts)) : epic.created;
  }

  const nextDay = new Date(Date.parse(`${epic.dueDate}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const due = startOfLocalDate(nextDay, timeZone);
  if (due.getTime() <= start.getTime()) return null;

  const share = Math.min(
    1,
    Math.max(0, (asOf.getTime() - start.getTime()) / (due.getTime() - start.getTime())),
  );
  const expected = stats.totalUnits * share;
  if (expected <= 0) return null;
  return (stats.doneUnits / expected) * 100;
}

export interface RollUpItem {
  epicKey: string | null;
  name: string;
  effective: Rag;
  complete: boolean;
  noWorkItems: boolean;
}

export function rollUpOverall(items: readonly RollUpItem[]): RagResult {
  const qualifying = items.filter((i) => i.epicKey !== null && !i.complete && !i.noWorkItems);
  if (qualifying.length === 0) return result("Green", ["No Epics in progress"]);
  const worst = qualifying.reduce<Rag>(
    (acc, i) => (RANK[i.effective] < RANK[acc] ? i.effective : acc),
    "Green",
  );
  const names = qualifying.filter((i) => i.effective === worst).map((i) => i.name);
  return result(
    worst,
    worst === "Green" ? [] : [`Worst Epic status ${worst}: ${names.join(", ")}`],
  );
}

export function applyOverride(
  rag: RagResult,
  override: { rag: Rag; reason: string } | undefined,
): RagResult {
  if (!override) return rag;
  return { ...rag, effective: override.rag, overridden: true, overrideReason: override.reason };
}

export function ragChange(current: Rag, previous: Rag | null | undefined): RagChange {
  if (!previous) return NOT_AVAILABLE;
  if (RANK[current] > RANK[previous]) return "▲";
  if (RANK[current] < RANK[previous]) return "▼";
  return "▬";
}
