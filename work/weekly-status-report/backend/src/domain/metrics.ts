import type { BugSummary, Delta, IssueGroup, ReportWarning } from "../contract/index.js";
import { NOT_AVAILABLE } from "../contract/index.js";
import {
  existedAt,
  isDoneAt,
  lastDoneAt,
  stateAt,
  type DomainEpic,
  type DomainIssue,
} from "./model.js";
import type { ReportPeriod, WeekRange } from "./period.js";

export const NO_EPIC_NAME = "No Epic";
const DAY_MS = 86_400_000;

export interface SprintContext {
  // True for the current or most recent week, where the active sprint contributes to the plan.
  applicable: boolean;
  active: boolean;
}

export interface MetricsInput {
  issues: readonly DomainIssue[];
  epics: readonly DomainEpic[];
  period: Pick<ReportPeriod, "weekStart" | "weekEnd" | "start" | "end" | "asOf">;
  nextWeek: Pick<WeekRange, "weekStart" | "weekEnd">;
  sprint: SprintContext;
  bugTypes?: readonly string[];
}

export interface EpicStats {
  epicKey: string | null;
  name: string;
  dueDate: string | null;
  startDate: string | null;
  basis: "points" | "count";
  totalUnits: number;
  doneUnits: number;
  percentComplete: number;
  statusCounts: { todo: number; inProgress: number; done: number };
  daysToDue: number | null;
  overduePercent: number | null;
  noDueDate: boolean;
  noWorkItems: boolean;
  complete: boolean;
  workItems: DomainIssue[];
}

export interface MetricsResult {
  epics: EpicStats[];
  completed: Array<Omit<IssueGroup, "issues"> & { issues: DomainIssue[] }>;
  planned: Array<Omit<IssueGroup, "issues"> & { issues: DomainIssue[] }>;
  overdue: DomainIssue[];
  bugs: BugSummary;
  warnings: ReportWarning[];
}

export function roundPercent(value: number): number {
  return Math.round(value);
}

// Deltas come from unrounded values and are shown in percentage points to one decimal.
export function percentDelta(current: number, previous: number | null | undefined): Delta {
  if (previous === null || previous === undefined) return NOT_AVAILABLE;
  return Math.round((current - previous) * 10) / 10;
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS,
  );
}

const inRange = (at: Date, start: Date, end: Date) =>
  at.getTime() >= start.getTime() && at.getTime() <= end.getTime();

function groupIssues(
  issues: readonly DomainIssue[],
  epics: readonly DomainEpic[],
  knownKeys: Set<string>,
): Array<{ epicKey: string | null; epicName: string; points: number; issues: DomainIssue[] }> {
  const buckets = new Map<string | null, DomainIssue[]>();
  for (const issue of issues) {
    const key = issue.epicKey && knownKeys.has(issue.epicKey) ? issue.epicKey : null;
    const list = buckets.get(key) ?? [];
    list.push(issue);
    buckets.set(key, list);
  }
  const groups = [];
  for (const epic of epics) {
    const list = buckets.get(epic.key);
    if (list) groups.push(toGroup(epic.key, epic.name, list));
  }
  const rest = buckets.get(null);
  if (rest) groups.push(toGroup(null, NO_EPIC_NAME, rest));
  return groups;
}

function toGroup(epicKey: string | null, epicName: string, list: DomainIssue[]) {
  const issues = [...list].sort((a, b) => a.key.localeCompare(b.key));
  return {
    epicKey,
    epicName,
    points: issues.reduce((sum, i) => sum + (i.points ?? 0), 0),
    issues,
  };
}

export function computeMetrics(input: MetricsInput): MetricsResult {
  const { epics, period, nextWeek, sprint } = input;
  const asOf = period.asOf;
  const bugTypes = new Set((input.bugTypes ?? ["Bug"]).map((t) => t.toLowerCase()));
  const warnings: ReportWarning[] = [];
  const knownKeys = new Set(epics.map((e) => e.key));

  const all = input.issues.filter((i) => i.type !== "Epic" && existedAt(i, asOf));
  const workIssues = all.filter((i) => !i.isSubtask);

  const epicStats: EpicStats[] = [];
  const groups = groupIssues(workIssues, epics, knownKeys);
  const byKey = new Map(groups.map((g) => [g.epicKey, g]));

  const descriptors: Array<{ epic: DomainEpic | null }> = [
    ...epics.map((epic) => ({ epic })),
    ...(byKey.has(null) ? [{ epic: null }] : []),
  ];

  for (const { epic } of descriptors) {
    const items = byKey.get(epic ? epic.key : null)?.issues ?? [];
    const name = epic ? epic.name : NO_EPIC_NAME;
    const basis: "points" | "count" = items.some((i) => i.points !== null) ? "points" : "count";
    const unit = (i: DomainIssue) => (basis === "points" ? (i.points ?? 0) : 1);

    if (basis === "points") {
      const missing = items.filter((i) => i.points === null).length;
      if (missing > 0) {
        warnings.push({
          code: "UNESTIMATED_ISSUES",
          message: `${missing} issue(s) in "${name}" have no story points and count as 0 points.`,
        });
      }
    }

    const counts = { todo: 0, inProgress: 0, done: 0 };
    let total = 0;
    let doneUnits = 0;
    let dueTotal = 0;
    let dueOverdue = 0;
    for (const issue of items) {
      const category = stateAt(issue, asOf).category;
      const done = category === "Done";
      if (done) counts.done += 1;
      else if (category === "In Progress") counts.inProgress += 1;
      else counts.todo += 1;
      total += unit(issue);
      if (done) doneUnits += unit(issue);
      if (issue.dueDate !== null) {
        dueTotal += unit(issue);
        if (!done && issue.dueDate < period.weekEnd) dueOverdue += unit(issue);
      }
    }

    const dueDate = epic?.dueDate ?? null;
    epicStats.push({
      epicKey: epic ? epic.key : null,
      name,
      dueDate,
      startDate: epic?.startDate ?? null,
      basis,
      totalUnits: total,
      doneUnits,
      percentComplete: total === 0 ? 0 : (doneUnits / total) * 100,
      statusCounts: counts,
      daysToDue: dueDate ? daysBetween(period.weekEnd, dueDate) : null,
      overduePercent: dueTotal === 0 ? null : (dueOverdue / dueTotal) * 100,
      noDueDate: epic !== null && dueDate === null,
      noWorkItems: items.length === 0,
      complete: items.length > 0 && items.every((i) => isDoneAt(i, asOf)),
      workItems: items,
    });
  }

  const completedIssues = workIssues.filter((i) => {
    if (!isDoneAt(i, asOf)) return false;
    const at = lastDoneAt(i, asOf);
    return at !== null && inRange(at, period.start, period.end);
  });

  if (sprint.applicable && !sprint.active) {
    warnings.push({
      code: "NO_ACTIVE_SPRINT",
      message: "No active sprint was found; planned work uses due dates only.",
    });
  }
  const useSprint = sprint.applicable && sprint.active;
  const plannedIssues = workIssues.filter((i) => {
    if (isDoneAt(i, asOf)) return false;
    const dueNext =
      i.dueDate !== null && i.dueDate >= nextWeek.weekStart && i.dueDate <= nextWeek.weekEnd;
    return dueNext || (useSprint && i.inActiveSprint === true);
  });

  const overdue = workIssues
    .filter((i) => !isDoneAt(i, asOf) && i.dueDate !== null && i.dueDate < period.weekEnd)
    .sort((a, b) => a.key.localeCompare(b.key));

  const bugs = all.filter((i) => bugTypes.has(i.type.toLowerCase()));
  const bugSummary: BugSummary = {
    opened: bugs.filter((b) => inRange(b.created, period.start, period.end)).length,
    closed: bugs.filter((b) => {
      if (!isDoneAt(b, asOf)) return false;
      const at = lastDoneAt(b, asOf);
      return at !== null && inRange(at, period.start, period.end);
    }).length,
    currentlyOpen: bugs.filter((b) => !isDoneAt(b, asOf)).length,
  };

  return {
    epics: epicStats,
    completed: groupIssues(completedIssues, epics, knownKeys),
    planned: groupIssues(plannedIssues, epics, knownKeys),
    overdue,
    bugs: bugSummary,
    warnings,
  };
}
