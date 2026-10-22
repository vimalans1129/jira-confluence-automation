import argon2 from "argon2";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { JiraConnection } from "../src/config/env.js";
import { sampleReport } from "../src/contract/sampleReport.js";
import { generateDataset } from "../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../src/jira/mock/server.js";
import { createLogger } from "../src/logger.js";
import { createHistoryRepository } from "../src/repositories/historyRepository.js";
import { createJobRepository } from "../src/repositories/jobRepository.js";
import { createOverrideRepository } from "../src/repositories/overrideRepository.js";
import { createSettingsRepository } from "../src/repositories/settingsRepository.js";
import { createSnapshotRepository } from "../src/repositories/snapshotRepository.js";
import { createOverrideService } from "../src/services/overrideService.js";
import { applyOverrides } from "../src/services/overrides.js";
import { createReportService } from "../src/services/reportService.js";
import { toTrend } from "../src/services/trend.js";

describe("applyOverrides", () => {
  const epic = sampleReport.epics.find((e) => e.epicKey !== null)!;

  it("applies an Epic override, keeps the calculated RAG and rolls it up", () => {
    const report = applyOverrides(
      sampleReport,
      [
        {
          weekStart: "2026-10-12",
          scope: "epic",
          epicKey: epic.epicKey,
          rag: "Red",
          reason: "Vendor slip",
        },
      ],
      null,
    );
    const changed = report.epics.find((e) => e.epicKey === epic.epicKey)!;
    expect(changed.rag).toMatchObject({
      effective: "Red",
      calculated: epic.rag.calculated,
      overridden: true,
      overrideReason: "Vendor slip",
    });
    expect(report.overrides).toHaveLength(1);
    if (!epic.complete && !epic.noWorkItems) expect(report.overall.rag.effective).toBe("Red");
  });

  it("overrides the overall status without touching Epics", () => {
    const report = applyOverrides(
      sampleReport,
      [
        {
          weekStart: "2026-10-12",
          scope: "overall",
          epicKey: null,
          rag: "Amber",
          reason: "Steering call",
        },
      ],
      null,
    );
    expect(report.overall.rag).toMatchObject({ effective: "Amber", overridden: true });
    expect(report.epics.map((e) => e.rag)).toEqual(sampleReport.epics.map((e) => e.rag));
  });

  it("ignores an unknown Epic with a warning, and removing overrides restores calculated values", () => {
    const report = applyOverrides(
      sampleReport,
      [{ weekStart: "2026-10-12", scope: "epic", epicKey: "NOPE-1", rag: "Red", reason: "x" }],
      null,
    );
    expect(report.overrides).toEqual([]);
    expect(report.warnings.filter((w) => w.code === "OVERRIDE_EPIC_MISSING")).toHaveLength(1);
    expect(report.overall.rag.overridden).toBe(false);
    const again = applyOverrides(report, [], null);
    expect(again.warnings.some((w) => w.code === "OVERRIDE_EPIC_MISSING")).toBe(false);
  });
});

describe("toTrend", () => {
  it("averages real Epics and skips No Epic", () => {
    const epic = (epicKey: string, percentComplete: number, totalUnits = 10) => ({
      epicKey,
      name: epicKey,
      rag: "Green" as const,
      basis: "points" as const,
      totalUnits,
      doneUnits: 0,
      percentComplete,
      blockerCount: 0,
    });
    const [week] = toTrend([
      {
        weekStart: "2026-10-12",
        jobId: null,
        overallRag: "Amber",
        blockerCount: 1,
        epics: [epic("A-1", 10), epic("A-2", 31), epic("", 99), epic("A-3", 80, 0)],
      },
    ]);
    expect(week!.percentComplete).toBe(20.5);
    expect(week!.epics.map((e) => e.epicKey)).toEqual(["A-1", "A-2", "A-3"]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!url)("trend and override API", () => {
  const dataset = generateDataset({ issues: 80, seed: 21 });
  const jobs = createJobRepository(pool!);
  const settings = createSettingsRepository(pool!);
  const snapshots = createSnapshotRepository(pool!);
  const overrides = createOverrideRepository(pool!);
  let mock: MockJira;
  let agent: ReturnType<typeof request.agent>;
  let anonymous: ReturnType<typeof request.agent>;
  let csrf = "";
  let service: ReturnType<typeof createReportService>;

  beforeAll(async () => {
    mock = await startMockJira({ dataset, email: "a@example.com", apiToken: "secret-token-123" });
    const connection: JiraConnection = {
      baseUrl: mock.url,
      email: "a@example.com",
      apiToken: "secret-token-123",
      projectKey: dataset.projectKey,
      boardId: dataset.boardId,
    };
    const logger = createLogger("silent");
    const now = () => new Date(dataset.now.getTime() + 3_600_000);
    service = createReportService({
      jobs,
      settings,
      history: createHistoryRepository(pool!),
      snapshots,
      overrides,
      connection,
      logger,
      now,
      buildDeck: async () => ({ fileName: "d.pptx", content: Buffer.from("PK") }),
    });
    const hash = await argon2.hash("pw", { memoryCost: 4096, timeCost: 2, parallelism: 1 });
    const app = createApp({
      logger,
      checkDatabase: async () => {},
      auth: {
        passwordHash: hash,
        sessionSecret: "s".repeat(40),
        sessionLifetimeSeconds: 3600,
        secureCookies: false,
        trustProxy: 0,
        loginMaxFailures: 5,
      },
      settings,
      reports: { service, jobs },
      trends: {
        snapshots,
        overrides: createOverrideService({ overrides, jobs, settings, snapshots, now }),
      },
    });
    agent = request.agent(app);
    csrf = (await agent.post("/api/v1/auth/login").send({ password: "pw" })).body.csrfToken;
    anonymous = request.agent(app);
  });
  afterAll(async () => {
    await mock.close();
  });
  beforeEach(async () => {
    for (const table of [
      "rag_override",
      "snapshot",
      "report_deck",
      "report_job",
      "issue_history",
      "sync_state",
      "setting",
    ]) {
      await pool!.query(`DELETE FROM ${table}`);
    }
    await pool!.query("DELETE FROM audit_entry WHERE entity IN ('setting', 'rag_override')");
    await settings.recordValidation({
      at: new Date(),
      projectKey: dataset.projectKey,
      boardId: dataset.boardId,
    });
  });
  afterEach(() => undefined);

  const generate = async (weekStart: string) => {
    const job = await service.start({ weekStart });
    await service.idle();
    return (await jobs.get(job.id))!;
  };
  const post = (body: object) =>
    agent.post("/api/v1/overrides").set("x-csrf-token", csrf).send(body);

  it("returns six weeks by default, accepts 4 to 12 and rejects other values", async () => {
    for (let i = 0; i < 8; i++) {
      await snapshots.replace({
        weekStart: new Date(Date.UTC(2026, 7, 31 + 7 * i)).toISOString().slice(0, 10),
        jobId: null,
        overallRag: "Green",
        blockerCount: 0,
        epics: [],
      });
    }
    const def = await agent.get("/api/v1/snapshots");
    expect(def.status).toBe(200);
    expect(def.body.weeks).toHaveLength(6);
    expect(def.body.weeks[5].weekStart > def.body.weeks[0].weekStart).toBe(true);
    expect((await agent.get("/api/v1/snapshots?weeks=4")).body.weeks).toHaveLength(4);
    expect((await agent.get("/api/v1/snapshots?weeks=12")).body.weeks).toHaveLength(8);
    for (const bad of ["3", "13", "x", "5.5"]) {
      const res = await agent.get(`/api/v1/snapshots?weeks=${bad}`);
      expect(res.status).toBe(400);
    }
  });

  it("gives correct deltas end to end across two consecutive weeks", async () => {
    const first = (await generate("2026-10-05")).report!;
    const second = (await generate("2026-10-12")).report!;
    const trend = (await agent.get("/api/v1/snapshots")).body.weeks;
    expect(trend.map((w: { weekStart: string }) => w.weekStart)).toEqual([
      "2026-10-05",
      "2026-10-12",
    ]);
    const stored = (await snapshots.list("2026-10-12", 2)).map((s) => s.epics);
    for (const epic of second.epics) {
      const before = stored[0]!.find((e) => e.epicKey === (epic.epicKey ?? ""));
      const now = stored[1]!.find((e) => e.epicKey === (epic.epicKey ?? ""));
      if (!before || !now) {
        expect(epic.percentDelta).toBe("n/a");
        continue;
      }
      expect(epic.percentDelta).toBe(
        Math.round((now.percentComplete - before.percentComplete) * 10) / 10,
      );
    }
    expect(first.overall.ragChange).toBe("n/a");
    expect(second.overall.ragChange).not.toBe("n/a");
  });

  it("requires a session and CSRF for overrides, and a reason", async () => {
    await generate("2026-10-12");
    const anon = await anonymous.get("/api/v1/overrides?weekStart=2026-10-12");
    expect(anon.status).toBe(401);
    const anonTrend = await anonymous.get("/api/v1/snapshots");
    expect(anonTrend.status).toBe(401);
    const noCsrf = await agent
      .post("/api/v1/overrides")
      .send({ weekStart: "2026-10-12", scope: "overall", rag: "Red", reason: "x" });
    expect(noCsrf.status).toBe(403);
    const blank = await post({
      weekStart: "2026-10-12",
      scope: "overall",
      rag: "Red",
      reason: "  ",
    });
    expect(blank.status).toBe(400);
    expect(blank.body.error.details[0].path).toBe("reason");
    const noKey = await post({ weekStart: "2026-10-12", scope: "epic", rag: "Red", reason: "x" });
    expect(noKey.status).toBe(400);
    expect((await pool!.query("SELECT 1 FROM rag_override")).rowCount).toBe(0);
  });

  it("creates, changes and deletes overrides without Jira calls, marking the deck stale and auditing", async () => {
    const job = await generate("2026-10-12");
    expect((await jobs.getDeck("2026-10-12"))!.stale).toBe(false);
    const epic = job.report!.epics.find(
      (e) => e.epicKey !== null && !e.complete && !e.noWorkItems,
    )!;
    const requestsBefore = mock.stats.requests;

    const created = await post({
      weekStart: "2026-10-14",
      scope: "epic",
      epicKey: epic.epicKey,
      rag: epic.rag.calculated === "Red" ? "Green" : "Red",
      reason: "Vendor slip",
    });
    expect(created.status).toBe(201);
    expect(created.body.override.weekStart).toBe("2026-10-12");

    const report = (await jobs.get(job.id))!.report!;
    const changed = report.epics.find((e) => e.epicKey === epic.epicKey)!;
    expect(changed.rag.overridden).toBe(true);
    expect(changed.rag.overrideReason).toBe("Vendor slip");
    expect(changed.rag.calculated).toBe(epic.rag.calculated);
    expect(report.overrides).toHaveLength(1);
    expect(report.deckStale).toBe(true);
    expect((await jobs.getDeck("2026-10-12"))!.stale).toBe(true);
    const snap = (await snapshots.list("2026-10-12", 1))[0]!;
    expect(snap.epics.find((e) => e.epicKey === epic.epicKey)!.rag).toBe(changed.rag.effective);

    const updated = await post({
      weekStart: "2026-10-12",
      scope: "epic",
      epicKey: epic.epicKey,
      rag: "Amber",
      reason: "Revised",
    });
    expect(updated.status).toBe(200);
    const same = await post({
      weekStart: "2026-10-12",
      scope: "epic",
      epicKey: epic.epicKey,
      rag: "Amber",
      reason: "Revised",
    });
    expect(same.body.change).toBe("unchanged");

    const listed = await agent.get("/api/v1/overrides?weekStart=2026-10-12");
    expect(listed.body.overrides).toHaveLength(1);

    const del = await agent
      .delete(`/api/v1/overrides?weekStart=2026-10-12&scope=epic&epicKey=${epic.epicKey}`)
      .set("x-csrf-token", csrf);
    expect(del.status).toBe(200);
    const restored = (await jobs.get(job.id))!.report!;
    expect(restored.epics.find((e) => e.epicKey === epic.epicKey)!.rag).toEqual(epic.rag);
    expect(restored.overrides).toEqual([]);
    expect(
      (
        await agent
          .delete(`/api/v1/overrides?weekStart=2026-10-12&scope=epic&epicKey=${epic.epicKey}`)
          .set("x-csrf-token", csrf)
      ).status,
    ).toBe(404);

    expect(mock.stats.requests).toBe(requestsBefore);
    const audit = await pool!.query(
      "SELECT action, old_value, new_value FROM audit_entry WHERE entity = 'rag_override' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    expect(audit.rows[0].new_value).toEqual({
      rag: created.body.override.rag,
      reason: "Vendor slip",
    });
    expect(audit.rows[1].old_value).toEqual({
      rag: created.body.override.rag,
      reason: "Vendor slip",
    });
    expect(audit.rows[2].new_value).toBeNull();
  });

  it("warns about an override for a missing Epic and ignores it", async () => {
    const job = await generate("2026-10-12");
    const res = await post({
      weekStart: "2026-10-12",
      scope: "epic",
      epicKey: "NOPE-9",
      rag: "Red",
      reason: "x",
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings[0].code).toBe("OVERRIDE_EPIC_MISSING");
    const report = (await jobs.get(job.id))!.report!;
    expect(report.overrides).toEqual([]);
    expect(report.overall.rag.overridden).toBe(false);
  });

  it("applies a stored override when the week is generated later", async () => {
    await post({ weekStart: "2026-10-12", scope: "overall", rag: "Red", reason: "Pre-set" });
    const job = await generate("2026-10-12");
    expect(job.report!.overall.rag).toMatchObject({ effective: "Red", overridden: true });
    expect((await snapshots.list("2026-10-12", 1))[0]!.overallRag).toBe("Red");
  });
});
