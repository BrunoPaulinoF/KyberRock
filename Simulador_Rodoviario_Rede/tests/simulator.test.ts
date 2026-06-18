import assert from "node:assert/strict";
import test from "node:test";
import { QuarryScaleSimulator } from "../src/simulator.js";

test("manualSet updates weight, tare and truck data", () => {
  const simulator = new QuarryScaleSimulator({
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000
  });

  const snapshot = simulator.action("manualSet", {
    weight: 42500,
    tare: 15200,
    plate: "abc1d23",
    material: "Brita 2"
  });

  assert.equal(snapshot.weightKg, 42500);
  assert.equal(snapshot.grossKg, 42500);
  assert.equal(snapshot.tareKg, 15200);
  assert.equal(snapshot.netKg, 27300);
  assert.equal(snapshot.currentTruck?.plate, "ABC1D23");
  assert.equal(snapshot.currentTruck?.material, "Brita 2");
  assert.match(snapshot.lastFrame, /000042500kg\r\n$/);
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
