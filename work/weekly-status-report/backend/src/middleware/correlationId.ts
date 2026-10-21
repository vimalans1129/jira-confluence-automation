import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function correlationId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header("x-request-id");
    const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.locals["correlationId"] = id;
    res.setHeader("x-request-id", id);
    next();
  };
}

export function getCorrelationId(res: Response): string {
  const id: unknown = res.locals["correlationId"];
  return typeof id === "string" ? id : "unknown";
}
