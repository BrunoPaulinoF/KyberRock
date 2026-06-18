import assert from "node:assert/strict";
import test from "node:test";
import {
  buildToledoFrame,
  buildStatusByte,
  buildWeightField,
  parseToledoLine
} from "../src/protocol/toledo.js";
import type { ScaleSnapshot } from "../src/state/scale-state.js";
import { createInitialSnapshot, deriveFlags } from "../src/state/derive.js";

function snapshot(overrides: Partial<ScaleSnapshot> = {}): ScaleSnapshot {
  return { ...createInitialSnapshot(80000, 5000), ...overrides };
}

test("buildStatusByte follows Toledo 8-char layout", () => {
  const flags = snapshot({
    overload: true,
    negative: true,
    atZero: false,
    motion: true,
    tareActive: true,
    grossMode: true,
    netMode: false
  });
  assert.equal(buildStatusByte(flags), "OM ITG  ");
});

test("buildWeightField pads to 9 digits and ignores sign", () => {
  assert.equal(buildWeightField(snapshot({ weightKg: 15234 })), "000015234");
  assert.equal(buildWeightField(snapshot({ weightKg: -45 })), "000000045");
  assert.equal(buildWeightField(snapshot({ weightKg: 123456789 })), "123456789");
});

test("buildToledoFrame produces parseable line ending with CRLF kg", () => {
  const flags = snapshot({ tareKg: 15000, weightKg: 42000 });
  flags.tareActive = true;
  flags.netMode = true;
  const frame = buildToledoFrame(deriveFlags(flags));
  assert.equal(frame, "    T N  000042000kg\r\n");
});

test("parseToledoLine recovers a 15 200 kg gross reading", () => {
  const parsed = parseToledoLine("    G    000015200kg\r\n");
  assert.ok(parsed);
  assert.equal(parsed?.weightKg, 15200);
  assert.equal(parsed?.unit, "kg");
  assert.equal(parsed?.isGross, true);
});

test("parseToledoLine detects tare active and motion", () => {
  const parsed = parseToledoLine("   ITN  000023500kg");
  assert.ok(parsed);
  assert.equal(parsed?.tareActive, true);
  assert.equal(parsed?.inMotion, true);
  assert.equal(parsed?.isNet, true);
  assert.equal(parsed?.weightKg, 23500);
});

test("parseToledoLine returns null for invalid lines", () => {
  assert.equal(parseToledoLine(""), null);
  assert.equal(parseToledoLine("abc"), null);
});

test("deriveFlags updates tare modes and overload", () => {
  const next = deriveFlags(snapshot({ weightKg: 85000, tareKg: 5000 }));
  assert.equal(next.overload, true);
  assert.equal(next.tareActive, true);
  assert.equal(next.netMode, true);
  assert.equal(next.grossMode, false);
  assert.equal(next.netKg, 80000);
});
