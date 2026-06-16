import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "../config/supabase-config.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";
import { listRunnableSyncJobs, markSyncJobDone, markSyncJobFailed } from "./sync-queue.js";

let client: SupabaseClient | null = null;

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

export interface OmieCloudSyncResult {
  customersPulled: number;
  customersPushed: number;
  productsSynced: number;
  paymentTermsSynced: number;
  errors: string[];
}

interface OmieReferenceCustomer {
  id: number;
  name: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
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
  fiscalRecommendations?: Record<string, unknown> | null;
}

interface OmieReferencePaymentTerm {
  id: number;
  description: string;
}

interface OmieReferenceDataResponse {
  customers?: OmieReferenceCustomer[];
  products?: OmieReferenceProduct[];
  paymentTerms?: OmieReferencePaymentTerm[];
  pageSize?: number;
  pagination?: {
    customersPage: number;
    productsPage: number;
    paymentTermsPage: number;
    customersReturned: number;
    productsReturned: number;
    paymentTermsReturned: number;
    customersFinished?: boolean;
    productsFinished?: boolean;
    paymentTermsFinished?: boolean;
  };
}

interface OmiePullState {
  customersPage: number;
  productsPage: number;
  paymentTermsPage: number;
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
  if (patch.markDone === "customers") next.customersPage = 1;
  if (patch.markDone === "products") next.productsPage = 1;
  if (patch.markDone === "paymentTerms") next.paymentTermsPage = 1;
  if (
    next.customersPage === 1 &&
    next.productsPage === 1 &&
    next.paymentTermsPage === 1
  ) {
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
  if (!client) {
    client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
}

export function isSupabaseInitialized(): boolean {
  return client !== null;
}

export function getSupabaseClient(): SupabaseClient {
  initializeSupabase();
  if (!client) throw new Error("Supabase not initialized");
  return client;
}

export async function syncOperationToSupabase(
  database: DesktopDatabase,
  operationId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const operation = getOperationPayload(database, operationId, settings);
  await invokeDesktopSync(settings, { operations: [operation] });
  return true;
}

export async function syncLoadingRequestToSupabase(
  database: DesktopDatabase,
  requestId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const request = getLoadingRequestPayload(database, requestId, settings);
  await invokeDesktopSync(settings, { loadingRequests: [request] });
  return true;
}

export async function syncCustomerToSupabase(database: DesktopDatabase, customerId: string): Promise<boolean> {
  const settings = getCloudSettings(database);
  const customer = database.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as Record<string, unknown> | undefined;
  if (!customer) throw new Error(`Customer ${customerId} not found`);
  await invokeDesktopSync(settings, {
    customers: [{
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
    }]
  });
  return true;
}

export async function syncProductToSupabase(database: DesktopDatabase, productId: string): Promise<boolean> {
  const settings = getCloudSettings(database);
  const product = database.prepare("SELECT * FROM products WHERE id = ?").get(productId) as Record<string, unknown> | undefined;
  if (!product) throw new Error(`Product ${productId} not found`);
  await invokeDesktopSync(settings, {
    products: [{
      id: String(product.id),
      company_id: settings.companyId,
      omie_product_id: product.omie_product_id,
      code: product.code,
      description: product.description,
      unit: product.unit,
      is_active: Boolean(product.is_active ?? true),
      updated_at: new Date().toISOString()
    }]
  });
  return true;
}

export async function getSupabaseSyncStatus(companyId: string): Promise<{ totalOperations: number; lastSync: string | null }> {
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

export async function syncOmieReferenceDataFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { reset?: boolean } = {}
): Promise<OmieCloudSyncResult> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  if (options.reset) {
    writeOmiePullState(database, { customersPage: 1, productsPage: 1, paymentTermsPage: 1, inProgress: false });
  }
  const state = readOmiePullState(database);
  const { data, error } = await supabase.functions.invoke<OmieReferenceDataResponse>("omie-sync", {
    body: {
      deviceId: settings.deviceId,
      deviceToken: settings.deviceToken,
      action: "pull_reference_data",
      resume: {
        customersPage: state.customersPage,
        productsPage: state.productsPage,
        paymentTermsPage: state.paymentTermsPage
      }
    }
  });

  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!data) throw new Error("Resposta OMIE vazia.");

  return applyOmieReferenceData(database, settings.companyId, data);
}

export function applyOmieReferenceData(
  database: DesktopDatabase,
  companyId: string,
  data: OmieReferenceDataResponse
): OmieCloudSyncResult {
  const customers = data.customers ?? [];
  const products = data.products ?? [];
  const paymentTerms = data.paymentTerms ?? [];
  const pagination = data.pagination;

  const apply = database.transaction(() => {
    upsertOmieCustomers(database, companyId, customers);
    upsertOmieProducts(database, companyId, products);
    upsertOmiePaymentTerms(database, companyId, paymentTerms);
  });
  apply();

  if (pagination) {
    const pageSize = data.pageSize ?? 200;
    const isFinished = (returned: number, flag: boolean | undefined): boolean => {
      if (typeof flag === "boolean") return flag;
      return returned > 0 && returned < pageSize;
    };
    const finished = {
      customers: isFinished(pagination.customersReturned, pagination.customersFinished),
      products: isFinished(pagination.productsReturned, pagination.productsFinished),
      paymentTerms: isFinished(pagination.paymentTermsReturned, pagination.paymentTermsFinished)
    };
    const current = readOmiePullState(database);
    writeOmiePullState(database, {
      inProgress: !finished.customers || !finished.products || !finished.paymentTerms,
      customersPage: !finished.customers
        ? Math.max(pagination.customersPage + 1, current.customersPage)
        : 1,
      productsPage: !finished.products
        ? Math.max(pagination.productsPage + 1, current.productsPage)
        : 1,
      paymentTermsPage: !finished.paymentTerms
        ? Math.max(pagination.paymentTermsPage + 1, current.paymentTermsPage)
        : 1
    });
  } else {
    writeOmiePullState(database, {
      customersPage: 1,
      productsPage: 1,
      paymentTermsPage: 1,
      inProgress: false
    });
  }

  return {
    customersPulled: customers.length,
    customersPushed: 0,
    productsSynced: products.length,
    paymentTermsSynced: paymentTerms.length,
    errors: []
  };
}

function getCloudSettings(database: DesktopDatabase, identity?: LocalDesktopIdentity): CloudSettings {
  const settings = database.prepare("SELECT key, value_json FROM local_settings WHERE key IN ('cloud_company_id', 'cloud_unit_id', 'cloud_device_id', 'cloud_device_token')").all() as Array<{ key: string; value_json: string }>;
  const map = new Map(settings.map((row) => [row.key, JSON.parse(row.value_json) as string]));
  const companyId = map.get("cloud_company_id") || identity?.companyId || "";
  const unitId = map.get("cloud_unit_id") || identity?.unitId || "";
  const deviceId = map.get("cloud_device_id") || identity?.deviceId || "";
  const deviceToken = map.get("cloud_device_token") || "";
  if (!companyId || !unitId || !deviceId || !deviceToken) {
    throw new Error("Supabase cloud nao configurado. Configure company/unit/device/token do dispositivo.");
  }
  return { companyId, unitId, deviceId, deviceToken };
}

function getOperationPayload(database: DesktopDatabase, operationId: string, settings: CloudSettings): Record<string, unknown> {
  const operation = database.prepare(`SELECT
    o.*, c.trade_name AS customer_name, v.plate, d.name AS driver_name, p.description AS product_description
    FROM weighing_operations o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id
    LEFT JOIN drivers d ON d.id = o.driver_id
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.id = ?`).get(operationId) as Record<string, unknown> | undefined;
  if (!operation) throw new Error(`Operation ${operationId} not found`);
  return {
    id: operation.id,
    company_id: settings.companyId,
    unit_id: settings.unitId,
    device_id: settings.deviceId,
    status: operation.status === "loading_requested" || operation.status === "awaiting_exit" ? "open" : operation.status,
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
    product_total_cents: operation.product_total_cents,
    freight_total_cents: operation.freight_total_cents,
    total_cents: operation.total_cents,
    omie_sales_order_id: operation.omie_sales_order_id,
    omie_service_order_id: operation.omie_service_order_id,
    created_at: operation.created_at,
    updated_at: operation.updated_at,
    closed_at: operation.exit_weight_captured_at,
    synced_at: new Date().toISOString()
  };
}

function getLoadingRequestPayload(database: DesktopDatabase, requestId: string, settings: CloudSettings): Record<string, unknown> {
  const request = database.prepare(`SELECT
    lr.*,
    o.entry_weight_kg
    FROM loading_requests lr
    LEFT JOIN weighing_operations o ON o.id = lr.operation_id
    WHERE lr.id = ?`).get(requestId) as Record<string, unknown> | undefined;
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
    entry_weight_kg: request.entry_weight_kg,
    created_at: request.created_at,
    updated_at: request.updated_at,
    closed_at: request.closed_at
  };
}

export async function pushOmieCustomersToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ pushed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();

  const pending = database
    .prepare(
      `SELECT id, omie_customer_id, legal_name, trade_name, document, phone, email,
              zipcode, address_street, address_number, address_complement, neighborhood, city, state,
              default_payment_term_id
       FROM customers
       WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1 AND source IN ('local', 'hybrid')
       ORDER BY updated_at ASC`
    )
    .all(identity.companyId) as Array<{
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

  for (const customer of pending) {
    try {
      const phoneMatch = customer.phone?.match(/\(?(\d{2})\)?\s*(\d+)/);
      const { data, error } = await supabase.functions.invoke<{ omieCustomerId?: number }>("omie-sync", {
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
      });

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
  }

  return { pushed, failed, errors };
}

export async function processOmieSyncQueue(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const jobs = listRunnableSyncJobs(database, { target: "omie", limit: 50 });
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const job of jobs) {
    const payload = job.payload as {
      operationId: string;
      operationType: "invoice" | "internal";
      customerOmieId: number;
      productOmieId?: number | null;
      serviceDescription?: string | null;
      quantity: number;
      unitPrice: number;
      issueDate: string;
    };

    try {
      const { data, error } = await supabase.functions.invoke<{ orderId?: number }>("omie-sync", {
        body: {
          deviceId: settings.deviceId,
          deviceToken: settings.deviceToken,
          action: "create_order",
          payload: {
            operationType: payload.operationType,
            customerOmieId: payload.customerOmieId,
            productOmieId: payload.productOmieId ?? undefined,
            serviceDescription: payload.serviceDescription ?? undefined,
            quantity: payload.quantity,
            unitPrice: payload.unitPrice,
            issueDate: payload.issueDate,
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

      const updateSql = payload.operationType === "invoice"
        ? "UPDATE weighing_operations SET omie_sales_order_id = ?, status = 'synced', omie_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        : "UPDATE weighing_operations SET omie_service_order_id = ?, status = 'synced', omie_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?";

      database.prepare(updateSql).run(data.orderId, payload.operationId);
      markSyncJobDone(database, job.id);
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro OMIE";
      markSyncJobFailed(database, job.id, message);
      failed++;
      errors.push(`Job ${job.id}: ${message}`);
    }
  }

  return { processed, failed, errors };
}

async function invokeDesktopSync(settings: CloudSettings, payload: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("desktop-sync", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken, ...payload }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = getErrorLikeMessage(error);
  const context = typeof error === "object" && error !== null && "context" in error
    ? (error as { context?: unknown }).context
    : null;

  if (!context || typeof context !== "object") {
    return fallback;
  }

  try {
    const clone = "clone" in context && typeof context.clone === "function"
      ? context.clone()
      : context;
    if (clone && typeof clone === "object" && "json" in clone && typeof clone.json === "function") {
      const body = await clone.json();
      if (body && typeof body === "object") {
        const candidate = (body as { error?: unknown; message?: unknown }).error ??
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

  const statusText = "statusText" in context ? (context as { statusText?: unknown }).statusText : null;
  return typeof statusText === "string" && statusText.trim() ? statusText : fallback;
}

function getErrorLikeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = (error as { error?: unknown; message?: unknown }).error ??
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
): void {
  const findLocalId = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND omie_customer_id = ? AND deleted_at IS NULL LIMIT 1"
  );
  const findByDocument = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND document = ? AND deleted_at IS NULL LIMIT 1"
  );
  const upsert = database.prepare(`
    INSERT INTO customers (
      id, company_id, omie_customer_id, source, legal_name, trade_name,
      document, phone, email, zipcode, address_street, address_number, neighborhood, city, state,
      default_payment_term_id, is_active, sync_status, last_synced_at,
      omie_updated_at, needs_push, created_at, updated_at
    ) VALUES (?, ?, ?, 'omie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'synced', datetime('now'), datetime('now'), 0, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      omie_customer_id = excluded.omie_customer_id,
      legal_name = CASE WHEN customers.needs_push = 0 THEN excluded.legal_name ELSE customers.legal_name END,
      trade_name = CASE WHEN customers.needs_push = 0 THEN excluded.trade_name ELSE customers.trade_name END,
      document = CASE WHEN customers.needs_push = 0 THEN excluded.document ELSE customers.document END,
      phone = CASE WHEN customers.needs_push = 0 THEN excluded.phone ELSE customers.phone END,
      email = CASE WHEN customers.needs_push = 0 THEN excluded.email ELSE customers.email END,
      zipcode = CASE WHEN customers.needs_push = 0 THEN excluded.zipcode ELSE customers.zipcode END,
      address_street = CASE WHEN customers.needs_push = 0 THEN excluded.address_street ELSE customers.address_street END,
      address_number = CASE WHEN customers.needs_push = 0 THEN excluded.address_number ELSE customers.address_number END,
      neighborhood = CASE WHEN customers.needs_push = 0 THEN excluded.neighborhood ELSE customers.neighborhood END,
      city = CASE WHEN customers.needs_push = 0 THEN excluded.city ELSE customers.city END,
      state = CASE WHEN customers.needs_push = 0 THEN excluded.state ELSE customers.state END,
      default_payment_term_id = CASE WHEN customers.needs_push = 0 THEN excluded.default_payment_term_id ELSE customers.default_payment_term_id END,
      sync_status = CASE WHEN customers.needs_push = 0 THEN 'synced' ELSE customers.sync_status END,
      last_synced_at = datetime('now'),
      omie_updated_at = datetime('now'),
      updated_at = datetime('now')
  `);

  for (const customer of customers) {
    const existing = findLocalId.get(companyId, customer.id) as { id: string } | undefined;
    const byDocument = customer.document
      ? (findByDocument.get(companyId, customer.document) as { id: string } | undefined)
      : undefined;
    const localId = existing?.id ?? byDocument?.id ?? `omie_${customer.id}`;
    upsert.run(
      localId,
      companyId,
      customer.id,
      customer.name,
      customer.tradeName || customer.name,
      customer.document,
      customer.phone,
      customer.email,
      customer.zipcode,
      customer.addressStreet,
      customer.addressNumber,
      customer.neighborhood,
      customer.city,
      customer.state,
      customer.defaultPaymentTermId
    );
  }
}

function upsertOmieProducts(
  database: DesktopDatabase,
  companyId: string,
  products: OmieReferenceProduct[]
): void {
  const upsert = database.prepare(`
    INSERT INTO products (
      id, company_id, omie_product_id, omie_integration_code, code, description,
      detailed_description, unit, ncm, ean, unit_price_cents,
      family_code, family_description, brand, model, internal_notes,
      gross_weight_kg, net_weight_kg, height_m, width_m, depth_m,
      cest, item_type, icms_origin, blocked, fiscal_recommendations_json,
      is_active, updated_from_omie_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
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
      fiscal_recommendations_json = excluded.fiscal_recommendations_json,
      is_active = excluded.is_active,
      updated_from_omie_at = datetime('now'),
      updated_at = datetime('now')
  `);

  for (const product of products) {
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
      product.fiscalRecommendations ? JSON.stringify(product.fiscalRecommendations) : null,
      product.isActive === false ? 0 : 1
    );
  }
}

function upsertOmiePaymentTerms(
  database: DesktopDatabase,
  companyId: string,
  paymentTerms: OmieReferencePaymentTerm[]
): void {
  const upsert = database.prepare(`
    INSERT INTO payment_terms (
      id, company_id, omie_code, name, rules_json,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      omie_code = excluded.omie_code,
      name = excluded.name,
      rules_json = excluded.rules_json,
      updated_at = datetime('now')
  `);

  for (const paymentTerm of paymentTerms) {
    upsert.run(
      `omie_${paymentTerm.id}`,
      companyId,
      String(paymentTerm.id),
      paymentTerm.description,
      JSON.stringify({ omieId: paymentTerm.id })
    );
  }
}
