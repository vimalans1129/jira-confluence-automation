import type pg from "pg";
import type { JobStatus, Report, ReportWarning } from "../contract/index.js";
import { AppError } from "../errors.js";

export interface JobRecord {
  id: number;
  weekStart: string;
  timeZone: string;
  dryRun: boolean;
  status: JobStatus;
  stage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: ReportWarning[];
  report: Report | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface NewJob {
  weekStart: string;
  timeZone: string;
  dryRun: boolean;
}

export interface DeckRecord {
  weekStart: string;
  jobId: number | null;
  fileName: string;
  content: Buffer;
  stale: boolean;
}

export interface JobRepository {
  create(job: NewJob): Promise<JobRecord>;
  get(id: number): Promise<JobRecord | null>;
  latest(): Promise<JobRecord | null>;
  markRunning(id: number): Promise<void>;
  setStage(id: number, stage: string): Promise<void>;
  // Return false when the job already left "running", for example after a timeout.
  succeed(id: number, report: Report, warnings: ReportWarning[]): Promise<boolean>;
  fail(id: number, code: string, message: string): Promise<boolean>;
  failInterrupted(): Promise<number>;
  failStale(timeoutMs: number): Promise<number>;
  prune(cutoffWeekStart: string): Promise<{ reports: number; decks: number }>;
  saveDeck(deck: Omit<DeckRecord, "stale">): Promise<void>;
  getDeck(weekStart: string): Promise<DeckRecord | null>;
}

const COLUMNS = `id, to_char(week_start, 'YYYY-MM-DD') AS week_start, time_zone, dry_run, status,
  stage, error_code, error_message, warnings, report, queued_at, started_at, finished_at`;

interface Row {
  id: string;
  week_start: string;
  time_zone: string;
  dry_run: boolean;
  status: JobStatus;
  stage: string | null;
  error_code: string | null;
  error_message: string | null;
  warnings: ReportWarning[];
  report: Report | null;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

function toRecord(r: Row): JobRecord {
  return {
    id: Number(r.id),
    weekStart: r.week_start,
    timeZone: r.time_zone,
    dryRun: r.dry_run,
    status: r.status,
    stage: r.stage,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    warnings: r.warnings,
    report: r.report,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export const INTERRUPTED_MESSAGE = "interrupted by restart";

export function createJobRepository(pool: pg.Pool): JobRepository {
  return {
    async create(job) {
      try {
        const { rows } = await pool.query<Row>(
          `INSERT INTO report_job (week_start, time_zone, dry_run, status, stage)
           VALUES ($1, $2, $3, 'queued', 'queued') RETURNING ${COLUMNS}`,
          [job.weekStart, job.timeZone, job.dryRun],
        );
        return toRecord(rows[0]!);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AppError(
            409,
            "REPORT_IN_PROGRESS",
            `A report for the week starting ${job.weekStart} is already being generated.`,
          );
        }
        throw error;
      }
    },

    async get(id) {
      const { rows } = await pool.query<Row>(`SELECT ${COLUMNS} FROM report_job WHERE id = $1`, [
        id,
      ]);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async latest() {
      const { rows } = await pool.query<Row>(
        `SELECT ${COLUMNS} FROM report_job ORDER BY queued_at DESC, id DESC LIMIT 1`,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async markRunning(id) {
      await pool.query(
        `UPDATE report_job SET status = 'running', stage = 'starting', started_at = now()
         WHERE id = $1 AND status = 'queued'`,
        [id],
      );
    },

    async setStage(id, stage) {
      await pool.query("UPDATE report_job SET stage = $2 WHERE id = $1 AND status = 'running'", [
        id,
        stage,
      ]);
    },

    async succeed(id, report, warnings) {
      const res = await pool.query(
        `UPDATE report_job
         SET status = 'succeeded', stage = 'done', report = $2::jsonb, warnings = $3::jsonb,
             finished_at = now()
         WHERE id = $1 AND status = 'running'`,
        [id, JSON.stringify(report), JSON.stringify(warnings)],
      );
      return res.rowCount === 1;
    },

    async fail(id, code, message) {
      const res = await pool.query(
        `UPDATE report_job
         SET status = 'failed', error_code = $2, error_message = $3, finished_at = now()
         WHERE id = $1 AND status IN ('queued', 'running')`,
        [id, code, message],
      );
      return res.rowCount === 1;
    },

    async failInterrupted() {
      const res = await pool.query(
        `UPDATE report_job
         SET status = 'failed', error_code = 'JOB_INTERRUPTED', error_message = $1,
             finished_at = now()
         WHERE status IN ('queued', 'running')`,
        [INTERRUPTED_MESSAGE],
      );
      return res.rowCount ?? 0;
    },

    async failStale(timeoutMs) {
      const res = await pool.query(
        `UPDATE report_job
         SET status = 'failed', error_code = 'JOB_TIMEOUT',
             error_message = 'The report took longer than the allowed time and was stopped.',
             finished_at = now()
         WHERE status IN ('queued', 'running')
           AND COALESCE(started_at, queued_at) < now() - ($1::bigint * interval '1 millisecond')`,
        [timeoutMs],
      );
      return res.rowCount ?? 0;
    },

    // Snapshots and audit entries are deliberately untouched (FR-046).
    async prune(cutoffWeekStart) {
      const reports = await pool.query(
        "UPDATE report_job SET report = NULL WHERE week_start < $1 AND report IS NOT NULL",
        [cutoffWeekStart],
      );
      const decks = await pool.query("DELETE FROM report_deck WHERE week_start < $1", [
        cutoffWeekStart,
      ]);
      return { reports: reports.rowCount ?? 0, decks: decks.rowCount ?? 0 };
    },

    async saveDeck(deck) {
      await pool.query(
        `INSERT INTO report_deck (week_start, job_id, file_name, content, stale)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (week_start) DO UPDATE
           SET job_id = EXCLUDED.job_id, file_name = EXCLUDED.file_name,
               content = EXCLUDED.content, stale = false`,
        [deck.weekStart, deck.jobId, deck.fileName, deck.content],
      );
    },

    async getDeck(weekStart) {
      const { rows } = await pool.query<{
        week_start: string;
        job_id: string | null;
        file_name: string;
        content: Buffer;
        stale: boolean;
      }>(
        `SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start, job_id, file_name, content, stale
         FROM report_deck WHERE week_start = $1`,
        [weekStart],
      );
      const r = rows[0];
      return r
        ? {
            weekStart: r.week_start,
            jobId: r.job_id === null ? null : Number(r.job_id),
            fileName: r.file_name,
            content: r.content,
            stale: r.stale,
          }
        : null;
    },
  };
}
