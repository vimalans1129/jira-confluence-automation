import type { Report } from "@contract";
import { useEffect, useId, useState } from "react";
import {
  DEFAULT_TREND_WEEKS,
  MAX_TREND_WEEKS,
  MIN_TREND_WEEKS,
  getTrend,
  type TrendWeek,
} from "../api/trends";
import { RagBadge } from "./RagBadge";

const W = 600;
const H = 200;
const PAD = 30;

const pct = (n: number | null): string => (n === null ? "n/a" : `${n}%`);

export function trendSummary(weeks: TrendWeek[]): string {
  if (weeks.length === 0) return "No earlier weeks have been recorded yet.";
  return `Overall percent complete and status by week: ${weeks
    .map((w) => `${w.weekStart} ${pct(w.percentComplete)}, ${w.overallRag}`)
    .join("; ")}.`;
}

function Chart({ weeks }: { weeks: TrendWeek[] }) {
  const titleId = useId();
  const x = (i: number) =>
    weeks.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (weeks.length - 1);
  const y = (v: number) => H - PAD - (v / 100) * (H - 2 * PAD);
  const points = weeks.flatMap((w, i) =>
    w.percentComplete === null ? [] : [[x(i), y(w.percentComplete), w] as const],
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} className="trend-chart">
      <title id={titleId}>{trendSummary(weeks)}</title>
      <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} className="axis" />
      <line x1={PAD} y1={y(100)} x2={W - PAD} y2={y(100)} className="axis" />
      <text x={2} y={y(100) + 4} fontSize="12">
        100%
      </text>
      <text x={2} y={y(0) + 4} fontSize="12">
        0%
      </text>
      <polyline
        fill="none"
        className="trend-line"
        points={points.map(([px, py]) => `${px},${py}`).join(" ")}
      />
      {points.map(([px, py, w]) => (
        <circle
          key={w.weekStart}
          cx={px}
          cy={py}
          r={6}
          className={`dot dot-${w.overallRag.toLowerCase()}`}
        />
      ))}
      {weeks.map((w, i) => (
        <text key={w.weekStart} x={x(i)} y={H - 8} fontSize="12" textAnchor="middle">
          {w.weekStart.slice(5)}
        </text>
      ))}
    </svg>
  );
}

export function TrendSection({ report }: { report: Report }) {
  const [count, setCount] = useState(DEFAULT_TREND_WEEKS);
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error" } | { kind: "ready"; weeks: TrendWeek[] }
  >({ kind: "loading" });
  const selectId = useId();

  useEffect(() => {
    let live = true;
    getTrend(count, report.weekStart).then(
      (weeks) => live && setState({ kind: "ready", weeks }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [count, report]);

  return (
    <section aria-labelledby="trend-heading">
      <h2 id="trend-heading">Trend</h2>
      <p>
        <label htmlFor={selectId}>Number of weeks </label>
        <select id={selectId} value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {Array.from(
            { length: MAX_TREND_WEEKS - MIN_TREND_WEEKS + 1 },
            (_, i) => MIN_TREND_WEEKS + i,
          ).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </p>
      {state.kind === "loading" && <p role="status">Loading the trend…</p>}
      {state.kind === "error" && <p role="alert">The trend could not be loaded.</p>}
      {state.kind === "ready" &&
        (state.weeks.length === 0 ? (
          <p>No earlier weeks have been recorded yet.</p>
        ) : (
          <>
            <Chart weeks={state.weeks} />
            <table>
              <caption>Trend data</caption>
              <thead>
                <tr>
                  <th scope="col">Week</th>
                  <th scope="col">Overall status</th>
                  <th scope="col">Percent complete</th>
                  <th scope="col">Blockers</th>
                </tr>
              </thead>
              <tbody>
                {state.weeks.map((w) => (
                  <tr key={w.weekStart}>
                    <th scope="row">{w.weekStart}</th>
                    <td>
                      <RagBadge rag={w.overallRag} />
                    </td>
                    <td>{pct(w.percentComplete)}</td>
                    <td>{w.blockerCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
    </section>
  );
}
