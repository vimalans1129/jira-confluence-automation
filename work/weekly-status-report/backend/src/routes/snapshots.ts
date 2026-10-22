import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { SnapshotRepository } from "../repositories/snapshotRepository.js";
import {
  DEFAULT_TREND_WEEKS,
  MAX_TREND_WEEKS,
  MIN_TREND_WEEKS,
  toTrend,
} from "../services/trend.js";
import type { OverrideService } from "../services/overrideService.js";

export interface TrendRouteDeps {
  snapshots: SnapshotRepository;
  overrides?: OverrideService;
}

const querySchema = z
  .object({
    weeks: z.coerce.number().int().min(MIN_TREND_WEEKS).max(MAX_TREND_WEEKS).optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export function snapshotsRouter(deps: TrendRouteDeps): Router {
  const router = Router();

  router.get("/snapshots", async (req, res, next) => {
    try {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_FAILED",
          `weeks must be a whole number from ${MIN_TREND_WEEKS} to ${MAX_TREND_WEEKS}.`,
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      const weeks = parsed.data.weeks ?? DEFAULT_TREND_WEEKS;
      const snapshots = await deps.snapshots.list(parsed.data.to ?? "9999-12-31", weeks);
      res.json({ weeks: toTrend(snapshots) });
    } catch (err) {
      next(err);
    }
  });

  const overrides = deps.overrides;
  if (overrides) {
    router.get("/overrides", async (req, res, next) => {
      try {
        res.json(await overrides.list(req.query["weekStart"]));
      } catch (err) {
        next(err);
      }
    });

    router.post("/overrides", async (req, res, next) => {
      try {
        const result = await overrides.set(req.body);
        res.status(result.change === "created" ? 201 : 200).json(result);
      } catch (err) {
        next(err);
      }
    });

    router.delete("/overrides", async (req, res, next) => {
      try {
        res.json(await overrides.clear(req.query));
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
