import { Writable } from "node:stream";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import express from "express";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { AppError } from "../src/errors.js";
import { createLogger, REDACTED_KEYS } from "../src/logger.js";
import { correlationId } from "../src/middleware/correlationId.js";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler.js";
import { getValidated, validate } from "../src/middleware/validate.js";
import { createPool, databaseCheck } from "../src/repositories/pool.js";

function capture(): { lines: () => string[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { lines: () => chunks, stream };
}

const silent = createLogger("silent");
const up = async () => {};
const auth = {
  passwordHash: "unused",
  sessionSecret: "s".repeat(32),
  sessionLifetimeSeconds: 3600,
  secureCookies: false,
  trustProxy: 0,
  loginMaxFailures: 5,
};
const authEnv = { APP_ADMIN_PASSWORD_HASH: "hash", SESSION_SECRET: "s".repeat(32) };

describe("health endpoint", () => {
  it("reports the database as up", async () => {
    const res = await request(createApp({ logger: silent, checkDatabase: up, auth })).get(
      "/api/v1/health",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "up" });
  });

  it("returns 503 in the standard error shape when the database is down", async () => {
    const down = async () => {
      throw new Error("connect ECONNREFUSED secret-host");
    };
    const res = await request(createApp({ logger: silent, checkDatabase: down, auth })).get(
      "/api/v1/health",
    );
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(res.body.error.correlationId).toBe(res.headers["x-request-id"]);
    expect(JSON.stringify(res.body)).not.toContain("secret-host");
  });

  it("returns 503 against a real unreachable database", async () => {
    const pool = createPool("postgres://wsr:x@127.0.0.1:1/wsr");
    const res = await request(
      createApp({ logger: silent, checkDatabase: databaseCheck(pool), auth }),
    ).get("/api/v1/health");
    await pool.end();
    expect(res.status).toBe(503);
  });

  it.skipIf(!process.env["TEST_DATABASE_URL"])("reports up against a real database", async () => {
    const pool = createPool(process.env["TEST_DATABASE_URL"] ?? "");
    const res = await request(
      createApp({ logger: silent, checkDatabase: databaseCheck(pool), auth }),
    ).get("/api/v1/health");
    await pool.end();
    expect(res.status).toBe(200);
  });
});

describe("error handling", () => {
  const app = createApp({ logger: silent, checkDatabase: up, auth });

  it("returns 404 in the standard shape for unknown routes outside the API", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND" });
    expect(typeof res.body.error.correlationId).toBe("string");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .set("content-type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("hides the details of unexpected errors", async () => {
    const boom = express();
    boom.use(correlationId());
    boom.get("/boom", () => {
      throw new Error("db password is hunter2");
    });
    boom.use(notFoundHandler());
    boom.use(errorHandler(silent));
    const res = await request(boom).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });

  it("uses a valid incoming correlation ID and replaces an invalid one", async () => {
    const ok = await request(app).get("/api/v1/health").set("x-request-id", "abc-12345678");
    expect(ok.headers["x-request-id"]).toBe("abc-12345678");
    const bad = await request(app).get("/api/v1/health").set("x-request-id", "bad id!");
    expect(bad.headers["x-request-id"]).not.toBe("bad id!");
  });
});

describe("validation middleware", () => {
  const app = express();
  app.use(correlationId());
  app.use(express.json());
  app.post(
    "/items",
    validate({
      body: z.object({ name: z.string().min(1) }),
      query: z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    }),
    (_req, res) => {
      res.json(getValidated(res));
    },
  );
  app.use(errorHandler(silent));

  it("rejects an invalid body and query with a 400 and field details", async () => {
    const res = await request(app).post("/items?week=x").send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["body.name", "query.week"]));
  });

  it("passes parsed values to the handler", async () => {
    const res = await request(app).post("/items?week=2026-10-12").send({ name: "x" });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: "x" });
  });
});

describe("logging", () => {
  it("redacts every listed secret field", () => {
    const { lines, stream } = capture();
    const logger = createLogger("info", stream);
    const payload = Object.fromEntries(REDACTED_KEYS.map((k) => [k, "leaky-value"]));
    logger.info({ ...payload, nested: payload }, "check");
    const output = lines().join("");
    expect(output).not.toContain("leaky-value");
    expect(output).toContain("[REDACTED]");
  });

  it("writes the correlation ID with each request log", async () => {
    const { lines, stream } = capture();
    const logger = createLogger("info", stream);
    const res = await request(createApp({ logger, checkDatabase: up, auth })).get("/api/v1/health");
    const entries = lines().map((l) => JSON.parse(l) as { correlationId?: string });
    expect(entries.some((e) => e.correlationId === res.headers["x-request-id"])).toBe(true);
  });
});

describe("environment configuration", () => {
  it("applies defaults", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://x", ...authEnv });
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("names the failing variable without echoing its value", () => {
    const bad = { DATABASE_URL: "postgres://x", ...authEnv, PORT: "not-a-number-secret" };
    expect(() => loadEnv(bad)).toThrow(/PORT/);
    try {
      loadEnv(bad);
    } catch (e) {
      expect((e as Error).message).not.toContain("not-a-number-secret");
    }
  });
});

describe("database pool", () => {
  it("handles idle connection errors so the process does not exit", async () => {
    const pool = createPool("postgres://wsr:x@127.0.0.1:1/wsr", silent);
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    await pool.end();
  });
});

describe("AppError", () => {
  it("carries status, code and details", () => {
    const e = new AppError(400, "X", "msg", [{ path: "a", message: "b" }]);
    expect(e.status).toBe(400);
    expect(e.details).toHaveLength(1);
  });
});
