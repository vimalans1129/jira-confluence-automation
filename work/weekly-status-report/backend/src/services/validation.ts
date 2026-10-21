import { z } from "zod";
import type { JiraConnection } from "../config/env.js";
import type { Settings } from "../config/settings.js";
import { AppError } from "../errors.js";
import { JiraClient, JiraError } from "../jira/client.js";
import type { SettingsRepository } from "../repositories/settingsRepository.js";

export type CheckName = "connectivity" | "project" | "board" | "storyPointsField" | "flaggedField";

export interface CheckResult {
  name: CheckName;
  ok: boolean;
  message: string;
  code?: string;
}

export interface FieldCandidate {
  id: string;
  name: string;
  type: string;
}

export interface FieldResolution {
  // configured: the saved ID exists in Jira; selected: chosen by the user or the only candidate.
  status: "configured" | "selected" | "choose" | "none";
  id: string | null;
  candidates: FieldCandidate[];
}

export interface ValidationResult {
  ok: boolean;
  checks: CheckResult[];
  storyPointsField: FieldResolution;
  flaggedField: FieldResolution;
  validatedAt: string | null;
  savedSettings: string[];
}

export interface ValidationChoices {
  storyPointsFieldId?: string;
  flaggedFieldId?: string;
}

const fieldListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    schema: z.object({ type: z.string().optional() }).loose().optional(),
  }),
);

const anyObject = z.object({}).loose();

const STORY_POINT_NAMES = new Set(["story points", "story point estimate"]);

type JiraField = z.infer<typeof fieldListSchema>[number];

const toCandidate = (f: JiraField): FieldCandidate => ({
  id: f.id,
  name: f.name,
  type: f.schema?.type ?? "unknown",
});

function resolveField(
  configuredId: string,
  fields: readonly JiraField[],
  matches: (f: JiraField) => boolean,
  chosenId: string | undefined,
): FieldResolution {
  const candidates = fields.filter(matches).map(toCandidate);
  if (chosenId !== undefined) {
    return candidates.some((c) => c.id === chosenId)
      ? { status: "selected", id: chosenId, candidates }
      : { status: "choose", id: null, candidates };
  }
  if (fields.some((f) => f.id === configuredId)) {
    return { status: "configured", id: configuredId, candidates };
  }
  if (candidates.length === 1) return { status: "selected", id: candidates[0]!.id, candidates };
  return { status: candidates.length === 0 ? "none" : "choose", id: null, candidates };
}

async function runCheck(name: CheckName, okMessage: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    return { name, ok: true, message: okMessage } satisfies CheckResult;
  } catch (error) {
    if (error instanceof JiraError) {
      return { name, ok: false, message: error.message, code: error.code } satisfies CheckResult;
    }
    throw error;
  }
}

function fieldCheck(
  name: "storyPointsField" | "flaggedField",
  label: string,
  resolution: FieldResolution,
): CheckResult {
  switch (resolution.status) {
    case "configured":
    case "selected":
      return { name, ok: true, message: `${label} field ${resolution.id} is available.` };
    case "choose":
      return {
        name,
        ok: false,
        code: "FIELD_CHOICE_REQUIRED",
        message: `Several fields could be the ${label} field; choose one.`,
      };
    case "none":
      return {
        name,
        ok: false,
        code: "FIELD_NOT_FOUND",
        message: `No ${label} field was found in Jira.`,
      };
  }
}

export interface ValidationDeps {
  settings: SettingsRepository;
  connection: JiraConnection;
  createClient?: (connection: JiraConnection, fields: Settings) => JiraClient;
  now?: () => Date;
}

function defaultClient(connection: JiraConnection, settings: Settings): JiraClient {
  return new JiraClient({
    baseUrl: connection.baseUrl,
    email: connection.email,
    apiToken: connection.apiToken,
    fields: {
      storyPoints: settings.storyPointsFieldId,
      flagged: settings.flaggedFieldId,
      epicStart: settings.epicStartDateFieldId,
    },
  });
}

export async function runValidation(
  deps: ValidationDeps,
  choices: ValidationChoices = {},
): Promise<ValidationResult> {
  const { settings: repo, connection } = deps;
  const settings = await repo.load();
  const client = (deps.createClient ?? defaultClient)(connection, settings);
  const none: FieldResolution = { status: "none", id: null, candidates: [] };
  const checks: CheckResult[] = [];

  const connectivity = await runCheck("connectivity", "Jira accepted the credentials.", () =>
    client.get("/rest/api/3/myself", anyObject, { context: "the current user" }),
  );
  checks.push(connectivity);

  // Credentials or reachability problems make every other check meaningless.
  if (!connectivity.ok) {
    return {
      ok: false,
      checks,
      storyPointsField: none,
      flaggedField: none,
      validatedAt: null,
      savedSettings: [],
    };
  }

  checks.push(
    await runCheck("project", `Project ${connection.projectKey} was found.`, () =>
      client.get(`/rest/api/3/project/${encodeURIComponent(connection.projectKey)}`, anyObject, {
        context: `project "${connection.projectKey}"`,
        permission: "Browse Projects",
      }),
    ),
    await runCheck("board", `Board ${connection.boardId} was found.`, () =>
      client.get(`/rest/agile/1.0/board/${connection.boardId}`, anyObject, {
        context: `board ${connection.boardId}`,
        permission: "Browse Projects",
      }),
    ),
  );

  let fields: JiraField[] = [];
  const fieldList = await runCheck("storyPointsField", "", async () => {
    fields = await client.get("/rest/api/3/field", fieldListSchema, {
      context: "the field list",
    });
  });

  let storyPoints = none;
  let flagged = none;
  if (fieldList.ok) {
    storyPoints = resolveField(
      settings.storyPointsFieldId,
      fields,
      (f) => STORY_POINT_NAMES.has(f.name.toLowerCase()) && f.schema?.type === "number",
      choices.storyPointsFieldId,
    );
    flagged = resolveField(
      settings.flaggedFieldId,
      fields,
      (f) => f.name.toLowerCase() === "flagged",
      choices.flaggedFieldId,
    );
    checks.push(
      fieldCheck("storyPointsField", "Story Points", storyPoints),
      fieldCheck("flaggedField", "Flagged", flagged),
    );
  } else {
    checks.push({ ...fieldList });
  }

  const ok = checks.every((c) => c.ok);
  const savedSettings: string[] = [];
  if (ok) {
    const patch: Record<string, string> = {};
    if (storyPoints.id && storyPoints.id !== settings.storyPointsFieldId) {
      patch["storyPointsFieldId"] = storyPoints.id;
    }
    if (flagged.id && flagged.id !== settings.flaggedFieldId) {
      patch["flaggedFieldId"] = flagged.id;
    }
    if (Object.keys(patch).length > 0) {
      await repo.update(patch);
      savedSettings.push(...Object.keys(patch));
    }
    const at = (deps.now ?? (() => new Date()))();
    await repo.recordValidation({
      at,
      projectKey: connection.projectKey,
      boardId: connection.boardId,
    });
    return {
      ok,
      checks,
      storyPointsField: storyPoints,
      flaggedField: flagged,
      validatedAt: at.toISOString(),
      savedSettings,
    };
  }
  return {
    ok,
    checks,
    storyPointsField: storyPoints,
    flaggedField: flagged,
    validatedAt: null,
    savedSettings,
  };
}

// Report generation calls this first (FR-052).
export async function assertValidated(
  repo: SettingsRepository,
  connection: JiraConnection | null,
): Promise<void> {
  if (!connection) {
    throw new AppError(
      409,
      "JIRA_NOT_CONFIGURED",
      "Jira connection settings are missing from the server environment.",
    );
  }
  const record = await repo.getValidation();
  const current =
    record !== null &&
    record.projectKey === connection.projectKey &&
    record.boardId === connection.boardId;
  if (!current) {
    throw new AppError(
      409,
      "VALIDATION_REQUIRED",
      "Run the Jira validation check before generating a report.",
    );
  }
}
