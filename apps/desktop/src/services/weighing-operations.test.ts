import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { CreditService } from "./credit";
import { buildOmieIntegrationCode } from "@kyberrock/omie-client";
import {
  buildOmieBillingJob,
  cancelWeighingOperation,
  closeWeighingOperation,
  createWeighingOperation,
  createSimulatedWeighingOperation,
  deleteClosedWeighingOperation,
  listClosedWeighingOperations,
  listOpenWeighingOperations,
  validateCustomerFiscalReadiness
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

  it("dead-letters a pending OMIE create job when cancelling before send", () => {
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

      cancelWeighingOperation(database, { operationId: operation.id, reason: "cancelado" });

      expect(
        database
          .prepare(
            "SELECT status FROM sync_queue WHERE target = 'omie' AND action = 'create_order'"
          )
          .pluck()
          .get()
      ).toBe("dead_letter");
      expect(
        database
          .prepare("SELECT COUNT(*) FROM sync_queue WHERE action = 'cancel_order'")
          .pluck()
          .get()
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("enqueues an OMIE cancel job when the sales order was already sent", () => {
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
        entryWeightKg: 12_000
      });
      database
        .prepare("UPDATE weighing_operations SET omie_sales_order_id = 9876 WHERE id = ?")
        .run(operation.id);

      cancelWeighingOperation(database, { operationId: operation.id, reason: "erro fiscal" });

      const job = database
        .prepare(
          "SELECT idempotency_key, payload_json FROM sync_queue WHERE action = 'cancel_order'"
        )
        .get() as { idempotency_key: string; payload_json: string } | undefined;
      expect(job?.idempotency_key).toBe(`omie:cancel:${operation.id}`);
      const payload = JSON.parse(job!.payload_json) as { orderType: string; omieOrderId: number };
      expect(payload).toMatchObject({ orderType: "sales", omieOrderId: 9876 });
    } finally {
      database.close();
    }
  });

  it("enqueues a service-order cancel for internal operations already sent", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);

      const operation = createWeighingOperation(database, {
        identity,
        operationType: "internal",
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });
      database
        .prepare("UPDATE weighing_operations SET omie_service_order_id = 555 WHERE id = ?")
        .run(operation.id);

      cancelWeighingOperation(database, { operationId: operation.id, reason: "erro" });
      cancelWeighingOperation(database, { operationId: operation.id, reason: "erro de novo" });

      const jobs = database
        .prepare("SELECT payload_json FROM sync_queue WHERE action = 'cancel_order'")
        .all() as Array<{ payload_json: string }>;
      // Cancel duplo nao duplica o job (INSERT OR IGNORE na chave idempotente).
      expect(jobs).toHaveLength(1);
      const payload = JSON.parse(jobs[0].payload_json) as { orderType: string; omieOrderId: number };
      expect(payload).toMatchObject({ orderType: "service", omieOrderId: 555 });
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
        manualDownPaymentCents: 15000,
        entryWeightKg: 12_000
      });

      expect(operation.paymentTermName).toBe("3 parcelas");
      expect(
        database
          .prepare("SELECT manual_installments FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBe(3);
      expect(
        database
          .prepare("SELECT manual_down_payment_cents FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBe(15000);
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

  it("soft-deletes a closed operation and keeps others", () => {
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
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });
      expect(listClosedWeighingOperations(database)).toHaveLength(1);

      deleteClosedWeighingOperation(database, operation.id);
      expect(listClosedWeighingOperations(database)).toHaveLength(0);

      // Operacao aberta (nao concluida) nao pode ser excluida por aqui.
      const open = createSimulatedWeighingOperation(database, {
        identity: createIdentity(database),
        customerName: "Cliente 2",
        plate: "XYZ9K88",
        driverName: "Motorista 2",
        productDescription: "Brita 0",
        entryWeightKg: 10_000
      });
      expect(() => deleteClosedWeighingOperation(database, open.id)).toThrow(/concluidas/i);
    } finally {
      database.close();
    }
  });

  it("queues fiscal operations as create-only orders on close (billing happens in OMIE)", () => {
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

      // O app so cria o pedido; a emissao da NF-e e feita dentro do OMIE.
      expect(
        database.prepare("SELECT action FROM sync_queue WHERE target = 'omie'").pluck().get()
      ).toBe("create_order");
    } finally {
      database.close();
    }
  });

  it("sends the sales order without billing when the customer is missing NF-e fields", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Cliente sem Numero do Endereco e sem E-mail (exigidos para a NF-e).
      database
        .prepare(
          "UPDATE customers SET omie_customer_id = 456, email = NULL, address_number = NULL WHERE id = 'customer-1'"
        )
        .run();

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
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      // Fecha localmente e sobe o PEDIDO: criar pedido nao exige campos de NF-e
      // (a emissao e feita dentro do OMIE, que cobra o cadastro na hora de faturar).
      expect(closed.status).toBe("closed_local");
      const omieJob = database
        .prepare("SELECT action, idempotency_key FROM sync_queue WHERE target = 'omie'")
        .get() as { action: string; idempotency_key: string };
      expect(omieJob.action).toBe("create_order");
      expect(omieJob.idempotency_key).toBe(
        buildOmieIntegrationCode("unit-1", operation.id, "create_sales_order")
      );
    } finally {
      database.close();
    }
  });

  it("validateCustomerFiscalReadiness reports missing fields and OMIE-origin hint", () => {
    const database = createDatabase();

    try {
      // insertCatalog referencia company-1; a identidade cria a empresa (FK).
      createIdentity(database);
      insertCatalog(database);
      expect(validateCustomerFiscalReadiness(database, "customer-1").ready).toBe(true);

      database.prepare("UPDATE customers SET email = '   ' WHERE id = 'customer-1'").run();
      const missingEmail = validateCustomerFiscalReadiness(database, "customer-1");
      expect(missingEmail.ready).toBe(false);
      expect(missingEmail.missing).toEqual(["email"]);

      database
        .prepare("UPDATE customers SET address_number = NULL, email = NULL WHERE id = 'customer-1'")
        .run();
      const missingBoth = validateCustomerFiscalReadiness(database, "customer-1");
      expect(missingBoth.missing).toEqual(["address_number", "email"]);
      // Cliente source='omie' -> orienta corrigir no portal OMIE.
      expect(missingBoth.message).toContain("portal OMIE");

      expect(validateCustomerFiscalReadiness(database, null).ready).toBe(false);
    } finally {
      database.close();
    }
  });

  it("buildOmieBillingJob reproduces the payload and idempotency key of the close", () => {
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

      const enqueued = database
        .prepare(
          "SELECT idempotency_key, payload_json FROM sync_queue WHERE target = 'omie' AND action = 'create_order'"
        )
        .get() as { idempotency_key: string; payload_json: string };

      const built = buildOmieBillingJob(database, operation.id);
      expect(built).not.toBeNull();
      expect(built!.idempotencyKey).toBe(enqueued.idempotency_key);
      expect(built!.payload).toEqual(JSON.parse(enqueued.payload_json));
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
        idempotency_key: buildOmieIntegrationCode("unit-1", operation.id, "create_service_order")
      });
    } finally {
      database.close();
    }
  });

  it("flags an invoice close as cadastro_incompleto when the customer has no OMIE code", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Cliente SEM omie_customer_id (nao vinculado ao OMIE).

      const operation = createWeighingOperation(database, {
        identity,
        operationType: "invoice",
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      // Nao enfileira pedido OMIE (nada a enviar)...
      expect(
        database.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE target = 'omie'").get()
      ).toMatchObject({ n: 0 });
      // ...mas o motivo fica visivel em vez de sumir em silencio.
      expect(closed.omieBillingStatus).toBe("cadastro_incompleto");
      expect(closed.omieBillingMessage).toContain("Cliente sem codigo OMIE");
    } finally {
      database.close();
    }
  });

  it("forwards the linked OMIE parcela code in the enqueued order payload", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, omie_parcela_code, is_active, created_at, updated_at)
           VALUES ('term-030', 'company-1', 'A prazo 30', '{}', '030', 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO omie_payment_terms (id, company_id, omie_id, code, description, installment_count, installment_days_json, is_active, visible, created_at, updated_at)
           VALUES ('omie_parcela_030', 'company-1', 30, '030', '30 dias', 2, '[15,30]', 1, 1, ?, ?)`
        )
        .run(now, now);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentTermId: "term-030",
        entryWeightKg: 12_000
      });

      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const payloadJson = database
        .prepare("SELECT payload_json FROM sync_queue WHERE target = 'omie'")
        .pluck()
        .get() as string;
      const payload = JSON.parse(payloadJson) as {
        paymentTermOmieCode: string | null;
        paymentTermInstallmentCount: number | null;
        paymentTermInstallmentDays: number[] | null;
      };
      expect(payload.paymentTermOmieCode).toBe("030");
      expect(payload.paymentTermInstallmentCount).toBe(2);
      expect(payload.paymentTermInstallmentDays).toEqual([15, 30]);
    } finally {
      database.close();
    }
  });

  it("sends the OMIE codes of the selected payment method and its linked account", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO accounts (id, company_id, code, name, omie_code, is_system, sort_order, is_active, created_at, updated_at)
           VALUES ('account-getnet', 'company-1', NULL, 'GetNet', '4321', 0, 1, 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, omie_code, account_id, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
           VALUES ('method-debit', 'company-1', 'debit_card', 'Cartao de debito', '04', 'account-getnet', 0, 0, 1, 1, ?, ?)`
        )
        .run(now, now);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "method-debit",
        entryWeightKg: 12_000
      });

      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const payloadJson = database
        .prepare("SELECT payload_json FROM sync_queue WHERE target = 'omie'")
        .pluck()
        .get() as string;
      const payload = JSON.parse(payloadJson) as {
        paymentMethodOmieCode: string | null;
        accountOmieCode: string | null;
      };
      expect(payload.paymentMethodOmieCode).toBe("04");
      expect(payload.accountOmieCode).toBe("4321");
    } finally {
      database.close();
    }
  });

  it("saves the entry's condition and method as customer defaults when empty", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
           VALUES ('method-pix', 'company-1', 'pix', 'Pix', 1, 0, 1, 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, is_active, created_at, updated_at)
           VALUES ('term-7-14', 'company-1', '7/14', '{"raw":"7/14"}', 1, ?, ?)`
        )
        .run(now, now);

      createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentTermId: "term-7-14",
        paymentMethodId: "method-pix",
        entryWeightKg: 12_000
      });

      const customer = database
        .prepare(
          "SELECT default_payment_term_id, default_payment_method_id FROM customers WHERE id = 'customer-1'"
        )
        .get() as { default_payment_term_id: string | null; default_payment_method_id: string | null };
      expect(customer.default_payment_term_id).toBe("term-7-14");
      expect(customer.default_payment_method_id).toBe("method-pix");
    } finally {
      database.close();
    }
  });

  it("does not overwrite existing customer defaults with the entry's choices", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
           VALUES ('method-pix', 'company-1', 'pix', 'Pix', 1, 0, 1, 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          "UPDATE customers SET default_payment_term_id = 'term-original', default_payment_method_id = 'method-original' WHERE id = 'customer-1'"
        )
        .run();

      createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "method-pix",
        entryWeightKg: 12_000
      });

      const customer = database
        .prepare(
          "SELECT default_payment_term_id, default_payment_method_id FROM customers WHERE id = 'customer-1'"
        )
        .get() as { default_payment_term_id: string | null; default_payment_method_id: string | null };
      expect(customer.default_payment_term_id).toBe("term-original");
      expect(customer.default_payment_method_id).toBe("method-original");
    } finally {
      database.close();
    }
  });

  it("sends null payment method/account codes when no method was selected", () => {
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

      const payloadJson = database
        .prepare("SELECT payload_json FROM sync_queue WHERE target = 'omie'")
        .pluck()
        .get() as string;
      const payload = JSON.parse(payloadJson) as {
        paymentMethodOmieCode: string | null;
        accountOmieCode: string | null;
      };
      expect(payload.paymentMethodOmieCode).toBeNull();
      expect(payload.accountOmieCode).toBeNull();
    } finally {
      database.close();
    }
  });

  it("sends a null parcela code when the operation term has no OMIE link", () => {
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

      const payloadJson = database
        .prepare("SELECT payload_json FROM sync_queue WHERE target = 'omie'")
        .pluck()
        .get() as string;
      const payload = JSON.parse(payloadJson) as { paymentTermOmieCode: string | null };
      expect(payload.paymentTermOmieCode).toBeNull();
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
        id, company_id, source, legal_name, trade_name, email, address_number, omie_billing_blocked, created_at, updated_at
      ) VALUES ('customer-1', 'company-1', 'omie', 'Cliente Teste LTDA', 'Cliente Teste', 'cliente@example.com', '123', ?, ?, ?)`
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
