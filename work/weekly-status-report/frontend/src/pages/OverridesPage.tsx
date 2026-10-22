import type { Rag, Report } from "@contract";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { deleteOverride, listOverrides, saveOverride, type OverrideView } from "../api/trends";
import { RagBadge } from "../components/RagBadge";

const RAGS: Rag[] = ["Red", "Amber", "Green"];
const OVERALL = "__overall__";

export function previousWeek(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

const targetLabel = (o: Pick<OverrideView, "scope" | "epicKey">): string =>
  o.scope === "overall" ? "Overall status" : (o.epicKey ?? "");

const message = (err: unknown): string =>
  err instanceof ApiError ? err.message : "Something went wrong. Try again.";

export function OverridesPage({
  report,
  onChanged,
}: {
  report: Report;
  onChanged: () => Promise<void>;
}) {
  const week = report.weekStart;
  const [current, setCurrent] = useState<OverrideView[]>([]);
  const [previous, setPrevious] = useState<OverrideView[]>([]);
  const [target, setTarget] = useState(OVERALL);
  const [rag, setRag] = useState<Rag>("Amber");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { target: useId(), rag: useId(), reason: useId(), reasonError: useId() };

  const reload = useCallback(
    () =>
      Promise.all([listOverrides(week), listOverrides(previousWeek(week))]).then(
        ([now, before]) => {
          setCurrent(now);
          setPrevious(before);
        },
        (err) => setError(message(err)),
      ),
    [week],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const epicKeys = new Set(report.epics.flatMap((e) => (e.epicKey ? [e.epicKey] : [])));

  async function persist(input: {
    scope: "overall" | "epic";
    epicKey?: string;
    rag: Rag;
    reason: string;
  }) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveOverride({ weekStart: week, ...input });
      setNotice(result.warnings[0]?.message ?? "Override saved.");
      await reload();
      await onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() === "") {
      setReasonError("Enter a reason for the override.");
      return;
    }
    setReasonError(null);
    void persist(
      target === OVERALL
        ? { scope: "overall", rag, reason: reason.trim() }
        : { scope: "epic", epicKey: target, rag, reason: reason.trim() },
    ).then(() => setReason(""));
  }

  async function remove(o: OverrideView) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteOverride(o);
      setNotice("Override removed.");
      await reload();
      await onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const offers = previous.filter(
    (o) =>
      !current.some((c) => c.scope === o.scope && c.epicKey === o.epicKey) &&
      (o.scope === "overall" || epicKeys.has(o.epicKey ?? "")),
  );

  return (
    <section aria-labelledby="overrides-page-heading">
      <h2 id="overrides-page-heading">Status overrides for the week of {week}</h2>
      <p>An override applies to this week only and always needs a reason.</p>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <form onSubmit={submit} noValidate>
        <p>
          <label htmlFor={ids.target}>Applies to </label>
          <select id={ids.target} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value={OVERALL}>Overall status</option>
            {report.epics
              .filter((e) => e.epicKey !== null)
              .map((e) => (
                <option key={e.epicKey} value={e.epicKey!}>
                  {e.epicKey} {e.name}
                </option>
              ))}
          </select>
        </p>
        <p>
          <label htmlFor={ids.rag}>Status </label>
          <select id={ids.rag} value={rag} onChange={(e) => setRag(e.target.value as Rag)}>
            {RAGS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor={ids.reason}>Reason (required) </label>
          <textarea
            id={ids.reason}
            value={reason}
            maxLength={500}
            rows={3}
            required
            aria-invalid={reasonError !== null}
            aria-describedby={reasonError ? ids.reasonError : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
        </p>
        {reasonError && (
          <p id={ids.reasonError} role="alert">
            {reasonError}
          </p>
        )}
        <button type="submit" disabled={busy}>
          Save override
        </button>
      </form>

      <h3>Current overrides</h3>
      {current.length === 0 ? (
        <p>No overrides for this week.</p>
      ) : (
        <table>
          <caption className="sr-only">Overrides for this week</caption>
          <thead>
            <tr>
              <th scope="col">Applies to</th>
              <th scope="col">Status</th>
              <th scope="col">Reason</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {current.map((o) => (
              <tr key={`${o.scope}-${o.epicKey ?? ""}`}>
                <th scope="row">{targetLabel(o)}</th>
                <td>
                  <RagBadge rag={o.rag} />
                </td>
                <td>{o.reason}</td>
                <td>
                  <button type="button" disabled={busy} onClick={() => void remove(o)}>
                    Remove override for {targetLabel(o)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {offers.length > 0 && (
        <>
          <h3>Overrides from last week</h3>
          <p>Confirm each one you want to carry over to this week.</p>
          <ul>
            {offers.map((o) => (
              <li key={`${o.scope}-${o.epicKey ?? ""}`}>
                {targetLabel(o)}: <RagBadge rag={o.rag} /> {o.reason}{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void persist({
                      scope: o.scope,
                      ...(o.epicKey ? { epicKey: o.epicKey } : {}),
                      rag: o.rag,
                      reason: o.reason,
                    })
                  }
                >
                  Apply {targetLabel(o)} to this week
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
