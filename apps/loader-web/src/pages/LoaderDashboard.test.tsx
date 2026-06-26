import { describe, expect, it } from "vitest";

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

function splitByLoaderCompletion(operations: WeighingOperation[]): {
  inProgress: WeighingOperation[];
  completed: WeighingOperation[];
} {
  return {
    inProgress: operations.filter((operation) => !operation.loaderCompletedAt),
    completed: operations
      .filter((operation) => operation.loaderCompletedAt)
      .sort((a, b) => (a.loaderCompletedAt && b.loaderCompletedAt
        ? b.loaderCompletedAt.localeCompare(a.loaderCompletedAt)
        : 0))
  };
}

describe("LoaderDashboard completion split", () => {
  it("keeps operations without loaderCompletedAt in the in-progress column", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const { inProgress, completed } = splitByLoaderCompletion([first, second]);

    expect(inProgress).toEqual([first, second]);
    expect(completed).toEqual([]);
  });

  it("moves operations with loaderCompletedAt to the completed column", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const { inProgress, completed } = splitByLoaderCompletion([first, second]);

    expect(inProgress).toEqual([second]);
    expect(completed).toEqual([first]);
  });

  it("orders the completed column by most recent completion first", () => {
    const oldest = makeOperation("1", "2026-06-25T10:00:00.000Z", "2026-06-25T10:20:00.000Z");
    const newest = makeOperation("2", "2026-06-25T10:05:00.000Z", "2026-06-25T10:30:00.000Z");

    const { completed } = splitByLoaderCompletion([oldest, newest]);

    expect(completed).toEqual([newest, oldest]);
  });
});
