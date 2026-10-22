import argon2 from "argon2";
import JSZip from "jszip";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { JiraConnection } from "../src/config/env.js";
import { reportSchema } from "../src/contract/index.js";
import { generateDataset } from "../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../src/jira/mock/server.js";
import { createLogger } from "../src/logger.js";
import { createHistoryRepository } from "../src/repositories/historyRepository.js";
import { createJobRepository } from "../src/repositories/jobRepository.js";
import { createSettingsRepository } from "../src/repositories/settingsRepository.js";
import { buildDeck } from "../src/services/deckBuilder.js";
import { createReportService } from "../src/services/reportService.js";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!url)("report API", () => {
  const dataset = generateDataset({ issues: 80, seed: 21 });
  const jobs = createJobRepository(pool!);
  const settings = createSettingsRepository(pool!);
  const TOKEN = "secret-token-123";
  let mock: MockJira;
  let agent: ReturnType<typeof request.agent>;
  let csrf = "";
  let service: ReturnType<typeof createReportService>;
  let anonymous: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    mock = await startMockJira({ dataset, email: "a@example.com", apiToken: TOKEN });
    const connection: JiraConnection = {
      baseUrl: mock.url,
      email: "a@example.com",
      apiToken: TOKEN,
      projectKey: dataset.projectKey,
      boardId: dataset.boardId,
    };
    const logger = createLogger("silent");
    service = createReportService({
      jobs,
      settings,
      history: createHistoryRepository(pool!),
      connection,
      logger,
      now: () => new Date(dataset.now.getTime() + 3_600_000),
      buildDeck: async () => ({
        fileName: "Weekly_Status_DEMO_2026-10-12.pptx",
        content: Buffer.from("PK-deck"),
      }),
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
      reports: {
        service,
        jobs,
        buildDeck: async () => ({
          fileName: "Weekly_Status_DEMO_2026-10-12.pptx",
          content: Buffer.from("PK-regenerated"),
        }),
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
  });
  afterEach(async () => {
    await service.idle();
  });

  const create = (body: object = {}) =>
    agent.post("/api/v1/reports").set("x-csrf-token", csrf).send(body);

  it("requires authentication and a CSRF token", async () => {
    expect((await anonymous.post("/api/v1/reports").send({})).status).toBe(401);
    expect((await anonymous.get("/api/v1/reports/1")).status).toBe(401);
    expect((await agent.post("/api/v1/reports").send({})).status).toBe(403);
  });

  it("accepts a job, reports its status, and serves data and the deck", async () => {
    const created = await create();
    expect(created.status).toBe(202);
    expect(created.headers.location).toBe(`/api/v1/reports/${created.body.id}`);
    expect(["queued", "running"]).toContain(created.body.status);
    await service.idle();

    const id = created.body.id;
    const status = await agent.get(`/api/v1/reports/${id}`);
    expect(status.body).toMatchObject({
      id,
      status: "succeeded",
      weekStart: "2026-10-12",
      dryRun: false,
      hasDeck: true,
      deckStale: false,
      error: null,
    });

    const data = await agent.get(`/api/v1/reports/${id}/data`);
    expect(data.status).toBe(200);
    expect(reportSchema.safeParse(data.body).success).toBe(true);

    const deck = await agent
      .get(`/api/v1/reports/${id}/deck`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(deck.status).toBe(200);
    expect(deck.headers["content-type"]).toContain("presentationml.presentation");
    expect(deck.headers["content-disposition"]).toContain("Weekly_Status_DEMO_2026-10-12.pptx");
    expect((deck.body as Buffer).toString()).toBe("PK-deck");
  });

  it("returns 409 for a duplicate week while a job is active", async () => {
    await pool!.query(
      "INSERT INTO report_job (week_start, time_zone, status) VALUES ('2026-10-12', 'UTC', 'running')",
    );
    const res = await create();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REPORT_IN_PROGRESS");
  });

  it("validates the request body", async () => {
    const res = await create({ weekStart: "next week", extra: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("answers 409 before the report is ready and 404 for unknown ids", async () => {
    const row = await pool!.query(
      "INSERT INTO report_job (week_start, time_zone, status) VALUES ('2026-09-28', 'UTC', 'running') RETURNING id",
    );
    const id = row.rows[0].id;
    expect((await agent.get(`/api/v1/reports/${id}/data`)).body.error.code).toBe(
      "REPORT_NOT_READY",
    );
    expect((await agent.get("/api/v1/reports/999999")).status).toBe(404);
    expect((await agent.get("/api/v1/reports/abc")).status).toBe(404);
    expect((await agent.get(`/api/v1/reports/${id}/deck`)).body.error.code).toBe("DECK_NOT_FOUND");
  });

  it("offers no deck for a dry run", async () => {
    const created = await create({ dryRun: true });
    await service.idle();
    const status = await agent.get(`/api/v1/reports/${created.body.id}`);
    expect(status.body).toMatchObject({ status: "succeeded", dryRun: true, hasDeck: false });
    expect((await agent.get(`/api/v1/reports/${created.body.id}/deck`)).status).toBe(404);
  });

  it("returns a failed job's error code without internals", async () => {
    mock.failNext(401, 1);
    const created = await create();
    await service.idle();
    const status = await agent.get(`/api/v1/reports/${created.body.id}`);
    expect(status.body.status).toBe("failed");
    expect(status.body.error.code).toBe("JIRA_AUTH_FAILED");
    expect((await agent.get(`/api/v1/reports/${created.body.id}/data`)).status).toBe(409);
  });

  it("regenerates the deck from stored data without calling Jira and clears the stale flag", async () => {
    const created = await create();
    await service.idle();
    const id = created.body.id;
    await pool!.query("UPDATE report_deck SET stale = true");
    expect((await agent.get(`/api/v1/reports/${id}`)).body.deckStale).toBe(true);

    const before = mock.stats.requests;
    const regenerated = await agent.post(`/api/v1/reports/${id}/deck`).set("x-csrf-token", csrf);
    expect(regenerated.status).toBe(200);
    expect(regenerated.body).toMatchObject({ hasDeck: true, deckStale: false });
    expect(mock.stats.requests).toBe(before);
    const deck = await agent
      .get(`/api/v1/reports/${id}/deck`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect((deck.body as Buffer).toString()).toBe("PK-regenerated");
  });

  it("returns the latest job, or null when there is none", async () => {
    expect((await agent.get("/api/v1/reports/latest")).body).toEqual({ job: null });
    const created = await create();
    await service.idle();
    const latest = await agent.get("/api/v1/reports/latest");
    expect(latest.body.job.id).toBe(created.body.id);
    expect((await anonymous.get("/api/v1/reports/latest")).status).toBe(401);
  });

  it("refuses to regenerate a deck for dry runs, unknown ids and missing CSRF", async () => {
    const dry = await create({ dryRun: true });
    await service.idle();
    const post = (id: number | string) =>
      agent.post(`/api/v1/reports/${id}/deck`).set("x-csrf-token", csrf);
    expect((await post(dry.body.id)).status).toBe(409);
    expect((await post(999999)).status).toBe(404);
    expect((await agent.post(`/api/v1/reports/${dry.body.id}/deck`)).status).toBe(403);
  });

  it("keeps person names and mention markers out of a deck built from mock Jira data", async () => {
    const created = await create();
    await service.idle();
    const data = (await agent.get(`/api/v1/reports/${created.body.id}/data`)).body;
    expect(data.blockers.length).toBeGreaterThan(0);
    const deck = await buildDeck(reportSchema.parse(data), { jiraBaseUrl: mock.url });
    const zip = await JSZip.loadAsync(deck.content);
    let xml = "";
    for (const name of Object.keys(zip.files)) {
      if (name.endsWith(".xml") || name.endsWith(".rels"))
        xml += await zip.file(name)!.async("string");
    }
    expect(xml).not.toMatch(/accountid|displayName|emailAddress|\[~|jane\d*@/i);
    expect(xml).not.toContain(TOKEN);
  });

  it("never exposes credentials, raw Jira payloads, or person names", async () => {
    const created = await create();
    await service.idle();
    const id = created.body.id;
    const bodies = [
      JSON.stringify(created.body),
      JSON.stringify((await agent.get(`/api/v1/reports/${id}`)).body),
      JSON.stringify((await agent.get(`/api/v1/reports/${id}/data`)).body),
      JSON.stringify((await agent.get("/api/v1/settings")).body),
    ].join("\n");
    expect(bodies).not.toContain(TOKEN);
    expect(bodies).not.toContain("a@example.com");
    expect(bodies).not.toContain(mock.url);
    expect(bodies).not.toMatch(/accountid|displayName|emailAddress|\[~|jane\d*@/i);
    expect(bodies).not.toMatch(/"changelog"|"histories"|"fields"/);
  });
});
