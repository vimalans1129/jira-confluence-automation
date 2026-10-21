import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors.js";
import {
  currentPeriod,
  defaultPeriod,
  formatInstant,
  isValidTimeZone,
  nextWeekRange,
  parseTimeZone,
  periodForDate,
  toReportPeriod,
} from "../../src/domain/period.js";

const iso = (d: Date) => d.toISOString();

describe("time zone validation", () => {
  it.each(["Europe/Berlin", "UTC", "America/New_York", "Asia/Kolkata"])("accepts %s", (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
    expect(parseTimeZone(tz)).toBeTruthy();
  });

  it.each(["", "  ", "Mars/Phobos", "+05:00", "GMT+2", "Europe/Berlin; DROP", "Berlin"])(
    "rejects %j",
    (tz) => {
      expect(isValidTimeZone(tz)).toBe(false);
      expect(() => parseTimeZone(tz)).toThrow(AppError);
    },
  );

  it("rejects non-string input", () => {
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it("normalizes the case of a valid name", () => {
    expect(parseTimeZone("europe/berlin")).toBe("Europe/Berlin");
  });

  it("reports a stable error code", () => {
    try {
      parseTimeZone("Nope/Zone");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("INVALID_TIME_ZONE");
      expect((e as AppError).status).toBe(400);
    }
  });
});

describe("defaultPeriod", () => {
  it("is the most recent completed Monday to Sunday week", () => {
    const p = defaultPeriod(new Date("2026-10-21T08:00:00Z"), "Europe/Berlin");
    expect(p.weekStart).toBe("2026-10-12");
    expect(p.weekEnd).toBe("2026-10-18");
    expect(p.isCurrentWeek).toBe(false);
    expect(iso(p.asOf)).toBe(iso(p.end));
  });

  it("uses the configured zone, not the server zone, to decide the week", () => {
    // Sunday 22:30 UTC is already Monday 00:30 in Berlin, so last week is complete there.
    const now = new Date("2026-10-18T22:30:00Z");
    expect(defaultPeriod(now, "Europe/Berlin").weekStart).toBe("2026-10-12");
    expect(defaultPeriod(now, "UTC").weekStart).toBe("2026-10-05");
    expect(defaultPeriod(now, "America/Los_Angeles").weekStart).toBe("2026-10-05");
  });

  it("treats Sunday 23:59:59.999 as still inside the current week", () => {
    const berlinSundayEnd = new Date("2026-10-18T21:59:59.999Z");
    expect(defaultPeriod(berlinSundayEnd, "Europe/Berlin").weekStart).toBe("2026-10-05");
    const berlinMonday = new Date("2026-10-18T22:00:00.000Z");
    expect(defaultPeriod(berlinMonday, "Europe/Berlin").weekStart).toBe("2026-10-12");
  });

  it("crosses month and year boundaries", () => {
    const p = defaultPeriod(new Date("2027-01-05T12:00:00Z"), "UTC");
    expect(p.weekStart).toBe("2026-12-28");
    expect(p.weekEnd).toBe("2027-01-03");
  });

  it("handles a half-hour offset zone", () => {
    const p = defaultPeriod(new Date("2026-10-21T08:00:00Z"), "Asia/Kolkata");
    expect(iso(p.start)).toBe("2026-10-11T18:30:00.000Z");
    expect(iso(p.end)).toBe("2026-10-18T18:29:59.999Z");
  });
});

describe("currentPeriod", () => {
  it("is selectable and uses the current time as as_of", () => {
    const now = new Date("2026-10-21T08:00:00Z");
    const p = currentPeriod(now, "Europe/Berlin");
    expect(p.weekStart).toBe("2026-10-19");
    expect(p.weekEnd).toBe("2026-10-25");
    expect(p.isCurrentWeek).toBe(true);
    expect(iso(p.asOf)).toBe(iso(now));
  });
});

describe("periodForDate", () => {
  const now = new Date("2026-10-21T08:00:00Z");

  it("returns the week containing any date, Monday through Sunday", () => {
    for (const d of ["2026-09-28", "2026-09-30", "2026-10-04"]) {
      const p = periodForDate(d, "Europe/Berlin", now);
      expect(p.weekStart).toBe("2026-09-28");
      expect(p.weekEnd).toBe("2026-10-04");
    }
  });

  it("uses the period end as as_of for a past week", () => {
    const p = periodForDate("2026-10-14", "Europe/Berlin", now);
    expect(p.isCurrentWeek).toBe(false);
    expect(iso(p.asOf)).toBe("2026-10-18T21:59:59.999Z");
  });

  it("uses now as as_of for the week containing now", () => {
    const p = periodForDate("2026-10-25", "Europe/Berlin", now);
    expect(p.isCurrentWeek).toBe(true);
    expect(iso(p.asOf)).toBe(iso(now));
  });

  it("rejects future weeks and malformed or impossible dates", () => {
    expect(() => periodForDate("2026-10-26", "Europe/Berlin", now)).toThrow(AppError);
    expect(() => periodForDate("2026-02-30", "UTC", now)).toThrow(AppError);
    expect(() => periodForDate("21/10/2026", "UTC", now)).toThrow(AppError);
    expect(() => periodForDate("2026-10-14", "Bad/Zone", now)).toThrow(AppError);
  });

  it("spans a daylight-saving end (25-hour day) in Europe/Berlin", () => {
    const p = periodForDate("2026-10-22", "Europe/Berlin", new Date("2026-11-10T00:00:00Z"));
    expect(p.weekStart).toBe("2026-10-19");
    expect(iso(p.start)).toBe("2026-10-18T22:00:00.000Z");
    expect(iso(p.end)).toBe("2026-10-25T22:59:59.999Z");
  });

  it("spans a daylight-saving start (23-hour day) in Europe/Berlin", () => {
    const p = periodForDate("2026-03-25", "Europe/Berlin", new Date("2026-04-10T00:00:00Z"));
    expect(p.weekStart).toBe("2026-03-23");
    expect(iso(p.start)).toBe("2026-03-22T23:00:00.000Z");
    expect(iso(p.end)).toBe("2026-03-29T21:59:59.999Z");
  });

  it("handles US daylight-saving end in America/New_York", () => {
    const p = periodForDate("2026-10-28", "America/New_York", new Date("2026-12-01T00:00:00Z"));
    expect(p.weekStart).toBe("2026-10-26");
    expect(iso(p.start)).toBe("2026-10-26T04:00:00.000Z");
    expect(iso(p.end)).toBe("2026-11-02T04:59:59.999Z");
  });

  it("handles southern-hemisphere daylight-saving start in Australia/Sydney", () => {
    const p = periodForDate("2026-10-01", "Australia/Sydney", new Date("2026-12-01T00:00:00Z"));
    expect(p.weekStart).toBe("2026-09-28");
    expect(iso(p.start)).toBe("2026-09-27T14:00:00.000Z");
    expect(iso(p.end)).toBe("2026-10-04T12:59:59.999Z");
  });

  it("covers the whole week with no gap to the next one", () => {
    const later = new Date("2027-01-01T00:00:00Z");
    const a = periodForDate("2026-10-22", "Europe/Berlin", later);
    const b = periodForDate("2026-10-29", "Europe/Berlin", later);
    expect(b.start.getTime() - a.end.getTime()).toBe(1);
  });
});

describe("nextWeekRange", () => {
  it("returns the following Monday to Sunday in the same zone", () => {
    const p = periodForDate("2026-10-14", "Europe/Berlin", new Date("2026-10-21T08:00:00Z"));
    const next = nextWeekRange(p);
    expect(next.weekStart).toBe("2026-10-19");
    expect(next.weekEnd).toBe("2026-10-25");
    expect(iso(next.start)).toBe("2026-10-18T22:00:00.000Z");
    expect(iso(next.end)).toBe("2026-10-25T22:59:59.999Z");
  });

  it("crosses a year boundary", () => {
    const p = periodForDate("2026-12-23", "UTC", new Date("2027-02-01T00:00:00Z"));
    expect(nextWeekRange(p).weekStart).toBe("2026-12-28");
    expect(nextWeekRange(p).weekEnd).toBe("2027-01-03");
  });
});

describe("report mapping", () => {
  it("formats instants with the zone offset", () => {
    expect(formatInstant(new Date("2026-10-18T21:59:59.999Z"), "Europe/Berlin")).toBe(
      "2026-10-18T23:59:59.999+02:00",
    );
    expect(formatInstant(new Date("2026-10-25T22:59:59.999Z"), "Europe/Berlin")).toBe(
      "2026-10-25T23:59:59.999+01:00",
    );
    expect(formatInstant(new Date("2026-10-18T18:29:59.999Z"), "Asia/Kolkata")).toBe(
      "2026-10-18T23:59:59.999+05:30",
    );
    expect(formatInstant(new Date("2026-10-18T10:00:00Z"), "UTC")).toBe(
      "2026-10-18T10:00:00.000+00:00",
    );
  });

  it("produces a period that matches the report contract fields", () => {
    const p = defaultPeriod(new Date("2026-10-21T08:00:00Z"), "Europe/Berlin");
    const mapped = toReportPeriod(p);
    expect(mapped).toEqual({
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      timeZone: "Europe/Berlin",
      asOf: "2026-10-18T23:59:59.999+02:00",
      isCurrentWeek: false,
    });
  });
});
