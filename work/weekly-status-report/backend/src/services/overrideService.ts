import { z } from "zod";
import { ragSchema } from "../contract/index.js";
import type { SettingsRepository } from "../repositories/settingsRepository.js";
import { periodForDate } from "../domain/period.js";
import { AppError } from "../errors.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import type {
  OverrideChange,
  OverrideRecord,
  OverrideRepository,
} from "../repositories/overrideRepository.js";
import type { SnapshotRepository } from "../repositories/snapshotRepository.js";
import { applyOverrides, OVERRIDE_EPIC_MISSING } from "./overrides.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const overrideBodySchema = z
  .object({
    weekStart: date,
    scope: z.enum(["overall", "epic"]),
    epicKey: z.string().trim().min(1).max(64).nullable().optional(),
    rag: ragSchema,
    reason: z.string().trim().min(1, "A reason is required").max(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === "epic" && !v.epicKey) {
      ctx.addIssue({ code: "custom", path: ["epicKey"], message: "An Epic key is required" });
    }
    if (v.scope === "overall" && v.epicKey) {
      ctx.addIssue({ code: "custom", path: ["epicKey"], message: "Overall has no Epic key" });
    }
  });

export const overrideKeySchema = z
  .object({
    weekStart: date,
    scope: z.enum(["overall", "epic"]),
    epicKey: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === "epic" && !v.epicKey) {
      ctx.addIssue({ code: "custom", path: ["epicKey"], message: "An Epic key is required" });
    }
  });

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_FAILED",
      "The request is not valid",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}

export interface OverrideServiceDeps {
  overrides: OverrideRepository;
  jobs: JobRepository;
  settings: Pick<SettingsRepository, "load">;
  snapshots?: SnapshotRepository;
  now?: () => Date;
}

export interface OverrideService {
  list(weekStart: unknown): Promise<{ weekStart: string; overrides: OverrideRecord[] }>;
  set(body: unknown): Promise<{
    override: OverrideRecord;
    change: OverrideChange;
    warnings: { code: string; message: string }[];
  }>;
  clear(query: unknown): Promise<{ warnings: { code: string; message: string }[] }>;
}

export function createOverrideService(deps: OverrideServiceDeps): OverrideService {
  const now = deps.now ?? (() => new Date());

  async function normalizeWeek(raw: string): Promise<string> {
    const { timeZone } = await deps.settings.load();
    return periodForDate(raw, timeZone, now()).weekStart;
  }

  // Recomputes the stored report from stored data only; there are no Jira calls (FR-022).
  async function recompute(weekStart: string) {
    const job = await deps.jobs.latestSucceeded(weekStart);
    if (!job?.report) return [];
    const [stored, previous] = await Promise.all([
      deps.overrides.list(weekStart),
      deps.snapshots?.findPrevious(weekStart) ?? null,
    ]);
    const hasDeck = (await deps.jobs.getDeck(weekStart)) !== null;
    const report = { ...applyOverrides(job.report, stored, previous), deckStale: hasDeck };
    await deps.jobs.updateReport(job.id, report, report.warnings);
    await deps.jobs.markDeckStale(weekStart);

    const [current] = (await deps.snapshots?.list(weekStart, 1)) ?? [];
    if (current && current.weekStart === weekStart) {
      const byKey = new Map(report.epics.map((e) => [e.epicKey ?? "", e.rag.effective]));
      await deps.snapshots!.replace({
        ...current,
        overallRag: report.overall.rag.effective,
        epics: current.epics.map((e) => ({ ...e, rag: byKey.get(e.epicKey) ?? e.rag })),
      });
    }
    return report.warnings.filter((w) => w.code === OVERRIDE_EPIC_MISSING);
  }

  return {
    async list(raw) {
      const { weekStart } = parseOrThrow(z.object({ weekStart: date }).strict(), {
        weekStart: raw,
      });
      const week = await normalizeWeek(weekStart);
      return { weekStart: week, overrides: await deps.overrides.list(week) };
    },

    async set(body) {
      const input = parseOrThrow(overrideBodySchema, body);
      const override: OverrideRecord = {
        weekStart: await normalizeWeek(input.weekStart),
        scope: input.scope,
        epicKey: input.scope === "epic" ? (input.epicKey ?? null) : null,
        rag: input.rag,
        reason: input.reason,
      };
      const change = await deps.overrides.upsert(override);
      const warnings = change === "unchanged" ? [] : await recompute(override.weekStart);
      return { override, change, warnings };
    },

    async clear(query) {
      const input = parseOrThrow(overrideKeySchema, query);
      const weekStart = await normalizeWeek(input.weekStart);
      const removed = await deps.overrides.remove(
        weekStart,
        input.scope,
        input.scope === "epic" ? (input.epicKey ?? null) : null,
      );
      if (!removed) throw new AppError(404, "NOT_FOUND", "No such override.");
      return { warnings: await recompute(weekStart) };
    },
  };
}
