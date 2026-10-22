import { loadEnv, toJiraConnection } from "./config/env.js";
import { createLogger } from "./logger.js";
import { createPool } from "./repositories/pool.js";
import { createSettingsRepository } from "./repositories/settingsRepository.js";

// Marks the configured Jira connection as validated so a developer (or the end-to-end test)
// can generate reports against the mock Jira server without running the validation step.
// Use `--reset` to also clear previous jobs, decks and the Jira history cache.
const env = loadEnv();
const connection = toJiraConnection(env);
if (!connection) {
  console.error(
    "Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY and JIRA_BOARD_ID first.",
  );
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL, createLogger("silent"));
try {
  if (process.argv.includes("--reset")) {
    for (const table of [
      "rag_override",
      "snapshot",
      "report_deck",
      "report_job",
      "issue_history",
      "sync_state",
    ]) {
      await pool.query(`DELETE FROM ${table}`);
    }
  }
  await createSettingsRepository(pool).recordValidation({
    at: new Date(),
    projectKey: connection.projectKey,
    boardId: connection.boardId,
  });
  console.log(`Validation recorded for ${connection.projectKey} (board ${connection.boardId}).`);
} finally {
  await pool.end();
}
