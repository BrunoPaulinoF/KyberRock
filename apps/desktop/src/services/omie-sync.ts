import { randomUUID } from "node:crypto";

import {
  OmieClient,
  OmieCheckingAccountsService,
  OmieCustomersService,
  OmieParcelasService,
  OmiePaymentMethodsService,
  OmieProductsService,
  hasClienteTag,
  hasTransportadoraTag,
  type CreateCustomerInput,
  type Customer,
  type Product,
  type UpdateCustomerInput
} from "@kyberrock/omie-client";

import type { DesktopDatabase } from "../database/sqlite.js";
import { isSellableProduct } from "./product-classification.js";
import {
  upsertOmiePaymentTerms,
  type OmieReferencePaymentTerm
} from "./supabase-sync.js";

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

export interface TaggedSupplierSyncResult {
  customersPulled: number;
  suppliersSynced: number;
}

export function createOmieClient(config: OmieSyncConfig): OmieClient {
  return new OmieClient({
    appKey: config.appKey,
    appSecret: config.appSecret
  });
}

export interface MasterEntitySyncCounters {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

export class OmieSyncService {
  private readonly customersService: OmieCustomersService;
  private readonly productsService: OmieProductsService;
  private readonly paymentMethodsService: OmiePaymentMethodsService;
  private readonly checkingAccountsService: OmieCheckingAccountsService;
  private readonly parcelasService: OmieParcelasService;

  constructor(
    private readonly client: OmieClient,
    private readonly db: DesktopDatabase
  ) {
    this.customersService = new OmieCustomersService(client);
    this.productsService = new OmieProductsService(client);
    this.paymentMethodsService = new OmiePaymentMethodsService(client);
    this.checkingAccountsService = new OmieCheckingAccountsService(client);
    this.parcelasService = new OmieParcelasService(client);
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
      const taggedResult = await this.rebuildCustomersAndCarriersFromOmie(companyId);
      result.customersPulled = taggedResult.customersPulled;
      result.suppliersSynced = taggedResult.suppliersSynced;
    } catch (err) {
      result.errors.push(`Clientes/Transportadoras: ${(err as Error).message}`);
    }

    try {
      result.productsSynced = await this.syncProducts(companyId);
    } catch (err) {
      result.errors.push(`Produtos: ${(err as Error).message}`);
    }

    // Condicoes de pagamento sao cadastradas localmente e nao vem mais do OMIE.
    result.paymentTermsSynced = await this.syncPaymentTerms();

    return result;
  }

  async rebuildCustomersAndCarriersFromOmie(companyId: string): Promise<TaggedSupplierSyncResult> {
    const omieCustomers = await this.customersService.listAll();
    const customers = omieCustomers.filter((customer) => hasClienteTag(customer));
    const carriers = omieCustomers.filter((customer) => hasTransportadoraTag(customer));

    this.runInTransaction(() => {
      this.clearCustomerCarrierRegistrations(companyId);
      this.upsertCustomersFromOmieCustomers(companyId, customers);
      this.upsertCarriersFromOmieCustomers(companyId, carriers);
    });

    return {
      customersPulled: customers.length,
      suppliersSynced: carriers.length
    };
  }

  async syncCustomersBidirectional(companyId: string): Promise<{
    pulled: number;
    pushed: number;
  }> {
    const result = await this.rebuildCustomersAndCarriersFromOmie(companyId);
    return { pulled: result.customersPulled, pushed: 0 };
  }

  async pullCustomersFromOmie(companyId: string): Promise<number> {
    const listedCustomers = await this.customersService.listAll();
    const omieCustomers = listedCustomers.filter((customer) => hasClienteTag(customer));

    this.runInTransaction(() => {
      this.clearCustomers(companyId);
      this.upsertCustomersFromOmieCustomers(companyId, omieCustomers);
    });
    return omieCustomers.length;
  }

  private upsertCustomersFromOmieCustomers(companyId: string, customers: Customer[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO customers (
        id, company_id, omie_customer_id, source, legal_name, trade_name,
        document, phone, email, zipcode, address_street, address_number,
        address_complement, neighborhood, city, state, is_active, sync_status, last_synced_at,
        omie_updated_at, needs_push, created_at, updated_at
      ) VALUES (?, ?, ?, 'omie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'), datetime('now'), 0, datetime('now'), datetime('now'))
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
        address_complement = CASE WHEN customers.needs_push = 0 THEN excluded.address_complement ELSE customers.address_complement END,
        neighborhood = CASE WHEN customers.needs_push = 0 THEN excluded.neighborhood ELSE customers.neighborhood END,
        city = CASE WHEN customers.needs_push = 0 THEN excluded.city ELSE customers.city END,
        state = CASE WHEN customers.needs_push = 0 THEN excluded.state ELSE customers.state END,
        is_active = excluded.is_active,
        deleted_at = NULL,
        last_synced_at = datetime('now'),
        omie_updated_at = datetime('now'),
        updated_at = datetime('now')
    `);

    for (const customer of customers) {
      upsert.run(
        `omie_${customer.id}`,
        companyId,
        customer.id,
        customer.name,
        customer.tradeName || customer.name,
        customer.document || null,
        customer.phone || null,
        customer.email || null,
        customer.zipcode || null,
        customer.addressStreet || null,
        customer.addressNumber || null,
        customer.addressComplement || null,
        customer.neighborhood || null,
        customer.city || null,
        customer.state || null,
        customer.isActive ? 1 : 0
      );
    }
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

  async pushCarriersToOmie(companyId: string): Promise<number> {
    const pending = this.db
      .prepare(
        `SELECT * FROM carriers
         WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1 AND source = 'local'`
      )
      .all(companyId) as Array<{
      id: string;
      omie_customer_id: number | null;
      name: string;
      document: string | null;
      phone: string | null;
      email: string | null;
    }>;

    const markSynced = this.db.prepare(`
      UPDATE carriers
      SET needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
      WHERE id = ?
    `);

    const setOmieId = this.db.prepare(`
      UPDATE carriers
      SET omie_customer_id = ?, needs_push = 0, last_synced_at = datetime('now'), sync_status = 'synced', updated_at = datetime('now')
      WHERE id = ?
    `);

    const markError = this.db.prepare(`
      UPDATE carriers
      SET sync_status = 'error', updated_at = datetime('now')
      WHERE id = ?
    `);

    let omieCustomersByDocument: Map<string, Customer> | null = null;
    let pushed = 0;
    for (const carrier of pending) {
      try {
        const phoneMatch = carrier.phone?.match(/\(?(\d{2})\)?\s*(\d+)/);
        const tags = [{ tag: "transportadora" }];
        if (!omieCustomersByDocument && !carrier.omie_customer_id && carrier.document) {
          omieCustomersByDocument = await this.listOmieCustomersByDocument();
        }
        const matchingOmieId =
          carrier.omie_customer_id ??
          (carrier.document
            ? (omieCustomersByDocument?.get(normalizeDocument(carrier.document))?.id ?? null)
            : null);

        if (matchingOmieId) {
          const updateInput: UpdateCustomerInput = {
            codigoClienteOmie: matchingOmieId,
            razaoSocial: carrier.name,
            nomeFantasia: carrier.name,
            tags
          };
          if (carrier.document) updateInput.cnpjCpf = carrier.document;
          if (carrier.email) updateInput.email = carrier.email;
          if (phoneMatch) {
            updateInput.telefone1Ddd = phoneMatch[1];
            updateInput.telefone1Numero = phoneMatch[2];
          }
          await this.customersService.update(updateInput);
          if (carrier.omie_customer_id) markSynced.run(carrier.id);
          else setOmieId.run(matchingOmieId, carrier.id);
        } else {
          const createInput: CreateCustomerInput = {
            razaoSocial: carrier.name,
            nomeFantasia: carrier.name,
            cnpjCpf: carrier.document || "",
            tags
          };
          if (carrier.email) createInput.email = carrier.email;
          if (phoneMatch) {
            createInput.telefone1Ddd = phoneMatch[1];
            createInput.telefone1Numero = phoneMatch[2];
          }
          const omieId = await this.customersService.create(createInput);
          setOmieId.run(omieId, carrier.id);
        }
        pushed++;
      } catch {
        markError.run(carrier.id);
      }
    }

    return pushed;
  }

  private async listOmieCustomersByDocument(): Promise<Map<string, Customer>> {
    const byDocument = new Map<string, Customer>();
    const customers = await this.customersService.listAll();
    for (const customer of customers) {
      if (!customer.document) continue;
      const normalized = normalizeDocument(customer.document);
      if (normalized) byDocument.set(normalized, customer);
    }
    return byDocument;
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
      if (!isSellableOmieProduct(product)) {
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
        product.tracksStock === false ? 0 : 1,
        product.fiscalRecommendations ? JSON.stringify(product.fiscalRecommendations) : null,
        product.isActive === false ? 0 : 1
      );
      count++;
    }

    return count;
  }

  /**
   * As condicoes de pagamento passaram a ser cadastradas localmente no KyberRock
   * e nao vem mais do OMIE. Mantido como no-op apenas por compatibilidade da
   * assinatura usada pelos testes e orquestradores de sync.
   */
  async syncPaymentTerms(): Promise<number> {
    return 0;
  }

  /**
   * Puxa os meios de pagamento do OMIE (nome + codigo) para payment_methods.
   * Idempotente: quem ja tem o omie_code local nao muda; formas padrao do seed
   * (dinheiro, pix, ...) sem codigo sao "adotadas" (recebem o codigo OMIE) em vez
   * de gerar duplicata; o resto e inserido como forma vinda do OMIE.
   */
  async syncPaymentMethods(companyId: string): Promise<MasterEntitySyncCounters> {
    const omieMethods = await this.paymentMethodsService.listAll();
    const counters: MasterEntitySyncCounters = {
      fetched: omieMethods.length,
      created: 0,
      updated: 0,
      skipped: 0
    };

    const existsByOmieCode = this.db.prepare(
      "SELECT 1 FROM payment_methods WHERE company_id = ? AND omie_code = ?"
    );
    const adopt = this.db.prepare(
      `UPDATE payment_methods SET omie_code = ?, updated_at = datetime('now')
       WHERE company_id = ? AND code = ? AND omie_code IS NULL AND deleted_at IS NULL`
    );
    const insert = this.db.prepare(
      `INSERT INTO payment_methods
         (id, company_id, code, name, omie_code, is_system, is_customer_credit, sort_order,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 1, datetime('now'), datetime('now'))`
    );
    const maxSort = this.db.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS max FROM payment_methods WHERE company_id = ?"
    );

    this.runInTransaction(() => {
      let nextSort = (maxSort.get(companyId) as { max: number }).max;
      for (const method of omieMethods) {
        if (existsByOmieCode.get(companyId, method.code)) {
          counters.skipped++;
          continue;
        }

        const seedCode = SEED_METHOD_CODES_BY_OMIE_CODE.get(method.code);
        if (seedCode) {
          const adopted = adopt.run(method.code, companyId, seedCode);
          if (adopted.changes > 0) {
            counters.updated++;
            continue;
          }
        }

        nextSort++;
        insert.run(
          randomUUID(),
          companyId,
          `omie_${method.code}`,
          method.description,
          method.code,
          nextSort
        );
        counters.created++;
      }
    });

    return counters;
  }

  /**
   * Puxa as condicoes de pagamento (parcelas) do OMIE para o espelho
   * omie_payment_terms (codigo, descricao, dias). Idempotente: upsert por
   * (company_id, code) — re-sincronizar nao duplica nada.
   */
  async syncPaymentConditions(companyId: string): Promise<MasterEntitySyncCounters> {
    const parcelas = await this.parcelasService.listAll();
    const mapped: OmieReferencePaymentTerm[] = parcelas.map((parcela) => ({
      id: parcela.id,
      code: parcela.code,
      integrationCode: null,
      description: parcela.description,
      firstInstallmentDays: parcela.firstInstallmentDays,
      installmentIntervalDays: parcela.installmentIntervalDays,
      installmentCount: parcela.installmentCount,
      installmentType: parcela.installmentType,
      installmentDaysJson: parcela.installmentDays,
      isActive: parcela.isActive,
      visible: parcela.visible
    }));

    const upserted = upsertOmiePaymentTerms(this.db, companyId, mapped);
    return {
      fetched: parcelas.length,
      created: 0,
      updated: upserted,
      skipped: parcelas.length - upserted
    };
  }

  /**
   * Puxa as contas correntes do OMIE (nome + nCodCC) para accounts. Idempotente:
   * contas ja puxadas (mesmo omie_code) nao mudam; contas locais sem codigo com o
   * mesmo nome sao adotadas; as demais entram como novas contas vindas do OMIE.
   */
  async syncCheckingAccounts(companyId: string): Promise<MasterEntitySyncCounters> {
    const omieAccounts = await this.checkingAccountsService.listAll();
    const counters: MasterEntitySyncCounters = {
      fetched: omieAccounts.length,
      created: 0,
      updated: 0,
      skipped: 0
    };

    const existsByOmieCode = this.db.prepare(
      "SELECT 1 FROM accounts WHERE company_id = ? AND omie_code = ?"
    );
    const findAdoptable = this.db.prepare(
      `SELECT id FROM accounts
       WHERE company_id = ? AND omie_code IS NULL AND deleted_at IS NULL`
    );
    const adopt = this.db.prepare(
      "UPDATE accounts SET omie_code = ?, updated_at = datetime('now') WHERE id = ?"
    );
    const insert = this.db.prepare(
      `INSERT INTO accounts
         (id, company_id, code, name, omie_code, is_system, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 0, ?, ?, datetime('now'), datetime('now'))`
    );
    const maxSort = this.db.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS max FROM accounts WHERE company_id = ?"
    );

    this.runInTransaction(() => {
      let nextSort = (maxSort.get(companyId) as { max: number }).max;
      const adoptable = (findAdoptable.all(companyId) as Array<{ id: string }>).map(
        (row) => row.id
      );
      const adoptableByName = new Map<string, string>();
      const nameOf = this.db.prepare("SELECT name FROM accounts WHERE id = ?");
      for (const id of adoptable) {
        const row = nameOf.get(id) as { name: string } | undefined;
        if (row) adoptableByName.set(normalizeAccountName(row.name), id);
      }

      for (const account of omieAccounts) {
        const omieCode = String(account.code);
        if (existsByOmieCode.get(companyId, omieCode)) {
          counters.skipped++;
          continue;
        }

        const adoptId = adoptableByName.get(normalizeAccountName(account.name));
        if (adoptId) {
          adopt.run(omieCode, adoptId);
          adoptableByName.delete(normalizeAccountName(account.name));
          counters.updated++;
          continue;
        }

        nextSort++;
        insert.run(
          randomUUID(),
          companyId,
          account.name,
          omieCode,
          nextSort,
          account.isActive ? 1 : 0
        );
        counters.created++;
      }
    });

    return counters;
  }

  async syncSuppliers(companyId: string): Promise<number> {
    const customers = await this.customersService.listAll();
    const transportadoras = customers.filter((customer) => hasTransportadoraTag(customer));

    this.runInTransaction(() => {
      this.clearCarriers(companyId);
      this.upsertCarriersFromOmieCustomers(companyId, transportadoras);
    });

    return transportadoras.length;
  }

  private upsertCarriersFromOmieCustomers(companyId: string, carriers: Customer[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO carriers (
        id, company_id, omie_customer_id, omie_integration_code, name, document, phone, email,
        zipcode, address_street, address_number, address_complement, neighborhood, city, state, source,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'omie', ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        omie_customer_id = excluded.omie_customer_id,
        omie_integration_code = excluded.omie_integration_code,
        name = excluded.name,
        document = excluded.document,
        phone = excluded.phone,
        email = excluded.email,
        zipcode = excluded.zipcode,
        address_street = excluded.address_street,
        address_number = excluded.address_number,
        address_complement = excluded.address_complement,
        neighborhood = excluded.neighborhood,
        city = excluded.city,
        state = excluded.state,
        is_active = excluded.is_active,
        deleted_at = NULL,
        updated_at = datetime('now')
    `);

    for (const supplier of carriers) {
      upsert.run(
        `omie_supplier_${supplier.id}`,
        companyId,
        supplier.id,
        supplier.integrationCode || null,
        supplier.name,
        supplier.document || null,
        supplier.phone || null,
        supplier.email || null,
        supplier.zipcode || null,
        supplier.addressStreet || null,
        supplier.addressNumber || null,
        supplier.addressComplement || null,
        supplier.neighborhood || null,
        supplier.city || null,
        supplier.state || null,
        supplier.isActive ? 1 : 0
      );
    }
  }

  private clearCustomerCarrierRegistrations(companyId: string): void {
    this.clearCustomers(companyId);
    this.clearCarriers(companyId);
  }

  private clearCustomers(companyId: string): void {
    // Reconcilia em vez de zerar: soft-delete apenas de clientes vindos do OMIE que nao
    // tem edicao local pendente (needs_push=0). Clientes locais/hibridos ou com push
    // pendente sao preservados. Os que continuarem no OMIE sao "ressuscitados" pelo upsert
    // (deleted_at = NULL); os removidos no OMIE permanecem soft-deletados.
    this.db.prepare(`
      UPDATE customer_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND customer_id IN (
          SELECT id FROM customers
          WHERE company_id = ? AND source = 'omie' AND needs_push = 0
        )
    `).run(companyId);

    this.db.prepare(`
      UPDATE customers
      SET default_carrier_id = NULL,
          deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND deleted_at IS NULL
        AND source = 'omie'
        AND needs_push = 0
    `).run(companyId);
  }

  private clearCarriers(companyId: string): void {
    // Mesma regra de reconciliacao dos clientes: mexe apenas em transportadoras vindas do
    // OMIE sem push pendente. As relacoes sao resetadas somente para essas transportadoras.
    const omieCarrierFilter =
      "carrier_id IN (SELECT id FROM carriers WHERE company_id = ? AND source = 'omie' AND needs_push = 0)";

    this.db.prepare(`
      UPDATE customer_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND ${omieCarrierFilter}
    `).run(companyId);

    this.db.prepare(`
      UPDATE driver_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND ${omieCarrierFilter}
    `).run(companyId);

    this.db.prepare(`
      UPDATE vehicle_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND ${omieCarrierFilter}
    `).run(companyId);

    this.db.prepare(`
      UPDATE vehicles
      SET carrier_id = NULL,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND ${omieCarrierFilter}
    `).run(companyId, companyId);

    this.db.prepare(`
      UPDATE customers
      SET default_carrier_id = NULL,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND default_carrier_id IN (
          SELECT id FROM carriers WHERE company_id = ? AND source = 'omie' AND needs_push = 0
        )
    `).run(companyId, companyId);

    this.db.prepare(`
      UPDATE carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND deleted_at IS NULL
        AND source = 'omie'
        AND needs_push = 0
    `).run(companyId);
  }

  private runInTransaction<T>(action: () => T): T {
    return this.db.transaction(action)();
  }
}

function isSellableOmieProduct(product: Product): boolean {
  return isSellableProduct({
    omieProductId: product.id,
    itemType: product.itemType ?? null,
    fiscalRecommendations: product.fiscalRecommendations ?? null,
    isActive: product.isActive !== false,
    blocked: product.blocked === true
  });
}

function normalizeDocument(doc: string): string {
  return doc.replace(/\D/g, "");
}

// Formas padrao do seed local -> codigo NFe/OMIE correspondente. Na primeira
// sincronizacao a forma seed "adota" o codigo do OMIE em vez de duplicar a lista.
// customer_credit (fiado) e conceito do KyberRock e fica fora do mapeamento.
const SEED_METHOD_CODES_BY_OMIE_CODE = new Map<string, string>([
  ["01", "cash"],
  ["03", "credit_card"],
  ["04", "debit_card"],
  ["15", "boleto"],
  ["17", "pix"]
]);

function normalizeAccountName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
