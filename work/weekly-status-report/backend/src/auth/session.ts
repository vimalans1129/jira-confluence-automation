import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface SessionClaims {
  sid: string;
  exp: number;
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSessionToken(
  secret: string,
  lifetimeSeconds: number,
  nowMs: number = Date.now(),
): { token: string; claims: SessionClaims } {
  const claims: SessionClaims = {
    sid: randomBytes(16).toString("base64url"),
    exp: Math.floor(nowMs / 1000) + lifetimeSeconds,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${payload}.${sign(secret, payload)}`, claims };
}

export function verifySessionToken(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): SessionClaims | null {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  if (!safeEqual(signature, sign(secret, payload))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.sid !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp * 1000 <= nowMs) return null;
    return claims;
  } catch {
    return null;
  }
}

export function csrfTokenFor(secret: string, sid: string): string {
  return sign(secret, `csrf:${sid}`);
}
