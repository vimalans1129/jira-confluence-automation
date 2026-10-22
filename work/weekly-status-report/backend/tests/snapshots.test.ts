import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JiraConnection } from "../src/config/env.js";
import { generateDataset } from "../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../src/jira/mock/server.js";
import { createLogger } from "../src/logger.js";
import { createHistoryRepository } from "../src/repositories/historyRepository.js";
import { createJobRepository } from "../src/repositories/jobRepository.js";
import { createSettingsRepository } from "../src/repositories/settingsRepository.js";
import { createSnapshotRepository, type Snapshot } from "../src/repositories/snapshotRepository.js";
import { createReportService } from "../src/services/reportService.js";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
afterAll(async () => {
  await pool?.end();
});

const snap = (weekStart: string, rag: Snapshot["overallRag"] = "Amber"): Snapshot => ({
  weekStart,
  jobId: null,
  overallRag: rag,
  blockerCount: 1,
  epics: [
    {
      epicKey: "DEMO-1",
      name: "One",
      rag,
      basis: "points",
      totalUnits: 10,
      doneUnits: 2.5,
      percentComplete: 25.123456,
      blockerCount: 0,
    },
  ],
});

describe.skipIf(!url)("snapshots", () => {
  const dataset = generateDataset({ issues: 80, seed: 21 });
  const jobs = createJobRepository(pool!);
  const settings = createSettingsRepository(pool!);
  const snapshots = createSnapshotRepository(pool!);
  let mock: MockJira | undefined;

  const svc = () => {
    const connection: JiraConnection = {
      baseUrl: mock!.url,
      email: "a@example.com",
      apiToken: "secret-token-123",
      projectKey: dataset.projectKey,
      boardId: dataset.boardId,
    };
    return createReportService({
      jobs,
      settings,
      history: createHistoryRepository(pool!),
      snapshots,
      connection,
      logger: createLogger("silent"),
      now: () => new Date(dataset.now.getTime() + 3_600_000),
    });
  };
  const generate = async (body: object) => {
    const service = svc();
    const job = await service.start(body);
    await service.idle();
    return (await jobs.get(job.id))!.report!;
  };

  beforeEach(async () => {
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
    await settings.recordValidation({
      at: new Date(),
      projectKey: dataset.projectKey,
      boardId: dataset.boardId,
    });
    mock = await startMockJira({ dataset });
  });
  afterEach(async () => {
    await mock?.close();
  });

  it("stores one snapshot per week and replaces it on a rerun", async () => {
    await snapshots.replace(snap("2026-10-05", "Red"));
    await snapshots.replace(snap("2026-10-05", "Green"));
    const { rows } = await pool!.query("SELECT overall_rag FROM snapshot");
    expect(rows).toEqual([{ overall_rag: "Green" }]);
    const epics = await pool!.query("SELECT 1 FROM snapshot_epic");
    expect(epics.rowCount).toBe(1);
    const stored = await snapshots.findPrevious("2026-10-12");
    expect(stored?.epics[0]?.percentComplete).toBeCloseTo(25.123456, 6);
  });

  it("finds the most recent earlier snapshot, skipping weeks, and never the same week", async () => {
    await snapshots.replace(snap("2026-09-14"));
    await snapshots.replace(snap("2026-09-28"));
    await snapshots.replace(snap("2026-10-12"));
    expect((await snapshots.findPrevious("2026-10-12"))?.weekStart).toBe("2026-09-28");
    expect(await snapshots.findPrevious("2026-09-14")).toBeNull();
    expect((await snapshots.list("2026-10-12", 2)).map((s) => s.weekStart)).toEqual([
      "2026-09-28",
      "2026-10-12",
    ]);
  });

  it("shows n/a everywhere when there is no earlier snapshot", async () => {
    const report = await generate({ weekStart: "2026-10-12" });
    expect(report.overall.ragChange).toBe("n/a");
    for (const epic of report.epics) {
      expect(epic.ragChange).toBe("n/a");
      expect(epic.percentDelta).toBe("n/a");
    }
  });

  it("compares two consecutive weeks and stores each run's snapshot", async () => {
    const first = await generate({ weekStart: "2026-10-05" });
    const second = await generate({ weekStart: "2026-10-12" });
    expect((await pool!.query("SELECT 1 FROM snapshot")).rowCount).toBe(2);
    const before = new Map(first.epics.map((e) => [e.epicKey, e]));
    for (const epic of second.epics) {
      const prev = before.get(epic.epicKey);
      if (!prev) {
        expect(epic.percentDelta).toBe("n/a");
        continue;
      }
      expect(typeof epic.percentDelta).toBe("number");
      expect(
        Math.abs((epic.percentDelta as number) - (epic.percentComplete - prev.percentComplete)),
      ).toBeLessThan(1.01);
      expect(["▲", "▼", "▬"]).toContain(epic.ragChange);
    }
    expect(["▲", "▼", "▬"]).toContain(second.overall.ragChange);
  });

  it("uses the latest earlier snapshot when weeks were skipped", async () => {
    await snapshots.replace({ ...snap("2026-09-14", "Green"), overallRag: "Green" });
    const report = await generate({ weekStart: "2026-10-12" });
    expect(report.overall.ragChange).not.toBe("n/a");
  });

  it("shows n/a for an epic absent from the earlier snapshot", async () => {
    const probe = await generate({ weekStart: "2026-10-12", dryRun: true });
    const [known, ...others] = probe.epics.filter((e) => e.epicKey !== null);
    expect(known).toBeDefined();
    expect(others.length).toBeGreaterThan(0);
    await snapshots.replace({
      weekStart: "2026-10-05",
      jobId: null,
      overallRag: "Red",
      blockerCount: 0,
      epics: [
        {
          epicKey: known!.epicKey!,
          name: known!.name,
          rag: "Red",
          basis: known!.basis,
          totalUnits: 10,
          doneUnits: 0,
          percentComplete: 0,
          blockerCount: 0,
        },
      ],
    });
    const report = await generate({ weekStart: "2026-10-12", dryRun: true });
    const byKey = new Map(report.epics.map((e) => [e.epicKey, e]));
    expect(byKey.get(known!.epicKey)!.percentDelta).toBe(
      Math.round(known!.percentComplete * 10) / 10,
    );
    expect(byKey.get(known!.epicKey)!.ragChange).not.toBe("n/a");
    for (const other of others) {
      expect(byKey.get(other.epicKey)!.percentDelta).toBe("n/a");
      expect(byKey.get(other.epicKey)!.ragChange).toBe("n/a");
    }
  });

  it("turns two simultaneous generations for one week into one job and one snapshot", async () => {
    await mock?.close();
    mock = await startMockJira({ dataset, latencyMs: 40 });
    const service = svc();
    const results = await Promise.allSettled([
      service.start({ weekStart: "2026-10-12" }),
      service.start({ weekStart: "2026-10-12" }),
    ]);
    await service.idle();
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: "REPORT_IN_PROGRESS" });
    expect((await pool!.query("SELECT 1 FROM report_job")).rowCount).toBe(1);
    expect((await pool!.query("SELECT 1 FROM snapshot")).rowCount).toBe(1);
  });

  it("does not store a snapshot for a dry run", async () => {
    await generate({ weekStart: "2026-10-12", dryRun: true });
    expect((await pool!.query("SELECT 1 FROM snapshot")).rowCount).toBe(0);
  });
});
