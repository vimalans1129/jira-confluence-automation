import { z } from "zod";

export const RAG_VALUES = ["Red", "Amber", "Green"] as const;
export const ragSchema = z.enum(RAG_VALUES);
export type Rag = z.infer<typeof ragSchema>;

export const STATUS_CATEGORIES = ["To Do", "In Progress", "Done"] as const;
export const statusCategorySchema = z.enum(STATUS_CATEGORIES);
export type StatusCategory = z.infer<typeof statusCategorySchema>;

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const NOT_AVAILABLE = "n/a" as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoDateTime = z.string().datetime({ offset: true });

// Week-over-week values are "n/a" until an earlier snapshot exists (FR-024).
export const deltaSchema = z.union([z.number(), z.literal(NOT_AVAILABLE)]);
export type Delta = z.infer<typeof deltaSchema>;

export const ragChangeSchema = z.enum(["▲", "▼", "▬", NOT_AVAILABLE]);
export type RagChange = z.infer<typeof ragChangeSchema>;

export const ragResultSchema = z.object({
  calculated: ragSchema,
  effective: ragSchema,
  reasons: z.array(z.string()),
  overridden: z.boolean(),
  overrideReason: z.string().nullable(),
});
export type RagResult = z.infer<typeof ragResultSchema>;

export const issueSchema = z.object({
  key: z.string().min(1),
  summary: z.string(),
  type: z.string(),
  status: z.string(),
  statusCategory: statusCategorySchema,
  epicKey: z.string().nullable(),
  epicName: z.string(),
  points: z.number().nullable(),
  dueDate: isoDate.nullable(),
});
export type ReportIssue = z.infer<typeof issueSchema>;

export const epicMetricsSchema = z.object({
  epicKey: z.string().nullable(),
  name: z.string(),
  dueDate: isoDate.nullable(),
  basis: z.enum(["points", "count"]),
  totalUnits: z.number().nonnegative(),
  doneUnits: z.number().nonnegative(),
  percentComplete: z.number().min(0).max(100),
  statusCounts: z.object({
    todo: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
  }),
  daysToDue: z.number().int().nullable(),
  percentDelta: deltaSchema,
  overduePercent: z.number().nullable(),
  plannedCompletionPercent: z.number().nullable(),
  noDueDate: z.boolean(),
  noWorkItems: z.boolean(),
  complete: z.boolean(),
  blockerCount: z.number().int().nonnegative(),
  rag: ragResultSchema,
  ragChange: ragChangeSchema,
});
export type EpicMetrics = z.infer<typeof epicMetricsSchema>;

export const issueGroupSchema = z.object({
  epicKey: z.string().nullable(),
  epicName: z.string(),
  points: z.number().nonnegative(),
  issues: z.array(issueSchema),
});
export type IssueGroup = z.infer<typeof issueGroupSchema>;

export const blockerSchema = z.object({
  key: z.string().min(1),
  summary: z.string(),
  epicKey: z.string().nullable(),
  epicName: z.string(),
  ageDays: z.number().int().nonnegative(),
  reason: z.enum(["flagged", "blocked-status"]),
  mitigation: z.string().nullable(),
});
export type Blocker = z.infer<typeof blockerSchema>;

export const bugSummarySchema = z.object({
  opened: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  currentlyOpen: z.number().int().nonnegative(),
});
export type BugSummary = z.infer<typeof bugSummarySchema>;

export const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type ReportWarning = z.infer<typeof warningSchema>;

export const overrideSchema = z.object({
  scope: z.enum(["overall", "epic"]),
  epicKey: z.string().nullable(),
  rag: ragSchema,
  reason: z.string().min(1),
});
export type RagOverride = z.infer<typeof overrideSchema>;

export const summarySchema = z.object({
  text: z.string(),
  approved: z.boolean(),
});
export type ExecutiveSummary = z.infer<typeof summarySchema>;

export const reportSchema = z.object({
  projectKey: z.string().min(1),
  reportName: z.string(),
  timeZone: z.string().min(1),
  weekStart: isoDate,
  weekEnd: isoDate,
  asOf: isoDateTime,
  generatedAt: isoDateTime,
  dryRun: z.boolean(),
  deckStale: z.boolean(),
  overall: z.object({ rag: ragResultSchema, ragChange: ragChangeSchema }),
  epics: z.array(epicMetricsSchema),
  completed: z.array(issueGroupSchema),
  planned: z.array(issueGroupSchema),
  overdue: z.array(issueSchema).default([]),
  blockers: z.array(blockerSchema),
  bugs: bugSummarySchema,
  warnings: z.array(warningSchema),
  overrides: z.array(overrideSchema),
  summary: summarySchema.nullable(),
});
export type Report = z.infer<typeof reportSchema>;
