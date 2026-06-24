export interface DesktopMigration {
  version: number;
  name: string;
  sql: string;
}

export const DESKTOP_MIGRATIONS: readonly DesktopMigration[] = [
  {
    version: 1,
    name: "initial_offline_schema",
    sql: `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  document TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  receipt_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('desktop_scale')),
  installation_id TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scale_configs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  adapter_type TEXT NOT NULL CHECK (adapter_type IN ('serial', 'tcp', 'http', 'file', 'custom')),
  manufacturer TEXT,
  model TEXT,
  connection_config_json TEXT NOT NULL,
  stability_config_json TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  kg_factor REAL NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS print_profiles (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  document_type TEXT NOT NULL CHECK (document_type IN ('receipt_80mm', 'report_a4')),
  windows_printer_name TEXT NOT NULL,
  paper_width_mm INTEGER NOT NULL,
  margin_json TEXT NOT NULL,
  font_config_json TEXT NOT NULL,
  copies INTEGER NOT NULL DEFAULT 1,
  cut_paper INTEGER NOT NULL DEFAULT 0 CHECK (cut_paper IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  omie_customer_id INTEGER,
  omie_integration_code TEXT,
  source TEXT NOT NULL CHECK (source IN ('omie', 'local', 'hybrid')),
  legal_name TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  credit_limit_cents INTEGER,
  open_receivables_cents INTEGER NOT NULL DEFAULT 0,
  omie_billing_blocked INTEGER NOT NULL DEFAULT 0 CHECK (omie_billing_blocked IN (0, 1)),
  financial_cache_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('synced', 'pending', 'error')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  omie_product_id INTEGER,
  omie_integration_code TEXT,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  updated_from_omie_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  plate TEXT NOT NULL,
  description TEXT,
  carrier_id TEXT REFERENCES carriers(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS carriers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  omie_customer_id INTEGER,
  name TEXT NOT NULL,
  document TEXT,
  source TEXT NOT NULL CHECK (source IN ('omie', 'local')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_terms (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  omie_code TEXT,
  name TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_tables (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_table_items (
  id TEXT PRIMARY KEY,
  price_table_id TEXT NOT NULL REFERENCES price_tables(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_price_cents INTEGER NOT NULL,
  unit TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_price_tables (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  price_table_id TEXT NOT NULL REFERENCES price_tables(id),
  valid_from TEXT,
  valid_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS weighing_operations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'entry_registered', 'loading_requested', 'awaiting_exit', 'closed_local', 'pending_cloud', 'pending_omie', 'synced', 'sync_error', 'cancelled')),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('invoice', 'internal')),
  customer_id TEXT REFERENCES customers(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  driver_id TEXT REFERENCES drivers(id),
  carrier_id TEXT REFERENCES carriers(id),
  product_id TEXT REFERENCES products(id),
  payment_term_id TEXT REFERENCES payment_terms(id),
  entry_weight_kg REAL,
  entry_weight_captured_at TEXT,
  exit_weight_kg REAL,
  exit_weight_captured_at TEXT,
  net_weight_kg REAL,
  unit_price_cents INTEGER,
  product_total_cents INTEGER,
  freight_total_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER,
  freight_json TEXT,
  omie_sales_order_id INTEGER,
  omie_service_order_id INTEGER,
  cloud_synced_at TEXT,
  omie_synced_at TEXT,
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS loading_requests (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES weighing_operations(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  status TEXT NOT NULL,
  plate TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  product_description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS print_receipts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES weighing_operations(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  receipt_number INTEGER NOT NULL,
  copy_number INTEGER NOT NULL DEFAULT 1,
  content_snapshot_json TEXT NOT NULL,
  printed_at TEXT NOT NULL,
  printer_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('printed', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL CHECK (target IN ('cloud', 'omie')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  unit_id TEXT REFERENCES units(id),
  device_id TEXT REFERENCES devices(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS technical_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warning', 'error')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_company_document ON customers(company_id, document);
CREATE INDEX IF NOT EXISTS idx_products_company_omie_product ON products(company_id, omie_product_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_company_plate ON vehicles(company_id, plate);
CREATE INDEX IF NOT EXISTS idx_operations_unit_status_created ON weighing_operations(unit_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_operations_unit_vehicle_status ON weighing_operations(unit_id, vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_target_next_attempt ON sync_queue(status, target, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created ON audit_logs(entity_type, entity_id, created_at);
`
  },
  {
    version: 2,
    name: "sync_fields_and_search_indexes",
    sql: `
ALTER TABLE customers ADD COLUMN omie_updated_at TEXT;
ALTER TABLE customers ADD COLUMN local_updated_at TEXT;
ALTER TABLE customers ADD COLUMN last_synced_at TEXT;
ALTER TABLE customers ADD COLUMN needs_push INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN observations TEXT;

ALTER TABLE price_tables ADD COLUMN omie_table_id INTEGER;
ALTER TABLE price_tables ADD COLUMN omie_updated_at TEXT;
ALTER TABLE price_tables ADD COLUMN local_updated_at TEXT;
ALTER TABLE price_tables ADD COLUMN last_synced_at TEXT;
ALTER TABLE price_tables ADD COLUMN needs_push INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers(company_id, legal_name);
CREATE INDEX IF NOT EXISTS idx_customers_company_trade ON customers(company_id, trade_name);
CREATE INDEX IF NOT EXISTS idx_customers_company_omie ON customers(company_id, omie_customer_id);
CREATE INDEX IF NOT EXISTS idx_drivers_company_name ON drivers(company_id, name);
CREATE INDEX IF NOT EXISTS idx_drivers_company_document ON drivers(company_id, document);
CREATE INDEX IF NOT EXISTS idx_carriers_company_name ON carriers(company_id, name);
CREATE INDEX IF NOT EXISTS idx_price_items_product ON price_table_items(product_id);
CREATE INDEX IF NOT EXISTS idx_customer_price_lookup ON customer_price_tables(customer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_company_code ON products(company_id, code);
CREATE INDEX IF NOT EXISTS idx_payment_terms_active ON payment_terms(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_needs_push ON customers(company_id, needs_push);
CREATE INDEX IF NOT EXISTS idx_price_tables_needs_push ON price_tables(company_id, needs_push);
`
  },
  {
    version: 3,
    name: "vehicle_carrier_links_and_customer_default_carrier",
    sql: `
ALTER TABLE customers ADD COLUMN default_carrier_id TEXT;

CREATE TABLE IF NOT EXISTS vehicle_carriers (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  carrier_id TEXT NOT NULL REFERENCES carriers(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vehicle_carriers_vehicle ON vehicle_carriers(vehicle_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_carriers_carrier ON vehicle_carriers(carrier_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customers_default_carrier ON customers(company_id, default_carrier_id, is_active);
`
  },
  {
    version: 4,
    name: "customer_address_and_product_details",
    sql: `
ALTER TABLE customers ADD COLUMN zipcode TEXT;
ALTER TABLE customers ADD COLUMN address_street TEXT;
ALTER TABLE customers ADD COLUMN address_number TEXT;
ALTER TABLE customers ADD COLUMN address_complement TEXT;
ALTER TABLE customers ADD COLUMN neighborhood TEXT;
ALTER TABLE customers ADD COLUMN city TEXT;
ALTER TABLE customers ADD COLUMN state TEXT;
ALTER TABLE customers ADD COLUMN default_payment_term_id TEXT;

ALTER TABLE products ADD COLUMN ncm TEXT;
ALTER TABLE products ADD COLUMN ean TEXT;
ALTER TABLE products ADD COLUMN unit_price_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_customers_company_zipcode ON customers(company_id, zipcode);
CREATE INDEX IF NOT EXISTS idx_customers_default_payment_term ON customers(company_id, default_payment_term_id);
CREATE INDEX IF NOT EXISTS idx_products_company_ncm ON products(company_id, ncm);
`
  },
  {
    version: 5,
    name: "product_omie_full_attributes",
    sql: `
ALTER TABLE products ADD COLUMN family_code TEXT;
ALTER TABLE products ADD COLUMN family_description TEXT;
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN model TEXT;
ALTER TABLE products ADD COLUMN detailed_description TEXT;
ALTER TABLE products ADD COLUMN internal_notes TEXT;
ALTER TABLE products ADD COLUMN gross_weight_kg REAL;
ALTER TABLE products ADD COLUMN net_weight_kg REAL;
ALTER TABLE products ADD COLUMN height_m REAL;
ALTER TABLE products ADD COLUMN width_m REAL;
ALTER TABLE products ADD COLUMN depth_m REAL;
ALTER TABLE products ADD COLUMN cest TEXT;
ALTER TABLE products ADD COLUMN item_type TEXT;
ALTER TABLE products ADD COLUMN icms_origin TEXT;
ALTER TABLE products ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1));
ALTER TABLE products ADD COLUMN fiscal_recommendations_json TEXT;

CREATE INDEX IF NOT EXISTS idx_products_company_family ON products(company_id, family_code);
CREATE INDEX IF NOT EXISTS idx_products_company_brand ON products(company_id, brand);
CREATE INDEX IF NOT EXISTS idx_products_company_active ON products(company_id, is_active, deleted_at);
`
  },
  {
    version: 6,
    name: "omie_reference_full_attributes",
    sql: `
ALTER TABLE customers ADD COLUMN state_registration TEXT;
ALTER TABLE customers ADD COLUMN municipal_registration TEXT;
ALTER TABLE customers ADD COLUMN is_individual INTEGER NOT NULL DEFAULT 0 CHECK (is_individual IN (0, 1));
ALTER TABLE customers ADD COLUMN homepage TEXT;
ALTER TABLE customers ADD COLUMN contact_name TEXT;
ALTER TABLE customers ADD COLUMN phone_secondary TEXT;
ALTER TABLE customers ADD COLUMN ibge_city_code TEXT;
ALTER TABLE customers ADD COLUMN ibge_state_code TEXT;
ALTER TABLE customers ADD COLUMN country TEXT;
ALTER TABLE customers ADD COLUMN country_code TEXT;
ALTER TABLE customers ADD COLUMN customer_type TEXT;
ALTER TABLE customers ADD COLUMN is_foreign INTEGER NOT NULL DEFAULT 0 CHECK (is_foreign IN (0, 1));
ALTER TABLE customers ADD COLUMN tags_json TEXT;
ALTER TABLE customers ADD COLUMN salesperson_id INTEGER;

ALTER TABLE payment_terms ADD COLUMN omie_integration_code TEXT;
ALTER TABLE payment_terms ADD COLUMN first_installment_days INTEGER;
ALTER TABLE payment_terms ADD COLUMN installment_interval_days INTEGER;
ALTER TABLE payment_terms ADD COLUMN installment_count INTEGER;
ALTER TABLE payment_terms ADD COLUMN installment_type TEXT;
ALTER TABLE payment_terms ADD COLUMN installment_days_json TEXT;
ALTER TABLE payment_terms ADD COLUMN visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1));
ALTER TABLE payment_terms ADD COLUMN updated_from_omie_at TEXT;

ALTER TABLE products ADD COLUMN tracks_stock INTEGER NOT NULL DEFAULT 1 CHECK (tracks_stock IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_customers_company_ibge ON customers(company_id, ibge_city_code);
CREATE INDEX IF NOT EXISTS idx_customers_company_state_reg ON customers(company_id, state_registration);
CREATE INDEX IF NOT EXISTS idx_customers_company_salesperson ON customers(company_id, salesperson_id);
CREATE INDEX IF NOT EXISTS idx_payment_terms_active_visible ON payment_terms(company_id, is_active, visible);
`
  },
  {
    version: 7,
    name: "operation_price_snapshot",
    sql: `
ALTER TABLE weighing_operations ADD COLUMN base_unit_price_cents INTEGER;
ALTER TABLE weighing_operations ADD COLUMN applied_price_table_id TEXT;
ALTER TABLE weighing_operations ADD COLUMN applied_price_table_name TEXT;
ALTER TABLE weighing_operations ADD COLUMN applied_price_table_item_id TEXT;
ALTER TABLE weighing_operations ADD COLUMN price_unit TEXT NOT NULL DEFAULT 'ton';
ALTER TABLE weighing_operations ADD COLUMN price_savings_percent REAL;

CREATE INDEX IF NOT EXISTS idx_operations_price_table ON weighing_operations(applied_price_table_id);
`
  },
  {
    version: 8,
    name: "operation_manual_installments",
    sql: `
ALTER TABLE weighing_operations ADD COLUMN manual_installments INTEGER;
`
  },
  {
    version: 9,
    name: "operation_omie_billing_status",
    sql: `
ALTER TABLE weighing_operations ADD COLUMN omie_billing_status TEXT;
ALTER TABLE weighing_operations ADD COLUMN omie_billing_message TEXT;
ALTER TABLE weighing_operations ADD COLUMN omie_billed_at TEXT;
ALTER TABLE weighing_operations ADD COLUMN omie_document_url TEXT;
`
  },
  {
    version: 10,
    name: "registration_internal_codes_and_missing_fields",
    sql: `
ALTER TABLE customers ADD COLUMN internal_code TEXT;
ALTER TABLE products ADD COLUMN internal_code TEXT;
ALTER TABLE drivers ADD COLUMN cnh TEXT;
ALTER TABLE carriers ADD COLUMN phone TEXT;
ALTER TABLE carriers ADD COLUMN omie_integration_code TEXT;
ALTER TABLE products ADD COLUMN unit_type TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_company_internal_code
  ON customers(company_id, internal_code)
  WHERE internal_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_company_internal_code
  ON products(company_id, internal_code)
  WHERE internal_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_company_cnh ON drivers(company_id, cnh);
CREATE INDEX IF NOT EXISTS idx_carriers_company_phone ON carriers(company_id, phone);
`
  },
  {
    version: 11,
    name: "customer_special_prices_and_default_prices",
    sql: `
CREATE TABLE IF NOT EXISTS product_default_prices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_price_cents INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ton',
  valid_from TEXT,
  valid_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_special_prices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_price_cents INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ton',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_special_prices_customer_product
  ON customer_special_prices(customer_id, product_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_default_prices_product
  ON product_default_prices(product_id, is_active)
  WHERE deleted_at IS NULL;
`
  },
  {
    version: 12,
    name: "customer_credit_balance_and_movements",
    sql: `
CREATE TABLE IF NOT EXISTS customer_credit_balances (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  balance_cents INTEGER NOT NULL DEFAULT 0,
  omie_source_json TEXT,
  last_synced_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_credit_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  operation_id TEXT REFERENCES weighing_operations(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('credit', 'debit_product', 'debit_freight', 'refund_product', 'refund_freight', 'manual_adjustment')),
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE customers ADD COLUMN credit_mode TEXT NOT NULL DEFAULT 'normal' CHECK (credit_mode IN ('normal', 'prepaid'));

CREATE INDEX IF NOT EXISTS idx_customer_credit_movements_customer_created
  ON customer_credit_movements(customer_id, created_at DESC);
`
  },
  {
    version: 13,
    name: "quotations_and_operation_credit_fields",
    sql: `
CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  payment_term_id TEXT REFERENCES payment_terms(id),
  unit_price_cents INTEGER NOT NULL,
  estimated_quantity_kg REAL NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'consumed', 'cancelled')),
  consumed_operation_id TEXT REFERENCES weighing_operations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE weighing_operations ADD COLUMN deduct_freight_from_credit INTEGER NOT NULL DEFAULT 0 CHECK (deduct_freight_from_credit IN (0, 1));
ALTER TABLE weighing_operations ADD COLUMN product_credit_debit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weighing_operations ADD COLUMN freight_credit_debit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weighing_operations ADD COLUMN quotation_id TEXT REFERENCES quotations(id);

CREATE INDEX IF NOT EXISTS idx_quotations_customer_status
  ON quotations(customer_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_weighing_operations_quotation
  ON weighing_operations(quotation_id);
`
  }
];
