import {
  OmieClient,
  OmieCustomersService,
  OmiePaymentTermsService,
  OmieProductsService,
  OmieReceivablesService,
  OmieSuppliersService,
  hasTransportadoraTag,
  type CreateCustomerInput,
  type Product,
  type UpdateCustomerInput
} from "@kyberrock/omie-client";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface OmieSyncConfig {
  appKey: string;
  appSecret: string;
}

export interface OmieSyncResult {
  customersPulled: number;
  customersPushed: number;
  productsSynced: number;
  paymentTermsSynced: number;
  suppliersSynced: number;
  errors: string[];
}

export function createOmieClient(config: OmieSyncConfig): OmieClient {
  return new OmieClient({
    appKey: config.appKey,
    appSecret: config.appSecret
  });
}

export class OmieSyncService {
  private readonly customersService: OmieCustomersService;
  private readonly productsService: OmieProductsService;
  private readonly paymentTermsService: OmiePaymentTermsService;
  private readonly receivablesService: OmieReceivablesService;
  private readonly suppliersService: OmieSuppliersService;

  constructor(
    private readonly client: OmieClient,
    private readonly db: DesktopDatabase
  ) {
    this.customersService = new OmieCustomersService(client);
    this.productsService = new OmieProductsService(client);
    this.paymentTermsService = new OmiePaymentTermsService(client);
    this.receivablesService = new OmieReceivablesService(client);
    this.suppliersService = new OmieSuppliersService(client);
  }

  async syncAll(companyId: string): Promise<OmieSyncResult> {
    const result: OmieSyncResult = {
      customersPulled: 0,
      customersPushed: 0,
      productsSynced: 0,
      paymentTermsSynced: 0,
      suppliersSynced: 0,
      errors: []
    };

    try {
      const customerResult = await this.syncCustomersBidirectional(companyId);
      result.customersPulled = customerResult.pulled;
      result.customersPushed = customerResult.pushed;
    } catch (err) {
      result.errors.push(`Clientes: ${(err as Error).message}`);
    }

    try {
      result.productsSynced = await this.syncProducts(companyId);
    } catch (err) {
      result.errors.push(`Produtos: ${(err as Error).message}`);
    }

    try {
      result.paymentTermsSynced = await this.syncPaymentTerms(companyId);
    } catch (err) {
      result.errors.push(`Condicoes: ${(err as Error).message}`);
    }

    try {
      result.suppliersSynced = await this.syncSuppliers(companyId);
    } catch (err) {
      result.errors.push(`Transportadoras: ${(err as Error).message}`);
    }

    return result;
  }

  async syncCustomersBidirectional(companyId: string): Promise<{
    pulled: number;
    pushed: number;
  }> {
    const pulled = await this.pullCustomersFromOmie(companyId);
    const pushed = await this.pushCustomersToOmie(companyId);
    await this.reconcileCustomersByDocument(companyId);
    return { pulled, pushed };
  }

  async pullCustomersFromOmie(companyId: string): Promise<number> {
    const omieCustomers = await this.customersService.listAll();

    const upsert = this.db.prepare(`
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
        last_synced_at = datetime('now'),
        omie_updated_at = datetime('now'),
        updated_at = datetime('now')
    `);

    const updateReceivables = this.db.prepare(`
      UPDATE customers
      SET open_receivables_cents = ?,
          financial_cache_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `);

    let count = 0;
    for (const customer of omieCustomers) {
      const localId = this.findLocalIdByOmieId(companyId, customer.id) ?? `omie_${customer.id}`;

      upsert.run(
        localId,
        companyId,
        customer.id,
        customer.name,
        customer.tradeName || customer.name,
        customer.document || null,
        customer.phone || null,
        customer.email || null
      );
      count++;

      if (customer.id) {
        try {
          const openAmount = await this.receivablesService.getTotalOpenAmountForClient(customer.id);
          updateReceivables.run(Math.round(openAmount * 100), localId, companyId);
        } catch {
          // Continue even if receivables fail
        }
      }
    }

    return count;
  }

  async pushCustomersToOmie(companyId: string): Promise<number> {
    const pending = this.db
      .prepare(
        `SELECT * FROM customers
         WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1 AND source IN ('local', 'hybrid')`
      )
      .all(companyId) as Array<{
      id: string;
      omie_customer_id: number | null;
      legal_name: string;
      trade_name: string;
      document: string | null;
      phone: string | null;
      email: string | null;
    }>;

    const markSynced = this.db.prepare(`
      UPDATE customers
      SET needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
      WHERE id = ?
    `);

    const setOmieId = this.db.prepare(`
      UPDATE customers
      SET omie_customer_id = ?, needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
      WHERE id = ?
    `);

    const markError = this.db.prepare(`
      UPDATE customers
      SET sync_status = 'error', updated_at = datetime('now')
      WHERE id = ?
    `);

    let pushed = 0;
    for (const customer of pending) {
      try {
        if (customer.omie_customer_id) {
          const updateInput: UpdateCustomerInput = {
            codigoClienteOmie: customer.omie_customer_id,
            razaoSocial: customer.legal_name,
            nomeFantasia: customer.trade_name
          };
          if (customer.document) updateInput.cnpjCpf = customer.document;
          if (customer.email) updateInput.email = customer.email;

          await this.customersService.update(updateInput);
          markSynced.run(customer.id);
        } else {
          const createInput: CreateCustomerInput = {
            razaoSocial: customer.legal_name,
            cnpjCpf: customer.document || ""
          };
          if (customer.trade_name) createInput.nomeFantasia = customer.trade_name;
          if (customer.email) createInput.email = customer.email;
          if (customer.phone) {
            const phoneMatch = customer.phone.match(/\(?(\d{2})\)?\s*(\d+)/);
            if (phoneMatch) {
              createInput.telefone1Ddd = phoneMatch[1];
              createInput.telefone1Numero = phoneMatch[2];
            }
          }

          const omieId = await this.customersService.create(createInput);
          setOmieId.run(omieId, customer.id);
        }
        pushed++;
      } catch {
        markError.run(customer.id);
      }
    }

    return pushed;
  }

  async reconcileCustomersByDocument(companyId: string): Promise<void> {
    const omieCustomers = await this.customersService.listAll();

    const localDocs = new Map<string, string>();
    const localRows = this.db
      .prepare(
        `SELECT id, document FROM customers
         WHERE company_id = ? AND deleted_at IS NULL AND document IS NOT NULL AND document != ''`
      )
      .all(companyId) as Array<{ id: string; document: string }>;

    for (const row of localRows) {
      const normalized = normalizeDocument(row.document);
      if (normalized) localDocs.set(normalized, row.id);
    }

    const insertReconciled = this.db.prepare(`
      INSERT INTO customers (
        id, company_id, omie_customer_id, source, legal_name, trade_name,
        document, phone, email, is_active, sync_status, last_synced_at,
        omie_updated_at, needs_push, created_at, updated_at
      ) VALUES (?, ?, ?, 'omie', ?, ?, ?, ?, ?, 1, 'synced', datetime('now'), datetime('now'), 0, datetime('now'), datetime('now'))
    `);

    for (const omieCustomer of omieCustomers) {
      if (!omieCustomer.document) continue;
      const normalizedOmie = normalizeDocument(omieCustomer.document);
      if (!normalizedOmie) continue;

      if (!localDocs.has(normalizedOmie)) {
        const localId = `omie_${omieCustomer.id}`;
        insertReconciled.run(
          localId,
          companyId,
          omieCustomer.id,
          omieCustomer.name,
          omieCustomer.tradeName || omieCustomer.name,
          omieCustomer.document || null,
          omieCustomer.phone || null,
          omieCustomer.email || null
        );
      }
    }
  }

  async syncProducts(companyId: string): Promise<number> {
    const products = await this.productsService.listAll();

    const removeFromKyberRock = this.db.prepare(`
      UPDATE products
      SET is_active = 0,
          deleted_at = datetime('now'),
          updated_from_omie_at = datetime('now'),
          updated_at = datetime('now')
      WHERE company_id = ?
        AND omie_product_id = ?
    `);

    const insert = this.db.prepare(`
      INSERT INTO products (
        id, company_id, omie_product_id, omie_integration_code, code, description,
        detailed_description, unit, ncm, ean, unit_price_cents,
        family_code, family_description, brand, model, internal_notes,
        gross_weight_kg, net_weight_kg, height_m, width_m, depth_m,
        cest, item_type, icms_origin, blocked, tracks_stock, fiscal_recommendations_json,
        is_active, updated_from_omie_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
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
        tracks_stock = excluded.tracks_stock,
        fiscal_recommendations_json = excluded.fiscal_recommendations_json,
        is_active = excluded.is_active,
        deleted_at = NULL,
        updated_from_omie_at = datetime('now'),
        updated_at = datetime('now')
    `);

    let count = 0;
    for (const product of products) {
      if (!isFinishedGoodsProduct(product)) {
        removeFromKyberRock.run(companyId, product.id);
        continue;
      }

      const id = `omie_${product.id}`;
      insert.run(
        id,
        companyId,
        product.id,
        product.integrationCode ?? null,
        product.code || `PROD_${product.id}`,
        product.description,
        product.detailedDescription ?? null,
        product.unit || "UN",
        product.ncm ?? null,
        product.ean ?? null,
        product.unitPriceCents ?? null,
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
        1,
        product.fiscalRecommendations ? JSON.stringify(product.fiscalRecommendations) : null,
        product.isActive === false ? 0 : 1
      );
      count++;
    }

    return count;
  }

  async syncPaymentTerms(companyId: string): Promise<number> {
    const terms = await this.paymentTermsService.listAll();

    const insert = this.db.prepare(`
      INSERT INTO payment_terms (
        id, company_id, omie_code, omie_integration_code, name, rules_json,
        first_installment_days, installment_interval_days, installment_count,
        installment_type, installment_days_json, visible, is_active,
        updated_from_omie_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        omie_code = excluded.omie_code,
        omie_integration_code = excluded.omie_integration_code,
        name = excluded.name,
        rules_json = excluded.rules_json,
        first_installment_days = excluded.first_installment_days,
        installment_interval_days = excluded.installment_interval_days,
        installment_count = excluded.installment_count,
        installment_type = excluded.installment_type,
        installment_days_json = excluded.installment_days_json,
        visible = excluded.visible,
        is_active = excluded.is_active,
        updated_from_omie_at = datetime('now'),
        updated_at = datetime('now')
    `);

    let count = 0;
    for (const term of terms) {
      const id = `omie_${term.id}`;
      insert.run(
        id,
        companyId,
        String(term.id),
        term.integrationCode ?? null,
        term.description,
        JSON.stringify({
          omieId: term.id,
          firstInstallmentDays: term.firstInstallmentDays ?? null,
          installmentIntervalDays: term.installmentIntervalDays ?? null,
          installmentCount: term.installmentCount ?? null,
          installmentType: term.installmentType ?? null,
          installmentDays: term.installmentDays ?? null,
          visible: term.visible ?? true
        }),
        term.firstInstallmentDays ?? null,
        term.installmentIntervalDays ?? null,
        term.installmentCount ?? null,
        term.installmentType ?? null,
        term.installmentDays ? JSON.stringify(term.installmentDays) : null,
        term.visible === false ? 0 : 1,
        term.isActive === false ? 0 : 1
      );
      count++;
    }

    return count;
  }

  async syncSuppliers(companyId: string): Promise<number> {
    const suppliers = await this.suppliersService.listAll();
    const transportadoras = suppliers.filter((s) => hasTransportadoraTag(s));

    const upsert = this.db.prepare(`
      INSERT INTO carriers (
        id, company_id, omie_customer_id, name, document, source,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'omie', ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        document = excluded.document,
        is_active = excluded.is_active,
        updated_at = datetime('now')
    `);

    let count = 0;
    for (const supplier of transportadoras) {
      const localId = this.findCarrierLocalIdByOmieId(companyId, supplier.id) ?? `omie_supplier_${supplier.id}`;
      upsert.run(
        localId,
        companyId,
        supplier.id,
        supplier.name,
        supplier.document || null,
        supplier.isActive ? 1 : 0
      );
      count++;
    }

    return count;
  }

  private findLocalIdByOmieId(companyId: string, omieCustomerId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM customers
         WHERE company_id = ? AND omie_customer_id = ? AND deleted_at IS NULL LIMIT 1`
      )
      .get(companyId, omieCustomerId) as { id: string } | undefined;

    return row?.id ?? null;
  }

  private findCarrierLocalIdByOmieId(companyId: string, omieId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM carriers
         WHERE company_id = ? AND omie_customer_id = ? AND deleted_at IS NULL LIMIT 1`
      )
      .get(companyId, omieId) as { id: string } | undefined;

    return row?.id ?? null;
  }
}

function isFinishedGoodsProduct(product: Product): boolean {
  const candidates = [product.itemType ?? null, ...extractFiscalRecommendationValues(product.fiscalRecommendations ?? null)];
  return candidates.some((value) => matchesFinishedGoodsType(value));
}

function extractFiscalRecommendationValues(value: unknown): string[] {
  const values: string[] = [];
  collectFiscalRecommendationValues(value, values);
  return values;
}

function collectFiscalRecommendationValues(value: unknown, output: string[]): void {
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFiscalRecommendationValues(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeFiscalTypeText(key);
      if (normalizedKey.includes("tipo") && (normalizedKey.includes("produto") || normalizedKey.includes("item"))) {
        collectFiscalRecommendationValues(nested, output);
      }
      if (normalizedKey === "codigo" || normalizedKey === "cod" || normalizedKey === "code") {
        collectFiscalRecommendationValues(nested, output);
      }
    }
  }
}

function matchesFinishedGoodsType(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeFiscalTypeText(value);
  return normalized === "04" || normalized.startsWith("04 ") || normalized.includes("produtos acabados") || normalized.includes("produto acabado");
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

function normalizeDocument(doc: string): string {
  return doc.replace(/\D/g, "");
}
