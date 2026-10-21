export interface AuthConfig {
  passwordHash: string;
  sessionSecret: string;
  sessionLifetimeSeconds: number;
  secureCookies: boolean;
  trustProxy: number;
  loginMaxFailures: number;
}

export const SESSION_COOKIE = "wsr_session";
export const CSRF_HEADER = "x-csrf-token";
