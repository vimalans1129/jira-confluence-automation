import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { JiraClient } from "../../src/jira/client.js";
import { fetchStatusCategories } from "../../src/jira/enrich.js";
import { MOCK_FIELDS, generateDataset, type MockDataset } from "../../src/jira/mock/dataset.js";
import { startMockJira, type MockJira } from "../../src/jira/mock/server.js";
import {
  MAX_CONCURRENT_REQUESTS,
  mapLimit,
  syncProject,
  type CachedHistory,
  type HistoryStore,
  type SyncCommit,
} from "../../src/jira/sync.js";
import { createHistoryRepository } from "../../src/repositories/historyRepository.js";

class MemoryStore implements HistoryStore {
  cache = new Map<string, CachedHistory>();
  marker: Date | null = null;
  commits = 0;
  async lastSuccessAt() {
    return this.marker;
  }
  async loadAll() {
    return new Map(this.cache);
  }
  async commit(change: SyncCommit) {
    for (const [k, v] of change.upserts) this.cache.set(k, v);
    for (const k of [...this.cache.keys()]) if (!change.liveKeys.has(k)) this.cache.delete(k);
    this.marker = change.startedAt;
    this.commits++;
  }
}

let mock: MockJira | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const T1 = new Date("2026-10-21T09:00:00Z");
const T2 = new Date("2026-10-22T12:00:00Z");

async function setup(
  dataset: MockDataset,
  extra: { latencyMs?: number; maxAttempts?: number } = {},
) {
  mock = await startMockJira({ dataset, latencyMs: extra.latencyMs });
  const client = new JiraClient({
    baseUrl: mock.url,
    email: "a@example.com",
    apiToken: "token",
    fields: { ...MOCK_FIELDS },
    maxAttempts: extra.maxAttempts,
    sleep: async () => {},
  });
  const statusCategories = await fetchStatusCategories(client);
  const run = (store: HistoryStore, now: Date, full = false) =>
    syncProject({
      client,
      store,
      projectKey: dataset.projectKey,
      statusCategories,
      fields: MOCK_FIELDS,
      now,
      full,
    });
  return { run };
}

describe("mapLimit", () => {
  it("never runs more than the limit at once and keeps result order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([...Array(20).keys()], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return n * 2;
    });
    expect(peak).toBe(3);
    expect(out).toEqual([...Array(20).keys()].map((n) => n * 2));
  });
});

describe("incremental sync", () => {
  it("builds every history on the first run and reuses them on the second", async () => {
    const dataset = generateDataset({ issues: 60, seed: 11 });
    const { run } = await setup(dataset);
    const store = new MemoryStore();

    const first = await run(store, T1);
    expect(first.stats).toMatchObject({ total: 60, refreshed: 60, reused: 0, deleted: 0 });
    expect(store.marker).toEqual(T1);

    const second = await run(store, T2);
    expect(second.stats).toMatchObject({ refreshed: 0, reused: 60 });
    const changedQuery = mock!.stats.searchBodies.filter((b) => b.expand === "changelog").at(-1);
    expect(changedQuery?.jql).toContain('updated >= "2026-10-21 08:55"');
  });

  it("refreshes only issues updated since the marker minus five minutes", async () => {
    const dataset = generateDataset({ issues: 60, seed: 11 });
    const { run } = await setup(dataset);
    const store = new MemoryStore();
    await run(store, T1);

    const target = dataset.issues.find((i) => i.type === "Story")!;
    target.histories.push({
      id: "9001",
      created: "2026-10-22T09:00:00.000+0000",
      items: [
        {
          field: "Flagged",
          fieldId: MOCK_FIELDS.flagged,
          from: null,
          to: "10019",
          fromString: "",
          toString: "Impediment",
        },
      ],
    });
    target.updated = "2026-10-22T09:00:00.000+0000";

    const result = await run(store, T2);
    expect(result.stats.refreshed).toBe(1);
    expect(result.histories.get(target.key)?.flagEvents.at(-1)?.flagged).toBe(true);
  });

  it("does not advance the marker or change the cache when a sync fails", async () => {
    const dataset = generateDataset({ issues: 40, seed: 4 });
    const { run } = await setup(dataset, { maxAttempts: 1 });
    const store = new MemoryStore();
    await run(store, T1);
    const before = new Map(store.cache);

    mock!.failNext(500, 100);
    await expect(run(store, T2)).rejects.toMatchObject({ code: "JIRA_UNAVAILABLE" });
    expect(store.marker).toEqual(T1);
    expect(store.commits).toBe(1);
    expect(store.cache).toEqual(before);
  });

  it("removes deleted issues by key reconciliation", async () => {
    const dataset = generateDataset({ issues: 40, seed: 4 });
    const { run } = await setup(dataset);
    const store = new MemoryStore();
    await run(store, T1);
    const victim = dataset.issues.find((i) => i.type === "Story")!.key;
    mock!.removeIssue(victim);

    const result = await run(store, T2);
    expect(result.stats.deleted).toBe(1);
    expect(store.cache.has(victim)).toBe(false);
    expect(result.issues.some((i) => i.key === victim)).toBe(false);
  });

  it("rebuilds everything when a full sync is requested", async () => {
    const dataset = generateDataset({ issues: 40, seed: 4 });
    const { run } = await setup(dataset);
    const store = new MemoryStore();
    await run(store, T1);
    const full = await run(store, T2, true);
    expect(full.stats.refreshed).toBe(40);
  });

  it("never exceeds 5 concurrent requests while completing long changelogs", async () => {
    const dataset = generateDataset({ issues: 80, longChangelogCount: 30, seed: 6 });
    const { run } = await setup(dataset, { latencyMs: 5 });
    await run(new MemoryStore(), T1);
    expect(mock!.stats.peakConcurrent).toBeGreaterThan(1);
    expect(mock!.stats.peakConcurrent).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!url)("history repository", () => {
  const repo = createHistoryRepository(pool!);
  beforeEach(async () => {
    await pool!.query("DELETE FROM issue_history");
    await pool!.query("DELETE FROM sync_state");
  });

  it("persists derived history and the marker, and deletes keys that are gone", async () => {
    const dataset = generateDataset({ issues: 40, seed: 4 });
    const { run } = await setup(dataset);
    const first = await run(repo, T1);
    expect(await repo.lastSuccessAt(dataset.projectKey)).toEqual(T1);

    const stored = await repo.loadAll();
    expect(stored.size).toBe(40);
    const key = dataset.issues.find((i) => i.type === "Story")!.key;
    expect(stored.get(key)?.history).toEqual(first.histories.get(key));
    const { rows } = await pool!.query("SELECT history::text AS h FROM issue_history");
    expect(rows.map((r: { h: string }) => r.h).join("")).not.toMatch(/author|displayName/i);

    mock!.removeIssue(key);
    const second = await run(repo, T2);
    expect(second.stats.deleted).toBe(1);
    expect((await repo.loadAll()).has(key)).toBe(false);
    expect(await repo.lastSuccessAt(dataset.projectKey)).toEqual(T2);
  });
});
