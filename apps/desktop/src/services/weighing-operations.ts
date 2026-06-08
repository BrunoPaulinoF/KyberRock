import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
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

export interface CloseWeighingOperationInput {
  operationId: string;
  exitWeightKg: number;
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
           VALUES (?, ?, ?, ?, 'kg', ?, ?)`
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
          payment_term_id, entry_weight_kg, entry_weight_captured_at, unit_price_cents, freight_total_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'loading_requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
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
        action: "upsert_loading_request",
        entityType: "loading_request",
        entityId: ids.loadingRequestId,
        idempotencyKey: `cloud:loading_request:${ids.loadingRequestId}`,
        payload: { operationId: ids.operationId }
      },
      now
    );
  });

  createOperation();

  return getWeighingOperation(database, ids.operationId);
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

  const closeOperation = database.transaction(() => {
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
      { exitWeightKg: input.exitWeightKg, netWeightKg, productTotalCents, totalCents },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: input.operationId,
        idempotencyKey: `cloud:operation:${input.operationId}`,
        payload: { operationId: input.operationId }
      },
      now
    );
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
  });

  cancelOperation();

  return getWeighingOperation(database, input.operationId);
}

export function listOpenWeighingOperations(database: DesktopDatabase): WeighingOperationSummary[] {
  return database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.product_total_cents, o.freight_total_cents, o.total_cents,
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
       ORDER BY o.created_at DESC`
    )
    .all()
    .map((row) => mapOperationRow(row as OperationRow));
}

export function getWeighingOperation(
  database: DesktopDatabase,
  operationId: string
): WeighingOperationSummary {
  const row = database
    .prepare(
      `SELECT
        o.id, o.status, o.operation_type, o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.product_total_cents, o.freight_total_cents, o.total_cents,
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
  return unitPriceCents === null ? null : Math.round(netWeightKg * unitPriceCents);
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

function normalizePlate(plate: string): string {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
