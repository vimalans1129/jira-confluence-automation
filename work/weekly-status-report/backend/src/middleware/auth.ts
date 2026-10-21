import type { Request, RequestHandler, Response } from "express";
import { CSRF_HEADER, SESSION_COOKIE, type AuthConfig } from "../auth/config.js";
import {
  csrfTokenFor,
  safeEqual,
  verifySessionToken,
  type SessionClaims,
} from "../auth/session.js";
import { AppError } from "../errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

export function getSession(res: Response): SessionClaims {
  return res.locals["session"] as SessionClaims;
}

export function requireAuth(config: AuthConfig): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    const claims = token ? verifySessionToken(config.sessionSecret, token) : null;
    if (!claims) {
      next(new AppError(401, "UNAUTHENTICATED", "Sign in is required"));
      return;
    }
    res.locals["session"] = claims;
    next();
  };
}

export function csrfProtection(config: AuthConfig): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const supplied = req.header(CSRF_HEADER) ?? "";
    const expected = csrfTokenFor(config.sessionSecret, getSession(res).sid);
    if (!supplied || !safeEqual(supplied, expected)) {
      next(new AppError(403, "CSRF_INVALID", "The CSRF token is missing or invalid"));
      return;
    }
    next();
  };
}

// Browsers always send Origin on cross-site state-changing requests; reject any that do not match the host.
export function originCheck(): RequestHandler {
  return (req, _res, next) => {
    const origin = req.header("origin");
    if (!SAFE_METHODS.has(req.method) && origin) {
      const host = URL.canParse(origin) ? new URL(origin).host : "";
      if (host !== req.get("host")) {
        next(new AppError(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed"));
        return;
      }
    }
    next();
  };
}
