import type { IssueGroup, Report } from "@contract";

function Groups({ title, groups, empty }: { title: string; groups: IssueGroup[]; empty: string }) {
  const id = title.toLowerCase().replace(/\W+/g, "-");
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {groups.length === 0 ? (
        <p>{empty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.epicKey ?? group.epicName}>
            <h3>
              {group.epicName} ({group.points} pts)
            </h3>
            <ul>
              {group.issues.map((issue) => (
                <li key={issue.key}>
                  <strong>{issue.key}</strong> {issue.summary} ({issue.status}
                  {issue.points === null ? "" : `, ${issue.points} pts`})
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

export function ReportView({ report }: { report: Report }) {
  return (
    <>
      <Groups
        title="Completed this week"
        groups={report.completed}
        empty="Nothing was completed this week."
      />
      <Groups
        title="Planned next week"
        groups={report.planned}
        empty="Nothing is planned for next week."
      />
      <section aria-labelledby="risks-heading">
        <h2 id="risks-heading">Key risks and issues</h2>
        {report.blockers.length === 0 ? (
          <p>No open flagged or blocked items.</p>
        ) : (
          <table>
            <caption className="sr-only">Open flagged or blocked items</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Workstream</th>
                <th scope="col">Age</th>
                <th scope="col">Mitigation plan</th>
              </tr>
            </thead>
            <tbody>
              {report.blockers.map((b) => (
                <tr key={b.key}>
                  <th scope="row">
                    {b.key} {b.summary}
                  </th>
                  <td>{b.epicName}</td>
                  <td>{b.ageDays} days</td>
                  <td>{b.mitigation ?? "No mitigation recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
