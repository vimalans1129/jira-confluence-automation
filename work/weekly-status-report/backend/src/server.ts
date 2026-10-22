import { createApp } from "./app.js";
import { loadEnv, toAuthConfig, toJiraConnection } from "./config/env.js";
import { createLogger } from "./logger.js";
import { createHistoryRepository } from "./repositories/historyRepository.js";
import { createJobRepository } from "./repositories/jobRepository.js";
import { createPool, databaseCheck } from "./repositories/pool.js";
import { createSettingsRepository } from "./repositories/settingsRepository.js";
import { createSnapshotRepository } from "./repositories/snapshotRepository.js";
import { createOverrideRepository } from "./repositories/overrideRepository.js";
import { createOverrideService } from "./services/overrideService.js";
import { DEFAULT_TREND_WEEKS, toTrend } from "./services/trend.js";
import { createReportService } from "./services/reportService.js";
import { buildDeck } from "./services/deckBuilder.js";
import type { Report } from "./contract/index.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const pool = createPool(env.DATABASE_URL, logger);
const settings = createSettingsRepository(pool);
const jobs = createJobRepository(pool);
const snapshots = createSnapshotRepository(pool);
const overrides = createOverrideRepository(pool);
const connection = toJiraConnection(env);
const deckForReport = async (report: Report) => {
  const trend = toTrend(await snapshots.list(report.weekStart, DEFAULT_TREND_WEEKS));
  const deck = await buildDeck(report, { jiraBaseUrl: connection?.baseUrl ?? null, trend });
  for (const w of deck.warnings) logger.warn({ code: w.code }, "deck warning");
  return deck;
};
const service = createReportService({
  jobs,
  settings,
  history: createHistoryRepository(pool),
  snapshots,
  overrides,
  connection,
  logger,
  buildDeck: deckForReport,
});

await service.recoverOnStartup();

const app = createApp({
  logger,
  checkDatabase: databaseCheck(pool),
  auth: toAuthConfig(env),
  settings,
  validate: { settings, connection },
  reports: { service, jobs, buildDeck: deckForReport },
  trends: { snapshots, overrides: createOverrideService({ overrides, jobs, settings, snapshots }) },
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
