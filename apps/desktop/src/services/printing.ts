import { randomUUID } from "node:crypto";

import { buildReceiptLines, type ReceiptTemplateInput } from "@kyberrock/print-templates";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { enqueueSyncJob } from "./sync-queue.js";

export type PrintReceiptStatus = "printed" | "failed";

export interface WindowsPrinterSummary {
  name: string;
  isDefault: boolean;
}

export interface ConfigureReceiptPrintProfileInput {
  identity: LocalDesktopIdentity;
  windowsPrinterName: string;
  paperWidthMm?: number;
  copies?: number;
  cutPaper?: boolean;
}

export interface PrintProfileSummary {
  id: string;
  deviceId: string;
  documentType: "receipt_80mm" | "report_a4";
  windowsPrinterName: string;
  paperWidthMm: number;
  copies: number;
  cutPaper: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PrintWeighingReceiptInput {
  operationId: string;
  identity: LocalDesktopIdentity;
}

export interface ReprintWeighingReceiptInput {
  receiptId: string;
  identity: LocalDesktopIdentity;
}

export interface PrintTestReceiptInput {
  identity: LocalDesktopIdentity;
}

export interface ReceiptPrintPayload {
  printerName: string;
  paperWidthMm: number;
  lines: string[];
  contentText: string;
  snapshot: ReceiptContentSnapshot;
}

export interface ReceiptPrinter {
  printReceipt: (payload: ReceiptPrintPayload) => Promise<void>;
}

export interface PrintReceiptSummary {
  id: string;
  operationId: string;
  unitId: string;
  receiptNumber: number;
  copyNumber: number;
  printerName: string;
  status: PrintReceiptStatus;
  errorMessage: string | null;
  printedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface ReceiptContentSnapshot extends ReceiptTemplateInput {
  lines: string[];
}

interface PrintProfileRow {
  id: string;
  device_id: string;
  document_type: "receipt_80mm" | "report_a4";
  windows_printer_name: string;
  paper_width_mm: number;
  copies: number;
  cut_paper: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface OperationReceiptRow {
  id: string;
  unit_id: string;
  unit_name: string;
  status: string;
  operation_type: "invoice" | "internal";
  entry_weight_kg: number | null;
  exit_weight_kg: number | null;
  net_weight_kg: number | null;
  product_total_cents: number | null;
  freight_total_cents: number;
  total_cents: number | null;
  customer_name: string | null;
  plate: string | null;
  driver_name: string | null;
  product_description: string | null;
  payment_term_name: string | null;
}

interface PrintReceiptRow {
  id: string;
  operation_id: string;
  unit_id: string;
  receipt_number: number;
  copy_number: number;
  printed_at: string;
  printer_name: string;
  status: PrintReceiptStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function configureReceiptPrintProfile(
  database: DesktopDatabase,
  input: ConfigureReceiptPrintProfileInput,
  now: Date = new Date()
): PrintProfileSummary {
  validateRequired("Printer name", input.windowsPrinterName);

  const timestamp = now.toISOString();
  const existing = getActiveReceiptPrintProfile(database, input.identity.deviceId);
  const profileId = existing?.id ?? randomUUID();

  database
    .prepare(
      `INSERT INTO print_profiles (
        id, device_id, document_type, windows_printer_name, paper_width_mm,
        margin_json, font_config_json, copies, cut_paper, is_active, created_at, updated_at
      ) VALUES (?, ?, 'receipt_80mm', ?, ?, '{}', '{}', ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        windows_printer_name = excluded.windows_printer_name,
        paper_width_mm = excluded.paper_width_mm,
        copies = excluded.copies,
        cut_paper = excluded.cut_paper,
        is_active = 1,
        updated_at = excluded.updated_at`
    )
    .run(
      profileId,
      input.identity.deviceId,
      input.windowsPrinterName.trim(),
      input.paperWidthMm ?? 80,
      input.copies ?? 1,
      input.cutPaper ? 1 : 0,
      timestamp,
      timestamp
    );

  return getRequiredPrintProfile(database, profileId);
}

export function listPrintProfiles(database: DesktopDatabase): PrintProfileSummary[] {
  return database
    .prepare("SELECT * FROM print_profiles ORDER BY updated_at DESC")
    .all()
    .map((row) => mapPrintProfileRow(row as PrintProfileRow));
}

export function listPrintReceipts(database: DesktopDatabase): PrintReceiptSummary[] {
  return database
    .prepare("SELECT * FROM print_receipts ORDER BY created_at DESC")
    .all()
    .map((row) => mapPrintReceiptRow(row as PrintReceiptRow));
}

export async function printWeighingReceipt(
  database: DesktopDatabase,
  input: PrintWeighingReceiptInput,
  printer: ReceiptPrinter,
  now: Date = new Date()
): Promise<PrintReceiptSummary> {
  const operation = getOperationForReceipt(database, input.operationId);

  if (operation.status !== "closed_local") {
    throw new Error("Only closed operations can be printed.");
  }

  const receiptNumber = getNextReceiptNumber(database, input.identity.unitId);
  return writeReceiptAttempt(database, input.identity, operation, printer, receiptNumber, 1, now);
}

export async function reprintWeighingReceipt(
  database: DesktopDatabase,
  input: ReprintWeighingReceiptInput,
  printer: ReceiptPrinter,
  now: Date = new Date()
): Promise<PrintReceiptSummary> {
  const originalReceipt = getRequiredPrintReceipt(database, input.receiptId);
  const operation = getOperationForReceipt(database, originalReceipt.operationId);
  const copyNumber = getNextCopyNumber(database, originalReceipt.operationId);

  return writeReceiptAttempt(
    database,
    input.identity,
    operation,
    printer,
    originalReceipt.receiptNumber,
    copyNumber,
    now,
    originalReceipt
  );
}

export async function printTestReceipt(
  database: DesktopDatabase,
  input: PrintTestReceiptInput,
  printer: ReceiptPrinter,
  now: Date = new Date()
): Promise<PrintReceiptSummary> {
  const profile = getActiveReceiptPrintProfile(database, input.identity.deviceId);

  if (!profile) {
    throw new Error("No active receipt printer profile is configured.");
  }

  const timestamp = now.toISOString();
  const receiptId = randomUUID();
  const testSnapshot = buildTestReceiptSnapshot(timestamp);
  const payload: ReceiptPrintPayload = {
    printerName: profile.windowsPrinterName,
    paperWidthMm: profile.paperWidthMm,
    lines: testSnapshot.lines,
    contentText: testSnapshot.lines.join("\n"),
    snapshot: testSnapshot
  };

  let status: PrintReceiptStatus = "printed";
  let errorMessage: string | null = null;

  try {
    await printer.printReceipt(payload);
  } catch (error) {
    status = "failed";
    errorMessage = sanitizeErrorMessage(error);
  }

  // Insert a placeholder test operation to satisfy FK
  const testOperationId = "test";
  // Delete any previous test operation first to avoid PK conflict
  database.prepare("DELETE FROM weighing_operations WHERE id = ?").run(testOperationId);
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type,
        entry_weight_kg, exit_weight_kg, net_weight_kg,
        product_total_cents, freight_total_cents, total_cents,
        unit_price_cents, cancel_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      testOperationId,
      input.identity.companyId,
      input.identity.unitId,
      input.identity.deviceId,
      "cancelled",
      "invoice",
      12_000,
      18_500,
      6_500,
      78_000,
      0,
      78_000,
      12,
      "Teste de impressora",
      timestamp,
      timestamp
    );

  // Delete any previous test receipt first to avoid PK conflict on repeated tests
  database.prepare("DELETE FROM print_receipts WHERE operation_id = ?").run(testOperationId);

  database
    .prepare(
      `INSERT INTO print_receipts (
        id, operation_id, unit_id, receipt_number, copy_number, content_snapshot_json,
        printed_at, printer_name, status, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      receiptId,
      testOperationId,
      input.identity.unitId,
      0,
      0,
      JSON.stringify(testSnapshot),
      timestamp,
      profile.windowsPrinterName,
      status,
      errorMessage,
      timestamp,
      timestamp
    );

  return getRequiredPrintReceipt(database, receiptId);
}

async function writeReceiptAttempt(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  operation: OperationReceiptRow,
  printer: ReceiptPrinter,
  receiptNumber: number,
  copyNumber: number,
  now: Date,
  originalReceipt?: PrintReceiptSummary
): Promise<PrintReceiptSummary> {
  const profile = getActiveReceiptPrintProfile(database, identity.deviceId);

  if (!profile) {
    throw new Error("No active receipt printer profile is configured.");
  }

  const timestamp = now.toISOString();
  const receiptId = randomUUID();
  const snapshot = buildReceiptSnapshot(operation, receiptNumber, copyNumber, timestamp);
  const payload: ReceiptPrintPayload = {
    printerName: profile.windowsPrinterName,
    paperWidthMm: profile.paperWidthMm,
    lines: snapshot.lines,
    contentText: snapshot.lines.join("\n"),
    snapshot
  };
  let status: PrintReceiptStatus = "printed";
  let errorMessage: string | null = null;

  try {
    await printer.printReceipt(payload);
  } catch (error) {
    status = "failed";
    errorMessage = sanitizeErrorMessage(error);
  }

  const writeReceipt = database.transaction(() => {
    if (!originalReceipt) {
      database
        .prepare("UPDATE units SET receipt_sequence = ?, updated_at = ? WHERE id = ?")
        .run(receiptNumber, timestamp, identity.unitId);
    }

    database
      .prepare(
        `INSERT INTO print_receipts (
          id, operation_id, unit_id, receipt_number, copy_number, content_snapshot_json,
          printed_at, printer_name, status, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        receiptId,
        operation.id,
        operation.unit_id,
        receiptNumber,
        copyNumber,
        JSON.stringify(snapshot),
        timestamp,
        profile.windowsPrinterName,
        status,
        errorMessage,
        timestamp,
        timestamp
      );

    insertAuditLog(
      database,
      identity,
      operation.id,
      originalReceipt ? "receipt_reprinted" : "receipt_printed",
      originalReceipt ?? null,
      { receiptId, receiptNumber, copyNumber, printerName: profile.windowsPrinterName, status },
      timestamp
    );

    enqueueSyncJob(
      database,
      {
        target: "cloud",
        action: "upsert_print_receipt",
        entityType: "print_receipt",
        entityId: receiptId,
        idempotencyKey: `cloud:print_receipt:${receiptId}`,
        payload: { operationId: operation.id, receiptId, receiptNumber, copyNumber, status }
      },
      now
    );
  });

  writeReceipt();

  return getRequiredPrintReceipt(database, receiptId);
}

function getActiveReceiptPrintProfile(
  database: DesktopDatabase,
  deviceId: string
): PrintProfileSummary | null {
  const row = database
    .prepare(
      `SELECT * FROM print_profiles
       WHERE device_id = ? AND document_type = 'receipt_80mm' AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(deviceId) as PrintProfileRow | undefined;

  return row ? mapPrintProfileRow(row) : null;
}

function getRequiredPrintProfile(
  database: DesktopDatabase,
  profileId: string
): PrintProfileSummary {
  const row = database.prepare("SELECT * FROM print_profiles WHERE id = ?").get(profileId) as
    | PrintProfileRow
    | undefined;

  if (!row) {
    throw new Error(`Print profile ${profileId} was not found.`);
  }

  return mapPrintProfileRow(row);
}

function getRequiredPrintReceipt(
  database: DesktopDatabase,
  receiptId: string
): PrintReceiptSummary {
  const row = database.prepare("SELECT * FROM print_receipts WHERE id = ?").get(receiptId) as
    | PrintReceiptRow
    | undefined;

  if (!row) {
    throw new Error(`Print receipt ${receiptId} was not found.`);
  }

  return mapPrintReceiptRow(row);
}

function getOperationForReceipt(
  database: DesktopDatabase,
  operationId: string
): OperationReceiptRow {
  const row = database
    .prepare(
      `SELECT
        o.id, o.unit_id, u.name AS unit_name, o.status, o.operation_type,
        o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.product_total_cents, o.freight_total_cents, o.total_cents,
        c.trade_name AS customer_name, v.plate, d.name AS driver_name,
        p.description AS product_description,
        CASE
          WHEN o.manual_installments = 1 THEN '1 parcela'
          WHEN o.manual_installments > 1 THEN CAST(o.manual_installments AS TEXT) || ' parcelas'
          ELSE pt.name
        END AS payment_term_name
       FROM weighing_operations o
       INNER JOIN units u ON u.id = o.unit_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       WHERE o.id = ?`
    )
    .get(operationId) as OperationReceiptRow | undefined;

  if (!row) {
    throw new Error(`Weighing operation ${operationId} was not found.`);
  }

  return row;
}

function getNextReceiptNumber(database: DesktopDatabase, unitId: string): number {
  const current = database
    .prepare("SELECT receipt_sequence FROM units WHERE id = ?")
    .pluck()
    .get(unitId) as number | undefined;

  if (current === undefined) {
    throw new Error(`Unit ${unitId} was not found.`);
  }

  return current + 1;
}

function getNextCopyNumber(database: DesktopDatabase, operationId: string): number {
  const current = database
    .prepare("SELECT MAX(copy_number) FROM print_receipts WHERE operation_id = ?")
    .pluck()
    .get(operationId) as number | null;

  return (current ?? 0) + 1;
}

function buildReceiptSnapshot(
  operation: OperationReceiptRow,
  receiptNumber: number,
  copyNumber: number,
  printedAt: string
): ReceiptContentSnapshot {
  if (
    operation.entry_weight_kg === null ||
    operation.exit_weight_kg === null ||
    operation.net_weight_kg === null
  ) {
    throw new Error("Closed operation is missing weight data.");
  }

  const templateInput: ReceiptTemplateInput = {
    unitName: operation.unit_name,
    receiptNumber,
    copyNumber,
    printedAt,
    operationId: operation.id,
    operationType: operation.operation_type,
    customerName: operation.customer_name ?? "",
    productDescription: operation.product_description ?? "",
    plate: operation.plate ?? "",
    driverName: operation.driver_name ?? "",
    paymentTermName: operation.payment_term_name,
    entryWeightKg: operation.entry_weight_kg,
    exitWeightKg: operation.exit_weight_kg,
    netWeightKg: operation.net_weight_kg,
    productTotalCents: operation.product_total_cents ?? 0,
    freightTotalCents: operation.freight_total_cents,
    totalCents: operation.total_cents ?? 0
  };
  const lines = buildReceiptLines(templateInput);

  return { ...templateInput, lines };
}

function buildTestReceiptSnapshot(printedAt: string): ReceiptContentSnapshot {
  const templateInput: ReceiptTemplateInput = {
    unitName: "Pedreira Teste",
    receiptNumber: 0,
    copyNumber: 0,
    printedAt,
    operationId: "test",
    operationType: "invoice",
    customerName: "Cliente Exemplo",
    productDescription: "Brita 1 (Teste)",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    paymentTermName: "A vista",
    entryWeightKg: 12_000,
    exitWeightKg: 18_500,
    netWeightKg: 6_500,
    productTotalCents: 78_000,
    freightTotalCents: 0,
    totalCents: 78_000
  };
  const lines = buildReceiptLines(templateInput);
  lines.unshift("=== CUPOM DE TESTE ===");
  lines.push("", "Esta e uma impressao de teste.");

  return { ...templateInput, lines };
}

function insertAuditLog(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  operationId: string,
  action: string,
  before: unknown,
  after: unknown,
  createdAt: string
): void {
  database
    .prepare(
      `INSERT INTO audit_logs (id, company_id, unit_id, device_id, entity_type, entity_id, action, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, 'print_receipt', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      identity.companyId,
      identity.unitId,
      identity.deviceId,
      operationId,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      createdAt
    );
}

function mapPrintProfileRow(row: PrintProfileRow): PrintProfileSummary {
  return {
    id: row.id,
    deviceId: row.device_id,
    documentType: row.document_type,
    windowsPrinterName: row.windows_printer_name,
    paperWidthMm: row.paper_width_mm,
    copies: row.copies,
    cutPaper: row.cut_paper === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPrintReceiptRow(row: PrintReceiptRow): PrintReceiptSummary {
  return {
    id: row.id,
    operationId: row.operation_id,
    unitId: row.unit_id,
    receiptNumber: row.receipt_number,
    copyNumber: row.copy_number,
    printerName: row.printer_name,
    status: row.status,
    errorMessage: row.error_message,
    printedAt: row.printed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateRequired(fieldName: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Printer failed.";
  return message.slice(0, 500);
}
