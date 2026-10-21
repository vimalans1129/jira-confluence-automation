import type { Report } from "@contract";
import { RagBadge } from "../components/RagBadge";

const pct = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

export function DashboardView({ report }: { report: Report }) {
  const { overall } = report;
  return (
    <>
      <section aria-labelledby="overall-heading">
        <h2 id="overall-heading">Overall status</h2>
        <p>
          <RagBadge rag={overall.rag.effective} /> Change vs last week: {overall.ragChange}
        </p>
        <p>
          Week {report.weekStart} to {report.weekEnd} ({report.timeZone})
          {report.dryRun ? " - dry run" : ""}
        </p>
        {overall.rag.reasons.length > 0 ? (
          <ul aria-label="Reasons for the overall status">
            {overall.rag.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p>No risk signals were triggered.</p>
        )}
      </section>

      <section aria-labelledby="milestones-heading">
        <h2 id="milestones-heading">Milestone progress</h2>
        {report.epics.length === 0 ? (
          <p>No epics were found for this project.</p>
        ) : (
          <table>
            <caption className="sr-only">Progress for each epic</caption>
            <thead>
              <tr>
                <th scope="col">Epic</th>
                <th scope="col">RAG</th>
                <th scope="col">Complete</th>
                <th scope="col">Done / total</th>
                <th scope="col">Due</th>
                <th scope="col">Change</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {report.epics.map((epic) => (
                <tr key={epic.epicKey ?? epic.name}>
                  <th scope="row">{epic.name}</th>
                  <td>
                    <RagBadge rag={epic.rag.effective} />
                  </td>
                  <td>
                    <progress
                      max={100}
                      value={epic.percentComplete}
                      aria-label={`${epic.name} complete`}
                    />{" "}
                    {pct(epic.percentComplete)}
                  </td>
                  <td>
                    {epic.doneUnits} / {epic.totalUnits} {epic.basis === "points" ? "pts" : "items"}
                  </td>
                  <td>{epic.dueDate ?? "No due date"}</td>
                  <td>
                    {epic.ragChange}, {epic.percentDelta}
                  </td>
                  <td>{epic.rag.reasons.join("; ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
