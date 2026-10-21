import { Router, type CookieOptions } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { SESSION_COOKIE, type AuthConfig } from "../auth/config.js";
import { verifyPassword } from "../auth/password.js";
import { createSessionToken, csrfTokenFor } from "../auth/session.js";
import { AppError } from "../errors.js";
import type { Logger } from "../logger.js";
import { getSession } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const loginBody = z.object({ password: z.string().min(1).max(256) });

function cookieOptions(config: AuthConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookies,
    path: "/",
  };
}

// Public: sign-in only.
export function loginRouter(config: AuthConfig, logger: Logger): Router {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginMaxFailures,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-in attempts; try later"));
    },
  });

  router.post("/login", limiter, validate({ body: loginBody }), async (req, res, next) => {
    try {
      const { password } = req.body as z.infer<typeof loginBody>;
      if (!(await verifyPassword(config.passwordHash, password, logger))) {
        throw new AppError(401, "INVALID_CREDENTIALS", "The password is incorrect");
      }
      const { token, claims } = createSessionToken(
        config.sessionSecret,
        config.sessionLifetimeSeconds,
      );
      res.cookie(SESSION_COOKIE, token, {
        ...cookieOptions(config),
        maxAge: config.sessionLifetimeSeconds * 1000,
      });
      res.json({
        csrfToken: csrfTokenFor(config.sessionSecret, claims.sid),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// Protected: mounted after the authentication and CSRF guards.
export function sessionRouter(config: AuthConfig): Router {
  const router = Router();

  router.get("/session", (_req, res) => {
    const session = getSession(res);
    res.json({
      csrfToken: csrfTokenFor(config.sessionSecret, session.sid),
      expiresAt: new Date(session.exp * 1000).toISOString(),
    });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions(config));
    res.status(204).end();
  });

  return router;
}
