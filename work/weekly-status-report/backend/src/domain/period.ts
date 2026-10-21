import { AppError } from "../errors.js";

const DAY_MS = 86_400_000;

export interface ReportPeriod {
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  start: Date;
  end: Date;
  asOf: Date;
  isCurrentWeek: boolean;
}

export interface WeekRange {
  weekStart: string;
  weekEnd: string;
  start: Date;
  end: Date;
}

const ZONE_SHAPE = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/i;

export function isValidTimeZone(value: unknown): boolean {
  return canonicalZone(value) !== null;
}

function canonicalZone(value: unknown): string | null {
  if (typeof value !== "string" || !ZONE_SHAPE.test(value)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function parseTimeZone(value: unknown): string {
  const zone = canonicalZone(value);
  if (!zone) {
    throw new AppError(400, "INVALID_TIME_ZONE", "Time zone must be a valid IANA name.");
  }
  return zone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, zone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out["year"] ?? 0,
    month: out["month"] ?? 0,
    day: out["day"] ?? 0,
    hour: out["hour"] ?? 0,
    minute: out["minute"] ?? 0,
    second: out["second"] ?? 0,
  };
}

function offsetMs(instant: Date, zone: string): number {
  const p = localParts(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function startOfLocalDate(date: string, zone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const first = guess - offsetMs(new Date(guess), zone);
  const second = guess - offsetMs(new Date(first), zone);
  return new Date(second);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function localDate(instant: Date, zone: string): string {
  const p = localParts(instant, zone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function mondayOf(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const dow = new Date(ms).getUTCDay();
  return isoDate(ms - ((dow + 6) % 7) * DAY_MS);
}

function addDays(date: string, days: number): string {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

function weekRange(monday: string, zone: string): WeekRange {
  const start = startOfLocalDate(monday, zone);
  const end = new Date(startOfLocalDate(addDays(monday, 7), zone).getTime() - 1);
  return { weekStart: monday, weekEnd: addDays(monday, 6), start, end };
}

export function defaultPeriod(now: Date, timeZone: string): ReportPeriod {
  const zone = parseTimeZone(timeZone);
  const monday = addDays(mondayOf(localDate(now, zone)), -7);
  const range = weekRange(monday, zone);
  return { ...range, timeZone: zone, asOf: range.end, isCurrentWeek: false };
}

export function currentPeriod(now: Date, timeZone: string): ReportPeriod {
  const zone = parseTimeZone(timeZone);
  const range = weekRange(mondayOf(localDate(now, zone)), zone);
  return { ...range, timeZone: zone, asOf: now, isCurrentWeek: true };
}

export function periodForDate(date: string, timeZone: string, now: Date): ReportPeriod {
  const zone = parseTimeZone(timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isoDate(Date.parse(`${date}T00:00:00Z`)) !== date) {
    throw new AppError(400, "INVALID_DATE", "Date must be a real calendar date (YYYY-MM-DD).");
  }
  const range = weekRange(mondayOf(date), zone);
  if (range.start.getTime() > now.getTime()) {
    throw new AppError(400, "FUTURE_PERIOD", "The reporting week must not be in the future.");
  }
  const isCurrentWeek = now.getTime() <= range.end.getTime();
  return { ...range, timeZone: zone, asOf: isCurrentWeek ? now : range.end, isCurrentWeek };
}

export function nextWeekRange(period: Pick<ReportPeriod, "weekStart" | "timeZone">): WeekRange {
  return weekRange(addDays(period.weekStart, 7), period.timeZone);
}

export function formatInstant(instant: Date, timeZone: string): string {
  const zone = parseTimeZone(timeZone);
  const p = localParts(instant, zone);
  const offset = Math.round(offsetMs(instant, zone) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const ms = pad(((instant.getTime() % 1000) + 1000) % 1000, 3);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T` +
    `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${ms}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function toReportPeriod(period: ReportPeriod) {
  return {
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    timeZone: period.timeZone,
    asOf: formatInstant(period.asOf, period.timeZone),
    isCurrentWeek: period.isCurrentWeek,
  };
}
