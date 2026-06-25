import { describe, expect, it } from "vitest";

import {
  completeLoadingOperation,
  type CompletedWeighingOperation,
  type WeighingOperation
} from "./LoaderDashboard";

function makeOperation(id: string, createdAt: string): WeighingOperation {
  return {
    id,
    plate: `ABC${id}`,
    customerName: "Cliente Teste",
    driverName: "Motorista Teste",
    productDescription: "Brita",
    entryWeightKg: 12_000,
    status: "open",
    createdAt
  };
}

describe("completeLoadingOperation", () => {
  it("moves the selected operation to completed without changing the remaining queue order", () => {
    const first = makeOperation("1", "2026-06-25T10:00:00.000Z");
    const second = makeOperation("2", "2026-06-25T10:05:00.000Z");

    const result = completeLoadingOperation([first, second], [], first.id, "2026-06-25T10:20:00.000Z");

    expect(result.inProgress).toEqual([second]);
    expect(result.completed).toEqual([
      {
        ...first,
        status: "completed",
        completedAt: "2026-06-25T10:20:00.000Z"
      }
    ]);
  });

  it("does not duplicate an operation that is already completed", () => {
    const operation = makeOperation("1", "2026-06-25T10:00:00.000Z");
    const completed: CompletedWeighingOperation[] = [
      {
        ...operation,
        status: "completed",
        completedAt: "2026-06-25T10:20:00.000Z"
      }
    ];

    const result = completeLoadingOperation([operation], completed, operation.id, "2026-06-25T10:25:00.000Z");

    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]?.completedAt).toBe("2026-06-25T10:20:00.000Z");
  });
});
