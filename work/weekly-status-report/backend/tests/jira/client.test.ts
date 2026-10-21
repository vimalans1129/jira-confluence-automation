import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JiraClient, JiraError, type JiraClientConfig } from "../../src/jira/client.js";

const BASE = "https://example.atlassian.net";
const TOKEN = "super-secret-token";
const anything = z.unknown();

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function rawIssue(n: number, over: Record<string, unknown> = {}) {
  return {
    id: String(1000 + n),
    key: `DEMO-${n}`,
    fields: {
      summary: `Issue ${n}`,
      issuetype: { name: "Story", subtask: false },
      status: { name: "In Progress", statusCategory: { name: "In Progress" } },
      parent: { key: "DEMO-100", fields: { issuetype: { name: "Epic" } } },
      customfield_10016: 5,
      customfield_10021: null,
      duedate: "2026-10-30",
      created: "2026-09-01T10:00:00.000+0000",
      resolutiondate: null,
      updated: "2026-10-10T10:00:00.000+0000",
      labels: ["a"],
      ...over,
    },
  };
}

function makeClient(
  fetchImpl: JiraClientConfig["fetch"],
  extra: Partial<JiraClientConfig> = {},
): { client: JiraClient; sleeps: number[] } {
  const sleeps: number[] = [];
  const client = new JiraClient({
    baseUrl: `${BASE}/`,
    email: "bot@example.com",
    apiToken: TOKEN,
    fields: { storyPoints: "customfield_10016", flagged: "customfield_10021", epicStart: null },
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { client, sleeps };
}

function sentBody(mock: ReturnType<typeof vi.fn>, call: number) {
  return JSON.parse((mock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);
}

describe("JiraClient requests", () => {
  it("sends Basic credentials from the server config and JSON headers", async () => {
    const fetchMock = vi.fn(async () => json({ issues: [], isLast: true }));
    const { client } = makeClient(fetchMock);
    await client.searchIssues({ jql: "project = DEMO" }).toArray();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/api/3/search/jql`);
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(
      `Basic ${Buffer.from(`bot@example.com:${TOKEN}`).toString("base64")}`,
    );
    expect(headers["accept"]).toBe("application/json");
  });

  it("pages through all results with the next page token", async () => {
    const pages = [
      json({ issues: [rawIssue(1), rawIssue(2)], nextPageToken: "t2" }),
      json({ issues: [rawIssue(3)], isLast: true }),
    ];
    const fetchMock = vi.fn(async () => pages.shift()!);
    const { client } = makeClient(fetchMock);
    const all = await client.searchIssues({ jql: "project = DEMO", pageSize: 2 }).toArray();
    expect(all.map((i) => i.key)).toEqual(["DEMO-1", "DEMO-2", "DEMO-3"]);
    expect(sentBody(fetchMock, 1).nextPageToken).toBe("t2");
    expect(sentBody(fetchMock, 0).maxResults).toBe(2);
    expect(sentBody(fetchMock, 0).fields).toEqual(
      expect.arrayContaining(["summary", "customfield_10016", "customfield_10021"]),
    );
  });

  it("maps fields to a normalized issue", async () => {
    const { client } = makeClient(async () =>
      json({
        issues: [
          rawIssue(1, { customfield_10021: [{ value: "Impediment" }] }),
          rawIssue(2, {
            parent: null,
            customfield_10016: null,
            issuetype: { name: "Sub-task", subtask: true },
          }),
        ],
        isLast: true,
      }),
    );
    const [a, b] = await client.searchIssues({ jql: "x" }).toArray();
    expect(a).toMatchObject({
      key: "DEMO-1",
      type: "Story",
      isSubtask: false,
      status: "In Progress",
      statusCategory: "In Progress",
      epicKey: "DEMO-100",
      points: 5,
      dueDate: "2026-10-30",
      flagged: true,
      labels: ["a"],
    });
    expect(a?.created.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(b).toMatchObject({ epicKey: null, points: null, isSubtask: true, flagged: false });
  });

  it("does not treat a non-Epic parent as an Epic", async () => {
    const { client } = makeClient(async () =>
      json({
        issues: [
          rawIssue(1, { parent: { key: "DEMO-5", fields: { issuetype: { name: "Story" } } } }),
        ],
        isLast: true,
      }),
    );
    const [a] = await client.searchIssues({ jql: "x" }).toArray();
    expect(a?.epicKey).toBeNull();
  });

  it("requests the changelog when asked", async () => {
    const fetchMock = vi.fn(async () => json({ issues: [], isLast: true }));
    const { client } = makeClient(fetchMock);
    await client.searchIssues({ jql: "x", changelog: true }).toArray();
    expect(sentBody(fetchMock, 0).expand).toBe("changelog");
  });
});

describe("error mapping (DEF-13)", () => {
  const cases: Array<[number, string, number]> = [
    [401, "JIRA_AUTH_FAILED", 502],
    [403, "JIRA_FORBIDDEN", 502],
    [404, "JIRA_NOT_FOUND", 502],
    [400, "JIRA_UNEXPECTED_RESPONSE", 502],
  ];
  it.each(cases)("maps Jira %i to %s (%i)", async (jiraStatus, code, status) => {
    const fetchMock = vi.fn(async () =>
      json({ errorMessages: [`secret ${TOKEN}`] }, { status: jiraStatus }),
    );
    const { client, sleeps } = makeClient(fetchMock);
    const err = await client.get("/rest/api/3/myself", anything).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JiraError);
    expect((err as JiraError).code).toBe(code);
    expect((err as JiraError).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("names the project or board for a 404", async () => {
    const { client } = makeClient(async () => json({}, { status: 404 }));
    const err = await client
      .get("/rest/api/3/project/NOPE", anything, { context: "project NOPE" })
      .catch((e: unknown) => e);
    expect((err as JiraError).message).toContain("project NOPE");
  });

  it("names the missing permission for a 403", async () => {
    const { client } = makeClient(async () => json({}, { status: 403 }));
    const err = await client
      .get("/rest/api/3/x", anything, { permission: "Browse Projects" })
      .catch((e: unknown) => e);
    expect((err as JiraError).message).toContain("Browse Projects");
  });

  it("reports the field that failed validation, not the payload", async () => {
    const { client } = makeClient(async () =>
      json({ issues: [{ id: "1", key: "DEMO-1", fields: { summary: 42 } }], isLast: true }),
    );
    const err = await client
      .searchIssues({ jql: "x" })
      .toArray()
      .catch((e: unknown) => e);
    expect((err as JiraError).code).toBe("JIRA_UNEXPECTED_RESPONSE");
    expect((err as JiraError).status).toBe(502);
    expect((err as JiraError).message).toContain("summary");
    expect((err as JiraError).message).not.toContain("42");
  });

  it("treats a non-JSON body as an unexpected response", async () => {
    const { client } = makeClient(async () => new Response("<html>", { status: 200 }));
    const err = await client.get("/rest/api/3/myself", anything).catch((e: unknown) => e);
    expect((err as JiraError).code).toBe("JIRA_UNEXPECTED_RESPONSE");
  });
});

describe("retries (FR-005)", () => {
  it("retries 5xx with exponential backoff, then fails with JIRA_UNAVAILABLE after 5 attempts", async () => {
    const fetchMock = vi.fn(async () => json({}, { status: 503 }));
    const { client, sleeps } = makeClient(fetchMock);
    const err = await client.get("/rest/api/3/myself", anything).catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect((err as JiraError).code).toBe("JIRA_UNAVAILABLE");
    expect((err as JiraError).status).toBe(503);
  });

  it("caps the backoff at 30 seconds", async () => {
    const fetchMock = vi.fn(async () => json({}, { status: 500 }));
    const { client, sleeps } = makeClient(fetchMock, { maxAttempts: 9 });
    await client.get("/rest/api/3/myself", anything).catch(() => undefined);
    expect(Math.max(...sleeps)).toBe(30_000);
  });

  it("honors Retry-After on 429 and ends with JIRA_RATE_LIMITED (503)", async () => {
    const fetchMock = vi.fn(async () => json({}, { status: 429, headers: { "retry-after": "7" } }));
    const { client, sleeps } = makeClient(fetchMock);
    const err = await client.get("/rest/api/3/myself", anything).catch((e: unknown) => e);
    expect(sleeps).toEqual([7000, 7000, 7000, 7000]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((err as JiraError).code).toBe("JIRA_RATE_LIMITED");
    expect((err as JiraError).status).toBe(503);
  });

  it("never waits longer than 30 seconds for Retry-After", async () => {
    const fetchMock = vi.fn(async () =>
      json({}, { status: 429, headers: { "retry-after": "600" } }),
    );
    const { client, sleeps } = makeClient(fetchMock);
    await client.get("/rest/api/3/myself", anything).catch(() => undefined);
    expect(Math.max(...sleeps)).toBe(30_000);
  });

  it("recovers when a retry succeeds", async () => {
    const responses = [json({}, { status: 502 }), json({}, { status: 429 }), json({ ok: true })];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const { client, sleeps } = makeClient(fetchMock);
    expect(await client.get("/rest/api/3/myself", anything)).toEqual({ ok: true });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("retries network failures and then reports JIRA_UNAVAILABLE", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${TOKEN}`);
    });
    const { client } = makeClient(fetchMock);
    const err = await client.get("/rest/api/3/myself", anything).catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((err as JiraError).code).toBe("JIRA_UNAVAILABLE");
    expect((err as JiraError).message).not.toContain(TOKEN);
  });
});
