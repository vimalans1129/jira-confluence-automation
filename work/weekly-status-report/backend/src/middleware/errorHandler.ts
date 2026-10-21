import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, type ErrorBody } from "../errors.js";
import type { Logger } from "../logger.js";
import { getCorrelationId } from "./correlationId.js";

export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => {
    next(new AppError(404, "NOT_FOUND", "The requested resource does not exist"));
  };
}

interface HttpLikeError {
  status?: number;
  type?: string;
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const http = err as HttpLikeError | null;
  if (http?.type === "entity.parse.failed") {
    return new AppError(400, "INVALID_JSON", "The request body is not valid JSON");
  }
  if (http?.type === "entity.too.large") {
    return new AppError(413, "PAYLOAD_TOO_LARGE", "The request body is too large");
  }
  return new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error handlers by their four-argument signature.
  return (err, req, res, _next) => {
    const appError = toAppError(err);
    const correlationId = getCorrelationId(res);

    if (appError.status >= 500) {
      logger.error({ err, correlationId, method: req.method, path: req.path }, "request failed");
    } else {
      logger.info(
        { correlationId, code: appError.code, status: appError.status, path: req.path },
        "request rejected",
      );
    }

    const body: ErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        correlationId,
        ...(appError.details ? { details: appError.details } : {}),
      },
    };
    res.status(appError.status).json(body);
  };
}
