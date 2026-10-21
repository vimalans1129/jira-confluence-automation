import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_DEFAULTS_VERSION } from "../src/config/settingsDefaults.js";
import { mergeSettings, parseSettingsPatch, type Settings } from "../src/config/settings.js";
import { AppError } from "../src/errors.js";
import { matchesBlockedStatus } from "../src/domain/blockers.js";

describe("settings defaults", () => {
  it("lists every report setting, including each RAG threshold, in one versioned module", () => {
    expect(SETTINGS_DEFAULTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
      [
        "blockedStatuses",
        "epicStartDateFieldId",
        "flaggedFieldId",
        "mitigationMaxLength",
        "nameDenylist",
        "ragThresholds",
        "reportName",
        "storyPointsFieldId",
        "timeZone",
        "trendWeeks",
      ].sort(),
    );
    expect(DEFAULT_SETTINGS.ragThresholds).toEqual({
      blockerRedDays: 5,
      plannedCompletionRedBelow: 70,
      overdueAmberAbovePercent: 10,
    });
    expect(DEFAULT_SETTINGS.mitigationMaxLength).toBe(300);
  });

  it("is itself valid", () => {
    expect(() => mergeSettings(new Map())).not.toThrow();
    expect(mergeSettings(new Map())).toEqual(DEFAULT_SETTINGS);
  });
});

describe("mergeSettings (load)", () => {
  it("applies stored values over defaults", () => {
    const s = mergeSettings(new Map([["reportName", "Team Report"]]));
    expect(s.reportName).toBe("Team Report");
    expect(s.timeZone).toBe(DEFAULT_SETTINGS.timeZone);
  });

  it("merges a partial RAG threshold object with defaults", () => {
    const s = mergeSettings(new Map([["ragThresholds", { blockerRedDays: 3 }]]));
    expect(s.ragThresholds).toEqual({ ...DEFAULT_SETTINGS.ragThresholds, blockerRedDays: 3 });
  });

  it("rejects an invalid stored value with a specific message", () => {
    try {
      mergeSettings(new Map([["timeZone", "Mars/Phobos"]]));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("SETTINGS_INVALID");
      expect((e as AppError).details?.[0]?.path).toBe("timeZone");
    }
  });

  it("ignores unknown stored keys", () => {
    expect(mergeSettings(new Map([["legacy", 1]]))).toEqual(DEFAULT_SETTINGS);
  });
});

describe("parseSettingsPatch (save)", () => {
  const bad = (patch: unknown) => {
    try {
      parseSettingsPatch(patch);
      return null;
    } catch (e) {
      return e as AppError;
    }
  };

  it("accepts and normalizes valid values", () => {
    const p = parseSettingsPatch({
      reportName: "  Weekly  ",
      timeZone: "europe/berlin",
      blockedStatuses: [" Blocked ", "blocked", "On Hold"],
      nameDenylist: ["Contoso", " contoso ", ""],
      storyPointsFieldId: "customfield_10016",
    });
    expect(p).toMatchObject({
      reportName: "Weekly",
      timeZone: "Europe/Berlin",
      blockedStatuses: ["Blocked", "On Hold"],
      nameDenylist: ["Contoso"],
    });
  });

  it.each([
    [{ timeZone: "Bad/Zone" }, "timeZone"],
    [{ reportName: "" }, "reportName"],
    [{ reportName: "x".repeat(121) }, "reportName"],
    [{ blockedStatuses: [] }, "blockedStatuses"],
    [{ mitigationMaxLength: 10 }, "mitigationMaxLength"],
    [{ mitigationMaxLength: 5000 }, "mitigationMaxLength"],
    [{ mitigationMaxLength: 300.5 }, "mitigationMaxLength"],
    [{ storyPointsFieldId: "bad id!" }, "storyPointsFieldId"],
    [{ ragThresholds: { blockerRedDays: -1 } }, "ragThresholds.blockerRedDays"],
    [
      { ragThresholds: { plannedCompletionRedBelow: 101 } },
      "ragThresholds.plannedCompletionRedBelow",
    ],
    [
      { ragThresholds: { overdueAmberAbovePercent: "10" } },
      "ragThresholds.overdueAmberAbovePercent",
    ],
    [{ trendWeeks: 0 }, "trendWeeks"],
    [{ trendWeeks: 53 }, "trendWeeks"],
    [{ unknownKey: 1 }, ""],
  ])("rejects %j with a specific message", (patch, path) => {
    const err = bad(patch);
    expect(err).toBeInstanceOf(AppError);
    expect(err?.status).toBe(400);
    expect(err?.code).toBe("VALIDATION_FAILED");
    expect(err?.details?.length).toBeGreaterThan(0);
    if (path) expect(err?.details?.some((d) => d.path === path)).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(bad({})?.code).toBe("VALIDATION_FAILED");
  });

  it("allows clearing nullable field ids", () => {
    expect(parseSettingsPatch({ epicStartDateFieldId: null })).toEqual({
      epicStartDateFieldId: null,
    });
  });
});

describe("blocked status matching (FR-037)", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, blockedStatuses: ["Blocked", "On Hold"] };
  it("is case-insensitive and trims", () => {
    expect(matchesBlockedStatus(" on hold ", settings.blockedStatuses)).toBe(true);
    expect(matchesBlockedStatus("BLOCKED", settings.blockedStatuses)).toBe(true);
    expect(matchesBlockedStatus("In Progress", settings.blockedStatuses)).toBe(false);
  });
});
