import type { Rag } from "../contract/index.js";
import type { Snapshot } from "../repositories/snapshotRepository.js";
import { NO_EPIC_KEY } from "../repositories/snapshotRepository.js";

export const DEFAULT_TREND_WEEKS = 6;
export const MIN_TREND_WEEKS = 4;
export const MAX_TREND_WEEKS = 12;

export interface TrendWeek {
  weekStart: string;
  overallRag: Rag;
  // Mean of the real Epics' percent complete (points and counts are not comparable across Epics).
  percentComplete: number | null;
  blockerCount: number;
  epics: { epicKey: string; name: string; rag: Rag; percentComplete: number }[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function toTrend(snapshots: readonly Snapshot[]): TrendWeek[] {
  return snapshots.map((s) => {
    const epics = s.epics.filter((e) => e.epicKey !== NO_EPIC_KEY);
    const withWork = epics.filter((e) => e.totalUnits > 0);
    return {
      weekStart: s.weekStart,
      overallRag: s.overallRag,
      percentComplete: withWork.length
        ? round1(withWork.reduce((sum, e) => sum + e.percentComplete, 0) / withWork.length)
        : null,
      blockerCount: s.blockerCount,
      epics: epics.map((e) => ({
        epicKey: e.epicKey,
        name: e.name,
        rag: e.rag,
        percentComplete: round1(e.percentComplete),
      })),
    };
  });
}
