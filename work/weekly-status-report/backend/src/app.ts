import express, { Router, type Express } from "express";
import type { AuthConfig } from "./auth/config.js";
import { csrfProtection, originCheck, requireAuth } from "./middleware/auth.js";
import { correlationId } from "./middleware/correlationId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import type { Logger } from "./logger.js";
import { loginRouter, sessionRouter } from "./routes/auth.js";
import { healthRouter, type DatabaseCheck } from "./routes/health.js";
import { settingsRouter } from "./routes/settings.js";
import { validateRouter, type ValidateRouteDeps } from "./routes/validate.js";
import type { SettingsRepository } from "./repositories/settingsRepository.js";

export interface AppDependencies {
  logger: Logger;
  checkDatabase: DatabaseCheck;
  auth: AuthConfig;
  settings?: SettingsRepository;
  validate?: ValidateRouteDeps;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.auth.trustProxy);
  app.use(correlationId());
  app.use(requestLogger(deps.logger));
  app.use(express.json({ limit: "1mb" }));

  const api = Router();
  api.use(originCheck());

  // Public routes: health and sign-in only.
  api.use(healthRouter(deps.checkDatabase, deps.logger));
  api.use("/auth", loginRouter(deps.auth, deps.logger));

  // Everything below requires a valid session; state-changing requests also need a CSRF token.
  api.use(requireAuth(deps.auth));
  api.use(csrfProtection(deps.auth));
  api.use("/auth", sessionRouter(deps.auth));
  if (deps.settings) api.use(settingsRouter(deps.settings));
  if (deps.validate) api.use(validateRouter(deps.validate));

  app.use("/api/v1", api);

  app.use(notFoundHandler());
  app.use(errorHandler(deps.logger));
  return app;
}
