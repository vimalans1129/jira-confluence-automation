import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { downloadDeck, regenerateDeck, type GenerateRequest, type JobView } from "../api/reports";
import { validateGenerateForm, type FormErrors } from "../lib/validation";

interface Props {
  job: JobView | null;
  submitError: string | null;
  onGenerate: (request: GenerateRequest) => Promise<void>;
  onJobChanged: (job: JobView) => void;
}

export function GeneratePanel({ job, submitError, onGenerate, onJobChanged }: Props) {
  const [weekStart, setWeekStart] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);

  const running = job?.status === "queued" || job?.status === "running";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateGenerateForm({ weekStart, timeZone, dryRun });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    await onGenerate({
      ...(weekStart ? { weekStart } : {}),
      ...(timeZone ? { timeZone } : {}),
      dryRun,
    });
    setBusy(false);
  }

  async function deckAction(action: () => Promise<void>) {
    setDeckError(null);
    try {
      await action();
    } catch (err) {
      setDeckError(err instanceof ApiError ? err.message : "The deck request failed.");
    }
  }

  return (
    <section aria-labelledby="generate-heading">
      <h2 id="generate-heading">Generate a report</h2>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div>
          <label htmlFor="weekStart">Week (any date in the week, blank for last week)</label>
          <input
            id="weekStart"
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            aria-invalid={errors.weekStart !== undefined}
            aria-describedby={errors.weekStart ? "weekStart-error" : undefined}
          />
          {errors.weekStart && (
            <p id="weekStart-error" role="alert">
              {errors.weekStart}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="timeZone">Time zone (blank for the saved setting)</label>
          <input
            id="timeZone"
            type="text"
            placeholder="Europe/London"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value.trim())}
            aria-invalid={errors.timeZone !== undefined}
            aria-describedby={errors.timeZone ? "timeZone-error" : undefined}
          />
          {errors.timeZone && (
            <p id="timeZone-error" role="alert">
              {errors.timeZone}
            </p>
          )}
        </div>
        <div>
          <input
            id="dryRun"
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          <label htmlFor="dryRun">Dry run (show metrics only, no deck)</label>
        </div>
        <button type="submit" disabled={busy || running}>
          {running ? "Generating…" : "Generate"}
        </button>
        {submitError && <p role="alert">{submitError}</p>}
      </form>

      {job && (
        <div aria-live="polite" className="job-status">
          {running && (
            <p role="status">
              Generating the report for the week of {job.weekStart}: {job.stage ?? job.status}…
            </p>
          )}
          {job.status === "succeeded" && (
            <p role="status">
              Report for the week of {job.weekStart} is ready{job.dryRun ? " (dry run)" : ""}.
            </p>
          )}
          {job.status === "failed" && (
            <p role="alert">
              The report failed: {job.error?.message ?? "unknown error"}
              {job.error ? ` (${job.error.code})` : ""}
            </p>
          )}
          {job.warnings.length > 0 && (
            <ul aria-label="Warnings">
              {job.warnings.map((w) => (
                <li key={w.code}>Warning: {w.message}</li>
              ))}
            </ul>
          )}
          {job.status === "succeeded" && !job.dryRun && job.hasDeck && (
            <div>
              {job.deckStale && <p>The deck is out of date with the latest data.</p>}
              <button type="button" onClick={() => void deckAction(() => downloadDeck(job.id))}>
                Download deck
              </button>{" "}
              <button
                type="button"
                onClick={() =>
                  void deckAction(async () => onJobChanged(await regenerateDeck(job.id)))
                }
              >
                Regenerate deck
              </button>
            </div>
          )}
          {deckError && <p role="alert">{deckError}</p>}
        </div>
      )}
    </section>
  );
}
