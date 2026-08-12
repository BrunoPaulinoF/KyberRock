import { describe, expect, it } from "vitest";

import {
  addDays,
  billingToday,
  blockDateFor,
  clampDayOfMonth,
  closingOnOrAfter,
  daysInMonth,
  daysOverdue,
  dueDateFor,
  firstBillingPeriod,
  inclusiveDays,
  invoiceTotalCents,
  isOverdue,
  nextBillingPeriod,
  pendingBillingPeriods,
  previousClosing,
  proratedAmountCents,
  referenceLabel,
  resolveBillingConfig,
  resolveGraceDays,
  shouldBlockForOverdue,
  upcomingBillingPeriod
} from "./billing-cycle.ts";

describe("billingToday", () => {
  it("uses the Sao Paulo date, not the server date", () => {
    // 01:30Z ainda e o dia anterior em SP (UTC-3).
    expect(billingToday(new Date("2026-08-12T01:30:00Z"))).toBe("2026-08-11");
    expect(billingToday(new Date("2026-08-12T12:00:00Z"))).toBe("2026-08-12");
  });
});

describe("date helpers", () => {
  it("counts the days of each month", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("shortens the day to the last one of the month", () => {
    expect(clampDayOfMonth(2026, 2, 31)).toBe("2026-02-28");
    expect(clampDayOfMonth(2028, 2, 31)).toBe("2028-02-29");
    expect(clampDayOfMonth(2026, 8, 25)).toBe("2026-08-25");
    expect(clampDayOfMonth(2026, 8, 0)).toBe("2026-08-01");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts an interval with both ends included", () => {
    expect(inclusiveDays("2026-08-25", "2026-08-25")).toBe(1);
    expect(inclusiveDays("2026-07-26", "2026-08-25")).toBe(31);
  });

  it("labels the reference by the closing month", () => {
    expect(referenceLabel("2026-08-25")).toBe("08/2026");
  });
});

describe("closingOnOrAfter", () => {
  it("keeps the closing of the current month when it has not passed", () => {
    expect(closingOnOrAfter("2026-08-10", 25)).toBe("2026-08-25");
    expect(closingOnOrAfter("2026-08-25", 25)).toBe("2026-08-25");
  });

  it("moves to the next month once the closing day has passed", () => {
    expect(closingOnOrAfter("2026-08-26", 25)).toBe("2026-09-25");
  });

  it("closes on the last day of short months", () => {
    expect(closingOnOrAfter("2026-02-01", 31)).toBe("2026-02-28");
    expect(closingOnOrAfter("2026-01-31", 30)).toBe("2026-02-28");
  });
});

describe("previousClosing", () => {
  it("walks one closing back, shortening short months", () => {
    expect(previousClosing("2026-03-31", 31)).toBe("2026-02-28");
    expect(previousClosing("2026-02-28", 31)).toBe("2026-01-31");
    expect(previousClosing("2026-01-25", 25)).toBe("2025-12-25");
  });
});

describe("dueDateFor", () => {
  it("falls in the next month when the due day is not after the closing day", () => {
    expect(dueDateFor("2026-08-25", 25, 5)).toBe("2026-09-05");
    expect(dueDateFor("2026-12-25", 25, 10)).toBe("2027-01-10");
  });

  it("falls in the same month when the due day is after the closing day", () => {
    expect(dueDateFor("2026-08-05", 5, 20)).toBe("2026-08-20");
  });

  it("never lands on or before the closing date", () => {
    // Fechamento 28/02 (dia 28) com vencimento no dia 30: o "mesmo mes" cairia
    // em 28/02 pelo encurtamento, entao empurra para marco.
    expect(dueDateFor("2026-02-28", 28, 30)).toBe("2026-03-30");
    expect(dueDateFor("2026-01-31", 31, 31)).toBe("2026-02-28");
  });
});

describe("firstBillingPeriod", () => {
  it("prorates from the go-live date to the first closing", () => {
    const period = firstBillingPeriod({ startDate: "2026-08-05", closingDay: 25, dueDay: 5 });
    expect(period).toEqual({
      periodStart: "2026-08-05",
      periodEnd: "2026-08-25",
      closingDate: "2026-08-25",
      dueDate: "2026-09-05",
      billedDays: 21,
      fullPeriodDays: 31,
      isProrated: true,
      referenceLabel: "08/2026"
    });
  });

  it("is a full cycle when the go-live date is the day after a closing", () => {
    const period = firstBillingPeriod({ startDate: "2026-08-26", closingDay: 25, dueDay: 5 });
    expect(period.periodStart).toBe("2026-08-26");
    expect(period.periodEnd).toBe("2026-09-25");
    expect(period.billedDays).toBe(31);
    expect(period.isProrated).toBe(false);
  });

  it("charges a single day when the go-live date is the closing day itself", () => {
    const period = firstBillingPeriod({ startDate: "2026-08-25", closingDay: 25, dueDay: 5 });
    expect(period.billedDays).toBe(1);
    expect(period.fullPeriodDays).toBe(31);
    expect(period.isProrated).toBe(true);
  });
});

describe("nextBillingPeriod", () => {
  it("starts the day after the previous closing and runs a full cycle", () => {
    const period = nextBillingPeriod(
      { startDate: "2026-08-05", closingDay: 25, dueDay: 5 },
      "2026-08-25"
    );
    expect(period.periodStart).toBe("2026-08-26");
    expect(period.periodEnd).toBe("2026-09-25");
    expect(period.dueDate).toBe("2026-10-05");
    expect(period.isProrated).toBe(false);
  });

  it("keeps the closing on the last day of February", () => {
    const period = nextBillingPeriod(
      { startDate: "2026-01-01", closingDay: 31, dueDay: 10 },
      "2026-01-31"
    );
    expect(period.periodStart).toBe("2026-02-01");
    expect(period.periodEnd).toBe("2026-02-28");
    expect(period.fullPeriodDays).toBe(28);
    expect(period.isProrated).toBe(false);
  });
});

describe("upcomingBillingPeriod", () => {
  it("is the first period when nothing was billed yet", () => {
    const config = { startDate: "2026-08-05", closingDay: 25, dueDay: 5 };
    expect(upcomingBillingPeriod(config, null)).toEqual(firstBillingPeriod(config));
  });
});

describe("pendingBillingPeriods", () => {
  it("returns nothing before the first closing", () => {
    expect(
      pendingBillingPeriods({
        config: { startDate: "2026-08-05", closingDay: 25, dueDay: 5 },
        lastPeriodEnd: null,
        today: "2026-08-24"
      })
    ).toEqual([]);
  });

  it("returns the cycle that closed today", () => {
    const periods = pendingBillingPeriods({
      config: { startDate: "2026-08-05", closingDay: 25, dueDay: 5 },
      lastPeriodEnd: null,
      today: "2026-08-25"
    });
    expect(periods).toHaveLength(1);
    expect(periods[0].periodEnd).toBe("2026-08-25");
  });

  it("catches up every skipped cycle instead of losing months", () => {
    const periods = pendingBillingPeriods({
      config: { startDate: "2026-05-10", closingDay: 25, dueDay: 5 },
      lastPeriodEnd: null,
      today: "2026-08-26"
    });
    expect(periods.map((period) => period.periodEnd)).toEqual([
      "2026-05-25",
      "2026-06-25",
      "2026-07-25",
      "2026-08-25"
    ]);
    expect(periods[0].isProrated).toBe(true);
    expect(periods[1].isProrated).toBe(false);
  });

  it("resumes from the last billed period", () => {
    const periods = pendingBillingPeriods({
      config: { startDate: "2026-05-10", closingDay: 25, dueDay: 5 },
      lastPeriodEnd: "2026-07-25",
      today: "2026-08-26"
    });
    expect(periods.map((period) => period.periodEnd)).toEqual(["2026-08-25"]);
  });

  it("stops at the safety limit with an absurd go-live date", () => {
    const periods = pendingBillingPeriods({
      config: { startDate: "1990-01-10", closingDay: 25, dueDay: 5 },
      lastPeriodEnd: null,
      today: "2026-08-26",
      maxPeriods: 6
    });
    expect(periods).toHaveLength(6);
  });
});

describe("proratedAmountCents", () => {
  it("charges the full amount for a full cycle", () => {
    expect(
      proratedAmountCents({ monthlyAmountCents: 90_000, billedDays: 31, fullPeriodDays: 31 })
    ).toBe(90_000);
  });

  it("charges by day on a partial cycle", () => {
    // R$ 900,00 em 21 de 31 dias = R$ 609,68.
    expect(
      proratedAmountCents({ monthlyAmountCents: 90_000, billedDays: 21, fullPeriodDays: 31 })
    ).toBe(60_968);
  });

  it("never goes negative or divides by zero", () => {
    expect(
      proratedAmountCents({ monthlyAmountCents: 90_000, billedDays: 5, fullPeriodDays: 0 })
    ).toBe(90_000);
    expect(
      proratedAmountCents({ monthlyAmountCents: -100, billedDays: 5, fullPeriodDays: 30 })
    ).toBe(0);
  });
});

describe("invoiceTotalCents", () => {
  it("applies addition and discount", () => {
    expect(
      invoiceTotalCents({ baseAmountCents: 90_000, discountCents: 5_000, additionCents: 1_000 })
    ).toBe(86_000);
  });

  it("floors at zero instead of billing a negative boleto", () => {
    expect(invoiceTotalCents({ baseAmountCents: 10_000, discountCents: 50_000 })).toBe(0);
  });
});

describe("overdue and blocking", () => {
  it("counts the days past the due date", () => {
    expect(daysOverdue("2026-09-05", "2026-09-05")).toBe(0);
    expect(daysOverdue("2026-09-05", "2026-09-08")).toBe(3);
    expect(isOverdue("2026-09-05", "2026-09-05")).toBe(false);
    expect(isOverdue("2026-09-05", "2026-09-06")).toBe(true);
  });

  it("blocks only after the configured grace days", () => {
    const dueDate = "2026-09-05";
    const graceDays = 5;
    expect(shouldBlockForOverdue({ dueDate, graceDays, today: "2026-09-10" })).toBe(false);
    expect(shouldBlockForOverdue({ dueDate, graceDays, today: "2026-09-11" })).toBe(true);
    expect(blockDateFor(dueDate, graceDays)).toBe("2026-09-11");
  });

  it("blocks the day after the due date with zero grace", () => {
    expect(
      shouldBlockForOverdue({ dueDate: "2026-09-05", graceDays: 0, today: "2026-09-05" })
    ).toBe(false);
    expect(
      shouldBlockForOverdue({ dueDate: "2026-09-05", graceDays: 0, today: "2026-09-06" })
    ).toBe(true);
    expect(blockDateFor("2026-09-05", 0)).toBe("2026-09-06");
  });
});

describe("resolveBillingConfig", () => {
  const defaults = { closingDay: 25, dueDay: 5 };

  it("falls back to the global defaults", () => {
    expect(
      resolveBillingConfig({ startDate: "2026-08-05", closingDay: null, dueDay: null, defaults })
    ).toEqual({ startDate: "2026-08-05", closingDay: 25, dueDay: 5 });
  });

  it("prefers what the quarry configured", () => {
    expect(
      resolveBillingConfig({ startDate: "2026-08-05", closingDay: 10, dueDay: 20, defaults })
    ).toEqual({ startDate: "2026-08-05", closingDay: 10, dueDay: 20 });
  });

  it("is null without a go-live date — there is nothing to bill from", () => {
    expect(
      resolveBillingConfig({ startDate: null, closingDay: 10, dueDay: 20, defaults })
    ).toBeNull();
    expect(
      resolveBillingConfig({ startDate: "05/08/2026", closingDay: 10, dueDay: 20, defaults })
    ).toBeNull();
  });
});

describe("resolveGraceDays", () => {
  it("prefers the quarry value and falls back to the global default", () => {
    expect(resolveGraceDays(10, 5)).toBe(10);
    expect(resolveGraceDays(null, 5)).toBe(5);
    expect(resolveGraceDays(0, 5)).toBe(0);
    expect(resolveGraceDays(-3, 5)).toBe(0);
  });
});
