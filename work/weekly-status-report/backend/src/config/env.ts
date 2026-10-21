import { z } from "zod";
import type { AuthConfig } from "../auth/config.js";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ADMIN_PASSWORD_HASH: z.string().min(1, "APP_ADMIN_PASSWORD_HASH is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_LIFETIME_HOURS: z.coerce.number().min(0.1).max(168).default(8),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  JIRA_BASE_URL: optional(z.url("JIRA_BASE_URL must be a URL")),
  JIRA_EMAIL: optional(z.string()),
  JIRA_API_TOKEN: optional(z.string()),
  JIRA_PROJECT_KEY: optional(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "invalid project key")),
  JIRA_BOARD_ID: optional(z.coerce.number().int().positive()),
});

export type Env = z.infer<typeof envSchema>;

export interface JiraConnection {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  boardId: number;
}

// Null while any Jira variable is missing; the app still starts so settings and health work.
export function toJiraConnection(env: Env): JiraConnection | null {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_BOARD_ID } = env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY || !JIRA_BOARD_ID) {
    return null;
  }
  return {
    baseUrl: JIRA_BASE_URL,
    email: JIRA_EMAIL,
    apiToken: JIRA_API_TOKEN,
    projectKey: JIRA_PROJECT_KEY,
    boardId: JIRA_BOARD_ID,
  };
}

export function toAuthConfig(env: Env): AuthConfig {
  return {
    passwordHash: env.APP_ADMIN_PASSWORD_HASH,
    sessionSecret: env.SESSION_SECRET,
    sessionLifetimeSeconds: Math.round(env.SESSION_LIFETIME_HOURS * 3600),
    secureCookies: env.NODE_ENV === "production",
    trustProxy: env.TRUST_PROXY,
    loginMaxFailures: 5,
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Report variable names and reasons only, never the values.
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join("; ")}`);
  }
  return result.data;
}
