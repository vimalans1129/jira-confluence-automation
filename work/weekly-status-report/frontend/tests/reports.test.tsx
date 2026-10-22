import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, vi } from "vitest";
import type { JobView } from "../src/api/reports";
import { setCsrfToken } from "../src/api/client";
import { ReportsArea } from "../src/pages/ReportsArea";
import { validateGenerateForm } from "../src/lib/validation";
import { sampleReport } from "@contract/sampleReport";

const job = (over: Partial<JobView> = {}): JobView => ({
  id: 1,
  weekStart: "2026-10-12",
  timeZone: "Europe/London",
  dryRun: false,
  status: "succeeded",
  stage: null,
  error: null,
  warnings: [],
  queuedAt: "2026-10-19T08:00:00.000Z",
  startedAt: "2026-10-19T08:00:01.000Z",
  finishedAt: "2026-10-19T08:00:05.000Z",
  hasDeck: true,
  deckStale: false,
  ...over,
});

type Route = (method: string, url: string) => { status: number; body?: unknown } | undefined;

function mockApi(route: Route) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, body: init.body ? JSON.parse(init.body as string) : undefined });
      const hit = route(method, url) ?? { status: 404, body: { error: { code: "NOT_FOUND" } } };
      return Promise.resolve(
        new Response(JSON.stringify(hit.body ?? {}), {
          status: hit.status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

const ready =
  (j: JobView = job()): Route =>
  (method, url) => {
    if (url.endsWith("/reports/latest")) return { status: 200, body: { job: j } };
    if (url.endsWith(`/reports/${j.id}/data`)) return { status: 200, body: sampleReport };
    if (url.includes("/snapshots")) return { status: 200, body: { weeks: [] } };
    return undefined;
  };

async function accessibilityViolations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe("dashboard states", () => {
  it("shows a loading state, then the empty state", async () => {
    mockApi((_m, url) =>
      url.endsWith("/latest") ? { status: 200, body: { job: null } } : undefined,
    );
    render(<ReportsArea />);
    expect(screen.getByText(/Loading the latest report/)).toBeInTheDocument();
    expect(await screen.findByText(/No report has been generated yet/)).toBeInTheDocument();
  });

  it("shows an error and lets the user retry", async () => {
    let fail = true;
    mockApi((m, url) => {
      if (fail)
        return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Boom" } } };
      return ready()(m, url);
    });
    render(<ReportsArea />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Overall status")).toBeInTheDocument();
  });

  it("shows overall RAG as text with reasons, and milestone progress", async () => {
    mockApi(ready());
    render(<ReportsArea />);
    const overall = await screen.findByRole("region", { name: "Overall status" });
    expect(within(overall).getByText("Amber")).toBeInTheDocument();
    expect(within(overall).getByText("1 open blocker")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Data migration")).toBeInTheDocument();
    expect(within(table).getAllByText("Amber").length).toBeGreaterThan(0);
    expect(within(table).getByText("No due date")).toBeInTheDocument();
  });

  it("tells the user when the data is past retention", async () => {
    mockApi((m, url) =>
      url.endsWith("/data")
        ? { status: 410, body: { error: { code: "REPORT_PRUNED", message: "gone" } } }
        : ready()(m, url),
    );
    render(<ReportsArea />);
    expect(await screen.findByText(/past the retention period/)).toBeInTheDocument();
  });
});

describe("report page", () => {
  it("lists completed, planned and risks with the no-mitigation marker", async () => {
    mockApi(ready());
    render(<ReportsArea />);
    await userEvent.click(await screen.findByRole("button", { name: "Report" }));
    expect(screen.getByText("Migrate orders table", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Validate row counts", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("No mitigation recorded")).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no automated violations on the dashboard or the report page", async () => {
    mockApi(ready());
    const { container } = render(<ReportsArea />);
    await screen.findByText("Overall status");
    expect(await accessibilityViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it("has no violations in the empty and error states, and with form errors", async () => {
    mockApi(() => ({ status: 500, body: { error: { code: "X", message: "Boom" } } }));
    const { container } = render(<ReportsArea />);
    await screen.findByRole("button", { name: "Try again" });
    await userEvent.type(screen.getByLabelText(/Time zone/), "Nowhere/Land");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByText(/valid time zone/);
    expect(await accessibilityViolations(container)).toEqual([]);
  });
});

describe("generate form", () => {
  it("validates on the client before calling the server", async () => {
    const calls = mockApi(ready());
    render(<ReportsArea />);
    await screen.findByText("Overall status");
    await userEvent.type(screen.getByLabelText(/Time zone/), "Nowhere/Land");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("valid time zone");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("rejects impossible and future dates", () => {
    const today = new Date("2026-10-21T00:00:00Z");
    const base = { timeZone: "", dryRun: false };
    expect(
      validateGenerateForm({ ...base, weekStart: "2026-02-30" }, today).weekStart,
    ).toBeDefined();
    expect(
      validateGenerateForm({ ...base, weekStart: "2027-01-04" }, today).weekStart,
    ).toBeDefined();
    expect(validateGenerateForm({ ...base, weekStart: "2026-10-12" }, today)).toEqual({});
    expect(
      validateGenerateForm({ weekStart: "", timeZone: "Europe/London", dryRun: true }),
    ).toEqual({});
  });

  it("starts a job, shows progress and then the finished report with warnings and a download", async () => {
    let polls = 0;
    const calls = mockApi((m, url) => {
      if (url.endsWith("/reports/latest")) return { status: 200, body: { job: null } };
      if (m === "POST" && url.endsWith("/reports")) {
        return { status: 202, body: job({ status: "queued", hasDeck: false, finishedAt: null }) };
      }
      if (url.endsWith("/reports/1")) {
        polls += 1;
        return {
          status: 200,
          body:
            polls < 2
              ? job({ status: "running", stage: "syncing Jira", hasDeck: false })
              : job({ warnings: [{ code: "NO_ACTIVE_SPRINT", message: "No active sprint" }] }),
        };
      }
      if (url.endsWith("/reports/1/data")) return { status: 200, body: sampleReport };
      return undefined;
    });
    render(<ReportsArea />);
    await screen.findByText(/No report has been generated yet/);
    await userEvent.type(screen.getByLabelText(/Week/), "2026-10-14");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      weekStart: "2026-10-14",
      dryRun: false,
    });
    expect(
      await screen.findByText(/syncing Jira/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/is ready/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/No active sprint/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Overall status")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Download deck" })).toBeInTheDocument();
  });

  it("offers no deck for a dry run", async () => {
    mockApi(ready(job({ dryRun: true, hasDeck: false })));
    render(<ReportsArea />);
    expect(await screen.findByText(/\(dry run\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download deck" })).not.toBeInTheDocument();
    expect(screen.getByText("Overall status")).toBeInTheDocument();
  });

  it("shows a failed job's error", async () => {
    mockApi(
      ready(
        job({
          status: "failed",
          hasDeck: false,
          error: { code: "JIRA_UNREACHABLE", message: "Jira could not be reached" },
        }),
      ),
    );
    render(<ReportsArea />);
    expect(await screen.findByText(/Jira could not be reached/)).toBeInTheDocument();
  });

  it("downloads the deck under the server-provided file name", async () => {
    const created: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      created.push(this);
    });
    URL.createObjectURL = vi.fn(() => "blob:deck");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/deck")) {
          return Promise.resolve(
            new Response("PK", {
              status: 200,
              headers: {
                "content-disposition": 'attachment; filename="Weekly_Status_DEMO_2026-10-12.pptx"',
              },
            }),
          );
        }
        const hit = ready()("GET", url) ?? { status: 404 };
        return Promise.resolve(
          new Response(JSON.stringify(hit.body ?? {}), { status: hit.status }),
        );
      }),
    );
    render(<ReportsArea />);
    await userEvent.click(await screen.findByRole("button", { name: "Download deck" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.download).toBe("Weekly_Status_DEMO_2026-10-12.pptx");
    click.mockRestore();
  });
});
