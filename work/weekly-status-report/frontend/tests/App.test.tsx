import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { App } from "../src/App";
import { apiRequest, setCsrfToken } from "../src/api/client";

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };

function mockFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const { status, body } = handler(url, init);
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

const session = { csrfToken: "csrf-1", expiresAt: "2030-01-01T00:00:00.000Z" };
const unauthorized = {
  status: 401,
  body: { error: { code: "UNAUTHENTICATED", message: "Sign in is required" } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe("login", () => {
  it("shows the login form when there is no session", async () => {
    mockFetch(() => unauthorized);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("validates an empty password without calling the server", async () => {
    const calls = mockFetch(() => unauthorized);
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the password");
    expect(calls.some((c) => c.url.endsWith("/auth/login"))).toBe(false);
  });

  it("signs in with the keyboard and shows the app", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/login") ? { status: 200, body: session } : unauthorized,
    );
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Password"), "secret{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Weekly Status Report" }),
    ).toBeInTheDocument();
  });

  it("shows an error and re-enables the form on a wrong password", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/login")
        ? { status: 401, body: { error: { code: "INVALID_CREDENTIALS", message: "x" } } }
        : unauthorized,
    );
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The password is incorrect.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("shows a generic error when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.endsWith("/auth/login")
          ? Promise.reject(new TypeError("down"))
          : Promise.resolve(new Response(JSON.stringify(unauthorized.body), { status: 401 })),
      ),
    );
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in failed");
  });

  it("disables the button while signing in", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.endsWith("/auth/login")
          ? new Promise<Response>((resolve) => (release = resolve))
          : Promise.resolve(new Response(JSON.stringify(unauthorized.body), { status: 401 })),
      ),
    );
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
    release(new Response(JSON.stringify(session), { status: 200 }));
    await screen.findByRole("heading", { name: "Weekly Status Report" });
  });
});

describe("session and API client", () => {
  it("restores an existing session", async () => {
    mockFetch(() => ({ status: 200, body: session }));
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Weekly Status Report" }),
    ).toBeInTheDocument();
  });

  it("attaches the CSRF token to state-changing requests only", async () => {
    const calls = mockFetch(() => ({ status: 200, body: session }));
    render(<App />);
    await screen.findByRole("heading", { name: "Weekly Status Report" });
    await apiRequest("GET", "/reports");
    await apiRequest("POST", "/reports", { a: 1 });
    const get = calls.find((c) => c.url.endsWith("/reports") && c.init.method === "GET");
    const post = calls.find((c) => c.url.endsWith("/reports") && c.init.method === "POST");
    expect((get?.init.headers as Record<string, string>)["x-csrf-token"]).toBeUndefined();
    expect((post?.init.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-1");
  });

  it("returns to the login page when any call answers 401", async () => {
    mockFetch((url) => (url.endsWith("/reports") ? unauthorized : { status: 200, body: session }));
    render(<App />);
    await screen.findByRole("heading", { name: "Weekly Status Report" });
    await expect(apiRequest("GET", "/reports")).rejects.toMatchObject({ status: 401 });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("signs out and returns to the login page", async () => {
    mockFetch((url) => ({ status: url.endsWith("/auth/logout") ? 204 : 200, body: session }));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible());
  });
});
