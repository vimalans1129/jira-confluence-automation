import type { Rag } from "@contract";
import { apiRequest } from "./client";

export interface TrendWeek {
  weekStart: string;
  overallRag: Rag;
  percentComplete: number | null;
  blockerCount: number;
  epics: { epicKey: string; name: string; rag: Rag; percentComplete: number }[];
}

export interface OverrideView {
  weekStart: string;
  scope: "overall" | "epic";
  epicKey: string | null;
  rag: Rag;
  reason: string;
}

export interface OverrideInput {
  weekStart: string;
  scope: "overall" | "epic";
  epicKey?: string;
  rag: Rag;
  reason: string;
}

export const MIN_TREND_WEEKS = 4;
export const MAX_TREND_WEEKS = 12;
export const DEFAULT_TREND_WEEKS = 6;

export const getTrend = async (weeks: number, to: string): Promise<TrendWeek[]> =>
  (await apiRequest<{ weeks: TrendWeek[] }>("GET", `/snapshots?weeks=${weeks}&to=${to}`)).weeks;

export const listOverrides = async (weekStart: string): Promise<OverrideView[]> =>
  (await apiRequest<{ overrides: OverrideView[] }>("GET", `/overrides?weekStart=${weekStart}`))
    .overrides;

export const saveOverride = (
  body: OverrideInput,
): Promise<{ warnings: { code: string; message: string }[] }> =>
  apiRequest("POST", "/overrides", body);

export const deleteOverride = (o: {
  weekStart: string;
  scope: "overall" | "epic";
  epicKey: string | null;
}): Promise<void> => {
  const params = new URLSearchParams({ weekStart: o.weekStart, scope: o.scope });
  if (o.epicKey) params.set("epicKey", o.epicKey);
  return apiRequest("DELETE", `/overrides?${params.toString()}`);
};
