export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface SessionInfo {
  csrfToken: string;
  expiresAt: string;
}

const BASE = "/api/v1";
let csrfToken: string | null = null;
let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      res.status,
      body.error?.code ?? "HTTP_ERROR",
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new ApiError(res.status, "HTTP_ERROR", res.statusText || "Request failed");
  }
}

// Every API call goes through here so the CSRF token and 401 handling live in one place.
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { redirectOn401?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "The server could not be reached");
  }

  if (res.status === 401 && options.redirectOn401 !== false) {
    csrfToken = null;
    onUnauthorized();
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(password: string): Promise<SessionInfo> {
  const session = await apiRequest<SessionInfo>(
    "POST",
    "/auth/login",
    { password },
    { redirectOn401: false },
  );
  csrfToken = session.csrfToken;
  return session;
}

export async function getSession(): Promise<SessionInfo> {
  const session = await apiRequest<SessionInfo>("GET", "/auth/session", undefined, {
    redirectOn401: false,
  });
  csrfToken = session.csrfToken;
  return session;
}

export async function logout(): Promise<void> {
  try {
    await apiRequest<void>("POST", "/auth/logout", undefined, { redirectOn401: false });
  } finally {
    csrfToken = null;
  }
}
