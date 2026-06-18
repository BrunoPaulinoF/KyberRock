import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScaleFrame,
  buildToledoStatus,
  formatKgField,
  formatToledoWeightField,
  parseTcpCommand,
  sanitizeFrameValue
} from "../src/protocol.js";
import type { SimulatorSnapshot } from "../src/types.js";

test("formatKgField pads signed weights", () => {
  assert.equal(formatKgField(123), "00000123");
  assert.equal(formatKgField(-45), "-0000045");
});

test("formatToledoWeightField pads absolute weights", () => {
  assert.equal(formatToledoWeightField(123), "000000123");
  assert.equal(formatToledoWeightField(-45), "000000045");
});

test("sanitizeFrameValue removes separators and controls", () => {
  assert.equal(sanitizeFrameValue("ABC;123\nXYZ"), "ABC123XYZ");
});

test("buildScaleFrame creates a Toledo-compatible TCP line", () => {
  const snapshot: SimulatorSnapshot = {
    sequence: 7,
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000,
    connectedClients: 1,
    autoMode: false,
    status: "WEIGHING_LOADED",
    trafficLight: "GREEN",
    weightKg: 42000,
    targetWeightKg: 42000,
    grossKg: 42000,
    tareKg: 15000,
    netKg: 27000,
    stable: true,
    motion: false,
    overload: false,
    negative: false,
    zeroed: false,
    tareActive: true,
    grossMode: false,
    netMode: true,
    capacityKg: 80000,
    currentTruck: {
      plate: "ABC1D23",
      driver: "Teste",
      company: "Pedreira",
      material: "Brita 1",
      origin: "Pedreira Principal",
      destination: "Cliente",
      axleCount: 5,
      tareKg: 15000,
      plannedGrossKg: 42000,
      plannedNetKg: 27000
    },
    lastFrame: "",
    updatedAt: "2026-01-01T10:00:00.000Z",
    events: [],
    samplingKind: null,
    samplingRemainingMs: 0,
    samplingSampleCount: 0
  };

  const frame = buildScaleFrame(snapshot);
  assert.equal(frame, "    T N  000042000kg\r\n");
});

test("buildToledoStatus maps balance flags by position", () => {
  const snapshot: SimulatorSnapshot = {
    sequence: 7,
    tcpHost: "0.0.0.0",
    tcpPort: 4001,
    frameIntervalMs: 1000,
    connectedClients: 1,
    autoMode: false,
    status: "ERROR",
    trafficLight: "RED",
    weightKg: -45,
    targetWeightKg: -45,
    grossKg: 0,
    tareKg: 0,
    netKg: 0,
    stable: false,
    motion: true,
    overload: true,
    negative: true,
    zeroed: false,
    tareActive: false,
    grossMode: true,
    netMode: false,
    capacityKg: 80000,
    currentTruck: null,
    lastFrame: "",
    updatedAt: "2026-01-01T10:00:00.000Z",
    events: [],
    samplingKind: null,
    samplingRemainingMs: 0,
    samplingSampleCount: 0
  };

  assert.equal(buildToledoStatus(snapshot), "OM I G  ");
});

test("parseTcpCommand supports integration commands", () => {
  assert.deepEqual(parseTcpCommand("PING"), { type: "ping" });
  assert.deepEqual(parseTcpCommand("AUTO ON"), { type: "startAuto" });
  assert.deepEqual(parseTcpCommand("SET WEIGHT=42000;TARE=15000;PLATE=ABC1D23"), {
    type: "manualSet",
    data: {
      weight: 42000,
      tare: 15000,
      plate: "ABC1D23"
    }
  });
  assert.deepEqual(parseTcpCommand("ARRIVE PLATE=ABC1D23"), {
    type: "arriveTruck",
    data: { plate: "ABC1D23" }
  });
  assert.deepEqual(parseTcpCommand("TARE"), { type: "tare", data: {} });
  assert.deepEqual(parseTcpCommand("GROSS"), { type: "gross", data: {} });
  assert.deepEqual(parseTcpCommand("EXIT DURATION=3000"), {
    type: "exitTruck",
    data: { duration: 3000 }
  });
});
