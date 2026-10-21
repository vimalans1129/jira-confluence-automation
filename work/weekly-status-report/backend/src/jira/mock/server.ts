import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  MOCK_FIELDS,
  STATUS_TABLE,
  generateDataset,
  type MockDataset,
  type MockIssue,
  type StatusName,
} from "./dataset.js";

export interface MockJiraOptions {
  dataset?: MockDataset;
  latencyMs?: number;
  port?: number;
  email?: string;
  apiToken?: string;
  // When false the board has no active sprint (DEF-06 fallback).
  activeSprint?: boolean;
  maxPageSize?: number;
}

export interface MockJiraStats {
  requests: number;
  peakConcurrent: number;
  searchBodies: Array<Record<string, unknown>>;
  paths: string[];
}

export interface MockJira {
  url: string;
  dataset: MockDataset;
  stats: MockJiraStats;
  failNext(status: number, count?: number, headers?: Record<string, string>): void;
  removeIssue(key: string): void;
  close(): Promise<void>;
}

const MAX_CHANGELOG_IN_SEARCH = 100;

function issueFields(issue: MockIssue, epicType: Map<string, MockIssue>) {
  const st = STATUS_TABLE[issue.status];
  const parent = issue.epicKey ? epicType.get(issue.epicKey) : undefined;
  return {
    summary: issue.summary,
    issuetype: { name: issue.type, subtask: issue.type === "Sub-task" },
    status: {
      name: issue.status,
      statusCategory: { name: st.category, id: st.categoryId },
    },
    parent: parent ? { key: parent.key, fields: { issuetype: { name: "Epic" } } } : null,
    duedate: issue.dueDate,
    created: issue.created,
    resolutiondate: issue.resolved,
    updated: issue.updated,
    labels: issue.labels,
    [MOCK_FIELDS.storyPoints]: issue.points,
    [MOCK_FIELDS.flagged]: issue.flagged ? [{ value: "Impediment", id: "10019" }] : null,
    [MOCK_FIELDS.epicStart]: issue.startDate,
  } as Record<string, unknown>;
}

function parseJql(jql: string): { project: string | null; updatedSince: number | null } {
  const project = /project\s*=\s*"?([A-Za-z0-9_]+)"?/i.exec(jql)?.[1] ?? null;
  const upd = /updated\s*>=\s*"(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})"/i.exec(jql);
  const updatedSince = upd ? Date.parse(`${upd[1]}T${upd[2]}:${upd[3]}:00Z`) : null;
  return { project, updatedSince };
}

const toMs = (value: string) => Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

export async function startMockJira(options: MockJiraOptions = {}): Promise<MockJira> {
  const dataset = options.dataset ?? generateDataset();
  const latency = options.latencyMs ?? 0;
  const maxPage = options.maxPageSize ?? 100;
  const stats: MockJiraStats = { requests: 0, peakConcurrent: 0, searchBodies: [], paths: [] };
  let inFlight = 0;
  let failures: Array<{ status: number; headers: Record<string, string> }> = [];
  const byKey = new Map(dataset.issues.map((i) => [i.key, i]));

  const send = (
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c: Buffer) => (data += c.toString()));
      req.on("end", () => resolve(data));
    });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;

    if (options.email && options.apiToken) {
      const expected = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString("base64")}`;
      if (req.headers.authorization !== expected)
        return send(res, 401, { message: "unauthorized" });
    }
    const injected = failures.shift();
    if (injected)
      return send(res, injected.status, { errorMessages: ["injected"] }, injected.headers);

    if (path === "/rest/api/3/myself") return send(res, 200, { accountId: "mock", active: true });

    if (path === "/rest/api/3/search/jql" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as {
        jql: string;
        fields?: string[];
        maxResults?: number;
        nextPageToken?: string;
        expand?: string;
      };
      stats.searchBodies.push(body);
      const { project, updatedSince } = parseJql(body.jql);
      if (project !== dataset.projectKey) return send(res, 400, { errorMessages: ["bad project"] });
      const epics = new Map(dataset.issues.filter((i) => i.type === "Epic").map((i) => [i.key, i]));
      const matching = dataset.issues.filter(
        (i) => updatedSince === null || toMs(i.updated) >= updatedSince,
      );
      const size = Math.min(body.maxResults ?? 50, maxPage);
      const offset = body.nextPageToken
        ? Number(Buffer.from(body.nextPageToken, "base64").toString())
        : 0;
      const slice = matching.slice(offset, offset + size);
      const wanted = body.fields ? new Set(body.fields) : null;
      const issues = slice.map((issue) => {
        const all = issueFields(issue, epics);
        const fields = wanted
          ? Object.fromEntries(Object.entries(all).filter(([k]) => wanted.has(k)))
          : all;
        const out: Record<string, unknown> = { id: issue.id, key: issue.key, fields };
        if (body.expand === "changelog") {
          out["changelog"] = {
            histories: issue.histories.slice(0, MAX_CHANGELOG_IN_SEARCH),
            total: issue.histories.length,
            maxResults: MAX_CHANGELOG_IN_SEARCH,
          };
        }
        return out;
      });
      const end = offset + size;
      const last = end >= matching.length;
      return send(res, 200, {
        issues,
        ...(last
          ? { isLast: true }
          : { nextPageToken: Buffer.from(String(end)).toString("base64") }),
      });
    }

    const changelog = /^\/rest\/api\/3\/issue\/([^/]+)\/changelog$/.exec(path);
    if (changelog) {
      const issue = byKey.get(decodeURIComponent(changelog[1] ?? ""));
      if (!issue) return send(res, 404, { errorMessages: ["Issue does not exist"] });
      const startAt = Number(url.searchParams.get("startAt") ?? 0);
      const maxResults = Math.min(Number(url.searchParams.get("maxResults") ?? 100), 100);
      const values = issue.histories.slice(startAt, startAt + maxResults);
      return send(res, 200, {
        startAt,
        maxResults,
        total: issue.histories.length,
        isLast: startAt + maxResults >= issue.histories.length,
        values,
      });
    }

    const comment = /^\/rest\/api\/3\/issue\/([^/]+)\/comment$/.exec(path);
    if (comment) {
      const issue = byKey.get(decodeURIComponent(comment[1] ?? ""));
      if (!issue) return send(res, 404, { errorMessages: ["Issue does not exist"] });
      const max = Number(url.searchParams.get("maxResults") ?? 50);
      const ordered = [...issue.comments].reverse().slice(0, max);
      return send(res, 200, {
        startAt: 0,
        maxResults: max,
        total: issue.comments.length,
        comments: ordered,
      });
    }

    if (path === "/rest/api/3/status") {
      return send(
        res,
        200,
        (Object.keys(STATUS_TABLE) as StatusName[]).map((name) => ({
          id: STATUS_TABLE[name].id,
          name,
          statusCategory: { id: STATUS_TABLE[name].categoryId, name: STATUS_TABLE[name].category },
        })),
      );
    }

    if (path === "/rest/api/3/field") {
      return send(res, 200, [
        {
          id: MOCK_FIELDS.storyPoints,
          name: "Story Points",
          custom: true,
          schema: { type: "number" },
        },
        { id: MOCK_FIELDS.flagged, name: "Flagged", custom: true, schema: { type: "array" } },
        { id: MOCK_FIELDS.epicStart, name: "Start date", custom: true, schema: { type: "date" } },
        { id: "summary", name: "Summary", custom: false, schema: { type: "string" } },
      ]);
    }

    const project = /^\/rest\/api\/3\/project\/([^/]+)$/.exec(path);
    if (project) {
      if (decodeURIComponent(project[1] ?? "") !== dataset.projectKey) {
        return send(res, 404, { errorMessages: ["No project could be found"] });
      }
      return send(res, 200, { id: "10000", key: dataset.projectKey, name: "Demo Project" });
    }

    const board = /^\/rest\/agile\/1\.0\/board\/(\d+)$/.exec(path);
    if (board) {
      if (Number(board[1]) !== dataset.boardId) {
        return send(res, 404, { errorMessages: ["Board does not exist"] });
      }
      return send(res, 200, { id: dataset.boardId, name: "Demo Board", type: "scrum" });
    }

    const sprints = /^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/.exec(path);
    if (sprints) {
      if (Number(sprints[1]) !== dataset.boardId) {
        return send(res, 404, { errorMessages: ["Board does not exist"] });
      }
      const active = options.activeSprint !== false;
      return send(res, 200, {
        maxResults: 50,
        startAt: 0,
        isLast: true,
        values: active ? [{ id: 7, name: "Sprint 7", state: "active" }] : [],
      });
    }

    const sprintIssues = /^\/rest\/agile\/1\.0\/sprint\/(\d+)\/issue$/.exec(path);
    if (sprintIssues) {
      const startAt = Number(url.searchParams.get("startAt") ?? 0);
      const max = Math.min(Number(url.searchParams.get("maxResults") ?? 50), 100);
      const members = dataset.issues.filter((i) => i.inActiveSprint);
      const slice = members.slice(startAt, startAt + max);
      return send(res, 200, {
        startAt,
        maxResults: max,
        total: members.length,
        issues: slice.map((i) => ({ id: i.id, key: i.key })),
      });
    }

    return send(res, 404, { errorMessages: ["not found"] });
  }

  const server = http.createServer((req, res) => {
    stats.requests += 1;
    stats.paths.push(`${req.method} ${(req.url ?? "").split("?")[0]}`);
    inFlight += 1;
    stats.peakConcurrent = Math.max(stats.peakConcurrent, inFlight);
    res.on("close", () => {
      inFlight -= 1;
    });
    const run = () => {
      handle(req, res).catch(() => send(res, 500, { errorMessages: ["mock failure"] }));
    };
    if (latency > 0) setTimeout(run, latency);
    else run();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    dataset,
    stats,
    failNext(status, count = 1, headers = {}) {
      failures = [...failures, ...Array.from({ length: count }, () => ({ status, headers }))];
    },
    removeIssue(key) {
      const index = dataset.issues.findIndex((i) => i.key === key);
      if (index >= 0) dataset.issues.splice(index, 1);
      byKey.delete(key);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
