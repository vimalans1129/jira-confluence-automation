import PptxGenJSModule from "pptxgenjs";
import { NOT_AVAILABLE, type Rag, type Report } from "../contract/index.js";

export const MAX_ROWS_PER_SLIDE = 10;
export const MAX_SLIDES = 25;
export const NO_MITIGATION = "No mitigation recorded";
const TITLE_PT = 28;
const BODY_PT = 12;
const MARGIN = 0.5;
const SLIDE_W = 10;

const RAG_STYLE: Record<Rag, { fill: string; color: string }> = {
  Green: { fill: "2E7D32", color: "FFFFFF" },
  Amber: { fill: "FFC107", color: "000000" },
  Red: { fill: "C62828", color: "FFFFFF" },
};

// The package types describe an ES default export, but under NodeNext the import is the CJS module itself.
const PptxGenJS = PptxGenJSModule as unknown as typeof PptxGenJSModule.default;
type PptxSlide = ReturnType<InstanceType<typeof PptxGenJS>["addSlide"]>;
type PptxTable = Parameters<PptxSlide["addTable"]>[0];

type Cell = { text: string; options?: Record<string, unknown> };
type Row = Cell[];
interface Section {
  title: string;
  header: string[];
  widths: number[];
  rows: Row[];
  emptyText: string;
}
interface Page {
  section: Section;
  rows: Row[];
  part: number;
  parts: number;
  note?: string;
}

export interface BuiltDeck {
  fileName: string;
  content: Buffer;
  warnings: { code: string; message: string }[];
  slideCount: number;
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`;
}

export function deckFileName(report: Pick<Report, "projectKey" | "weekStart">): string {
  return `Weekly_Status_${report.projectKey}_${report.weekStart}.pptx`;
}

const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function ragCell(rag: Rag): Cell {
  const style = RAG_STYLE[rag];
  return { text: rag, options: { bold: true, fill: { color: style.fill }, color: style.color } };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildDeck(
  report: Report,
  options: { jiraBaseUrl?: string | null } = {},
): Promise<BuiltDeck> {
  const base = options.jiraBaseUrl?.replace(/\/+$/, "") ?? null;
  const keyCell = (key: string): Cell => ({
    text: key,
    options: base
      ? {
          hyperlink: { url: `${base}/browse/${encodeURIComponent(key)}`, tooltip: key },
          color: "0B57D0",
        }
      : {},
  });

  const sections: Section[] = [
    {
      title: "Milestone progress",
      header: ["Epic", "RAG", "% complete", "Done / total", "Due", "Delta"],
      widths: [3.2, 0.8, 1.0, 1.4, 1.1, 0.5],
      emptyText: "No epics found for this project.",
      rows: report.epics.map((epic) => [
        { text: truncate(epic.name, 40) },
        ragCell(epic.rag.effective),
        { text: `${fmt(epic.percentComplete)}%` },
        {
          text: `${fmt(epic.doneUnits)} / ${fmt(epic.totalUnits)} ${epic.basis === "points" ? "pts" : "items"}`,
        },
        { text: epic.dueDate ?? "No due date" },
        { text: epic.percentDelta === NOT_AVAILABLE ? NOT_AVAILABLE : `${epic.percentDelta}` },
      ]),
    },
    groupedSection(
      "Completed this week",
      report.completed,
      "Nothing was completed this week.",
      keyCell,
    ),
    groupedSection(
      "Planned next week",
      report.planned,
      "Nothing is planned for next week.",
      keyCell,
    ),
    {
      title: "Key risks and issues",
      header: ["Key", "Summary", "Workstream", "Age", "Mitigation plan"],
      widths: [1.0, 2.4, 1.5, 0.7, 3.4],
      emptyText: "No open flagged or blocked items.",
      rows: report.blockers.map((b) => [
        keyCell(b.key),
        { text: truncate(b.summary, 40) },
        { text: truncate(b.epicName, 22) },
        { text: plural(b.ageDays, "day") },
        { text: b.mitigation ? truncate(b.mitigation, 90) : NO_MITIGATION },
      ]),
    },
  ];

  const warnings: BuiltDeck["warnings"] = [];
  const pages = paginate(sections, warnings);

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = `${report.reportName} ${report.weekStart}`;

  const newSlide = (title: string): PptxSlide => {
    const slide = pptx.addSlide();
    slide.addText(title, {
      x: MARGIN,
      y: 0.3,
      w: SLIDE_W - 2 * MARGIN,
      h: 0.6,
      fontSize: TITLE_PT,
      bold: true,
      color: "1F2937",
    });
    return slide;
  };

  const overallStyle = RAG_STYLE[report.overall.rag.effective];

  // 1 Title
  const title = pptx.addSlide();
  title.addText(truncate(report.reportName, 60), {
    x: MARGIN,
    y: 1.6,
    w: SLIDE_W - 2 * MARGIN,
    h: 0.9,
    fontSize: 36,
    bold: true,
  });
  title.addText(`Week of ${report.weekStart} to ${report.weekEnd}`, {
    x: MARGIN,
    y: 2.6,
    w: SLIDE_W - 2 * MARGIN,
    h: 0.5,
    fontSize: 24,
  });
  title.addText(
    `Project ${report.projectKey} \u00b7 Generated ${report.generatedAt.slice(0, 10)}`,
    {
      x: MARGIN,
      y: 3.2,
      w: SLIDE_W - 2 * MARGIN,
      h: 0.4,
      fontSize: 14,
    },
  );

  // 2 Executive summary
  const exec = newSlide("Executive summary");
  exec.addText(
    [
      { text: "Overall status: ", options: { bold: true } },
      {
        text: ` ${report.overall.rag.effective} `,
        options: { bold: true, color: overallStyle.color, highlight: overallStyle.fill },
      },
      { text: `   Change vs last week: ${report.overall.ragChange}`, options: {} },
    ],
    { x: MARGIN, y: 1.0, w: SLIDE_W - 2 * MARGIN, h: 0.4, fontSize: 16 },
  );
  const open = report.epics.filter((e) => !e.complete).length;
  const highlights = [
    `${plural(report.epics.length, "epic")} tracked, ${open} not yet complete`,
    `${plural(
      report.completed.reduce((n, g) => n + g.issues.length, 0),
      "item",
    )} completed this week`,
    `${plural(
      report.planned.reduce((n, g) => n + g.issues.length, 0),
      "item",
    )} planned next week`,
    `${plural(report.blockers.length, "open blocker")}`,
    `Bugs: ${report.bugs.opened} opened, ${report.bugs.closed} closed, ${report.bugs.currentlyOpen} currently open`,
    ...report.overall.rag.reasons.slice(0, 3).map((r) => truncate(r, 110)),
  ];
  if (report.summary?.approved && report.summary.text)
    highlights.push(truncate(report.summary.text, 300));
  exec.addText(
    highlights.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
    { x: MARGIN, y: 1.6, w: SLIDE_W - 2 * MARGIN, h: 3.4, fontSize: BODY_PT + 2, valign: "top" },
  );

  // 3-6 tables
  for (const page of pages) {
    const heading =
      page.parts > 1 ? `${page.section.title} (${page.part}/${page.parts})` : page.section.title;
    const slide = newSlide(heading);
    if (page.rows.length === 0) {
      slide.addText(page.section.emptyText, {
        x: MARGIN,
        y: 1.2,
        w: SLIDE_W - 2 * MARGIN,
        h: 0.5,
        fontSize: BODY_PT + 2,
      });
      continue;
    }
    const head: Row = page.section.header.map((text) => ({
      text,
      options: { bold: true, fill: { color: "E5E7EB" } },
    }));
    slide.addTable([head, ...page.rows] as unknown as PptxTable, {
      x: MARGIN,
      y: 1.1,
      w: page.section.widths.reduce((a, b) => a + b, 0),
      colW: page.section.widths,
      fontSize: BODY_PT,
      border: { type: "solid", pt: 0.5, color: "BDBDBD" },
      valign: "middle",
    });
    if (page.note) {
      slide.addText(page.note, {
        x: MARGIN,
        y: 4.9,
        w: SLIDE_W - 2 * MARGIN,
        h: 0.4,
        fontSize: BODY_PT,
        italic: true,
      });
    }
  }

  // 8 Appendix
  const appendix = newSlide("Appendix");
  const notes = [
    "RAG rules: Red when overdue or at risk beyond thresholds, Amber when behind plan, Green otherwise.",
    `Time zone: ${report.timeZone}. Data as of ${report.asOf}.`,
    ...report.overrides.map(
      (o) =>
        `Override (${o.scope}${o.epicKey ? ` ${o.epicKey}` : ""}): ${o.rag}. ${truncate(o.reason, 120)}`,
    ),
    ...[...report.warnings, ...warnings].map((w) =>
      truncate(`Warning ${w.code}: ${w.message}`, 140),
    ),
  ].slice(0, 9);
  appendix.addText(
    notes.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
    { x: MARGIN, y: 1.1, w: SLIDE_W - 2 * MARGIN, h: 4.0, fontSize: BODY_PT, valign: "top" },
  );

  return pptx.write({ outputType: "nodebuffer" }).then((content: unknown) => ({
    fileName: deckFileName(report),
    content: content as Buffer,
    warnings,
    slideCount: 3 + pages.length,
  }));
}

function groupedSection(
  title: string,
  groups: Report["completed"],
  emptyText: string,
  keyCell: (key: string) => Cell,
): Section {
  const rows: Row[] = [];
  for (const group of groups) {
    rows.push([
      {
        text: `${truncate(group.epicName, 50)} (${fmt(group.points)} pts)`,
        options: { bold: true, colspan: 4 },
      },
    ]);
    for (const issue of group.issues) {
      rows.push([
        keyCell(issue.key),
        { text: truncate(issue.summary, 60) },
        { text: issue.status },
        { text: issue.points === null ? "\u2013" : fmt(issue.points) },
      ]);
    }
  }
  return {
    title,
    header: ["Key", "Summary", "Status", "Pts"],
    widths: [1.1, 5.2, 1.7, 1.0],
    rows,
    emptyText,
  };
}

function paginate(sections: Section[], warnings: BuiltDeck["warnings"]): Page[] {
  const fixedSlides = 3; // title, executive summary, appendix
  const perSection = sections.map((section) => {
    const chunks = chunk(section.rows, MAX_ROWS_PER_SLIDE);
    return { section, chunks: chunks.length ? chunks : [[]], omittedRows: 0 };
  });
  const total = (): number => fixedSlides + perSection.reduce((n, s) => n + s.chunks.length, 0);
  while (total() > MAX_SLIDES) {
    const longest = perSection.reduce((a, b) => (b.chunks.length > a.chunks.length ? b : a));
    if (longest.chunks.length <= 1) break;
    longest.omittedRows += longest.chunks.pop()!.length;
  }
  const pages: Page[] = [];
  for (const s of perSection) {
    s.chunks.forEach((rows, i) => {
      const last = i === s.chunks.length - 1;
      pages.push({
        section: s.section,
        rows,
        part: i + 1,
        parts: s.chunks.length,
        note: last && s.omittedRows > 0 ? `+ ${s.omittedRows} more rows not shown` : undefined,
      });
    });
    if (s.omittedRows > 0) {
      warnings.push({
        code: "DECK_TRUNCATED",
        message: `${s.section.title}: ${s.omittedRows} rows omitted to stay within ${MAX_SLIDES} slides`,
      });
    }
  }
  return pages;
}
