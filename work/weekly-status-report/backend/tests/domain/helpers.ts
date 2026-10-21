import type { DomainIssue } from "../../src/domain/model.js";

const d = (s: string) => new Date(s);

export function makeIssue(overrides: Partial<DomainIssue> = {}): DomainIssue {
  return {
    key: "DEMO-1",
    summary: "Sample",
    type: "Story",
    isSubtask: false,
    status: "In Progress",
    statusCategory: "In Progress",
    epicKey: "DEMO-100",
    points: null,
    dueDate: null,
    created: d("2026-01-01T00:00:00Z"),
    updated: d("2026-01-01T00:00:00Z"),
    flagged: false,
    transitions: [],
    flagEvents: [],
    ...overrides,
  };
}
