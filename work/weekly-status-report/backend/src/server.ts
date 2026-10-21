import { createApp } from "./app.js";
import { loadEnv, toAuthConfig, toJiraConnection } from "./config/env.js";
import { createLogger } from "./logger.js";
import { createHistoryRepository } from "./repositories/historyRepository.js";
import { createJobRepository } from "./repositories/jobRepository.js";
import { createPool, databaseCheck } from "./repositories/pool.js";
import { createSettingsRepository } from "./repositories/settingsRepository.js";
import { createReportService } from "./services/reportService.js";
import { buildDeck } from "./services/deckBuilder.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const pool = createPool(env.DATABASE_URL, logger);
const settings = createSettingsRepository(pool);
const jobs = createJobRepository(pool);
const connection = toJiraConnection(env);
const service = createReportService({
  jobs,
  settings,
  history: createHistoryRepository(pool),
  connection,
  logger,
  buildDeck: async (report) => {
    const deck = await buildDeck(report, { jiraBaseUrl: connection?.baseUrl ?? null });
    for (const w of deck.warnings) logger.warn({ code: w.code }, "deck warning");
    return deck;
  },
});

await service.recoverOnStartup();

const app = createApp({
  logger,
  checkDatabase: databaseCheck(pool),
  auth: toAuthConfig(env),
  settings,
  validate: { settings, connection },
  reports: { service, jobs },
});
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "server listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
