import type { DesktopDatabase } from "../database/sqlite.js";
import { isSellableProduct } from "./product-classification.js";

export interface CustomerCacheEntry {
  id: string;
  omieCustomerId: number | null;
  legalName: string;
  tradeName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  creditLimitCents: number | null;
  creditMode: "normal" | "prepaid";
  openReceivablesCents: number;
  omieBillingBlocked: boolean;
  source: "omie" | "local" | "hybrid";
  syncStatus: "synced" | "pending" | "error";
  needsPush: boolean;
  lastSyncedAt: string | null;
  observations: string | null;
  defaultCarrierId: string | null;
  defaultPaymentTermId: string | null;
  defaultPaymentMethodId: string | null;
  creditAccountEnabled: boolean;
  creditClosingDay: number | null;
  creditBoletoDays: number | null;
  nfRequired: boolean;
  creditPeriodicity: "monthly" | "biweekly" | "weekly";
  creditSecondClosingDay: number | null;
  creditSecondBoletoDays: number | null;
  creditClosingWeekday: number | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

export interface ProductCacheEntry {
  id: string;
  omieProductId: number | null;
  code: string;
  description: string;
  unit: string;
  ncm: string | null;
  ean: string | null;
  unitPriceCents: number | null;
  itemType: string | null;
  fiscalRecommendationsJson: string | null;
  isActive: boolean;
}

export interface VehicleCacheEntry {
  id: string;
  plate: string;
  description: string | null;
  carrierId: string | null;
  isActive: boolean;
}

export interface DriverCacheEntry {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  isIndependent: boolean;
  isActive: boolean;
}

export interface CarrierCacheEntry {
  id: string;
  omieCustomerId: number | null;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  nfRequired: boolean;
  source: "omie" | "local";
  syncStatus: "synced" | "pending" | "error";
  needsPush: boolean;
  lastSyncedAt: string | null;
  isActive: boolean;
}

export interface PaymentTermCacheEntry {
  id: string;
  omieCode: string | null;
  omieParcelaCode: string | null;
  name: string;
  rulesJson: string;
  installmentCount: number | null;
  isActive: boolean;
}

export interface PaymentMethodCacheEntry {
  id: string;
  code: string;
  name: string;
  /** Apelido opcional; quando presente, e o rotulo exibido. */
  alias: string | null;
  /** Nome exibido: apelido quando definido, senao o nome. */
  displayName: string;
  omieCode: string | null;
  accountId: string | null;
  accountName: string | null;
  isSystem: boolean;
  isCustomerCredit: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface AccountCacheEntry {
  id: string;
  code: string | null;
  name: string;
  omieCode: string | null;
  isSystem: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface PriceTableCacheEntry {
  id: string;
  name: string;
  omieTableId: number | null;
  needsPush: boolean;
  lastSyncedAt: string | null;
  isActive: boolean;
}

export interface PriceTableItemCacheEntry {
  id: string;
  priceTableId: string;
  productId: string;
  unitPriceCents: number;
  unit: string;
}

export interface CustomerPriceTableEntry {
  id: string;
  customerId: string;
  priceTableId: string;
}

export type CacheEntityType =
  | "customer"
  | "product"
  | "vehicle"
  | "driver"
  | "carrier"
  | "payment_term"
  | "payment_method"
  | "account"
  | "price_table"
  | "price_table_item"
  | "customer_price_table";

export interface CacheQueryOptions {
  entityType: CacheEntityType;
  search?: string;
  companyId?: string;
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
  productFiscalType?: "finished_goods";
}

export interface CacheQueryResult<T> {
  rows: T[];
  total: number;
}

interface CustomerRow {
  id: string;
  omie_customer_id: number | null;
  legal_name: string;
  trade_name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  credit_limit_cents: number | null;
  credit_mode: "normal" | "prepaid";
  open_receivables_cents: number;
  omie_billing_blocked: number;
  source: "omie" | "local" | "hybrid";
  sync_status: "synced" | "pending" | "error";
  needs_push: number;
  last_synced_at: string | null;
  observations: string | null;
  default_carrier_id: string | null;
  default_payment_term_id: string | null;
  default_payment_method_id: string | null;
  credit_account_enabled: number;
  credit_closing_day: number | null;
  credit_boleto_days: number | null;
  nf_required: number;
  credit_periodicity: "monthly" | "biweekly" | "weekly";
  credit_second_closing_day: number | null;
  credit_second_boleto_days: number | null;
  credit_closing_weekday: number | null;
  zipcode: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  is_active: number;
}

interface ProductRow {
  id: string;
  omie_product_id: number | null;
  code: string;
  description: string;
  unit: string;
  ncm: string | null;
  ean: string | null;
  unit_price_cents: number | null;
  item_type: string | null;
  fiscal_recommendations_json: string | null;
  is_active: number;
}

interface VehicleRow {
  id: string;
  plate: string;
  description: string | null;
  carrier_id: string | null;
  is_active: number;
}

interface DriverRow {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  is_independent: number;
  is_active: number;
}

interface CarrierRow {
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
  nf_required: number;
  source: "omie" | "local";
  sync_status: "synced" | "pending" | "error";
  needs_push: number;
  last_synced_at: string | null;
  is_active: number;
}

interface PaymentTermRow {
  id: string;
  omie_code: string | null;
  omie_parcela_code: string | null;
  name: string;
  rules_json: string;
  installment_count: number | null;
  is_active: number;
}

interface PaymentMethodRow {
  id: string;
  code: string;
  name: string;
  alias: string | null;
  omie_code: string | null;
  account_id: string | null;
  account_name: string | null;
  is_system: number;
  is_customer_credit: number;
  sort_order: number;
  is_active: number;
}

interface AccountRow {
  id: string;
  code: string | null;
  name: string;
  omie_code: string | null;
  is_system: number;
  sort_order: number;
  is_active: number;
}

interface PriceTableRow {
  id: string;
  name: string;
  omie_table_id: number | null;
  needs_push: number;
  last_synced_at: string | null;
  is_active: number;
}

interface PriceTableItemRow {
  id: string;
  price_table_id: string;
  product_id: string;
  unit_price_cents: number;
  unit: string;
}

interface CustomerPriceTableRow {
  id: string;
  customer_id: string;
  price_table_id: string;
}

function mapCustomer(row: CustomerRow): CustomerCacheEntry {
  return {
    id: row.id,
    omieCustomerId: row.omie_customer_id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    document: row.document,
    phone: row.phone,
    email: row.email,
    creditLimitCents: row.credit_limit_cents,
    creditMode: row.credit_mode,
    openReceivablesCents: row.open_receivables_cents,
    omieBillingBlocked: row.omie_billing_blocked === 1,
    source: row.source,
    syncStatus: row.sync_status,
    needsPush: row.needs_push === 1,
    lastSyncedAt: row.last_synced_at,
    observations: row.observations,
    defaultCarrierId: row.default_carrier_id,
    defaultPaymentTermId: row.default_payment_term_id,
    defaultPaymentMethodId: row.default_payment_method_id,
    creditAccountEnabled: row.credit_account_enabled === 1,
    creditClosingDay: row.credit_closing_day,
    creditBoletoDays: row.credit_boleto_days,
    nfRequired: row.nf_required === 1,
    creditPeriodicity: row.credit_periodicity,
    creditSecondClosingDay: row.credit_second_closing_day,
    creditSecondBoletoDays: row.credit_second_boleto_days,
    creditClosingWeekday: row.credit_closing_weekday,
    zipcode: row.zipcode,
    addressStreet: row.address_street,
    addressNumber: row.address_number,
    addressComplement: row.address_complement,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    isActive: row.is_active === 1
  };
}

function mapProduct(row: ProductRow): ProductCacheEntry {
  return {
    id: row.id,
    omieProductId: row.omie_product_id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    ncm: row.ncm,
    ean: row.ean,
    unitPriceCents: row.unit_price_cents,
    itemType: row.item_type,
    fiscalRecommendationsJson: row.fiscal_recommendations_json,
    isActive: row.is_active === 1
  };
}

function isFinishedGoodsProduct(product: ProductCacheEntry): boolean {
  return isSellableProduct({
    omieProductId: product.omieProductId,
    itemType: product.itemType,
    fiscalRecommendationsJson: product.fiscalRecommendationsJson,
    isActive: product.isActive
  });
}

function normalizeFiscalTypeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_/.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isManualInstallmentsPaymentTerm(term: PaymentTermCacheEntry): boolean {
  const normalizedName = normalizeFiscalTypeText(term.name);
  return normalizedName.includes("informe") && normalizedName.includes("numero") && normalizedName.includes("parcela");
}

function mapVehicle(row: VehicleRow): VehicleCacheEntry {
  return {
    id: row.id,
    plate: row.plate,
    description: row.description,
    carrierId: row.carrier_id,
    isActive: row.is_active === 1
  };
}

function mapDriver(row: DriverRow): DriverCacheEntry {
  return {
    id: row.id,
    name: row.name,
    document: row.document,
    phone: row.phone,
    isIndependent: row.is_independent === 1,
    isActive: row.is_active === 1
  };
}

function mapCarrier(row: CarrierRow): CarrierCacheEntry {
  return {
    id: row.id,
    omieCustomerId: row.omie_customer_id,
    name: row.name,
    document: row.document,
    phone: row.phone,
    email: row.email,
    zipcode: row.zipcode,
    addressStreet: row.address_street,
    addressNumber: row.address_number,
    addressComplement: row.address_complement,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    nfRequired: row.nf_required === 1,
    source: row.source,
    syncStatus: row.sync_status,
    needsPush: row.needs_push === 1,
    lastSyncedAt: row.last_synced_at,
    isActive: row.is_active === 1
  };
}

function mapPaymentTerm(row: PaymentTermRow): PaymentTermCacheEntry {
  return {
    id: row.id,
    omieCode: row.omie_code,
    omieParcelaCode: row.omie_parcela_code,
    name: row.name,
    rulesJson: row.rules_json,
    installmentCount: row.installment_count,
    isActive: row.is_active === 1
  };
}

function mapPaymentMethod(row: PaymentMethodRow): PaymentMethodCacheEntry {
  const alias = row.alias?.trim() ?? "";
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    alias: row.alias,
    displayName: alias.length > 0 ? alias : row.name,
    omieCode: row.omie_code,
    accountId: row.account_id,
    accountName: row.account_name,
    isSystem: row.is_system === 1,
    isCustomerCredit: row.is_customer_credit === 1,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1
  };
}

function mapAccount(row: AccountRow): AccountCacheEntry {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    omieCode: row.omie_code,
    isSystem: row.is_system === 1,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1
  };
}

function mapPriceTable(row: PriceTableRow): PriceTableCacheEntry {
  return {
    id: row.id,
    name: row.name,
    omieTableId: row.omie_table_id,
    needsPush: row.needs_push === 1,
    lastSyncedAt: row.last_synced_at,
    isActive: row.is_active === 1
  };
}

function mapPriceTableItem(row: PriceTableItemRow): PriceTableItemCacheEntry {
  return {
    id: row.id,
    priceTableId: row.price_table_id,
    productId: row.product_id,
    unitPriceCents: row.unit_price_cents,
    unit: row.unit
  };
}

function mapCustomerPriceTable(row: CustomerPriceTableRow): CustomerPriceTableEntry {
  return {
    id: row.id,
    customerId: row.customer_id,
    priceTableId: row.price_table_id
  };
}

function searchFilter<T extends { [key: string]: unknown }>(
  rows: T[],
  searchFields: (keyof T)[],
  search?: string
): T[] {
  if (!search) return rows;
  const lower = search.toLowerCase();
  return rows.filter((row) =>
    searchFields.some((field) => {
      const value = row[field];
      return typeof value === "string" && value.toLowerCase().includes(lower);
    })
  );
}

export class CacheStore {
  private customers: Map<string, CustomerCacheEntry> = new Map();
  private products: Map<string, ProductCacheEntry> = new Map();
  private vehicles: Map<string, VehicleCacheEntry> = new Map();
  private drivers: Map<string, DriverCacheEntry> = new Map();
  private carriers: Map<string, CarrierCacheEntry> = new Map();
  private paymentTerms: Map<string, PaymentTermCacheEntry> = new Map();
  private paymentMethods: Map<string, PaymentMethodCacheEntry> = new Map();
  private accounts: Map<string, AccountCacheEntry> = new Map();
  private priceTables: Map<string, PriceTableCacheEntry> = new Map();
  private priceTableItems: Map<string, PriceTableItemCacheEntry> = new Map();
  private customerPriceTables: Map<string, CustomerPriceTableEntry> = new Map();
  private loaded = false;

  constructor(private readonly db: DesktopDatabase) {}

  loadAll(companyId: string): void {
    this.loadCustomers(companyId);
    this.loadProducts(companyId);
    this.loadVehicles(companyId);
    this.loadDrivers(companyId);
    this.loadCarriers(companyId);
    this.loadPaymentTerms(companyId);
    this.loadPaymentMethods(companyId);
    this.loadAccounts(companyId);
    this.loadPriceTables(companyId);
    this.loadPriceTableItems();
    this.loadCustomerPriceTables();
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  invalidate(entityType: CacheEntityType, companyId?: string): void {
    switch (entityType) {
      case "customer":
        if (companyId) this.loadCustomers(companyId);
        break;
      case "product":
        if (companyId) this.loadProducts(companyId);
        break;
      case "vehicle":
        if (companyId) this.loadVehicles(companyId);
        break;
      case "driver":
        if (companyId) this.loadDrivers(companyId);
        break;
      case "carrier":
        if (companyId) this.loadCarriers(companyId);
        break;
      case "payment_term":
        if (companyId) this.loadPaymentTerms(companyId);
        break;
      case "payment_method":
        if (companyId) this.loadPaymentMethods(companyId);
        break;
      case "account":
        if (companyId) {
          this.loadAccounts(companyId);
          // O nome da conta e projetado na forma de pagamento.
          this.loadPaymentMethods(companyId);
        }
        break;
      case "price_table":
        if (companyId) this.loadPriceTables(companyId);
        this.loadPriceTableItems();
        this.loadCustomerPriceTables();
        break;
      case "price_table_item":
        this.loadPriceTableItems();
        break;
      case "customer_price_table":
        this.loadCustomerPriceTables();
        break;
    }
  }

  invalidateAll(companyId: string): void {
    this.loadAll(companyId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(options: CacheQueryOptions): CacheQueryResult<any> {
    const {
      entityType,
      search,
      limit = 100,
      offset = 0,
      activeOnly = true,
      productFiscalType
    } = options;

    let rows: unknown[] = this.getAllOfType(entityType);

    if (activeOnly) {
      rows = rows.filter((r) => (r as { isActive?: boolean }).isActive !== false);
    }

    if (entityType === "payment_term") {
      rows = (rows as PaymentTermCacheEntry[]).filter((term) => !isManualInstallmentsPaymentTerm(term));
    }

    if (entityType === "product" && productFiscalType === "finished_goods") {
      rows = (rows as ProductCacheEntry[]).filter((product) => isFinishedGoodsProduct(product));
    }

    if (search) {
      const searchFields = this.getSearchFields(entityType);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows = searchFilter(rows as any[], searchFields as string[], search);
    }

    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);

    return { rows: paged, total };
  }

  getCustomerById(id: string): CustomerCacheEntry | undefined {
    return this.customers.get(id);
  }

  getProductById(id: string): ProductCacheEntry | undefined {
    return this.products.get(id);
  }

  getVehicleById(id: string): VehicleCacheEntry | undefined {
    return this.vehicles.get(id);
  }

  getDriverById(id: string): DriverCacheEntry | undefined {
    return this.drivers.get(id);
  }

  getPriceForCustomerProduct(customerId: string, productId: string): number | null {
    const link = Array.from(this.customerPriceTables.values()).find(
      (cpt) => cpt.customerId === customerId
    );
    if (!link) return null;

    const matchingItem = Array.from(this.priceTableItems.values()).find(
      (item) => item.priceTableId === link.priceTableId && item.productId === productId
    );

    return matchingItem ? matchingItem.unitPriceCents : null;
  }

  getCustomerPriceTableId(customerId: string): string | null {
    const link = Array.from(this.customerPriceTables.values()).find(
      (cpt) => cpt.customerId === customerId
    );
    return link?.priceTableId ?? null;
  }

  private getAllOfType(entityType: CacheEntityType): unknown[] {
    switch (entityType) {
      case "customer":
        return Array.from(this.customers.values());
      case "product":
        return Array.from(this.products.values());
      case "vehicle":
        return Array.from(this.vehicles.values());
      case "driver":
        return Array.from(this.drivers.values());
      case "carrier":
        return Array.from(this.carriers.values());
      case "payment_term":
        return Array.from(this.paymentTerms.values());
      case "payment_method":
        return Array.from(this.paymentMethods.values());
      case "account":
        return Array.from(this.accounts.values());
      case "price_table":
        return Array.from(this.priceTables.values());
      case "price_table_item":
        return Array.from(this.priceTableItems.values());
      case "customer_price_table":
        return Array.from(this.customerPriceTables.values());
    }
  }

  private getSearchFields(entityType: CacheEntityType): string[] {
    switch (entityType) {
      case "customer":
        return ["legalName", "tradeName", "document", "zipcode", "addressStreet", "neighborhood", "city"];
      case "product":
        return ["code", "description", "ncm", "ean"];
      case "vehicle":
        return ["plate"];
      case "driver":
        return ["name", "document"];
      case "carrier":
        return ["name", "document", "zipcode", "addressStreet", "neighborhood", "city"];
      case "payment_term":
        return ["name", "omieCode"];
      case "payment_method":
        return ["name", "code", "alias"];
      case "account":
        return ["name", "code", "omieCode"];
      case "price_table":
        return ["name"];
      case "price_table_item":
        return [];
      case "customer_price_table":
        return [];
    }
  }

  private loadCustomers(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, omie_customer_id, legal_name, trade_name, document, phone, email,
                credit_limit_cents, credit_mode, open_receivables_cents, omie_billing_blocked,
                source, sync_status, needs_push, last_synced_at, observations, default_carrier_id, default_payment_term_id,
                default_payment_method_id, credit_account_enabled, credit_closing_day, credit_boleto_days, nf_required,
                credit_periodicity, credit_second_closing_day, credit_second_boleto_days, credit_closing_weekday,
                zipcode, address_street, address_number, address_complement, neighborhood, city, state, is_active
         FROM customers WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as CustomerRow[];

    this.customers.clear();
    for (const row of rows) {
      this.customers.set(row.id, mapCustomer(row));
    }
  }

  private loadProducts(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, omie_product_id, code, description, unit, ncm, ean, unit_price_cents,
                item_type, fiscal_recommendations_json, is_active
         FROM products WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as ProductRow[];

    this.products.clear();
    for (const row of rows) {
      const product = mapProduct(row);
      this.products.set(row.id, product);
    }
  }

  private loadVehicles(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, plate, description, carrier_id, is_active
         FROM vehicles WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as VehicleRow[];

    this.vehicles.clear();
    for (const row of rows) {
      this.vehicles.set(row.id, mapVehicle(row));
    }
  }

  private loadDrivers(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, name, document, phone, is_independent, is_active
         FROM drivers WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as DriverRow[];

    this.drivers.clear();
    for (const row of rows) {
      this.drivers.set(row.id, mapDriver(row));
    }
  }

  private loadCarriers(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, omie_customer_id, name, document, phone, email, zipcode, address_street,
                address_number, address_complement, neighborhood, city, state, nf_required, source,
                sync_status, needs_push, last_synced_at, is_active
         FROM carriers WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as CarrierRow[];

    this.carriers.clear();
    for (const row of rows) {
      this.carriers.set(row.id, mapCarrier(row));
    }
  }

  private loadPaymentTerms(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, omie_code, omie_parcela_code, name, rules_json, installment_count, is_active
         FROM payment_terms WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as PaymentTermRow[];

    this.paymentTerms.clear();
    for (const row of rows) {
      this.paymentTerms.set(row.id, mapPaymentTerm(row));
    }
  }

  private loadPaymentMethods(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT pm.id, pm.code, pm.name, pm.alias, pm.omie_code, pm.account_id,
                ac.name AS account_name,
                pm.is_system, pm.is_customer_credit, pm.sort_order, pm.is_active
         FROM payment_methods pm
         LEFT JOIN accounts ac ON ac.id = pm.account_id AND ac.deleted_at IS NULL
         WHERE pm.company_id = ? AND pm.deleted_at IS NULL`
      )
      .all(companyId) as PaymentMethodRow[];

    this.paymentMethods.clear();
    for (const row of rows) {
      this.paymentMethods.set(row.id, mapPaymentMethod(row));
    }
  }

  private loadAccounts(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, code, name, omie_code, is_system, sort_order, is_active
         FROM accounts WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as AccountRow[];

    this.accounts.clear();
    for (const row of rows) {
      this.accounts.set(row.id, mapAccount(row));
    }
  }

  private loadPriceTables(companyId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, name, omie_table_id, needs_push, last_synced_at, is_active
         FROM price_tables WHERE company_id = ? AND deleted_at IS NULL`
      )
      .all(companyId) as PriceTableRow[];

    this.priceTables.clear();
    for (const row of rows) {
      this.priceTables.set(row.id, mapPriceTable(row));
    }
  }

  private loadPriceTableItems(): void {
    const rows = this.db
      .prepare(
        `SELECT id, price_table_id, product_id, unit_price_cents, unit
         FROM price_table_items WHERE deleted_at IS NULL`
      )
      .all() as PriceTableItemRow[];

    this.priceTableItems.clear();
    for (const row of rows) {
      this.priceTableItems.set(row.id, mapPriceTableItem(row));
    }
  }

  private loadCustomerPriceTables(): void {
    const rows = this.db
      .prepare(
        `SELECT id, customer_id, price_table_id
         FROM customer_price_tables WHERE deleted_at IS NULL AND is_active = 1`
      )
      .all() as CustomerPriceTableRow[];

    this.customerPriceTables.clear();
    for (const row of rows) {
      this.customerPriceTables.set(row.id, mapCustomerPriceTable(row));
    }
  }
}
