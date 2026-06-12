import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "../config/supabase-config.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
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
}

interface OmieReferenceProduct {
  id: number;
  code: string | null;
  description: string;
  unit: string | null;
}

interface OmieReferencePaymentTerm {
  id: number;
  description: string;
}

interface OmieReferenceDataResponse {
  customers?: OmieReferenceCustomer[];
  products?: OmieReferenceProduct[];
  paymentTerms?: OmieReferencePaymentTerm[];
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
  identity: LocalDesktopIdentity
): Promise<OmieCloudSyncResult> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<OmieReferenceDataResponse>("omie-sync", {
    body: {
      deviceId: settings.deviceId,
      deviceToken: settings.deviceToken,
      action: "pull_reference_data"
    }
  });

  if (error) throw error;
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

  const apply = database.transaction(() => {
    upsertOmieCustomers(database, companyId, customers);
    upsertOmieProducts(database, companyId, products);
    upsertOmiePaymentTerms(database, companyId, paymentTerms);
  });
  apply();

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

      if (error || !data?.orderId) {
        throw new Error(error?.message ?? "OMIE nao retornou orderId");
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
  if (error) throw error;
}

function upsertOmieCustomers(
  database: DesktopDatabase,
  companyId: string,
  customers: OmieReferenceCustomer[]
): void {
  const findLocalId = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND omie_customer_id = ? AND deleted_at IS NULL LIMIT 1"
  );
  const upsert = database.prepare(`
    INSERT INTO customers (
      id, company_id, omie_customer_id, source, legal_name, trade_name,
      document, phone, email, is_active, sync_status, last_synced_at,
      omie_updated_at, needs_push, created_at, updated_at
    ) VALUES (?, ?, ?, 'omie', ?, ?, ?, ?, ?, 1, 'synced', datetime('now'), datetime('now'), 0, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      omie_customer_id = excluded.omie_customer_id,
      legal_name = CASE WHEN customers.needs_push = 0 THEN excluded.legal_name ELSE customers.legal_name END,
      trade_name = CASE WHEN customers.needs_push = 0 THEN excluded.trade_name ELSE customers.trade_name END,
      document = CASE WHEN customers.needs_push = 0 THEN excluded.document ELSE customers.document END,
      phone = CASE WHEN customers.needs_push = 0 THEN excluded.phone ELSE customers.phone END,
      email = CASE WHEN customers.needs_push = 0 THEN excluded.email ELSE customers.email END,
      sync_status = CASE WHEN customers.needs_push = 0 THEN 'synced' ELSE customers.sync_status END,
      last_synced_at = datetime('now'),
      omie_updated_at = datetime('now'),
      updated_at = datetime('now')
  `);

  for (const customer of customers) {
    const existing = findLocalId.get(companyId, customer.id) as { id: string } | undefined;
    const localId = existing?.id ?? `omie_${customer.id}`;
    upsert.run(
      localId,
      companyId,
      customer.id,
      customer.name,
      customer.tradeName || customer.name,
      customer.document,
      customer.phone,
      customer.email
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
      id, company_id, omie_product_id, code, description, unit,
      is_active, updated_from_omie_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      omie_product_id = excluded.omie_product_id,
      code = excluded.code,
      description = excluded.description,
      unit = excluded.unit,
      updated_from_omie_at = datetime('now'),
      updated_at = datetime('now')
  `);

  for (const product of products) {
    upsert.run(
      `omie_${product.id}`,
      companyId,
      product.id,
      product.code || `PROD_${product.id}`,
      product.description,
      product.unit || "UN"
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
