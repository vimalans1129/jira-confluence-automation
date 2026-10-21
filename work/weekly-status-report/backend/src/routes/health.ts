import { Router } from "express";
import { AppError } from "../errors.js";
import type { Logger } from "../logger.js";

export type DatabaseCheck = () => Promise<void>;

export function healthRouter(checkDatabase: DatabaseCheck, logger: Logger): Router {
  const router = Router();

  router.get("/health", async (_req, res, next) => {
    try {
      await checkDatabase();
      res.json({ status: "ok", database: "up" });
    } catch (err) {
      logger.warn({ err }, "database health check failed");
      next(new AppError(503, "DATABASE_UNAVAILABLE", "The database is not reachable"));
    }
  });

  return router;
}
