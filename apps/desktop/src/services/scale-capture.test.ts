import { describe, expect, it } from "vitest";
import type { ScaleReading } from "@kyberrock/scale-adapters";

import { ScaleCaptureService, type ScaleCaptureAdapter } from "./scale-capture";

// Politica rapida para os testes: mesmo comportamento, tempos curtos.
const fastPolicy = {
  timeoutMs: 400,
  pollIntervalMs: 20,
  minStableMs: 0,
  maxVariationKg: 50,
  minWeightKg: 1000,
  maxReadingAgeMs: 2000
};

describe("ScaleCaptureService", () => {
  it("captures the stable reading reported by the adapter without averaging", async () => {
    const adapter = createAdapter([
      makeReading({ weightKg: 12_345 }),
      makeReading({ weightKg: 18_765 })
    ]);
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    const reading = await service.captureStableWeight({ operationType: "entry" });

    expect(reading.weightKg).toBe(12_345);
    expect(reading.status).toBe("stable");
  });

  it("waits through unstable readings and captures once the scale stabilizes", async () => {
    const adapter = createAdapter([
      makeReading({ status: "unstable", stable: false }),
      makeReading({ status: "unstable", stable: false }),
      makeReading({ weightKg: 15_450 })
    ]);
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    const reading = await service.captureStableWeight({ operationType: "entry" });
    expect(reading.weightKg).toBe(15_450);
  });

  it("waits through zero readings while the truck enters the scale", async () => {
    const adapter = createAdapter([
      makeReading({ status: "zero", stable: false, weightKg: 0 }),
      makeReading({ status: "unstable", stable: false, weightKg: 8_000 }),
      makeReading({ weightKg: 15_450 })
    ]);
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    const reading = await service.captureStableWeight({ operationType: "entry" });
    expect(reading.weightKg).toBe(15_450);
  });

  it("waits through below-minimum readings instead of failing immediately", async () => {
    const adapter = createAdapter([
      makeReading({ weightKg: 300 }),
      makeReading({ weightKg: 15_450 })
    ]);
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    const reading = await service.captureStableWeight({ operationType: "entry" });
    expect(reading.weightKg).toBe(15_450);
  });

  it("requires the weight to hold steady for the configured stability window", async () => {
    // Peso oscilando alem da tolerancia zera a janela; depois estabiliza.
    const adapter = createAdapter([
      makeReading({ weightKg: 15_000 }),
      makeReading({ weightKg: 15_400 }),
      makeReading({ weightKg: 15_410 }),
      makeReading({ weightKg: 15_405 }),
      makeReading({ weightKg: 15_405 }),
      makeReading({ weightKg: 15_405 })
    ]);
    const service = new ScaleCaptureService({
      adapter,
      policy: { ...fastPolicy, minStableMs: 50, timeoutMs: 2000 }
    });

    const reading = await service.captureStableWeight({ operationType: "entry" });
    expect(reading.weightKg).toBeGreaterThanOrEqual(15_400);
  });

  it("times out with an unstable-specific message when the weight never settles", async () => {
    const adapter = createAdapter([makeReading({ status: "unstable", stable: false })], {
      refreshTimestamps: true
    });
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    await expect(service.captureStableWeight({ operationType: "entry" })).rejects.toThrow(
      "Peso nao estabilizou"
    );
  });

  it("times out with a zero-specific message when no truck is on the scale", async () => {
    const adapter = createAdapter([makeReading({ status: "zero", stable: false, weightKg: 0 })], {
      refreshTimestamps: true
    });
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    await expect(service.captureStableWeight({ operationType: "exit" })).rejects.toThrow(
      "Balanca zerada"
    );
  });

  it("times out with an overload-specific message", async () => {
    const adapter = createAdapter([makeReading({ status: "overload", stable: false })], {
      refreshTimestamps: true
    });
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    await expect(service.captureStableWeight({ operationType: "exit" })).rejects.toThrow(
      "sobrecarga"
    );
  });

  it("rejects stale readings kept in memory before capture starts", async () => {
    const adapter = createAdapter([
      makeReading({ receivedAt: new Date(Date.now() - 10_000).toISOString() })
    ]);
    const service = new ScaleCaptureService({
      adapter,
      policy: { ...fastPolicy, maxReadingAgeMs: 1000 }
    });

    await expect(service.captureStableWeight({ operationType: "exit" })).rejects.toThrow(
      "sem enviar leituras recentes"
    );
  });

  it("fails immediately when the scale reports it is disconnected", async () => {
    const startedAt = Date.now();
    const adapter: ScaleCaptureAdapter = {
      async read() {
        throw new Error("Balanca nao esta conectada.");
      }
    };
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    await expect(service.captureStableWeight({ operationType: "entry" })).rejects.toThrow(
      "nao esta conectada"
    );
    // Nao deve esperar o timeout inteiro para reportar desconexao
    expect(Date.now() - startedAt).toBeLessThan(fastPolicy.timeoutMs);
  });

  it("keeps polling through transient read errors until a stable reading arrives", async () => {
    let calls = 0;
    const adapter: ScaleCaptureAdapter = {
      async read() {
        calls += 1;
        if (calls < 3) throw new Error("Nenhuma leitura disponivel da balanca.");
        return makeReading({ weightKg: 17_200 });
      }
    };
    const service = new ScaleCaptureService({ adapter, policy: fastPolicy });

    const reading = await service.captureStableWeight({ operationType: "entry" });
    expect(reading.weightKg).toBe(17_200);
  });
});

function createAdapter(
  readings: ScaleReading[],
  options: { refreshTimestamps?: boolean } = {}
): ScaleCaptureAdapter {
  let cursor = 0;
  return {
    async read(): Promise<ScaleReading> {
      const index = Math.min(cursor, readings.length - 1);
      cursor += 1;
      const reading = readings[index];
      if (!reading) throw new Error("No test reading configured.");
      if (options.refreshTimestamps) {
        const now = new Date().toISOString();
        return { ...reading, receivedAt: now, capturedAt: now };
      }
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
