import { describe, expect, it } from "vitest";

import { getInProgressOperations, getRenderedOperations } from "./LoaderDashboard";
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
