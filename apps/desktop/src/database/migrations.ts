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
  status TEXT NOT NULL CHECK (status IN ('draft', 'entry_registered', 'loading_requested', 'awaiting_exit', 'closed_local', 'pending_firebase', 'pending_omie', 'synced', 'sync_error', 'cancelled')),
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
  firebase_synced_at TEXT,
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
  target TEXT NOT NULL CHECK (target IN ('firebase', 'omie')),
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
  }
];
