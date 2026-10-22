import type { Report, ReportWarning } from "../contract/index.js";
import { NOT_AVAILABLE } from "../contract/index.js";
import { applyOverride, ragChange, rollUpOverall } from "../domain/rag.js";
import type { OverrideRecord } from "../repositories/overrideRepository.js";
import { NO_EPIC_KEY, type Snapshot } from "../repositories/snapshotRepository.js";

export const OVERRIDE_EPIC_MISSING = "OVERRIDE_EPIC_MISSING";

/**
 * Recomputes every effective status, the roll-up and the week-over-week arrows from the stored
 * calculated values, so an override change never needs Jira. Overrides naming an Epic that is not
 * in the report are ignored with a warning (FR-022).
 */
export function applyOverrides(
  report: Report,
  overrides: readonly OverrideRecord[],
  previous: Snapshot | null,
): Report {
  const previousEpics = new Map((previous?.epics ?? []).map((e) => [e.epicKey, e]));
  const known = new Set(report.epics.map((e) => e.epicKey));
  const applied: Report["overrides"] = [];
  const warnings: ReportWarning[] = report.warnings.filter((w) => w.code !== OVERRIDE_EPIC_MISSING);

  const epics = report.epics.map((epic) => {
    const match = epic.epicKey
      ? overrides.find((o) => o.scope === "epic" && o.epicKey === epic.epicKey)
      : undefined;
    const base = {
      ...epic.rag,
      effective: epic.rag.calculated,
      overridden: false,
      overrideReason: null,
    };
    const rag = applyOverride(base, match);
    if (match)
      applied.push({ scope: "epic", epicKey: match.epicKey, rag: match.rag, reason: match.reason });
    const before = previousEpics.get(epic.epicKey ?? NO_EPIC_KEY);
    return { ...epic, rag, ragChange: ragChange(rag.effective, before?.rag) };
  });

  for (const o of overrides) {
    if (o.scope === "epic" && !known.has(o.epicKey)) {
      warnings.push({
        code: OVERRIDE_EPIC_MISSING,
        message: `The override for Epic ${o.epicKey} was ignored because the Epic is not in this report.`,
      });
    }
  }

  const overallMatch = overrides.find((o) => o.scope === "overall");
  const overall = applyOverride(
    rollUpOverall(
      epics.map((e) => ({
        epicKey: e.epicKey,
        name: e.name,
        effective: e.rag.effective,
        complete: e.complete,
        noWorkItems: e.noWorkItems,
      })),
    ),
    overallMatch,
  );
  if (overallMatch) {
    applied.unshift({
      scope: "overall",
      epicKey: null,
      rag: overallMatch.rag,
      reason: overallMatch.reason,
    });
  }

  return {
    ...report,
    epics,
    warnings,
    overrides: applied,
    overall: {
      rag: overall,
      ragChange: previous ? ragChange(overall.effective, previous.overallRag) : NOT_AVAILABLE,
    },
  };
}
