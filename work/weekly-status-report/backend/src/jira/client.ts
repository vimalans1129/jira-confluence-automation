import { z } from "zod";
import { statusCategorySchema, type StatusCategory } from "../contract/index.js";
import { AppError } from "../errors.js";

const MAX_DELAY_MS = 30_000;
const BASE_DELAY_MS = 1000;

export type JiraErrorCode =
  | "JIRA_AUTH_FAILED"
  | "JIRA_FORBIDDEN"
  | "JIRA_NOT_FOUND"
  | "JIRA_RATE_LIMITED"
  | "JIRA_UNAVAILABLE"
  | "JIRA_UNEXPECTED_RESPONSE";

export class JiraError extends AppError {
  declare readonly code: JiraErrorCode;
  constructor(code: JiraErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "JiraError";
  }
}

export interface JiraFieldIds {
  storyPoints: string;
  flagged: string;
  epicStart: string | null;
}

export interface JiraClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  fields: JiraFieldIds;
  maxAttempts?: number;
  timeoutMs?: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  // Used in messages only: what was being looked up, and which permission a 403 means.
  context?: string;
  permission?: string;
}

const historyItemSchema = z.object({
  field: z.string(),
  fieldId: z.string().optional(),
  fromString: z.string().nullable().optional(),
  toString: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
});

export const changelogHistorySchema = z.object({
  created: z.string(),
  items: z.array(historyItemSchema),
});
export type ChangelogHistory = z.infer<typeof changelogHistorySchema>;

const rawIssueSchema = z.object({
  id: z.string(),
  key: z.string().min(1),
  fields: z
    .object({
      summary: z.string(),
      issuetype: z.object({ name: z.string(), subtask: z.boolean().optional() }),
      status: z.object({
        name: z.string(),
        statusCategory: z.object({ name: statusCategorySchema }),
      }),
      parent: z
        .object({
          key: z.string(),
          fields: z.object({ issuetype: z.object({ name: z.string() }).optional() }).optional(),
        })
        .nullable()
        .optional(),
      duedate: z.string().nullable().optional(),
      created: z.string(),
      resolutiondate: z.string().nullable().optional(),
      updated: z.string(),
      labels: z.array(z.string()).optional(),
    })
    .loose(),
  changelog: z
    .object({
      histories: z.array(changelogHistorySchema),
      total: z.number().optional(),
      maxResults: z.number().optional(),
    })
    .optional(),
});

const searchPageSchema = z.object({
  issues: z.array(rawIssueSchema),
  nextPageToken: z.string().nullable().optional(),
  isLast: z.boolean().optional(),
});

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  type: string;
  isSubtask: boolean;
  status: string;
  statusCategory: StatusCategory;
  epicKey: string | null;
  points: number | null;
  dueDate: string | null;
  startDate: string | null;
  created: Date;
  resolved: Date | null;
  updated: Date;
  flagged: boolean;
  labels: string[];
  changelog?: { histories: ChangelogHistory[]; total: number | undefined };
}

export function parseJiraDate(value: string): Date {
  // Jira writes offsets as +0000; normalise to +00:00 so every runtime parses it.
  return new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

export interface SearchOptions {
  jql: string;
  pageSize?: number;
  changelog?: boolean;
}

export class IssuePages implements AsyncIterable<JiraIssue> {
  constructor(private readonly generate: () => AsyncGenerator<JiraIssue>) {}

  [Symbol.asyncIterator](): AsyncIterator<JiraIssue> {
    return this.generate();
  }

  async toArray(): Promise<JiraIssue[]> {
    const out: JiraIssue[] = [];
    for await (const issue of this.generate()) out.push(issue);
    return out;
  }
}

function describeZodIssue(error: z.ZodError): string {
  const first = error.issues[0];
  const path = first ? first.path.join(".") : "";
  return `Jira returned an unexpected response; field "${path}" failed validation.`;
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly doFetch: (url: string, init: RequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly fields: JiraFieldIds;

  constructor(config: JiraClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
    this.maxAttempts = config.maxAttempts ?? 5;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.doFetch = config.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.fields = config.fields;
  }

  get<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    return this.request("GET", path, schema, options);
  }

  post<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    return this.request("POST", path, schema, options);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    options: RequestOptions,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      authorization: this.authHeader,
      accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    let lastFailure: JiraError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: Response | null = null;
      try {
        response = await this.doFetch(url.toString(), {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        lastFailure = new JiraError(
          "JIRA_UNAVAILABLE",
          503,
          "Jira is unavailable (network error).",
        );
      }

      let retryAfterMs: number | null = null;
      if (response) {
        const status = response.status;
        if (status === 429) {
          lastFailure = new JiraError(
            "JIRA_RATE_LIMITED",
            503,
            "Jira rate limit exceeded; retry later.",
          );
          const raw = response.headers.get("retry-after");
          const header = raw === null || raw.trim() === "" ? NaN : Number(raw);
          if (Number.isFinite(header) && header >= 0) retryAfterMs = header * 1000;
        } else if (status >= 500) {
          lastFailure = new JiraError("JIRA_UNAVAILABLE", 503, "Jira is unavailable.");
        } else if (status >= 200 && status < 300) {
          return this.parse(response, schema);
        } else {
          throw this.mapClientError(status, options);
        }
      }

      if (attempt < this.maxAttempts) {
        const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
        await this.sleep(retryAfterMs === null ? backoff : Math.min(MAX_DELAY_MS, retryAfterMs));
      }
    }
    throw lastFailure ?? new JiraError("JIRA_UNAVAILABLE", 503, "Jira is unavailable.");
  }

  private mapClientError(status: number, options: RequestOptions): JiraError {
    if (status === 401) {
      return new JiraError(
        "JIRA_AUTH_FAILED",
        502,
        "Jira rejected the credentials; check the email and API token.",
      );
    }
    if (status === 403) {
      const permission = options.permission ? ` (${options.permission})` : "";
      return new JiraError(
        "JIRA_FORBIDDEN",
        502,
        `Jira denied access; a required permission is missing${permission}.`,
      );
    }
    if (status === 404) {
      const what = options.context ?? "the requested resource";
      return new JiraError("JIRA_NOT_FOUND", 502, `Jira could not find ${what}.`);
    }
    return new JiraError(
      "JIRA_UNEXPECTED_RESPONSE",
      502,
      `Jira rejected the request (HTTP ${status}).`,
    );
  }

  private async parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new JiraError(
        "JIRA_UNEXPECTED_RESPONSE",
        502,
        "Jira returned a response that is not JSON.",
      );
    }
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new JiraError("JIRA_UNEXPECTED_RESPONSE", 502, describeZodIssue(result.error));
    }
    return result.data;
  }

  searchIssues(options: SearchOptions): IssuePages {
    const fieldList = [
      "summary",
      "issuetype",
      "status",
      "parent",
      "duedate",
      "created",
      "resolutiondate",
      "updated",
      "labels",
      this.fields.storyPoints,
      this.fields.flagged,
      ...(this.fields.epicStart ? [this.fields.epicStart] : []),
    ];
    return new IssuePages(
      async function* (this: JiraClient) {
        let nextPageToken: string | undefined;
        do {
          const page = await this.post("/rest/api/3/search/jql", searchPageSchema, {
            body: {
              jql: options.jql,
              fields: fieldList,
              maxResults: options.pageSize ?? 100,
              ...(options.changelog ? { expand: "changelog" } : {}),
              ...(nextPageToken ? { nextPageToken } : {}),
            },
            context: "the configured project",
            permission: "Browse Projects",
          });
          for (const raw of page.issues) yield this.toIssue(raw);
          nextPageToken = page.isLast ? undefined : (page.nextPageToken ?? undefined);
        } while (nextPageToken);
      }.bind(this),
    );
  }

  private toIssue(raw: z.infer<typeof rawIssueSchema>): JiraIssue {
    const f = raw.fields;
    const custom = (id: string | null): unknown => (id ? f[id] : undefined);
    const points = custom(this.fields.storyPoints);
    const flagged = custom(this.fields.flagged);
    const start = custom(this.fields.epicStart);
    const parentIsEpic = f.parent?.fields?.issuetype?.name === "Epic";
    return {
      id: raw.id,
      key: raw.key,
      summary: f.summary,
      type: f.issuetype.name,
      isSubtask: f.issuetype.subtask === true,
      status: f.status.name,
      statusCategory: f.status.statusCategory.name,
      epicKey: parentIsEpic && f.parent ? f.parent.key : null,
      points: typeof points === "number" ? points : null,
      dueDate: f.duedate ?? null,
      startDate: typeof start === "string" ? start : null,
      created: parseJiraDate(f.created),
      resolved: f.resolutiondate ? parseJiraDate(f.resolutiondate) : null,
      updated: parseJiraDate(f.updated),
      flagged: Array.isArray(flagged) && flagged.length > 0,
      labels: f.labels ?? [],
      ...(raw.changelog
        ? { changelog: { histories: raw.changelog.histories, total: raw.changelog.total } }
        : {}),
    };
  }
}
