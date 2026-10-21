import type { Report } from "@contract";
import { sampleReport } from "@contract/sampleReport.js";

describe("shared report contract", () => {
  it("lets the UI use the backend report type and fixture", () => {
    const report: Report = sampleReport;
    expect(report.projectKey).toBe("DEMO");
    expect(report.overall.ragChange).toBe("n/a");
  });
});
