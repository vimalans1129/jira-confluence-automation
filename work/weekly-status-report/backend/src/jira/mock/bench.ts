import { JiraClient } from "../client.js";
import { fetchStatusCategories } from "../enrich.js";
import { syncProject, type CachedHistory, type HistoryStore } from "../sync.js";
import { MOCK_FIELDS, generateDataset } from "./dataset.js";
import { startMockJira } from "./server.js";

// Smoke benchmark (DEF-15): full sync, then an unchanged incremental sync, against the mock.
const issues = Number(process.env["BENCH_ISSUES"] ?? 5000);
const latencyMs = Number(process.env["BENCH_LATENCY_MS"] ?? 150);
const fullBudgetS = Number(process.env["BENCH_FULL_BUDGET_S"] ?? 120);
const incrementalBudgetS = Number(process.env["BENCH_INCREMENTAL_BUDGET_S"] ?? 30);

const cache = new Map<string, CachedHistory>();
let marker: Date | null = null;
const store: HistoryStore = {
  lastSuccessAt: async () => marker,
  loadAll: async () => new Map(cache),
  commit: async (change) => {
    for (const [k, v] of change.upserts) cache.set(k, v);
    marker = change.startedAt;
  },
};

const dataset = generateDataset({ issues });
const mock = await startMockJira({ dataset, latencyMs });
const client = new JiraClient({
  baseUrl: mock.url,
  email: "bench@example.com",
  apiToken: "bench",
  fields: { ...MOCK_FIELDS },
});
const statusCategories = await fetchStatusCategories(client);
const run = async (now: Date) => {
  const started = performance.now();
  const result = await syncProject({
    client,
    store,
    projectKey: dataset.projectKey,
    statusCategories,
    fields: MOCK_FIELDS,
    now,
  });
  return { seconds: (performance.now() - started) / 1000, result };
};

const full = await run(new Date(dataset.now.getTime() + 3_600_000));
const incremental = await run(new Date(dataset.now.getTime() + 7_200_000));
await mock.close();

console.log(
  `issues=${issues} latency=${latencyMs}ms full=${full.seconds.toFixed(1)}s ` +
    `incremental=${incremental.seconds.toFixed(1)}s peakConcurrent=${mock.stats.peakConcurrent}`,
);
const failures: string[] = [];
if (full.seconds > fullBudgetS) failures.push(`full sync exceeded ${fullBudgetS}s`);
if (incremental.seconds > incrementalBudgetS) {
  failures.push(`incremental sync exceeded ${incrementalBudgetS}s`);
}
if (incremental.result.stats.refreshed !== 0) failures.push("incremental sync refreshed issues");
if (failures.length > 0) {
  console.error(failures.join("; "));
  process.exit(1);
}
