import { pino, type DestinationStream, type Logger } from "pino";

// Fields that must never reach the logs. Documented in the README.
export const REDACTED_KEYS = [
  "password",
  "passwordHash",
  "token",
  "apiToken",
  "apiKey",
  "secret",
  "sessionSecret",
  "authorization",
  "cookie",
  "prompt",
  "completion",
  "comment",
] as const;

const redactPaths = [
  ...REDACTED_KEYS,
  ...REDACTED_KEYS.map((k) => `*.${k}`),
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino({ level, redact: { paths: redactPaths, censor: "[REDACTED]" } }, destination);
}

export type { Logger };
