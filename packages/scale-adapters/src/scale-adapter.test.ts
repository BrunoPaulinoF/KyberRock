import { describe, expect, it } from "vitest";

import {
  MockScaleAdapter,
  isSupportedScaleConnection,
  normalizeScaleReading
} from "./scale-adapter";

describe("isSupportedScaleConnection", () => {
  it("accepts planned connection types", () => {
    expect(isSupportedScaleConnection("serial")).toBe(true);
    expect(isSupportedScaleConnection("tcp")).toBe(true);
  });

  it("rejects unknown connection types", () => {
    expect(isSupportedScaleConnection("bluetooth")).toBe(false);
  });
});

describe("normalizeScaleReading", () => {
  it("converts tons to kg", () => {
    expect(normalizeScaleReading({ value: 12.5, unit: "ton" })).toEqual({
      weightKg: 12_500,
      unit: "kg"
    });
  });

  it("requires a kg factor for raw readings", () => {
    expect(() => normalizeScaleReading({ value: 100, unit: "raw" })).toThrow("kgFactor");
  });
});

describe("MockScaleAdapter", () => {
  it("returns stable simulated readings in sequence", async () => {
    const adapter = new MockScaleAdapter([12_000, 18_500]);

    expect(await adapter.read()).toMatchObject({ weightKg: 12_000, stable: true });
    expect(await adapter.read()).toMatchObject({ weightKg: 18_500, stable: true });
  });

  it("keeps returning the latest reading after the sequence ends", async () => {
    const adapter = new MockScaleAdapter([12_000]);

    await adapter.read();

    expect(await adapter.read()).toMatchObject({ weightKg: 12_000, stable: true });
  });
});
