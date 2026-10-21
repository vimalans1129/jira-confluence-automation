import { createApp } from "./app.js";
import { loadEnv, toAuthConfig, toJiraConnection } from "./config/env.js";
import { createLogger } from "./logger.js";
import { createPool, databaseCheck } from "./repositories/pool.js";
import { createSettingsRepository } from "./repositories/settingsRepository.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const pool = createPool(env.DATABASE_URL, logger);
const settings = createSettingsRepository(pool);

const app = createApp({
  logger,
  checkDatabase: databaseCheck(pool),
  auth: toAuthConfig(env),
  settings,
  validate: { settings, connection: toJiraConnection(env) },
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
