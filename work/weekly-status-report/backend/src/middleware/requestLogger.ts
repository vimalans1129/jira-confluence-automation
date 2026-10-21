import type { RequestHandler } from "express";
import type { Logger } from "../logger.js";
import { getCorrelationId } from "./correlationId.js";

export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info(
        {
          correlationId: getCorrelationId(res),
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
        },
        "request completed",
      );
    });
    next();
  };
}
