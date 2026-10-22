import { defineConfig } from "@playwright/test";

// Starts the mock Jira server, the backend and the Vite dev server, then runs the browser test.
// Requires a reachable PostgreSQL with migrations applied: set E2E_DATABASE_URL (or DATABASE_URL).
const databaseUrl =
  process.env["E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgres://wsr:change-me@localhost:5432/wsr";
const jiraUrl = "http://localhost:4010";

// Hash of the throwaway password "e2e-password"; it only protects the test instance.
export const E2E_PASSWORD = "e2e-password";
const passwordHash =
  "$argon2id$v=19$m=65536,p=4,t=3$OcAGMIwtzHcASGy5Y8jTUQ$7mIR7ouUiq1iUGexWq2cekCGWSvIhpLkhkYo0FD5TfU";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: [
    {
      command: "npm run mock-jira",
      cwd: "../backend",
      env: { MOCK_JIRA_ISSUES: "200", MOCK_JIRA_LATENCY_MS: "0", MOCK_JIRA_PORT: "4010" },
      url: `${jiraUrl}/rest/api/3/myself`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run seed -- --reset && npx tsx src/server.ts",
      cwd: "../backend",
      env: {
        PORT: "3000",
        LOG_LEVEL: "warn",
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
        APP_ADMIN_PASSWORD_HASH: passwordHash,
        JIRA_BASE_URL: jiraUrl,
        JIRA_EMAIL: "e2e@example.com",
        JIRA_API_TOKEN: "e2e-token",
        JIRA_PROJECT_KEY: "DEMO",
        JIRA_BOARD_ID: "1",
      },
      url: "http://localhost:3000/api/v1/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx vite --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
