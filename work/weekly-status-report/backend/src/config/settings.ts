import { z } from "zod";
import { AppError, type ErrorDetail } from "../errors.js";
import { parseTimeZone } from "../domain/period.js";
import { DEFAULT_SETTINGS, type SettingsShape } from "./settingsDefaults.js";

export type Settings = SettingsShape;
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;

const fieldId = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, "must be a Jira field ID such as customfield_10016");

const uniqueTrimmed = (max: number) =>
  z
    .array(z.string().trim().max(max, `each entry must be at most ${max} characters`))
    .transform((list) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of list) {
        const key = item.toLowerCase();
        if (item === "" || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    });

const timeZone = z.string().transform((value, ctx) => {
  try {
    return parseTimeZone(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "must be a valid IANA time zone name" });
    return z.NEVER;
  }
});

const thresholdsShape = {
  blockerRedDays: z.number().min(0, "must be 0 or more").max(365, "must be at most 365"),
  plannedCompletionRedBelow: z.number().min(0, "must be 0 or more").max(100, "must be at most 100"),
  overdueAmberAbovePercent: z.number().min(0, "must be 0 or more").max(100, "must be at most 100"),
};

const shape = {
  reportName: z
    .string()
    .trim()
    .min(1, "must not be empty")
    .max(120, "must be at most 120 characters"),
  timeZone,
  storyPointsFieldId: fieldId,
  flaggedFieldId: fieldId,
  epicStartDateFieldId: fieldId.nullable(),
  blockedStatuses: uniqueTrimmed(80).pipe(
    z.array(z.string()).min(1, "must list at least one status"),
  ),
  mitigationMaxLength: z
    .number()
    .int("must be a whole number")
    .min(50, "must be at least 50")
    .max(1000, "must be at most 1000"),
  ragThresholds: z.object(thresholdsShape).strict(),
  trendWeeks: z
    .number()
    .int("must be a whole number")
    .min(1, "must be at least 1")
    .max(52, "must be at most 52"),
  nameDenylist: uniqueTrimmed(80).pipe(
    z.array(z.string()).max(500, "must have at most 500 entries"),
  ),
};

const patchSchema = z
  .object({
    ...shape,
    ragThresholds: z.object(thresholdsShape).partial().strict(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, "at least one setting is required");

function toDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    const message =
      issue.code === "unrecognized_keys"
        ? `unknown setting: ${issue.keys.join(", ")}`
        : issue.message;
    return { path, message };
  });
}

export type SettingsPatch = Partial<Omit<Settings, "ragThresholds">> & {
  ragThresholds?: Partial<Settings["ragThresholds"]>;
};

export function parseSettingsPatch(input: unknown): SettingsPatch {
  const result = patchSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      "VALIDATION_FAILED",
      "The settings are not valid",
      toDetails(result.error),
    );
  }
  return result.data as SettingsPatch;
}

const fullSchema = z.object(shape).strict();

// Stored rows override defaults; the merged result is validated so bad stored data fails loudly.
export function mergeSettings(stored: ReadonlyMap<string, unknown>): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (!stored.has(key)) continue;
    const value = stored.get(key);
    merged[key] =
      key === "ragThresholds" && typeof value === "object" && value !== null
        ? { ...DEFAULT_SETTINGS.ragThresholds, ...value }
        : value;
  }
  const result = fullSchema.safeParse(merged);
  if (!result.success) {
    throw new AppError(
      500,
      "SETTINGS_INVALID",
      "Stored settings are not valid",
      toDetails(result.error),
    );
  }
  return result.data as Settings;
}
