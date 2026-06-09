import {
  OmieClient,
  OmieCustomersService,
  OmiePaymentTermsService,
  OmieProductsService,
  OmieReceivablesService,
  type CreateCustomerInput,
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

  constructor(
    private readonly client: OmieClient,
    private readonly db: DesktopDatabase
  ) {
    this.customersService = new OmieCustomersService(client);
    this.productsService = new OmieProductsService(client);
    this.paymentTermsService = new OmiePaymentTermsService(client);
    this.receivablesService = new OmieReceivablesService(client);
  }

  async syncAll(companyId: string): Promise<OmieSyncResult> {
    const result: OmieSyncResult = {
      customersPulled: 0,
      customersPushed: 0,
      productsSynced: 0,
      paymentTermsSynced: 0,
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

    const insert = this.db.prepare(`
      INSERT INTO products (
        id, company_id, omie_product_id, code, description, unit,
        is_active, updated_from_omie_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        description = excluded.description,
        unit = excluded.unit,
        updated_from_omie_at = datetime('now'),
        updated_at = datetime('now')
    `);

    let count = 0;
    for (const product of products) {
      const id = `omie_${product.id}`;
      insert.run(
        id,
        companyId,
        product.id,
        product.code || `PROD_${product.id}`,
        product.description,
        product.unit || "UN"
      );
      count++;
    }

    return count;
  }

  async syncPaymentTerms(companyId: string): Promise<number> {
    const terms = await this.paymentTermsService.listAll();

    const insert = this.db.prepare(`
      INSERT INTO payment_terms (
        id, company_id, omie_code, name, rules_json,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        rules_json = excluded.rules_json,
        updated_at = datetime('now')
    `);

    let count = 0;
    for (const term of terms) {
      const id = `omie_${term.id}`;
      insert.run(
        id,
        companyId,
        String(term.id),
        term.description,
        JSON.stringify({ omieId: term.id })
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
}

function normalizeDocument(doc: string): string {
  return doc.replace(/\D/g, "");
}
