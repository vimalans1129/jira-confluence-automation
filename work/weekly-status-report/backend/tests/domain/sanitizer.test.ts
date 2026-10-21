import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  NEUTRAL_PLACEHOLDER,
  sanitizeText,
  truncateText,
  sanitizeMitigation,
} from "../../src/domain/sanitizer.js";

describe("sanitizeText", () => {
  it("replaces Jira account mention markup", () => {
    const out = sanitizeText("Waiting on [~accountid:5b10ac8d82e05b22cc7d4ef5] for review");
    expect(out).toBe(`Waiting on ${NEUTRAL_PLACEHOLDER} for review`);
  });

  it("replaces legacy username mentions and plain @mentions", () => {
    expect(sanitizeText("ping [~jsmith] and @Jane.Doe today")).toBe(
      `ping ${NEUTRAL_PLACEHOLDER} and ${NEUTRAL_PLACEHOLDER} today`,
    );
  });

  it("replaces email addresses", () => {
    expect(sanitizeText("mail jane.doe@example.com now")).toBe(`mail ${NEUTRAL_PLACEHOLDER} now`);
  });

  it("replaces known names case-insensitively, longest first", () => {
    const out = sanitizeText("jane doe asked Jane about it", { names: ["Jane", "Jane Doe"] });
    expect(out).toBe(`${NEUTRAL_PLACEHOLDER} asked ${NEUTRAL_PLACEHOLDER} about it`);
  });

  it("redacts denylist terms the same way", () => {
    expect(sanitizeText("Blocked by Contoso vendor", { denylist: ["contoso"] })).toBe(
      `Blocked by ${NEUTRAL_PLACEHOLDER} vendor`,
    );
  });

  it("treats regex characters in names literally", () => {
    expect(sanitizeText("see A.B (x) now", { names: ["A.B (x)"] })).toBe(
      `see ${NEUTRAL_PLACEHOLDER} now`,
    );
    expect(sanitizeText("axb", { names: ["a.b"] })).toBe("axb");
  });

  it("ignores empty and blank terms", () => {
    expect(sanitizeText("plain text", { names: ["", "  "], denylist: [""] })).toBe("plain text");
  });

  it("collapses whitespace and handles empty input", () => {
    expect(sanitizeText("  a \n\n b\t c ")).toBe("a b c");
    expect(sanitizeText("")).toBe("");
  });

  it("property: no known name survives in the output", () => {
    const word = fc.stringMatching(/^[A-Za-z]{3,12}$/);
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 4 }),
        fc.array(fc.string({ maxLength: 12 }), { maxLength: 6 }),
        fc.nat({ max: 5 }),
        (names, fillers, pos) => {
          const parts = [...fillers];
          parts.splice(Math.min(pos, parts.length), 0, ...names.map((n) => n.toUpperCase()));
          const out = sanitizeText(parts.join(" "), { names }).toLowerCase();
          const safe = names.every((n) => !NEUTRAL_PLACEHOLDER.includes(n.toLowerCase()));
          return !safe || names.every((n) => !out.includes(n.toLowerCase()));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("truncateText", () => {
  it("leaves short text unchanged", () => {
    expect(truncateText("short", 300)).toBe("short");
  });

  it("truncates to the limit with an ellipsis", () => {
    const out = truncateText("x".repeat(500), 300);
    expect(out).toHaveLength(300);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not split a surrogate pair", () => {
    const out = truncateText("😀".repeat(10), 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out).not.toMatch(/[\uD800-\uDBFF]…$/);
  });

  it("rejects a non-positive limit", () => {
    expect(() => truncateText("abc", 0)).toThrow(RangeError);
  });
});

describe("sanitizeMitigation", () => {
  it("sanitizes first, then truncates, so a cut name cannot leak", () => {
    const text = `${"a".repeat(295)} Jonathan Smithers`;
    const out = sanitizeMitigation(text, { names: ["Jonathan Smithers"] }, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).not.toMatch(/Jonathan|Smith/i);
  });

  it("defaults to 300 characters", () => {
    expect(sanitizeMitigation("y".repeat(1000), {})).toHaveLength(300);
  });
});
