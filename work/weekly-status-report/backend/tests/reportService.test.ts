import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraConnection } from "../src/config/env.js";
import { reportSchema } from "../src/contract/index.js";
import { MOCK_FIELDS, generateDataset } from "../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../src/jira/mock/server.js";
import { createLogger } from "../src/logger.js";
import { createHistoryRepository } from "../src/repositories/historyRepository.js";
import { createJobRepository } from "../src/repositories/jobRepository.js";
import { createSettingsRepository } from "../src/repositories/settingsRepository.js";
import { createReportService } from "../src/services/reportService.js";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!url)("report job runner", () => {
  const dataset = generateDataset({ issues: 80, seed: 21 });
  const jobs = createJobRepository(pool!);
  const settings = createSettingsRepository(pool!);
  const history = createHistoryRepository(pool!);
  const clock = () => new Date(dataset.now.getTime() + 3_600_000);
  let mock: MockJira | undefined;
  let logs: string[] = [];

  const connection = (): JiraConnection => ({
    baseUrl: mock!.url,
    email: "a@example.com",
    apiToken: "secret-token-123",
    projectKey: dataset.projectKey,
    boardId: dataset.boardId,
  });

  const service = (extra: Partial<Parameters<typeof createReportService>[0]> = {}) =>
    createReportService({
      jobs,
      settings,
      history,
      connection: connection(),
      logger: createLogger("debug", { write: (line: string) => void logs.push(line) }),
      now: clock,
      ...extra,
    });

  const validate = async () =>
    settings.recordValidation({
      at: new Date(),
      projectKey: dataset.projectKey,
      boardId: dataset.boardId,
    });

  const start = async (options: Parameters<typeof startMockJira>[0] = {}) => {
    mock = await startMockJira({ dataset, ...options });
  };

  beforeAll(async () => {
    await pool!.query("DELETE FROM setting");
  });
  beforeEach(async () => {
    logs = [];
    for (const table of [
      "snapshot",
      "report_deck",
      "report_job",
      "issue_history",
      "sync_state",
      "setting",
    ]) {
      await pool!.query(`DELETE FROM ${table}`);
    }
    await pool!.query("DELETE FROM audit_entry WHERE entity = 'setting'");
  });
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it("moves a job from queued to succeeded and stores the report and times", async () => {
    await start();
    await validate();
    const svc = service();
    const queued = await svc.start({});
    expect(queued.status).toBe("queued");
    await svc.idle();

    const done = (await jobs.get(queued.id))!;
    expect(done.status).toBe("succeeded");
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(reportSchema.safeParse(done.report).success).toBe(true);
    expect(done.report!.weekStart).toBe("2026-10-12");
    expect(done.report!.projectKey).toBe(dataset.projectKey);
    expect(done.report!.epics.length).toBeGreaterThan(0);
  });

  it("refuses to generate until validation has passed", async () => {
    await start();
    await expect(service().start({})).rejects.toMatchObject({
      status: 409,
      code: "VALIDATION_REQUIRED",
    });
  });

  it("rejects a second request for the same week without creating a duplicate", async () => {
    await start({ latencyMs: 40 });
    await validate();
    const svc = service();
    await svc.start({});
    await expect(svc.start({})).rejects.toMatchObject({
      status: 409,
      code: "REPORT_IN_PROGRESS",
    });
    await svc.idle();
    const { rows } = await pool!.query("SELECT count(*)::int AS n FROM report_job");
    expect(rows[0].n).toBe(1);
    // Once finished, the same week can be generated again.
    await expect(service().start({})).resolves.toMatchObject({ status: "queued" });
  });

  it("allows different weeks to be requested together and runs them in turn", async () => {
    await start({ latencyMs: 10 });
    await validate();
    const svc = service();
    const a = await svc.start({});
    const b = await svc.start({ weekStart: "2026-10-05" });
    await svc.idle();
    expect((await jobs.get(a.id))!.status).toBe("succeeded");
    expect((await jobs.get(b.id))!.status).toBe("succeeded");
  });

  it("fails queued and running jobs as interrupted on startup", async () => {
    await start();
    await pool!.query(
      `INSERT INTO report_job (week_start, time_zone, status) VALUES
       ('2026-09-28', 'UTC', 'queued'), ('2026-10-05', 'UTC', 'running')`,
    );
    expect(await service().recoverOnStartup()).toBe(2);
    const { rows } = await pool!.query("SELECT status, error_message FROM report_job");
    expect(rows.every((r) => r.status === "failed")).toBe(true);
    expect(rows[0].error_message).toBe("interrupted by restart");
  });

  it("fails a job that runs past the time limit and ignores its late result", async () => {
    await start({ latencyMs: 300 });
    await validate();
    const svc = service({ timeoutMs: 50 });
    const job = await svc.start({});
    await svc.idle();
    const failed = (await jobs.get(job.id))!;
    expect(failed).toMatchObject({ status: "failed", errorCode: "JOB_TIMEOUT" });
    await new Promise((r) => setTimeout(r, 500));
    expect((await jobs.get(job.id))!.status).toBe("failed");
  });

  it("clears a stale running job so the week can be requested again", async () => {
    await start();
    await validate();
    await pool!.query(
      `INSERT INTO report_job (week_start, time_zone, status, started_at)
       VALUES ('2026-10-12', 'UTC', 'running', now() - interval '11 minutes')`,
    );
    const job = await service().start({});
    expect(job.status).toBe("queued");
    const { rows } = await pool!.query("SELECT error_code FROM report_job WHERE status = 'failed'");
    expect(rows[0].error_code).toBe("JOB_TIMEOUT");
  });

  it("dry run computes the report but builds no deck", async () => {
    await start();
    await validate();
    const buildDeck = vi.fn(async () => ({ fileName: "x.pptx", content: Buffer.from("x") }));
    const svc = service({ buildDeck });
    const job = await svc.start({ dryRun: true });
    await svc.idle();
    const done = (await jobs.get(job.id))!;
    expect(done.status).toBe("succeeded");
    expect(done.report!.dryRun).toBe(true);
    expect(buildDeck).not.toHaveBeenCalled();
    expect(await jobs.getDeck("2026-10-12")).toBeNull();
  });

  it("builds and replaces one deck per week on a normal run", async () => {
    await start();
    await validate();
    let n = 0;
    const svc = service({
      buildDeck: async () => ({ fileName: `d${++n}.pptx`, content: Buffer.from(`deck${n}`) }),
    });
    await svc.start({});
    await svc.idle();
    await svc.start({});
    await svc.idle();
    const deck = (await jobs.getDeck("2026-10-12"))!;
    expect(deck.fileName).toBe("d2.pptx");
    const { rows } = await pool!.query("SELECT count(*)::int AS n FROM report_deck");
    expect(rows[0].n).toBe(1);
  });

  it("shows warnings in the result and logs them without secrets or names", async () => {
    await start({ activeSprint: false, email: "a@example.com", apiToken: "secret-token-123" });
    await validate();
    const svc = service();
    const job = await svc.start({});
    await svc.idle();
    const done = (await jobs.get(job.id))!;
    expect(done.warnings.map((w) => w.code)).toContain("NO_ACTIVE_SPRINT");
    const output = logs.join("\n");
    expect(output).toContain("NO_ACTIVE_SPRINT");
    expect(output).not.toContain("secret-token-123");
    expect(output).not.toMatch(/jane\d*@example\.com|accountid/i);
    const stored = JSON.stringify(done.report);
    expect(stored).not.toMatch(/jane\d*@example\.com|accountid|\[~/i);
  });

  it("maps Jira failures to a failed job with the DEF-13 code", async () => {
    await start({ email: "a@example.com", apiToken: "right" });
    await validate();
    const svc = service();
    const job = await svc.start({});
    await svc.idle();
    expect(await jobs.get(job.id)).toMatchObject({
      status: "failed",
      errorCode: "JIRA_AUTH_FAILED",
    });
    expect(logs.join("\n")).not.toContain("secret-token-123");
  });

  it("prunes decks and report payloads older than 52 weeks and keeps audit entries", async () => {
    await start();
    await validate();
    const old = await pool!.query(
      `INSERT INTO report_job (week_start, time_zone, status, report, finished_at)
       VALUES ('2025-01-06', 'UTC', 'succeeded', '{"x":1}'::jsonb, now()) RETURNING id`,
    );
    await pool!.query(
      `INSERT INTO report_deck (week_start, job_id, file_name, content)
       VALUES ('2025-01-06', $1, 'old.pptx', 'x')`,
      [old.rows[0].id],
    );
    await pool!.query(
      "INSERT INTO audit_entry (entity, entity_key, action) VALUES ('setting', 'keep', 'update')",
    );
    const svc = service();
    await svc.start({});
    await svc.idle();
    expect(await jobs.getDeck("2025-01-06")).toBeNull();
    expect((await jobs.get(Number(old.rows[0].id)))!.report).toBeNull();
    const audit = await pool!.query("SELECT 1 FROM audit_entry WHERE entity_key = 'keep'");
    expect(audit.rowCount).toBe(1);
  });

  it("rejects a future week and unknown request properties", async () => {
    await start();
    await validate();
    await expect(service().start({ weekStart: "2027-01-04" })).rejects.toMatchObject({
      code: "FUTURE_PERIOD",
    });
    await expect(service().start({ nope: 1 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("uses the configured field IDs from the mock", () => {
    expect(MOCK_FIELDS.storyPoints).toBe("customfield_10016");
  });
});
