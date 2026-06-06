import { describe, expect, it } from "vitest";

import { calculateNetWeightKg, isTerminalOperationStatus } from "./operation";

describe("calculateNetWeightKg", () => {
  it("calculates the net weight from entry and exit weights", () => {
    expect(calculateNetWeightKg(12_250, 32_800)).toBe(20_550);
  });

  it("rejects an exit weight smaller than or equal to the entry weight", () => {
    expect(() => calculateNetWeightKg(20_000, 19_999)).toThrow("greater than entry");
  });
});

describe("isTerminalOperationStatus", () => {
  it("returns true for terminal statuses", () => {
    expect(isTerminalOperationStatus("synced")).toBe(true);
    expect(isTerminalOperationStatus("cancelled")).toBe(true);
  });
});
