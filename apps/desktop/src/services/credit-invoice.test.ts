import { describe, expect, it } from "vitest";

import { computeCreditInvoiceSchedule } from "./credit-invoice.js";

describe("computeCreditInvoiceSchedule", () => {
  it("closes on the closing day of the current month when the operation is before it", () => {
    const schedule = computeCreditInvoiceSchedule(15, 7, new Date(2026, 2, 10)); // 10/mar
    expect(schedule.closingDate).toBe("2026-03-15");
    expect(schedule.dueDate).toBe("2026-03-22");
  });

  it("closes on the operation day when it equals the closing day", () => {
    const schedule = computeCreditInvoiceSchedule(15, 7, new Date(2026, 2, 15));
    expect(schedule.closingDate).toBe("2026-03-15");
  });

  it("rolls to next month when the operation is after the closing day", () => {
    const schedule = computeCreditInvoiceSchedule(15, 7, new Date(2026, 2, 20));
    expect(schedule.closingDate).toBe("2026-04-15");
    expect(schedule.dueDate).toBe("2026-04-22");
  });

  it("rolls across the year boundary", () => {
    const schedule = computeCreditInvoiceSchedule(15, 5, new Date(2026, 11, 20)); // 20/dez
    expect(schedule.closingDate).toBe("2027-01-15");
    expect(schedule.dueDate).toBe("2027-01-20");
  });

  it("clamps the closing day to the last day of a short month", () => {
    const schedule = computeCreditInvoiceSchedule(31, 0, new Date(2026, 1, 10)); // 10/fev/2026
    expect(schedule.closingDate).toBe("2026-02-28");
    expect(schedule.dueDate).toBe("2026-02-28");
  });

  it("clamps and closes same month when the operation is the last day", () => {
    const schedule = computeCreditInvoiceSchedule(31, 0, new Date(2026, 0, 31)); // 31/jan
    expect(schedule.closingDate).toBe("2026-01-31");
  });

  it("advances the due date across a month boundary", () => {
    const schedule = computeCreditInvoiceSchedule(31, 5, new Date(2026, 0, 20)); // 20/jan
    expect(schedule.closingDate).toBe("2026-01-31");
    expect(schedule.dueDate).toBe("2026-02-05");
  });

  it("supports a zero-day (a vista) due date equal to the closing", () => {
    const schedule = computeCreditInvoiceSchedule(10, 0, new Date(2026, 4, 5));
    expect(schedule.closingDate).toBe("2026-05-10");
    expect(schedule.dueDate).toBe("2026-05-10");
  });

  it("rejects invalid closing days and boleto days", () => {
    expect(() => computeCreditInvoiceSchedule(0, 7, new Date())).toThrow(/fechamento/i);
    expect(() => computeCreditInvoiceSchedule(32, 7, new Date())).toThrow(/fechamento/i);
    expect(() => computeCreditInvoiceSchedule(15, -1, new Date())).toThrow(/vencimento/i);
    expect(() => computeCreditInvoiceSchedule(15.5, 7, new Date())).toThrow(/fechamento/i);
  });
});
