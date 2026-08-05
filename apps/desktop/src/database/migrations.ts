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
  adapter_type TEXT NOT NULL CHECK (adapter_type IN ('serial', 'tcp', 'http', 'file', 'custom', 'virtual')),
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
  },
  {
    version: 14,
    name: "customer_carrier_driver_carrier_links_and_price_password",
    sql: `
ALTER TABLE drivers ADD COLUMN is_independent INTEGER NOT NULL DEFAULT 0 CHECK (is_independent IN (0, 1));

ALTER TABLE companies ADD COLUMN price_change_password TEXT NOT NULL DEFAULT '0000';

CREATE TABLE IF NOT EXISTS customer_carriers (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  carrier_id TEXT NOT NULL REFERENCES carriers(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS driver_carriers (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  carrier_id TEXT NOT NULL REFERENCES carriers(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_customer_carriers_customer ON customer_carriers(customer_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customer_carriers_carrier ON customer_carriers(carrier_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_driver_carriers_driver ON driver_carriers(driver_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_driver_carriers_carrier ON driver_carriers(carrier_id, is_active, deleted_at);
`
  },
  {
    version: 15,
    name: "scale_config_virtual_adapter_type",
    sql: `
ALTER TABLE scale_configs RENAME TO scale_configs_old;

CREATE TABLE scale_configs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  adapter_type TEXT NOT NULL CHECK (adapter_type IN ('serial', 'tcp', 'http', 'file', 'custom', 'virtual')),
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

INSERT INTO scale_configs (
  id,
  device_id,
  adapter_type,
  manufacturer,
  model,
  connection_config_json,
  stability_config_json,
  unit,
  kg_factor,
  is_active,
  created_at,
  updated_at
)
SELECT
  id,
  device_id,
  adapter_type,
  manufacturer,
  model,
  connection_config_json,
  stability_config_json,
  unit,
  kg_factor,
  is_active,
  created_at,
  updated_at
FROM scale_configs_old;

DROP TABLE scale_configs_old;
`
  },
  {
    version: 16,
    name: "omie_master_sync_and_driver_vehicle_omie_fields",
    sql: `
ALTER TABLE drivers ADD COLUMN omie_driver_id INTEGER;
ALTER TABLE drivers ADD COLUMN source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('omie', 'local'));
ALTER TABLE drivers ADD COLUMN last_synced_at TEXT;
ALTER TABLE drivers ADD COLUMN raw_omie_payload_id TEXT;

ALTER TABLE vehicles ADD COLUMN omie_vehicle_id INTEGER;
ALTER TABLE vehicles ADD COLUMN source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('omie', 'local'));
ALTER TABLE vehicles ADD COLUMN last_synced_at TEXT;
ALTER TABLE vehicles ADD COLUMN raw_omie_payload_id TEXT;
ALTER TABLE vehicles ADD COLUMN plate_normalized TEXT;

UPDATE vehicles SET plate_normalized = UPPER(REPLACE(plate, ' ', '')) WHERE plate_normalized IS NULL;

CREATE TABLE IF NOT EXISTS omie_sync_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('full', 'incremental')),
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual', 'automatic', 'startup')),
  success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
  errors_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS omie_sync_entities (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES omie_sync_runs(id),
  entity TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
  total_fetched INTEGER NOT NULL DEFAULT 0,
  total_created INTEGER NOT NULL DEFAULT 0,
  total_updated INTEGER NOT NULL DEFAULT 0,
  total_skipped INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS omie_raw_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  entity_type TEXT NOT NULL,
  omie_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicles_company_plate_normalized ON vehicles(company_id, plate_normalized);
CREATE INDEX IF NOT EXISTS idx_drivers_company_omie ON drivers(company_id, omie_driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_company_omie ON vehicles(company_id, omie_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_omie_sync_runs_company_started ON omie_sync_runs(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_omie_sync_entities_run ON omie_sync_entities(run_id);
CREATE INDEX IF NOT EXISTS idx_omie_raw_records_company_entity ON omie_raw_records(company_id, entity_type);
`
  },
  {
    version: 17,
    name: "loading_request_loader_completed_at",
    sql: `
ALTER TABLE loading_requests ADD COLUMN loader_completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_loading_requests_unit_loader_completed
  ON loading_requests(unit_id, loader_completed_at);
`
  },
  {
    version: 18,
    name: "carrier_contact_address_fields",
    sql: `
ALTER TABLE carriers ADD COLUMN email TEXT;
ALTER TABLE carriers ADD COLUMN zipcode TEXT;
ALTER TABLE carriers ADD COLUMN address_street TEXT;
ALTER TABLE carriers ADD COLUMN address_number TEXT;
ALTER TABLE carriers ADD COLUMN address_complement TEXT;
ALTER TABLE carriers ADD COLUMN neighborhood TEXT;
ALTER TABLE carriers ADD COLUMN city TEXT;
ALTER TABLE carriers ADD COLUMN state TEXT;

CREATE INDEX IF NOT EXISTS idx_carriers_company_city ON carriers(company_id, city);
`
  },
  {
    version: 19,
    name: "clear_omie_queue_long_keys",
    sql: `
-- Limpa jobs da fila OMIE com idempotency_key > 60 caracteres,
-- que causam erro HTTP 500 por exceder o limite do campo cCodIntOS.
DELETE FROM sync_queue
WHERE target = 'omie'
  AND LENGTH(idempotency_key) > 60;
`
  },
  {
    version: 20,
    name: "operation_manual_down_payment",
    sql: `
ALTER TABLE weighing_operations ADD COLUMN manual_down_payment_cents INTEGER;
`
  },
  {
    version: 21,
    name: "scale_config_capture_mode",
    sql: `
ALTER TABLE scale_configs ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'custom' CHECK (capture_mode IN ('custom', 'default'));
`
  },
  {
    version: 22,
    name: "customer_freight_rules",
    sql: `
CREATE TABLE IF NOT EXISTS customer_freight_rules (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT REFERENCES products(id),
  rule_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_freight_rules_customer_product
  ON customer_freight_rules(customer_id, product_id)
  WHERE deleted_at IS NULL AND product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_freight_rules_customer_default
  ON customer_freight_rules(customer_id)
  WHERE deleted_at IS NULL AND product_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_freight_rules_customer_active
  ON customer_freight_rules(customer_id, is_active, deleted_at);
`
  },
  {
    version: 23,
    name: "print_profile_network_and_template",
    sql: `
ALTER TABLE print_profiles ADD COLUMN printer_type TEXT NOT NULL DEFAULT 'windows' CHECK (printer_type IN ('windows', 'network'));
ALTER TABLE print_profiles ADD COLUMN network_host TEXT;
ALTER TABLE print_profiles ADD COLUMN network_port INTEGER;
ALTER TABLE print_profiles ADD COLUMN template_config_json TEXT NOT NULL DEFAULT '{}';
`
  },
  {
    version: 24,
    name: "carrier_omie_push_state",
    sql: `
ALTER TABLE carriers ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'error'));
ALTER TABLE carriers ADD COLUMN needs_push INTEGER NOT NULL DEFAULT 0 CHECK (needs_push IN (0, 1));
ALTER TABLE carriers ADD COLUMN last_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_carriers_company_needs_push
  ON carriers(company_id, needs_push, deleted_at);
`
  },
  {
    version: 25,
    name: "local_payment_methods_and_customer_credit_account",
    sql: `
-- Formas de pagamento cadastradas localmente no KyberRock (nao mais vindas do OMIE).
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_customer_credit INTEGER NOT NULL DEFAULT 0 CHECK (is_customer_credit IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_company_code
  ON payment_methods(company_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_methods_company_active
  ON payment_methods(company_id, is_active, deleted_at);

-- Semeia as formas padrao para todas as empresas ja existentes.
INSERT INTO payment_methods (id, company_id, code, name, is_system, is_customer_credit, sort_order, is_active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, m.code, m.name, 1, m.is_customer_credit, m.sort_order, 1, datetime('now'), datetime('now')
FROM companies c
CROSS JOIN (
  SELECT 'cash' AS code, 'Dinheiro' AS name, 0 AS is_customer_credit, 1 AS sort_order
  UNION ALL SELECT 'pix', 'Pix', 0, 2
  UNION ALL SELECT 'credit_card', 'Cartao de credito', 0, 3
  UNION ALL SELECT 'debit_card', 'Cartao de debito', 0, 4
  UNION ALL SELECT 'boleto', 'Boleto', 0, 5
  UNION ALL SELECT 'customer_credit', 'Credito do cliente', 1, 6
) m
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm
  WHERE pm.company_id = c.id AND pm.code = m.code AND pm.deleted_at IS NULL
);

-- Forma de pagamento padrao e configuracao de credito do cliente (fiado) no cadastro.
ALTER TABLE customers ADD COLUMN default_payment_method_id TEXT;
ALTER TABLE customers ADD COLUMN credit_account_enabled INTEGER NOT NULL DEFAULT 0 CHECK (credit_account_enabled IN (0, 1));
ALTER TABLE customers ADD COLUMN credit_closing_day INTEGER;
ALTER TABLE customers ADD COLUMN credit_boleto_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_customers_default_payment_method
  ON customers(company_id, default_payment_method_id);

-- Condicoes de pagamento nao vem mais do OMIE: remove (soft delete) as ja sincronizadas.
UPDATE payment_terms
SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
WHERE deleted_at IS NULL
  AND (omie_code IS NOT NULL OR id LIKE 'omie_%');
`
  },
  {
    version: 26,
    name: "nf_required_flags_on_carriers_and_customers",
    sql: `
-- Transportadora: informa se e obrigatorio informar seus dados na nota fiscal.
ALTER TABLE carriers ADD COLUMN nf_required INTEGER NOT NULL DEFAULT 0 CHECK (nf_required IN (0, 1));

-- Cliente: informa se exige nota fiscal (reflete na pre-selecao do fechamento).
ALTER TABLE customers ADD COLUMN nf_required INTEGER NOT NULL DEFAULT 1 CHECK (nf_required IN (0, 1));
`
  },
  {
    version: 27,
    name: "payment_accounts_and_method_binding",
    sql: `
-- Contas (conta corrente) usadas para o fechamento financeiro. Cada forma de
-- pagamento aponta para uma conta, permitindo espelhar recebimento x faturamento.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT,
  name TEXT NOT NULL,
  omie_code TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_company_code
  ON accounts(company_id, code)
  WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_company_active
  ON accounts(company_id, is_active, deleted_at);

-- Semeia as contas padrao para empresas ja existentes.
INSERT INTO accounts (id, company_id, code, name, is_system, sort_order, is_active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, a.code, a.name, 1, a.sort_order, 1, datetime('now'), datetime('now')
FROM companies c
CROSS JOIN (
  SELECT 'caixinha' AS code, 'Caixinha' AS name, 1 AS sort_order
  UNION ALL SELECT 'omie_cash', 'OMIE Cash', 2
  UNION ALL SELECT 'getnet', 'GetNet', 3
) a
WHERE NOT EXISTS (
  SELECT 1 FROM accounts ac
  WHERE ac.company_id = c.id AND ac.code = a.code AND ac.deleted_at IS NULL
);

-- Forma de pagamento: apelido, codigo OMIE e vinculo com a conta.
ALTER TABLE payment_methods ADD COLUMN alias TEXT;
ALTER TABLE payment_methods ADD COLUMN omie_code TEXT;
ALTER TABLE payment_methods ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_methods_company_account
  ON payment_methods(company_id, account_id);

-- Vinculos padrao forma -> conta, pre-configurados conforme operacao.
UPDATE payment_methods SET
  account_id = (
    SELECT ac.id FROM accounts ac
    WHERE ac.company_id = payment_methods.company_id AND ac.code = 'caixinha' AND ac.deleted_at IS NULL
  ),
  updated_at = datetime('now')
WHERE code = 'cash' AND account_id IS NULL AND deleted_at IS NULL;

UPDATE payment_methods SET
  account_id = (
    SELECT ac.id FROM accounts ac
    WHERE ac.company_id = payment_methods.company_id AND ac.code = 'omie_cash' AND ac.deleted_at IS NULL
  ),
  updated_at = datetime('now')
WHERE code IN ('pix', 'boleto') AND account_id IS NULL AND deleted_at IS NULL;

UPDATE payment_methods SET
  account_id = (
    SELECT ac.id FROM accounts ac
    WHERE ac.company_id = payment_methods.company_id AND ac.code = 'getnet' AND ac.deleted_at IS NULL
  ),
  updated_at = datetime('now')
WHERE code IN ('debit_card', 'credit_card') AND account_id IS NULL AND deleted_at IS NULL;
`
  },
  {
    version: 28,
    name: "bind_customer_credit_to_omie_cash",
    sql: `
-- Credito do cliente (fiado) e lancado uma unica vez no OMIE pela conta OMIE Cash
-- (nao mais pela caixinha), no fechamento da fatura.
UPDATE payment_methods SET
  account_id = (
    SELECT ac.id FROM accounts ac
    WHERE ac.company_id = payment_methods.company_id AND ac.code = 'omie_cash' AND ac.deleted_at IS NULL
  ),
  updated_at = datetime('now')
WHERE code = 'customer_credit' AND account_id IS NULL AND deleted_at IS NULL;
`
  },
  {
    version: 29,
    name: "customer_credit_periodicity",
    sql: `
-- Periodicidade do fechamento do credito do cliente (fiado):
--  monthly  -> credit_closing_day + credit_boleto_days;
--  biweekly -> credit_closing_day/credit_boleto_days (1o) + credit_second_closing_day/credit_second_boleto_days (2o);
--  weekly   -> credit_closing_weekday (0=domingo..6=sabado) + credit_boleto_days.
ALTER TABLE customers ADD COLUMN credit_periodicity TEXT NOT NULL DEFAULT 'monthly'
  CHECK (credit_periodicity IN ('monthly', 'biweekly', 'weekly'));
ALTER TABLE customers ADD COLUMN credit_second_closing_day INTEGER;
ALTER TABLE customers ADD COLUMN credit_second_boleto_days INTEGER;
ALTER TABLE customers ADD COLUMN credit_closing_weekday INTEGER;
`
  },
  {
    version: 30,
    name: "omie_payment_terms_registry_and_link",
    sql: `
-- Condicoes de parcelamento (parcelas) espelhadas do OMIE, apenas para consulta/vinculo.
-- O KyberRock continua dono das condicoes locais (payment_terms); esta tabela guarda os
-- codigos de parcela do OMIE (ex: "000", "030") para que uma condicao local possa ser
-- vinculada e enviada no codigo_parcela/cCodParc do pedido/OS.
CREATE TABLE IF NOT EXISTS omie_payment_terms (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  omie_id INTEGER,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  first_installment_days INTEGER,
  installment_interval_days INTEGER,
  installment_count INTEGER,
  installment_type TEXT,
  installment_days_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  updated_from_omie_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_omie_payment_terms_company_code
  ON omie_payment_terms(company_id, code);
CREATE INDEX IF NOT EXISTS idx_omie_payment_terms_company_active
  ON omie_payment_terms(company_id, is_active);

-- Vinculo opcional de uma condicao local ao codigo de parcela do OMIE. Distinto de
-- payment_terms.omie_code (legado, marca condicoes importadas e nao editaveis): aqui o
-- usuario associa manualmente sua condicao local a um codigo do OMIE.
ALTER TABLE payment_terms ADD COLUMN omie_parcela_code TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_terms_omie_parcela
  ON payment_terms(company_id, omie_parcela_code);
`
  },
  {
    version: 31,
    name: "weighing_operation_payment_method",
    sql: `
-- Meio de pagamento escolhido na operacao. No fechamento, o codigo OMIE do meio e o
-- codigo OMIE da conta vinculada (payment_methods.account_id -> accounts.omie_code)
-- seguem no job de criacao do pedido/OS para o OMIE.
ALTER TABLE weighing_operations ADD COLUMN payment_method_id TEXT REFERENCES payment_methods(id);

CREATE INDEX IF NOT EXISTS idx_weighing_operations_payment_method
  ON weighing_operations(payment_method_id);
`
  },
  {
    version: 32,
    name: "weighing_operation_freight_type",
    sql: `
-- Tipo (modalidade) de frete da operacao: CIF, FOB, terceiros, transporte proprio
-- (remetente/destinatario) ou sem frete. Segue no pedido de venda do OMIE como o codigo
-- "modalidade" do frete (modFrete da NF-e: 0/1/2/3/4/9). Substitui a antiga caixa
-- "transportadora propria do cliente" (own_recipient) e a parte CIF/FOB da caixa
-- "operacao com frete". Default 'none' (sem frete) para operacoes ja existentes.
ALTER TABLE weighing_operations ADD COLUMN freight_type TEXT NOT NULL DEFAULT 'none'
  CHECK (freight_type IN ('cif', 'fob', 'third_party', 'own_sender', 'own_recipient', 'none'));
`
  },
  {
    version: 33,
    name: "seed_payment_methods_default_omie_code",
    sql: `
-- Preenche o codigo do meio de pagamento no OMIE/NF-e (tPag) das formas padrao do sistema
-- que ainda estao sem codigo, para o pedido de venda levar o meio de pagamento (antes ia
-- vazio -> "nao informado" no OMIE) mesmo sem sincronizar os meios do OMIE. Sao codigos
-- padronizados; nao mexe em formas que ja tem codigo (vindo da sincronizacao do OMIE).
UPDATE payment_methods SET omie_code = '01' WHERE code = 'cash' AND omie_code IS NULL AND is_system = 1 AND deleted_at IS NULL;
UPDATE payment_methods SET omie_code = '17' WHERE code = 'pix' AND omie_code IS NULL AND is_system = 1 AND deleted_at IS NULL;
UPDATE payment_methods SET omie_code = '03' WHERE code = 'credit_card' AND omie_code IS NULL AND is_system = 1 AND deleted_at IS NULL;
UPDATE payment_methods SET omie_code = '04' WHERE code = 'debit_card' AND omie_code IS NULL AND is_system = 1 AND deleted_at IS NULL;
UPDATE payment_methods SET omie_code = '15' WHERE code = 'boleto' AND omie_code IS NULL AND is_system = 1 AND deleted_at IS NULL;
`
  },
  {
    version: 34,
    name: "device_color_multi_desktop",
    sql: `
-- Multi-desktop por pedreira: cada computador tem uma cor (atribuida na nuvem
-- pela ativacao) usada no contorno das operacoes e na legenda. A tabela devices
-- passa a espelhar tambem os dispositivos das outras maquinas da unidade
-- (recebidos via desktop-status/desktop-pull) para satisfazer a FK
-- weighing_operations.device_id e alimentar a legenda.
ALTER TABLE devices ADD COLUMN color TEXT;
`
  },
  {
    version: 35,
    name: "report_recipients_base_table",
    sql: `
-- Destinatarios dos relatorios automaticos. A tabela era criada sob demanda
-- (so quando a tela de Relatorios era aberta), entao um desktop recem-instalado
-- quebrava a sincronizacao cloud com "no such table: report_recipients" antes de
-- o operador abrir a tela. Criada aqui para existir em toda instalacao nova; o
-- ensureRecipientsTable continua cuidando das bases antigas (colunas legadas).
CREATE TABLE IF NOT EXISTS report_recipients (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  email TEXT,
  whatsapp_phone TEXT,
  send_email INTEGER NOT NULL DEFAULT 1 CHECK (send_email IN (0, 1)),
  send_whatsapp INTEGER NOT NULL DEFAULT 0 CHECK (send_whatsapp IN (0, 1)),
  schedule_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (schedule_frequency IN ('daily', 'weekly', 'monthly')),
  schedule_time TEXT NOT NULL DEFAULT '20:00',
  report_types TEXT NOT NULL DEFAULT 'sales' CHECK (report_types IN ('sales', 'trucks', 'both')),
  send_financial INTEGER NOT NULL DEFAULT 0 CHECK (send_financial IN (0, 1)),
  financial_schedule_time TEXT,
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  needs_push INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('synced', 'pending', 'error')),
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_report_recipients_company_active
  ON report_recipients(company_id, is_active, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_recipients_company_whatsapp
  ON report_recipients(company_id, whatsapp_phone)
  WHERE whatsapp_phone IS NOT NULL;

-- Vinculo veiculo <-> transportadora (v3) tambem entra no espelho compartilhado
-- da pedreira: os indices abaixo servem a leitura por veiculo/transportadora
-- feita a cada sincronizacao.
CREATE INDEX IF NOT EXISTS idx_vehicle_carriers_vehicle ON vehicle_carriers(vehicle_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_carriers_carrier ON vehicle_carriers(carrier_id, is_active, deleted_at);
`
  },
  {
    version: 36,
    name: "device_number_receipt_suffix",
    sql: `
-- Numero do computador dentro da pedreira, atribuido pela nuvem na ativacao.
-- Cada balanca continua numerando o cupom offline pela propria sequencia; o
-- sufixo (000000101-2) e o que impede duas maquinas de emitirem o mesmo numero.
ALTER TABLE devices ADD COLUMN device_number INTEGER;

-- Numero gravado junto do cupom: o reimpresso e os relatorios mostram
-- exatamente o que saiu no papel, mesmo vindo de outra maquina.
ALTER TABLE print_receipts ADD COLUMN device_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_print_receipts_unit_number
  ON print_receipts(unit_id, receipt_number, device_number);
`
  },
  {
    version: 37,
    name: "remote_operation_snapshot",
    sql: `
-- Multi-desktop: a projecao cloud de uma operacao carrega placa/motorista/cliente/produto
-- como texto (a nuvem nao guarda o vinculo com o cadastro local). Sem estas colunas a
-- operacao criada na outra balanca chegava sem placa nem motorista — visualmente vazia
-- na tela de Operacoes. O snapshot e apenas fallback de exibicao: quando o cadastro
-- correspondente existe localmente, o vinculo real (vehicle_id/driver_id/...) prevalece.
ALTER TABLE weighing_operations ADD COLUMN remote_plate TEXT;
ALTER TABLE weighing_operations ADD COLUMN remote_driver_name TEXT;
ALTER TABLE weighing_operations ADD COLUMN remote_customer_name TEXT;
ALTER TABLE weighing_operations ADD COLUMN remote_product_description TEXT;

-- Reconciliacao de envio: operacao com alteracao local ainda nao confirmada na nuvem
-- (cloud_synced_at nulo ou anterior a updated_at) e reenviada a cada sincronizacao,
-- mesmo que o job da fila tenha morrido depois das tentativas.
CREATE INDEX IF NOT EXISTS idx_operations_cloud_pending
  ON weighing_operations(updated_at, cloud_synced_at);

-- Carimbos gravados por datetime('now') ("2026-07-29 17:00:48") sao UTC mas sem o
-- indicador de fuso, e conviviam na mesma coluna com o ISO do lado JS. Misturados,
-- a comparacao de qual versao e a mais nova (entre as duas balancas) dava errado.
-- Normaliza o historico para ISO; o instante e exatamente o mesmo.
UPDATE weighing_operations
SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
WHERE updated_at LIKE '____-__-__ __:__:__';
UPDATE weighing_operations
SET cloud_synced_at = REPLACE(cloud_synced_at, ' ', 'T') || 'Z'
WHERE cloud_synced_at LIKE '____-__-__ __:__:__';

-- Historico antigo entra como ja confirmado: a reconciliacao existe para
-- recuperar o que ficou preso nos ultimos dias, nao para reenviar meses de
-- operacoes de uma vez na primeira sincronizacao apos a atualizacao.
UPDATE weighing_operations
SET cloud_synced_at = updated_at
WHERE cloud_synced_at IS NULL
  AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days');
`
  },
  {
    version: 38,
    name: "omie_categories_and_product_category",
    sql: `
-- Categorias (plano de contas gerencial) espelhadas do OMIE, apenas para consulta e
-- vinculo. O pedido de venda enviava um codigo de categoria FIXO ("1.01.01"), entao toda
-- venda caia na mesma categoria no OMIE independentemente do produto vendido.
CREATE TABLE IF NOT EXISTS omie_categories (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  category_type TEXT,
  parent_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  updated_from_omie_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_omie_categories_company_code
  ON omie_categories(company_id, code);
CREATE INDEX IF NOT EXISTS idx_omie_categories_company_active
  ON omie_categories(company_id, is_active);

-- Categoria OMIE do produto: quando definida, vai no codigo_categoria do pedido de
-- venda daquela operacao. Vazia = cai no padrao da unidade (local_settings) e, sem ele,
-- no "1.01.01" historico.
ALTER TABLE products ADD COLUMN omie_category_code TEXT;

CREATE INDEX IF NOT EXISTS idx_products_omie_category
  ON products(company_id, omie_category_code);
`
  },
  {
    version: 39,
    name: "merge_duplicate_customers_and_carriers",
    sql: `
-- Limpeza das duplicatas que ja existem no banco. Elas nasceram de dois furos ja
-- fechados: cadastro sem trava por CNPJ/CPF, e o pull do OMIE inserindo o cadastro
-- que voltava de la como linha nova ao lado da local. A trava impede novas, mas as
-- antigas continuariam aparecendo em duplicidade na lista.
--
-- Sobrevive, por grupo (empresa + digitos do documento): a linha ja vinculada ao
-- OMIE; empatando, a mais antiga. As demais tem suas referencias repontadas para a
-- sobrevivente e viram soft-delete.

CREATE TEMP TABLE customer_dedup AS
SELECT c.id AS loser_id,
       (SELECT k.id
          FROM customers k
         WHERE k.company_id = c.company_id
           AND k.deleted_at IS NULL
           AND replace(replace(replace(replace(COALESCE(k.document, ''), '.', ''), '-', ''), '/', ''), ' ', '')
             = replace(replace(replace(replace(COALESCE(c.document, ''), '.', ''), '-', ''), '/', ''), ' ', '')
         ORDER BY (CASE WHEN k.omie_customer_id IS NOT NULL THEN 0 ELSE 1 END), k.created_at, k.id
         LIMIT 1) AS keeper_id
  FROM customers c
 WHERE c.deleted_at IS NULL
   AND replace(replace(replace(replace(COALESCE(c.document, ''), '.', ''), '-', ''), '/', ''), ' ', '') <> '';

DELETE FROM customer_dedup WHERE keeper_id IS NULL OR keeper_id = loser_id;

-- Vinculos com indice unico por (cliente, ...): a linha da perdedora que colidiria
-- com uma ja existente na sobrevivente e descartada antes do repontamento.
UPDATE customer_special_prices
   SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
 WHERE deleted_at IS NULL
   AND customer_id IN (SELECT loser_id FROM customer_dedup)
   AND EXISTS (
     SELECT 1 FROM customer_special_prices keep
      JOIN customer_dedup d ON d.loser_id = customer_special_prices.customer_id
      WHERE keep.customer_id = d.keeper_id
        AND keep.product_id = customer_special_prices.product_id
        AND keep.deleted_at IS NULL
   );

UPDATE customer_freight_rules
   SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
 WHERE deleted_at IS NULL
   AND customer_id IN (SELECT loser_id FROM customer_dedup)
   AND EXISTS (
     SELECT 1 FROM customer_freight_rules keep
      JOIN customer_dedup d ON d.loser_id = customer_freight_rules.customer_id
      WHERE keep.customer_id = d.keeper_id
        AND keep.deleted_at IS NULL
        AND ((keep.product_id IS NULL AND customer_freight_rules.product_id IS NULL)
             OR keep.product_id = customer_freight_rules.product_id)
   );

UPDATE customer_carriers
   SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
 WHERE deleted_at IS NULL
   AND customer_id IN (SELECT loser_id FROM customer_dedup)
   AND EXISTS (
     SELECT 1 FROM customer_carriers keep
      JOIN customer_dedup d ON d.loser_id = customer_carriers.customer_id
      WHERE keep.customer_id = d.keeper_id
        AND keep.carrier_id = customer_carriers.carrier_id
        AND keep.deleted_at IS NULL
   );

UPDATE weighing_operations
   SET customer_id = (SELECT keeper_id FROM customer_dedup WHERE loser_id = weighing_operations.customer_id)
 WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

UPDATE quotations
   SET customer_id = (SELECT keeper_id FROM customer_dedup WHERE loser_id = quotations.customer_id)
 WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

UPDATE customer_price_tables
   SET customer_id = (SELECT keeper_id FROM customer_dedup WHERE loser_id = customer_price_tables.customer_id)
 WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

UPDATE customer_special_prices
   SET customer_id = (SELECT keeper_id FROM customer_dedup WHERE loser_id = customer_special_prices.customer_id)
 WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

UPDATE customer_freight_rules
   SET customer_id = (SELECT keeper_id FROM customer_dedup WHERE loser_id = customer_freight_rules.customer_id)
 WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

UPDATE customer_carriers
   SET customer_id = (SELECT keeper_id FROM customer_dedup WHERE loser_id = customer_carriers.customer_id)
 WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

-- Extrato de credito: os movimentos das duas linhas viram um so, e o saldo da
-- sobrevivente e recalculado a partir do log unificado.
UPDATE customer_credit_movements
   SET customer_id = (SELECT keeper_id FROM customer_dedup WHERE loser_id = customer_credit_movements.customer_id)
 WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

DELETE FROM customer_credit_balances WHERE customer_id IN (SELECT loser_id FROM customer_dedup);

INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
SELECT d.keeper_id,
       COALESCE((SELECT SUM(CASE WHEN m.movement_type IN ('debit_product', 'debit_freight')
                                 THEN -m.amount_cents ELSE m.amount_cents END)
                   FROM customer_credit_movements m
                  WHERE m.customer_id = d.keeper_id), 0),
       datetime('now')
  FROM (SELECT DISTINCT keeper_id FROM customer_dedup) d
-- WHERE obrigatorio: sem ele o SQLite le "d ON CONFLICT" como um JOIN e falha.
 WHERE true
    ON CONFLICT(customer_id) DO UPDATE SET
      balance_cents = excluded.balance_cents,
      updated_at = excluded.updated_at;

UPDATE customers
   SET deleted_at = datetime('now'),
       is_active = 0,
       needs_push = 0,
       updated_at = datetime('now')
 WHERE id IN (SELECT loser_id FROM customer_dedup);

DROP TABLE customer_dedup;

-- Mesma limpeza para transportadoras.
CREATE TEMP TABLE carrier_dedup AS
SELECT c.id AS loser_id,
       (SELECT k.id
          FROM carriers k
         WHERE k.company_id = c.company_id
           AND k.deleted_at IS NULL
           AND replace(replace(replace(replace(COALESCE(k.document, ''), '.', ''), '-', ''), '/', ''), ' ', '')
             = replace(replace(replace(replace(COALESCE(c.document, ''), '.', ''), '-', ''), '/', ''), ' ', '')
         ORDER BY (CASE WHEN k.omie_customer_id IS NOT NULL THEN 0 ELSE 1 END), k.created_at, k.id
         LIMIT 1) AS keeper_id
  FROM carriers c
 WHERE c.deleted_at IS NULL
   AND replace(replace(replace(replace(COALESCE(c.document, ''), '.', ''), '-', ''), '/', ''), ' ', '') <> '';

DELETE FROM carrier_dedup WHERE keeper_id IS NULL OR keeper_id = loser_id;

UPDATE customer_carriers
   SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
 WHERE deleted_at IS NULL
   AND carrier_id IN (SELECT loser_id FROM carrier_dedup)
   AND EXISTS (
     SELECT 1 FROM customer_carriers keep
      JOIN carrier_dedup d ON d.loser_id = customer_carriers.carrier_id
      WHERE keep.carrier_id = d.keeper_id
        AND keep.customer_id = customer_carriers.customer_id
        AND keep.deleted_at IS NULL
   );

UPDATE vehicle_carriers
   SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
 WHERE deleted_at IS NULL
   AND carrier_id IN (SELECT loser_id FROM carrier_dedup)
   AND EXISTS (
     SELECT 1 FROM vehicle_carriers keep
      JOIN carrier_dedup d ON d.loser_id = vehicle_carriers.carrier_id
      WHERE keep.carrier_id = d.keeper_id
        AND keep.vehicle_id = vehicle_carriers.vehicle_id
        AND keep.deleted_at IS NULL
   );

UPDATE driver_carriers
   SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
 WHERE deleted_at IS NULL
   AND carrier_id IN (SELECT loser_id FROM carrier_dedup)
   AND EXISTS (
     SELECT 1 FROM driver_carriers keep
      JOIN carrier_dedup d ON d.loser_id = driver_carriers.carrier_id
      WHERE keep.carrier_id = d.keeper_id
        AND keep.driver_id = driver_carriers.driver_id
        AND keep.deleted_at IS NULL
   );

UPDATE customer_carriers
   SET carrier_id = (SELECT keeper_id FROM carrier_dedup WHERE loser_id = customer_carriers.carrier_id)
 WHERE carrier_id IN (SELECT loser_id FROM carrier_dedup);

UPDATE vehicle_carriers
   SET carrier_id = (SELECT keeper_id FROM carrier_dedup WHERE loser_id = vehicle_carriers.carrier_id)
 WHERE carrier_id IN (SELECT loser_id FROM carrier_dedup);

UPDATE driver_carriers
   SET carrier_id = (SELECT keeper_id FROM carrier_dedup WHERE loser_id = driver_carriers.carrier_id)
 WHERE carrier_id IN (SELECT loser_id FROM carrier_dedup);

UPDATE vehicles
   SET carrier_id = (SELECT keeper_id FROM carrier_dedup WHERE loser_id = vehicles.carrier_id)
 WHERE carrier_id IN (SELECT loser_id FROM carrier_dedup);

UPDATE weighing_operations
   SET carrier_id = (SELECT keeper_id FROM carrier_dedup WHERE loser_id = weighing_operations.carrier_id)
 WHERE carrier_id IN (SELECT loser_id FROM carrier_dedup);

UPDATE customers
   SET default_carrier_id = (SELECT keeper_id FROM carrier_dedup WHERE loser_id = customers.default_carrier_id)
 WHERE default_carrier_id IN (SELECT loser_id FROM carrier_dedup);

UPDATE carriers
   SET deleted_at = datetime('now'),
       is_active = 0,
       needs_push = 0,
       updated_at = datetime('now')
 WHERE id IN (SELECT loser_id FROM carrier_dedup);

DROP TABLE carrier_dedup;
`
  },
  {
    version: 40,
    name: "vehicle_plate_state",
    sql: `
-- UF da placa do veiculo: e o \`uf_placa\` do bloco frete do pedido de venda do OMIE
-- (a NF-e pede placa E UF do veiculo no transporte). Vem do cadastro de veiculos do
-- OMIE no sync (\`ListarVeiculos\`) e pode ser corrigida a mao no cadastro local.
ALTER TABLE vehicles ADD COLUMN plate_state TEXT;
`
  },
  {
    version: 41,
    name: "credit_movement_omie_origin",
    sql: `
-- Origem do lancamento no extrato de credito. Os adiantamentos do cliente sao
-- registrados no financeiro do OMIE (titulo a receber numa categoria de
-- adiantamento, baixado quando o dinheiro entra); o desktop apenas espelha esse
-- valor para que as compras da balanca sejam abatidas do saldo. Sem marcar a
-- origem nao da para distinguir o que veio do OMIE do que o operador lancou a
-- mao — e o mesmo adiantamento entraria duas vezes no saldo.
ALTER TABLE customer_credit_movements ADD COLUMN source TEXT NOT NULL DEFAULT 'local';

-- codigo_lancamento_omie do titulo a receber que originou o adiantamento.
-- E a chave de idempotencia: reimportar a mesma pagina do OMIE nao pode somar
-- credito de novo.
ALTER TABLE customer_credit_movements ADD COLUMN omie_title_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_credit_movements_omie_title
  ON customer_credit_movements(company_id, omie_title_id, movement_type)
  WHERE omie_title_id IS NOT NULL;

-- Leitura da aba Credito: separa no extrato o que veio do OMIE do que foi
-- lancado na balanca.
CREATE INDEX IF NOT EXISTS idx_customer_credit_movements_source
  ON customer_credit_movements(customer_id, source);
`
  },
  {
    version: 42,
    name: "operation_omie_advance_settlement",
    sql: `
-- Baixa do adiantamento no OMIE. O debito do adiantamento acontece aqui no
-- fechamento, mas o dinheiro esta na conta corrente de adiantamentos do OMIE:
-- sem dar a baixa la, o saldo do KyberRock caia e o do OMIE nao, e os dois
-- lados so batiam com conferencia manual do financeiro.
--
-- Quanto desta operacao deve ser amortizado do adiantamento no OMIE (limitado
-- ao adiantamento disponivel no momento do fechamento).
ALTER TABLE weighing_operations ADD COLUMN omie_advance_settle_cents INTEGER NOT NULL DEFAULT 0;

-- Quanto ja foi efetivamente baixado la (permite baixa parcial e retomada).
ALTER TABLE weighing_operations ADD COLUMN omie_advance_settled_cents INTEGER NOT NULL DEFAULT 0;

-- pending | settled | partial | error — o que mostrar ao operador.
ALTER TABLE weighing_operations ADD COLUMN omie_advance_status TEXT;
ALTER TABLE weighing_operations ADD COLUMN omie_advance_message TEXT;
ALTER TABLE weighing_operations ADD COLUMN omie_advance_settled_at TEXT;

-- Fila de baixas pendentes por cliente (quanto do adiantamento ja foi consumido
-- la), consultada a cada fechamento para nao amortizar mais do que existe.
CREATE INDEX IF NOT EXISTS idx_weighing_operations_advance_settlement
  ON weighing_operations(customer_id, omie_advance_status);
`
  },
  {
    version: 43,
    name: "wallet_payment_method_and_settlement",
    sql: `
-- Forma de pagamento "Em carteira": a venda sai da balanca sem forma de recebimento
-- definida e fica na carteira ate um fechamento futuro, onde o operador define COMO o
-- cliente paga (dinheiro, PIX, boleto, ...) e para quando. Distinto do credito do
-- cliente (fiado), que consome o limite/saldo do cadastro: em carteira a venda nao
-- mexe no credito, apenas fica aguardando o fechamento.
ALTER TABLE payment_methods ADD COLUMN is_wallet INTEGER NOT NULL DEFAULT 0
  CHECK (is_wallet IN (0, 1));

-- Seed da forma para as empresas ja cadastradas (as novas passam pelo
-- ensureDefaultPaymentMethods). O tPag "99" (outros) faz o pedido/OS sair com
-- nao_gerar_boleto "S": a NF e emitida, mas o OMIE nao gera cobranca — ela so nasce
-- quando o fechamento define a forma de recebimento.
INSERT INTO payment_methods
  (id, company_id, code, name, omie_code, is_system, is_customer_credit, is_wallet,
   sort_order, is_active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, 'wallet', 'Em carteira', '99', 1, 0, 1,
       7, 1, datetime('now'), datetime('now')
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm
  WHERE pm.company_id = c.id AND pm.code = 'wallet' AND pm.deleted_at IS NULL
);

-- A carteira e lancada no OMIE pela OMIE Cash, como o fiado e o boleto.
UPDATE payment_methods SET
  account_id = (
    SELECT ac.id FROM accounts ac
    WHERE ac.company_id = payment_methods.company_id AND ac.code = 'omie_cash'
      AND ac.deleted_at IS NULL
  ),
  updated_at = datetime('now')
WHERE code = 'wallet' AND account_id IS NULL AND deleted_at IS NULL;

-- Fechamento da venda em carteira, guardado na propria operacao: qual forma de
-- recebimento foi definida, para quando, quando o fechamento foi feito e a observacao
-- do operador. Enquanto wallet_settled_at for NULL a venda esta em aberto na carteira.
ALTER TABLE weighing_operations ADD COLUMN wallet_settlement_method_id TEXT
  REFERENCES payment_methods(id);
ALTER TABLE weighing_operations ADD COLUMN wallet_settlement_due_date TEXT;
ALTER TABLE weighing_operations ADD COLUMN wallet_settled_at TEXT;
ALTER TABLE weighing_operations ADD COLUMN wallet_settlement_note TEXT;

-- Leitura da tela Carteira: as vendas em aberto de um meio "em carteira".
CREATE INDEX IF NOT EXISTS idx_weighing_operations_wallet
  ON weighing_operations(payment_method_id, wallet_settled_at);
`
  },
  {
    version: 44,
    name: "customer_fiscal_emails",
    sql: `
-- E-mails da NF-e do cliente, separados do e-mail de contato. Sao os destinatarios do
-- "Utilizar os seguintes enderecos de e-mail" da aba Recomendacoes do cadastro do OMIE
-- (tag \`email_fatura\`), que o OMIE prioriza no envio da nota e do boleto. O \`email\`
-- continua sendo so o contato do cliente.
ALTER TABLE customers ADD COLUMN fiscal_emails TEXT;
`
  },
  {
    version: 45,
    name: "bonificacao_and_carteira_accounts",
    sql: `
-- Contas BONIFICACAO e EM CARTEIRA para as empresas que ja existem (as novas passam
-- pelo ensureDefaultAccounts). O vinculo com a conta corrente de mesmo nome no OMIE e
-- feito pela sincronizacao, que preenche o omie_code (ver canonicalDefaultAccountCode).
INSERT INTO accounts (id, company_id, code, name, is_system, sort_order, is_active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, a.code, a.name, 1, a.sort_order, 1,
       datetime('now'), datetime('now')
FROM companies c
CROSS JOIN (
  SELECT 'bonificacao' AS code, 'BONIFICAÇÃO' AS name, 4 AS sort_order
  UNION ALL SELECT 'em_carteira', 'EM CARTEIRA', 5
) a
WHERE NOT EXISTS (
  SELECT 1 FROM accounts ac
  WHERE ac.company_id = c.id AND ac.code = a.code AND ac.deleted_at IS NULL
);
`
  },
  {
    version: 46,
    name: "operation_sequential_code",
    sql: `
-- Codigo sequencial da operacao, impresso no topo do cupom (000001, 000002, ...). E uma
-- sequencia unica por pedreira: cada operacao nova pega o maior codigo ja usado + 1,
-- independente de cliente, produto ou balanca. Distinto do numero do cupom
-- (units.receipt_sequence), que conta IMPRESSOES e reinicia a cada via.
ALTER TABLE weighing_operations ADD COLUMN operation_code INTEGER;

-- As operacoes que ja existem entram na sequencia pela ordem em que nasceram, para o
-- codigo continuar de onde a pedreira parou em vez de recomecar do 1.
UPDATE weighing_operations SET operation_code = (
  SELECT seq FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY created_at ASC, id ASC) AS seq
    FROM weighing_operations
  ) numbered
  WHERE numbered.id = weighing_operations.id
)
WHERE operation_code IS NULL;

-- Leitura do proximo codigo (MAX por pedreira) a cada operacao nova.
CREATE INDEX IF NOT EXISTS idx_weighing_operations_code
  ON weighing_operations(unit_id, operation_code);
`
  },
  {
    version: 47,
    name: "bonificacao_method_and_carteira_account_binding",
    sql: `
-- Cada forma na sua conta corrente do OMIE: a venda em carteira sai da OMIE Cash e passa
-- a lancar na conta EM CARTEIRA (migracao 45). O UPDATE nao filtra por account_id nulo de
-- proposito — o vinculo antigo (OMIE Cash) existe e e justamente ele que muda.
UPDATE payment_methods SET
  account_id = (
    SELECT ac.id FROM accounts ac
    WHERE ac.company_id = payment_methods.company_id AND ac.code = 'em_carteira'
      AND ac.deleted_at IS NULL
  ),
  updated_at = datetime('now')
WHERE code = 'wallet' AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM accounts ac
    WHERE ac.company_id = payment_methods.company_id AND ac.code = 'em_carteira'
      AND ac.deleted_at IS NULL
  );

-- Forma de pagamento "Bonificacao", lancada na conta BONIFICACAO. Vai ao OMIE como
-- "99 - outros" (mesmo tPag da carteira), que faz o pedido sair com nao_gerar_boleto "S":
-- a nota da mercadoria bonificada e emitida e nenhuma cobranca nasce dela.
INSERT INTO payment_methods
  (id, company_id, code, name, omie_code, account_id, is_system, is_customer_credit, is_wallet,
   sort_order, is_active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), c.id, 'bonificacao', 'Bonificação', '99',
       (SELECT ac.id FROM accounts ac
        WHERE ac.company_id = c.id AND ac.code = 'bonificacao' AND ac.deleted_at IS NULL),
       1, 0, 0, 8, 1, datetime('now'), datetime('now')
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm
  WHERE pm.company_id = c.id AND pm.code = 'bonificacao' AND pm.deleted_at IS NULL
);
`
  },
  {
    version: 48,
    name: "operation_and_sync_queue_read_indexes",
    sql: `
-- As tres listagens da tela de operacoes (abertas, concluidas, canceladas) filtram por
-- status + deleted_at IS NULL e ordenam por created_at/updated_at. Nenhum indice cobria
-- esse recorte, entao cada leitura varria a tabela inteira -- e as tres rodam juntas a
-- cada 15s no tick do multi-desktop. Indice PARCIAL porque "deleted_at IS NULL" e
-- constante nas tres consultas: mantem o indice do tamanho do que esta vivo, nao do
-- historico apagado. Sem DESC na definicao de proposito: o SQLite percorre o indice nos
-- dois sentidos, entao um indice ASC ja serve o ORDER BY ... DESC das listagens.
CREATE INDEX IF NOT EXISTS idx_weighing_operations_live_status_updated
  ON weighing_operations(status, updated_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_weighing_operations_live_status_created
  ON weighing_operations(status, created_at)
  WHERE deleted_at IS NULL;

-- listRunnableSyncJobs filtra "target = ? AND status IN (...) AND next_attempt_at <= ?".
-- O indice existente (status, target, next_attempt_at) tem a coluna lider errada para
-- esse acesso; este segue a ordem real do WHERE.
CREATE INDEX IF NOT EXISTS idx_sync_queue_target_status_next_attempt
  ON sync_queue(target, status, next_attempt_at);

-- listOmieQueueItems (tela cloud) filtra target='omie' + status e ordena por created_at.
CREATE INDEX IF NOT EXISTS idx_sync_queue_target_status_created
  ON sync_queue(target, status, created_at);

-- Poda dos jobs ja concluidos (pruneCompletedSyncJobs), que roda junto do backup diario.
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_updated
  ON sync_queue(status, updated_at);
`
  }
];
