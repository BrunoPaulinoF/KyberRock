import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { closeWeighingOperation, createSimulatedWeighingOperation } from "./weighing-operations";
import {
  configureReceiptPrintProfile,
  listPrintReceipts,
  printTestReceipt,
  printWeighingReceipt,
  reprintWeighingReceipt,
  type ReceiptPrinter,
  type ReceiptPrintPayload
} from "./printing";

describe("printing", () => {
  it("prints a receipt for a closed operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, {
        identity,
        windowsPrinterName: "TERMICA-80",
        paperWidthMm: 80
      });
      const operation = createClosedOperation(database, identity);

      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      expect(receipt).toMatchObject({
        operationId: operation.id,
        receiptNumber: 1,
        copyNumber: 2,
        printerName: "TERMICA-80",
        status: "printed",
        errorMessage: null
      });
      expect(printer.calls).toHaveLength(2);
      expect(printer.calls[0].lines).toContain("COPIA NRO 000000001");
      expect(printer.calls[1].lines).toContain("2a VIA");
      expect(printer.calls[0].lines).toContain("Cliente: Cliente Teste");
      expect(
        database
          .prepare("SELECT receipt_sequence FROM units WHERE id = ?")
          .pluck()
          .get(identity.unitId)
      ).toBe(1);
      expect(
        database
          .prepare("SELECT action FROM audit_logs WHERE action = 'receipt_printed'")
          .pluck()
          .get()
      ).toBe("receipt_printed");
      expect(
        database
          .prepare("SELECT action FROM sync_queue WHERE entity_type = 'print_receipt'")
          .pluck()
          .get()
      ).toBe("upsert_print_receipt");
    } finally {
      database.close();
    }
  });

  it("reprints a receipt as the next copy", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);
      const firstReceipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );

      const reprint = await reprintWeighingReceipt(
        database,
        { receiptId: firstReceipt.id, identity },
        printer,
        new Date("2026-06-07T13:00:00.000Z")
      );

      expect(reprint).toMatchObject({
        operationId: operation.id,
        receiptNumber: 1,
        copyNumber: 3,
        status: "printed"
      });
      expect(printer.calls).toHaveLength(3);
      expect(printer.calls[2].lines).toContain("3a VIA");
      expect(database.prepare("SELECT COUNT(*) FROM print_receipts").pluck().get()).toBe(3);
      expect(
        database
          .prepare("SELECT action FROM audit_logs WHERE action = 'receipt_reprinted'")
          .pluck()
          .get()
      ).toBe("receipt_reprinted");
    } finally {
      database.close();
    }
  });

  it("records printer failures without changing the closed operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter(new Error("Printer offline"));

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createClosedOperation(database, identity);

      const receipt = await printWeighingReceipt(
        database,
        { operationId: operation.id, identity },
        printer
      );

      expect(receipt).toMatchObject({ status: "failed", errorMessage: "Printer offline" });
      expect(
        database
          .prepare("SELECT status FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBe("closed_local");
      expect(database.prepare("SELECT status FROM print_receipts").pluck().get()).toBe("failed");
    } finally {
      database.close();
    }
  });

  it("rejects printing an open operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      await expect(
        printWeighingReceipt(database, { operationId: operation.id, identity }, printer)
      ).rejects.toThrow("Only closed operations can be printed");
      expect(listPrintReceipts(database)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("prints a test receipt without creating a real operation", async () => {
    const database = createDatabase();
    const printer = createFakePrinter();

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });

      const receipt = await printTestReceipt(
        database,
        { identity },
        printer,
        new Date("2026-06-07T12:00:00.000Z")
      );

      expect(receipt.status).toBe("printed");
      expect(receipt.receiptNumber).toBe(0);
      expect(receipt.copyNumber).toBe(0);
      expect(receipt.printerName).toBe("TERMICA-80");
      expect(printer.calls).toHaveLength(1);
      expect(printer.calls[0].lines).toContain("=== CUPOM DE TESTE ===");
      expect(printer.calls[0].lines).toContain("Cliente: Cliente Exemplo");
      expect(printer.calls[0].lines).toContain("Veiculo: ABC1D23");
      expect(printer.calls[0].lines).toContain("Motorista: Motorista Teste");
      expect(printer.calls[0].lines).toContain("0001-BRITA 1 (TESTE)");
      expect(printer.calls[0].lines).toContain("ENTRADA <TARA>: 12,000 <TON>");
      expect(printer.calls[0].lines).toContain("SAIDA <CARREGADO>: 18,500 <TON>");
      expect(printer.calls[0].lines).toContain("LIQUIDO: 6,500 <TON>");
      expect(printer.calls[0].lines.some((line) => line.includes("R$") && line.includes("780,00"))).toBe(true);

      // Nao deve criar operacao real
      expect(listPrintReceipts(database)).toHaveLength(1);
      const printReceipt = listPrintReceipts(database)[0];
      expect(printReceipt.operationId).toBe("test");
    } finally {
      database.close();
    }
  });

  it("records test receipt failures without crashing", async () => {
    const database = createDatabase();
    const printer = createFakePrinter(new Error("Printer offline"));

    try {
      const identity = createIdentity(database);
      configureReceiptPrintProfile(database, { identity, windowsPrinterName: "TERMICA-80" });

      const receipt = await printTestReceipt(database, { identity }, printer);

      expect(receipt.status).toBe("failed");
      expect(receipt.errorMessage).toBe("Printer offline");
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

function createIdentity(database: DesktopDatabase): LocalDesktopIdentity {
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

function createClosedOperation(database: DesktopDatabase, identity: LocalDesktopIdentity) {
  const operation = createSimulatedWeighingOperation(database, {
    identity,
    operationType: "invoice",
    customerName: "Cliente Teste",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    productDescription: "Brita 1",
    paymentTermName: "A vista",
    unitPriceCents: 12,
    entryWeightKg: 12_000
  });

  return closeWeighingOperation(database, {
    operationId: operation.id,
    exitWeightKg: 18_500
  });
}

function createFakePrinter(error?: Error): ReceiptPrinter & { calls: ReceiptPrintPayload[] } {
  const calls: ReceiptPrintPayload[] = [];

  return {
    calls,
    async printReceipt(payload) {
      calls.push(payload);

      if (error) {
        throw error;
      }
    }
  };
}
