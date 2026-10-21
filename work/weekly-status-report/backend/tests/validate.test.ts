import argon2 from "argon2";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { toJiraConnection, loadEnv, type JiraConnection } from "../src/config/env.js";
import type { JiraClient } from "../src/jira/client.js";
import { MOCK_FIELDS, generateDataset } from "../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../src/jira/mock/server.js";
import { createLogger } from "../src/logger.js";
import { createSettingsRepository } from "../src/repositories/settingsRepository.js";
import { assertValidated, runValidation } from "../src/services/validation.js";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
afterAll(async () => {
  await pool?.end();
});

describe("Jira environment variables", () => {
  const base = {
    DATABASE_URL: "postgres://x",
    APP_ADMIN_PASSWORD_HASH: "h",
    SESSION_SECRET: "s".repeat(40),
  };

  it("treats empty Jira variables as not configured", () => {
    const env = loadEnv({ ...base, JIRA_BASE_URL: "", JIRA_BOARD_ID: "" });
    expect(toJiraConnection(env)).toBeNull();
  });

  it("builds a connection when every variable is set", () => {
    const env = loadEnv({
      ...base,
      JIRA_BASE_URL: "https://example.atlassian.net",
      JIRA_EMAIL: "a@example.com",
      JIRA_API_TOKEN: "t",
      JIRA_PROJECT_KEY: "DEMO",
      JIRA_BOARD_ID: "1",
    });
    expect(toJiraConnection(env)).toMatchObject({ projectKey: "DEMO", boardId: 1 });
  });

  it("rejects a malformed project key without echoing values", () => {
    expect(() => loadEnv({ ...base, JIRA_PROJECT_KEY: "1 bad" })).toThrow(/JIRA_PROJECT_KEY/);
  });
});

describe.skipIf(!url)("validation check", () => {
  const repo = createSettingsRepository(pool!);
  const dataset = generateDataset({ issues: 30 });
  let mock: MockJira;
  let agent: ReturnType<typeof request.agent>;
  let csrf = "";

  const connection = (overrides: Partial<JiraConnection> = {}): JiraConnection => ({
    baseUrl: mock.url,
    email: "a@example.com",
    apiToken: "token",
    projectKey: dataset.projectKey,
    boardId: dataset.boardId,
    ...overrides,
  });

  const appFor = async (conn: JiraConnection | null) => {
    const hash = await argon2.hash("pw", { memoryCost: 4096, timeCost: 2, parallelism: 1 });
    const app = createApp({
      logger: createLogger("silent"),
      checkDatabase: async () => {},
      auth: {
        passwordHash: hash,
        sessionSecret: "s".repeat(40),
        sessionLifetimeSeconds: 3600,
        secureCookies: false,
        trustProxy: 0,
        loginMaxFailures: 5,
      },
      settings: repo,
      validate: { settings: repo, connection: conn },
    });
    agent = request.agent(app);
    csrf = (await agent.post("/api/v1/auth/login").send({ password: "pw" })).body.csrfToken;
  };

  const post = (body: object = {}) =>
    agent.post("/api/v1/validate").set("x-csrf-token", csrf).send(body);

  beforeAll(async () => {
    mock = await startMockJira({ dataset, email: "a@example.com", apiToken: "token" });
  });
  afterAll(async () => {
    await mock.close();
  });
  beforeEach(async () => {
    await pool!.query("DELETE FROM setting");
    await pool!.query("DELETE FROM audit_entry WHERE entity = 'setting'");
  });

  it("passes against a healthy Jira and stores validation_passed_at", async () => {
    await appFor(connection());
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks.map((c: { name: string }) => c.name)).toEqual([
      "connectivity",
      "project",
      "board",
      "storyPointsField",
      "flaggedField",
    ]);
    expect(res.body.storyPointsField).toMatchObject({
      status: "configured",
      id: MOCK_FIELDS.storyPoints,
    });
    expect(res.body.validatedAt).not.toBeNull();
    await expect(assertValidated(repo, connection())).resolves.toBeUndefined();
  });

  it("refuses generation until validation has passed", async () => {
    await expect(assertValidated(repo, connection())).rejects.toMatchObject({
      status: 409,
      code: "VALIDATION_REQUIRED",
    });
    await expect(assertValidated(repo, null)).rejects.toMatchObject({
      code: "JIRA_NOT_CONFIGURED",
    });
  });

  it("clears validation when a field ID changes", async () => {
    await appFor(connection());
    await post();
    await repo.update({ storyPointsFieldId: "customfield_99999" });
    await expect(assertValidated(repo, connection())).rejects.toMatchObject({
      code: "VALIDATION_REQUIRED",
    });
  });

  it("does not clear validation when an unrelated setting changes", async () => {
    await appFor(connection());
    await post();
    await repo.update({ reportName: "Another name" });
    await expect(assertValidated(repo, connection())).resolves.toBeUndefined();
  });

  it("treats a changed project key or board ID as not validated", async () => {
    await appFor(connection());
    await post();
    await expect(assertValidated(repo, connection({ projectKey: "OTHER" }))).rejects.toMatchObject({
      code: "VALIDATION_REQUIRED",
    });
    await expect(assertValidated(repo, connection({ boardId: 99 }))).rejects.toMatchObject({
      code: "VALIDATION_REQUIRED",
    });
  });

  it("auto-selects the only candidate and saves it when the configured ID is wrong", async () => {
    await repo.update({ storyPointsFieldId: "customfield_99999" });
    await appFor(connection());
    const res = await post();
    expect(res.body.ok).toBe(true);
    expect(res.body.storyPointsField).toMatchObject({
      status: "selected",
      id: MOCK_FIELDS.storyPoints,
    });
    expect(res.body.savedSettings).toEqual(["storyPointsFieldId"]);
    expect((await repo.load()).storyPointsFieldId).toBe(MOCK_FIELDS.storyPoints);
    await expect(assertValidated(repo, connection())).resolves.toBeUndefined();
  });

  it("names the project key and reports a missing project", async () => {
    await appFor(connection({ projectKey: "NOPE" }));
    const res = await post();
    expect(res.body.ok).toBe(false);
    const project = res.body.checks.find((c: { name: string }) => c.name === "project");
    expect(project).toMatchObject({ ok: false, code: "JIRA_NOT_FOUND" });
    expect(project.message).toContain("NOPE");
    expect(res.body.validatedAt).toBeNull();
  });

  it("names the board ID and reports a missing board", async () => {
    await appFor(connection({ boardId: 999 }));
    const res = await post();
    const board = res.body.checks.find((c: { name: string }) => c.name === "board");
    expect(board).toMatchObject({ ok: false, code: "JIRA_NOT_FOUND" });
    expect(board.message).toContain("999");
  });

  it("stops after rejected credentials without leaking the token", async () => {
    await appFor(connection({ apiToken: "wrong-token-value" }));
    const res = await post();
    expect(res.body.ok).toBe(false);
    expect(res.body.checks).toHaveLength(1);
    expect(res.body.checks[0]).toMatchObject({ name: "connectivity", code: "JIRA_AUTH_FAILED" });
    expect(JSON.stringify(res.body)).not.toContain("wrong-token-value");
  });

  it("returns 409 when the Jira environment is not configured", async () => {
    await appFor(null);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("JIRA_NOT_CONFIGURED");
  });

  it("rejects unknown body properties", async () => {
    await appFor(connection());
    const res = await post({ projectKey: "X" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  describe("field candidates", () => {
    const fakeClient = (fields: unknown[]) =>
      ({
        get: async (path: string) => {
          if (path === "/rest/api/3/field") return fields;
          return {};
        },
      }) as unknown as JiraClient;

    const run = (fields: unknown[], choices = {}) =>
      runValidation(
        { settings: repo, connection: connection(), createClient: () => fakeClient(fields) },
        choices,
      );

    const several = [
      { id: "customfield_1", name: "Story Points", schema: { type: "number" } },
      { id: "customfield_2", name: "Story point estimate", schema: { type: "number" } },
      { id: "customfield_3", name: "Flagged", schema: { type: "array" } },
    ];

    it("lists several candidates with ID, name and type and requires a choice", async () => {
      const result = await run(several);
      expect(result.ok).toBe(false);
      expect(result.storyPointsField).toMatchObject({ status: "choose", id: null });
      expect(result.storyPointsField.candidates).toEqual([
        { id: "customfield_1", name: "Story Points", type: "number" },
        { id: "customfield_2", name: "Story point estimate", type: "number" },
      ]);
      expect(result.checks.find((c) => c.name === "storyPointsField")?.code).toBe(
        "FIELD_CHOICE_REQUIRED",
      );
      expect(result.flaggedField).toMatchObject({ status: "selected", id: "customfield_3" });
    });

    it("accepts a choice among the candidates and saves it", async () => {
      const result = await run(several, { storyPointsFieldId: "customfield_2" });
      expect(result.ok).toBe(true);
      expect(result.savedSettings).toContain("storyPointsFieldId");
      expect((await repo.load()).storyPointsFieldId).toBe("customfield_2");
    });

    it("rejects a choice that is not a candidate", async () => {
      const result = await run(several, { storyPointsFieldId: "customfield_3" });
      expect(result.ok).toBe(false);
      expect(result.storyPointsField.status).toBe("choose");
    });

    it("reports an error when no candidate exists", async () => {
      const result = await run([{ id: "summary", name: "Summary", schema: { type: "string" } }]);
      expect(result.ok).toBe(false);
      expect(result.storyPointsField.status).toBe("none");
      expect(result.checks.find((c) => c.name === "flaggedField")?.code).toBe("FIELD_NOT_FOUND");
    });

    it("ignores non-numeric fields that share the Story Points name", async () => {
      const result = await run([
        { id: "customfield_1", name: "Story Points", schema: { type: "string" } },
        { id: "customfield_3", name: "Flagged", schema: { type: "array" } },
      ]);
      expect(result.storyPointsField.status).toBe("none");
    });
  });
});
