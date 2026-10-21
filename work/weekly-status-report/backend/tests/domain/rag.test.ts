import { describe, expect, it } from "vitest";
import {
  DEFAULT_RAG_THRESHOLDS,
  applyOverride,
  evaluateEpicRag,
  plannedCompletionPercent,
  ragChange,
  rollUpOverall,
} from "../../src/domain/rag.js";
import type { EpicStats } from "../../src/domain/metrics.js";
import type { DomainEpic, DomainIssue } from "../../src/domain/model.js";
import { makeIssue } from "./helpers.js";

const TZ = "UTC";
const asOf = new Date("2026-10-18T23:59:59.999Z");
const weekEnd = "2026-10-18";

function stats(over: Partial<EpicStats> = {}): EpicStats {
  return {
    epicKey: "DEMO-100",
    name: "Alpha",
    dueDate: "2026-12-31",
    startDate: null,
    basis: "count",
    totalUnits: 10,
    doneUnits: 5,
    percentComplete: 50,
    statusCounts: { todo: 2, inProgress: 3, done: 5 },
    daysToDue: 74,
    overduePercent: 0,
    noDueDate: false,
    noWorkItems: false,
    complete: false,
    workItems: [],
    ...over,
  };
}

const evalWith = (s: EpicStats, opts: { blockerAges?: number[]; planned?: number | null } = {}) =>
  evaluateEpicRag({
    stats: s,
    blockerAges: opts.blockerAges ?? [],
    plannedCompletion: opts.planned === undefined ? 100 : opts.planned,
    weekEnd,
    thresholds: DEFAULT_RAG_THRESHOLDS,
  });

describe("RAG thresholds (FR-016 to FR-018)", () => {
  it("is Green with no condition", () => {
    const r = evalWith(stats());
    expect(r.rag).toMatchObject({ calculated: "Green", effective: "Green", reasons: [] });
    expect(r.evaluated).toBe(true);
  });

  it("blocker age 5 days is Amber, 6 days is Red", () => {
    expect(evalWith(stats(), { blockerAges: [5] }).rag.calculated).toBe("Amber");
    expect(evalWith(stats(), { blockerAges: [6] }).rag.calculated).toBe("Red");
    expect(evalWith(stats(), { blockerAges: [1, 9] }).rag.reasons.join(" ")).toMatch(/9 days/);
  });

  it("planned completion 69 is Red, 70 is not", () => {
    expect(evalWith(stats(), { planned: 69 }).rag.calculated).toBe("Red");
    expect(evalWith(stats(), { planned: 69.9 }).rag.calculated).toBe("Red");
    expect(evalWith(stats(), { planned: 70 }).rag.calculated).toBe("Green");
  });

  it("overdue 10 percent is Green, above 10 is Amber", () => {
    expect(evalWith(stats({ overduePercent: 10 })).rag.calculated).toBe("Green");
    expect(evalWith(stats({ overduePercent: 10.1 })).rag.calculated).toBe("Amber");
  });

  it("any open blocker is Amber", () => {
    const r = evalWith(stats(), { blockerAges: [0] });
    expect(r.rag.calculated).toBe("Amber");
    expect(r.rag.reasons.length).toBeGreaterThan(0);
  });

  it("is Red when past due and not complete (DEF-08)", () => {
    const r = evalWith(stats({ dueDate: "2026-10-17" }));
    expect(r.rag.calculated).toBe("Red");
    expect(r.rag.reasons.join(" ")).toMatch(/past due/i);
    expect(evalWith(stats({ dueDate: "2026-10-18" })).rag.calculated).toBe("Green");
  });

  it("reports only the reasons of the winning level, so Red hides Amber", () => {
    const r = evalWith(stats({ overduePercent: 50 }), { blockerAges: [7], planned: 10 });
    expect(r.rag.calculated).toBe("Red");
    expect(r.rag.reasons).toHaveLength(2);
  });

  it("reads thresholds from settings", () => {
    const r = evaluateEpicRag({
      stats: stats({ overduePercent: 20 }),
      blockerAges: [3],
      plannedCompletion: 80,
      weekEnd,
      thresholds: {
        blockerRedDays: 2,
        plannedCompletionRedBelow: 90,
        overdueAmberAbovePercent: 25,
      },
    });
    expect(r.rag.calculated).toBe("Red");
    expect(r.rag.reasons).toHaveLength(2);
  });

  it("flags a missing due date and skips the date-based rules", () => {
    const r = evalWith(stats({ dueDate: null, noDueDate: true }), { planned: null });
    expect(r.rag.calculated).toBe("Green");
    expect(r.notes.join(" ")).toMatch(/no due date/i);
  });

  it("notes when planned completion could not be evaluated", () => {
    const r = evalWith(stats(), { planned: null });
    expect(r.notes.join(" ")).toMatch(/planned completion/i);
  });

  it("treats a complete Epic as Green and a work-less Epic as excluded", () => {
    const complete = evalWith(stats({ complete: true, dueDate: "2026-01-01" }), {
      blockerAges: [9],
    });
    expect(complete.rag.calculated).toBe("Green");
    expect(complete.evaluated).toBe(false);
    const empty = evalWith(stats({ noWorkItems: true, totalUnits: 0, doneUnits: 0 }));
    expect(empty.evaluated).toBe(false);
    expect(empty.notes.join(" ")).toMatch(/no work items/i);
  });

  it("excludes No Epic from RAG (DEF-09)", () => {
    const r = evalWith(stats({ epicKey: null, name: "No Epic" }), { blockerAges: [9] });
    expect(r.evaluated).toBe(false);
    expect(r.rag.calculated).toBe("Green");
  });
});

describe("planned completion (DEF-03)", () => {
  const created = new Date("2026-08-01T00:00:00Z");
  const epic: DomainEpic = {
    key: "DEMO-100",
    name: "Alpha",
    dueDate: "2026-12-31",
    startDate: "2026-09-01",
    created,
  };
  const calc = (e: Partial<DomainEpic>, s: Partial<EpicStats>, items: DomainIssue[] = []) =>
    plannedCompletionPercent({
      epic: { ...epic, ...e },
      stats: stats({ totalUnits: 100, doneUnits: 30, ...s }),
      workItems: items,
      asOf,
      timeZone: TZ,
    });

  it("divides units done by expected units", () => {
    // 2026-09-01 to end of 2026-12-31 is 122 days; asOf is day 48 of them.
    const startMs = Date.parse("2026-09-01T00:00:00Z");
    const dueMs = Date.parse("2027-01-01T00:00:00Z");
    const share = (asOf.getTime() - startMs) / (dueMs - startMs);
    expect(calc({}, {})).toBeCloseTo((30 / (100 * share)) * 100, 6);
  });

  it("clamps the elapsed share to 1 after the due date", () => {
    expect(calc({ dueDate: "2026-10-01" }, {})).toBeCloseTo(30);
  });

  it("clamps to 0 before the start, which is not evaluated (expected zero)", () => {
    expect(calc({ startDate: "2026-11-01" }, {})).toBeNull();
  });

  it("is not evaluated without a due date, with due before start, or with no units", () => {
    expect(calc({ dueDate: null }, {})).toBeNull();
    expect(calc({ dueDate: "2026-08-31" }, {})).toBeNull();
    expect(calc({ dueDate: "2026-08-15" }, {})).toBeNull();
    expect(calc({}, { totalUnits: 0, doneUnits: 0 })).toBeNull();
  });

  it("falls back to the earliest first In Progress transition, then to creation", () => {
    const started = makeIssue({
      key: "DEMO-1",
      transitions: [
        {
          at: new Date("2026-10-01T00:00:00Z"),
          from: "To Do",
          to: "In Progress",
          fromCategory: "To Do",
          toCategory: "In Progress",
        },
      ],
    });
    const later = makeIssue({
      key: "DEMO-2",
      transitions: [
        {
          at: new Date("2026-10-10T00:00:00Z"),
          from: "To Do",
          to: "In Progress",
          fromCategory: "To Do",
          toCategory: "In Progress",
        },
      ],
    });
    const viaChild = calc({ startDate: null }, {}, [later, started]);
    const startMs = Date.parse("2026-10-01T00:00:00Z");
    const dueMs = Date.parse("2027-01-01T00:00:00Z");
    const share = (asOf.getTime() - startMs) / (dueMs - startMs);
    expect(viaChild).toBeCloseTo((30 / (100 * share)) * 100, 6);

    const viaCreated = calc({ startDate: null }, {}, []);
    const createdShare =
      (asOf.getTime() - created.getTime()) /
      (Date.parse("2027-01-01T00:00:00Z") - created.getTime());
    expect(viaCreated).toBeCloseTo((30 / (100 * createdShare)) * 100, 6);
  });
});

describe("overall roll-up (DEF-10)", () => {
  const item = (
    epicKey: string | null,
    effective: "Red" | "Amber" | "Green",
    over: Partial<{ complete: boolean; noWorkItems: boolean }> = {},
  ) => ({
    epicKey,
    name: epicKey ?? "No Epic",
    effective,
    complete: false,
    noWorkItems: false,
    ...over,
  });

  it("is the worst effective RAG among qualifying Epics", () => {
    const r = rollUpOverall([item("A", "Green"), item("B", "Amber"), item("C", "Red")]);
    expect(r.calculated).toBe("Red");
    expect(r.reasons.join(" ")).toContain("C");
  });

  it("ignores complete, empty and No Epic entries", () => {
    const r = rollUpOverall([
      item("A", "Red", { complete: true }),
      item("B", "Red", { noWorkItems: true }),
      item(null, "Red"),
      item("C", "Amber"),
    ]);
    expect(r.calculated).toBe("Amber");
  });

  it("is Green when no Epic qualifies", () => {
    expect(rollUpOverall([]).calculated).toBe("Green");
    expect(rollUpOverall([item("A", "Red", { complete: true })]).calculated).toBe("Green");
  });
});

describe("overrides and change arrows", () => {
  it("applies an override and keeps the calculated value", () => {
    const base = evalWith(stats(), { blockerAges: [9] }).rag;
    const out = applyOverride(base, { rag: "Amber", reason: "Vendor confirmed fix" });
    expect(out).toMatchObject({
      calculated: "Red",
      effective: "Amber",
      overridden: true,
      overrideReason: "Vendor confirmed fix",
    });
    expect(applyOverride(base, undefined)).toEqual(base);
  });

  it("computes arrows from the previous snapshot", () => {
    expect(ragChange("Green", "Amber")).toBe("▲");
    expect(ragChange("Amber", "Red")).toBe("▲");
    expect(ragChange("Red", "Green")).toBe("▼");
    expect(ragChange("Amber", "Amber")).toBe("▬");
    expect(ragChange("Amber", null)).toBe("n/a");
  });
});
