import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JiraClient } from "../../src/jira/client.js";
import { MOCK_FIELDS, generateDataset } from "../../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../../src/jira/mock/server.js";

let mock: MockJira | null = null;
afterEach(async () => {
  await mock?.close();
  mock = null;
});

const clientFor = (m: MockJira, extra: Record<string, unknown> = {}) =>
  new JiraClient({
    baseUrl: m.url,
    email: "bot@example.com",
    apiToken: "tok",
    fields: { ...MOCK_FIELDS },
    sleep: async () => {},
    ...extra,
  });

describe("DEF-15 data set", () => {
  it("has 5,000 issues with 12 changelog entries on average", () => {
    const ds = generateDataset();
    expect(ds.issues).toHaveLength(5000);
    const children = ds.issues.filter((i) => i.type !== "Epic");
    const avg = children.reduce((s, i) => s + i.histories.length, 0) / children.length;
    expect(avg).toBe(12);
  });

  it("is deterministic for a seed", () => {
    expect(generateDataset({ issues: 50, seed: 3 })).toEqual(
      generateDataset({ issues: 50, seed: 3 }),
    );
  });

  it("derives each issue's final state from its own history", () => {
    for (const issue of generateDataset({ issues: 200 }).issues.filter((i) => i.type !== "Epic")) {
      const statuses = issue.histories
        .flatMap((h) => h.items)
        .filter((i) => i.field === "status")
        .map((i) => i.toString);
      expect(issue.status).toBe(statuses[statuses.length - 1] ?? "To Do");
    }
  });

  it("contains mentions and emails in blocker comments so the sanitizer is exercised", () => {
    const text = JSON.stringify(generateDataset({ issues: 300 }).issues.flatMap((i) => i.comments));
    expect(text).toContain("[~accountid:");
    expect(text).toContain("@example.com");
  });
});

describe("mock Jira server", () => {
  it("serves all issues in pages of 100 through the real client", async () => {
    mock = await startMockJira({ dataset: generateDataset({ issues: 350 }) });
    const all = await clientFor(mock)
      .searchIssues({ jql: "project = DEMO", pageSize: 500 })
      .toArray();
    expect(all).toHaveLength(350);
    expect(mock.stats.searchBodies).toHaveLength(4);
    expect(all.filter((i) => i.type === "Epic")).toHaveLength(20);
  });

  it("returns the changelog in search, truncated at 100 entries with the real total", async () => {
    mock = await startMockJira({ dataset: generateDataset({ issues: 40, longChangelogCount: 2 }) });
    const all = await clientFor(mock)
      .searchIssues({ jql: "project = DEMO", changelog: true })
      .toArray();
    const long = all.find((i) => i.changelog?.total === 150);
    expect(long?.changelog?.histories).toHaveLength(100);
    const normal = all.find((i) => i.changelog?.total === 12);
    expect(normal?.changelog?.histories).toHaveLength(12);
  });

  it("filters by updated since for incremental sync", async () => {
    const ds = generateDataset({ issues: 100 });
    mock = await startMockJira({ dataset: ds });
    const sorted = [...ds.issues].map((i) => i.updated).sort();
    const cutoff = new Date(Date.parse((sorted[50] ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")));
    const stamp = cutoff.toISOString().slice(0, 16).replace("T", " ");
    const some = await clientFor(mock)
      .searchIssues({ jql: `project = DEMO AND updated >= "${stamp}"` })
      .toArray();
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(100);
  });

  it("applies latency to every request and tracks peak concurrency", async () => {
    mock = await startMockJira({ dataset: generateDataset({ issues: 30 }), latencyMs: 40 });
    const client = clientFor(mock);
    const started = Date.now();
    await Promise.all(
      [1, 2, 3].map(() => client.searchIssues({ jql: "project = DEMO" }).toArray()),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(mock.stats.peakConcurrent).toBe(3);
  });

  it("rejects wrong credentials with 401", async () => {
    mock = await startMockJira({
      dataset: generateDataset({ issues: 10 }),
      email: "bot@example.com",
      apiToken: "right",
    });
    await expect(
      clientFor(mock, { apiToken: "wrong" }).searchIssues({ jql: "project = DEMO" }).toArray(),
    ).rejects.toMatchObject({ code: "JIRA_AUTH_FAILED" });
  });

  it("injects failures and recovers through client retries", async () => {
    mock = await startMockJira({ dataset: generateDataset({ issues: 10 }) });
    mock.failNext(503, 2);
    const all = await clientFor(mock).searchIssues({ jql: "project = DEMO" }).toArray();
    expect(all).toHaveLength(10);
  });

  it("answers 404 for an unknown project, board and issue", async () => {
    mock = await startMockJira({ dataset: generateDataset({ issues: 10 }) });
    const res = await Promise.all([
      fetch(`${mock.url}/rest/api/3/project/NOPE`),
      fetch(`${mock.url}/rest/agile/1.0/board/99`),
      fetch(`${mock.url}/rest/api/3/issue/DEMO-9999/changelog`),
    ]);
    expect(res.map((r) => r.status)).toEqual([404, 404, 404]);
  });
});

describe("recorded fixtures cover every Jira call", () => {
  const dir = path.join(import.meta.dirname, "..", "fixtures", "jira");
  const calls: Array<[string, string, RequestInit?]> = [
    ["myself", "/rest/api/3/myself"],
    ["project", "/rest/api/3/project/DEMO"],
    ["field", "/rest/api/3/field"],
    ["status", "/rest/api/3/status"],
    ["board", "/rest/agile/1.0/board/1"],
    ["sprint-active", "/rest/agile/1.0/board/1/sprint?state=active"],
    ["sprint-issues", "/rest/agile/1.0/sprint/7/issue?fields=key&maxResults=100"],
    ["issue-changelog", "/rest/api/3/issue/DEMO-3/changelog?startAt=0&maxResults=100"],
    ["issue-comment", "/rest/api/3/issue/DEMO-3/comment?orderBy=-created&maxResults=1"],
    [
      "search",
      "/rest/api/3/search/jql",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jql: "project = DEMO",
          maxResults: 3,
          expand: "changelog",
          fields: [
            "summary",
            "issuetype",
            "status",
            "parent",
            "duedate",
            "created",
            "updated",
            MOCK_FIELDS.storyPoints,
            MOCK_FIELDS.flagged,
          ],
        }),
      },
    ],
  ];

  it("matches the committed fixtures (set UPDATE_FIXTURES=1 to refresh them)", async () => {
    mock = await startMockJira({ dataset: generateDataset({ issues: 12, epics: 2, seed: 7 }) });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, url, init] of calls) {
      const body = await (await fetch(`${mock.url}${url}`, init)).json();
      const file = path.join(dir, `${name}.json`);
      const text = `${JSON.stringify(body, null, 2)}\n`;
      if (process.env["UPDATE_FIXTURES"] === "1" || !fs.existsSync(file))
        fs.writeFileSync(file, text);
      expect(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), name).toBe(text);
    }
  });
});
