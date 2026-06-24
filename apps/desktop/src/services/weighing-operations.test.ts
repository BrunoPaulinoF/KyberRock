import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { CreditService } from "./credit";
import {
  cancelWeighingOperation,
  closeWeighingOperation,
  createWeighingOperation,
  createSimulatedWeighingOperation,
  listClosedWeighingOperations,
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

  it("stores operation type, payment term and simulated price table", () => {
    const database = createDatabase();

    try {
      const operation = createSimulatedWeighingOperation(database, {
        identity: createIdentity(database),
        operationType: "internal",
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        paymentTermName: "Quinzenal",
        unitPriceCents: 12_000,
        entryWeightKg: 12_000
      });

      expect(operation).toMatchObject({
        operationType: "internal",
        paymentTermName: "Quinzenal",
        unitPriceCents: 12_000,
        productTotalCents: null,
        totalCents: null
      });
      expect(database.prepare("SELECT COUNT(*) FROM payment_terms").pluck().get()).toBe(1);
      expect(database.prepare("SELECT COUNT(*) FROM price_tables").pluck().get()).toBe(1);
      expect(database.prepare("SELECT COUNT(*) FROM price_table_items").pluck().get()).toBe(1);
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

  it("calculates product total from the simulated price table on close", () => {
    const database = createDatabase();

    try {
      const operation = createSimulatedWeighingOperation(database, {
        identity: createIdentity(database),
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        paymentTermName: "A vista",
        unitPriceCents: 12_000,
        entryWeightKg: 12_000
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500
      });

      expect(closed).toMatchObject({
        netWeightKg: 6_500,
        unitPriceCents: 12_000,
        productTotalCents: 78_000,
        totalCents: 78_000,
        paymentTermName: "A vista"
      });
    } finally {
      database.close();
    }
  });

  it("rejects invalid operation type and negative price", () => {
    const database = createDatabase();

    try {
      expect(() =>
        createSimulatedWeighingOperation(database, {
          identity: createIdentity(database),
          operationType: "invalid" as "invoice",
          customerName: "Cliente Teste",
          plate: "ABC1D23",
          driverName: "Motorista Teste",
          productDescription: "Brita 1",
          entryWeightKg: 12_000
        })
      ).toThrow("Operation type must be invoice or internal");

      expect(() =>
        createSimulatedWeighingOperation(database, {
          identity: createIdentity(database),
          customerName: "Cliente Teste",
          plate: "ABC1D23",
          driverName: "Motorista Teste",
          productDescription: "Brita 1",
          unitPriceCents: -1,
          entryWeightKg: 12_000
        })
      ).toThrow("Unit price cannot be negative");
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
      expect(
        database.prepare("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'").pluck().get()
      ).toBe(4);
    } finally {
      database.close();
    }
  });

  it("blocks duplicate open operations for the same plate", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);

      createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      expect(() =>
        createWeighingOperation(database, {
          identity,
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          entryWeightKg: 13_000
        })
      ).toThrow("Ja existe uma operacao aberta para a placa ABC1D23");
    } finally {
      database.close();
    }
  });

  it("stores manual installments as the operation payment term label", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        manualInstallments: 3,
        entryWeightKg: 12_000
      });

      expect(operation.paymentTermName).toBe("3 parcelas");
      expect(
        database
          .prepare("SELECT manual_installments FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBe(3);
    } finally {
      database.close();
    }
  });

  it("debits prepaid product credit and refunds it when cancelled", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'").run();
      const creditService = new CreditService(database);
      creditService.applyCredit("customer-1", 100_000, "saldo OMIE");

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500
      });

      expect(closed).toMatchObject({
        productTotalCents: 78_000,
        productCreditDebitCents: 78_000,
        freightCreditDebitCents: 0
      });
      expect(creditService.getBalance("customer-1")).toBe(22_000);

      cancelWeighingOperation(database, { operationId: operation.id, reason: "cancelado" });

      expect(creditService.getBalance("customer-1")).toBe(100_000);
    } finally {
      database.close();
    }
  });

  it("does not debit freight from prepaid credit unless requested", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'").run();
      const creditService = new CreditService(database);
      creditService.applyCredit("customer-1", 200_000, "saldo OMIE");

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000,
        freight: {
          payer: "customer",
          rule: {
            id: "freight-1",
            name: "Frete por tonelada",
            type: "per_ton",
            baseValueCents: 10_000,
            unit: "ton"
          }
        }
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500
      });

      expect(closed).toMatchObject({
        productCreditDebitCents: 78_000,
        freightTotalCents: 65_000,
        freightCreditDebitCents: 0,
        totalCents: 143_000
      });
      expect(creditService.getBalance("customer-1")).toBe(122_000);
    } finally {
      database.close();
    }
  });

  it("debits freight from prepaid credit when requested", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'").run();
      const creditService = new CreditService(database);
      creditService.applyCredit("customer-1", 200_000, "saldo OMIE");

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000,
        deductFreightFromCredit: true,
        freight: {
          payer: "customer",
          rule: {
            id: "freight-1",
            name: "Frete por tonelada",
            type: "per_ton",
            baseValueCents: 10_000,
            unit: "ton"
          }
        }
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500
      });

      expect(closed).toMatchObject({
        productCreditDebitCents: 78_000,
        freightTotalCents: 65_000,
        freightCreditDebitCents: 65_000
      });
      expect(creditService.getBalance("customer-1")).toBe(57_000);
    } finally {
      database.close();
    }
  });

  it("blocks prepaid close when credit is insufficient", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'").run();
      new CreditService(database).applyCredit("customer-1", 70_000, "saldo OMIE");

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      expect(() =>
        closeWeighingOperation(database, {
          operationId: operation.id,
          exitWeightKg: 18_500
        })
      ).toThrow("insuficiente");
    } finally {
      database.close();
    }
  });

  it("queues fiscal operations for OMIE billing on close", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      expect(
        database.prepare("SELECT action FROM sync_queue WHERE target = 'omie'").pluck().get()
      ).toBe("create_and_bill_order");
    } finally {
      database.close();
    }
  });

  it("queues a service order job for internal operations", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();

      const operation = createWeighingOperation(database, {
        identity,
        operationType: "internal",
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "internal"
      });

      expect(closed).toMatchObject({ status: "closed_local", operationType: "internal" });
      expect(
        database
          .prepare("SELECT action, idempotency_key FROM sync_queue WHERE target = 'omie'")
          .get()
      ).toMatchObject({
        action: "create_order",
        idempotency_key: `kyberrock:unit-1:${operation.id}:create_service_order`
      });
    } finally {
      database.close();
    }
  });

  it("exposes fiscal billing status on closed operations", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });
      database
        .prepare(
          `UPDATE weighing_operations
           SET omie_sales_order_id = 987,
               omie_billing_status = 'billed',
               omie_billing_message = 'Pedido faturado',
               omie_billed_at = '2026-06-06T13:10:00.000Z',
               omie_document_url = 'https://example.test/danfe.pdf'
           WHERE id = ?`
        )
        .run(operation.id);

      expect(listClosedWeighingOperations(database)[0]).toMatchObject({
        omieSalesOrderId: 987,
        omieBillingStatus: "billed",
        omieBillingMessage: "Pedido faturado",
        omieDocumentUrl: "https://example.test/danfe.pdf"
      });
    } finally {
      database.close();
    }
  });

  it("blocks customers and products flagged as unavailable", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database, { customerBlocked: true });

      expect(() =>
        createWeighingOperation(database, {
          identity,
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          entryWeightKg: 12_000
        })
      ).toThrow("Cliente bloqueado no OMIE");

      database
        .prepare("UPDATE customers SET omie_billing_blocked = 0 WHERE id = 'customer-1'")
        .run();
      database.prepare("UPDATE products SET blocked = 1 WHERE id = 'product-1'").run();

      expect(() =>
        createWeighingOperation(database, {
          identity,
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          entryWeightKg: 12_000
        })
      ).toThrow("Produto inativo ou bloqueado");
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

function insertCatalog(
  database: DesktopDatabase,
  options: { customerBlocked?: boolean } = {}
): void {
  const now = "2026-06-06T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, omie_billing_blocked, created_at, updated_at
      ) VALUES ('customer-1', 'company-1', 'omie', 'Cliente Teste LTDA', 'Cliente Teste', ?, ?, ?)`
    )
    .run(options.customerBlocked ? 1 : 0, now, now);
  database
    .prepare(
      "INSERT INTO vehicles (id, company_id, plate, created_at, updated_at) VALUES ('vehicle-1', 'company-1', 'ABC1D23', ?, ?)"
    )
    .run(now, now);
  database
    .prepare(
      "INSERT INTO drivers (id, company_id, name, created_at, updated_at) VALUES ('driver-1', 'company-1', 'Motorista Teste', ?, ?)"
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO products (
        id, company_id, omie_product_id, code, description, unit, unit_price_cents, item_type, created_at, updated_at
      ) VALUES ('product-1', 'company-1', 123, 'BRITA1', 'Brita 1', 'ton', 15000, '04 - Produtos Acabados', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO product_default_prices (
        id, company_id, product_id, unit_price_cents, unit, created_at, updated_at
      ) VALUES ('default-price-1', 'company-1', 'product-1', 12000, 'ton', ?, ?)`
    )
    .run(now, now);
}
