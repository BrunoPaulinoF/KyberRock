import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  getDefaultSupabasePublishableKey,
  getDefaultSupabaseUrl,
  isSupabaseConfigured,
  resetSupabaseConfigCache,
  setSupabaseConfigCache,
  supabaseConfig
} from "../config/supabase-config.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { readLocalSetting, readStringLocalSetting, writeLocalSetting } from "./local-settings.js";
import { ReportService } from "./reports.js";
import {
  markRecipientSynced,
  markRecipientSyncError,
  type ReportRecipientRow
} from "./report-recipients.js";
import { isSellableProduct } from "./product-classification.js";
import {
  enqueueSyncJob,
  listRunnableSyncJobs,
  markSyncJobBlocked,
  markSyncJobDone,
  markSyncJobFailed
} from "./sync-queue.js";
import {
  buildOmieBillingJob,
  enqueueOmieBillingJob,
  validateOperationFiscalReadiness
} from "./weighing-operations.js";
import { isCadastroIncompleteFault } from "./omie-fault-classifier.js";

let client: SupabaseClient | null = null;
let clientConfigKey: string | null = null;

export const CLOUD_SUPABASE_URL_KEY = "cloud_supabase_url";
export const CLOUD_PUBLISHABLE_KEY_KEY = "cloud_publishable_key";
const OMIE_BATCH_DELAY_MS = 3_000;
const OMIE_PUSH_CUSTOMER_BATCH_LIMIT = 10;
const OMIE_QUEUE_BATCH_LIMIT = 10;

export function readStoredSupabaseConfig(
  database: DesktopDatabase
): { url: string; publishableKey: string } {
  const url = readStringLocalSetting(database, CLOUD_SUPABASE_URL_KEY) ?? "";
  const publishableKey = readStringLocalSetting(database, CLOUD_PUBLISHABLE_KEY_KEY) ?? "";
  return { url, publishableKey };
}

export function writeStoredSupabaseConfig(
  database: DesktopDatabase,
  values: { url?: string | null; publishableKey?: string | null },
  updatedAt: string = new Date().toISOString()
): void {
  if (values.url !== undefined) {
    const trimmed = values.url?.trim() ?? "";
    writeLocalSetting(
      database,
      CLOUD_SUPABASE_URL_KEY,
      trimmed.length > 0 ? trimmed : null,
      updatedAt
    );
  }
  if (values.publishableKey !== undefined) {
    const trimmed = values.publishableKey?.trim() ?? "";
    writeLocalSetting(
      database,
      CLOUD_PUBLISHABLE_KEY_KEY,
      trimmed.length > 0 ? trimmed : null,
      updatedAt
    );
  }
  resetSupabaseConfigCache();
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

export interface CloudBootstrapResult extends SyncResult {
  mode: "cloud" | "local_emergency";
  pulled: {
    customers: number;
    products: number;
    operations: number;
    loadingRequests: number;
    printReceipts: number;
  };
}

interface DesktopPullResponse {
  customers?: Array<Record<string, unknown>>;
  products?: Array<Record<string, unknown>>;
  operations?: Array<Record<string, unknown>>;
  loadingRequests?: Array<Record<string, unknown>>;
  printReceipts?: Array<Record<string, unknown>>;
}

export interface OmieCloudSyncResult {
  customersPulled: number;
  customersPushed: number;
  productsSynced: number;
  paymentTermsSynced: number;
  suppliersSynced: number;
  errors: string[];
}

export interface FiscalBillingResult {
  orderId: number | null;
  billed: boolean;
  /** true quando o faturamento foi bloqueado por pendencia de cadastro (nao é erro/retry). */
  blocked?: boolean;
  /** Mensagem acionavel da pendencia (ex.: preencher Numero do Endereco + E-mail). */
  blockReason?: string | null;
  billingStatusCode: string | null;
  billingStatusMessage: string | null;
  documentUrl: string | null;
  documentPrinted: boolean;
  documentPrintError: string | null;
}

interface OmieReferenceCustomer {
  id: number;
  integrationCode?: string | null;
  name: string;
  tradeName: string | null;
  document: string | null;
  stateRegistration?: string | null;
  municipalRegistration?: string | null;
  isIndividual?: boolean;
  email: string | null;
  homepage?: string | null;
  contactName?: string | null;
  phone: string | null;
  phoneSecondary?: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement?: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country?: string | null;
  countryCode?: string | null;
  ibgeCityCode?: string | null;
  ibgeStateCode?: string | null;
  customerType?: string | null;
  isForeign?: boolean;
  billingBlocked?: boolean;
  isActive?: boolean;
  observations?: string | null;
  tagsJson?: Record<string, unknown> | unknown[] | null;
  salespersonId?: number | null;
  defaultPaymentTermId: string | null;
}

interface OmieReferenceProduct {
  id: number;
  code: string | null;
  integrationCode?: string | null;
  description: string;
  detailedDescription?: string | null;
  unit: string | null;
  ncm: string | null;
  ean: string | null;
  unitPriceCents: number | null;
  familyCode?: string | null;
  familyDescription?: string | null;
  brand?: string | null;
  model?: string | null;
  internalNotes?: string | null;
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
  heightM?: number | null;
  widthM?: number | null;
  depthM?: number | null;
  cest?: string | null;
  itemType?: string | null;
  icmsOrigin?: string | null;
  isActive?: boolean;
  blocked?: boolean;
  tracksStock?: boolean;
  fiscalRecommendations?: Record<string, unknown> | null;
}

interface OmieReferencePaymentTerm {
  id: number;
  code?: string | null;
  integrationCode?: string | null;
  description: string;
  firstInstallmentDays?: number | null;
  installmentIntervalDays?: number | null;
  installmentCount?: number | null;
  installmentType?: string | null;
  installmentDaysJson?: number[] | null;
  isActive?: boolean;
  visible?: boolean;
}

interface OmieReferenceSupplier {
  id: number;
  integrationCode?: string | null;
  name: string;
  tradeName?: string | null;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  zipcode?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  isActive?: boolean;
  tagsJson?: Record<string, unknown> | unknown[] | null;
}

interface OmieReferenceDataResponse {
  customers?: OmieReferenceCustomer[];
  products?: OmieReferenceProduct[];
  paymentTerms?: OmieReferencePaymentTerm[];
  suppliers?: OmieReferenceSupplier[];
  pageSize?: number;
  pagination?: {
    customersPage: number;
    productsPage: number;
    paymentTermsPage: number;
    suppliersPage?: number;
    customersReturned: number;
    productsReturned: number;
    paymentTermsReturned: number;
    suppliersReturned?: number;
    customersFinished?: boolean;
    productsFinished?: boolean;
    paymentTermsFinished?: boolean;
    suppliersFinished?: boolean;
    customersTotalPages?: number | null;
    customersTotalRecords?: number | null;
    productsTotalPages?: number | null;
    productsTotalRecords?: number | null;
    paymentTermsTotalPages?: number | null;
    paymentTermsTotalRecords?: number | null;
    suppliersTotalPages?: number | null;
    suppliersTotalRecords?: number | null;
  };
}

interface OmiePullState {
  customersPage: number;
  productsPage: number;
  paymentTermsPage: number;
  suppliersPage: number;
  customersFinished: boolean;
  productsFinished: boolean;
  paymentTermsFinished: boolean;
  suppliersFinished: boolean;
  inProgress: boolean;
  lastUpdatedAt: string | null;
}

const OMIE_PULL_STATE_KEY = "omie_pull_state";

export function readOmiePullState(database: DesktopDatabase): OmiePullState {
  const stored = readLocalSetting<OmiePullState>(database, OMIE_PULL_STATE_KEY);
  return {
    customersPage: 1,
    productsPage: 1,
    paymentTermsPage: 1,
    suppliersPage: 1,
    customersFinished: false,
    productsFinished: false,
    paymentTermsFinished: false,
    suppliersFinished: false,
    inProgress: false,
    lastUpdatedAt: null,
    ...(stored ?? {})
  };
}

export function writeOmiePullState(
  database: DesktopDatabase,
  patch: Partial<OmiePullState> & { markDone?: "customers" | "products" | "paymentTerms" }
): OmiePullState {
  const current = readOmiePullState(database);
  const next: OmiePullState = {
    ...current,
    ...patch,
    lastUpdatedAt: new Date().toISOString()
  };
  if (patch.markDone === "customers") {
    next.customersPage = 1;
    next.suppliersPage = 1;
    next.customersFinished = true;
    next.suppliersFinished = true;
  }
  if (patch.markDone === "products") {
    next.productsPage = 1;
    next.productsFinished = true;
  }
  if (patch.markDone === "paymentTerms") {
    next.paymentTermsPage = 1;
    next.paymentTermsFinished = true;
  }
  if (next.customersFinished && next.productsFinished && next.paymentTermsFinished) {
    next.inProgress = false;
  }
  writeLocalSetting(database, OMIE_PULL_STATE_KEY, next);
  return next;
}

interface CloudSettings {
  companyId: string;
  unitId: string;
  deviceId: string;
  deviceToken: string;
}

export function initializeSupabase(): void {
  if (!client && isSupabaseConfigured()) {
    const configKey = `${supabaseConfig.url}|${supabaseConfig.publishableKey}`;
    client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    clientConfigKey = configKey;
  }
}

export function initializeSupabaseFromSettings(
  database: DesktopDatabase,
  options: { reset?: boolean } = {}
): void {
  const stored = readStoredSupabaseConfig(database);
  if (options.reset) {
    setSupabaseConfigCache(null, null);
    if (client) {
      client = null;
      clientConfigKey = null;
    }
    return;
  }
  setSupabaseConfigCache(stored.url || null, stored.publishableKey || null);
  const configKey = `${supabaseConfig.url}|${supabaseConfig.publishableKey}`;
  if (client && clientConfigKey !== configKey) {
    client = null;
    clientConfigKey = null;
  }
  if (!client && isSupabaseConfigured()) {
    client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    clientConfigKey = configKey;
  }
}

export function isSupabaseInitialized(): boolean {
  return client !== null;
}

export function ensureSupabaseInitialized(): SupabaseClient | null {
  initializeSupabase();
  return client;
}

export async function pingSupabase(timeoutMs = 4_000): Promise<boolean> {
  const instance = ensureSupabaseInitialized();
  if (!instance) {
    return false;
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { error } = await instance
      .from("weighing_operations")
      .select("synced_at", { count: "exact", head: true })
      .abortSignal(controller.signal);
    if (error) {
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function getSupabaseClient(): SupabaseClient {
  initializeSupabase();
  if (!client) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_PUBLISHABLE_KEY na pedreira no admin (loader-web) e reative o desktop."
    );
  }
  return client;
}

export function getSupabaseActivationClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim() || getDefaultSupabaseUrl();
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || getDefaultSupabasePublishableKey();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function syncOperationToSupabase(
  database: DesktopDatabase,
  operationId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const operation = getOperationPayload(database, operationId, settings);
  const dependencies = collectCloudSyncDependencies(database, operation);
  await invokeDesktopSync(settings, { operations: [operation], ...dependencies });
  return true;
}

// Media (30 dias) de tempo dentro da pedreira, projetada na unidade para o
// alerta do carregador. Best-effort: nunca deve quebrar o sync.
function computeAvgQuarryMinutes(database: DesktopDatabase, unitId: string): number | undefined {
  try {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const avg = new ReportService(database).getAverageQuarryMinutes(
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
      unitId
    );
    return avg > 0 ? avg : undefined;
  } catch {
    return undefined;
  }
}

export async function syncLoadingRequestToSupabase(
  database: DesktopDatabase,
  requestId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const {
    customer_id: customerId,
    product_id: productId,
    ...request
  } = getLoadingRequestPayload(database, requestId, settings);
  const dependencies = collectCloudSyncDependencies(database, {
    customer_id: customerId,
    product_id: productId
  });
  const avgQuarryMinutes = computeAvgQuarryMinutes(database, identity.unitId);
  await invokeDesktopSync(settings, {
    loadingRequests: [request],
    ...dependencies,
    ...(avgQuarryMinutes !== undefined ? { avgQuarryMinutes } : {})
  });
  return true;
}

export async function syncPrintReceiptToSupabase(
  database: DesktopDatabase,
  receiptId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const receipt = getPrintReceiptPayload(database, receiptId, settings);
  const operation = getOperationForReceipt(database, receiptId);
  const dependencies = operation
    ? collectCloudSyncDependencies(database, operation)
    : collectCloudSyncDependencies(database, {
        customer_id: null,
        product_id: null
      });
  await invokeDesktopSync(settings, { printReceipts: [receipt], ...dependencies });
  return true;
}

export async function processCloudSyncQueue(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const jobs = listRunnableSyncJobs(database, { target: "cloud", limit: 100 });
  const orderedJobs = orderCloudSyncJobsTopologically(jobs);
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const job of orderedJobs) {
    try {
      if (job.action === "upsert_operation") {
        await syncOperationToSupabase(
          database,
          getPayloadId(job.payload, "operationId", job.entityId),
          identity
        );
      } else if (job.action === "upsert_loading_request") {
        await syncLoadingRequestToSupabase(database, job.entityId, identity);
      } else if (job.action === "upsert_print_receipt") {
        await syncPrintReceiptToSupabase(database, job.entityId, identity);
      } else {
        throw new Error(`Acao cloud desconhecida: ${job.action}`);
      }
      markSyncJobDone(database, job.id);
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro cloud";
      markSyncJobFailed(database, job.id, message);
      failed++;
      errors.push(`Job ${job.id}: ${message}`);
    }
  }

  return { processed, failed, errors };
}

export async function pullDesktopDataFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<CloudBootstrapResult["pulled"]> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<DesktopPullResponse>("desktop-pull", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));

  const payload = data ?? {};
  const apply = database.transaction(() => {
    const customers = upsertCloudCustomers(database, settings.companyId, payload.customers ?? []);
    const products = upsertCloudProducts(database, settings.companyId, payload.products ?? []);
    const operations = upsertCloudOperations(database, settings, payload.operations ?? []);
    const loadingRequests = upsertCloudLoadingRequests(database, settings, payload.loadingRequests ?? []);
    const printReceipts = upsertCloudPrintReceipts(database, payload.printReceipts ?? []);
    writeLocalSetting(database, "cloud_bootstrap_last_pull_at", new Date().toISOString());
    return { customers, products, operations, loadingRequests, printReceipts };
  });

  return apply();
}

function upsertCloudCustomers(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO customers (
      id, company_id, omie_customer_id, source, legal_name, trade_name, document, phone, email,
      credit_limit_cents, open_receivables_cents, sync_status, is_active, created_at, updated_at,
      deleted_at, last_synced_at, needs_push
    ) VALUES (?, ?, ?, 'hybrid', ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, NULL, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_customer_id = excluded.omie_customer_id,
      source = CASE WHEN customers.source = 'local' THEN 'hybrid' ELSE customers.source END,
      legal_name = excluded.legal_name,
      trade_name = excluded.trade_name,
      document = excluded.document,
      phone = excluded.phone,
      email = excluded.email,
      credit_limit_cents = excluded.credit_limit_cents,
      open_receivables_cents = excluded.open_receivables_cents,
      sync_status = 'synced',
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = NULL,
      last_synced_at = excluded.last_synced_at,
      needs_push = 0
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const legalName = stringValue(row.legal_name) || stringValue(row.trade_name) || "Cliente";
    const tradeName = stringValue(row.trade_name) || legalName;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      integerValue(row.omie_customer_id),
      legalName,
      tradeName,
      nullableStringValue(row.document),
      nullableStringValue(row.phone),
      nullableStringValue(row.email),
      integerValue(row.credit_limit_cents),
      integerValue(row.open_receivables_cents) ?? 0,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

function upsertCloudProducts(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO products (
      id, company_id, omie_product_id, code, description, unit, is_active, updated_from_omie_at,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_product_id = excluded.omie_product_id,
      code = excluded.code,
      description = excluded.description,
      unit = excluded.unit,
      is_active = excluded.is_active,
      updated_from_omie_at = excluded.updated_from_omie_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const description = stringValue(row.description) || "Produto";
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      integerValue(row.omie_product_id),
      stringValue(row.code) || id,
      description,
      stringValue(row.unit) || "KG",
      booleanToSql(row.is_active, true),
      updatedAt,
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

function upsertCloudOperations(
  database: DesktopDatabase,
  settings: CloudSettings,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO weighing_operations (
      id, company_id, unit_id, device_id, status, operation_type, customer_id, vehicle_id, driver_id,
      product_id, payment_term_id, entry_weight_kg, entry_weight_captured_at, exit_weight_kg,
      exit_weight_captured_at, net_weight_kg, unit_price_cents, product_total_cents,
      freight_total_cents, total_cents, freight_json, omie_sales_order_id, omie_service_order_id,
      cloud_synced_at, cancel_reason, created_at, updated_at, base_unit_price_cents,
      applied_price_table_id, applied_price_table_name, applied_price_table_item_id, price_unit,
      price_savings_percent, deduct_freight_from_credit, product_credit_debit_cents,
      freight_credit_debit_cents, quotation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      unit_id = excluded.unit_id,
      device_id = excluded.device_id,
      status = excluded.status,
      operation_type = excluded.operation_type,
      customer_id = excluded.customer_id,
      product_id = excluded.product_id,
      payment_term_id = excluded.payment_term_id,
      entry_weight_kg = excluded.entry_weight_kg,
      entry_weight_captured_at = excluded.entry_weight_captured_at,
      exit_weight_kg = excluded.exit_weight_kg,
      exit_weight_captured_at = excluded.exit_weight_captured_at,
      net_weight_kg = excluded.net_weight_kg,
      unit_price_cents = excluded.unit_price_cents,
      product_total_cents = excluded.product_total_cents,
      freight_total_cents = excluded.freight_total_cents,
      total_cents = excluded.total_cents,
      freight_json = excluded.freight_json,
      omie_sales_order_id = excluded.omie_sales_order_id,
      omie_service_order_id = excluded.omie_service_order_id,
      cloud_synced_at = excluded.cloud_synced_at,
      cancel_reason = excluded.cancel_reason,
      updated_at = excluded.updated_at,
      base_unit_price_cents = excluded.base_unit_price_cents,
      applied_price_table_id = excluded.applied_price_table_id,
      applied_price_table_name = excluded.applied_price_table_name,
      applied_price_table_item_id = excluded.applied_price_table_item_id,
      price_unit = excluded.price_unit,
      price_savings_percent = excluded.price_savings_percent,
      deduct_freight_from_credit = excluded.deduct_freight_from_credit,
      product_credit_debit_cents = excluded.product_credit_debit_cents,
      freight_credit_debit_cents = excluded.freight_credit_debit_cents,
      quotation_id = excluded.quotation_id
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    const closedAt = isoStringValue(row.closed_at);
    const customerId = existingId(database, "customers", row.customer_id);
    const productId = existingId(database, "products", row.product_id);
    upsert.run(
      id,
      settings.companyId,
      settings.unitId,
      stringValue(row.device_id) || settings.deviceId,
      mapCloudOperationStatus(row.status),
      mapCloudOperationType(row.operation_type),
      customerId,
      productId,
      nullableStringValue(row.payment_term_id),
      numberValue(row.entry_weight_kg),
      isoStringValue(row.created_at) || updatedAt,
      numberValue(row.exit_weight_kg),
      closedAt,
      numberValue(row.net_weight_kg),
      integerValue(row.unit_price_cents),
      integerValue(row.product_total_cents),
      integerValue(row.freight_total_cents) ?? 0,
      integerValue(row.total_cents),
      jsonStringValue(row.freight_json),
      integerValue(row.omie_sales_order_id),
      integerValue(row.omie_service_order_id),
      isoStringValue(row.synced_at) || updatedAt,
      nullableStringValue(row.cancel_reason),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      integerValue(row.base_unit_price_cents),
      nullableStringValue(row.applied_price_table_id),
      nullableStringValue(row.applied_price_table_name),
      nullableStringValue(row.applied_price_table_item_id),
      stringValue(row.price_unit) || "ton",
      numberValue(row.price_savings_percent),
      booleanToSql(row.deduct_freight_from_credit, false),
      integerValue(row.product_credit_debit_cents) ?? 0,
      integerValue(row.freight_credit_debit_cents) ?? 0,
      existingId(database, "quotations", row.quotation_id)
    );
    count++;
  }
  return count;
}

function upsertCloudLoadingRequests(
  database: DesktopDatabase,
  settings: CloudSettings,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO loading_requests (
      id, operation_id, company_id, unit_id, status, plate, customer_name, driver_name,
      product_description, created_at, updated_at, closed_at, loader_completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation_id = excluded.operation_id,
      company_id = excluded.company_id,
      unit_id = excluded.unit_id,
      status = excluded.status,
      plate = excluded.plate,
      customer_name = excluded.customer_name,
      driver_name = excluded.driver_name,
      product_description = excluded.product_description,
      updated_at = excluded.updated_at,
      closed_at = excluded.closed_at,
      loader_completed_at = excluded.loader_completed_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const operationId = existingId(database, "weighing_operations", row.operation_id);
    if (!id || !operationId) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      operationId,
      settings.companyId,
      settings.unitId,
      mapLoadingRequestStatus(row.status),
      stringValue(row.plate) || "SEMPLACA",
      stringValue(row.customer_name) || "Cliente",
      stringValue(row.driver_name) || "Motorista",
      stringValue(row.product_description) || "Produto",
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      isoStringValue(row.closed_at),
      isoStringValue(row.loader_completed_at)
    );
    count++;
  }
  return count;
}

function upsertCloudPrintReceipts(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO print_receipts (
      id, operation_id, unit_id, receipt_number, copy_number, content_snapshot_json, printed_at,
      printer_name, status, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation_id = excluded.operation_id,
      unit_id = excluded.unit_id,
      receipt_number = excluded.receipt_number,
      copy_number = excluded.copy_number,
      content_snapshot_json = excluded.content_snapshot_json,
      printed_at = excluded.printed_at,
      printer_name = excluded.printer_name,
      status = excluded.status,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const operationId = existingId(database, "weighing_operations", row.operation_id);
    const unitId = stringValue(row.unit_id);
    if (!id || !operationId || !unitId) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      operationId,
      unitId,
      integerValue(row.receipt_number) ?? 0,
      integerValue(row.copy_number) ?? 1,
      jsonStringValue(row.content_snapshot_json) ?? "{}",
      isoStringValue(row.printed_at) || updatedAt,
      stringValue(row.printer_name) || "",
      stringValue(row.status) === "failed" ? "failed" : "printed",
      nullableStringValue(row.error_message),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

function mapCloudOperationStatus(value: unknown): string {
  const status = stringValue(value);
  if (status === "open") return "awaiting_exit";
  if (
    [
      "draft",
      "entry_registered",
      "loading_requested",
      "awaiting_exit",
      "closed_local",
      "pending_cloud",
      "pending_omie",
      "synced",
      "sync_error",
      "cancelled"
    ].includes(status)
  ) {
    return status;
  }
  return "awaiting_exit";
}

function mapCloudOperationType(value: unknown): "invoice" | "internal" {
  return stringValue(value) === "internal" ? "internal" : "invoice";
}

function mapLoadingRequestStatus(value: unknown): string {
  const status = stringValue(value);
  return status || "open";
}

function existingId(database: DesktopDatabase, table: string, value: unknown): string | null {
  const id = nullableStringValue(value);
  if (!id) return null;
  const row = database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStringValue(value: unknown): string | null {
  const text = stringValue(value);
  return text || null;
}

function isoStringValue(value: unknown): string | null {
  const text = nullableStringValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function booleanToSql(value: unknown, fallback: boolean): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value === 0 ? 0 : 1;
  return fallback ? 1 : 0;
}

function jsonStringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

const CLOUD_SYNC_JOB_ORDER: Record<string, number> = {
  upsert_customer: 0,
  upsert_product: 1,
  upsert_operation: 2,
  upsert_loading_request: 3,
  upsert_print_receipt: 4
};

function orderCloudSyncJobsTopologically<
  T extends { action: string; createdAt: string; id: string }
>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const orderDiff =
      (CLOUD_SYNC_JOB_ORDER[a.action] ?? 99) - (CLOUD_SYNC_JOB_ORDER[b.action] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function syncCustomerToSupabase(
  database: DesktopDatabase,
  customerId: string
): Promise<boolean> {
  const settings = getCloudSettings(database);
  const customer = database
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(customerId) as Record<string, unknown> | undefined;
  if (!customer) throw new Error(`Customer ${customerId} not found`);
  await invokeDesktopSync(settings, {
    customers: [
      {
        id: String(customer.id),
        company_id: settings.companyId,
        omie_customer_id: customer.omie_customer_id,
        legal_name: customer.legal_name,
        trade_name: customer.trade_name,
        document: customer.document,
        phone: customer.phone,
        email: customer.email,
        credit_limit_cents: customer.credit_limit_cents,
        open_receivables_cents: customer.open_receivables_cents,
        is_active: Boolean(customer.is_active ?? true),
        updated_at: new Date().toISOString()
      }
    ]
  });
  return true;
}

export async function syncProductToSupabase(
  database: DesktopDatabase,
  productId: string
): Promise<boolean> {
  const settings = getCloudSettings(database);
  const product = database
    .prepare("SELECT * FROM products WHERE id = ?")
    .get(productId) as Record<string, unknown> | undefined;
  if (!product) throw new Error(`Product ${productId} not found`);
  await invokeDesktopSync(settings, {
    products: [
      {
        id: String(product.id),
        company_id: settings.companyId,
        omie_product_id: product.omie_product_id,
        code: product.code,
        description: product.description,
        unit: product.unit,
        is_active: Boolean(product.is_active ?? true),
        updated_at: new Date().toISOString()
      }
    ]
  });
  return true;
}

export async function getSupabaseSyncStatus(
  companyId: string
): Promise<{ totalOperations: number; lastSync: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error, count } = await supabase
    .from("weighing_operations")
    .select("synced_at", { count: "exact" })
    .eq("company_id", companyId)
    .order("synced_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return { totalOperations: count ?? 0, lastSync: data?.[0]?.synced_at ?? null };
}

const OMIE_SYNC_REDUNDANT_MAX_RETRIES = 2;
const OMIE_SYNC_REDUNDANT_DEFAULT_WAIT_MS = 60_000;
const OMIE_SYNC_REDUNDANT_MAX_WAIT_MS = 65_000;

function isOmieSyncRedundantError(message: string): boolean {
  return /REDUNDANT|Consumo redundante/i.test(message);
}

function parseOmieSyncRedundantWaitMs(message: string): number {
  const match = /Aguarde\s+(\d+)\s+segundos?/i.exec(message);
  const seconds = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return OMIE_SYNC_REDUNDANT_DEFAULT_WAIT_MS;
  return Math.min(seconds * 1000 + 1000, OMIE_SYNC_REDUNDANT_MAX_WAIT_MS);
}

export async function syncOmieReferenceDataFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { reset?: boolean } = {}
): Promise<OmieCloudSyncResult> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  if (options.reset) {
    writeOmiePullState(database, {
      customersPage: 1,
      productsPage: 1,
      paymentTermsPage: 1,
      suppliersPage: 1,
      customersFinished: false,
      productsFinished: false,
      paymentTermsFinished: false,
      suppliersFinished: false,
      inProgress: false
    });
  }
  const state = readOmiePullState(database);
  const body = {
    deviceId: settings.deviceId,
    deviceToken: settings.deviceToken,
    action: "pull_reference_data",
    resume: {
      customersPage: state.customersPage,
      productsPage: state.productsPage,
      paymentTermsPage: state.paymentTermsPage,
      customersFinished: state.customersFinished,
      productsFinished: state.productsFinished,
      paymentTermsFinished: state.paymentTermsFinished
    }
  };

  for (let attempt = 0; attempt <= OMIE_SYNC_REDUNDANT_MAX_RETRIES; attempt++) {
    const { data, error } = await supabase.functions.invoke<OmieReferenceDataResponse>(
      "omie-sync",
      { body }
    );

    if (error) {
      const message = await getFunctionErrorMessage(error);
      if (isOmieSyncRedundantError(message) && attempt < OMIE_SYNC_REDUNDANT_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, parseOmieSyncRedundantWaitMs(message)));
        continue;
      }
      throw new Error(message);
    }

    if (!data) throw new Error("Resposta OMIE vazia.");

    // Persistir com o MESMO company_id que as telas de cadastro consultam
    // (identidade local ativa). Usar o id da nuvem aqui deixaria os registros
    // invisiveis na UI caso as duas chaves divirjam.
    return applyOmieReferenceData(database, identity.companyId, data);
  }

  throw new Error("OMIE sync redundant retry exhausted.");
}

export interface OmieDocumentTypeOption {
  code: string;
  description: string;
}

// Busca as formas de pagamento (tipos de documento) do OMIE sob demanda, para
// o seletor de "Codigo OMIE" das formas de pagamento locais. Nao persiste nada:
// o codigo escolhido e gravado na propria forma de pagamento.
export async function listOmieDocumentTypesFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<OmieDocumentTypeOption[]> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const body = {
    deviceId: settings.deviceId,
    deviceToken: settings.deviceToken,
    action: "list_document_types"
  };

  for (let attempt = 0; attempt <= OMIE_SYNC_REDUNDANT_MAX_RETRIES; attempt++) {
    const { data, error } = await supabase.functions.invoke<{
      documentTypes?: OmieDocumentTypeOption[];
    }>("omie-sync", { body });

    if (error) {
      const message = await getFunctionErrorMessage(error);
      if (isOmieSyncRedundantError(message) && attempt < OMIE_SYNC_REDUNDANT_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, parseOmieSyncRedundantWaitMs(message)));
        continue;
      }
      throw new Error(message);
    }

    if (!data) throw new Error("Resposta OMIE vazia.");
    return data.documentTypes ?? [];
  }

  throw new Error("OMIE sync redundant retry exhausted.");
}

export function applyOmieReferenceData(
  database: DesktopDatabase,
  companyId: string,
  data: OmieReferenceDataResponse
): OmieCloudSyncResult {
  const customers = data.customers ?? [];
  const products = data.products ?? [];
  const suppliers = data.suppliers ?? [];
  const paymentTerms = data.paymentTerms ?? [];
  const pagination = data.pagination;

  // Contadores refletem linhas realmente gravadas no SQLite (nao o tamanho do payload),
  // para o log de sync nao reportar sucesso quando nada ficou visivel nas telas.
  let customersPersisted = 0;
  let productsSynced = 0;
  // As condicoes locais (payment_terms) continuam sendo cadastradas manualmente; aqui
  // apenas espelhamos os codigos de parcela do OMIE (omie_payment_terms) para vinculo.
  let paymentTermsPersisted = 0;
  let suppliersPersisted = 0;
  const apply = database.transaction(() => {
    customersPersisted = upsertOmieCustomers(database, companyId, customers);
    productsSynced = upsertOmieProducts(database, companyId, products);
    suppliersPersisted = upsertOmieSuppliers(database, companyId, suppliers);
    paymentTermsPersisted = upsertOmiePaymentTerms(database, companyId, paymentTerms);
  });
  apply();

  if (pagination) {
    const pageSize = data.pageSize ?? 100;
    const isFinished = (
      page: number,
      returned: number,
      flag: boolean | undefined,
      totalPages: number | null | undefined
    ): boolean => {
      if (typeof flag === "boolean") return flag;
      if (returned === 0) return true;
      if (typeof totalPages === "number" && totalPages > 0) return page >= totalPages;
      return returned < pageSize;
    };
    const finished = {
      customers: isFinished(
        pagination.customersPage,
        pagination.customersReturned,
        pagination.customersFinished,
        pagination.customersTotalPages
      ),
      products: isFinished(
        pagination.productsPage,
        pagination.productsReturned,
        pagination.productsFinished,
        pagination.productsTotalPages
      ),
      paymentTerms: isFinished(
        pagination.paymentTermsPage,
        pagination.paymentTermsReturned,
        pagination.paymentTermsFinished,
        pagination.paymentTermsTotalPages
      ),
      suppliers: isFinished(
        pagination.suppliersPage ?? pagination.customersPage,
        pagination.suppliersReturned ?? 0,
        pagination.suppliersFinished,
        pagination.suppliersTotalPages ?? pagination.customersTotalPages
      )
    };
    const current = readOmiePullState(database);
    writeOmiePullState(database, {
      inProgress:
        !finished.customers || !finished.products || !finished.paymentTerms,
      customersPage: !finished.customers
        ? Math.max(pagination.customersPage + 1, current.customersPage)
        : 1,
      productsPage: !finished.products
        ? Math.max(pagination.productsPage + 1, current.productsPage)
        : 1,
      paymentTermsPage: !finished.paymentTerms
        ? Math.max(pagination.paymentTermsPage + 1, current.paymentTermsPage)
        : 1,
      suppliersPage: !finished.customers
        ? Math.max(pagination.customersPage + 1, current.suppliersPage)
        : 1,
      customersFinished: finished.customers,
      productsFinished: finished.products,
      paymentTermsFinished: finished.paymentTerms,
      suppliersFinished: finished.customers
    });
  } else {
    writeOmiePullState(database, {
      customersPage: 1,
      productsPage: 1,
      paymentTermsPage: 1,
      suppliersPage: 1,
      customersFinished: true,
      productsFinished: true,
      paymentTermsFinished: true,
      suppliersFinished: true,
      inProgress: false
    });
  }

  return {
    customersPulled: customersPersisted,
    customersPushed: 0,
    productsSynced,
    paymentTermsSynced: paymentTermsPersisted,
    suppliersSynced: suppliersPersisted,
    errors: []
  };
}

function getCloudSettings(
  database: DesktopDatabase,
  identity?: LocalDesktopIdentity
): CloudSettings {
  const settings = database
    .prepare(
      "SELECT key, value_json FROM local_settings WHERE key IN ('cloud_company_id', 'cloud_unit_id', 'cloud_device_id', 'cloud_device_token')"
    )
    .all() as Array<{ key: string; value_json: string }>;
  const map = new Map(settings.map((row) => [row.key, JSON.parse(row.value_json) as string]));
  const companyId = map.get("cloud_company_id") || identity?.companyId || "";
  const unitId = map.get("cloud_unit_id") || identity?.unitId || "";
  const deviceId = map.get("cloud_device_id") || identity?.deviceId || "";
  const deviceToken = map.get("cloud_device_token") || "";
  if (!companyId || !unitId || !deviceId || !deviceToken) {
    throw new Error(
      "Supabase cloud nao configurado. Configure company/unit/device/token do dispositivo."
    );
  }
  return { companyId, unitId, deviceId, deviceToken };
}

function getOperationPayload(
  database: DesktopDatabase,
  operationId: string,
  settings: CloudSettings
): Record<string, unknown> {
  const operation = database
    .prepare(
      `SELECT
    o.*, c.trade_name AS customer_name, v.plate, d.name AS driver_name, p.description AS product_description
    FROM weighing_operations o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id
    LEFT JOIN drivers d ON d.id = o.driver_id
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.id = ?`
    )
    .get(operationId) as Record<string, unknown> | undefined;
  if (!operation) throw new Error(`Operation ${operationId} not found`);
  return {
    id: operation.id,
    company_id: settings.companyId,
    unit_id: settings.unitId,
    device_id: settings.deviceId,
    status:
      operation.status === "loading_requested" || operation.status === "awaiting_exit"
        ? "open"
        : operation.status,
    operation_type: operation.operation_type,
    customer_id: operation.customer_id,
    product_id: operation.product_id,
    payment_term_id: operation.payment_term_id,
    plate: operation.plate,
    customer_name: operation.customer_name,
    driver_name: operation.driver_name,
    product_description: operation.product_description,
    entry_weight_kg: operation.entry_weight_kg,
    exit_weight_kg: operation.exit_weight_kg,
    net_weight_kg: operation.net_weight_kg,
    unit_price_cents: operation.unit_price_cents,
    base_unit_price_cents: operation.base_unit_price_cents,
    applied_price_table_id: operation.applied_price_table_id,
    applied_price_table_name: operation.applied_price_table_name,
    applied_price_table_item_id: operation.applied_price_table_item_id,
    price_unit: operation.price_unit,
    price_savings_percent: operation.price_savings_percent,
    product_total_cents: operation.product_total_cents,
    freight_total_cents: operation.freight_total_cents,
    total_cents: operation.total_cents,
    omie_sales_order_id: operation.omie_sales_order_id,
    omie_service_order_id: operation.omie_service_order_id,
    cancel_reason: operation.cancel_reason,
    created_at: operation.created_at,
    updated_at: operation.updated_at,
    closed_at: operation.exit_weight_captured_at,
    synced_at: new Date().toISOString()
  };
}

function getLoadingRequestPayload(
  database: DesktopDatabase,
  requestId: string,
  settings: CloudSettings
): Record<string, unknown> & { customer_id: string | null; product_id: string | null } {
  const request = database
    .prepare(
      `SELECT
    lr.*,
    o.entry_weight_kg,
    o.customer_id AS operation_customer_id,
    o.product_id AS operation_product_id
    FROM loading_requests lr
    LEFT JOIN weighing_operations o ON o.id = lr.operation_id
    WHERE lr.id = ?`
    )
    .get(requestId) as
    | (Record<string, unknown> & {
        operation_customer_id: string | null;
        operation_product_id: string | null;
      })
    | undefined;
  if (!request) throw new Error(`Loading request ${requestId} not found`);
  return {
    id: request.id,
    operation_id: request.operation_id,
    company_id: settings.companyId,
    unit_id: settings.unitId,
    status: request.status,
    plate: request.plate,
    customer_name: request.customer_name,
    driver_name: request.driver_name,
    product_description: request.product_description,
    customer_id: request.operation_customer_id ?? null,
    product_id: request.operation_product_id ?? null,
    entry_weight_kg: request.entry_weight_kg,
    created_at: request.created_at,
    updated_at: request.updated_at,
    closed_at: request.closed_at
  };
}

export async function pushOmieCustomersToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { limit?: number; delayMs?: number } = {}
): Promise<{ pushed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const limit = options.limit ?? OMIE_PUSH_CUSTOMER_BATCH_LIMIT;
  const delayMs = options.delayMs ?? OMIE_BATCH_DELAY_MS;

  const pending = database
    .prepare(
      `SELECT id, omie_customer_id, legal_name, trade_name, document, phone, email,
              zipcode, address_street, address_number, address_complement, neighborhood, city, state,
              default_payment_term_id
       FROM customers
       WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1 AND source IN ('local', 'hybrid')
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .all(identity.companyId, limit) as Array<{
    id: string;
    omie_customer_id: number | null;
    legal_name: string;
    trade_name: string;
    document: string | null;
    phone: string | null;
    email: string | null;
    zipcode: string | null;
    address_street: string | null;
    address_number: string | null;
    address_complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    default_payment_term_id: string | null;
  }>;

  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];
  const setOmieId = database.prepare(`
    UPDATE customers
    SET omie_customer_id = ?, needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
    WHERE id = ?
  `);
  const markSynced = database.prepare(`
    UPDATE customers
    SET needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
    WHERE id = ?
  `);
  const markError = database.prepare(`
    UPDATE customers
    SET sync_status = 'error', updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const [index, customer] of pending.entries()) {
    try {
      const phoneMatch = customer.phone?.match(/\(?(\d{2})\)?\s*(\d+)/);
      const { data, error } = await supabase.functions.invoke<{ omieCustomerId?: number }>(
        "omie-sync",
        {
          body: {
            deviceId: settings.deviceId,
            deviceToken: settings.deviceToken,
            action: "push_customer",
            payload: {
              localCustomerId: customer.id,
              omieCustomerId: customer.omie_customer_id ?? undefined,
              razaoSocial: customer.legal_name,
              nomeFantasia: customer.trade_name || customer.legal_name,
              cnpjCpf: customer.document ?? undefined,
              email: customer.email ?? undefined,
              telefone1Ddd: phoneMatch?.[1] ?? undefined,
              telefone1Numero: phoneMatch?.[2] ?? undefined,
              zipcode: customer.zipcode ?? undefined,
              addressStreet: customer.address_street ?? undefined,
              addressNumber: customer.address_number ?? undefined,
              neighborhood: customer.neighborhood ?? undefined,
              city: customer.city ?? undefined,
              state: customer.state ?? undefined,
              defaultPaymentTermId: customer.default_payment_term_id ?? undefined
            }
          }
        }
      );

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }
      if (!data?.omieCustomerId) {
        throw new Error("OMIE nao retornou omieCustomerId");
      }

      if (customer.omie_customer_id) {
        markSynced.run(customer.id);
      } else {
        setOmieId.run(data.omieCustomerId, customer.id);
      }
      pushed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro OMIE";
      markError.run(customer.id);
      failed++;
      errors.push(`Cliente ${customer.id}: ${message}`);
    }

    if (index < pending.length - 1) {
      await sleep(delayMs);
    }
  }

  return { pushed, failed, errors };
}

export async function pushOmieCarriersToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { limit?: number; delayMs?: number } = {}
): Promise<{ pushed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const limit = options.limit ?? OMIE_PUSH_CUSTOMER_BATCH_LIMIT;
  const delayMs = options.delayMs ?? OMIE_BATCH_DELAY_MS;

  const pending = database
    .prepare(
      `SELECT id, omie_customer_id, name, document, phone, email,
              zipcode, address_street, address_number, address_complement, neighborhood, city, state
       FROM carriers
       WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1 AND source = 'local'
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .all(identity.companyId, limit) as Array<{
    id: string;
    omie_customer_id: number | null;
    name: string;
    document: string | null;
    phone: string | null;
    email: string | null;
    zipcode: string | null;
    address_street: string | null;
    address_number: string | null;
    address_complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
  }>;

  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];
  const setOmieId = database.prepare(`
    UPDATE carriers
    SET omie_customer_id = ?, needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
    WHERE id = ?
  `);
  const markSynced = database.prepare(`
    UPDATE carriers
    SET needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
    WHERE id = ?
  `);
  const markError = database.prepare(`
    UPDATE carriers
    SET sync_status = 'error', updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const [index, carrier] of pending.entries()) {
    try {
      const phoneMatch = carrier.phone?.match(/\(?(\d{2})\)?\s*(\d+)/);
      const { data, error } = await supabase.functions.invoke<{ omieCustomerId?: number }>(
        "omie-sync",
        {
          body: {
            deviceId: settings.deviceId,
            deviceToken: settings.deviceToken,
            action: "push_customer",
            payload: {
              localCustomerId: `carrier:${carrier.id}`,
              omieCustomerId: carrier.omie_customer_id ?? undefined,
              razaoSocial: carrier.name,
              nomeFantasia: carrier.name,
              cnpjCpf: carrier.document ?? undefined,
              email: carrier.email ?? undefined,
              telefone1Ddd: phoneMatch?.[1] ?? undefined,
              telefone1Numero: phoneMatch?.[2] ?? undefined,
              zipcode: carrier.zipcode ?? undefined,
              addressStreet: carrier.address_street ?? undefined,
              addressNumber: carrier.address_number ?? undefined,
              neighborhood: carrier.neighborhood ?? undefined,
              city: carrier.city ?? undefined,
              state: carrier.state ?? undefined,
              tags: ["transportadora"]
            }
          }
        }
      );

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }
      if (!data?.omieCustomerId) {
        throw new Error("OMIE nao retornou omieCustomerId");
      }

      if (carrier.omie_customer_id) {
        markSynced.run(carrier.id);
      } else {
        setOmieId.run(data.omieCustomerId, carrier.id);
      }
      pushed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro OMIE";
      markError.run(carrier.id);
      failed++;
      errors.push(`Transportadora ${carrier.id}: ${message}`);
    }

    if (index < pending.length - 1) {
      await sleep(delayMs);
    }
  }

  return { pushed, failed, errors };
}

function getPrintReceiptPayload(
  database: DesktopDatabase,
  receiptId: string,
  settings: CloudSettings
): Record<string, unknown> {
  const receipt = database.prepare("SELECT * FROM print_receipts WHERE id = ?").get(receiptId) as
    | Record<string, unknown>
    | undefined;
  if (!receipt) throw new Error(`Print receipt ${receiptId} not found`);
  return {
    id: receipt.id,
    operation_id: receipt.operation_id,
    unit_id: settings.unitId,
    receipt_number: receipt.receipt_number,
    copy_number: receipt.copy_number,
    content_snapshot_json: parseJsonValue(receipt.content_snapshot_json),
    printed_at: receipt.printed_at,
    printer_name: receipt.printer_name,
    status: receipt.status,
    error_message: receipt.error_message,
    created_at: receipt.created_at,
    updated_at: receipt.updated_at
  };
}

function getOperationForReceipt(
  database: DesktopDatabase,
  receiptId: string
): { customer_id: string | null; product_id: string | null } | null {
  const row = database
    .prepare(
      `SELECT o.customer_id, o.product_id
       FROM print_receipts pr
       JOIN weighing_operations o ON o.id = pr.operation_id
       WHERE pr.id = ?`
    )
    .get(receiptId) as { customer_id: string | null; product_id: string | null } | undefined;
  return row ?? null;
}

function getCustomerPayload(
  database: DesktopDatabase,
  customerId: string,
  companyId: string
): Record<string, unknown> | null {
  const customer = database.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
    | Record<string, unknown>
    | undefined;
  if (!customer) return null;
  return {
    id: String(customer.id),
    company_id: companyId,
    omie_customer_id: customer.omie_customer_id ?? null,
    omie_integration_code: customer.omie_integration_code ?? null,
    legal_name: customer.legal_name,
    trade_name: customer.trade_name,
    document: customer.document ?? null,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    credit_limit_cents: customer.credit_limit_cents ?? null,
    open_receivables_cents: customer.open_receivables_cents ?? 0,
    is_active: Boolean(customer.is_active ?? true),
    default_payment_term_id: customer.default_payment_term_id ?? null,
    updated_at: new Date().toISOString()
  };
}

function getProductPayload(
  database: DesktopDatabase,
  productId: string,
  companyId: string
): Record<string, unknown> | null {
  const product = database.prepare("SELECT * FROM products WHERE id = ?").get(productId) as
    | Record<string, unknown>
    | undefined;
  if (!product) return null;
  return {
    id: String(product.id),
    company_id: companyId,
    omie_product_id: product.omie_product_id ?? null,
    code: product.code,
    description: product.description,
    unit: product.unit,
    is_active: Boolean(product.is_active ?? true),
    updated_at: new Date().toISOString()
  };
}

function collectCloudSyncDependencies(
  database: DesktopDatabase,
  references: { customer_id?: string | null; product_id?: string | null }
): { customers: Record<string, unknown>[]; products: Record<string, unknown>[] } {
  const companyId = readLocalSetting<string>(database, "cloud_company_id");
  const customers: Record<string, unknown>[] = [];
  const products: Record<string, unknown>[] = [];

  if (!companyId) {
    return { customers, products };
  }

  if (references.customer_id) {
    const customer = getCustomerPayload(database, references.customer_id, companyId);
    if (customer) customers.push(customer);
  }
  if (references.product_id) {
    const product = getProductPayload(database, references.product_id, companyId);
    if (product) products.push(product);
  }

  return { customers, products };
}

function getPayloadId(payload: unknown, key: string, fallback: string): string {
  if (payload && typeof payload === "object" && key in payload) {
    return String((payload as Record<string, unknown>)[key] ?? fallback);
  }
  return fallback;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function reconcileCancelledAfterCreate(
  database: DesktopDatabase,
  operationId: string,
  orderId: number,
  operationType: "invoice" | "internal"
): void {
  const row = database
    .prepare("SELECT status, cancel_reason FROM weighing_operations WHERE id = ?")
    .get(operationId) as { status: string; cancel_reason: string | null } | undefined;
  if (!row || row.status !== "cancelled") return;

  // O update de sucesso do create sobrescreveu o status; devolve para 'cancelled'.
  database
    .prepare("UPDATE weighing_operations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
    .run(operationId);

  enqueueSyncJob(database, {
    target: "omie",
    action: "cancel_order",
    entityType: "weighing_operation",
    entityId: operationId,
    idempotencyKey: `omie:cancel:${operationId}`,
    payload: {
      operationId,
      orderType: operationType === "invoice" ? "sales" : "service",
      omieOrderId: orderId,
      reason: row.cancel_reason ?? "Operacao cancelada localmente."
    }
  });
}

async function processOmieCancelJob(
  database: DesktopDatabase,
  supabase: SupabaseClient,
  settings: CloudSettings,
  job: { id: string; payload: unknown }
): Promise<"processed" | "failed"> {
  const payload = job.payload as {
    operationId: string;
    orderType: "sales" | "service";
    omieOrderId: number;
    reason?: string;
  };

  try {
    const { data, error } = await supabase.functions.invoke<{
      cancelled?: boolean;
      alreadyCancelled?: boolean;
      blocked?: boolean;
      blockedReason?: string | null;
    }>("omie-sync", {
      body: {
        deviceId: settings.deviceId,
        deviceToken: settings.deviceToken,
        action: "cancel_order",
        payload: {
          operationId: payload.operationId,
          orderType: payload.orderType,
          omieOrderId: payload.omieOrderId,
          reason: payload.reason
        }
      }
    });

    if (error) {
      throw new Error(await getFunctionErrorMessage(error));
    }

    if (data?.blocked) {
      // Pedido faturado ou em estado que impede exclusao: mantem operacao cancelada
      // localmente com o erro visivel, sem retry (docs/phase-1/sync-strategy.md).
      database
        .prepare(
          `UPDATE weighing_operations
           SET omie_billing_status = 'cancel_blocked',
               omie_billing_message = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(data.blockedReason ?? "Cancelamento negado pelo OMIE.", payload.operationId);
      markSyncJobDone(database, job.id);
      return "processed";
    }

    // cancelled ou alreadyCancelled: registra o cancelamento no OMIE.
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'cancelled_in_omie',
             omie_billing_message = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        data?.alreadyCancelled ? "Pedido ja nao existia no OMIE." : "Pedido cancelado no OMIE.",
        payload.operationId
      );
    markSyncJobDone(database, job.id);
    return "processed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro OMIE";
    markSyncJobFailed(database, job.id, message);
    return "failed";
  }
}

export async function processOmieSyncQueue(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { limit?: number; delayMs?: number } = {}
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const limit = options.limit ?? OMIE_QUEUE_BATCH_LIMIT;
  const delayMs = options.delayMs ?? OMIE_BATCH_DELAY_MS;
  const jobs = listRunnableSyncJobs(database, { target: "omie", limit });
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const [index, job] of jobs.entries()) {
    if (job.action === "cancel_order") {
      const outcome = await processOmieCancelJob(database, supabase, settings, job);
      if (outcome === "processed") processed++;
      else {
        failed++;
        errors.push(`Job ${job.id}: falha ao cancelar pedido OMIE`);
      }
      if (index < jobs.length - 1) {
        await sleep(delayMs);
      }
      continue;
    }

    const payload = job.payload as {
      operationId: string;
      operationType: "invoice" | "internal";
      customerOmieId: number;
      productOmieId?: number | null;
      serviceDescription?: string | null;
      quantity: number;
      unitPrice: number;
      freightTotalCents?: number;
      issueDate: string;
      paymentTermOmieCode?: string | null;
      paymentTermInstallmentCount?: number | null;
      paymentMethodOmieCode?: string | null;
      accountOmieCode?: string | null;
    };

    try {
      const bridgeAction =
        job.action === "create_and_bill_order" ? "create_and_bill_order" : "create_order";
      const { data, error } = await supabase.functions.invoke<{
        orderId?: number;
        billed?: boolean;
        billingStatusCode?: string | null;
        billingStatusMessage?: string | null;
        documentUrl?: string | null;
      }>("omie-sync", {
        body: {
          deviceId: settings.deviceId,
          deviceToken: settings.deviceToken,
          action: bridgeAction,
          payload: {
            operationType: payload.operationType,
            customerOmieId: payload.customerOmieId,
            productOmieId: payload.productOmieId ?? undefined,
            serviceDescription: payload.serviceDescription ?? undefined,
            quantity: payload.quantity,
            unitPrice: payload.unitPrice,
            freightTotalCents: payload.freightTotalCents,
            issueDate: payload.issueDate,
            paymentTermOmieCode: payload.paymentTermOmieCode ?? undefined,
            installmentCount: payload.paymentTermInstallmentCount ?? undefined,
            paymentMethodOmieCode: payload.paymentMethodOmieCode ?? undefined,
            accountOmieCode: payload.accountOmieCode ?? undefined,
            idempotencyKey: job.idempotencyKey
          }
        }
      });

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }
      if (!data?.orderId) {
        throw new Error("OMIE nao retornou orderId");
      }

      const updateSql =
        payload.operationType === "invoice"
          ? `UPDATE weighing_operations
           SET omie_sales_order_id = ?,
               omie_billing_status = CASE WHEN ? THEN 'billed' ELSE omie_billing_status END,
               omie_billing_message = CASE WHEN ? THEN ? ELSE omie_billing_message END,
               omie_billed_at = CASE WHEN ? THEN datetime('now') ELSE omie_billed_at END,
               omie_document_url = COALESCE(?, omie_document_url),
               status = 'synced',
               omie_synced_at = datetime('now'),
               updated_at = datetime('now')
           WHERE id = ?`
          : "UPDATE weighing_operations SET omie_service_order_id = ?, status = 'synced', omie_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?";

      if (payload.operationType === "invoice") {
        const billed = data.billed === true;
        database
          .prepare(updateSql)
          .run(
            data.orderId,
            billed ? 1 : 0,
            billed ? 1 : 0,
            data.billingStatusMessage ?? "Pedido faturado no OMIE.",
            billed ? 1 : 0,
            data.documentUrl ?? null,
            payload.operationId
          );
      } else {
        database.prepare(updateSql).run(data.orderId, payload.operationId);
      }
      markSyncJobDone(database, job.id);
      // Corrida create x cancel: se a operacao foi cancelada localmente enquanto o pedido
      // era criado, o update acima marcou 'synced' por engano. Restaura o cancelamento e
      // solicita o cancelamento do pedido recem-criado no OMIE.
      reconcileCancelledAfterCreate(database, payload.operationId, data.orderId, payload.operationType);
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro OMIE";
      // Falha deterministica de cadastro/NF-e no faturamento: bloqueia (para o retry storm de
      // ~10x/min) e marca a pendencia na operacao. Continua re-executavel via processFiscalBillingNow.
      if (job.action === "create_and_bill_order" && isCadastroIncompleteFault(message)) {
        markSyncJobBlocked(database, job.id, message);
        const blockedOperationId = (job.payload as { operationId?: string })?.operationId;
        if (blockedOperationId) {
          database
            .prepare(
              `UPDATE weighing_operations
               SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = datetime('now')
               WHERE id = ?`
            )
            .run(message, blockedOperationId);
        }
      } else {
        markSyncJobFailed(database, job.id, message);
      }
      failed++;
      errors.push(`Job ${job.id}: ${message}`);
    }

    if (index < jobs.length - 1) {
      await sleep(delayMs);
    }
  }

  return { processed, failed, errors };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processFiscalBillingNow(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  operationId: string,
  printDocument: (
    documentUrl: string
  ) => Promise<{ printed: boolean; error: string | null }> = async () => ({
    printed: false,
    error: null
  })
): Promise<FiscalBillingResult> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();

  // Gate autoritativo: cadastro do cliente precisa estar completo para NF-e. Se nao estiver,
  // registra a pendencia e retorna bloqueado (sem chamar o OMIE, sem enfileirar job condenado).
  const readiness = validateOperationFiscalReadiness(database, operationId);
  if (!readiness.ready) {
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(readiness.message, operationId);
    return {
      orderId: null,
      billed: false,
      blocked: true,
      blockReason: readiness.message,
      billingStatusCode: null,
      billingStatusMessage: readiness.message,
      documentUrl: null,
      documentPrinted: false,
      documentPrintError: null
    };
  }

  const findBillingJob = () =>
    database
      .prepare(
        `SELECT * FROM sync_queue
         WHERE target = 'omie'
           AND action = 'create_and_bill_order'
           AND entity_id = ?
           AND status IN ('pending', 'failed')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(operationId) as
      | { id: string; idempotency_key: string; payload_json: string }
      | undefined;

  let job = findBillingJob();

  // A pre-validacao no fechamento pode ter deixado a operacao sem job de faturamento. Como o
  // cadastro agora esta completo, (re)constroi o job a partir da operacao e re-executa.
  if (!job) {
    const built = buildOmieBillingJob(database, operationId);
    if (built && built.action === "create_and_bill_order") {
      enqueueOmieBillingJob(database, operationId, built);
      job = findBillingJob();
    }
  }

  if (!job) {
    const reason =
      "Nao ha faturamento OMIE pendente para esta operacao fiscal (verifique se o cliente tem codigo OMIE).";
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(reason, operationId);
    return {
      orderId: null,
      billed: false,
      blocked: true,
      blockReason: reason,
      billingStatusCode: null,
      billingStatusMessage: reason,
      documentUrl: null,
      documentPrinted: false,
      documentPrintError: null
    };
  }

  const payload = parseJsonValue(job.payload_json) as {
    operationId: string;
    operationType: "invoice" | "internal";
    customerOmieId: number;
    productOmieId?: number | null;
    serviceDescription?: string | null;
    quantity: number;
    unitPrice: number;
    freightTotalCents?: number;
    issueDate: string;
    paymentTermOmieCode?: string | null;
    paymentTermInstallmentCount?: number | null;
    paymentMethodOmieCode?: string | null;
    accountOmieCode?: string | null;
  };

  if (payload.operationType !== "invoice") {
    throw new Error("Somente operacoes fiscais podem ser faturadas como pedido de venda.");
  }

  try {
    const { data, error } = await supabase.functions.invoke<{
      orderId?: number;
      billed?: boolean;
      billingStatusCode?: string | null;
      billingStatusMessage?: string | null;
      documentUrl?: string | null;
    }>("omie-sync", {
      body: {
        deviceId: settings.deviceId,
        deviceToken: settings.deviceToken,
        action: "create_and_bill_order",
        payload: {
          operationType: payload.operationType,
          customerOmieId: payload.customerOmieId,
          productOmieId: payload.productOmieId ?? undefined,
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
          freightTotalCents: payload.freightTotalCents,
          issueDate: payload.issueDate,
          paymentTermOmieCode: payload.paymentTermOmieCode ?? undefined,
          installmentCount: payload.paymentTermInstallmentCount ?? undefined,
          paymentMethodOmieCode: payload.paymentMethodOmieCode ?? undefined,
          accountOmieCode: payload.accountOmieCode ?? undefined,
          idempotencyKey: job.idempotency_key
        }
      }
    });

    if (error) {
      throw new Error(await getFunctionErrorMessage(error));
    }
    if (!data?.orderId || data.billed !== true) {
      throw new Error("OMIE nao confirmou o faturamento do pedido de venda.");
    }

    let documentPrinted = false;
    let documentPrintError: string | null = null;
    if (data.documentUrl) {
      const printed = await printDocument(data.documentUrl);
      documentPrinted = printed.printed;
      documentPrintError = printed.error;
    }

    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_sales_order_id = ?,
             omie_billing_status = 'billed',
             omie_billing_message = ?,
             omie_billed_at = datetime('now'),
             omie_document_url = COALESCE(?, omie_document_url),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        data.orderId,
        data.billingStatusMessage ?? "Pedido faturado no OMIE.",
        data.documentUrl ?? null,
        operationId
      );
    markSyncJobDone(database, job.id);

    return {
      orderId: data.orderId,
      billed: true,
      billingStatusCode: data.billingStatusCode ?? null,
      billingStatusMessage: data.billingStatusMessage ?? "Pedido faturado no OMIE.",
      documentUrl: data.documentUrl ?? null,
      documentPrinted,
      documentPrintError
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao faturar pedido no OMIE.";

    // Falha deterministica de cadastro/NF-e: nao adianta re-tentar automaticamente. Bloqueia o
    // job (re-executavel manualmente apos corrigir) e retorna pendencia clara — sem throw/storm.
    if (isCadastroIncompleteFault(message)) {
      markSyncJobBlocked(database, job.id, message);
      database
        .prepare(
          `UPDATE weighing_operations
           SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(message, operationId);
      return {
        orderId: null,
        billed: false,
        blocked: true,
        blockReason: message,
        billingStatusCode: null,
        billingStatusMessage: message,
        documentUrl: null,
        documentPrinted: false,
        documentPrintError: null
      };
    }

    markSyncJobFailed(database, job.id, message);
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'failed',
             omie_billing_message = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(message, operationId);
    throw new Error(
      `Nao foi possivel faturar no OMIE. Verifique a internet conectada e a configuracao da API OMIE. Detalhe: ${message}`
    );
  }
}

// Empurra os destinatarios de relatorio pendentes (needs_push) para o Supabase,
// para o envio automatico (daily-report-email) enxergar quem recebe o que.
// Destinatarios removidos localmente sao enviados como inativos.
export async function pushPendingReportRecipients(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<number> {
  const settings = getCloudSettings(database, identity);
  const rows = database
    .prepare(
      `SELECT * FROM report_recipients WHERE company_id = ? AND needs_push = 1
       ORDER BY updated_at ASC LIMIT 100`
    )
    .all(settings.companyId) as ReportRecipientRow[];
  if (rows.length === 0) return 0;

  const recipients = rows.map((row) => ({
    id: row.id,
    company_id: settings.companyId,
    email: row.email,
    whatsapp_phone: row.whatsapp_phone,
    send_email: row.send_email === 1,
    send_whatsapp: row.send_whatsapp === 1,
    schedule_frequency: row.schedule_frequency,
    schedule_time: row.schedule_time,
    report_types: row.report_types || "sales",
    display_name: row.display_name,
    is_active: row.is_active === 1 && row.deleted_at === null,
    updated_at: new Date().toISOString()
  }));

  try {
    await invokeDesktopSync(settings, { reportRecipients: recipients });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar destinatarios.";
    for (const row of rows) markRecipientSyncError(database, row.id, message);
    throw error;
  }

  for (const row of rows) markRecipientSynced(database, row.id);
  return rows.length;
}

async function invokeDesktopSync(
  settings: CloudSettings,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("desktop-sync", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken, ...payload }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = getErrorLikeMessage(error);
  const context =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: unknown }).context
      : null;

  if (!context || typeof context !== "object") {
    return fallback;
  }

  try {
    const clone =
      "clone" in context && typeof context.clone === "function" ? context.clone() : context;
    if (clone && typeof clone === "object" && "json" in clone && typeof clone.json === "function") {
      const body = await clone.json();
      if (body && typeof body === "object") {
        const candidate =
          (body as { error?: unknown; message?: unknown }).error ??
          (body as { error?: unknown; message?: unknown }).message;
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate;
        }
        return JSON.stringify(body);
      }
    }
  } catch {
    // Fall through to statusText/message fallback.
  }

  const statusText =
    "statusText" in context ? (context as { statusText?: unknown }).statusText : null;
  return typeof statusText === "string" && statusText.trim() ? statusText : fallback;
}

function getErrorLikeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate =
      (error as { error?: unknown; message?: unknown }).error ??
      (error as { error?: unknown; message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return "Erro desconhecido";
}

function upsertOmieCustomers(
  database: DesktopDatabase,
  companyId: string,
  customers: OmieReferenceCustomer[]
): number {
  const findLocalId = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND omie_customer_id = ? LIMIT 1"
  );
  const findByIntegrationCode = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND omie_integration_code = ? LIMIT 1"
  );
  const findByDocument = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND document = ? AND deleted_at IS NULL LIMIT 1"
  );
  const upsert = database.prepare(`
    INSERT INTO customers (
      id, company_id, omie_customer_id, omie_integration_code, source, legal_name, trade_name,
      document, state_registration, municipal_registration, is_individual,
      email, homepage, contact_name, phone, phone_secondary,
      zipcode, address_street, address_number, address_complement,
      neighborhood, city, state, country, country_code,
      ibge_city_code, ibge_state_code, customer_type, is_foreign,
      omie_billing_blocked, observations, tags_json, salesperson_id,
      default_payment_term_id, is_active, sync_status, last_synced_at,
      omie_updated_at, needs_push, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'omie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'), datetime('now'), 0, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_customer_id = excluded.omie_customer_id,
      omie_integration_code = excluded.omie_integration_code,
      legal_name = CASE WHEN customers.needs_push = 0 THEN excluded.legal_name ELSE customers.legal_name END,
      trade_name = CASE WHEN customers.needs_push = 0 THEN excluded.trade_name ELSE customers.trade_name END,
      document = CASE WHEN customers.needs_push = 0 THEN excluded.document ELSE customers.document END,
      state_registration = CASE WHEN customers.needs_push = 0 THEN excluded.state_registration ELSE customers.state_registration END,
      municipal_registration = CASE WHEN customers.needs_push = 0 THEN excluded.municipal_registration ELSE customers.municipal_registration END,
      is_individual = CASE WHEN customers.needs_push = 0 THEN excluded.is_individual ELSE customers.is_individual END,
      email = CASE WHEN customers.needs_push = 0 THEN excluded.email ELSE customers.email END,
      homepage = CASE WHEN customers.needs_push = 0 THEN excluded.homepage ELSE customers.homepage END,
      contact_name = CASE WHEN customers.needs_push = 0 THEN excluded.contact_name ELSE customers.contact_name END,
      phone = CASE WHEN customers.needs_push = 0 THEN excluded.phone ELSE customers.phone END,
      phone_secondary = CASE WHEN customers.needs_push = 0 THEN excluded.phone_secondary ELSE customers.phone_secondary END,
      zipcode = CASE WHEN customers.needs_push = 0 THEN excluded.zipcode ELSE customers.zipcode END,
      address_street = CASE WHEN customers.needs_push = 0 THEN excluded.address_street ELSE customers.address_street END,
      address_number = CASE WHEN customers.needs_push = 0 THEN excluded.address_number ELSE customers.address_number END,
      address_complement = CASE WHEN customers.needs_push = 0 THEN excluded.address_complement ELSE customers.address_complement END,
      neighborhood = CASE WHEN customers.needs_push = 0 THEN excluded.neighborhood ELSE customers.neighborhood END,
      city = CASE WHEN customers.needs_push = 0 THEN excluded.city ELSE customers.city END,
      state = CASE WHEN customers.needs_push = 0 THEN excluded.state ELSE customers.state END,
      country = CASE WHEN customers.needs_push = 0 THEN excluded.country ELSE customers.country END,
      country_code = CASE WHEN customers.needs_push = 0 THEN excluded.country_code ELSE customers.country_code END,
      ibge_city_code = CASE WHEN customers.needs_push = 0 THEN excluded.ibge_city_code ELSE customers.ibge_city_code END,
      ibge_state_code = CASE WHEN customers.needs_push = 0 THEN excluded.ibge_state_code ELSE customers.ibge_state_code END,
      customer_type = excluded.customer_type,
      is_foreign = excluded.is_foreign,
      omie_billing_blocked = excluded.omie_billing_blocked,
      observations = CASE WHEN customers.needs_push = 0 THEN excluded.observations ELSE customers.observations END,
      tags_json = excluded.tags_json,
      salesperson_id = excluded.salesperson_id,
      default_payment_term_id = CASE WHEN customers.needs_push = 0 THEN excluded.default_payment_term_id ELSE customers.default_payment_term_id END,
      is_active = excluded.is_active,
      deleted_at = NULL,
      sync_status = CASE WHEN customers.needs_push = 0 THEN 'synced' ELSE customers.sync_status END,
      last_synced_at = datetime('now'),
      omie_updated_at = datetime('now'),
      updated_at = datetime('now')
  `);

  let persisted = 0;
  for (const customer of customers) {
    const existing = findLocalId.get(companyId, customer.id) as { id: string } | undefined;
    const byIntegrationCode = customer.integrationCode
      ? (findByIntegrationCode.get(companyId, customer.integrationCode) as { id: string } | undefined)
      : undefined;
    const byDocument = customer.document
      ? (findByDocument.get(companyId, customer.document) as { id: string } | undefined)
      : undefined;
    const localId = existing?.id ?? byIntegrationCode?.id ?? byDocument?.id ?? `omie_${customer.id}`;
    upsert.run(
      localId,
      companyId,
      customer.id,
      customer.integrationCode ?? null,
      customer.name,
      customer.tradeName || customer.name,
      customer.document,
      customer.stateRegistration ?? null,
      customer.municipalRegistration ?? null,
      customer.isIndividual ? 1 : 0,
      customer.email,
      customer.homepage ?? null,
      customer.contactName ?? null,
      customer.phone,
      customer.phoneSecondary ?? null,
      customer.zipcode,
      customer.addressStreet,
      customer.addressNumber,
      customer.addressComplement ?? null,
      customer.neighborhood,
      customer.city,
      customer.state,
      customer.country ?? null,
      customer.countryCode ?? null,
      customer.ibgeCityCode ?? null,
      customer.ibgeStateCode ?? null,
      customer.customerType ?? null,
      customer.isForeign ? 1 : 0,
      customer.billingBlocked ? 1 : 0,
      customer.observations ?? null,
      customer.tagsJson ? JSON.stringify(customer.tagsJson) : null,
      customer.salespersonId ?? null,
      customer.defaultPaymentTermId,
      customer.isActive === false ? 0 : 1
    );
    persisted++;
  }
  return persisted;
}

function upsertOmieProducts(
  database: DesktopDatabase,
  companyId: string,
  products: OmieReferenceProduct[]
): number {
  const removeFromKyberRock = database.prepare(`
    UPDATE products
    SET is_active = 0,
        deleted_at = datetime('now'),
        updated_from_omie_at = datetime('now'),
        updated_at = datetime('now')
    WHERE company_id = ?
      AND omie_product_id = ?
  `);
  const upsert = database.prepare(`
    INSERT INTO products (
      id, company_id, omie_product_id, omie_integration_code, code, description,
      detailed_description, unit, ncm, ean, unit_price_cents,
      family_code, family_description, brand, model, internal_notes,
      gross_weight_kg, net_weight_kg, height_m, width_m, depth_m,
      cest, item_type, icms_origin, blocked, tracks_stock, fiscal_recommendations_json,
      is_active, updated_from_omie_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_product_id = excluded.omie_product_id,
      omie_integration_code = excluded.omie_integration_code,
      code = excluded.code,
      description = excluded.description,
      detailed_description = excluded.detailed_description,
      unit = excluded.unit,
      ncm = excluded.ncm,
      ean = excluded.ean,
      unit_price_cents = excluded.unit_price_cents,
      family_code = excluded.family_code,
      family_description = excluded.family_description,
      brand = excluded.brand,
      model = excluded.model,
      internal_notes = excluded.internal_notes,
      gross_weight_kg = excluded.gross_weight_kg,
      net_weight_kg = excluded.net_weight_kg,
      height_m = excluded.height_m,
      width_m = excluded.width_m,
      depth_m = excluded.depth_m,
      cest = excluded.cest,
      item_type = excluded.item_type,
      icms_origin = excluded.icms_origin,
      blocked = excluded.blocked,
      tracks_stock = excluded.tracks_stock,
      fiscal_recommendations_json = excluded.fiscal_recommendations_json,
      is_active = excluded.is_active,
      deleted_at = NULL,
      updated_from_omie_at = datetime('now'),
      updated_at = datetime('now')
  `);

  let synced = 0;
  for (const product of products) {
    if (
      !isSellableProduct({
        omieProductId: product.id,
        itemType: product.itemType ?? null,
        fiscalRecommendations: product.fiscalRecommendations ?? null,
        isActive: product.isActive !== false,
        blocked: product.blocked === true
      })
    ) {
      removeFromKyberRock.run(companyId, product.id);
      continue;
    }

    upsert.run(
      `omie_${product.id}`,
      companyId,
      product.id,
      product.integrationCode ?? null,
      product.code || `PROD_${product.id}`,
      product.description,
      product.detailedDescription ?? null,
      product.unit || "UN",
      product.ncm,
      product.ean,
      product.unitPriceCents,
      product.familyCode ?? null,
      product.familyDescription ?? null,
      product.brand ?? null,
      product.model ?? null,
      product.internalNotes ?? null,
      product.grossWeightKg ?? null,
      product.netWeightKg ?? null,
      product.heightM ?? null,
      product.widthM ?? null,
      product.depthM ?? null,
      product.cest ?? null,
      product.itemType ?? null,
      product.icmsOrigin ?? null,
      product.blocked ? 1 : 0,
      product.tracksStock === false ? 0 : 1,
      product.fiscalRecommendations ? JSON.stringify(product.fiscalRecommendations) : null,
      product.isActive === false ? 0 : 1
    );
    synced++;
  }
  return synced;
}

function upsertOmieSuppliers(
  database: DesktopDatabase,
  companyId: string,
  suppliers: OmieReferenceSupplier[]
): number {
  const upsert = database.prepare(`
    INSERT INTO carriers (
      id, company_id, omie_customer_id, omie_integration_code, name, document,
      phone, email, zipcode, address_street, address_number, address_complement,
      neighborhood, city, state, source, sync_status, needs_push, last_synced_at,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'omie', 'synced', 0, datetime('now'), ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_customer_id = excluded.omie_customer_id,
      omie_integration_code = excluded.omie_integration_code,
      name = excluded.name,
      document = excluded.document,
      phone = excluded.phone,
      email = excluded.email,
      zipcode = excluded.zipcode,
      address_street = excluded.address_street,
      address_number = excluded.address_number,
      address_complement = excluded.address_complement,
      neighborhood = excluded.neighborhood,
      city = excluded.city,
      state = excluded.state,
      is_active = excluded.is_active,
      sync_status = CASE WHEN carriers.needs_push = 0 THEN 'synced' ELSE carriers.sync_status END,
      needs_push = CASE WHEN carriers.needs_push = 0 THEN 0 ELSE carriers.needs_push END,
      last_synced_at = datetime('now'),
      deleted_at = NULL,
      updated_at = datetime('now')
  `);

  let persisted = 0;
  for (const supplier of suppliers) {
    if (!Number.isFinite(supplier.id) || !supplier.name.trim()) continue;
    const localId =
      findCarrierLocalId(database, companyId, supplier) ??
      `omie_supplier_${supplier.id}`;
    upsert.run(
      localId,
      companyId,
      supplier.id,
      supplier.integrationCode ?? null,
      supplier.name,
      supplier.document ?? null,
      supplier.phone ?? null,
      supplier.email ?? null,
      supplier.zipcode ?? null,
      supplier.addressStreet ?? null,
      supplier.addressNumber ?? null,
      supplier.addressComplement ?? null,
      supplier.neighborhood ?? null,
      supplier.city ?? null,
      supplier.state ?? null,
      supplier.isActive === false ? 0 : 1
    );
    persisted++;
  }
  return persisted;
}

function upsertOmiePaymentTerms(
  database: DesktopDatabase,
  companyId: string,
  paymentTerms: OmieReferencePaymentTerm[]
): number {
  const upsert = database.prepare(`
    INSERT INTO omie_payment_terms (
      id, company_id, omie_id, code, description,
      first_installment_days, installment_interval_days, installment_count,
      installment_type, installment_days_json, is_active, visible,
      updated_from_omie_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(company_id, code) DO UPDATE SET
      omie_id = excluded.omie_id,
      description = excluded.description,
      first_installment_days = excluded.first_installment_days,
      installment_interval_days = excluded.installment_interval_days,
      installment_count = excluded.installment_count,
      installment_type = excluded.installment_type,
      installment_days_json = excluded.installment_days_json,
      is_active = excluded.is_active,
      visible = excluded.visible,
      updated_from_omie_at = datetime('now'),
      updated_at = datetime('now')
  `);

  let persisted = 0;
  for (const term of paymentTerms) {
    // code e o identificador do codigo_parcela do OMIE; preserva zeros a esquerda (TEXT).
    const code = (term.code ?? "").trim();
    if (!code) continue;
    upsert.run(
      `omie_parcela_${code}`,
      companyId,
      Number.isFinite(term.id) ? term.id : null,
      code,
      term.description?.trim() || code,
      term.firstInstallmentDays ?? null,
      term.installmentIntervalDays ?? null,
      term.installmentCount ?? null,
      term.installmentType ?? null,
      term.installmentDaysJson ? JSON.stringify(term.installmentDaysJson) : null,
      term.isActive === false ? 0 : 1,
      term.visible === false ? 0 : 1
    );
    persisted++;
  }
  return persisted;
}

function findCarrierLocalId(
  database: DesktopDatabase,
  companyId: string,
  supplier: OmieReferenceSupplier
): string | null {
  const byOmieId = database
    .prepare(`SELECT id FROM carriers WHERE company_id = ? AND omie_customer_id = ? LIMIT 1`)
    .get(companyId, supplier.id) as { id: string } | undefined;

  if (byOmieId?.id) return byOmieId.id;

  if (supplier.integrationCode) {
    const byIntegrationCode = database
      .prepare(`SELECT id FROM carriers WHERE company_id = ? AND omie_integration_code = ? LIMIT 1`)
      .get(companyId, supplier.integrationCode) as { id: string } | undefined;

    if (byIntegrationCode?.id) return byIntegrationCode.id;
  }

  if (supplier.document) {
    const byDocument = database
      .prepare(
        `SELECT id FROM carriers
         WHERE company_id = ? AND document = ? AND deleted_at IS NULL
         LIMIT 1`
      )
      .get(companyId, supplier.document) as { id: string } | undefined;

    if (byDocument?.id) return byDocument.id;
  }

  return null;
}

export async function pullCompanyPricePasswordFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("companies")
    .select("price_change_password")
    .eq("id", identity.companyId)
    .single();

  if (error || !data) return false;

  database.prepare(`
    UPDATE companies
    SET price_change_password = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(String(data.price_change_password ?? "0000"), identity.companyId);

  return true;
}

export async function syncCustomerCarriersToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ synced: number; errors: string[] }> {
  const supabase = getSupabaseClient();
  const rows = database
    .prepare(`
      SELECT cc.id, cc.customer_id, cc.carrier_id, cc.is_active, cc.created_at, cc.updated_at
      FROM customer_carriers cc
      JOIN customers c ON c.id = cc.customer_id
      WHERE c.company_id = ? AND cc.deleted_at IS NULL
    `)
    .all(identity.companyId) as Array<{
      id: string;
      customer_id: string;
      carrier_id: string;
      is_active: number;
      created_at: string;
      updated_at: string;
    }>;

  const errors: string[] = [];
  let synced = 0;

  for (const row of rows) {
    try {
      const { error } = await supabase.from("customer_carriers").upsert({
        id: row.id,
        customer_id: row.customer_id,
        carrier_id: row.carrier_id,
        is_active: Boolean(row.is_active),
        created_at: row.created_at,
        updated_at: row.updated_at
      }, { onConflict: "id" });

      if (error) throw error;
      synced++;
    } catch (err) {
      errors.push(`customer_carrier ${row.id}: ${err instanceof Error ? err.message : "Erro"}`);
    }
  }

  return { synced, errors };
}

export async function syncDriverCarriersToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ synced: number; errors: string[] }> {
  const supabase = getSupabaseClient();
  const rows = database
    .prepare(`
      SELECT dc.id, dc.driver_id, dc.carrier_id, dc.is_active, dc.created_at, dc.updated_at
      FROM driver_carriers dc
      JOIN drivers d ON d.id = dc.driver_id
      WHERE d.company_id = ? AND dc.deleted_at IS NULL
    `)
    .all(identity.companyId) as Array<{
      id: string;
      driver_id: string;
      carrier_id: string;
      is_active: number;
      created_at: string;
      updated_at: string;
    }>;

  const errors: string[] = [];
  let synced = 0;

  for (const row of rows) {
    try {
      const { error } = await supabase.from("driver_carriers").upsert({
        id: row.id,
        driver_id: row.driver_id,
        carrier_id: row.carrier_id,
        is_active: Boolean(row.is_active),
        created_at: row.created_at,
        updated_at: row.updated_at
      }, { onConflict: "id" });

      if (error) throw error;
      synced++;
    } catch (err) {
      errors.push(`driver_carrier ${row.id}: ${err instanceof Error ? err.message : "Erro"}`);
    }
  }

  return { synced, errors };
}

export async function pullCustomerCarriersFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ pulled: number; errors: string[] }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("customer_carriers")
    .select("id, customer_id, carrier_id, is_active, created_at, updated_at")
    .eq("customer_id", identity.companyId)
    .eq("is_active", true);

  const errors: string[] = [];
  if (error) {
    errors.push(`pullCustomerCarriers: ${error.message}`);
    return { pulled: 0, errors };
  }

  const upsert = database.prepare(`
    INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      carrier_id = excluded.carrier_id,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let pulled = 0;
  for (const row of (data ?? [])) {
    upsert.run(
      row.id,
      row.customer_id,
      row.carrier_id,
      row.is_active ? 1 : 0,
      row.created_at,
      row.updated_at
    );
    pulled++;
  }

  return { pulled, errors };
}

export async function pullDriverCarriersFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ pulled: number; errors: string[] }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("driver_carriers")
    .select("id, driver_id, carrier_id, is_active, created_at, updated_at")
    .eq("driver_id", identity.companyId)
    .eq("is_active", true);

  const errors: string[] = [];
  if (error) {
    errors.push(`pullDriverCarriers: ${error.message}`);
    return { pulled: 0, errors };
  }

  const upsert = database.prepare(`
    INSERT INTO driver_carriers (id, driver_id, carrier_id, is_active, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      driver_id = excluded.driver_id,
      carrier_id = excluded.carrier_id,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let pulled = 0;
  for (const row of (data ?? [])) {
    upsert.run(
      row.id,
      row.driver_id,
      row.carrier_id,
      row.is_active ? 1 : 0,
      row.created_at,
      row.updated_at
    );
    pulled++;
  }

  return { pulled, errors };
}

export async function pullLoaderCompletionsFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ pulled: number; errors: string[] }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("loading_requests")
    .select("id, loader_completed_at, updated_at")
    .eq("unit_id", identity.unitId)
    .not("loader_completed_at", "is", null);

  const errors: string[] = [];
  if (error) {
    errors.push(`pullLoaderCompletions: ${error.message}`);
    return { pulled: 0, errors };
  }

  const update = database.prepare(`
    UPDATE loading_requests
    SET loader_completed_at = ?, updated_at = ?
    WHERE id = ? AND (loader_completed_at IS NULL OR loader_completed_at < ?)
  `);

  let pulled = 0;
  for (const row of data ?? []) {
    if (!row.loader_completed_at) continue;
    const completedAt = String(row.loader_completed_at);
    const updatedAt = String(row.updated_at ?? completedAt);
    const result = update.run(completedAt, updatedAt, row.id, completedAt);
    if (result.changes > 0) {
      pulled++;
    }
  }

  return { pulled, errors };
}
