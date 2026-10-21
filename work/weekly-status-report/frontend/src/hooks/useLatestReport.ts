import type { Report } from "@contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  getJob,
  getReportData,
  latestJob,
  startReport,
  type GenerateRequest,
  type JobView,
} from "../api/reports";

export type ReportState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; job: JobView; report: Report | null };

const POLL_MS = 1500;
const active = (job: JobView): boolean => job.status === "queued" || job.status === "running";

function message(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export function useLatestReport(pollMs = POLL_MS) {
  const [state, setState] = useState<ReportState>({ kind: "loading" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (job: JobView | null) => {
    if (!job) {
      setState({ kind: "empty" });
      return;
    }
    let report: Report | null = null;
    if (job.status === "succeeded") {
      try {
        report = await getReportData(job.id);
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "REPORT_PRUNED")) throw err;
      }
    }
    if (alive.current) setState({ kind: "ready", job, report });
  }, []);

  const refresh = useCallback(async () => {
    try {
      await load(await latestJob());
    } catch (err) {
      if (alive.current) setState({ kind: "error", message: message(err) });
    }
  }, [load]);

  useEffect(() => {
    alive.current = true;
    latestJob()
      .then(load)
      .catch((err) => {
        if (alive.current) setState({ kind: "error", message: message(err) });
      });
    return () => {
      alive.current = false;
    };
  }, [load]);

  const jobId = state.kind === "ready" && active(state.job) ? state.job.id : null;
  useEffect(() => {
    if (jobId === null) return;
    const timer = setInterval(() => {
      getJob(jobId).then(
        (job) => {
          if (!alive.current) return;
          if (active(job)) setState({ kind: "ready", job, report: null });
          else void load(job).catch((err) => setState({ kind: "error", message: message(err) }));
        },
        (err) => alive.current && setState({ kind: "error", message: message(err) }),
      );
    }, pollMs);
    return () => clearInterval(timer);
  }, [jobId, load, pollMs]);

  const generate = useCallback(async (request: GenerateRequest) => {
    setSubmitError(null);
    try {
      const job = await startReport(request);
      setState({ kind: "ready", job, report: null });
    } catch (err) {
      setSubmitError(message(err));
    }
  }, []);

  const setJob = useCallback((job: JobView) => {
    setState((s) => (s.kind === "ready" ? { ...s, job } : s));
  }, []);

  return { state, submitError, generate, refresh, setJob };
}
