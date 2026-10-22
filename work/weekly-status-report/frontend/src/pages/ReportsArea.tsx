import { useState } from "react";
import { GeneratePanel } from "../components/GeneratePanel";
import { useLatestReport } from "../hooks/useLatestReport";
import { DashboardView } from "./DashboardPage";
import { ReportView } from "./ReportPage";
import { OverridesPage } from "./OverridesPage";

type Tab = "dashboard" | "report" | "overrides";

export function ReportsArea() {
  const { state, submitError, generate, refresh, setJob } = useLatestReport();
  const [tab, setTab] = useState<Tab>("dashboard");
  const job = state.kind === "ready" ? state.job : null;
  const report = state.kind === "ready" ? state.report : null;

  return (
    <>
      <GeneratePanel
        job={job}
        submitError={submitError}
        onGenerate={generate}
        onJobChanged={setJob}
      />

      {state.kind === "loading" && <p role="status">Loading the latest report…</p>}
      {state.kind === "error" && (
        <div role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}
      {state.kind === "empty" && <p>No report has been generated yet. Use Generate above.</p>}
      {state.kind === "ready" && !report && job?.status === "succeeded" && (
        <p>The data for this report is past the retention period. Generate it again.</p>
      )}
      {report && (
        <>
          <div role="group" aria-label="Report views">
            <button
              type="button"
              aria-pressed={tab === "dashboard"}
              onClick={() => setTab("dashboard")}
            >
              Dashboard
            </button>{" "}
            <button type="button" aria-pressed={tab === "report"} onClick={() => setTab("report")}>
              Report
            </button>{" "}
            <button
              type="button"
              aria-pressed={tab === "overrides"}
              onClick={() => setTab("overrides")}
              disabled={job?.dryRun === true}
            >
              Overrides
            </button>
          </div>
          {tab === "dashboard" && <DashboardView report={report} />}
          {tab === "report" && <ReportView report={report} />}
          {tab === "overrides" && <OverridesPage report={report} onChanged={refresh} />}
        </>
      )}
    </>
  );
}
