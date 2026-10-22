import type {
  Blocker,
  EpicMetrics,
  IssueGroup,
  Report,
  ReportIssue,
  ReportWarning,
} from "../contract/index.js";
import { NOT_AVAILABLE, reportSchema } from "../contract/index.js";
import type { Settings } from "../config/settings.js";
import { detectBlockers } from "../domain/blockers.js";
import { computeMetrics, NO_EPIC_NAME, percentDelta, roundPercent } from "../domain/metrics.js";
import type { DomainEpic, DomainIssue } from "../domain/model.js";
import { formatInstant, nextWeekRange, type ReportPeriod } from "../domain/period.js";
import {
  applyOverride,
  evaluateEpicRag,
  plannedCompletionPercent,
  ragChange,
  rollUpOverall,
} from "../domain/rag.js";
import { applyOverrides } from "./overrides.js";
import { sanitizeMitigation, sanitizeText } from "../domain/sanitizer.js";
import type { JiraIssue } from "../jira/client.js";
import type { ActiveSprint, DerivedHistory } from "../jira/enrich.js";
import type { OverrideRecord } from "../repositories/overrideRepository.js";
import { NO_EPIC_KEY, type Snapshot } from "../repositories/snapshotRepository.js";

export interface BuildReportInput {
  projectKey: string;
  settings: Settings;
  period: ReportPeriod;
  now: Date;
  issues: readonly JiraIssue[];
  histories: ReadonlyMap<string, DerivedHistory>;
  sprint: ActiveSprint | null;
  // True for the current or most recent week; older weeks never use the sprint.
  sprintApplicable: boolean;
  fetchComment: (key: string) => Promise<string | null>;
  dryRun: boolean;
  // The most recent earlier snapshot, if any; without it every change and delta is "n/a".
  previous?: Snapshot | null;
  // Manual overrides stored for this week, applied after the calculated values (FR-022).
  overrides?: readonly OverrideRecord[];
}

export type SnapshotDraft = Omit<Snapshot, "jobId">;

const EMPTY_HISTORY: DerivedHistory = { transitions: [], flagEvents: [], pointChanges: [] };

function toDomainIssue(
  issue: JiraIssue,
  history: DerivedHistory | undefined,
  sprint: ActiveSprint | null,
): DomainIssue {
  const h = history ?? EMPTY_HISTORY;
  return {
    key: issue.key,
    summary: issue.summary,
    type: issue.type,
    isSubtask: issue.isSubtask,
    status: issue.status,
    statusCategory: issue.statusCategory,
    epicKey: issue.epicKey,
    points: issue.points,
    dueDate: issue.dueDate,
    created: issue.created,
    updated: issue.updated,
    flagged: issue.flagged,
    transitions: h.transitions,
    flagEvents: h.flagEvents,
    inActiveSprint: sprint ? sprint.issueKeys.has(issue.key) : false,
  };
}

export async function buildReport(
  input: BuildReportInput,
): Promise<{ report: Report; warnings: ReportWarning[]; snapshot: SnapshotDraft }> {
  const { settings, period } = input;
  const previousEpics = new Map((input.previous?.epics ?? []).map((e) => [e.epicKey, e]));
  const denylist = settings.nameDenylist;
  const clean = (text: string) => sanitizeText(text, { denylist });

  const epics: DomainEpic[] = input.issues
    .filter((i) => i.type === "Epic")
    .map((i) => ({
      key: i.key,
      name: clean(i.summary),
      dueDate: i.dueDate,
      startDate: i.startDate,
      created: i.created,
    }));
  const issues = input.issues
    .filter((i) => i.type !== "Epic")
    .map((i) => toDomainIssue(i, input.histories.get(i.key), input.sprint));

  const next = nextWeekRange(period);
  const metrics = computeMetrics({
    issues,
    epics,
    period,
    nextWeek: next,
    sprint: { applicable: input.sprintApplicable, active: input.sprint !== null },
  });
  const warnings: ReportWarning[] = [...metrics.warnings];

  const detected = detectBlockers(
    issues.filter((i) => !i.isSubtask),
    { asOf: period.asOf, blockedStatuses: settings.blockedStatuses },
  );
  warnings.push(...detected.warnings);

  const epicName = (key: string | null) =>
    key === null ? NO_EPIC_NAME : (epics.find((e) => e.key === key)?.name ?? key);

  const blockers: Blocker[] = [];
  let commentFailures = 0;
  for (const b of detected.blockers) {
    let mitigation: string | null = null;
    try {
      const text = await input.fetchComment(b.issue.key);
      if (text) mitigation = sanitizeMitigation(text, { denylist }, settings.mitigationMaxLength);
    } catch {
      commentFailures += 1;
    }
    blockers.push({
      key: b.issue.key,
      summary: clean(b.issue.summary),
      epicKey: b.issue.epicKey,
      epicName: epicName(b.issue.epicKey),
      ageDays: b.ageDays,
      reason: b.reason,
      mitigation: mitigation === "" ? null : mitigation,
    });
  }
  if (commentFailures > 0) {
    warnings.push({
      code: "COMMENT_UNAVAILABLE",
      message: `Latest comments could not be read for ${commentFailures} blocker(s).`,
    });
  }
  blockers.sort((a, b) => b.ageDays - a.ageDays || a.key.localeCompare(b.key));

  const epicByKey = new Map(epics.map((e) => [e.key, e]));
  const epicMetrics: EpicMetrics[] = metrics.epics.map((stats) => {
    const own = blockers.filter((b) => b.epicKey === stats.epicKey);
    const epic = stats.epicKey === null ? undefined : epicByKey.get(stats.epicKey);
    const planned = epic
      ? plannedCompletionPercent({
          epic,
          stats,
          workItems: stats.workItems,
          asOf: period.asOf,
          timeZone: period.timeZone,
        })
      : null;
    const evaluation = evaluateEpicRag({
      stats,
      blockerAges: own.map((b) => b.ageDays),
      plannedCompletion: planned,
      weekEnd: period.weekEnd,
      thresholds: settings.ragThresholds,
    });
    const rag = applyOverride(evaluation.rag, undefined);
    const before = previousEpics.get(stats.epicKey ?? NO_EPIC_KEY);
    return {
      epicKey: stats.epicKey,
      name: stats.name,
      dueDate: stats.dueDate,
      basis: stats.basis,
      totalUnits: stats.totalUnits,
      doneUnits: stats.doneUnits,
      percentComplete: roundPercent(stats.percentComplete),
      statusCounts: stats.statusCounts,
      daysToDue: stats.daysToDue,
      percentDelta: percentDelta(stats.percentComplete, before?.percentComplete),
      overduePercent: stats.overduePercent === null ? null : roundPercent(stats.overduePercent),
      plannedCompletionPercent: planned === null ? null : roundPercent(planned),
      noDueDate: stats.noDueDate,
      noWorkItems: stats.noWorkItems,
      complete: stats.complete,
      blockerCount: own.length,
      rag,
      ragChange: ragChange(rag.effective, before?.rag),
    };
  });

  const overall = applyOverride(
    rollUpOverall(
      epicMetrics.map((e) => ({
        epicKey: e.epicKey,
        name: e.name,
        effective: e.rag.effective,
        complete: e.complete,
        noWorkItems: e.noWorkItems,
      })),
    ),
    undefined,
  );

  const toReportIssue = (i: DomainIssue): ReportIssue => ({
    key: i.key,
    summary: clean(i.summary),
    type: i.type,
    status: i.status,
    statusCategory: i.statusCategory,
    epicKey: i.epicKey,
    epicName: epicName(i.epicKey),
    points: i.points,
    dueDate: i.dueDate,
  });
  const toGroups = (groups: typeof metrics.completed): IssueGroup[] =>
    groups.map((g) => ({
      epicKey: g.epicKey,
      epicName: g.epicKey === null ? NO_EPIC_NAME : epicName(g.epicKey),
      points: g.points,
      issues: g.issues.map(toReportIssue),
    }));

  const calculated: Report = {
    projectKey: input.projectKey,
    reportName: settings.reportName,
    timeZone: period.timeZone,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    asOf: formatInstant(period.asOf, period.timeZone),
    generatedAt: formatInstant(input.now, period.timeZone),
    dryRun: input.dryRun,
    deckStale: false,
    overall: {
      rag: overall,
      ragChange: input.previous
        ? ragChange(overall.effective, input.previous.overallRag)
        : NOT_AVAILABLE,
    },
    epics: epicMetrics,
    completed: toGroups(metrics.completed),
    planned: toGroups(metrics.planned),
    blockers,
    bugs: metrics.bugs,
    warnings,
    overrides: [],
    summary: null,
  };
  const report = input.overrides?.length
    ? applyOverrides(calculated, input.overrides, input.previous ?? null)
    : calculated;
  const snapshot: SnapshotDraft = {
    weekStart: period.weekStart,
    overallRag: report.overall.rag.effective,
    blockerCount: blockers.length,
    epics: metrics.epics.map((stats, i) => ({
      epicKey: stats.epicKey ?? NO_EPIC_KEY,
      name: stats.name,
      rag: report.epics[i]!.rag.effective,
      basis: stats.basis,
      totalUnits: stats.totalUnits,
      doneUnits: stats.doneUnits,
      percentComplete: stats.percentComplete,
      blockerCount: epicMetrics[i]!.blockerCount,
    })),
  };
  const parsed = reportSchema.parse(report);
  return { report: parsed, warnings: parsed.warnings, snapshot };
}
