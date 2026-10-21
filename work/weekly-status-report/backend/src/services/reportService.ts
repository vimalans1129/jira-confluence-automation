import { z } from "zod";
import type { Report } from "../contract/index.js";
import type { JiraConnection } from "../config/env.js";
import type { Settings } from "../config/settings.js";
import { defaultPeriod, periodForDate } from "../domain/period.js";
import { AppError } from "../errors.js";
import { JiraClient } from "../jira/client.js";
import { fetchActiveSprint, fetchLatestComment, fetchStatusCategories } from "../jira/enrich.js";
import { syncProject, type HistoryStore } from "../jira/sync.js";
import type { Logger } from "../logger.js";
import type { JobRecord, JobRepository } from "../repositories/jobRepository.js";
import type { SettingsRepository } from "../repositories/settingsRepository.js";
import { buildReport } from "./reportBuilder.js";
import { assertValidated } from "./validation.js";

export const JOB_TIMEOUT_MS = 10 * 60_000;
export const RETENTION_WEEKS = 52;

export const reportRequestSchema = z
  .object({
    weekStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
      .optional(),
    timeZone: z.string().min(1).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
export type ReportRequest = z.infer<typeof reportRequestSchema>;

export interface DeckOutput {
  fileName: string;
  content: Buffer;
}

export interface ReportServiceDeps {
  jobs: JobRepository;
  settings: SettingsRepository;
  history: HistoryStore;
  connection: JiraConnection | null;
  logger: Logger;
  createClient?: (connection: JiraConnection, settings: Settings) => JiraClient;
  buildDeck?: (report: Report) => Promise<DeckOutput>;
  now?: () => Date;
  timeoutMs?: number;
}

export interface ReportService {
  recoverOnStartup(): Promise<number>;
  start(request: unknown): Promise<JobRecord>;
  // Resolves when every accepted job has finished; used by tests and shutdown.
  idle(): Promise<void>;
}

function defaultClient(connection: JiraConnection, settings: Settings): JiraClient {
  return new JiraClient({
    baseUrl: connection.baseUrl,
    email: connection.email,
    apiToken: connection.apiToken,
    fields: {
      storyPoints: settings.storyPointsFieldId,
      flagged: settings.flaggedFieldId,
      epicStart: settings.epicStartDateFieldId,
    },
  });
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function createReportService(deps: ReportServiceDeps): ReportService {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? JOB_TIMEOUT_MS;
  const { jobs, logger } = deps;
  // Jobs run one at a time so two weeks never write the shared history cache together.
  let queue: Promise<void> = Promise.resolve();

  async function work(
    job: JobRecord,
    connection: JiraConnection,
    settings: Settings,
    sprintApplicable: boolean,
    period: ReturnType<typeof periodForDate>,
  ): Promise<void> {
    await jobs.markRunning(job.id);
    const client = (deps.createClient ?? defaultClient)(connection, settings);

    await jobs.setStage(job.id, "fetching issues");
    const statusCategories = await fetchStatusCategories(client);
    const sync = await syncProject({
      client,
      store: deps.history,
      projectKey: connection.projectKey,
      statusCategories,
      fields: { storyPoints: settings.storyPointsFieldId, flagged: settings.flaggedFieldId },
      now: now(),
    });

    const sprint = sprintApplicable ? await fetchActiveSprint(client, connection.boardId) : null;

    await jobs.setStage(job.id, "computing report");
    const { report, warnings } = await buildReport({
      projectKey: connection.projectKey,
      settings,
      period,
      now: now(),
      issues: sync.issues,
      histories: sync.histories,
      sprint,
      sprintApplicable,
      fetchComment: (key) => fetchLatestComment(client, key),
      dryRun: job.dryRun,
    });

    if (!job.dryRun && deps.buildDeck) {
      await jobs.setStage(job.id, "building deck");
      const deck = await deps.buildDeck(report);
      await jobs.saveDeck({ weekStart: job.weekStart, jobId: job.id, ...deck });
    }

    if (!(await jobs.succeed(job.id, report, warnings))) return;
    for (const w of warnings) {
      logger.warn({ jobId: job.id, warningCode: w.code }, w.message);
    }
    const pruned = await jobs.prune(addDays(now(), -RETENTION_WEEKS * 7));
    if (pruned.reports + pruned.decks > 0) logger.info({ jobId: job.id, ...pruned }, "pruned");
  }

  async function run(
    job: JobRecord,
    connection: JiraConnection,
    settings: Settings,
    sprintApplicable: boolean,
    period: ReturnType<typeof periodForDate>,
  ): Promise<void> {
    const current = await jobs.get(job.id);
    if (current?.status !== "queued") return;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AppError(504, "JOB_TIMEOUT", "The report took too long and was stopped.")),
        timeoutMs,
      );
    });
    try {
      await Promise.race([work(job, connection, settings, sprintApplicable, period), timeout]);
    } catch (error) {
      if (error instanceof AppError) {
        await jobs.fail(job.id, error.code, error.message);
        logger.warn({ jobId: job.id, errorCode: error.code }, error.message);
      } else {
        await jobs.fail(job.id, "INTERNAL_ERROR", "Report generation failed unexpectedly.");
        logger.error({ jobId: job.id, err: error }, "report job failed");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async recoverOnStartup() {
      const count = await jobs.failInterrupted();
      if (count > 0) logger.warn({ count }, "marked unfinished report jobs as interrupted");
      return count;
    },

    async start(rawRequest) {
      const parsed = reportRequestSchema.safeParse(rawRequest ?? {});
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_FAILED",
          "The request body is not valid",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      const request = parsed.data;
      await assertValidated(deps.settings, deps.connection);
      const connection = deps.connection!;
      const settings = await deps.settings.load();
      const timeZone = request.timeZone ?? settings.timeZone;
      const at = now();
      const period = request.weekStart
        ? periodForDate(request.weekStart, timeZone, at)
        : defaultPeriod(at, timeZone);
      const sprintApplicable = period.weekStart >= defaultPeriod(at, period.timeZone).weekStart;

      await jobs.failStale(timeoutMs);
      const job = await jobs.create({
        weekStart: period.weekStart,
        timeZone: period.timeZone,
        dryRun: request.dryRun ?? false,
      });
      queue = queue
        .then(() => run(job, connection, settings, sprintApplicable, period))
        .catch((error: unknown) => logger.error({ jobId: job.id, err: error }, "job runner error"));
      return job;
    },

    idle: () => queue,
  };
}
