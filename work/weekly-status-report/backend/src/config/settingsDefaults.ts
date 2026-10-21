export const SETTINGS_DEFAULTS_VERSION = "1.0.0";

export interface RagThresholdSettings {
  blockerRedDays: number;
  plannedCompletionRedBelow: number;
  overdueAmberAbovePercent: number;
}

export interface SettingsShape {
  reportName: string;
  timeZone: string;
  storyPointsFieldId: string;
  flaggedFieldId: string;
  epicStartDateFieldId: string | null;
  blockedStatuses: string[];
  mitigationMaxLength: number;
  ragThresholds: RagThresholdSettings;
  trendWeeks: number;
  nameDenylist: string[];
}

// The single place where every report-setting default lives. Bump the version when one changes.
export const DEFAULT_SETTINGS: SettingsShape = {
  reportName: "Weekly Status Report",
  timeZone: "UTC",
  storyPointsFieldId: "customfield_10016",
  flaggedFieldId: "customfield_10021",
  epicStartDateFieldId: null,
  blockedStatuses: ["Blocked"],
  mitigationMaxLength: 300,
  ragThresholds: {
    blockerRedDays: 5,
    plannedCompletionRedBelow: 70,
    overdueAmberAbovePercent: 10,
  },
  trendWeeks: 8,
  nameDenylist: [],
};
