import { describe, expect, it } from "vitest";

import {
  coversSameWindow,
  localNow,
  monthToDatePeriod,
  parseScheduleHour,
  reportPeriod,
  shouldSendAt
} from "./report-schedule.ts";

describe("localNow", () => {
  it("converts UTC to Sao Paulo local date and hour", () => {
    // 2026-07-15T01:30Z = 2026-07-14 22:30 em SP (UTC-3).
    expect(localNow(new Date("2026-07-15T01:30:00Z"))).toEqual({ date: "2026-07-14", hour: 22 });
    expect(localNow(new Date("2026-07-15T23:05:00Z"))).toEqual({ date: "2026-07-15", hour: 20 });
  });
});

describe("parseScheduleHour", () => {
  it("parses the hour and falls back to 20", () => {
    expect(parseScheduleHour("08:00")).toBe(8);
    expect(parseScheduleHour("20:30")).toBe(20);
    expect(parseScheduleHour(null)).toBe(20);
    expect(parseScheduleHour("abc")).toBe(20);
    expect(parseScheduleHour("99:00")).toBe(20);
  });
});

describe("shouldSendAt", () => {
  it("sends daily reports only at the recipient hour", () => {
    const base = { frequency: "daily", scheduleTime: "20:00", nowDate: "2026-07-15" };
    expect(shouldSendAt({ ...base, nowHour: 20 })).toBe(true);
    expect(shouldSendAt({ ...base, nowHour: 8 })).toBe(false);
  });

  it("sends weekly reports only on Fridays", () => {
    const base = { frequency: "weekly", scheduleTime: "08:00", nowHour: 8 };
    expect(shouldSendAt({ ...base, nowDate: "2026-07-17" })).toBe(true); // sexta
    expect(shouldSendAt({ ...base, nowDate: "2026-07-16" })).toBe(false); // quinta
  });

  it("sends monthly reports only on the 1st", () => {
    const base = { frequency: "monthly", scheduleTime: "07:00", nowHour: 7 };
    expect(shouldSendAt({ ...base, nowDate: "2026-08-01" })).toBe(true);
    expect(shouldSendAt({ ...base, nowDate: "2026-08-02" })).toBe(false);
  });

  it("rejects unknown frequencies", () => {
    expect(
      shouldSendAt({
        frequency: "hourly",
        scheduleTime: "08:00",
        nowDate: "2026-07-15",
        nowHour: 8
      })
    ).toBe(false);
  });
});

describe("reportPeriod", () => {
  it("covers the reference day for daily reports (Sao Paulo boundaries)", () => {
    const period = reportPeriod("daily", "2026-07-15");
    expect(period.start).toBe("2026-07-15");
    expect(period.endExclusive).toBe("2026-07-16");
    expect(period.startUtc).toBe("2026-07-15T03:00:00.000Z");
    expect(period.endUtc).toBe("2026-07-16T03:00:00.000Z");
    expect(period.label).toBe("15/07/2026");
    expect(period.frequencyLabel).toBe("diario");
  });

  it("covers the previous 7 days (Fri-Thu) for weekly reports", () => {
    // Enviado na sexta 17/07 → cobre 10/07 a 16/07.
    const period = reportPeriod("weekly", "2026-07-17");
    expect(period.start).toBe("2026-07-10");
    expect(period.endExclusive).toBe("2026-07-17");
    expect(period.label).toBe("10/07/2026 a 16/07/2026");
    expect(period.frequencyLabel).toBe("semanal");
  });

  it("covers the previous month for monthly reports", () => {
    const period = reportPeriod("monthly", "2026-07-01");
    expect(period.start).toBe("2026-06-01");
    expect(period.endExclusive).toBe("2026-07-01");
    expect(period.label).toBe("junho/2026");
    expect(period.frequencyLabel).toBe("mensal");
  });

  it("handles january for monthly reports", () => {
    const period = reportPeriod("monthly", "2026-01-01");
    expect(period.start).toBe("2025-12-01");
    expect(period.endExclusive).toBe("2026-01-01");
    expect(period.label).toBe("dezembro/2025");
  });
});

describe("monthToDatePeriod", () => {
  it("covers the current month up to the reference day (inclusive)", () => {
    const period = monthToDatePeriod("2026-07-15");
    expect(period.start).toBe("2026-07-01");
    expect(period.endExclusive).toBe("2026-07-16");
    expect(period.startUtc).toBe("2026-07-01T03:00:00.000Z");
    expect(period.endUtc).toBe("2026-07-16T03:00:00.000Z");
    expect(period.label).toBe("julho/2026 (ate 15/07/2026)");
  });

  it("covers only the 1st on the first day of the month", () => {
    const period = monthToDatePeriod("2026-08-01");
    expect(period.start).toBe("2026-08-01");
    expect(period.endExclusive).toBe("2026-08-02");
    expect(period.label).toBe("agosto/2026 (ate 01/08/2026)");
  });

  it("does not spill into the previous month", () => {
    expect(monthToDatePeriod("2026-01-05").start).toBe("2026-01-01");
  });
});

describe("coversSameWindow", () => {
  it("detects the daily report that already is the month accumulation", () => {
    // Dia 1: o diario cobre exatamente 01/08 — o mesmo que o acumulado do mes.
    expect(
      coversSameWindow(reportPeriod("daily", "2026-08-01"), monthToDatePeriod("2026-08-01"))
    ).toBe(true);
    expect(
      coversSameWindow(reportPeriod("daily", "2026-08-12"), monthToDatePeriod("2026-08-12"))
    ).toBe(false);
    expect(
      coversSameWindow(reportPeriod("monthly", "2026-08-01"), monthToDatePeriod("2026-08-01"))
    ).toBe(false);
  });
});
