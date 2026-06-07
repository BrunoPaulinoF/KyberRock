import { OmieClient, OmieCustomersService, OmiePaymentTermsService, OmieProductsService, OmieReceivablesService } from "@kyberrock/omie-client";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface OmieSyncConfig {
  appKey: string;
  appSecret: string;
}

export interface OmieSyncResult {
  customersSynced: number;
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
      customersSynced: 0,
      productsSynced: 0,
      paymentTermsSynced: 0,
      errors: []
    };

    try {
      result.customersSynced = await this.syncCustomers(companyId);
    } catch (err) {
      result.errors.push(`Customers sync failed: ${(err as Error).message}`);
    }

    try {
      result.productsSynced = await this.syncProducts(companyId);
    } catch (err) {
      result.errors.push(`Products sync failed: ${(err as Error).message}`);
    }

    try {
      result.paymentTermsSynced = await this.syncPaymentTerms(companyId);
    } catch (err) {
      result.errors.push(`Payment terms sync failed: ${(err as Error).message}`);
    }

    return result;
  }

  async syncCustomers(companyId: string): Promise<number> {
    const customers = await this.customersService.listAll();

    const insert = this.db.prepare(`
      INSERT INTO customers (
        id, company_id, omie_customer_id, source, legal_name, trade_name,
        document, phone, email, is_active, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, 'omie', ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), 'synced')
      ON CONFLICT(id) DO UPDATE SET
        omie_customer_id = excluded.omie_customer_id,
        legal_name = excluded.legal_name,
        trade_name = excluded.trade_name,
        document = excluded.document,
        phone = excluded.phone,
        email = excluded.email,
        updated_at = datetime('now'),
        sync_status = 'synced'
    `);

    const updateReceivables = this.db.prepare(`
      UPDATE customers
      SET open_receivables_cents = ?,
          financial_cache_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `);

    let count = 0;
    for (const customer of customers) {
      const id = `omie_${customer.id}`;
      insert.run(
        id,
        companyId,
        customer.id,
        customer.name,
        customer.tradeName || customer.name,
        customer.document,
        customer.phone || null,
        customer.email || null
      );
      count++;

      try {
        const openAmount = await this.receivablesService.getTotalOpenAmountForClient(customer.id);
        updateReceivables.run(Math.round(openAmount * 100), id, companyId);
      } catch {
        // Continue even if receivables fail for one customer
      }
    }

    return count;
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
}
