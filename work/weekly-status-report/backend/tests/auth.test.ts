import argon2 from "argon2";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthConfig } from "../src/auth/config.js";
import { createSessionToken, csrfTokenFor, verifySessionToken } from "../src/auth/session.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/logger.js";

const PASSWORD = "correct horse battery staple";
const SECRET = "s".repeat(40);
const logger = createLogger("silent");
const up = async () => {};

let hash = "";
beforeAll(async () => {
  hash = await argon2.hash(PASSWORD, { memoryCost: 4096, timeCost: 2, parallelism: 1 });
});

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    passwordHash: hash,
    sessionSecret: SECRET,
    sessionLifetimeSeconds: 8 * 3600,
    secureCookies: false,
    trustProxy: 0,
    loginMaxFailures: 5,
    ...overrides,
  };
}

function makeApp(overrides: Partial<AuthConfig> = {}) {
  return createApp({ logger, checkDatabase: up, auth: config(overrides) });
}

async function login(app: ReturnType<typeof makeApp>, password = PASSWORD) {
  return request(app).post("/api/v1/auth/login").send({ password });
}

function sessionCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith("wsr_session="));
  if (!cookie) throw new Error("no session cookie");
  return cookie.split(";")[0] ?? "";
}

describe("login", () => {
  it("sets a signed HttpOnly SameSite=Strict cookie with the configured lifetime", async () => {
    const res = await login(makeApp());
    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe("string");
    const raw = (res.headers["set-cookie"] as unknown as string[]).join(";");
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Strict");
    expect(raw).toContain("Max-Age=28800");
    expect(raw).not.toContain("Secure");
  });

  it("marks the cookie Secure in production", async () => {
    const res = await login(makeApp({ secureCookies: true }));
    expect((res.headers["set-cookie"] as unknown as string[]).join(";")).toContain("Secure");
  });

  it("rejects a wrong password without a cookie or detail", async () => {
    const res = await login(makeApp(), "wrong");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("wrong");
  });

  it("rejects a missing password with a validation error", async () => {
    const res = await request(makeApp()).post("/api/v1/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rate limits repeated failed attempts, even with the right password afterwards", async () => {
    const app = makeApp({ loginMaxFailures: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await login(app, "wrong")).status).toBe(401);
    }
    const blocked = await login(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(blocked.headers["retry-after"]).toBeDefined();
  });
});

describe("route guard", () => {
  let app: ReturnType<typeof makeApp>;
  beforeAll(() => {
    app = makeApp();
  });
  const probes = [
    "/api/v1/reports",
    "/api/v1/reports/1/deck",
    "/api/v1/snapshots",
    "/api/v1/overrides",
    "/api/v1/settings",
    "/api/v1/validate",
    "/api/v1/summary",
    "/api/v1/auth/session",
    "/api/v1/auth/logout",
    "/api/v1/does-not-exist",
  ];

  it.each(probes)("rejects unauthenticated requests to %s for every method", async (path) => {
    for (const method of ["get", "post", "put", "delete"] as const) {
      const res = await request(app)[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("keeps health and login public", async () => {
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
    expect((await login(app)).status).toBe(200);
  });

  it("lets an authenticated request through to normal routing", async () => {
    const cookie = sessionCookie(await login(app));
    const res = await request(app).get("/api/v1/does-not-exist").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

describe("session", () => {
  it("returns the CSRF token for an authenticated session", async () => {
    const app = makeApp();
    const first = await login(app);
    const res = await request(app).get("/api/v1/auth/session").set("Cookie", sessionCookie(first));
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBe(first.body.csrfToken);
  });

  it("rejects a tampered cookie", async () => {
    const cookie = sessionCookie(await login(makeApp()));
    const res = await request(makeApp())
      .get("/api/v1/auth/session")
      .set("Cookie", cookie.slice(0, -2) + "xx");
    expect(res.status).toBe(401);
  });

  it("rejects an expired session", () => {
    const { token } = createSessionToken(SECRET, 60, Date.now() - 120_000);
    expect(verifySessionToken(SECRET, token)).toBeNull();
  });

  it("invalidates existing sessions when the signing secret changes", async () => {
    const cookie = sessionCookie(await login(makeApp()));
    const rotated = makeApp({ sessionSecret: "r".repeat(40) });
    const res = await request(rotated).get("/api/v1/auth/session").set("Cookie", cookie);
    expect(res.status).toBe(401);
  });

  it("verifies a fresh token and exposes its claims", () => {
    const { token, claims } = createSessionToken(SECRET, 60);
    expect(verifySessionToken(SECRET, token)?.sid).toBe(claims.sid);
    expect(verifySessionToken("x".repeat(40), token)).toBeNull();
  });
});

describe("csrf and origin protection", () => {
  it("rejects a state-changing request without a CSRF token", async () => {
    const app = makeApp();
    const cookie = sessionCookie(await login(app));
    const res = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_INVALID");
  });

  it("rejects a CSRF token that belongs to another session", async () => {
    const app = makeApp();
    const cookie = sessionCookie(await login(app));
    const other = csrfTokenFor(SECRET, "some-other-session");
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("x-csrf-token", other);
    expect(res.status).toBe(403);
  });

  it("allows logout with a valid token and clears the cookie", async () => {
    const app = makeApp();
    const first = await login(app);
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", sessionCookie(first))
      .set("x-csrf-token", first.body.csrfToken);
    expect(res.status).toBe(204);
    expect((res.headers["set-cookie"] as unknown as string[]).join(";")).toContain("wsr_session=;");
  });

  it("does not require a CSRF token for safe methods", async () => {
    const app = makeApp();
    const cookie = sessionCookie(await login(app));
    expect((await request(app).get("/api/v1/auth/session").set("Cookie", cookie)).status).toBe(200);
  });

  it("rejects a cross-origin state-changing request, including login", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("accepts a same-origin request", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", "app.example")
      .set("Origin", "https://app.example")
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe("auth environment configuration", () => {
  const base = {
    DATABASE_URL: "postgres://x",
    APP_ADMIN_PASSWORD_HASH: "hash",
    SESSION_SECRET: "s".repeat(32),
  };

  it("defaults the session lifetime to 8 hours", () => {
    expect(loadEnv(base).SESSION_LIFETIME_HOURS).toBe(8);
  });

  it("requires a long session secret and a password hash without echoing them", () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: "short-secret-value" })).toThrow(
      /SESSION_SECRET/,
    );
    expect(() => loadEnv({ DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(32) })).toThrow(
      /APP_ADMIN_PASSWORD_HASH/,
    );
    try {
      loadEnv({ ...base, SESSION_SECRET: "short-secret-value" });
    } catch (e) {
      expect((e as Error).message).not.toContain("short-secret-value");
    }
  });
});
