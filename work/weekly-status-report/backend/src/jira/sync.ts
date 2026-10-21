import type { StatusCategory } from "../contract/index.js";
import type { JiraClient, JiraIssue } from "./client.js";
import {
  completeChangelog,
  deriveHistory,
  fetchChangelog,
  type DerivedHistory,
  type HistoryFieldIds,
} from "./enrich.js";

export const MAX_CONCURRENT_REQUESTS = 5;
export const SYNC_OVERLAP_MS = 5 * 60_000;

export interface CachedHistory {
  jiraUpdated: Date;
  history: DerivedHistory;
}

export interface SyncCommit {
  projectKey: string;
  upserts: Map<string, CachedHistory>;
  // Every key currently in Jira; cached keys outside this set are deleted.
  liveKeys: Set<string>;
  startedAt: Date;
}

export interface HistoryStore {
  lastSuccessAt(projectKey: string): Promise<Date | null>;
  loadAll(): Promise<Map<string, CachedHistory>>;
  // Applies upserts, deletions and the new marker as one unit.
  commit(change: SyncCommit): Promise<void>;
}

export interface SyncOptions {
  client: JiraClient;
  store: HistoryStore;
  projectKey: string;
  statusCategories: ReadonlyMap<string, StatusCategory>;
  fields: HistoryFieldIds;
  now?: Date;
  concurrency?: number;
  // Ignores the marker and rebuilds every history.
  full?: boolean;
}

export interface SyncResult {
  issues: JiraIssue[];
  histories: Map<string, DerivedHistory>;
  stats: { total: number; refreshed: number; reused: number; deleted: number };
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function jqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export async function syncProject(options: SyncOptions): Promise<SyncResult> {
  const { client, store, projectKey } = options;
  const startedAt = options.now ?? new Date();
  const concurrency = Math.min(
    options.concurrency ?? MAX_CONCURRENT_REQUESTS,
    MAX_CONCURRENT_REQUESTS,
  );
  const project = `project = ${JSON.stringify(projectKey)}`;

  const cache = await store.loadAll();
  const marker = options.full ? null : await store.lastSuccessAt(projectKey);

  // Current fields for every issue come from a light search without changelogs.
  const issues = await client.searchIssues({ jql: project }).toArray();
  const liveKeys = new Set(issues.map((i) => i.key));

  const refreshed = new Map<string, CachedHistory>();
  const remember = async (
    issue: JiraIssue,
    histories: Awaited<ReturnType<typeof completeChangelog>>,
  ) => {
    refreshed.set(issue.key, {
      jiraUpdated: issue.updated,
      history: deriveHistory(histories, options.statusCategories, options.fields),
    });
  };

  const since = marker ? new Date(marker.getTime() - SYNC_OVERLAP_MS) : null;
  const changedJql = since ? `${project} AND updated >= "${jqlTimestamp(since)}"` : project;
  const changed = await client.searchIssues({ jql: changedJql, changelog: true }).toArray();
  const truncated: JiraIssue[] = [];
  for (const issue of changed) {
    if (!liveKeys.has(issue.key)) continue;
    const embedded = issue.changelog?.histories.length ?? 0;
    const total = issue.changelog?.total;
    if (total !== undefined && embedded < total) truncated.push(issue);
    else await remember(issue, issue.changelog?.histories ?? []);
  }
  await mapLimit(truncated, concurrency, async (issue) =>
    remember(issue, await completeChangelog(client, issue)),
  );

  // Issues whose cached copy is missing or older than the current search result (changed between
  // the two searches, or absent from the cache) are re-read individually.
  const stale = issues.filter((issue) => {
    if (refreshed.has(issue.key)) return false;
    const cached = cache.get(issue.key);
    return !cached || cached.jiraUpdated.getTime() < issue.updated.getTime();
  });
  await mapLimit(stale, concurrency, async (issue) =>
    remember(issue, await fetchChangelog(client, issue.key)),
  );

  await store.commit({ projectKey, upserts: refreshed, liveKeys, startedAt });

  const histories = new Map<string, DerivedHistory>();
  for (const issue of issues) {
    const entry = refreshed.get(issue.key) ?? cache.get(issue.key);
    if (entry) histories.set(issue.key, entry.history);
  }
  const deleted = [...cache.keys()].filter((key) => !liveKeys.has(key)).length;
  return {
    issues,
    histories,
    stats: {
      total: issues.length,
      refreshed: refreshed.size,
      reused: issues.length - refreshed.size,
      deleted,
    },
  };
}
