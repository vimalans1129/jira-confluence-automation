import argon2 from "argon2";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { DEFAULT_SETTINGS } from "../src/config/settingsDefaults.js";
import { createLogger } from "../src/logger.js";
import { createSettingsRepository } from "../src/repositories/settingsRepository.js";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!url)("settings repository and API", () => {
  const repo = createSettingsRepository(pool!);
  let agent: ReturnType<typeof request.agent>;
  let csrf = "";

  beforeAll(async () => {
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
    });
    agent = request.agent(app);
    const res = await agent.post("/api/v1/auth/login").send({ password: "pw" });
    csrf = res.body.csrfToken;
  });

  beforeEach(async () => {
    await pool!.query("DELETE FROM setting");
    await pool!.query("DELETE FROM audit_entry WHERE entity = 'setting'");
  });

  it("returns code defaults when no row exists", async () => {
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("requires a session", async () => {
    const res = await request(
      createApp({
        logger: createLogger("silent"),
        checkDatabase: async () => {},
        auth: {
          passwordHash: "x",
          sessionSecret: "s".repeat(40),
          sessionLifetimeSeconds: 3600,
          secureCookies: false,
          trustProxy: 0,
          loginMaxFailures: 5,
        },
        settings: repo,
      }),
    ).get("/api/v1/settings");
    expect(res.status).toBe(401);
  });

  it("saves a change, merges partial thresholds and writes an audit entry", async () => {
    const res = await agent
      .put("/api/v1/settings")
      .set("x-csrf-token", csrf)
      .send({ reportName: "Team", ragThresholds: { blockerRedDays: 3 } });
    expect(res.status).toBe(200);
    expect(res.body.settings.reportName).toBe("Team");
    expect(res.body.settings.ragThresholds).toEqual({
      ...DEFAULT_SETTINGS.ragThresholds,
      blockerRedDays: 3,
    });

    const get = await agent.get("/api/v1/settings");
    expect(get.body.settings.ragThresholds.blockerRedDays).toBe(3);
    expect(get.body.defaultsVersion).toMatch(/^\d/);

    const { rows } = await pool!.query(
      "SELECT entity_key, old_value, new_value FROM audit_entry WHERE entity = 'setting' ORDER BY entity_key",
    );
    expect(rows.map((r) => r.entity_key)).toEqual(["ragThresholds", "reportName"]);
    expect(rows[1].new_value).toBe("Team");
  });

  it("does not audit an unchanged value", async () => {
    await repo.update({ reportName: DEFAULT_SETTINGS.reportName });
    const { rows } = await pool!.query("SELECT 1 FROM audit_entry WHERE entity = 'setting'");
    expect(rows).toHaveLength(0);
  });

  it("rejects invalid values with field details and writes nothing", async () => {
    const res = await agent
      .put("/api/v1/settings")
      .set("x-csrf-token", csrf)
      .send({ reportName: "Ok", timeZone: "Nope/Zone" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details[0].path).toBe("timeZone");
    const { rows } = await pool!.query("SELECT 1 FROM setting");
    expect(rows).toHaveLength(0);
  });

  it("requires the CSRF token to save", async () => {
    const res = await agent.put("/api/v1/settings").send({ reportName: "x" });
    expect(res.status).toBe(403);
  });

  it("fails loudly when a stored value is invalid", async () => {
    await pool!.query("INSERT INTO setting (key, value) VALUES ('trendWeeks', '0')");
    await expect(repo.load()).rejects.toMatchObject({ code: "SETTINGS_INVALID" });
  });

  it("audits the denylist size, never its names", async () => {
    await repo.update({ nameDenylist: ["Contoso", "Fabrikam"] });
    const { rows } = await pool!.query(
      "SELECT old_value, new_value FROM audit_entry WHERE entity_key = 'nameDenylist'",
    );
    expect(rows[0].new_value).toEqual({ entries: 2 });
    expect(JSON.stringify(rows)).not.toContain("Contoso");
  });

  it("exposes no secrets or connection values", async () => {
    const res = await agent.get("/api/v1/settings");
    const text = JSON.stringify(res.body).toLowerCase();
    for (const word of ["password", "token", "secret", "database_url", "jira_base_url"]) {
      expect(text).not.toContain(word);
    }
  });
});
