import { Router } from "express";
import { z } from "zod";
import type { JiraConnection } from "../config/env.js";
import { AppError } from "../errors.js";
import { runValidation, type ValidationDeps } from "../services/validation.js";

const choicesSchema = z
  .object({
    storyPointsFieldId: z.string().min(1).optional(),
    flaggedFieldId: z.string().min(1).optional(),
  })
  .strict();

export interface ValidateRouteDeps extends Omit<ValidationDeps, "connection"> {
  connection: JiraConnection | null;
}

export function validateRouter(deps: ValidateRouteDeps): Router {
  const router = Router();

  router.post("/validate", async (req, res, next) => {
    try {
      const { connection } = deps;
      if (!connection) {
        throw new AppError(
          409,
          "JIRA_NOT_CONFIGURED",
          "Jira connection settings are missing from the server environment.",
        );
      }
      const parsed = choicesSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(
          400,
          "VALIDATION_FAILED",
          "The request body is not valid",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      res.json(await runValidation({ ...deps, connection }, parsed.data));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
