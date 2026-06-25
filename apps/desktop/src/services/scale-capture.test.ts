import { describe, expect, it } from "vitest";
import type { ScaleReading } from "@kyberrock/scale-adapters";

import { ScaleCaptureService, type ScaleCaptureAdapter } from "./scale-capture";
import type { ScaleStabilityConfig } from "./scale-configs";

const baseStability: ScaleStabilityConfig = {
  sampleDurationMs: 120,
  sampleIntervalMs: 50,
  requireStable: true,
  minStableMs: 0,
  maxVariationKg: 50,
  minWeightKg: 1000
};

describe("ScaleCaptureService", () => {
  it("captures the stable reading reported by the adapter without averaging", async () => {
    const adapter = createAdapter([
      makeReading({ weightKg: 12_345 }),
      makeReading({ weightKg: 18_765 })
    ]);
    const service = new ScaleCaptureService({ adapter, stability: baseStability });

    const reading = await service.captureStableWeight({ operationType: "entry" });

    expect(reading.weightKg).toBe(12_345);
    expect(reading.status).toBe("stable");
  });

  it("rejects unstable readings instead of accepting a calculated weight", async () => {
    const adapter = createAdapter([makeReading({ status: "unstable", stable: false })]);
    const service = new ScaleCaptureService({ adapter, stability: baseStability });

    await expect(service.captureStableWeight({ operationType: "entry" })).rejects.toThrow(
      "Peso instavel"
    );
  });

  it("rejects stale readings kept in memory before capture starts", async () => {
    const adapter = createAdapter([
      makeReading({ receivedAt: new Date(Date.now() - 10_000).toISOString() })
    ]);
    const service = new ScaleCaptureService({ adapter, stability: baseStability });

    await expect(
      service.captureStableWeight({ operationType: "exit", maxReadingAgeMs: 1000 })
    ).rejects.toThrow("sem leitura estavel e recente");
  });

  it("blocks non-capturable statuses immediately", async () => {
    const adapter = createAdapter([makeReading({ status: "overload", stable: false })]);
    const service = new ScaleCaptureService({ adapter, stability: baseStability });

    await expect(service.captureStableWeight({ operationType: "exit" })).rejects.toThrow(
      "sobrecarga"
    );
  });
});

function createAdapter(readings: ScaleReading[]): ScaleCaptureAdapter {
  let cursor = 0;
  return {
    async read(): Promise<ScaleReading> {
      const reading = readings[Math.min(cursor, readings.length - 1)] ?? readings[readings.length - 1];
      cursor += 1;
      if (!reading) throw new Error("No test reading configured.");
      return reading;
    }
  };
}

function makeReading(overrides: Partial<ScaleReading> = {}): ScaleReading {
  const now = new Date().toISOString();
  return {
    weightKg: 15_200,
    unit: "kg",
    status: "stable",
    stable: true,
    capturedAt: now,
    receivedAt: now,
    adapterName: "test",
    ...overrides
  };
}
