import type { RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { AppError, type ErrorDetail } from "../errors.js";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export interface Validated {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

// Parsed values are stored on res.locals because req.query is read-only in Express 5.
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const details: ErrorDetail[] = [];
    const validated: Validated = {};

    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) {
        validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ path: [part, ...issue.path].join("."), message: issue.message });
        }
      }
    }

    if (details.length > 0) {
      next(new AppError(400, "VALIDATION_FAILED", "The request is not valid", details));
      return;
    }
    res.locals["validated"] = validated;
    next();
  };
}

export function getValidated(res: Response): Validated {
  return (res.locals["validated"] as Validated | undefined) ?? {};
}
