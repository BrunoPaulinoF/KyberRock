import { describe, expect, it } from "vitest";

import {
  getInProgressOperations,
  getOvertimeOperations,
  getRenderedOperations,
  minutesSinceArrival
} from "./LoaderDashboard";
import type { WeighingOperation } from "./LoaderDashboard";

function makeOperation(
  id: string,
  createdAt: string,
  loaderCompletedAt: string | null = null
): WeighingOperation {
  return {
    id,
    plate: `ABC${id}`,
    customerName: "Cliente Teste",
    driverName: "Motorista Teste",
    productDescription: "Brita",
    entryWeightKg: 12_000,
    status: "open",
    createdAt,
    loaderCompletedAt
  };
}

function getVisibleLoaderOperations(operations: WeighingOperation[]): WeighingOperation[] {
  return operations.filter((operation) => !operation.loaderCompletedAt);
}

describe("LoaderDashboard visible operations", () => {
  it("keeps operations without loaderCompletedAt visible to the loader", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const visible = getVisibleLoaderOperations([first, second]);

    expect(visible).toEqual([first, second]);
  });

  it("hides operations with loaderCompletedAt after the loader concludes the load", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const visible = getVisibleLoaderOperations([first, second]);

    expect(visible).toEqual([second]);
  });
});

describe("LoaderDashboard overtime alert", () => {
  const base = new Date("2026-06-25T10:00:00.000Z").getTime();
  const now = base + 50 * 60_000; // 50 minutos depois

  it("flags in-progress trucks that exceed the average quarry time", () => {
    const slow = makeOperation("1", "2026-06-25T10:00:00.000Z"); // 50 min
    const fresh = makeOperation("2", "2026-06-25T09:50:00.000Z");
    // fresh chegou 10 min antes de slow, entao ja tem 60 min -> tambem acima.
    const recent = makeOperation("3", new Date(now - 10 * 60_000).toISOString()); // 10 min

    const overtime = getOvertimeOperations([slow, fresh, recent], 30, now);

    expect(overtime.map((o) => o.id)).toEqual(["1", "2"]);
  });

  it("returns nothing when there is no average", () => {
    const slow = makeOperation("1", "2026-06-25T10:00:00.000Z");
    expect(getOvertimeOperations([slow], null, now)).toEqual([]);
    expect(getOvertimeOperations([slow], 0, now)).toEqual([]);
  });

  it("ignores trucks already completed by the loader", () => {
    const done = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:40:00.000Z");
    expect(getOvertimeOperations([done], 30, now)).toEqual([]);
  });

  it("computes elapsed minutes since arrival", () => {
    expect(minutesSinceArrival("2026-06-25T10:00:00.000Z", base + 30 * 60_000)).toBe(30);
    expect(minutesSinceArrival("invalid", now)).toBe(0);
  });
});

describe("LoaderDashboard departure animation", () => {
  it("excludes concluded operations from the in-progress count", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    expect(getInProgressOperations([first, second])).toEqual([second]);
  });

  it("keeps a concluded operation rendered in place while its truck drives off", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const rendered = getRenderedOperations([first, second], new Set(["1"]));

    // The departing row stays visible (and in its original position) so the
    // animation can play, alongside the still-open rows.
    expect(rendered).toEqual([first, second]);
  });

  it("drops a concluded operation once its departure animation has finished", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const rendered = getRenderedOperations([first, second], new Set());

    expect(rendered).toEqual([second]);
  });
});
