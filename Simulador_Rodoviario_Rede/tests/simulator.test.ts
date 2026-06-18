import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SAMPLE_DURATION_MS, QuarryScaleSimulator } from "../src/simulator.js";

const TEST_DURATION_MS = 200;

test("tare action collects a 5s mean and stores it as tare", async () => {
  const simulator = new QuarryScaleSimulator({
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000
  });
  simulator.action("arriveTruck", { plate: "TST1234", tareKg: 15200 });

  simulator.action("tare", { durationMs: TEST_DURATION_MS });

  await waitForSampling(simulator, TEST_DURATION_MS + 2000, () => simulator.tick());

  const snapshot = simulator.snapshot();
  assert.ok(
    Math.abs(snapshot.tareKg - 15200) <= 50,
    `tare media fora do esperado: ${snapshot.tareKg}`
  );
  assert.equal(snapshot.samplingKind, null);
});

test("tare uses the 5s default window when no duration is provided", () => {
  const simulator = new QuarryScaleSimulator({
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000
  });
  simulator.action("arriveTruck", { plate: "DEF5678", tareKg: 16000 });
  simulator.action("tare");
  const snapshot = simulator.snapshot();
  assert.equal(snapshot.samplingKind, "tare");
  assert.equal(snapshot.samplingRemainingMs, DEFAULT_SAMPLE_DURATION_MS);
});

test("exitTruck samples gross weight for 5s and releases the truck", async () => {
  const simulator = new QuarryScaleSimulator({
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000
  });
  simulator.action("arriveTruck", { plate: "GHI9012", tareKg: 14800, plannedGrossKg: 42000 });
  simulator.action("tare", { durationMs: 50 });
  await waitForSampling(simulator, 800, () => simulator.tick());

  simulator.action("exitTruck", { durationMs: TEST_DURATION_MS });
  const before = simulator.snapshot();
  assert.equal(before.samplingKind, "gross");
  assert.equal(before.status, "WEIGHING_LOADED");

  // Permite tempo suficiente para o peso subir ate o alvo
  await waitForSampling(simulator, 8000, () => simulator.tick());

  simulator.action("exitTruck", { durationMs: TEST_DURATION_MS });
  await waitForSampling(simulator, TEST_DURATION_MS + 2000, () => simulator.tick());

  const after = simulator.snapshot();
  assert.equal(after.samplingKind, null);
  assert.equal(after.status, "LEAVING");
  assert.equal(after.targetWeightKg, 0);
  assert.ok(
    Math.abs((after.currentTruck?.plannedGrossKg ?? 0) - after.grossKg) <= 5000,
    `gross divergente: planned ${after.currentTruck?.plannedGrossKg} vs ${after.grossKg}`
  );
});

test("manualSet can force Toledo status flags", () => {
  const simulator = new QuarryScaleSimulator({
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000
  });

  const snapshot = simulator.action("manualSet", {
    weight: -45,
    stable: false,
    overload: true
  });

  assert.equal(snapshot.negative, true);
  assert.equal(snapshot.stable, false);
  assert.equal(snapshot.motion, true);
  assert.equal(snapshot.overload, true);
  assert.match(snapshot.lastFrame, /^OM I G   000000045kg\r\n$/);
});

test("zero clears the platform", () => {
  const simulator = new QuarryScaleSimulator({
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000
  });

  simulator.action("manualSet", { weight: 20000, tare: 10000, plate: "XYZ9A88" });
  const snapshot = simulator.action("zero");

  assert.equal(snapshot.weightKg, 0);
  assert.equal(snapshot.tareKg, 0);
  assert.equal(snapshot.netKg, 0);
  assert.equal(snapshot.status, "IDLE");
  assert.equal(snapshot.currentTruck, null);
});

async function waitForSampling(
  simulator: QuarryScaleSimulator,
  totalMs: number,
  pump: () => void
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    pump();
    if (!simulator.snapshot().samplingKind) return;
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
