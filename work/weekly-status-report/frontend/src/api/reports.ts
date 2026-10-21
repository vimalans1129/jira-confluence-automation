import type { Report, ReportWarning } from "@contract";
import { ApiError, apiRequest } from "./client";

export interface JobView {
  id: number;
  weekStart: string;
  timeZone: string;
  dryRun: boolean;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string | null;
  error: { code: string; message: string | null } | null;
  warnings: ReportWarning[];
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  hasDeck: boolean;
  deckStale: boolean;
}

export interface GenerateRequest {
  weekStart?: string;
  timeZone?: string;
  dryRun?: boolean;
}

export const latestJob = async (): Promise<JobView | null> =>
  (await apiRequest<{ job: JobView | null }>("GET", "/reports/latest")).job;

export const startReport = (body: GenerateRequest): Promise<JobView> =>
  apiRequest<JobView>("POST", "/reports", body);

export const getJob = (id: number): Promise<JobView> =>
  apiRequest<JobView>("GET", `/reports/${id}`);

export const getReportData = (id: number): Promise<Report> =>
  apiRequest<Report>("GET", `/reports/${id}/data`);

export const regenerateDeck = (id: number): Promise<JobView> =>
  apiRequest<JobView>("POST", `/reports/${id}/deck`);

export async function downloadDeck(id: number): Promise<void> {
  const res = await fetch(`/api/v1/reports/${id}/deck`, { credentials: "same-origin" });
  if (!res.ok)
    throw new ApiError(res.status, "DECK_NOT_FOUND", "The deck could not be downloaded.");
  const disposition = res.headers.get("content-disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "Weekly_Status.pptx";
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
