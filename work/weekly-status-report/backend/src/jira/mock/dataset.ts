export type StatusName = "To Do" | "In Progress" | "Blocked" | "Done";

export const STATUS_TABLE: Record<
  StatusName,
  { id: string; category: "To Do" | "In Progress" | "Done"; categoryId: number }
> = {
  "To Do": { id: "10000", category: "To Do", categoryId: 2 },
  "In Progress": { id: "10001", category: "In Progress", categoryId: 4 },
  Blocked: { id: "10002", category: "In Progress", categoryId: 4 },
  Done: { id: "10003", category: "Done", categoryId: 3 },
};

export const MOCK_FIELDS = {
  storyPoints: "customfield_10016",
  flagged: "customfield_10021",
  epicStart: "customfield_10015",
} as const;

export interface MockHistoryItem {
  field: string;
  fieldId: string;
  from: string | null;
  to: string | null;
  fromString: string | null;
  toString: string | null;
}

export interface MockHistory {
  id: string;
  created: string;
  items: MockHistoryItem[];
}

export interface MockComment {
  id: string;
  created: string;
  body: unknown;
}

export interface MockIssue {
  id: string;
  key: string;
  summary: string;
  type: "Epic" | "Story" | "Task" | "Bug" | "Sub-task";
  epicKey: string | null;
  status: StatusName;
  points: number | null;
  flagged: boolean;
  dueDate: string | null;
  startDate: string | null;
  created: string;
  updated: string;
  resolved: string | null;
  labels: string[];
  histories: MockHistory[];
  comments: MockComment[];
  inActiveSprint: boolean;
}

export interface DatasetOptions {
  projectKey?: string;
  issues?: number;
  epics?: number;
  changelogPerIssue?: number;
  now?: Date;
  seed?: number;
  // The first N child issues get 150 changelog entries, to exercise changelog truncation.
  longChangelogCount?: number;
}

export interface MockDataset {
  projectKey: string;
  boardId: number;
  now: Date;
  issues: MockIssue[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "+0000");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

function statusItem(from: StatusName, to: StatusName): MockHistoryItem {
  return {
    field: "status",
    fieldId: "status",
    from: STATUS_TABLE[from].id,
    to: STATUS_TABLE[to].id,
    fromString: from,
    toString: to,
  };
}

export function adf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

export function generateDataset(options: DatasetOptions = {}): MockDataset {
  const projectKey = options.projectKey ?? "DEMO";
  const total = options.issues ?? 5000;
  const epicCount = Math.max(1, Math.min(options.epics ?? 20, total));
  const perIssue = options.changelogPerIssue ?? 12;
  const now = options.now ?? new Date("2026-10-21T08:00:00Z");
  const rng = mulberry32(options.seed ?? 42);
  const nowMs = now.getTime();
  const issues: MockIssue[] = [];
  let historyId = 1;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;

  for (let e = 1; e <= epicCount; e++) {
    const created = nowMs - (120 + Math.floor(rng() * 60)) * DAY;
    issues.push({
      id: String(10000 + e),
      key: `${projectKey}-${e}`,
      summary: `Workstream ${e}`,
      type: "Epic",
      epicKey: null,
      status: "In Progress",
      points: null,
      flagged: false,
      dueDate: day(nowMs + (20 + e * 7) * DAY),
      startDate: day(created + 10 * DAY),
      created: iso(created),
      updated: iso(created),
      resolved: null,
      labels: [],
      histories: [],
      comments: [],
      inActiveSprint: false,
    });
  }

  const childCount = total - epicCount;
  for (let n = 0; n < childCount; n++) {
    const number = epicCount + 1 + n;
    const events = n < (options.longChangelogCount ?? 0) ? 150 : perIssue;
    const type = pick(["Story", "Story", "Task", "Bug"] as const);
    const created = nowMs - Math.floor(rng() * 100 + 20) * DAY;
    let status: StatusName = "To Do";
    let points: number | null = rng() < 0.8 ? pick([1, 2, 3, 5, 8]) : null;
    let flagged = false;
    let cursor = created;
    const step = (nowMs - created) / (events + 2);
    const histories: MockHistory[] = [];

    for (let h = 0; h < events; h++) {
      cursor += step * (0.5 + rng());
      const at = Math.min(cursor, nowMs - 1000);
      const items: MockHistoryItem[] = [];
      const roll = rng();
      if (status === "To Do" || status === "Blocked" || status === "Done") {
        items.push(statusItem(status, "In Progress"));
        status = "In Progress";
      } else if (roll < 0.25) {
        items.push(statusItem(status, "Blocked"));
        status = "Blocked";
      } else if (roll < 0.4) {
        items.push(statusItem(status, "Done"));
        status = "Done";
      } else if (roll < 0.65) {
        flagged = !flagged;
        items.push({
          field: "Flagged",
          fieldId: MOCK_FIELDS.flagged,
          from: null,
          to: flagged ? "10019" : null,
          fromString: flagged ? "" : "Impediment",
          toString: flagged ? "Impediment" : "",
        });
      } else {
        const next = pick([1, 2, 3, 5, 8, 13]);
        items.push({
          field: "Story Points",
          fieldId: MOCK_FIELDS.storyPoints,
          from: points === null ? null : String(points),
          to: String(next),
          fromString: points === null ? null : String(points),
          toString: String(next),
        });
        points = next;
      }
      histories.push({ id: String(historyId++), created: iso(at), items });
    }

    const last = histories[histories.length - 1];
    const updated = last ? last.created : iso(created);
    const lastDone = [...histories]
      .reverse()
      .find((h) => h.items.some((i) => i.field === "status" && i.toString === "Done"));
    const comments: MockComment[] = [];
    if (flagged || status === "Blocked") {
      comments.push({
        id: String(n + 1),
        created: updated,
        body: adf(
          `Waiting on [~accountid:abc${n}] for a vendor fix. Contact jane${n}@example.com.`,
        ),
      });
    }
    issues.push({
      id: String(20000 + number),
      key: `${projectKey}-${number}`,
      summary: `Task ${number} for Workstream ${1 + (n % epicCount)}`,
      type,
      epicKey: rng() < 0.9 ? `${projectKey}-${1 + (n % epicCount)}` : null,
      status,
      points,
      flagged,
      dueDate: rng() < 0.6 ? day(nowMs + Math.floor(rng() * 60 - 20) * DAY) : null,
      startDate: null,
      created: iso(created),
      updated,
      resolved: status === "Done" && lastDone ? lastDone.created : null,
      labels: rng() < 0.3 ? ["backend"] : [],
      histories,
      comments,
      inActiveSprint: status !== "Done" && rng() < 0.3,
    });
  }

  return { projectKey, boardId: 1, now, issues };
}
