import { describe, expect, it } from "vitest";

import {
  computeCreditInvoiceSchedule,
  creditClosingConfigFromCustomer
} from "./credit-invoice.js";

describe("computeCreditInvoiceSchedule - monthly", () => {
  const monthly = (closingDay: number, boletoDays: number) =>
    ({ periodicity: "monthly", closingDay, boletoDays }) as const;

  it("closes on the closing day of the current month when the operation is before it", () => {
    const schedule = computeCreditInvoiceSchedule(monthly(15, 7), new Date(2026, 2, 10));
    expect(schedule.closingDate).toBe("2026-03-15");
    expect(schedule.dueDate).toBe("2026-03-22");
  });

  it("closes the same day when the operation equals the closing day", () => {
    expect(computeCreditInvoiceSchedule(monthly(15, 7), new Date(2026, 2, 15)).closingDate).toBe(
      "2026-03-15"
    );
  });

  it("rolls to the next month when the operation is after the closing day", () => {
    const schedule = computeCreditInvoiceSchedule(monthly(15, 7), new Date(2026, 2, 20));
    expect(schedule.closingDate).toBe("2026-04-15");
    expect(schedule.dueDate).toBe("2026-04-22");
  });

  it("rolls across the year boundary", () => {
    const schedule = computeCreditInvoiceSchedule(monthly(15, 5), new Date(2026, 11, 20));
    expect(schedule.closingDate).toBe("2027-01-15");
    expect(schedule.dueDate).toBe("2027-01-20");
  });

  it("clamps the closing day to the last day of a short month", () => {
    const schedule = computeCreditInvoiceSchedule(monthly(31, 0), new Date(2026, 1, 10));
    expect(schedule.closingDate).toBe("2026-02-28");
    expect(schedule.dueDate).toBe("2026-02-28");
  });

  it("advances the due date across a month boundary", () => {
    const schedule = computeCreditInvoiceSchedule(monthly(31, 5), new Date(2026, 0, 20));
    expect(schedule.closingDate).toBe("2026-01-31");
    expect(schedule.dueDate).toBe("2026-02-05");
  });

  it("rejects invalid closing days and boleto days", () => {
    expect(() => computeCreditInvoiceSchedule(monthly(0, 7), new Date())).toThrow(/fechamento/i);
    expect(() => computeCreditInvoiceSchedule(monthly(32, 7), new Date())).toThrow(/fechamento/i);
    expect(() => computeCreditInvoiceSchedule(monthly(15, -1), new Date())).toThrow(/vencimento/i);
  });
});

describe("computeCreditInvoiceSchedule - biweekly", () => {
  const biweekly = (
    firstClosingDay: number,
    secondClosingDay: number,
    firstBoletoDays: number,
    secondBoletoDays: number
  ) =>
    ({
      periodicity: "biweekly",
      firstClosingDay,
      secondClosingDay,
      firstBoletoDays,
      secondBoletoDays
    }) as const;

  it("uses the first closing when on/before the first day", () => {
    const schedule = computeCreditInvoiceSchedule(biweekly(1, 16, 5, 7), new Date(2026, 2, 1));
    expect(schedule.closingDate).toBe("2026-03-01");
    expect(schedule.dueDate).toBe("2026-03-06");
  });

  it("uses the second closing (and its boleto days) between the two days", () => {
    const schedule = computeCreditInvoiceSchedule(biweekly(1, 16, 5, 10), new Date(2026, 2, 10));
    expect(schedule.closingDate).toBe("2026-03-16");
    expect(schedule.dueDate).toBe("2026-03-26");
  });

  it("closes exactly on the second day when the operation lands on it", () => {
    expect(
      computeCreditInvoiceSchedule(biweekly(1, 16, 5, 10), new Date(2026, 2, 16)).closingDate
    ).toBe("2026-03-16");
  });

  it("rolls to next month's first closing after the second day", () => {
    const schedule = computeCreditInvoiceSchedule(biweekly(1, 16, 5, 10), new Date(2026, 2, 20));
    expect(schedule.closingDate).toBe("2026-04-01");
    expect(schedule.dueDate).toBe("2026-04-06");
  });

  it("rolls across the year boundary", () => {
    const schedule = computeCreditInvoiceSchedule(biweekly(1, 16, 3, 3), new Date(2026, 11, 20));
    expect(schedule.closingDate).toBe("2027-01-01");
  });

  it("rejects an out-of-order or invalid config", () => {
    expect(() => computeCreditInvoiceSchedule(biweekly(16, 1, 5, 5), new Date())).toThrow(/maior/i);
    expect(() => computeCreditInvoiceSchedule(biweekly(1, 16, -1, 5), new Date())).toThrow(
      /vencimento/i
    );
  });
});

describe("computeCreditInvoiceSchedule - weekly", () => {
  const weekly = (closingWeekday: number, boletoDays: number) =>
    ({ periodicity: "weekly", closingWeekday, boletoDays }) as const;

  it("closes on the next occurrence of the closing weekday", () => {
    // 2026-03-10 is a Tuesday (getDay() === 2). Closing on Friday (5).
    const schedule = computeCreditInvoiceSchedule(weekly(5, 2), new Date(2026, 2, 10));
    expect(schedule.closingDate).toBe("2026-03-13"); // Friday
    expect(schedule.dueDate).toBe("2026-03-15");
  });

  it("closes the same day when the operation is on the closing weekday", () => {
    // 2026-03-13 is a Friday.
    expect(computeCreditInvoiceSchedule(weekly(5, 0), new Date(2026, 2, 13)).closingDate).toBe(
      "2026-03-13"
    );
  });

  it("wraps to the next week across a month boundary", () => {
    // 2026-03-31 is a Tuesday; next Monday (1) is 2026-04-06.
    const schedule = computeCreditInvoiceSchedule(weekly(1, 0), new Date(2026, 2, 31));
    expect(schedule.closingDate).toBe("2026-04-06");
  });

  it("rejects an invalid weekday", () => {
    expect(() => computeCreditInvoiceSchedule(weekly(7, 0), new Date())).toThrow(/semana/i);
  });
});

describe("creditClosingConfigFromCustomer", () => {
  const base = {
    creditAccountEnabled: true,
    creditPeriodicity: "monthly" as const,
    creditClosingDay: 15,
    creditBoletoDays: 7,
    creditSecondClosingDay: null,
    creditSecondBoletoDays: null,
    creditClosingWeekday: null
  };

  it("returns null when the credit account is disabled", () => {
    expect(creditClosingConfigFromCustomer({ ...base, creditAccountEnabled: false })).toBeNull();
  });

  it("maps a monthly customer", () => {
    expect(creditClosingConfigFromCustomer(base)).toEqual({
      periodicity: "monthly",
      closingDay: 15,
      boletoDays: 7
    });
  });

  it("maps a biweekly customer", () => {
    const config = creditClosingConfigFromCustomer({
      ...base,
      creditPeriodicity: "biweekly",
      creditClosingDay: 1,
      creditBoletoDays: 5,
      creditSecondClosingDay: 16,
      creditSecondBoletoDays: 10
    });
    expect(config).toEqual({
      periodicity: "biweekly",
      firstClosingDay: 1,
      secondClosingDay: 16,
      firstBoletoDays: 5,
      secondBoletoDays: 10
    });
  });

  it("maps a weekly customer", () => {
    const config = creditClosingConfigFromCustomer({
      ...base,
      creditPeriodicity: "weekly",
      creditClosingWeekday: 5,
      creditBoletoDays: 2
    });
    expect(config).toEqual({ periodicity: "weekly", closingWeekday: 5, boletoDays: 2 });
  });
});
