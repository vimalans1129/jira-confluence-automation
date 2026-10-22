import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { sampleReport } from "../src/contract/sampleReport.js";
import type { Report, ReportIssue } from "../src/contract/index.js";
import { MAX_SLIDES, NO_MITIGATION, buildDeck, truncate } from "../src/services/deckBuilder.js";

const BASE = "https://example.atlassian.net";

async function unpack(content: Buffer) {
  const zip = await JSZip.loadAsync(content);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const xml: string[] = [];
  for (const name of slides) xml.push(await zip.file(name)!.async("string"));
  return { zip, xml };
}

const text = (xml: string): string =>
  [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" ");

function issue(n: number): ReportIssue {
  return {
    key: `DEMO-${100 + n}`,
    summary: `Item ${n}`,
    type: "Story",
    status: "Done",
    statusCategory: "Done",
    epicKey: "DEMO-1",
    epicName: "Data migration",
    points: 1,
    dueDate: null,
  };
}

function withIssues(count: number): Report {
  const issues = Array.from({ length: count }, (_, i) => issue(i));
  return {
    ...sampleReport,
    completed: [{ epicKey: "DEMO-1", epicName: "Data migration", points: count, issues }],
  };
}

describe("deck builder", () => {
  it("emits the slides in order with the right file name", async () => {
    const deck = await buildDeck(sampleReport, { jiraBaseUrl: BASE });
    expect(deck.fileName).toBe("Weekly_Status_DEMO_2026-10-12.pptx");
    const { xml } = await unpack(deck.content);
    const titles = xml.map((x) => text(x));
    expect(xml).toHaveLength(deck.slideCount);
    expect(titles[0]).toContain("Demo Weekly Status");
    expect(titles[1]).toContain("Executive summary");
    expect(titles[2]).toContain("Milestone progress");
    expect(titles[3]).toContain("Completed this week");
    expect(titles[4]).toContain("Planned next week");
    expect(titles[5]).toContain("Key risks and issues");
    expect(titles[6]).toContain("Trend");
    expect(titles[titles.length - 1]).toContain("Appendix");
  });

  it("shows RAG and percent complete per week on slide 7", async () => {
    const trend = [
      {
        weekStart: "2026-10-05",
        overallRag: "Amber" as const,
        percentComplete: 40.5,
        blockerCount: 2,
        epics: [],
      },
      {
        weekStart: "2026-10-12",
        overallRag: "Green" as const,
        percentComplete: 55,
        blockerCount: 0,
        epics: [],
      },
    ];
    const { xml } = await unpack((await buildDeck(sampleReport, { trend })).content);
    const slide = text(xml[6]!);
    expect(slide).toContain("2026-10-05");
    expect(slide).toContain("Amber");
    expect(slide).toContain("40.5%");
    expect(slide).toContain("Green");
    expect(slide).toContain("55%");
  });

  it("says so on slide 7 when there is no earlier week", async () => {
    const { xml } = await unpack((await buildDeck(sampleReport)).content);
    expect(text(xml[6]!)).toContain("No earlier weeks");
  });

  it("marks overridden statuses and lists the reason and calculated RAG", async () => {
    const report: Report = {
      ...sampleReport,
      epics: sampleReport.epics.map((e, i) =>
        i === 0
          ? {
              ...e,
              rag: {
                ...e.rag,
                calculated: "Green",
                effective: "Red",
                overridden: true,
                overrideReason: "Vendor slip",
              },
            }
          : e,
      ),
      overrides: [
        {
          scope: "epic",
          epicKey: sampleReport.epics[0]!.epicKey,
          rag: "Red",
          reason: "Vendor slip",
        },
      ],
    };
    const { xml } = await unpack((await buildDeck(report)).content);
    expect(text(xml[2]!)).toContain("Red*");
    const appendix = text(xml[xml.length - 1]!);
    expect(appendix).toContain("calculated Green");
    expect(appendix).toContain("Vendor slip");
  });

  it("is 16:9 and uses at least 24pt titles and 12pt body text", async () => {
    const { zip, xml } = await unpack((await buildDeck(sampleReport)).content);
    const presentation = await zip.file("ppt/presentation.xml")!.async("string");
    const size = presentation.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/)!;
    expect(Number(size[1]) / Number(size[2])).toBeCloseTo(16 / 9, 2);
    const sizes = xml.flatMap((x) =>
      [...x.matchAll(/ sz="(\d+)"/g)].map((m) => Number(m[1]) / 100),
    );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    expect(xml.slice(1).every((x) => /sz="(2[4-9]|[3-9]\d)00"/.test(x))).toBe(true);
  });

  it("shows RAG as text, n/a for deltas and the no-mitigation marker", async () => {
    const report: Report = {
      ...sampleReport,
      blockers: [
        {
          key: "DEMO-7",
          summary: "Waiting on vendor",
          epicKey: "DEMO-1",
          epicName: "Data migration",
          ageDays: 3,
          reason: "flagged",
          mitigation: null,
        },
      ],
    };
    const { xml } = await unpack((await buildDeck(report)).content);
    const all = xml.map(text).join(" ");
    expect(all).toContain("Amber");
    expect(all).toContain("n/a");
    expect(all).toContain(NO_MITIGATION);
    expect(all).toContain("3 days");
  });

  it("links issue keys to Jira", async () => {
    const { zip } = await unpack(
      (await buildDeck(withIssues(2), { jiraBaseUrl: `${BASE}/` })).content,
    );
    const rels = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => n.startsWith("ppt/slides/_rels/") && n.endsWith(".rels"))
        .map((n) => zip.file(n)!.async("string")),
    );
    expect(rels.join(" ")).toContain(`${BASE}/browse/DEMO-100`);
  });

  it("limits tables to 10 rows per slide and continues across slides", async () => {
    const deck = await buildDeck(withIssues(25), { jiraBaseUrl: BASE });
    const { xml } = await unpack(deck.content);
    const completed = xml.filter((x) => text(x).includes("Completed this week"));
    expect(completed.length).toBeGreaterThan(1);
    for (const x of completed) expect((x.match(/<a:tr /g) ?? []).length).toBeLessThanOrEqual(11);
    expect(completed.map(text).join(" ")).toContain("(1/");
  });

  it("caps the deck at 25 slides, summarizes the rest and warns", async () => {
    const deck = await buildDeck(withIssues(400), { jiraBaseUrl: BASE });
    const { xml } = await unpack(deck.content);
    expect(xml.length).toBeLessThanOrEqual(MAX_SLIDES);
    expect(deck.warnings.map((w) => w.code)).toContain("DECK_TRUNCATED");
    expect(xml.map(text).join(" ")).toMatch(/\+ \d+ more rows not shown/);
  });

  it("truncates long text with an ellipsis", () => {
    expect(truncate("a".repeat(100), 10)).toBe("aaaaaaaaa\u2026");
    expect(truncate("short", 10)).toBe("short");
  });

  it("contains no person names or mention markers", async () => {
    const report: Report = {
      ...sampleReport,
      blockers: [
        {
          key: "DEMO-7",
          summary: "Vendor access",
          epicKey: null,
          epicName: "No Epic",
          ageDays: 1,
          reason: "flagged",
          mitigation: "Escalated to the vendor",
        },
      ],
    };
    const { xml } = await unpack((await buildDeck(report)).content);
    const all = xml.map(text).join(" ");
    expect(all).not.toMatch(/\[~accountid|@example\.com|accountId/i);
  });
});
