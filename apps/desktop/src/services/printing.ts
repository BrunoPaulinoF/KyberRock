import { randomUUID } from "node:crypto";

import {
  buildReceiptLinesWithConfig,
  normalizeReceiptTemplateConfig,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  type ReceiptTemplateInput,
  type ReceiptTemplateConfig
} from "@kyberrock/print-templates";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { enqueueSyncJob } from "./sync-queue.js";
import { isClosedOperationStatus } from "./weighing-operations.js";

export type PrintReceiptStatus = "printed" | "failed";
export type PrinterType = "windows" | "network";

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
  receiptLogoDataUrl?: string | null;
  receiptLogoWidthMm?: number;
  receiptLogoHeightMm?: number;
  receiptLogoFit?: ReceiptLogoFit;
  printerType?: PrinterType;
  networkHost?: string | null;
  networkPort?: number | null;
  templateConfig?: Partial<ReceiptTemplateConfig> | null;
}

export type ReceiptLogoFit = "contain" | "cover" | "fill";

export interface ReceiptLogoConfig {
  dataUrl: string | null;
  widthMm: number;
  heightMm: number;
  fit: ReceiptLogoFit;
}

export interface PrintProfileSummary {
  id: string;
  deviceId: string;
  documentType: "receipt_80mm" | "report_a4";
  printerType: PrinterType;
  windowsPrinterName: string;
  networkHost: string | null;
  networkPort: number | null;
  paperWidthMm: number;
  copies: number;
  cutPaper: boolean;
  receiptLogo: ReceiptLogoConfig;
  templateConfig: ReceiptTemplateConfig;
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
  printerType: PrinterType;
  networkHost: string | null;
  networkPort: number | null;
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
  receiptLogo: ReceiptLogoConfig;
}

interface PrintProfileRow {
  id: string;
  device_id: string;
  document_type: "receipt_80mm" | "report_a4";
  printer_type: string;
  windows_printer_name: string;
  network_host: string | null;
  network_port: number | null;
  paper_width_mm: number;
  font_config_json: string;
  template_config_json: string;
  copies: number;
  cut_paper: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface OperationReceiptRow {
  id: string;
  unit_id: string;
  company_name: string;
  company_document: string | null;
  company_state_registration: string | null;
  unit_name: string;
  status: string;
  operation_type: "invoice" | "internal";
  entry_weight_captured_at: string | null;
  entry_weight_kg: number | null;
  exit_weight_captured_at: string | null;
  exit_weight_kg: number | null;
  net_weight_kg: number | null;
  unit_price_cents: number | null;
  product_total_cents: number | null;
  freight_total_cents: number;
  total_cents: number | null;
  customer_name: string | null;
  customer_document: string | null;
  customer_phone: string | null;
  customer_zipcode: string | null;
  customer_city: string | null;
  customer_state: string | null;
  plate: string | null;
  driver_name: string | null;
  product_code: string | null;
  product_description: string | null;
  payment_term_name: string | null;
  payment_method_name: string | null;
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
  const printerType: PrinterType = input.printerType === "network" ? "network" : "windows";
  if (printerType === "windows") {
    validateRequired("Printer name", input.windowsPrinterName);
  } else {
    validateRequired("Network host", input.networkHost ?? "");
  }

  const timestamp = now.toISOString();
  const existing = getActiveReceiptPrintProfile(database, input.identity.deviceId);
  const profileId = existing?.id ?? randomUUID();
  const receiptLogo = normalizeReceiptLogo(input, existing?.receiptLogo ?? defaultReceiptLogoConfig());
  const templateConfig = normalizeReceiptTemplateConfig({
    ...(existing?.templateConfig ?? DEFAULT_RECEIPT_TEMPLATE_CONFIG),
    ...(input.templateConfig ?? {})
  });
  const windowsPrinterName = printerType === "windows" ? input.windowsPrinterName.trim() : (input.windowsPrinterName?.trim() || "NETWORK");
  const networkHost = printerType === "network" ? (input.networkHost ?? "").trim() : null;
  const networkPort = printerType === "network" ? (input.networkPort ?? 9100) : null;

  database
    .prepare(
      `INSERT INTO print_profiles (
        id, device_id, document_type, printer_type, windows_printer_name, network_host, network_port,
        paper_width_mm, margin_json, font_config_json, template_config_json,
        copies, cut_paper, is_active, created_at, updated_at
      ) VALUES (?, ?, 'receipt_80mm', ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        printer_type = excluded.printer_type,
        windows_printer_name = excluded.windows_printer_name,
        network_host = excluded.network_host,
        network_port = excluded.network_port,
        paper_width_mm = excluded.paper_width_mm,
        font_config_json = excluded.font_config_json,
        template_config_json = excluded.template_config_json,
        copies = excluded.copies,
        cut_paper = excluded.cut_paper,
        is_active = 1,
        updated_at = excluded.updated_at`
    )
    .run(
      profileId,
      input.identity.deviceId,
      printerType,
      windowsPrinterName,
      networkHost,
      networkPort,
      input.paperWidthMm ?? 80,
      JSON.stringify({ receiptLogo }),
      JSON.stringify(templateConfig),
      input.copies ?? 2,
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

  if (!isClosedOperationStatus(operation.status)) {
    throw new Error("Only closed operations can be printed.");
  }

  const profile = getActiveReceiptPrintProfile(database, input.identity.deviceId);
  const copies = Math.max(profile?.copies ?? 2, 2);
  const receiptNumber = getNextReceiptNumber(database, input.identity.unitId);
  let lastReceipt: PrintReceiptSummary | null = null;

  for (let copyNumber = 1; copyNumber <= copies; copyNumber += 1) {
    lastReceipt = await writeReceiptAttempt(
      database,
      input.identity,
      operation,
      printer,
      receiptNumber,
      copyNumber,
      now
    );
  }

  if (!lastReceipt) {
    throw new Error("No receipt copies were printed.");
  }

  return lastReceipt;
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
  const printerName = getProfilePrinterName(profile);
  const testSnapshot = buildTestReceiptSnapshot(timestamp, profile.receiptLogo, profile.templateConfig);
  const payload: ReceiptPrintPayload = {
    printerName,
    printerType: profile.printerType,
    networkHost: profile.networkHost,
    networkPort: profile.networkPort,
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
      printerName,
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
  const snapshot = buildReceiptSnapshot(
    operation,
    receiptNumber,
    copyNumber,
    timestamp,
    profile.receiptLogo,
    profile.templateConfig
  );
  const payload: ReceiptPrintPayload = {
    printerName: getProfilePrinterName(profile),
    printerType: profile.printerType,
    networkHost: profile.networkHost,
    networkPort: profile.networkPort,
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
        payload.printerName,
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
      { receiptId, receiptNumber, copyNumber, printerName: payload.printerName, status },
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
        o.id, o.unit_id, co.trade_name AS company_name, co.document AS company_document,
        NULL AS company_state_registration, u.name AS unit_name, o.status, o.operation_type,
        o.entry_weight_captured_at, o.entry_weight_kg, o.exit_weight_captured_at, o.exit_weight_kg,
        o.net_weight_kg, o.unit_price_cents, o.product_total_cents, o.freight_total_cents,
        o.total_cents, c.trade_name AS customer_name, c.document AS customer_document,
        c.phone AS customer_phone, c.zipcode AS customer_zipcode, c.city AS customer_city,
        c.state AS customer_state, v.plate, d.name AS driver_name, p.code AS product_code,
        p.description AS product_description,
        CASE
          WHEN o.manual_installments = 1 THEN '1 parcela'
          WHEN o.manual_installments > 1 THEN CAST(o.manual_installments AS TEXT) || ' parcelas'
          ELSE pt.name
        END AS payment_term_name,
        pm.name AS payment_method_name
       FROM weighing_operations o
        INNER JOIN companies co ON co.id = o.company_id
        INNER JOIN units u ON u.id = o.unit_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
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
  printedAt: string,
  receiptLogo: ReceiptLogoConfig,
  templateConfig: ReceiptTemplateConfig
): ReceiptContentSnapshot {
  if (
    operation.entry_weight_captured_at === null ||
    operation.entry_weight_kg === null ||
    operation.exit_weight_captured_at === null ||
    operation.exit_weight_kg === null ||
    operation.net_weight_kg === null
  ) {
    throw new Error("Closed operation is missing weight data.");
  }

  const templateInput: ReceiptTemplateInput = {
    companyName: operation.company_name,
    companyDocument: operation.company_document,
    companyStateRegistration: operation.company_state_registration,
    unitName: operation.unit_name,
    receiptNumber,
    copyNumber,
    printedAt,
    operationId: operation.id,
    operationType: operation.operation_type,
    customerName: operation.customer_name ?? "",
    customerDocument: operation.customer_document,
    customerPhone: operation.customer_phone,
    customerZipCode: operation.customer_zipcode,
    customerCity: operation.customer_city,
    customerState: operation.customer_state,
    productCode: operation.product_code,
    productDescription: operation.product_description ?? "",
    plate: operation.plate ?? "",
    driverName: operation.driver_name ?? "",
    paymentTermName: operation.payment_term_name,
    paymentMethodName: operation.payment_method_name,
    entryCapturedAt: operation.entry_weight_captured_at,
    exitCapturedAt: operation.exit_weight_captured_at,
    permanenceLabel: formatPermanence(operation.entry_weight_captured_at, operation.exit_weight_captured_at),
    entryWeightKg: operation.entry_weight_kg,
    exitWeightKg: operation.exit_weight_kg,
    netWeightKg: operation.net_weight_kg,
    unitPriceCents: operation.unit_price_cents,
    productTotalCents: operation.product_total_cents ?? 0,
    freightTotalCents: operation.freight_total_cents,
    totalCents: operation.total_cents ?? 0
  };
  const lines = buildReceiptLinesWithConfig(templateInput, templateConfig);

  return { ...templateInput, lines, receiptLogo };
}

function buildTestReceiptSnapshot(
  printedAt: string,
  receiptLogo: ReceiptLogoConfig = defaultReceiptLogoConfig(),
  templateConfig: ReceiptTemplateConfig = DEFAULT_RECEIPT_TEMPLATE_CONFIG
): ReceiptContentSnapshot {
  const templateInput: ReceiptTemplateInput = {
    companyName: "Pedreira Teste LTDA",
    companyDocument: "00.000.000/0001-00",
    companyStateRegistration: "000.000.000.000",
    unitName: "Pedreira Teste",
    receiptNumber: 0,
    copyNumber: 0,
    printedAt,
    operationId: "test",
    operationType: "invoice",
    customerName: "Cliente Exemplo",
    customerDocument: "11.111.111/0001-11",
    customerPhone: "(11) 99999-0000",
    customerZipCode: "00000-000",
    customerCity: "Cidade",
    customerState: "SP",
    productCode: "0001",
    productDescription: "Brita 1 (Teste)",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    paymentTermName: "A vista",
    paymentMethodName: "Dinheiro",
    entryCapturedAt: printedAt,
    exitCapturedAt: printedAt,
    permanenceLabel: "0min",
    entryWeightKg: 12_000,
    exitWeightKg: 18_500,
    netWeightKg: 6_500,
    unitPriceCents: 12_000,
    productTotalCents: 78_000,
    freightTotalCents: 0,
    totalCents: 78_000
  };
  const lines = buildReceiptLinesWithConfig(templateInput, templateConfig);
  lines.unshift("=== CUPOM DE TESTE ===");
  lines.push("", "Esta e uma impressao de teste.");

  return { ...templateInput, lines, receiptLogo };
}

function getProfilePrinterName(profile: PrintProfileSummary): string {
  return profile.printerType === "network"
    ? `${profile.networkHost ?? ""}:${profile.networkPort ?? 9100}`
    : profile.windowsPrinterName;
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
    printerType: row.printer_type === "network" ? "network" : "windows",
    windowsPrinterName: row.windows_printer_name,
    networkHost: row.network_host,
    networkPort: row.network_port,
    paperWidthMm: row.paper_width_mm,
    copies: row.copies,
    cutPaper: row.cut_paper === 1,
    receiptLogo: parseReceiptLogoConfig(row.font_config_json),
    templateConfig: normalizeReceiptTemplateConfig(parseJsonObject(row.template_config_json)),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function defaultReceiptLogoConfig(): ReceiptLogoConfig {
  return { dataUrl: null, widthMm: 24, heightMm: 16, fit: "contain" };
}

function normalizeReceiptLogo(
  input: ConfigureReceiptPrintProfileInput,
  current: ReceiptLogoConfig
): ReceiptLogoConfig {
  const dataUrl = input.receiptLogoDataUrl === undefined ? current.dataUrl : input.receiptLogoDataUrl;
  return {
    dataUrl: dataUrl && dataUrl.startsWith("data:image/") ? dataUrl : null,
    widthMm: clampNumber(input.receiptLogoWidthMm ?? current.widthMm, 10, 60),
    heightMm: clampNumber(input.receiptLogoHeightMm ?? current.heightMm, 8, 35),
    fit: normalizeLogoFit(input.receiptLogoFit ?? current.fit)
  };
}

function parseReceiptLogoConfig(value: string): ReceiptLogoConfig {
  try {
    const parsed = JSON.parse(value) as { receiptLogo?: Partial<ReceiptLogoConfig> };
    const current = parsed.receiptLogo ?? {};
    return normalizeReceiptLogo(
      {
        identity: {} as LocalDesktopIdentity,
        windowsPrinterName: "ignored",
        receiptLogoDataUrl: current.dataUrl ?? null,
        receiptLogoWidthMm: current.widthMm,
        receiptLogoHeightMm: current.heightMm,
        receiptLogoFit: current.fit
      },
      defaultReceiptLogoConfig()
    );
  } catch {
    return defaultReceiptLogoConfig();
  }
}

function normalizeLogoFit(value: string): ReceiptLogoFit {
  return value === "cover" || value === "fill" ? value : "contain";
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function formatPermanence(entryAt: string, exitAt: string): string {
  const milliseconds = Math.max(0, new Date(exitAt).getTime() - new Date(entryAt).getTime());
  const totalMinutes = Math.round(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    `${minutes}min`
  ]
    .filter(Boolean)
    .join(" ");
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

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
