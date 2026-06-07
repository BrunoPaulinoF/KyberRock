import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import {
  cancelWeighingOperation,
  closeWeighingOperation,
  createSimulatedWeighingOperation,
  listOpenWeighingOperations
} from "./weighing-operations";

describe("weighing operations", () => {
  it("opens a simulated weighing and creates a loading request", () => {
    const database = createDatabase();

    try {
      const operation = createSimulatedWeighingOperation(
        database,
        {
          identity: createIdentity(database),
          customerName: "Cliente Teste",
          plate: "ABC1D23",
          driverName: "Motorista Teste",
          productDescription: "Brita 1",
          entryWeightKg: 12_000
        },
        new Date("2026-06-06T12:00:00.000Z")
      );

      expect(operation).toMatchObject({
        status: "loading_requested",
        entryWeightKg: 12_000,
        customerName: "Cliente Teste",
        productDescription: "Brita 1"
      });
      expect(database.prepare("SELECT COUNT(*) FROM loading_requests").pluck().get()).toBe(1);
      expect(listOpenWeighingOperations(database)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("closes a simulated weighing and calculates net weight", () => {
    const database = createDatabase();

    try {
      const operation = createSimulatedWeighingOperation(database, {
        identity: createIdentity(database),
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      const closed = closeWeighingOperation(
        database,
        {
          operationId: operation.id,
          exitWeightKg: 18_500
        },
        new Date("2026-06-06T13:00:00.000Z")
      );

      expect(closed).toMatchObject({
        status: "closed_local",
        exitWeightKg: 18_500,
        netWeightKg: 6_500
      });
      expect(listOpenWeighingOperations(database)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("blocks exit weight lower than or equal to entry weight", () => {
    const database = createDatabase();

    try {
      const operation = createSimulatedWeighingOperation(database, {
        identity: createIdentity(database),
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      expect(() =>
        closeWeighingOperation(database, {
          operationId: operation.id,
          exitWeightKg: 11_999
        })
      ).toThrow("Exit weight must be greater than entry weight");
    } finally {
      database.close();
    }
  });

  it("requires a reason to cancel and preserves audit history", () => {
    const database = createDatabase();

    try {
      const operation = createSimulatedWeighingOperation(database, {
        identity: createIdentity(database),
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      expect(() =>
        cancelWeighingOperation(database, { operationId: operation.id, reason: "" })
      ).toThrow("Cancellation reason is required");

      const cancelled = cancelWeighingOperation(database, {
        operationId: operation.id,
        reason: "Cliente desistiu"
      });

      expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Cliente desistiu" });
      expect(database.prepare("SELECT COUNT(*) FROM audit_logs").pluck().get()).toBe(2);
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}

function createIdentity(database: DesktopDatabase) {
  return ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
}
