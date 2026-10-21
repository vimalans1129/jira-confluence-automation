import { z } from "zod";
import { statusCategorySchema, type StatusCategory } from "../contract/index.js";
import type { FlagEvent, StatusTransition } from "../domain/model.js";
import {
  changelogHistorySchema,
  parseJiraDate,
  type ChangelogHistory,
  type JiraClient,
  type JiraIssue,
} from "./client.js";

const CHANGELOG_PAGE_SIZE = 100;

const changelogPageSchema = z.object({
  startAt: z.number().optional(),
  total: z.number(),
  values: z.array(changelogHistorySchema),
});

// Search responses cap the embedded changelog; when it is short, page through the dedicated endpoint.
export async function completeChangelog(
  client: JiraClient,
  issue: Pick<JiraIssue, "key" | "changelog">,
): Promise<ChangelogHistory[]> {
  const embedded = issue.changelog?.histories ?? [];
  const total = issue.changelog?.total;
  if (total === undefined || embedded.length >= total) return embedded;

  const all: ChangelogHistory[] = [];
  let startAt = 0;
  for (;;) {
    const page = await client.get(
      `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog`,
      changelogPageSchema,
      {
        query: { startAt, maxResults: CHANGELOG_PAGE_SIZE },
        context: `the changelog of ${issue.key}`,
      },
    );
    all.push(...page.values);
    startAt += page.values.length;
    if (page.values.length === 0 || startAt >= page.total) break;
  }
  return all;
}

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: { text?: string; url?: string };
  content?: AdfNode[];
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "codeBlock",
  "blockquote",
  "tableRow",
  "rule",
]);

function renderAdf(node: AdfNode, out: string[]): void {
  switch (node.type) {
    case "text":
      out.push(node.text ?? "");
      return;
    case "hardBreak":
      out.push("\n");
      return;
    case "mention":
      out.push(node.attrs?.text ?? "@user");
      return;
    case "inlineCard":
      out.push(node.attrs?.url ?? "");
      return;
    default:
  }
  for (const child of node.content ?? []) renderAdf(child, out);
  if (node.type && BLOCK_TYPES.has(node.type)) out.push("\n");
}

export function adfToText(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (typeof body !== "object" || body === null) return "";
  const out: string[] = [];
  renderAdf(body as AdfNode, out);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const commentPageSchema = z.object({
  comments: z.array(z.object({ created: z.string(), body: z.unknown() })),
});

// Only called for blockers, so the cost is one request per blocked issue.
export async function fetchLatestComment(client: JiraClient, key: string): Promise<string | null> {
  const page = await client.get(
    `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
    commentPageSchema,
    {
      query: { orderBy: "-created", maxResults: 1 },
      context: `the comments of ${key}`,
    },
  );
  const latest = page.comments[0];
  if (!latest) return null;
  const text = adfToText(latest.body);
  return text === "" ? null : text;
}

export interface ActiveSprint {
  id: number;
  name: string;
  issueKeys: Set<string>;
}

const sprintListSchema = z.object({
  values: z.array(z.object({ id: z.number(), name: z.string(), state: z.string().optional() })),
});

const sprintIssuesSchema = z.object({
  total: z.number(),
  issues: z.array(z.object({ key: z.string() })),
});

// Null means the board has no active sprint; callers raise the NO_ACTIVE_SPRINT warning (DEF-06).
export async function fetchActiveSprint(
  client: JiraClient,
  boardId: number,
): Promise<ActiveSprint | null> {
  let list: z.infer<typeof sprintListSchema>;
  try {
    list = await client.get(`/rest/agile/1.0/board/${boardId}/sprint`, sprintListSchema, {
      query: { state: "active" },
      context: "the configured board",
      permission: "Browse Projects",
    });
  } catch (error) {
    // Kanban boards reject sprint queries with 400; treat that as "no sprints".
    if (error instanceof Error && "code" in error && error.code === "JIRA_UNEXPECTED_RESPONSE") {
      return null;
    }
    throw error;
  }
  const sprint = list.values.find((s) => s.state === undefined || s.state === "active");
  if (!sprint) return null;

  const issueKeys = new Set<string>();
  let startAt = 0;
  for (;;) {
    const page = await client.get(`/rest/agile/1.0/sprint/${sprint.id}/issue`, sprintIssuesSchema, {
      query: { startAt, maxResults: 100, fields: "key" },
      context: "the active sprint",
    });
    for (const issue of page.issues) issueKeys.add(issue.key);
    startAt += page.issues.length;
    if (page.issues.length === 0 || startAt >= page.total) break;
  }
  return { id: sprint.id, name: sprint.name, issueKeys };
}

const statusListSchema = z.array(
  z.object({ name: z.string(), statusCategory: z.object({ name: statusCategorySchema }) }),
);

export async function fetchStatusCategories(
  client: JiraClient,
): Promise<Map<string, StatusCategory>> {
  const list = await client.get("/rest/api/3/status", statusListSchema, {
    context: "the status list",
  });
  return new Map(list.map((s) => [s.name, s.statusCategory.name]));
}

export interface PointChange {
  at: Date;
  from: number | null;
  to: number | null;
}

export interface DerivedHistory {
  transitions: StatusTransition[];
  flagEvents: FlagEvent[];
  pointChanges: PointChange[];
}

export interface HistoryFieldIds {
  storyPoints: string;
  flagged: string;
}

function toPoints(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Keeps only what the report needs; authors and other changelog content are never read.
export function deriveHistory(
  histories: readonly ChangelogHistory[],
  statusCategories: ReadonlyMap<string, StatusCategory>,
  fields: HistoryFieldIds,
): DerivedHistory {
  const category = (name: string): StatusCategory => statusCategories.get(name) ?? "In Progress";
  const transitions: StatusTransition[] = [];
  const flagEvents: FlagEvent[] = [];
  const pointChanges: PointChange[] = [];

  for (const history of histories) {
    const at = parseJiraDate(history.created);
    for (const item of history.items) {
      if (item.field === "status") {
        const from = item.fromString ?? "";
        const to = item.toString ?? "";
        transitions.push({ at, from, to, fromCategory: category(from), toCategory: category(to) });
      } else if (item.fieldId === fields.flagged || item.field === "Flagged") {
        flagEvents.push({ at, flagged: (item.toString ?? "") !== "" });
      } else if (item.fieldId === fields.storyPoints || item.field === "Story Points") {
        pointChanges.push({ at, from: toPoints(item.fromString), to: toPoints(item.toString) });
      }
    }
  }

  const byTime = <T extends { at: Date }>(a: T, b: T) => a.at.getTime() - b.at.getTime();
  return {
    transitions: transitions.sort(byTime),
    flagEvents: flagEvents.sort(byTime),
    pointChanges: pointChanges.sort(byTime),
  };
}
