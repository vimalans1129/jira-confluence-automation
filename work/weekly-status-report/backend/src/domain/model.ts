import type { StatusCategory } from "../contract/index.js";

export interface StatusTransition {
  at: Date;
  from: string;
  to: string;
  fromCategory: StatusCategory;
  toCategory: StatusCategory;
}

export interface FlagEvent {
  at: Date;
  flagged: boolean;
}

export interface DomainIssue {
  key: string;
  summary: string;
  type: string;
  isSubtask: boolean;
  status: string;
  statusCategory: StatusCategory;
  epicKey: string | null;
  points: number | null;
  dueDate: string | null;
  created: Date;
  updated: Date;
  flagged: boolean;
  transitions: readonly StatusTransition[];
  flagEvents: readonly FlagEvent[];
  inActiveSprint?: boolean;
}

export interface DomainEpic {
  key: string;
  name: string;
  dueDate: string | null;
  startDate: string | null;
  created: Date;
}

const byTime = <T extends { at: Date }>(a: T, b: T) => a.at.getTime() - b.at.getTime();

export function sortedTransitions(issue: DomainIssue): StatusTransition[] {
  return [...issue.transitions].sort(byTime);
}

export function existedAt(issue: DomainIssue, asOf: Date): boolean {
  return issue.created.getTime() <= asOf.getTime();
}

export interface StateAt {
  status: string;
  category: StatusCategory;
}

// State at a past instant comes from the changelog; with no history the current state is used.
export function stateAt(issue: DomainIssue, asOf: Date): StateAt {
  const all = sortedTransitions(issue);
  if (all.length === 0) return { status: issue.status, category: issue.statusCategory };
  let last: StatusTransition | undefined;
  for (const t of all) {
    if (t.at.getTime() <= asOf.getTime()) last = t;
  }
  if (last) return { status: last.to, category: last.toCategory };
  const first = all[0]!;
  return { status: first.from, category: first.fromCategory };
}

export function isDoneAt(issue: DomainIssue, asOf: Date): boolean {
  return stateAt(issue, asOf).category === "Done";
}

// Latest transition into a Done category at or before asOf; null if none.
export function lastDoneAt(issue: DomainIssue, asOf: Date): Date | null {
  let found: Date | null = null;
  for (const t of sortedTransitions(issue)) {
    if (t.at.getTime() > asOf.getTime()) break;
    if (t.toCategory === "Done" && t.fromCategory !== "Done") found = t.at;
  }
  return found;
}

export function isFlaggedAt(
  issue: DomainIssue,
  asOf: Date,
): { flagged: boolean; since: Date | null } {
  const events = [...issue.flagEvents].sort(byTime);
  if (events.length === 0) return { flagged: issue.flagged, since: null };
  let last: FlagEvent | undefined;
  for (const e of events) {
    if (e.at.getTime() <= asOf.getTime()) last = e;
  }
  if (!last) return { flagged: false, since: null };
  return last.flagged ? { flagged: true, since: last.at } : { flagged: false, since: null };
}
