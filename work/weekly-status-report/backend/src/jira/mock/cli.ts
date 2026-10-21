import { generateDataset } from "./dataset.js";
import { startMockJira } from "./server.js";

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const dataset = generateDataset({
  projectKey: process.env["MOCK_JIRA_PROJECT"] ?? "DEMO",
  issues: num("MOCK_JIRA_ISSUES", 5000),
});
const mock = await startMockJira({
  dataset,
  port: num("MOCK_JIRA_PORT", 4010),
  latencyMs: Number(process.env["MOCK_JIRA_LATENCY_MS"] ?? 150),
});
console.log(`Mock Jira listening on ${mock.url} (${dataset.issues.length} issues)`);
