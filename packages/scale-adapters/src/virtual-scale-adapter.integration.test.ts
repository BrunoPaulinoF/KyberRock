import { describe, expect, it } from "vitest";

import { createVirtualScaleAdapter } from "./virtual-scale-adapter.js";
import { ScaleCaptureService } from "../../../apps/desktop/src/services/scale-capture.js";
import type { ScaleStabilityConfig } from "../../../apps/desktop/src/services/scale-configs.js";

const baseStability: ScaleStabilityConfig = {
  sampleDurationMs: 5000,
  sampleIntervalMs: 250,
  requireStable: true,
  minStableMs: 1000,
  maxVariationKg: 50,
  minWeightKg: 1000
};

describe("virtual scale capture integration", () => {
  it("captures the weight defined several seconds before the capture is requested", async () => {
    const adapter = createVirtualScaleAdapter();
    await adapter.connect();
    adapter.setWeight(15_500);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const service = new ScaleCaptureService({
      adapter,
      stability: baseStability,
      adapterName: "virtual"
    });

    const reading = await service.captureStableWeight({ operationType: "entry" });
    expect(reading.weightKg).toBe(15_500);
    expect(reading.status).toBe("stable");
  });

  it("marks every read as fresh even when the user took a long time to click capture", async () => {
    const adapter = createVirtualScaleAdapter();
    await adapter.connect();
    adapter.setWeight(18_200);

    const staleRead = await adapter.read();
    const receivedAt = Date.parse(staleRead.receivedAt);
    expect(Number.isFinite(receivedAt)).toBe(true);
    expect(Date.now() - receivedAt).toBeLessThan(1000);
  });

  it("captures successfully after the user changes the simulated weight", async () => {
    const adapter = createVirtualScaleAdapter();
    await adapter.connect();

    const service = new ScaleCaptureService({
      adapter,
      stability: baseStability,
      adapterName: "virtual"
    });

    adapter.setWeight(15_500);
    const first = await service.captureStableWeight({ operationType: "entry" });
    expect(first.weightKg).toBe(15_500);

    adapter.setWeight(22_000);
    const second = await service.captureStableWeight({ operationType: "entry" });
    expect(second.weightKg).toBe(22_000);
  });
});
