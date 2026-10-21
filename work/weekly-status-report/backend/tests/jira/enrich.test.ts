import { afterEach, describe, expect, it } from "vitest";
import { JiraClient } from "../../src/jira/client.js";
import {
  adfToText,
  completeChangelog,
  deriveHistory,
  fetchActiveSprint,
  fetchLatestComment,
  fetchStatusCategories,
} from "../../src/jira/enrich.js";
import { MOCK_FIELDS, adf, generateDataset } from "../../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../../src/jira/mock/server.js";

let mock: MockJira | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function setup(options: Parameters<typeof startMockJira>[0] extends infer O ? O : never) {
  mock = await startMockJira(options);
  return new JiraClient({
    baseUrl: mock.url,
    email: "a@example.com",
    apiToken: "token",
    fields: { ...MOCK_FIELDS },
    sleep: async () => {},
  });
}

describe("completeChangelog", () => {
  it("pages through the changelog endpoint when the search copy is truncated", async () => {
    const client = await setup({
      dataset: generateDataset({ issues: 40, longChangelogCount: 2, seed: 3 }),
    });
    const issues = await client.searchIssues({ jql: "project = DEMO", changelog: true }).toArray();
    const long = issues.find(
      (i) => i.changelog && i.changelog.total !== undefined && i.changelog.total > 100,
    );
    expect(long).toBeDefined();
    expect(long!.changelog!.histories.length).toBeLessThan(long!.changelog!.total!);

    const full = await completeChangelog(client, long!);
    expect(full).toHaveLength(long!.changelog!.total!);
  });

  it("makes no extra request when the changelog is already complete", async () => {
    const client = await setup({ dataset: generateDataset({ issues: 30, seed: 3 }) });
    const [issue] = await client.searchIssues({ jql: "project = DEMO", changelog: true }).toArray();
    const before = mock!.stats.requests;
    const histories = await completeChangelog(client, issue!);
    expect(histories).toHaveLength(issue!.changelog!.histories.length);
    expect(mock!.stats.requests).toBe(before);
  });
});

describe("adfToText", () => {
  it("flattens paragraphs, lists, mentions and breaks", () => {
    const text = adfToText({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            { type: "mention", attrs: { text: "@Jane" } },
            { type: "hardBreak" },
            { type: "text", text: "today" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
            },
          ],
        },
      ],
    });
    expect(text).toBe("First\nAsk @Jane\ntoday\na");
  });

  it("handles strings, nulls and unknown nodes", () => {
    expect(adfToText(" plain ")).toBe("plain");
    expect(adfToText(null)).toBe("");
    expect(adfToText({ type: "doc", content: [{ type: "mystery" }] })).toBe("");
  });
});

describe("fetchLatestComment", () => {
  it("returns the newest comment as plain text", async () => {
    const dataset = generateDataset({ issues: 40, seed: 5 });
    const client = await setup({ dataset });
    const withComment = dataset.issues.find((i) => i.comments.length > 0)!;
    withComment.comments.push({
      id: "999",
      created: "2025-01-01T00:00:00.000+0000",
      body: adf("Newest note"),
    });
    await expect(fetchLatestComment(client, withComment.key)).resolves.toBe("Newest note");
  });

  it("returns null when there are no comments", async () => {
    const dataset = generateDataset({ issues: 40, seed: 5 });
    const client = await setup({ dataset });
    const none = dataset.issues.find((i) => i.comments.length === 0)!;
    await expect(fetchLatestComment(client, none.key)).resolves.toBeNull();
  });
});

describe("fetchActiveSprint", () => {
  it("reads the active sprint and its issue keys", async () => {
    const dataset = generateDataset({ issues: 30, seed: 2 });
    const client = await setup({ dataset });
    const sprint = await fetchActiveSprint(client, dataset.boardId);
    expect(sprint?.name).toBe("Sprint 7");
    const expected = dataset.issues.filter((i) => i.inActiveSprint).map((i) => i.key);
    expect([...sprint!.issueKeys].sort()).toEqual(expected.sort());
  });

  it("returns null when the board has no active sprint", async () => {
    const dataset = generateDataset({ issues: 30 });
    const client = await setup({ dataset, activeSprint: false });
    await expect(fetchActiveSprint(client, dataset.boardId)).resolves.toBeNull();
  });
});

describe("status categories and derived history", () => {
  it("derives transitions, flag events and point changes without author data", async () => {
    const dataset = generateDataset({ issues: 60, seed: 9 });
    const client = await setup({ dataset });
    const categories = await fetchStatusCategories(client);
    expect(categories.get("Blocked")).toBeDefined();
    expect(categories.get("Done")).toBe("Done");

    const all = dataset.issues.flatMap((i) => i.histories);
    const derived = deriveHistory(all, categories, MOCK_FIELDS);
    const statusItems = all.flatMap((h) => h.items).filter((i) => i.field === "status");
    expect(derived.transitions).toHaveLength(statusItems.length);
    expect(derived.transitions.every((t) => t.toCategory === categories.get(t.to))).toBe(true);
    expect(derived.flagEvents.length).toBeGreaterThan(0);
    expect(derived.pointChanges.length).toBeGreaterThan(0);
    expect(JSON.stringify(derived)).not.toMatch(/author|displayName|accountId/i);
  });

  it("treats a cleared Flagged value as unflagged and unknown statuses as In Progress", () => {
    const derived = deriveHistory(
      [
        {
          created: "2025-03-03T10:00:00.000+0000",
          items: [
            {
              field: "Flagged",
              fieldId: MOCK_FIELDS.flagged,
              toString: "",
              fromString: "Impediment",
            },
            { field: "status", fromString: "Mystery", toString: "Done" },
          ],
        },
      ],
      new Map([["Done", "Done"]]),
      MOCK_FIELDS,
    );
    expect(derived.flagEvents).toEqual([
      { at: new Date("2025-03-03T10:00:00.000Z"), flagged: false },
    ]);
    expect(derived.transitions[0]).toMatchObject({
      fromCategory: "In Progress",
      toCategory: "Done",
    });
  });
});
