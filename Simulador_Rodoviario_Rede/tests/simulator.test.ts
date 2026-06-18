import assert from "node:assert/strict";
import test from "node:test";
import { ScaleSimulator } from "../src/simulator.js";
import { buildToledoFrame, parseToledoLine } from "../src/protocol/toledo.js";

test("arriveEmpty + startTareSample set the tare after 5s", async () => {
  const sim = new ScaleSimulator(80000, 200);
  sim.arriveEmpty(15000);
  for (let i = 0; i < 6; i += 1) {
    sim.tick();
    await sleep(60);
  }
  sim.startTareSample();
  for (let i = 0; i < 6; i += 1) {
    sim.tick();
    await sleep(60);
  }
  const snap = sim.snapshot();
  assert.equal(snap.phase, "TARE_DONE");
  assert.ok(snap.tareKg > 0);
  assert.equal(snap.tareActive, true);
});

test("startLoading + startGrossSample set the gross weight after 5s", async () => {
  const sim = new ScaleSimulator(80000, 50);
  sim.arriveEmpty(15000);
  for (let i = 0; i < 50; i += 1) {
    sim.tick();
    await sleep(10);
  }
  sim.startTareSample();
  for (let i = 0; i < 10; i += 1) {
    sim.tick();
    await sleep(10);
  }
  sim.startLoading(42000);
  for (let i = 0; i < 50; i += 1) {
    sim.tick();
    await sleep(10);
  }
  sim.startGrossSample();
  for (let i = 0; i < 10; i += 1) {
    sim.tick();
    await sleep(10);
  }
  const snap = sim.snapshot();
  assert.equal(snap.phase, "WEIGHING_LOADED");
  assert.ok(snap.weightKg > 1000);
  assert.equal(snap.netMode, true);
});

test("leave clears tara and weight", () => {
  const sim = new ScaleSimulator();
  sim.arriveEmpty(15000);
  sim.tick();
  sim.leave();
  const snap = sim.snapshot();
  assert.equal(snap.weightKg, 0);
  assert.equal(snap.tareKg, 0);
  assert.equal(snap.phase, "RELEASED");
});

test("zero returns to IDLE", () => {
  const sim = new ScaleSimulator();
  sim.arriveEmpty(15000);
  sim.tick();
  sim.zero();
  assert.equal(sim.snapshot().phase, "IDLE");
});

test("Toledo frame round-trips through parser", () => {
  const sim = new ScaleSimulator();
  sim.arriveEmpty(15000);
  for (let i = 0; i < 30; i += 1) sim.tick();
  sim.setWeight(15000);
  const frame = buildToledoFrame(sim.snapshot());
  const parsed = parseToledoLine(frame);
  assert.ok(parsed);
  assert.ok(parsed && Math.abs(parsed.weightKg - 15000) < 50);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
