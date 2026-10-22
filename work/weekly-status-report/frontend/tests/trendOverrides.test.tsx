import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleReport } from "@contract/sampleReport";
import type { Report } from "@contract";
import type { JobView } from "../src/api/reports";
import { setCsrfToken } from "../src/api/client";
import { ReportsArea } from "../src/pages/ReportsArea";
import { previousWeek } from "../src/pages/OverridesPage";

const job: JobView = {
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
};

const epic = sampleReport.epics.find((e) => e.epicKey !== null)!;
const trendWeeks = [
  { weekStart: "2026-10-05", overallRag: "Red", percentComplete: 20, blockerCount: 2, epics: [] },
  {
    weekStart: "2026-10-12",
    overallRag: "Amber",
    percentComplete: 35.5,
    blockerCount: 1,
    epics: [],
  },
];

interface Api {
  report: Report;
  overrides: Record<string, unknown[]>;
  calls: { method: string; url: string; body: unknown }[];
}

function mockApi(initial: Partial<Api> = {}): Api {
  const api: Api = { report: sampleReport, overrides: {}, calls: [], ...initial };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      api.calls.push({ method, url, body });
      const reply = (status: number, data: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(data), {
            status,
            headers: { "content-type": "application/json" },
          }),
        );
      if (url.endsWith("/reports/latest")) return reply(200, { job });
      if (url.endsWith("/reports/1/data")) return reply(200, api.report);
      if (url.includes("/snapshots")) return reply(200, { weeks: trendWeeks });
      if (url.includes("/overrides") && method === "GET") {
        const week = /weekStart=([\d-]+)/.exec(url)![1]!;
        return reply(200, { weekStart: week, overrides: api.overrides[week] ?? [] });
      }
      if (url.includes("/overrides") && method === "POST") {
        api.overrides[body.weekStart] = [
          ...(api.overrides[body.weekStart] ?? []),
          { epicKey: null, ...body },
        ];
        return reply(201, { override: body, change: "created", warnings: [] });
      }
      if (url.includes("/overrides") && method === "DELETE") {
        api.overrides["2026-10-12"] = [];
        return reply(200, { warnings: [] });
      }
      return reply(404, { error: { code: "NOT_FOUND" } });
    }),
  );
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe("trend chart", () => {
  it("has a text alternative and a data table, and lets the user choose 4 to 12 weeks", async () => {
    const api = mockApi();
    const { container } = render(<ReportsArea />);
    const chart = await screen.findByRole("img", {
      name: /Overall percent complete and status by week/,
    });
    expect(chart).toHaveAccessibleName(/2026-10-05 20%, Red; 2026-10-12 35.5%, Amber/);
    const table = screen.getByRole("table", { name: "Trend data" });
    expect(within(table).getByText("35.5%")).toBeInTheDocument();
    expect(api.calls.some((c) => c.url.includes("weeks=6&to=2026-10-12"))).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText("Number of weeks"), "12");
    await waitFor(() => expect(api.calls.some((c) => c.url.includes("weeks=12"))).toBe(true));
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("overrides", () => {
  const overridden: Report = {
    ...sampleReport,
    epics: sampleReport.epics.map((e) =>
      e.epicKey === epic.epicKey
        ? {
            ...e,
            rag: {
              ...e.rag,
              calculated: "Green",
              effective: "Red",
              overridden: true,
              overrideReason: "Vendor slip",
            },
          }
        : e,
    ),
    overrides: [{ scope: "epic", epicKey: epic.epicKey, rag: "Red", reason: "Vendor slip" }],
  };

  it("shows the overridden status, its reason and the calculated RAG on dashboard and report", async () => {
    mockApi({ report: overridden });
    render(<ReportsArea />);
    expect(
      await screen.findByText(/Overridden \(calculated Green\): Vendor slip/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    const section = screen.getByRole("region", { name: "Status overrides" });
    expect(within(section).getByText(/calculated Green/)).toBeInTheDocument();
    expect(within(section).getByText(/Vendor slip/)).toBeInTheDocument();
  });

  it("requires a reason before saving", async () => {
    const api = mockApi();
    render(<ReportsArea />);
    await userEvent.click(await screen.findByRole("button", { name: "Overrides" }));
    await userEvent.click(screen.getByRole("button", { name: "Save override" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a reason");
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("saves an override for the report week and reloads the report", async () => {
    const api = mockApi();
    render(<ReportsArea />);
    await userEvent.click(await screen.findByRole("button", { name: "Overrides" }));
    await userEvent.selectOptions(screen.getByLabelText("Status"), "Red");
    await userEvent.type(screen.getByLabelText(/Reason/), "Vendor slip");
    await userEvent.click(screen.getByRole("button", { name: "Save override" }));
    expect(await screen.findByText("Override saved.")).toBeInTheDocument();
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({
      weekStart: "2026-10-12",
      scope: "overall",
      rag: "Red",
      reason: "Vendor slip",
    });
    expect(
      await screen.findByRole("button", { name: /Remove override for Overall status/ }),
    ).toBeInTheDocument();
    expect(api.calls.filter((c) => c.url.endsWith("/reports/latest")).length).toBeGreaterThan(1);
  });

  it("offers last week's overrides for confirmation and removes overrides", async () => {
    const api = mockApi({
      overrides: {
        "2026-10-05": [
          {
            weekStart: "2026-10-05",
            scope: "overall",
            epicKey: null,
            rag: "Amber",
            reason: "Carry",
          },
        ],
      },
    });
    const { container } = render(<ReportsArea />);
    await userEvent.click(await screen.findByRole("button", { name: "Overrides" }));
    const apply = await screen.findByRole("button", { name: "Apply Overall status to this week" });
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    await userEvent.click(apply);
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      weekStart: "2026-10-12",
      reason: "Carry",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: /Remove override for Overall status/ }),
    );
    expect(await screen.findByText("Override removed.")).toBeInTheDocument();
  });

  it("computes the previous week", () => {
    expect(previousWeek("2026-10-12")).toBe("2026-10-05");
    expect(previousWeek("2026-01-05")).toBe("2025-12-29");
  });
});
