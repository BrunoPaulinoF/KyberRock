import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { CreditService } from "./credit";
import { CustomerReportService } from "./customer-report";
import { rememberCustomerFreightValue } from "./customer-freight-rules";
import { setDefaultNfeEmail } from "./customers";
import { createPaymentTerm } from "./payment-terms";
import { enqueueSyncJob } from "./sync-queue";
import { buildOmieIntegrationCode } from "@kyberrock/omie-client";
import {
  buildOmieBillingJob,
  getCustomerLastEntryPreferences,
  cancelWeighingOperation,
  clearClosedWeighingOperations,
  closeWeighingOperation,
  createWeighingOperation,
  createSimulatedWeighingOperation,
  nextOperationCode,
  deleteClosedWeighingOperation,
  getOperationOmieIssue,
  getWeighingOperation,
  listCanceledWeighingOperations,
  listClosedWeighingOperations,
  listOpenWeighingOperations,
  updateWeighingOperationCustomer,
  updateWeighingOperationCarrier,
  updateWeighingOperationDetails,
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

  // Codigo sequencial que sai no topo do cupom: uma sequencia unica da pedreira, que
  // anda de 1 em 1 independente de cliente, produto ou balanca.
  it("numera cada operacao com o proximo codigo da pedreira", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      const first = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente A",
        plate: "AAA1A11",
        driverName: "Motorista A",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      const second = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente B",
        plate: "BBB2B22",
        driverName: "Motorista B",
        productDescription: "Po de pedra",
        entryWeightKg: 13_000
      });

      const codeOf = (id: string): number =>
        database
          .prepare("SELECT operation_code FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(id) as number;

      expect(codeOf(first.id)).toBe(1);
      expect(codeOf(second.id)).toBe(2);
      expect(nextOperationCode(database, identity.unitId)).toBe(3);
    } finally {
      database.close();
    }
  });

  // A sequencia so anda para frente: reaproveitar o codigo de uma cancelada faria dois
  // cupons diferentes sairem com o mesmo numero.
  it("nao reaproveita o codigo de uma operacao ja criada", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente A",
        plate: "AAA1A11",
        driverName: "Motorista A",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      database
        .prepare("UPDATE weighing_operations SET status = 'cancelled' WHERE id = ?")
        .run(operation.id);

      expect(nextOperationCode(database, identity.unitId)).toBe(2);
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
      const payload = JSON.parse(jobs[0].payload_json) as {
        orderType: string;
        omieOrderId: number;
      };
      expect(payload).toMatchObject({ orderType: "service", omieOrderId: 555 });
    } finally {
      database.close();
    }
  });

  it("moves a completed OMIE-synced sale out of the closed list and cancels it in OMIE", () => {
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });
      // Cenario do botao "Venda cancelada" na aba Concluidas: a venda ja foi concluida
      // e sincronizada com o OMIE, mas o cliente desistiu antes do faturamento.
      database
        .prepare(
          "UPDATE weighing_operations SET status = 'synced', omie_sales_order_id = 4321 WHERE id = ?"
        )
        .run(operation.id);

      expect(listClosedWeighingOperations(database).map((op) => op.id)).toContain(operation.id);
      expect(listCanceledWeighingOperations(database).map((op) => op.id)).not.toContain(
        operation.id
      );

      const cancelled = cancelWeighingOperation(database, {
        operationId: operation.id,
        reason: "Cliente desistiu da compra antes do faturamento"
      });

      expect(cancelled).toMatchObject({ status: "cancelled" });
      // Sai de Concluidas (portanto dos insights/relatorios) e entra em Canceladas.
      expect(listClosedWeighingOperations(database).map((op) => op.id)).not.toContain(operation.id);
      expect(listCanceledWeighingOperations(database).map((op) => op.id)).toContain(operation.id);
      // O cancelamento do pedido ja enviado e solicitado ao OMIE.
      const cancelJob = database
        .prepare("SELECT payload_json FROM sync_queue WHERE action = 'cancel_order'")
        .get() as { payload_json: string } | undefined;
      expect(cancelJob).toBeDefined();
      expect(JSON.parse(cancelJob!.payload_json)).toMatchObject({
        orderType: "sales",
        omieOrderId: 4321
      });
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
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      const creditService = new CreditService(database);
      seedOmieAdvance(database, identity.companyId, 100_000);

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

  it("reserva a baixa do adiantamento no OMIE ate o limite do que veio de la", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      // Metade do saldo veio do financeiro do OMIE (adiantamento) e metade foi
      // lancada aqui: so a parte do OMIE pode ser baixada la.
      database
        .prepare(
          `INSERT INTO customer_credit_movements (
             id, company_id, customer_id, operation_id, movement_type, amount_cents,
             balance_after_cents, reason, source, omie_title_id, created_at
           ) VALUES ('adv-1', ?, 'customer-1', NULL, 'credit', 40000, 40000,
                     'Adiantamento OMIE #7001', 'omie', 7001, '2026-07-20T10:00:00.000Z')`
        )
        .run(identity.companyId);
      database
        .prepare(
          `INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
           VALUES ('customer-1', 40000, '2026-07-20T10:00:00.000Z')
           ON CONFLICT(customer_id) DO UPDATE SET balance_cents = excluded.balance_cents`
        )
        .run();
      seedLocalCredit(database, identity.companyId, 60_000, "local-ajuste");

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });

      const row = database
        .prepare(
          `SELECT omie_advance_settle_cents, omie_advance_status
           FROM weighing_operations WHERE id = ?`
        )
        .get(operation.id) as { omie_advance_settle_cents: number; omie_advance_status: string };
      // Debito de 780,00, adiantamento do OMIE de 400,00: o resto e fiado/ajuste
      // local e nao vira baixa no OMIE.
      expect(row).toEqual({ omie_advance_settle_cents: 40_000, omie_advance_status: "pending" });
    } finally {
      database.close();
    }
  });

  it("nao reserva baixa no OMIE quando o credito nao veio de adiantamento", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      seedLocalCredit(database, identity.companyId, 100_000);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });

      const row = database
        .prepare(
          `SELECT omie_advance_settle_cents, omie_advance_status
           FROM weighing_operations WHERE id = ?`
        )
        .get(operation.id) as {
        omie_advance_settle_cents: number;
        omie_advance_status: string | null;
      };
      expect(row).toEqual({ omie_advance_settle_cents: 0, omie_advance_status: null });
    } finally {
      database.close();
    }
  });

  it("does not debit prepaid credit twice on a double close (idempotent)", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      const creditService = new CreditService(database);
      seedOmieAdvance(database, identity.companyId, 100_000);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      const first = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500
      });
      expect(first.productCreditDebitCents).toBe(78_000);
      expect(creditService.getBalance("customer-1")).toBe(22_000);

      // Segundo fechamento (duplo-clique/retry) e um no-op idempotente: o saldo nao e debitado
      // de novo e apenas um movimento de debito existe para a operacao.
      const second = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500
      });
      expect(second.status).toBe(first.status);
      expect(creditService.getBalance("customer-1")).toBe(22_000);

      const debitCount = database
        .prepare(
          "SELECT COUNT(*) FROM customer_credit_movements WHERE operation_id = ? AND movement_type = 'debit_product'"
        )
        .pluck()
        .get(operation.id);
      expect(debitCount).toBe(1);
    } finally {
      database.close();
    }
  });

  it("does not refund prepaid credit twice on a double cancel (idempotent)", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      const creditService = new CreditService(database);
      seedOmieAdvance(database, identity.companyId, 100_000);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });
      expect(creditService.getBalance("customer-1")).toBe(22_000);

      cancelWeighingOperation(database, { operationId: operation.id, reason: "cancelado" });
      // Segundo cancelamento e no-op: o credito nao e re-estornado (saldo continua no valor cheio).
      cancelWeighingOperation(database, { operationId: operation.id, reason: "de novo" });

      expect(creditService.getBalance("customer-1")).toBe(100_000);
      const refundCount = database
        .prepare(
          "SELECT COUNT(*) FROM customer_credit_movements WHERE operation_id = ? AND movement_type = 'refund_product'"
        )
        .pluck()
        .get(operation.id);
      expect(refundCount).toBe(1);
    } finally {
      database.close();
    }
  });

  it("neutralizes pending OMIE jobs when a closed operation is deleted", () => {
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
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });

      // Simula um job de criacao OMIE ainda na fila (nao enviado) para a operacao.
      enqueueSyncJob(database, {
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: operation.id,
        idempotencyKey: `omie:create:${operation.id}`,
        payload: { operationId: operation.id }
      });

      deleteClosedWeighingOperation(database, operation.id);

      const job = database
        .prepare("SELECT status FROM sync_queue WHERE entity_id = ? AND action = 'create_order'")
        .get(operation.id) as { status: string } | undefined;
      // Excluir a operacao concluida neutraliza o job pendente (dead_letter): nao cria pedido
      // "fantasma" no OMIE depois que o operador excluiu a operacao localmente.
      expect(job?.status).toBe("dead_letter");
    } finally {
      database.close();
    }
  });

  it("does not debit freight from prepaid credit unless requested", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      const creditService = new CreditService(database);
      seedOmieAdvance(database, identity.companyId, 200_000);

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
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      const creditService = new CreditService(database);
      seedOmieAdvance(database, identity.companyId, 200_000);

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

  it("closes a credit sale funded by the customer credit limit", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Cadastro do cliente relatado: limite de R$ 20.000 e debito de credito
      // pre-pago, mas sem nenhum deposito no extrato. Antes o fechamento acusava
      // "Credito insuficiente. Disponivel: R$ 0,00" e a venda nao fechava.
      database
        .prepare(
          "UPDATE customers SET credit_mode = 'prepaid', credit_limit_cents = 2000000 WHERE id = 'customer-1'"
        )
        .run();
      const creditService = new CreditService(database);

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
        status: "closed_local",
        productTotalCents: 78_000,
        productCreditDebitCents: 78_000
      });
      // O limite consumido fica no extrato (saldo negativo) para a cobranca posterior.
      expect(creditService.getSummary("customer-1")).toMatchObject({
        balanceCents: -78_000,
        usedCents: 78_000,
        availableCents: 1_922_000
      });
    } finally {
      database.close();
    }
  });

  it("debits the credit ledger when the payment method is customer credit", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
           VALUES ('method-credit', 'company-1', 'customer_credit', 'Credito do cliente', 1, 1, 6, 1, ?, ?)`
        )
        .run(now, now);
      // Cliente no modo normal ("nao debitar credito"): e a FORMA de pagamento
      // escolhida na entrada que joga a venda no fiado.
      database
        .prepare("UPDATE customers SET credit_limit_cents = 100000 WHERE id = 'customer-1'")
        .run();

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "method-credit",
        entryWeightKg: 12_000
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 13_000
      });

      expect(closed.productCreditDebitCents).toBe(12_000);
      expect(new CreditService(database).getSummary("customer-1")).toMatchObject({
        usedCents: 12_000,
        availableCents: 88_000
      });
    } finally {
      database.close();
    }
  });

  it("sends the credit sale installments and due dates to the customer report", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
           VALUES ('method-credit', 'company-1', 'customer_credit', 'Credito do cliente', 1, 1, 6, 1, ?, ?)`
        )
        .run(now, now);
      // Condicao do cliente relatado: 3 parcelas em 10/20/30 dias.
      database
        .prepare(
          `INSERT INTO payment_terms (
             id, company_id, name, rules_json, first_installment_days, installment_interval_days,
             installment_count, installment_days_json, created_at, updated_at
           ) VALUES ('term-10-20-30', 'company-1', '3 parcelas', '{"raw":"10/20/30"}', 10, 10, 3, '[10,20,30]', ?, ?)`
        )
        .run(now, now);
      database
        .prepare("UPDATE customers SET credit_limit_cents = 2000000 WHERE id = 'customer-1'")
        .run();

      const operation = createWeighingOperation(
        database,
        {
          identity,
          customerId: "customer-1",
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          productId: "product-1",
          paymentMethodId: "method-credit",
          paymentTermId: "term-10-20-30",
          entryWeightKg: 12_000
        },
        new Date("2026-06-06T12:00:00.000Z")
      );
      closeWeighingOperation(
        database,
        { operationId: operation.id, exitWeightKg: 18_500 },
        new Date("2026-06-06T13:00:00.000Z")
      );

      const report = new CustomerReportService(database).getCustomerReport(
        "customer-1",
        "2026-06-01",
        "2026-07-31",
        identity.unitId,
        null,
        new Date("2026-06-07T12:00:00.000Z")
      );

      // Cada parcela vira uma cobranca datada no relatorio do cliente.
      expect(report.installments.map((item) => item.dueDate)).toEqual([
        "2026-06-16",
        "2026-06-26",
        "2026-07-06"
      ]);
      // Rateio no mesmo criterio do pedido OMIE (percentual igual, ultima parcela
      // absorve o arredondamento) para a cobranca bater com o que foi faturado.
      expect(report.installments.map((item) => item.amountCents)).toEqual([25_997, 25_997, 26_006]);
      expect(report.installments[0].paymentMethodName).toBe("Credito do cliente");
      expect(report.installmentTotals.amountCents).toBe(78_000);
    } finally {
      database.close();
    }
  });

  it("blocks prepaid close when credit is insufficient", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare("UPDATE customers SET credit_mode = 'prepaid' WHERE id = 'customer-1'")
        .run();
      seedOmieAdvance(database, identity.companyId, 70_000);

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

  // A aba Fiscal do cadastro do cliente alimenta os "Enderecos de e-mail que recebem a NF"
  // da propria operacao no OMIE: o espelho no cadastro (email_fatura) nao preenchia esse
  // campo do pedido, entao a tela de e-mails da operacao nascia vazia.
  it("sends every fiscal-tab email of the customer as the invoice recipients of the order", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare(
          `UPDATE customers
             SET omie_customer_id = 456,
                 document = '12345678000195',
                 email = 'contato@cliente.com',
                 fiscal_emails = 'fiscal@cliente.com, financeiro@cliente.com'
           WHERE id = 'customer-1'`
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id);

      expect(built!.payload.invoiceEmails).toBe("fiscal@cliente.com, financeiro@cliente.com");
      // O e-mail de CONTATO continua sendo outra coisa: ele nao decide quem recebe a nota.
      expect(built!.payload.customer?.email).toBe("contato@cliente.com");
    } finally {
      database.close();
    }
  });

  it("leaves the order invoice recipients empty when the customer has no fiscal emails", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare(
          "UPDATE customers SET omie_customer_id = 456, document = '12345678000195', fiscal_emails = NULL WHERE id = 'customer-1'"
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      // Vazio: o edge nao manda o campo e o OMIE cai no cadastro do cliente.
      expect(buildOmieBillingJob(database, operation.id)!.payload.invoiceEmails).toBe("");
    } finally {
      database.close();
    }
  });

  it("sends the customer cadastro with the default NF-e email when the customer has none", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Cliente que ainda nao existe no OMIE: sem codigo, com CNPJ e sem e-mail proprio.
      database
        .prepare(
          "UPDATE customers SET omie_customer_id = NULL, document = '12345678000195', email = NULL WHERE id = 'customer-1'"
        )
        .run();
      setDefaultNfeEmail(database, "nfe@pedreira.com.br");

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

      const built = buildOmieBillingJob(database, operation.id);

      // customerOmieId 0 + cadastro embutido: o edge cria o cliente no OMIE e so entao
      // monta o pedido — o fechamento vai inteiro numa chamada so.
      expect(built!.payload.customerOmieId).toBe(0);
      expect(built!.payload.customer).toMatchObject({
        localCustomerId: "customer-1",
        cnpjCpf: "12345678000195",
        // Sem e-mail o OMIE recusa o IncluirCliente e o fechamento morria junto.
        email: "nfe@pedreira.com.br"
      });
    } finally {
      database.close();
    }
  });

  it("sends the customer and carrier cadastro even when both already have an OMIE code", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare(
          "UPDATE customers SET omie_customer_id = 456, document = '12345678000195' WHERE id = 'customer-1'"
        )
        .run();
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, omie_customer_id, name, document, source, created_at, updated_at)
           VALUES ('carrier-1', 'company-1', 987654, 'Transportadora Teste', '22222222000182', 'omie', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('vc-1', 'vehicle-1', 'carrier-1', 1, datetime('now'), datetime('now'))`
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id);

      // O edge ignora o cadastro quando o codigo vale; ele viaja junto para o edge poder
      // refazer o vinculo quando o OMIE recusa o codigo local ("Cliente nao cadastrado
      // para o Codigo [...]") — sem ele o fechamento fica preso na fila.
      expect(built!.payload.customerOmieId).toBe(456);
      expect(built!.payload.customer).toMatchObject({
        localCustomerId: "customer-1",
        cnpjCpf: "12345678000195"
      });
      expect(built!.payload.carrier).toMatchObject({
        localCarrierId: "carrier-1",
        cnpjCpf: "22222222000182"
      });
    } finally {
      database.close();
    }
  });

  it("includes the transport data (plate, driver, carrier, cargo weight) in the OMIE job", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      // Transportadora com codigo OMIE vinculada ao veiculo da operacao.
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, omie_customer_id, name, source, created_at, updated_at)
           VALUES ('carrier-1', 'company-1', 987654, 'Transportadora Teste', 'omie', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('vc-1', 'vehicle-1', 'carrier-1', 1, datetime('now'), datetime('now'))`
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id);
      expect(built).not.toBeNull();
      expect(built!.payload.transport).toEqual({
        plate: "ABC1D23",
        // Veiculo ainda sem UF no cadastro: o pedido segue so com a placa.
        plateState: null,
        driverName: "Motorista Teste",
        carrierOmieId: 987654,
        carrierName: "Transportadora Teste",
        cargoWeightKg: 6_500,
        ownVehicle: false
      });

      // Com a UF do cadastro (sincronizada do OMIE), ela acompanha a placa no frete.
      database.prepare("UPDATE vehicles SET plate_state = 'mg' WHERE id = 'vehicle-1'").run();
      expect(buildOmieBillingJob(database, operation.id)!.payload.transport?.plateState).toBe("MG");
    } finally {
      database.close();
    }
  });

  it("sends the carrier chosen on the operation, not the one linked to the vehicle", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      // Veiculo vinculado a uma transportadora antiga; o operador escolheu outra na entrada.
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, omie_customer_id, name, source, created_at, updated_at)
           VALUES ('carrier-vehicle', 'company-1', 111111, 'Transportadora do Veiculo', 'omie', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, omie_customer_id, name, source, created_at, updated_at)
           VALUES ('carrier-chosen', 'company-1', 222222, 'Transportadora Escolhida', 'omie', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('vc-1', 'vehicle-1', 'carrier-vehicle', 1, datetime('now'), datetime('now'))`
        )
        .run();

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        carrierId: "carrier-chosen",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id);
      // Antes o pedido so olhava vehicle_carriers: a transportadora selecionada na
      // entrada nao chegava ao OMIE e o campo ficava em branco no pedido.
      expect(built!.payload.transport).toMatchObject({ carrierOmieId: 222222 });
    } finally {
      database.close();
    }
  });

  it("sends the cadastro of a carrier that is not in OMIE yet, instead of the vehicle one", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      // Transportadora escolhida na entrada, ainda sem cadastro no OMIE.
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, document, phone, city, state, source, created_at, updated_at)
           VALUES ('carrier-local', 'company-1', 'Transportadora Local', '11222333000144', '(19) 61289-7260', 'Brasilia', 'DF', 'local', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, omie_customer_id, name, source, created_at, updated_at)
           VALUES ('carrier-vehicle', 'company-1', 111111, 'Transportadora do Veiculo', 'omie', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('vc-1', 'vehicle-1', 'carrier-vehicle', 1, datetime('now'), datetime('now'))`
        )
        .run();

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        carrierId: "carrier-local",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id)!;
      // Sem codigo OMIE ainda: o cadastro sobe junto e o edge cria a transportadora
      // antes do pedido. NAO cai para a do veiculo — a NF-e sairia com a errada.
      expect(built.payload.transport).toMatchObject({ carrierOmieId: null });
      expect(built.payload.localCarrierId).toBe("carrier-local");
      expect(built.payload.carrier).toMatchObject({
        localCarrierId: "carrier-local",
        name: "Transportadora Local",
        cnpjCpf: "11222333000144",
        telefone1Ddd: "19",
        city: "Brasilia",
        state: "DF"
      });
    } finally {
      database.close();
    }
  });

  it("omits the carrier cadastro when the carrier has no document", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      // Transportadora automatica "<cliente> (padrão)": sem CNPJ/CPF, o OMIE recusaria o
      // cadastro. O pedido segue sem transportadora em vez de falhar o fechamento.
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, source, created_at, updated_at)
           VALUES ('carrier-sem-doc', 'company-1', 'Cliente Teste (padrão)', 'local', datetime('now'), datetime('now'))`
        )
        .run();

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        carrierId: "carrier-sem-doc",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id)!;
      expect(built.payload.carrier).toBeNull();
      expect(built.payload.transport).toMatchObject({ carrierOmieId: null });
    } finally {
      database.close();
    }
  });

  it("uses the vehicle carrier only when the operation has none", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, omie_customer_id, name, source, created_at, updated_at)
           VALUES ('carrier-vehicle', 'company-1', 111111, 'Transportadora do Veiculo', 'omie', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('vc-1', 'vehicle-1', 'carrier-vehicle', 1, datetime('now'), datetime('now'))`
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      expect(buildOmieBillingJob(database, operation.id)!.payload.transport).toMatchObject({
        carrierOmieId: 111111
      });
    } finally {
      database.close();
    }
  });

  it("sends the product OMIE category in the order job", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO omie_categories (id, company_id, code, description, is_active, created_at, updated_at)
           VALUES ('cat-aterro', 'company-1', '1.01.02', 'Clientes - Aterro', 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare("UPDATE products SET omie_category_code = '1.01.02' WHERE id = 'product-1'")
        .run();

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

      // Antes o edge mandava "1.01.01" fixo: toda venda caia na mesma categoria no OMIE.
      expect(buildOmieBillingJob(database, operation.id)!.payload.omieCategoryCode).toBe("1.01.02");
    } finally {
      database.close();
    }
  });

  it("falls back to the historic category when the product has none", () => {
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

      expect(buildOmieBillingJob(database, operation.id)!.payload.omieCategoryCode).toBe("1.01.01");
    } finally {
      database.close();
    }
  });

  it("sends the charged freight value and modality in the OMIE job", () => {
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
      database
        .prepare("UPDATE weighing_operations SET freight_type = 'fob' WHERE id = ?")
        .run(operation.id);
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id);
      // Situacao 1 (valor do frete na nota): 6,5 t x R$ 100,00 = R$ 650,00 vai como
      // valor_frete no bloco frete do pedido, com modalidade "1 - FOB".
      expect(built!.payload.freightTotalCents).toBe(65_000);
      expect(built!.payload.freightModalidade).toBe("1");

      // Situacao 2 (valor so no sistema): o pedido vai sem valor de frete, mas ainda com
      // o transportador e modalidade "1" — o frete e cobrado por fora, em NF de servico.
      database
        .prepare("UPDATE weighing_operations SET freight_type = 'cif' WHERE id = ?")
        .run(operation.id);
      const internalFreight = buildOmieBillingJob(database, operation.id);
      expect(internalFreight!.payload.freightTotalCents).toBe(0);
      expect(internalFreight!.payload.freightModalidade).toBe("1");
    } finally {
      database.close();
    }
  });

  it("maps each freight situation to its OMIE modalidade and carrier rule", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();

      const now = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, source, omie_customer_id, created_at, updated_at)
           VALUES ('carrier-1', 'company-1', 'Transportes Rocha', 'local', 987, ?, ?)`
        )
        .run(now, now);
      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        carrierId: "carrier-1",
        entryWeightKg: 12_000
      });
      database
        .prepare("UPDATE weighing_operations SET freight_type = 'third_party' WHERE id = ?")
        .run(operation.id);
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      // Situacao 3: sem valor de frete, transportador na nota -> "1 - FOB".
      expect(buildOmieBillingJob(database, operation.id)!.payload.freightModalidade).toBe("1");
      expect(buildOmieBillingJob(database, operation.id)!.payload.transport?.carrierName).toBe(
        "Transportes Rocha"
      );

      // Situacao 4: sem ocorrencia de transporte -> "9" e sem transportador na nota.
      database
        .prepare("UPDATE weighing_operations SET freight_type = 'none' WHERE id = ?")
        .run(operation.id);
      const noFreight = buildOmieBillingJob(database, operation.id);
      expect(noFreight!.payload.freightModalidade).toBe("9");
      expect(noFreight!.payload.transport?.carrierName).toBeNull();
      expect(noFreight!.payload.carrier).toBeNull();

      // O transporte proprio legado mantem o codigo modFrete dele (veiculo_proprio "S").
      database
        .prepare("UPDATE weighing_operations SET freight_type = 'own_recipient' WHERE id = ?")
        .run(operation.id);
      expect(buildOmieBillingJob(database, operation.id)!.payload.freightModalidade).toBe("4");
    } finally {
      database.close();
    }
  });

  // Os tres tipos que a tela oferece, calculados sobre o peso liquido PESADO (em kg,
  // convertido para tonelada pela regra) e enviados como valor total em `valor_frete`.
  it.each([
    {
      label: "por tonelada",
      rule: { type: "per_ton" as const, baseValueCents: 9_000 },
      // 6,5 t x R$ 90,00/t
      expectedCents: 58_500
    },
    {
      label: "tonelada-km",
      rule: { type: "per_ton_km" as const, baseValueCents: 300, distanceKm: 40 },
      // 6,5 t x 40 km x R$ 3,00/ton-km
      expectedCents: 78_000
    },
    {
      label: "fixo + tonelada",
      rule: { type: "fixed_plus_ton" as const, baseValueCents: 5_000, fixedValueCents: 20_000 },
      // R$ 200,00 fixos + 6,5 t x R$ 50,00/t
      expectedCents: 52_500
    }
  ])("calcula o frete $label no fechamento e manda o total ao OMIE", (scenario) => {
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
        entryWeightKg: 12_000,
        // Situacao 1: o valor do frete sai na nota e no cupom.
        freightModality: "fob",
        freight: {
          payer: "customer",
          rule: {
            id: "operation-freight",
            name: "Frete da operacao",
            unit: "ton",
            ...scenario.rule
          }
        }
      });

      // 18.500 - 12.000 = 6.500 kg de carga.
      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      expect(closed.netWeightKg).toBe(6_500);
      expect(closed.freightTotalCents).toBe(scenario.expectedCents);
      // O total da operacao ja sai com o frete embutido.
      expect(closed.totalCents).toBe((closed.productTotalCents ?? 0) + scenario.expectedCents);

      const built = buildOmieBillingJob(database, operation.id);
      expect(built!.payload.freightTotalCents).toBe(scenario.expectedCents);
      expect(built!.payload.freightModalidade).toBe("1");
      // Peso da carga no bloco frete do pedido continua em KG (peso_bruto/peso_liquido).
      expect(built!.payload.transport?.cargoWeightKg).toBe(6_500);
    } finally {
      database.close();
    }
  });

  // Operacao que perdeu a regra de frete (o pull antigo apagava `freight_json`): ela diz
  // "com frete, valor na nota", entao o fechamento nao pode cobrar zero em silencio.
  it("resgata a regra de frete pela memoria do cliente quando a operacao ficou sem ela", () => {
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
        entryWeightKg: 12_000,
        freightModality: "fob",
        freight: {
          payer: "customer",
          rule: {
            id: "operation-freight",
            name: "Frete da operacao",
            type: "per_ton",
            baseValueCents: 9_000,
            unit: "ton"
          }
        }
      });
      rememberCustomerFreightValue(database, {
        customerId: "customer-1",
        productId: "product-1",
        modality: "fob",
        rule: {
          id: "operation-freight",
          name: "Frete da operacao",
          type: "per_ton",
          baseValueCents: 9_000,
          unit: "ton"
        }
      });
      // Estado deixado pelo pull que apagava a coluna: tipo de frete intacto, regra vazia.
      database
        .prepare("UPDATE weighing_operations SET freight_json = NULL WHERE id = ?")
        .run(operation.id);

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      expect(closed.freightTotalCents).toBe(58_500);
      // A regra resgatada fica gravada na operacao: cupom, ficha e 2a via veem a mesma.
      expect(JSON.parse(closed.freightJson ?? "{}")).toMatchObject({
        showOnReceipt: true,
        rule: { type: "per_ton", baseValueCents: 9_000 }
      });
      expect(buildOmieBillingJob(database, operation.id)!.payload.freightTotalCents).toBe(58_500);
    } finally {
      database.close();
    }
  });

  // Sem memoria do cliente nao ha o que resgatar: fecha sem frete, nunca inventa valor.
  it("fecha sem frete quando a operacao ficou sem regra e o cliente nao tem memoria", () => {
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
        entryWeightKg: 12_000,
        freightModality: "fob"
      });

      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      expect(closed.freightTotalCents).toBe(0);
      expect(closed.freightJson).toBeNull();
    } finally {
      database.close();
    }
  });

  it("omits the carrier and marks own vehicle when there is no OMIE-linked carrier", () => {
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
      // Transporte proprio (own_sender -> modFrete "3").
      database
        .prepare("UPDATE weighing_operations SET freight_type = 'own_sender' WHERE id = ?")
        .run(operation.id);
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const built = buildOmieBillingJob(database, operation.id);
      expect(built).not.toBeNull();
      expect(built!.payload.transport).toMatchObject({
        carrierOmieId: null,
        ownVehicle: true
      });
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

  it("flags an internal close as cadastro_incompleto instead of dropping the service order", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Cliente SEM omie_customer_id e SEM documento: nao da para criar a OS no OMIE.

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

      expect(
        database.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE target = 'omie'").get()
      ).toMatchObject({ n: 0 });
      // Antes a venda sem nota sumia em silencio: fechava local e nao ia para lugar nenhum.
      expect(closed.omieBillingStatus).toBe("cadastro_incompleto");
      expect(closed.omieBillingMessage).toContain("ordem de servico");
    } finally {
      database.close();
    }
  });

  it("exposes the OMIE service order id of an internal operation", () => {
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "internal"
      });
      database
        .prepare("UPDATE weighing_operations SET omie_service_order_id = 777 WHERE id = ?")
        .run(operation.id);

      // Sem isto a tela de concluidas nao tinha como mostrar a OS criada no OMIE.
      expect(getWeighingOperation(database, operation.id).omieServiceOrderId).toBe(777);
    } finally {
      database.close();
    }
  });

  it("flags an invoice close as cadastro_incompleto when the customer has no OMIE code nor document", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Cliente SEM omie_customer_id e SEM documento (nao da para cadastrar no OMIE).

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
      expect(closed.omieBillingMessage).toContain("Cliente sem CNPJ/CPF");
    } finally {
      database.close();
    }
  });

  it("enqueues the order with customer cadastro when the customer has a document but no OMIE code", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Cliente com CNPJ mas SEM codigo OMIE: o edge deve cria-lo na hora.
      database
        .prepare(
          "UPDATE customers SET document = '11444777000161', legal_name = 'Cliente Novo LTDA' WHERE id = 'customer-1'"
        )
        .run();

      const operation = createWeighingOperation(database, {
        identity,
        operationType: "invoice",
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

      const job = buildOmieBillingJob(database, operation.id);
      expect(job).not.toBeNull();
      // customerOmieId 0 sinaliza "criar na hora"; o cadastro segue no payload.
      expect(job!.payload.customerOmieId).toBe(0);
      expect(job!.payload.localCustomerId).toBe("customer-1");
      expect(job!.payload.customer).toMatchObject({
        localCustomerId: "customer-1",
        razaoSocial: "Cliente Novo LTDA",
        cnpjCpf: "11444777000161"
      });
      // E o job foi enfileirado (nao pulou em silencio).
      expect(
        database.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE target = 'omie'").get()
      ).toMatchObject({ n: 1 });
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

  // A pedreira repete o mesmo arranjo para o mesmo cliente. A entrada seguinte tem de
  // nascer com a transportadora, a condicao e a forma de pagamento da ultima entrada.
  it("devolve transportadora, condicao e forma de pagamento da ultima entrada do cliente", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, is_active, created_at, updated_at)
           VALUES ('term-1', 'company-1', 'A prazo', '{}', 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, sort_order, is_active, created_at, updated_at)
           VALUES ('method-1', 'company-1', 'boleto', 'Boleto', 1, 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, source, created_at, updated_at)
           VALUES ('carrier-1', 'company-1', 'Transportadora Teste', 'local', ?, ?)`
        )
        .run(now, now);

      expect(getCustomerLastEntryPreferences(database, "customer-1")).toBeNull();

      const first = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        carrierId: "carrier-1",
        paymentTermId: "term-1",
        paymentMethodId: "method-1",
        entryWeightKg: 12_000
      });
      expect(first.id).toBeTruthy();

      expect(getCustomerLastEntryPreferences(database, "customer-1")).toEqual({
        carrierId: "carrier-1",
        paymentTermId: "term-1",
        paymentMethodId: "method-1"
      });
      // Outro cliente nao herda nada.
      expect(getCustomerLastEntryPreferences(database, "customer-2")).toBeNull();
    } finally {
      database.close();
    }
  });

  // A condicao que chega pela nuvem traz so o rules_json: as colunas de prazo ficam
  // vazias no desktop que a recebeu. Sem ler o rules_json, o fechamento saia sem prazo
  // nenhum e o OMIE colocava o vencimento na propria data de emissao.
  it("le os prazos do rules_json quando a condicao veio da nuvem sem as colunas", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, is_active, created_at, updated_at)
           VALUES ('term-nuvem', 'company-1', '1 parcela em 45 dias', ?, 1, ?, ?)`
        )
        .run(
          JSON.stringify({
            raw: "PARA 45 DIAS",
            kind: "single",
            summary: "1 parcela em 45 dias",
            installments: [{ number: 1, dueDays: 45 }],
            intervalDays: null,
            installmentCount: 1
          }),
          now,
          now
        );

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentTermId: "term-nuvem",
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
        paymentTermInstallmentCount: number | null;
        paymentTermInstallmentDays: number[] | null;
      };
      expect(payload.paymentTermInstallmentDays).toEqual([45]);
      expect(payload.paymentTermInstallmentCount).toBe(1);
    } finally {
      database.close();
    }
  });

  // Periodo ("s+20" = semana + 20 dias) e so uma forma curta de escrever o prazo: o
  // que segue para o OMIE sao os mesmos dias de vencimento do prazo equivalente.
  it("envia ao OMIE os dias das parcelas de uma condicao digitada em periodos", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();

      const term = createPaymentTerm(database, {
        companyId: identity.companyId,
        name: "Semana + 20 dias",
        condition: "s + 20"
      });
      expect(term.installment_days_json).toBe("[27]");

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentTermId: term.id,
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
        paymentTermInstallmentCount: number | null;
        paymentTermInstallmentDays: number[] | null;
      };
      expect(payload.paymentTermInstallmentDays).toEqual([27]);
      expect(payload.paymentTermInstallmentCount).toBe(1);
    } finally {
      database.close();
    }
  });

  it("envia ao OMIE as parcelas de uma lista com periodos", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();

      const term = createPaymentTerm(database, {
        companyId: identity.companyId,
        name: "Periodos",
        condition: "s+20/d+20/q+20/m+20"
      });

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentTermId: term.id,
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
        paymentTermInstallmentCount: number | null;
        paymentTermInstallmentDays: number[] | null;
      };
      expect(payload.paymentTermInstallmentDays).toEqual([27, 30, 35, 50]);
      expect(payload.paymentTermInstallmentCount).toBe(4);
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
        accountName: string | null;
      };
      expect(payload.paymentMethodOmieCode).toBe("04");
      expect(payload.accountOmieCode).toBe("4321");
      // O nome da conta vinculada vai junto para o edge resolver o nCodCC pelo nome
      // quando o omie_code local ainda estiver nulo.
      expect(payload.accountName).toBe("GetNet");
    } finally {
      database.close();
    }
  });

  it("still sends the linked account name when its OMIE code was not synced yet", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database.prepare("UPDATE customers SET omie_customer_id = 456 WHERE id = 'customer-1'").run();
      const now = "2026-06-06T12:00:00.000Z";
      // Conta OMIE Cash ainda SEM omie_code (sync de contas correntes nao rodou/nao casou o nome).
      database
        .prepare(
          `INSERT INTO accounts (id, company_id, code, name, omie_code, is_system, sort_order, is_active, created_at, updated_at)
           VALUES ('account-omiecash', 'company-1', 'omie_cash', 'OMIE Cash', NULL, 1, 2, 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO payment_methods (id, company_id, code, name, omie_code, account_id, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
           VALUES ('method-boleto', 'company-1', 'boleto', 'Boleto', '15', 'account-omiecash', 1, 0, 5, 1, ?, ?)`
        )
        .run(now, now);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        paymentMethodId: "method-boleto",
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
        accountOmieCode: string | null;
        accountName: string | null;
      };
      // Sem nCodCC local, mas com o nome da conta: o edge resolve o nCodCC pelo nome e o
      // boleto cai na OMIE Cash em vez da primeira conta corrente do tenant (a caixinha).
      expect(payload.accountOmieCode).toBeNull();
      expect(payload.accountName).toBe("OMIE Cash");
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
        .get() as {
        default_payment_term_id: string | null;
        default_payment_method_id: string | null;
      };
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
        .get() as {
        default_payment_term_id: string | null;
        default_payment_method_id: string | null;
      };
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

  it("keeps closed operations in the completed list through every sync status", () => {
    const database = createDatabase();

    try {
      const operation = createSimulatedWeighingOperation(database, {
        identity: createIdentity(database),
        customerName: "Cliente Sync",
        plate: "ABC1D23",
        driverName: "Motorista Sync",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });
      expect(listClosedWeighingOperations(database).map((op) => op.id)).toEqual([operation.id]);

      // A sincronizacao com a nuvem/OMIE promove o status de closed_local ate synced,
      // passando por pending_cloud/pending_omie (ou parando em sync_error). Em nenhum
      // desses estados a operacao pode sumir da lista de Concluidas.
      for (const status of ["pending_cloud", "pending_omie", "sync_error", "synced"] as const) {
        database
          .prepare("UPDATE weighing_operations SET status = ? WHERE id = ?")
          .run(status, operation.id);
        expect(listClosedWeighingOperations(database).map((op) => op.id)).toEqual([operation.id]);
      }

      // Uma operacao ja sincronizada continua podendo ser excluida da lista local.
      deleteClosedWeighingOperation(database, operation.id);
      expect(listClosedWeighingOperations(database)).toHaveLength(0);
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

  it("changes the customer of an open operation and reprices", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO customers (
            id, company_id, source, legal_name, trade_name, email, address_number, omie_billing_blocked, created_at, updated_at
          ) VALUES ('customer-2', 'company-1', 'omie', 'Outro Cliente LTDA', 'Outro Cliente', 'outro@example.com', '456', 0, ?, ?)`
        )
        .run(now, now);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      const updated = updateWeighingOperationCustomer(database, {
        operationId: operation.id,
        newCustomerId: "customer-2"
      });

      expect(updated).toMatchObject({
        customerId: "customer-2",
        customerName: "Outro Cliente",
        unitPriceCents: 12_000
      });
      expect(
        database
          .prepare("SELECT customer_name FROM loading_requests WHERE operation_id = ?")
          .pluck()
          .get(operation.id)
      ).toBe("Outro Cliente");
      expect(
        database
          .prepare(
            "SELECT COUNT(*) FROM audit_logs WHERE entity_id = ? AND action = 'customer_changed'"
          )
          .pluck()
          .get(operation.id)
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("rejects changing the customer of a closed operation", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare(
          `INSERT INTO customers (
            id, company_id, source, legal_name, trade_name, email, address_number, omie_billing_blocked, created_at, updated_at
          ) VALUES ('customer-2', 'company-1', 'omie', 'Outro Cliente LTDA', 'Outro Cliente', 'outro@example.com', '456', 0, datetime('now'), datetime('now'))`
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "internal"
      });

      expect(() =>
        updateWeighingOperationCustomer(database, {
          operationId: operation.id,
          newCustomerId: "customer-2"
        })
      ).toThrow("Somente operacoes abertas");
    } finally {
      database.close();
    }
  });

  it("sets and clears the carrier of an open operation", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, omie_customer_id, name, source, created_at, updated_at)
           VALUES ('carrier-1', 'company-1', 987654, 'Transportadora Teste', 'omie', datetime('now'), datetime('now'))`
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

      updateWeighingOperationCarrier(database, {
        operationId: operation.id,
        newCarrierId: "carrier-1"
      });
      expect(
        database
          .prepare("SELECT carrier_id FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBe("carrier-1");

      updateWeighingOperationCarrier(database, {
        operationId: operation.id,
        newCarrierId: null
      });
      expect(
        database
          .prepare("SELECT carrier_id FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("exposes the linked ids so the full edit can pre-fill the form", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      insertEditCatalog(database);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        carrierId: "carrier-1",
        paymentMethodId: "method-boleto",
        paymentTermId: "term-7-14-21",
        entryWeightKg: 12_000
      });

      expect(operation).toMatchObject({
        productId: "product-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        carrierId: "carrier-1",
        carrierName: "Transportadora Teste",
        paymentTermId: "term-7-14-21",
        paymentMethodId: "method-boleto",
        paymentMethodName: "Boleto"
      });
      expect(listOpenWeighingOperations(database)[0].paymentMethodName).toBe("Boleto");
    } finally {
      database.close();
    }
  });

  it("edits every commercial field of an operation in progress", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      insertEditCatalog(database);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });
      expect(operation.unitPriceCents).toBe(12_000);

      const updated = updateWeighingOperationDetails(database, {
        operationId: operation.id,
        productId: "product-2",
        vehicleId: "vehicle-2",
        driverId: "driver-2",
        carrierId: "carrier-1",
        paymentMethodId: "method-boleto",
        paymentTermId: "term-7-14-21",
        operationType: "internal",
        unitPriceCents: 18_500,
        freightModality: "cif",
        deductFreightFromCredit: true,
        freight: {
          payer: "quarry",
          destination: "Obra do centro",
          rule: {
            id: "operation-freight",
            name: "Frete da operacao",
            type: "per_ton",
            baseValueCents: 4_500,
            unit: "ton"
          }
        }
      });

      expect(updated).toMatchObject({
        productId: "product-2",
        productDescription: "Brita 2",
        vehicleId: "vehicle-2",
        plate: "XYZ4E56",
        driverId: "driver-2",
        driverName: "Segundo Motorista",
        carrierId: "carrier-1",
        paymentTermId: "term-7-14-21",
        paymentMethodId: "method-boleto",
        operationType: "internal",
        // Preco digitado vence a tabela; o desconto e recalculado contra o preco base.
        unitPriceCents: 18_500,
        freightModality: "cif",
        deductFreightFromCredit: true
      });
      expect(JSON.parse(updated.freightJson ?? "{}")).toMatchObject({
        payer: "quarry",
        destination: "Obra do centro"
      });

      // A solicitacao de carga do carregador acompanha a edicao.
      expect(
        database
          .prepare(
            "SELECT plate, product_description, driver_name FROM loading_requests WHERE operation_id = ?"
          )
          .get(operation.id)
      ).toMatchObject({
        plate: "XYZ4E56",
        product_description: "Brita 2",
        driver_name: "Segundo Motorista"
      });

      // O frete so vira valor no fechamento (depende do peso liquido): 6,5 t x R$ 45,00.
      const closed = closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500
      });
      expect(closed.freightTotalCents).toBe(29_250);
      expect(closed.productTotalCents).toBe(120_250);
    } finally {
      database.close();
    }
  });

  it("keeps untouched fields and re-prices when only the product changes", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      insertEditCatalog(database);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        carrierId: "carrier-1",
        entryWeightKg: 12_000
      });

      const updated = updateWeighingOperationDetails(database, {
        operationId: operation.id,
        productId: "product-2"
      });

      // Sem preco digitado, trocar o produto re-precifica pela tabela (R$ 200,00/ton).
      expect(updated.unitPriceCents).toBe(20_000);
      expect(updated.carrierId).toBe("carrier-1");
      expect(updated.vehicleId).toBe("vehicle-1");
      expect(updated.operationType).toBe("invoice");
    } finally {
      database.close();
    }
  });

  it("replaces the manual installments when a payment term is chosen in the edit", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      insertEditCatalog(database);

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        manualInstallments: 4,
        entryWeightKg: 12_000
      });
      expect(operation.paymentTermName).toBe("4 parcelas");

      const updated = updateWeighingOperationDetails(database, {
        operationId: operation.id,
        paymentTermId: "term-7-14-21"
      });

      // O parcelamento manual vence a condicao na exibicao: sem limpa-lo, a condicao
      // escolhida na edicao nao apareceria no cupom nem na lista.
      expect(updated.paymentTermName).toBe("3 parcelas");
      expect(
        database
          .prepare("SELECT manual_installments FROM weighing_operations WHERE id = ?")
          .pluck()
          .get(operation.id)
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("clears the freight of an operation in progress", () => {
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
        entryWeightKg: 12_000,
        freightModality: "cif",
        freight: {
          payer: "quarry",
          rule: {
            id: "operation-freight",
            name: "Frete da operacao",
            type: "per_ton",
            baseValueCents: 4_500,
            unit: "ton"
          }
        }
      });
      expect(operation.freightJson).not.toBeNull();

      const updated = updateWeighingOperationDetails(database, {
        operationId: operation.id,
        freight: null,
        freightModality: "none"
      });

      expect(updated.freightJson).toBeNull();
      expect(updated.freightModality).toBe("none");
      expect(
        closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 })
          .freightTotalCents
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("refuses to edit an operation that is no longer in progress", () => {
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
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });

      expect(() =>
        updateWeighingOperationDetails(database, {
          operationId: operation.id,
          unitPriceCents: 9_900
        })
      ).toThrow("Somente operacoes em andamento");
    } finally {
      database.close();
    }
  });

  it("refuses a plate that already has another operation in progress", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      insertEditCatalog(database);

      const first = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });
      createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-2",
        driverId: "driver-2",
        productId: "product-1",
        entryWeightKg: 11_000
      });

      expect(() =>
        updateWeighingOperationDetails(database, {
          operationId: first.id,
          vehicleId: "vehicle-2"
        })
      ).toThrow("Ja existe uma operacao aberta para a placa XYZ4E56");
    } finally {
      database.close();
    }
  });

  // A tela de Concluidas precisa dizer POR QUE a operacao nao foi ao OMIE e quais campos
  // do cadastro corrigir — antes so aparecia "Cadastro incompleto" sem apontar o campo.
  it("getOperationOmieIssue aponta o CNPJ/CPF que falta quando o cliente nao existe no OMIE", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      // Sem codigo OMIE e sem documento: o fechamento nem chega a enfileirar o pedido.
      database
        .prepare(
          "UPDATE customers SET omie_customer_id = NULL, document = NULL WHERE id = 'customer-1'"
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      const issue = getOperationOmieIssue(database, operation.id);

      expect(issue).toMatchObject({
        operationId: operation.id,
        operationType: "invoice",
        pending: true,
        blocked: true,
        reasonLabel: "Cadastro incompleto",
        customerId: "customer-1",
        customerSource: "omie",
        plate: "ABC1D23"
      });
      expect(issue.fields.filter((field) => field.missing).map((field) => field.key)).toEqual([
        "document"
      ]);
      // Numero e e-mail ja estao preenchidos pelo insertCatalog, mas seguem editaveis.
      expect(issue.fields.find((field) => field.key === "addressNumber")).toMatchObject({
        required: true,
        missing: false,
        value: "123"
      });
      expect(issue.reason).toContain("CNPJ/CPF");
    } finally {
      database.close();
    }
  });

  it("getOperationOmieIssue devolve o erro do ultimo job quando o OMIE recusou o pedido", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare(
          "UPDATE customers SET omie_customer_id = 456, document = '26463463000183' WHERE id = 'customer-1'"
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });
      database
        .prepare(
          "UPDATE sync_queue SET status = 'failed', last_error = ? WHERE target = 'omie' AND entity_id = ?"
        )
        .run("OMIE recusou: categoria nao encontrada.", operation.id);

      const issue = getOperationOmieIssue(database, operation.id);

      expect(issue).toMatchObject({
        pending: true,
        blocked: true,
        reasonLabel: "Recusada pelo OMIE",
        reason: "OMIE recusou: categoria nao encontrada.",
        queueStatus: "failed"
      });
      expect(issue.fields.some((field) => field.missing)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("getOperationOmieIssue para de acusar pendencia depois que o pedido e criado", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare(
          "UPDATE customers SET omie_customer_id = 456, document = '26463463000183' WHERE id = 'customer-1'"
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
      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });
      database
        .prepare("UPDATE weighing_operations SET omie_sales_order_id = 4321 WHERE id = ?")
        .run(operation.id);

      expect(getOperationOmieIssue(database, operation.id)).toMatchObject({
        pending: false,
        blocked: false,
        reasonLabel: "Enviada ao OMIE",
        reason: "Pedido OMIE 4321 ja criado."
      });
    } finally {
      database.close();
    }
  });

  it("expoe o CNPJ/CPF do cliente nas listas de operacoes, para a busca das concluidas", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      database
        .prepare("UPDATE customers SET document = '26463463000183' WHERE id = 'customer-1'")
        .run();

      const operation = createWeighingOperation(database, {
        identity,
        customerId: "customer-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        productId: "product-1",
        entryWeightKg: 12_000
      });

      expect(listOpenWeighingOperations(database)[0].customerDocument).toBe("26463463000183");

      closeWeighingOperation(database, {
        operationId: operation.id,
        exitWeightKg: 18_500,
        operationType: "invoice"
      });

      expect(listClosedWeighingOperations(database)[0].customerDocument).toBe("26463463000183");
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

describe("limpeza em lote das concluidas", () => {
  it("limpa as concluidas ate a data informada e preserva o dia corrente", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);

      const antiga = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      const hoje = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, { operationId: antiga.id, exitWeightKg: 18_500 });
      closeWeighingOperation(database, { operationId: hoje.id, exitWeightKg: 18_500 });
      database
        .prepare(
          "UPDATE weighing_operations SET created_at = '2026-07-20T10:00:00.000Z' WHERE id = ?"
        )
        .run(antiga.id);

      const removidas = clearClosedWeighingOperations(database, { untilDate: "2026-07-31" });

      expect(removidas).toBe(1);
      const restantes = listClosedWeighingOperations(database).map((operation) => operation.id);
      expect(restantes).toEqual([hoje.id]);
    } finally {
      database.close();
    }
  });

  it("limpa todas as concluidas quando nao ha data limite", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      closeWeighingOperation(database, { operationId: operation.id, exitWeightKg: 18_500 });

      expect(clearClosedWeighingOperations(database)).toBe(1);
      expect(listClosedWeighingOperations(database)).toHaveLength(0);
      // Segunda passada nao encontra mais nada (a exclusao e logica e idempotente).
      expect(clearClosedWeighingOperations(database)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("nao toca nas operacoes abertas", () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      insertCatalog(database);
      const aberta = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });

      expect(clearClosedWeighingOperations(database)).toBe(0);
      const row = database
        .prepare("SELECT deleted_at FROM weighing_operations WHERE id = ?")
        .get(aberta.id) as { deleted_at: string | null };
      expect(row.deleted_at).toBeNull();
    } finally {
      database.close();
    }
  });
});

/**
 * Segundo conjunto de cadastros (produto, placa, motorista, transportadora, forma e
 * condicao de pagamento) para exercitar a edicao completa da operacao: todo campo
 * editavel precisa de uma alternativa valida para onde apontar.
 */
function insertEditCatalog(database: DesktopDatabase): void {
  const now = "2026-06-06T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO products (
        id, company_id, omie_product_id, code, description, unit, unit_price_cents, item_type, created_at, updated_at
      ) VALUES ('product-2', 'company-1', 456, 'BRITA2', 'Brita 2', 'ton', 22000, '04 - Produtos Acabados', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO product_default_prices (
        id, company_id, product_id, unit_price_cents, unit, created_at, updated_at
      ) VALUES ('default-price-2', 'company-1', 'product-2', 20000, 'ton', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      "INSERT INTO vehicles (id, company_id, plate, created_at, updated_at) VALUES ('vehicle-2', 'company-1', 'XYZ4E56', ?, ?)"
    )
    .run(now, now);
  database
    .prepare(
      "INSERT INTO drivers (id, company_id, name, created_at, updated_at) VALUES ('driver-2', 'company-1', 'Segundo Motorista', ?, ?)"
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO carriers (id, company_id, omie_customer_id, name, source, created_at, updated_at)
       VALUES ('carrier-1', 'company-1', 987654, 'Transportadora Teste', 'omie', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO payment_methods (id, company_id, code, name, omie_code, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
       VALUES ('method-boleto', 'company-1', 'boleto', 'Boleto', '15', 1, 0, 5, 1, ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO payment_terms (
         id, company_id, name, rules_json, first_installment_days, installment_interval_days,
         installment_count, installment_days_json, created_at, updated_at
       ) VALUES ('term-7-14-21', 'company-1', '3 parcelas', '{"raw":"7/14/21"}', 7, 7, 3, '[7,14,21]', ?, ?)`
    )
    .run(now, now);
}

/**
 * Saldo vindo do financeiro do OMIE (adiantamento espelhado). E a unica forma de
 * o cliente ter credito: o KyberRock nao lanca credito.
 */
function seedOmieAdvance(
  database: DesktopDatabase,
  companyId: string,
  amountCents: number,
  id = "omie-adv-seed"
): void {
  database
    .prepare(
      `INSERT INTO customer_credit_movements (
        id, company_id, customer_id, operation_id, movement_type, amount_cents,
        balance_after_cents, reason, source, omie_title_id, created_at
      ) VALUES (?, ?, 'customer-1', NULL, 'credit', ?, ?, 'Adiantamento OMIE', 'omie', 7001, ?)`
    )
    .run(id, companyId, amountCents, amountCents, "2026-07-20T10:00:00.000Z");
  recalculateCreditBalance(database);
}

/** Movimento local herdado (de quando o desktop ainda lancava credito). */
function seedLocalCredit(
  database: DesktopDatabase,
  companyId: string,
  amountCents: number,
  id = "local-credit-seed"
): void {
  database
    .prepare(
      `INSERT INTO customer_credit_movements (
        id, company_id, customer_id, operation_id, movement_type, amount_cents,
        balance_after_cents, reason, source, omie_title_id, created_at
      ) VALUES (?, ?, 'customer-1', NULL, 'manual_adjustment', ?, ?, 'lancamento antigo', 'local', NULL, ?)`
    )
    .run(id, companyId, amountCents, amountCents, "2026-07-21T10:00:00.000Z");
  recalculateCreditBalance(database);
}

function recalculateCreditBalance(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
       VALUES ('customer-1', (
         SELECT COALESCE(SUM(
           CASE WHEN movement_type IN ('debit_product', 'debit_freight')
             THEN -amount_cents ELSE amount_cents END
         ), 0) FROM customer_credit_movements WHERE customer_id = 'customer-1'
       ), '2026-07-21T10:00:00.000Z')
       ON CONFLICT(customer_id) DO UPDATE SET
         balance_cents = excluded.balance_cents,
         updated_at = excluded.updated_at`
    )
    .run();
}
