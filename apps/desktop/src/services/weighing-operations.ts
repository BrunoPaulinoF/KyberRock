import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { PricingService, type PriceDetails } from "./pricing.js";
import { enqueueSyncJob } from "./sync-queue.js";

type OperationStatus =
  | "draft"
  | "entry_registered"
  | "loading_requested"
  | "awaiting_exit"
  | "closed_local"
  | "pending_cloud"
  | "pending_omie"
  | "synced"
  | "sync_error"
  | "cancelled";

export type OperationType = "invoice" | "internal";

export interface CreateSimulatedWeighingOperationInput {
  identity: LocalDesktopIdentity;
  operationType?: OperationType;
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  paymentTermName?: string;
  unitPriceCents?: number;
  entryWeightKg: number;
}

export interface CreateWeighingOperationInput {
  identity: LocalDesktopIdentity;
  operationType?: OperationType;
  customerId: string;
  vehicleId: string;
  carrierId?: string;
  driverId: string;
  productId: string;
  paymentTermId?: string;
  unitPriceCents?: number;
  entryWeightKg: number;
}

export interface CloseWeighingOperationInput {
  operationId: string;
  exitWeightKg: number;
  operationType?: OperationType;
}

export interface CancelWeighingOperationInput {
  operationId: string;
  reason: string;
}

export interface WeighingOperationSummary {
  id: string;
  status: OperationStatus;
  operationType: OperationType;
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  paymentTermName: string | null;
  entryWeightKg: number | null;
  exitWeightKg: number | null;
  netWeightKg: number | null;
  unitPriceCents: number | null;
  baseUnitPriceCents: number | null;
  appliedPriceTableId: string | null;
  appliedPriceTableName: string | null;
  appliedPriceTableItemId: string | null;
  priceUnit: "ton";
  priceSavingsPercent: number | null;
  productTotalCents: number | null;
  freightTotalCents: number;
  totalCents: number | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OperationRow {
  id: string;
  status: OperationStatus;
  operation_type: OperationType;
  entry_weight_kg: number | null;
  exit_weight_kg: number | null;
  net_weight_kg: number | null;
  unit_price_cents: number | null;
  base_unit_price_cents: number | null;
  applied_price_table_id: string | null;
  applied_price_table_name: string | null;
  applied_price_table_item_id: string | null;
  price_unit: "ton";
  price_savings_percent: number | null;
  product_total_cents: number | null;
  freight_total_cents: number;
  total_cents: number | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  plate: string | null;
  driver_name: string | null;
  product_description: string | null;
  payment_term_name: string | null;
}

export function createSimulatedWeighingOperation(
  database: DesktopDatabase,
  input: CreateSimulatedWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  validateRequired("customerName", input.customerName);
  validateRequired("plate", input.plate);
  validateRequired("driverName", input.driverName);
  validateRequired("productDescription", input.productDescription);
  validateOperationType(input.operationType ?? "invoice");
  validateUnitPrice(input.unitPriceCents);

  if (input.entryWeightKg <= 0) {
    throw new Error("Entry weight must be greater than zero.");
  }

  const operationType = input.operationType ?? "invoice";
  const timestamp = now.toISOString();
  const ids = {
    operationId: randomUUID(),
    customerId: randomUUID(),
    vehicleId: randomUUID(),
    driverId: randomUUID(),
    productId: randomUUID(),
    paymentTermId: input.paymentTermName?.trim() ? randomUUID() : null,
    priceTableId: input.unitPriceCents === undefined ? null : randomUUID(),
    priceTableItemId: input.unitPriceCents === undefined ? null : randomUUID(),
    customerPriceTableId: input.unitPriceCents === undefined ? null : randomUUID(),
    loadingRequestId: randomUUID()
  };

  const createOperation = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO customers (id, company_id, source, legal_name, trade_name, sync_status, created_at, updated_at)
         VALUES (?, ?, 'local', ?, ?, 'pending', ?, ?)`
      )
      .run(
        ids.customerId,
        input.identity.companyId,
        input.customerName.trim(),
        input.customerName.trim(),
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'kg', ?, ?)`
      )
      .run(
        ids.productId,
        input.identity.companyId,
        input.productDescription.trim(),
        input.productDescription.trim(),
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        ids.vehicleId,
        input.identity.companyId,
        normalizePlate(input.plate),
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO drivers (id, company_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(ids.driverId, input.identity.companyId, input.driverName.trim(), timestamp, timestamp);

    if (ids.paymentTermId && input.paymentTermName) {
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, created_at, updated_at)
           VALUES (?, ?, ?, '{}', ?, ?)`
        )
        .run(
          ids.paymentTermId,
          input.identity.companyId,
          input.paymentTermName.trim(),
          timestamp,
          timestamp
        );
    }

    if (
      ids.priceTableId &&
      ids.priceTableItemId &&
      ids.customerPriceTableId &&
      input.unitPriceCents !== undefined
    ) {
      database
        .prepare(
          `INSERT INTO price_tables (id, company_id, name, is_active, created_at, updated_at)
           VALUES (?, ?, 'Tabela simulada', 1, ?, ?)`
        )
        .run(ids.priceTableId, input.identity.companyId, timestamp, timestamp);
      database
        .prepare(
          `INSERT INTO price_table_items (id, price_table_id, product_id, unit_price_cents, unit, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ton', ?, ?)`
        )
        .run(
          ids.priceTableItemId,
          ids.priceTableId,
          ids.productId,
          input.unitPriceCents,
          timestamp,
          timestamp
        );
      database
        .prepare(
          `INSERT INTO customer_price_tables (id, customer_id, price_table_id, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`
        )
        .run(ids.customerPriceTableId, ids.customerId, ids.priceTableId, timestamp, timestamp);
    }

    database
      .prepare(
        `INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, customer_id, vehicle_id, driver_id, product_id,
          payment_term_id, entry_weight_kg, entry_weight_captured_at, unit_price_cents,
          base_unit_price_cents, applied_price_table_id, applied_price_table_name, applied_price_table_item_id,
          price_unit, price_savings_percent, freight_total_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'loading_requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ton', ?, 0, ?, ?)`
      )
      .run(
        ids.operationId,
        input.identity.companyId,
        input.identity.unitId,
        input.identity.deviceId,
        operationType,
        ids.customerId,
        ids.vehicleId,
        ids.driverId,
        ids.productId,
        ids.paymentTermId,
        input.entryWeightKg,
        timestamp,
        input.unitPriceCents ?? null,
        input.unitPriceCents ?? null,
        ids.priceTableId,
        ids.priceTableId ? "Tabela simulada" : null,
        ids.priceTableItemId,
        null,
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO loading_requests (
          id, operation_id, company_id, unit_id, status, plate, customer_name, driver_name, product_description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ids.loadingRequestId,
        ids.operationId,
        input.identity.companyId,
        input.identity.unitId,
        normalizePlate(input.plate),
        input.customerName.trim(),
        input.driverName.trim(),
        input.productDescription.trim(),
        timestamp,
        timestamp
      );

    insertAuditLog(
      database,
      input.identity,
      ids.operationId,
      "entry_weight_captured",
      null,
      {
        entryWeightKg: input.entryWeightKg,
        operationType,
        unitPriceCents: input.unitPriceCents ?? null
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: ids.operationId,
        idempotencyKey: `cloud:operation:${ids.operationId}:entry`,
        payload: { operationId: ids.operationId }
      },
      now
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_loading_request",
        entityType: "loading_request",
        entityId: ids.loadingRequestId,
        idempotencyKey: `cloud:loading_request:${ids.loadingRequestId}:open`,
        payload: { operationId: ids.operationId }
      },
      now
    );
  });

  createOperation();

  return getWeighingOperation(database, ids.operationId);
}

export function createWeighingOperation(
  database: DesktopDatabase,
  input: CreateWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  if (input.entryWeightKg <= 0) {
    throw new Error("Peso de entrada deve ser maior que zero.");
  }

  const operationType = input.operationType ?? "invoice";
  validateOperationType(operationType);
  validateUnitPrice(input.unitPriceCents);
  const timestamp = now.toISOString();

  const customer = database
    .prepare("SELECT trade_name, is_active, omie_billing_blocked FROM customers WHERE id = ? AND deleted_at IS NULL")
    .get(input.customerId) as
    | { trade_name: string; is_active: number; omie_billing_blocked: number }
    | undefined;
  const vehicle = database
    .prepare("SELECT plate FROM vehicles WHERE id = ? AND deleted_at IS NULL")
    .get(input.vehicleId) as { plate: string } | undefined;
  const driver = database
    .prepare("SELECT name FROM drivers WHERE id = ? AND deleted_at IS NULL")
    .get(input.driverId) as { name: string } | undefined;
  const product = database
    .prepare(
      `SELECT description, omie_product_id, item_type, fiscal_recommendations_json, is_active, blocked
       FROM products
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get(input.productId) as
    | {
        description: string;
        omie_product_id: number | null;
        item_type: string | null;
        fiscal_recommendations_json: string | null;
        is_active: number;
        blocked: number;
      }
    | undefined;

  if (!customer) throw new Error("Cliente selecionado nao foi encontrado.");
  if (customer.is_active !== 1) throw new Error("Cliente inativo nao pode iniciar pesagem.");
  if (customer.omie_billing_blocked === 1) throw new Error("Cliente bloqueado no OMIE nao pode iniciar pesagem.");
  if (!vehicle) throw new Error("Placa selecionada nao foi encontrada.");
  if (!driver) throw new Error("Motorista selecionado nao foi encontrado.");
  if (!product) throw new Error("Produto selecionado nao foi encontrado.");
  if (product.is_active !== 1 || product.blocked === 1) {
    throw new Error("Produto inativo ou bloqueado nao pode iniciar pesagem.");
  }
  if (!isFinishedGoodsProduct(product)) {
    throw new Error("Somente produtos OMIE tipo 04 - produtos acabados podem iniciar pesagem.");
  }

  const duplicateOpenOperation = database
    .prepare(
      `SELECT id
       FROM weighing_operations
       WHERE unit_id = ?
         AND vehicle_id = ?
         AND status IN ('draft', 'entry_registered', 'loading_requested', 'awaiting_exit')
       LIMIT 1`
    )
    .get(input.identity.unitId, input.vehicleId) as { id: string } | undefined;

  if (duplicateOpenOperation) {
    throw new Error(`Ja existe uma operacao aberta para a placa ${vehicle.plate}.`);
  }

  const priceDetails = new PricingService(database).getPriceDetailsForCustomerProduct(input.customerId, input.productId);
  const unitPriceCents = input.unitPriceCents ?? priceDetails?.appliedUnitPriceCents ?? null;

  const operationId = randomUUID();
  const loadingRequestId = randomUUID();

  const createOperation = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO weighing_operations (
          id, company_id, unit_id, device_id, status, operation_type, customer_id, vehicle_id, carrier_id, driver_id, product_id,
          payment_term_id, entry_weight_kg, entry_weight_captured_at, unit_price_cents,
          base_unit_price_cents, applied_price_table_id, applied_price_table_name, applied_price_table_item_id,
          price_unit, price_savings_percent, freight_total_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'loading_requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        operationId,
        input.identity.companyId,
        input.identity.unitId,
        input.identity.deviceId,
        operationType,
        input.customerId,
        input.vehicleId,
        input.carrierId ?? null,
        input.driverId,
        input.productId,
        input.paymentTermId ?? null,
        input.entryWeightKg,
        timestamp,
        unitPriceCents,
        priceDetails?.baseUnitPriceCents ?? null,
        priceDetails?.priceTableId ?? null,
        priceDetails?.priceTableName ?? null,
        priceDetails?.priceTableItemId ?? null,
        priceDetails?.priceUnit ?? "ton",
        priceDetails?.savingsPercent ?? null,
        timestamp,
        timestamp
      );

    database
      .prepare(
        `INSERT INTO loading_requests (
          id, operation_id, company_id, unit_id, status, plate, customer_name, driver_name, product_description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        loadingRequestId,
        operationId,
        input.identity.companyId,
        input.identity.unitId,
        vehicle?.plate ?? "",
        customer?.trade_name ?? "",
        driver?.name ?? "",
        product?.description ?? "",
        timestamp,
        timestamp
      );

    insertAuditLog(
      database,
      input.identity,
      operationId,
      "entry_weight_captured",
      null,
      {
        entryWeightKg: input.entryWeightKg,
        operationType,
        unitPriceCents,
        priceDetails: serializePriceDetails(priceDetails)
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: operationId,
        idempotencyKey: `cloud:operation:${operationId}:entry`,
        payload: { operationId }
      },
      now
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_loading_request",
        entityType: "loading_request",
        entityId: loadingRequestId,
        idempotencyKey: `cloud:loading_request:${loadingRequestId}:open`,
        payload: { operationId }
      },
      now
    );
  });

  createOperation();

  return getWeighingOperation(database, operationId);
}

export function closeWeighingOperation(
  database: DesktopDatabase,
  input: CloseWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  const operation = getWeighingOperation(database, input.operationId);

  if (!operation.entryWeightKg) {
    throw new Error("Operation has no entry weight.");
  }

  const netWeightKg = calculateNetWeightKg(operation.entryWeightKg, input.exitWeightKg);
  const productTotalCents = calculateProductTotalCents(netWeightKg, operation.unitPriceCents);
  const totalCents =
    productTotalCents === null ? null : productTotalCents + operation.freightTotalCents;
  const timestamp = now.toISOString();
  const nextOperationType: OperationType = input.operationType ?? operation.operationType;

  const closeOperation = database.transaction(() => {
    if (input.operationType) {
      database
        .prepare(
          `UPDATE weighing_operations
           SET status = 'closed_local', operation_type = ?, exit_weight_kg = ?, exit_weight_captured_at = ?, net_weight_kg = ?, product_total_cents = ?, total_cents = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextOperationType,
          input.exitWeightKg,
          timestamp,
          netWeightKg,
          productTotalCents,
          totalCents,
          timestamp,
          input.operationId
        );
    } else {
      database
        .prepare(
          `UPDATE weighing_operations
           SET status = 'closed_local', exit_weight_kg = ?, exit_weight_captured_at = ?, net_weight_kg = ?, product_total_cents = ?, total_cents = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.exitWeightKg,
          timestamp,
          netWeightKg,
          productTotalCents,
          totalCents,
          timestamp,
          input.operationId
        );
    }

    database
      .prepare(
        "UPDATE loading_requests SET status = 'closed', closed_at = ?, updated_at = ? WHERE operation_id = ?"
      )
      .run(timestamp, timestamp, input.operationId);

    insertAuditLog(
      database,
      null,
      input.operationId,
      "exit_weight_captured",
      operation,
      {
        exitWeightKg: input.exitWeightKg,
        netWeightKg,
        productTotalCents,
        totalCents,
        operationType: input.operationType ?? operation.operationType
      },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:closed`,
        payload: { operationId: input.operationId }
      },
      now
    );

    const closedLoadingRequest = database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .get(input.operationId) as { id: string } | undefined;

    if (closedLoadingRequest) {
      enqueueSyncJob(
        database,
        {
          target: "cloud",
          action: "upsert_loading_request",
          entityType: "loading_request",
          entityId: closedLoadingRequest.id,
          idempotencyKey: `cloud:loading_request:${closedLoadingRequest.id}:closed`,
          payload: { operationId: input.operationId }
        },
        now
      );
    }

    const operationIds = database
      .prepare("SELECT customer_id, product_id, unit_id FROM weighing_operations WHERE id = ?")
      .get(input.operationId) as { customer_id: string | null; product_id: string | null; unit_id: string } | undefined;

    const omieCustomerId = operationIds?.customer_id
      ? (database.prepare("SELECT omie_customer_id FROM customers WHERE id = ?").get(operationIds.customer_id) as { omie_customer_id: number | null } | undefined)?.omie_customer_id
      : null;
    const omieProductId = operationIds?.product_id
      ? (database.prepare("SELECT omie_product_id FROM products WHERE id = ?").get(operationIds.product_id) as { omie_product_id: number | null } | undefined)?.omie_product_id
      : null;

    if (omieCustomerId) {
      enqueueSyncJob(
        database,
        {
          target: "omie",
          action: "create_order",
          entityType: "weighing_operation",
          entityId: input.operationId,
          idempotencyKey: `kyberrock:${operationIds?.unit_id ?? "unknown"}:${input.operationId}:${nextOperationType === "invoice" ? "create_sales_order" : "create_service_order"}`,
          payload: {
            operationId: input.operationId,
            operationType: nextOperationType,
            customerOmieId: omieCustomerId,
            productOmieId: omieProductId ?? null,
            serviceDescription: operation.productDescription,
            quantity: netWeightKg / 1000,
            unitPrice: operation.unitPriceCents ? operation.unitPriceCents / 100 : 0,
            issueDate: timestamp.slice(0, 10)
          }
        },
        now
      );
    }
  });

  closeOperation();

  return getWeighingOperation(database, input.operationId);
}

export function cancelWeighingOperation(
  database: DesktopDatabase,
  input: CancelWeighingOperationInput,
  now: Date = new Date()
): WeighingOperationSummary {
  validateRequired("Cancellation reason", input.reason);

  const operation = getWeighingOperation(database, input.operationId);
  const timestamp = now.toISOString();

  const cancelOperation = database.transaction(() => {
    database
      .prepare(
        "UPDATE weighing_operations SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?"
      )
      .run(input.reason.trim(), timestamp, input.operationId);
    database
      .prepare(
        "UPDATE loading_requests SET status = 'cancelled', closed_at = ?, updated_at = ? WHERE operation_id = ?"
      )
      .run(timestamp, timestamp, input.operationId);
    insertAuditLog(
      database,
      null,
      input.operationId,
      "operation_cancelled",
      operation,
      { reason: input.reason.trim() },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}:cancelled`,
        payload: { operationId: input.operationId }
      },
      now
    );

    const loadingRequest = database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .get(input.operationId) as { id: string } | undefined;

    if (loadingRequest) {
      enqueueSyncJob(
        database,
        {
          target: "cloud",
          action: "upsert_loading_request",
          entityType: "loading_request",
          entityId: loadingRequest.id,
          idempotencyKey: `cloud:loading_request:${loadingRequest.id}:cancelled`,
          payload: { operationId: input.operationId }
        },
        now
      );
    }
  });

  cancelOperation();

  return getWeighingOperation(database, input.operationId);
}

export function listOpenWeighingOperations(database: DesktopDatabase): WeighingOperationSummary[] {
  return database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.total_cents,
        o.cancel_reason, o.created_at, o.updated_at,
        c.trade_name AS customer_name, v.plate, d.name AS driver_name, p.description AS product_description,
        pt.name AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
        WHERE o.status IN ('loading_requested', 'awaiting_exit', 'entry_registered')
          AND o.deleted_at IS NULL
        ORDER BY o.created_at DESC`
    )
    .all()
    .map((row) => mapOperationRow(row as OperationRow));
}

export function listCanceledWeighingOperations(database: DesktopDatabase): WeighingOperationSummary[] {
  return database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.total_cents,
        o.cancel_reason, o.created_at, o.updated_at,
        c.trade_name AS customer_name, v.plate, d.name AS driver_name, p.description AS product_description,
        pt.name AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       WHERE o.status = 'cancelled'
         AND o.deleted_at IS NULL
       ORDER BY o.updated_at DESC`
    )
    .all()
    .map((row) => mapOperationRow(row as OperationRow));
}

export function listClosedWeighingOperations(database: DesktopDatabase): WeighingOperationSummary[] {
  return database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.total_cents,
        o.cancel_reason, o.created_at, o.updated_at,
        c.trade_name AS customer_name, v.plate, d.name AS driver_name, p.description AS product_description,
        pt.name AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       WHERE o.status = 'closed_local'
         AND o.deleted_at IS NULL
       ORDER BY o.updated_at DESC`
    )
    .all()
    .map((row) => mapOperationRow(row as OperationRow));
}

export function clearCanceledWeighingOperations(
  database: DesktopDatabase,
  now: Date = new Date()
): number {
  const timestamp = now.toISOString();
  const result = database
    .prepare(
      `UPDATE weighing_operations
       SET deleted_at = ?, updated_at = ?
       WHERE status = 'cancelled' AND deleted_at IS NULL`
    )
    .run(timestamp, timestamp);

  return result.changes;
}

export function getWeighingOperation(
  database: DesktopDatabase,
  operationId: string
): WeighingOperationSummary {
  const row = database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_id, o.applied_price_table_name,
        o.applied_price_table_item_id, o.price_unit, o.price_savings_percent,
        o.product_total_cents, o.freight_total_cents, o.total_cents,
        o.cancel_reason, o.created_at, o.updated_at,
        c.trade_name AS customer_name, v.plate, d.name AS driver_name, p.description AS product_description,
        pt.name AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       WHERE o.id = ?`
    )
    .get(operationId) as OperationRow | undefined;

  if (!row) {
    throw new Error(`Weighing operation ${operationId} was not found.`);
  }

  return mapOperationRow(row);
}

function calculateNetWeightKg(entryWeightKg: number, exitWeightKg: number): number {
  if (exitWeightKg <= entryWeightKg) {
    throw new Error("Exit weight must be greater than entry weight.");
  }

  return Math.round((exitWeightKg - entryWeightKg) * 1000) / 1000;
}

function calculateProductTotalCents(
  netWeightKg: number,
  unitPriceCents: number | null
): number | null {
  return unitPriceCents === null ? null : Math.round((netWeightKg / 1000) * unitPriceCents);
}

function insertAuditLog(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity | null,
  operationId: string,
  action: string,
  before: unknown,
  after: unknown,
  createdAt: string
): void {
  database
    .prepare(
      `INSERT INTO audit_logs (id, company_id, unit_id, device_id, entity_type, entity_id, action, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, 'weighing_operation', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      identity?.companyId ?? null,
      identity?.unitId ?? null,
      identity?.deviceId ?? null,
      operationId,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      createdAt
    );
}

function mapOperationRow(row: OperationRow): WeighingOperationSummary {
  return {
    id: row.id,
    status: row.status,
    operationType: row.operation_type,
    customerName: row.customer_name ?? "",
    plate: row.plate ?? "",
    driverName: row.driver_name ?? "",
    productDescription: row.product_description ?? "",
    paymentTermName: row.payment_term_name,
    entryWeightKg: row.entry_weight_kg,
    exitWeightKg: row.exit_weight_kg,
    netWeightKg: row.net_weight_kg,
    unitPriceCents: row.unit_price_cents,
    baseUnitPriceCents: row.base_unit_price_cents,
    appliedPriceTableId: row.applied_price_table_id,
    appliedPriceTableName: row.applied_price_table_name,
    appliedPriceTableItemId: row.applied_price_table_item_id,
    priceUnit: row.price_unit,
    priceSavingsPercent: row.price_savings_percent,
    productTotalCents: row.product_total_cents,
    freightTotalCents: row.freight_total_cents,
    totalCents: row.total_cents,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateRequired(fieldName: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
}

function validateOperationType(operationType: string): asserts operationType is OperationType {
  if (operationType !== "invoice" && operationType !== "internal") {
    throw new Error("Operation type must be invoice or internal.");
  }
}

function validateUnitPrice(unitPriceCents: number | undefined): void {
  if (unitPriceCents !== undefined && unitPriceCents < 0) {
    throw new Error("Unit price cannot be negative.");
  }
}

function serializePriceDetails(priceDetails: PriceDetails | null): PriceDetails | null {
  return priceDetails;
}

function normalizePlate(plate: string): string {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function isFinishedGoodsProduct(product: {
  omie_product_id: number | null;
  item_type: string | null;
  fiscal_recommendations_json: string | null;
}): boolean {
  if (product.omie_product_id === null) return false;
  const candidates = [product.item_type, ...extractFiscalRecommendationValues(product.fiscal_recommendations_json)];
  return candidates.some((value) => matchesFinishedGoodsType(value));
}

function extractFiscalRecommendationValues(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const values: string[] = [];
    collectFiscalRecommendationValues(parsed, values);
    return values;
  } catch {
    return [];
  }
}

function collectFiscalRecommendationValues(value: unknown, output: string[]): void {
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFiscalRecommendationValues(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeFiscalTypeText(key);
      if (normalizedKey.includes("tipo") && (normalizedKey.includes("produto") || normalizedKey.includes("item"))) {
        collectFiscalRecommendationValues(nested, output);
      }
      if (normalizedKey === "codigo" || normalizedKey === "cod" || normalizedKey === "code") {
        collectFiscalRecommendationValues(nested, output);
      }
    }
  }
}

function matchesFinishedGoodsType(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeFiscalTypeText(value);
  return normalized === "04" || normalized.startsWith("04 ") || normalized.includes("produtos acabados") || normalized.includes("produto acabado");
}

function normalizeFiscalTypeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_/.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
