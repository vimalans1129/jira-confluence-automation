import { describe, expect, it } from "vitest";
import { reportSchema, type Report } from "../src/contract/index.js";
import { sampleReport } from "../src/contract/sampleReport.js";

function clone(): Report {
  return structuredClone(sampleReport);
}

describe("report contract", () => {
  it("accepts the sample fixture", () => {
    expect(reportSchema.parse(sampleReport)).toEqual(sampleReport);
  });

  it("allows n/a for week-over-week fields", () => {
    const report = clone();
    expect(report.epics[0]?.percentDelta).toBe("n/a");
    expect(report.overall.ragChange).toBe("n/a");
    const withDelta = clone();
    if (withDelta.epics[0]) withDelta.epics[0].percentDelta = -2.5;
    expect(reportSchema.safeParse(withDelta).success).toBe(true);
  });

  it("rejects an unknown RAG value", () => {
    const bad = clone() as unknown as { overall: { rag: { effective: string } } };
    bad.overall.rag.effective = "Purple";
    expect(reportSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a bad date, a missing field and a negative age", () => {
    const badDate = { ...clone(), weekStart: "12/10/2026" };
    expect(reportSchema.safeParse(badDate).success).toBe(false);
    const missing: Partial<Report> = clone();
    delete missing.bugs;
    expect(reportSchema.safeParse(missing).success).toBe(false);
    const badAge = clone();
    if (badAge.blockers[0]) badAge.blockers[0].ageDays = -1;
    expect(reportSchema.safeParse(badAge).success).toBe(false);
  });

  it("requires a reason for an override", () => {
    const bad = clone();
    bad.overrides = [{ scope: "overall", epicKey: null, rag: "Red", reason: "" }];
    expect(reportSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts an approved summary and a null mitigation", () => {
    const ok = clone();
    ok.summary = { text: "Steady progress.", approved: true };
    expect(reportSchema.safeParse(ok).success).toBe(true);
    expect(ok.blockers[0]?.mitigation).toBeNull();
  });
});
