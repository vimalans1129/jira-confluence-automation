import { Router } from "express";
import { SETTINGS_DEFAULTS_VERSION } from "../config/settingsDefaults.js";
import type { SettingsRepository } from "../repositories/settingsRepository.js";

// Only report settings are exposed. Secrets and connection values stay in the environment.
export function settingsRouter(repo: SettingsRepository): Router {
  const router = Router();

  router.get("/settings", async (_req, res, next) => {
    try {
      res.json({ settings: await repo.load(), defaultsVersion: SETTINGS_DEFAULTS_VERSION });
    } catch (err) {
      next(err);
    }
  });

  router.put("/settings", async (req, res, next) => {
    try {
      res.json({
        settings: await repo.update(req.body),
        defaultsVersion: SETTINGS_DEFAULTS_VERSION,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
