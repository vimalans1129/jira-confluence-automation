import { Router, type Response } from "express";
import { AppError } from "../errors.js";
import type { JobRecord, JobRepository } from "../repositories/jobRepository.js";
import type { ReportService, DeckOutput } from "../services/reportService.js";
import type { Report } from "../contract/index.js";

export interface ReportRouteDeps {
  service: ReportService;
  jobs: JobRepository;
  buildDeck?: (report: Report) => Promise<DeckOutput>;
}

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function describeJob(jobs: JobRepository, job: JobRecord) {
  const deck = job.dryRun ? null : await jobs.getDeck(job.weekStart);
  return {
    id: job.id,
    weekStart: job.weekStart,
    timeZone: job.timeZone,
    dryRun: job.dryRun,
    status: job.status,
    stage: job.stage,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null,
    warnings: job.warnings,
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    hasDeck: deck !== null,
    deckStale: deck?.stale ?? false,
  };
}

function parseId(raw: string | undefined): number {
  if (!raw || !/^\d{1,15}$/.test(raw)) {
    throw new AppError(404, "NOT_FOUND", "Report not found.");
  }
  return Number(raw);
}

async function loadJob(jobs: JobRepository, raw: string | undefined): Promise<JobRecord> {
  const job = await jobs.get(parseId(raw));
  if (!job) throw new AppError(404, "NOT_FOUND", "Report not found.");
  return job;
}

export function reportsRouter(deps: ReportRouteDeps): Router {
  const router = Router();
  const { service, jobs } = deps;

  router.post("/reports", async (req, res, next) => {
    try {
      const job = await service.start(req.body);
      res
        .status(202)
        .location(`/api/v1/reports/${job.id}`)
        .json(await describeJob(jobs, job));
    } catch (err) {
      next(err);
    }
  });

  router.get("/reports/:id", async (req, res, next) => {
    try {
      res.json(await describeJob(jobs, await loadJob(jobs, req.params["id"])));
    } catch (err) {
      next(err);
    }
  });

  router.get("/reports/:id/data", async (req, res, next) => {
    try {
      const job = await loadJob(jobs, req.params["id"]);
      if (job.status === "queued" || job.status === "running") {
        throw new AppError(409, "REPORT_NOT_READY", "The report is still being generated.");
      }
      if (job.status === "failed") {
        throw new AppError(409, "REPORT_FAILED", "The report job failed and has no data.");
      }
      if (!job.report) {
        throw new AppError(410, "REPORT_PRUNED", "The report data is past the retention period.");
      }
      res.json(job.report);
    } catch (err) {
      next(err);
    }
  });

  router.get("/reports/:id/deck", async (req, res: Response, next) => {
    try {
      const job = await loadJob(jobs, req.params["id"]);
      const deck = job.dryRun ? null : await jobs.getDeck(job.weekStart);
      if (!deck) {
        throw new AppError(404, "DECK_NOT_FOUND", "No deck is available for this report.");
      }
      res
        .status(200)
        .type(PPTX)
        .set("content-disposition", `attachment; filename="${deck.fileName}"`)
        .set("cache-control", "no-store")
        .send(deck.content);
    } catch (err) {
      next(err);
    }
  });

  router.post("/reports/:id/deck", async (req, res, next) => {
    try {
      const job = await loadJob(jobs, req.params["id"]);
      if (job.status !== "succeeded" || job.dryRun) {
        throw new AppError(
          409,
          "DECK_NOT_AVAILABLE",
          "Only a completed, non-dry-run report has a deck.",
        );
      }
      if (!job.report) {
        throw new AppError(410, "REPORT_PRUNED", "The report data is past the retention period.");
      }
      if (!deps.buildDeck) {
        throw new AppError(501, "DECK_NOT_CONFIGURED", "Deck generation is not configured.");
      }
      const deck = await deps.buildDeck(job.report);
      await jobs.saveDeck({
        weekStart: job.weekStart,
        jobId: job.id,
        fileName: deck.fileName,
        content: deck.content,
      });
      res.json(await describeJob(jobs, job));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
