import { describe, expect, it } from "vitest";
import { computeMetrics, percentDelta, roundPercent } from "../../src/domain/metrics.js";
import type { DomainEpic, DomainIssue } from "../../src/domain/model.js";
import { periodForDate, nextWeekRange } from "../../src/domain/period.js";
import { makeIssue } from "./helpers.js";

const now = new Date("2026-10-21T08:00:00Z");
const period = periodForDate("2026-10-14", "Europe/Berlin", now); // 12 Oct to 18 Oct
const next = nextWeekRange(period); // 19 Oct to 25 Oct
const inWeek = new Date("2026-10-15T10:00:00Z");
const before = new Date("2026-10-05T10:00:00Z");
const after = new Date("2026-10-19T10:00:00Z");

const epics: DomainEpic[] = [
  {
    key: "DEMO-100",
    name: "Alpha",
    dueDate: "2026-11-30",
    startDate: null,
    created: new Date("2026-01-01T00:00:00Z"),
  },
  {
    key: "DEMO-200",
    name: "Beta",
    dueDate: null,
    startDate: null,
    created: new Date("2026-01-01T00:00:00Z"),
  },
  {
    key: "DEMO-300",
    name: "Empty",
    dueDate: null,
    startDate: null,
    created: new Date("2026-01-01T00:00:00Z"),
  },
];

function done(at: Date, from: "To Do" | "In Progress" = "In Progress") {
  return {
    at,
    from: from === "To Do" ? "To Do" : "In Progress",
    to: "Done",
    fromCategory: from,
    toCategory: "Done" as const,
  };
}

function doneIssue(key: string, at: Date, extra: Partial<DomainIssue> = {}): DomainIssue {
  return makeIssue({
    key,
    status: "Done",
    statusCategory: "Done",
    transitions: [done(at)],
    ...extra,
  });
}

const run = (issues: DomainIssue[], opts: Partial<Parameters<typeof computeMetrics>[0]> = {}) =>
  computeMetrics({
    issues,
    epics,
    period,
    nextWeek: next,
    sprint: { applicable: false, active: false },
    ...opts,
  });

describe("epic progress basis (DEF-02, DEF-07)", () => {
  it("uses points when any child has points and counts unestimated children as zero with a warning", () => {
    const result = run([
      doneIssue("DEMO-1", inWeek, { points: 5 }),
      makeIssue({ key: "DEMO-2", points: 3 }),
      makeIssue({ key: "DEMO-3", points: null }),
    ]);
    const alpha = result.epics.find((e) => e.epicKey === "DEMO-100")!;
    expect(alpha.basis).toBe("points");
    expect(alpha.totalUnits).toBe(8);
    expect(alpha.doneUnits).toBe(5);
    expect(alpha.percentComplete).toBeCloseTo(62.5);
    expect(result.warnings.map((w) => w.code)).toContain("UNESTIMATED_ISSUES");
  });

  it("uses issue counts when no child has points, with no warning", () => {
    const result = run([doneIssue("DEMO-1", inWeek), makeIssue({ key: "DEMO-2" })]);
    const alpha = result.epics.find((e) => e.epicKey === "DEMO-100")!;
    expect(alpha.basis).toBe("count");
    expect(alpha.totalUnits).toBe(2);
    expect(alpha.percentComplete).toBe(50);
    expect(result.warnings).toEqual([]);
  });

  it("excludes sub-tasks and Epic issues", () => {
    const result = run([
      makeIssue({ key: "DEMO-1" }),
      makeIssue({ key: "DEMO-2", isSubtask: true }),
      makeIssue({ key: "DEMO-3", type: "Epic" }),
    ]);
    expect(result.epics.find((e) => e.epicKey === "DEMO-100")!.totalUnits).toBe(1);
  });

  it("counts status categories at as_of", () => {
    const result = run([
      makeIssue({ key: "DEMO-1", status: "To Do", statusCategory: "To Do" }),
      makeIssue({ key: "DEMO-2" }),
      makeIssue({ key: "DEMO-3" }),
      doneIssue("DEMO-4", inWeek),
    ]);
    expect(result.epics.find((e) => e.epicKey === "DEMO-100")!.statusCounts).toEqual({
      todo: 1,
      inProgress: 2,
      done: 1,
    });
  });

  it("handles an Epic with no children without dividing by zero", () => {
    const empty = run([]).epics.find((e) => e.epicKey === "DEMO-300")!;
    expect(empty).toMatchObject({
      totalUnits: 0,
      doneUnits: 0,
      percentComplete: 0,
      noWorkItems: true,
      complete: false,
      overduePercent: null,
    });
  });

  it("marks an Epic complete only when every work item is Done", () => {
    const all = run([doneIssue("DEMO-1", inWeek), doneIssue("DEMO-2", before)]);
    expect(all.epics.find((e) => e.epicKey === "DEMO-100")!.complete).toBe(true);
    const some = run([doneIssue("DEMO-1", inWeek), makeIssue({ key: "DEMO-2" })]);
    expect(some.epics.find((e) => e.epicKey === "DEMO-100")!.complete).toBe(false);
  });

  it("computes days to due from the period end", () => {
    const alpha = run([]).epics.find((e) => e.epicKey === "DEMO-100")!;
    expect(alpha.daysToDue).toBe(43);
    expect(run([]).epics.find((e) => e.epicKey === "DEMO-200")!.daysToDue).toBeNull();
  });

  it("derives state at as_of from history, so a later completion is not counted", () => {
    const later = doneIssue("DEMO-1", after);
    const alpha = run([later]).epics.find((e) => e.epicKey === "DEMO-100")!;
    expect(alpha.doneUnits).toBe(0);
  });

  it("ignores issues created after as_of", () => {
    const alpha = run([makeIssue({ key: "DEMO-1", created: after })]).epics.find(
      (e) => e.epicKey === "DEMO-100",
    )!;
    expect(alpha.totalUnits).toBe(0);
  });
});

describe("No Epic and moved issues (DEF-09, DEF-16)", () => {
  it("groups epic-less issues under No Epic, listed last", () => {
    const result = run([makeIssue({ key: "DEMO-1", epicKey: null })]);
    const last = result.epics[result.epics.length - 1]!;
    expect(last).toMatchObject({ epicKey: null, name: "No Epic", totalUnits: 1 });
    expect(result.epics.filter((e) => e.epicKey === null)).toHaveLength(1);
  });

  it("omits No Epic when there are no such issues", () => {
    expect(run([makeIssue({ key: "DEMO-1" })]).epics.some((e) => e.epicKey === null)).toBe(false);
  });

  it("groups an issue under its current Epic and treats an unknown Epic as No Epic", () => {
    const result = run([
      makeIssue({ key: "DEMO-1", epicKey: "DEMO-200" }),
      makeIssue({ key: "DEMO-2", epicKey: "OTHER-9" }),
    ]);
    expect(result.epics.find((e) => e.epicKey === "DEMO-200")!.totalUnits).toBe(1);
    expect(result.epics.find((e) => e.epicKey === null)!.totalUnits).toBe(1);
  });
});

describe("overdue (DEF-02, FR-013)", () => {
  it("is open due-dated units over all due-dated units", () => {
    const result = run([
      makeIssue({ key: "DEMO-1", dueDate: "2026-10-10" }),
      makeIssue({ key: "DEMO-2", dueDate: "2026-12-01" }),
      doneIssue("DEMO-3", before, { dueDate: "2026-10-01" }),
      makeIssue({ key: "DEMO-4", dueDate: null }),
    ]);
    const alpha = result.epics.find((e) => e.epicKey === "DEMO-100")!;
    expect(alpha.overduePercent).toBeCloseTo(100 / 3);
    expect(result.overdue.map((i) => i.key)).toEqual(["DEMO-1"]);
  });

  it("is null when no issue has a due date", () => {
    const alpha = run([makeIssue({ key: "DEMO-1" })]).epics.find((e) => e.epicKey === "DEMO-100")!;
    expect(alpha.overduePercent).toBeNull();
  });

  it("weights by points on the points basis", () => {
    const alpha = run([
      makeIssue({ key: "DEMO-1", points: 1, dueDate: "2026-10-10" }),
      makeIssue({ key: "DEMO-2", points: 3, dueDate: "2026-12-01" }),
    ]).epics.find((e) => e.epicKey === "DEMO-100")!;
    expect(alpha.overduePercent).toBe(25);
  });

  it("does not treat a due date on the last day of the week as overdue", () => {
    const result = run([makeIssue({ key: "DEMO-1", dueDate: "2026-10-18" })]);
    expect(result.overdue).toEqual([]);
  });
});

describe("completed this week (DEF-05)", () => {
  it("lists issues whose latest transition into Done is inside the period", () => {
    const result = run([
      doneIssue("DEMO-1", inWeek, { points: 3 }),
      doneIssue("DEMO-2", before),
      doneIssue("DEMO-3", after),
    ]);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]).toMatchObject({ epicKey: "DEMO-100", points: 3 });
    expect(result.completed[0]!.issues.map((i) => i.key)).toEqual(["DEMO-1"]);
  });

  it("does not count an issue reopened after completion", () => {
    const reopened = makeIssue({
      key: "DEMO-1",
      status: "In Progress",
      statusCategory: "In Progress",
      transitions: [
        done(inWeek),
        {
          at: new Date("2026-10-16T10:00:00Z"),
          from: "Done",
          to: "In Progress",
          fromCategory: "Done",
          toCategory: "In Progress",
        },
      ],
    });
    expect(run([reopened]).completed).toEqual([]);
  });

  it("counts an issue once even if it was completed twice in the period", () => {
    const twice = makeIssue({
      key: "DEMO-1",
      status: "Done",
      statusCategory: "Done",
      transitions: [
        done(inWeek),
        {
          at: new Date("2026-10-15T12:00:00Z"),
          from: "Done",
          to: "In Progress",
          fromCategory: "Done",
          toCategory: "In Progress",
        },
        done(new Date("2026-10-16T12:00:00Z")),
      ],
    });
    const result = run([twice]);
    expect(result.completed[0]!.issues).toHaveLength(1);
  });

  it("groups by current Epic in Epic order with No Epic last and excludes sub-tasks", () => {
    const result = run([
      doneIssue("DEMO-1", inWeek, { epicKey: null }),
      doneIssue("DEMO-2", inWeek, { epicKey: "DEMO-200" }),
      doneIssue("DEMO-3", inWeek),
      doneIssue("DEMO-4", inWeek, { isSubtask: true }),
    ]);
    expect(result.completed.map((g) => g.epicKey)).toEqual(["DEMO-100", "DEMO-200", null]);
    expect(result.completed[2]!.epicName).toBe("No Epic");
  });
});

describe("planned next week (DEF-06)", () => {
  const dueNext = makeIssue({ key: "DEMO-1", dueDate: "2026-10-22" });
  const sprintOnly = makeIssue({ key: "DEMO-2", inActiveSprint: true });
  const doneInSprint = doneIssue("DEMO-3", before, { inActiveSprint: true });
  const dueLater = makeIssue({ key: "DEMO-4", dueDate: "2026-11-02" });

  it("uses due dates in the following Monday to Sunday week", () => {
    const result = run([dueNext, dueLater]);
    expect(result.planned.flatMap((g) => g.issues.map((i) => i.key))).toEqual(["DEMO-1"]);
  });

  it("adds the active sprint when applicable, never Done issues", () => {
    const result = run([dueNext, sprintOnly, doneInSprint], {
      sprint: { applicable: true, active: true },
    });
    expect(result.planned.flatMap((g) => g.issues.map((i) => i.key))).toEqual(["DEMO-1", "DEMO-2"]);
    expect(result.warnings).toEqual([]);
  });

  it("falls back to due dates with a warning when no sprint is active", () => {
    const result = run([dueNext, sprintOnly], { sprint: { applicable: true, active: false } });
    expect(result.planned.flatMap((g) => g.issues.map((i) => i.key))).toEqual(["DEMO-1"]);
    expect(result.warnings.map((w) => w.code)).toContain("NO_ACTIVE_SPRINT");
  });

  it("uses only due dates, without a warning, for older weeks", () => {
    const result = run([dueNext, sprintOnly], { sprint: { applicable: false, active: true } });
    expect(result.planned.flatMap((g) => g.issues.map((i) => i.key))).toEqual(["DEMO-1"]);
    expect(result.warnings).toEqual([]);
  });

  it("excludes sub-tasks", () => {
    expect(
      run([makeIssue({ key: "DEMO-1", dueDate: "2026-10-22", isSubtask: true })]).planned,
    ).toEqual([]);
  });
});

describe("bugs (FR-014)", () => {
  it("counts opened, closed and currently open across all Epics", () => {
    const result = run([
      makeIssue({ key: "DEMO-1", type: "Bug", created: inWeek, epicKey: null }),
      makeIssue({ key: "DEMO-2", type: "Bug", created: before }),
      doneIssue("DEMO-3", inWeek, { type: "Bug", created: before, epicKey: "DEMO-200" }),
      doneIssue("DEMO-4", before, { type: "Bug", created: before }),
      makeIssue({ key: "DEMO-5", type: "Story", created: inWeek }),
      makeIssue({ key: "DEMO-6", type: "Bug", created: after }),
    ]);
    expect(result.bugs).toEqual({ opened: 1, closed: 1, currentlyOpen: 2 });
  });
});

describe("rounding (DEF-07)", () => {
  it("rounds percentages to whole numbers", () => {
    expect(roundPercent(62.5)).toBe(63);
    expect(roundPercent(33.333)).toBe(33);
  });

  it("computes deltas from unrounded values to one decimal", () => {
    expect(percentDelta(62.46, 50.04)).toBe(12.4);
    expect(percentDelta(50, 62.5)).toBe(-12.5);
  });

  it("is n/a without a previous value", () => {
    expect(percentDelta(50, null)).toBe("n/a");
    expect(percentDelta(50, undefined)).toBe("n/a");
  });
});
