import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "../config/supabase-config.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";

let client: SupabaseClient | null = null;

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
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

async function invokeDesktopSync(settings: CloudSettings, payload: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("desktop-sync", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken, ...payload }
  });
  if (error) throw error;
}
