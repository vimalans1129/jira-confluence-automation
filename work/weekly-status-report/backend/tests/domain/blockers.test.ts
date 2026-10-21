import { describe, expect, it } from "vitest";
import { detectBlockers } from "../../src/domain/blockers.js";
import { makeIssue } from "./helpers.js";

const asOf = new Date("2026-10-18T21:59:59.999Z");
const blocked = ["Blocked", "On Hold"];
const opts = { asOf, blockedStatuses: blocked };
const ago = (days: number, extraHours = 0) =>
  new Date(asOf.getTime() - days * 86_400_000 - extraHours * 3_600_000);

describe("detectBlockers", () => {
  it("finds an open flagged issue and ages it from the flag event", () => {
    const issue = makeIssue({
      key: "DEMO-2",
      flagged: true,
      flagEvents: [{ at: ago(3, 5), flagged: true }],
    });
    const { blockers, warnings } = detectBlockers([issue], opts);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ reason: "flagged", ageDays: 3 });
    expect(warnings).toEqual([]);
  });

  it("matches blocked statuses case-insensitively", () => {
    const issue = makeIssue({
      status: "BLOCKED",
      transitions: [
        {
          at: ago(6),
          from: "In Progress",
          to: "BLOCKED",
          fromCategory: "In Progress",
          toCategory: "In Progress",
        },
      ],
    });
    const { blockers } = detectBlockers([issue], opts);
    expect(blockers[0]).toMatchObject({ reason: "blocked-status", ageDays: 6 });
  });

  it("uses the latest set event and ignores a cleared flag", () => {
    const reflagged = makeIssue({
      key: "DEMO-3",
      flagged: true,
      flagEvents: [
        { at: ago(20), flagged: true },
        { at: ago(15), flagged: false },
        { at: ago(2), flagged: true },
      ],
    });
    const cleared = makeIssue({
      key: "DEMO-4",
      flagged: false,
      flagEvents: [
        { at: ago(9), flagged: true },
        { at: ago(1), flagged: false },
      ],
    });
    const { blockers } = detectBlockers([reflagged, cleared], opts);
    expect(blockers.map((b) => [b.issue.key, b.ageDays])).toEqual([["DEMO-3", 2]]);
  });

  it("excludes Done issues", () => {
    const issue = makeIssue({
      flagged: true,
      status: "Done",
      statusCategory: "Done",
      flagEvents: [{ at: ago(4), flagged: true }],
      transitions: [
        {
          at: ago(1),
          from: "In Progress",
          to: "Done",
          fromCategory: "In Progress",
          toCategory: "Done",
        },
      ],
    });
    expect(detectBlockers([issue], opts).blockers).toEqual([]);
  });

  it("evaluates past weeks at as_of, not at the current state", () => {
    const issue = makeIssue({
      flagged: false,
      flagEvents: [
        { at: ago(4), flagged: true },
        { at: new Date(asOf.getTime() + 3_600_000), flagged: false },
      ],
    });
    expect(detectBlockers([issue], opts).blockers).toHaveLength(1);
  });

  it("ignores issues created after as_of", () => {
    const issue = makeIssue({
      flagged: true,
      created: new Date(asOf.getTime() + 1000),
      flagEvents: [{ at: new Date(asOf.getTime() + 2000), flagged: true }],
    });
    expect(detectBlockers([issue], opts).blockers).toEqual([]);
  });

  it("falls back to the update date with a warning when no event is found", () => {
    const issue = makeIssue({ key: "DEMO-9", flagged: true, updated: ago(8) });
    const { blockers, warnings } = detectBlockers([issue], opts);
    expect(blockers[0]?.ageDays).toBe(8);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("BLOCKER_AGE_FALLBACK");
    expect(warnings[0]?.message).toContain("DEMO-9");
  });

  it("counts whole days only", () => {
    const issue = makeIssue({
      flagged: true,
      flagEvents: [{ at: ago(4, -1), flagged: true }],
    });
    expect(detectBlockers([issue], opts).blockers[0]?.ageDays).toBe(3);
  });

  it("is a blocker when both flagged and blocked, using the most recent event", () => {
    const issue = makeIssue({
      flagged: true,
      status: "Blocked",
      flagEvents: [{ at: ago(10), flagged: true }],
      transitions: [
        {
          at: ago(2),
          from: "In Progress",
          to: "Blocked",
          fromCategory: "In Progress",
          toCategory: "In Progress",
        },
      ],
    });
    expect(detectBlockers([issue], opts).blockers[0]).toMatchObject({
      reason: "flagged",
      ageDays: 2,
    });
  });

  it("sorts oldest first, then by key", () => {
    const mk = (key: string, days: number) =>
      makeIssue({ key, flagged: true, flagEvents: [{ at: ago(days), flagged: true }] });
    const { blockers } = detectBlockers([mk("DEMO-B", 2), mk("DEMO-A", 2), mk("DEMO-C", 7)], opts);
    expect(blockers.map((b) => b.issue.key)).toEqual(["DEMO-C", "DEMO-A", "DEMO-B"]);
  });

  it("never reports a negative age", () => {
    const issue = makeIssue({
      flagged: true,
      flagEvents: [{ at: new Date(asOf.getTime() - 1000), flagged: true }],
    });
    expect(detectBlockers([issue], opts).blockers[0]?.ageDays).toBe(0);
  });
});
