import { randomUUID } from "node:crypto";

import {
  OmieCategoriesService,
  OmieClient,
  OmieCheckingAccountsService,
  OmieCustomersService,
  OmieParcelasService,
  OmiePaymentMethodsService,
  OmieProductsService,
  OmieVehiclesService,
  isOmieCarrierCadastro,
  isOmieCustomerCadastro,
  normalizeOmieTagValue,
  readOmieTagValues,
  type CreateCustomerInput,
  type Customer,
  type Product,
  type UpdateCustomerInput
} from "@kyberrock/omie-client";

import type { DesktopDatabase } from "../database/sqlite.js";
import { DOCUMENT_KEY_SQL, documentKey } from "./customer-identity.js";
import { normalizeMatchKey } from "./customer-import-sheet.js";
import { isSellableProduct } from "./product-classification.js";
import {
  resolveOmieLocalId,
  upsertOmiePaymentTerms,
  type OmieReferencePaymentTerm
} from "./supabase-sync.js";
import { provisionPaymentTermsFromOmieMirror } from "./payment-terms.js";

/** Tags do OMIE que marcam o papel do cadastro criado/alterado pelo KyberRock. */
const CUSTOMER_OMIE_TAG = "Cliente";
const CARRIER_OMIE_TAG = "Transportadora";

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
  /** Categorias do plano gerencial espelhadas em omie_categories. */
  categoriesSynced: number;
  errors: string[];
}

export interface TaggedSupplierSyncResult {
  customersPulled: number;
  suppliersSynced: number;
  /** Cadastros que sao so fornecedor/transportadora e sairam da lista de clientes. */
  nonCustomersRemoved: number;
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
  private readonly categoriesService: OmieCategoriesService;
  private readonly parcelasService: OmieParcelasService;
  private readonly vehiclesService: OmieVehiclesService;

  constructor(
    private readonly client: OmieClient,
    private readonly db: DesktopDatabase
  ) {
    this.customersService = new OmieCustomersService(client);
    this.productsService = new OmieProductsService(client);
    this.paymentMethodsService = new OmiePaymentMethodsService(client);
    this.checkingAccountsService = new OmieCheckingAccountsService(client);
    this.categoriesService = new OmieCategoriesService(client);
    this.parcelasService = new OmieParcelasService(client);
    this.vehiclesService = new OmieVehiclesService(client);
  }

  async syncAll(companyId: string): Promise<OmieSyncResult> {
    const result: OmieSyncResult = {
      customersPulled: 0,
      customersPushed: 0,
      productsSynced: 0,
      paymentTermsSynced: 0,
      suppliersSynced: 0,
      categoriesSynced: 0,
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

    // Categorias alimentam a escolha de categoria OMIE por produto; falhar aqui
    // nao pode derrubar o cadastro que a balanca precisa para operar.
    try {
      const categories = await this.syncCategories(companyId);
      result.categoriesSynced = categories.created + categories.updated;
    } catch (err) {
      result.errors.push(`Categorias: ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * Reconstroi clientes e transportadoras a partir do cadastro do OMIE.
   *
   * Entram como CLIENTE todos os cadastros que nao sao apenas fornecedor/transportadora
   * (ver `isOmieCustomerCadastro`) — inclusive os que ainda nao receberam a tag "Cliente",
   * que antes ficavam de fora e faziam o operador nao achar cliente real na balanca. Os
   * que sao so fornecedor/transportadora sao removidos do cadastro de clientes, mesmo
   * quando foram criados localmente ou por importacao de planilha.
   */
  async rebuildCustomersAndCarriersFromOmie(companyId: string): Promise<TaggedSupplierSyncResult> {
    const omieCustomers = await this.customersService.listAll();
    const customers = omieCustomers.filter((customer) => isOmieCustomerCadastro(customer));
    const carriers = omieCustomers.filter((customer) => isOmieCarrierCadastro(customer));
    const nonCustomers = omieCustomers.filter((customer) => !isOmieCustomerCadastro(customer));

    let nonCustomersRemoved = 0;
    this.runInTransaction(() => {
      // A limpeza vem antes da reconciliacao para contar todo fornecedor que estava no
      // cadastro de clientes (a reconciliacao ja apaga os vindos do OMIE) e para nenhum
      // deles ser "ressuscitado" pelos upserts seguintes.
      nonCustomersRemoved = this.removeNonCustomerRegistrations(companyId, nonCustomers);
      this.clearCustomerCarrierRegistrations(companyId);
      this.upsertCustomersFromOmieCustomers(companyId, customers);
      this.upsertCarriersFromOmieCustomers(companyId, carriers);
    });

    return {
      customersPulled: customers.length,
      suppliersSynced: carriers.length,
      nonCustomersRemoved
    };
  }

  /**
   * Tira do cadastro de clientes quem o OMIE classifica como fornecedor/transportadora e
   * nao como cliente. Casa pelo codigo OMIE e pelo CNPJ/CPF (so digitos), porque o
   * fornecedor pode ter entrado por importacao de planilha, sem codigo OMIE.
   *
   * E soft-delete: as operacoes ja gravadas continuam apontando para a linha e mantendo
   * o historico; o cadastro so deixa de aparecer nas listas.
   */
  private removeNonCustomerRegistrations(companyId: string, nonCustomers: Customer[]): number {
    if (nonCustomers.length === 0) return 0;

    const softDelete = this.db.prepare(`
      UPDATE customers
      SET deleted_at = datetime('now'),
          is_active = 0,
          needs_push = 0,
          updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL
    `);
    const byOmieId = this.db.prepare(
      "SELECT id FROM customers WHERE company_id = ? AND omie_customer_id = ? AND deleted_at IS NULL"
    );
    const byDocument = this.db.prepare(
      `SELECT id FROM customers
       WHERE company_id = ?
         AND deleted_at IS NULL
         AND ${DOCUMENT_KEY_SQL} = ?`
    );

    const removedIds = new Set<string>();
    for (const supplier of nonCustomers) {
      const rows = byOmieId.all(companyId, supplier.id) as Array<{ id: string }>;
      const key = documentKey(supplier.document);
      if (key) {
        rows.push(...(byDocument.all(companyId, key) as Array<{ id: string }>));
      }
      for (const row of rows) {
        if (removedIds.has(row.id)) continue;
        removedIds.add(row.id);
        softDelete.run(row.id);
      }
    }

    return removedIds.size;
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
    const omieCustomers = listedCustomers.filter((customer) => isOmieCustomerCadastro(customer));

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

    const documentlessIndex = this.buildDocumentlessLocalIndex("customers", companyId);
    const adopted = new Set<string>();

    for (const customer of customers) {
      upsert.run(
        this.resolveExistingCustomerId(companyId, customer, documentlessIndex, adopted),
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
            nomeFantasia: customer.trade_name,
            // Cliente do KyberRock sempre vai ao OMIE com a tag "Cliente" (somada as que
            // ele ja tem la): e a tag que faz o cadastro voltar como cliente na proxima
            // sincronizacao, em vez de sumir da balanca.
            tags: await this.mergeOmieTags(customer.omie_customer_id, CUSTOMER_OMIE_TAG)
          };
          if (customer.document) updateInput.cnpjCpf = customer.document;
          if (customer.email) updateInput.email = customer.email;

          await this.customersService.update(updateInput);
          markSynced.run(customer.id);
        } else {
          const createInput: CreateCustomerInput = {
            razaoSocial: customer.legal_name,
            cnpjCpf: customer.document || "",
            tags: [{ tag: CUSTOMER_OMIE_TAG }]
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
        const tags = [{ tag: CARRIER_OMIE_TAG }];
        if (!omieCustomersByDocument && !carrier.omie_customer_id && carrier.document) {
          omieCustomersByDocument = await this.listOmieCustomersByDocument();
        }
        const matchingOmieId =
          carrier.omie_customer_id ??
          (carrier.document
            ? (omieCustomersByDocument?.get(documentKey(carrier.document))?.id ?? null)
            : null);

        if (matchingOmieId) {
          const updateInput: UpdateCustomerInput = {
            codigoClienteOmie: matchingOmieId,
            razaoSocial: carrier.name,
            nomeFantasia: carrier.name,
            tags: await this.mergeOmieTags(matchingOmieId, CARRIER_OMIE_TAG)
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

  /**
   * Tags a enviar num AlterarCliente: as que o cadastro ja tem no OMIE mais a tag do
   * papel que o KyberRock esta gravando. O OMIE substitui a lista inteira, entao mandar
   * so a tag nova apagaria as outras — um cliente que tambem e transportadora perderia
   * a marcacao e sumiria de uma das listas na proxima sincronizacao.
   */
  private async mergeOmieTags(
    omieCustomerId: number,
    requiredTag: string
  ): Promise<Array<{ tag: string }>> {
    const normalizedRequired = normalizeOmieTagValue(requiredTag);
    let existing: string[] = [];
    try {
      const current = await this.customersService.getById(omieCustomerId);
      existing = readOmieTagValues(current?.tags ?? null).filter(
        (tag) => tag.trim().length > 0 && normalizeOmieTagValue(tag) !== normalizedRequired
      );
    } catch {
      // Cadastro ilegivel no OMIE: segue so com a tag do papel, que e o essencial.
    }
    return [...existing, requiredTag].map((tag) => ({ tag }));
  }

  private async listOmieCustomersByDocument(): Promise<Map<string, Customer>> {
    const byDocument = new Map<string, Customer>();
    const customers = await this.customersService.listAll();
    for (const customer of customers) {
      if (!customer.document) continue;
      const normalized = documentKey(customer.document);
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
      const normalized = documentKey(row.document);
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
      const normalizedOmie = documentKey(omieCustomer.document);
      if (!normalizedOmie) continue;

      if (!localDocs.has(normalizedOmie)) {
        const localId = resolveOmieLocalId(
          this.db,
          "customers",
          companyId,
          `omie_${omieCustomer.id}`
        );
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

      const id = resolveOmieLocalId(this.db, "products", companyId, `omie_${product.id}`);
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
    // Materializa as parcelas novas como condicoes locais selecionaveis.
    const created = provisionPaymentTermsFromOmieMirror(this.db, companyId);
    return {
      fetched: parcelas.length,
      created,
      updated: upserted - created > 0 ? upserted - created : 0,
      skipped: parcelas.length - upserted
    };
  }

  /**
   * Espelha as categorias (plano de contas gerencial) do OMIE em omie_categories,
   * para que cada produto possa apontar a categoria em que sua venda entra. Sem isso
   * o pedido ia com um codigo fixo e toda venda caia na mesma categoria no OMIE.
   * Idempotente: o mesmo codigo e atualizado no lugar.
   */
  async syncCategories(companyId: string): Promise<MasterEntitySyncCounters> {
    const categories = await this.categoriesService.listAll();
    const counters: MasterEntitySyncCounters = {
      fetched: categories.length,
      created: 0,
      updated: 0,
      skipped: 0
    };

    const findByCode = this.db.prepare(
      "SELECT id FROM omie_categories WHERE company_id = ? AND code = ?"
    );
    const update = this.db.prepare(
      `UPDATE omie_categories
         SET description = ?, category_type = ?, parent_code = ?, is_active = ?,
             updated_from_omie_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    );
    const insert = this.db.prepare(
      `INSERT INTO omie_categories
         (id, company_id, code, description, category_type, parent_code, is_active,
          updated_from_omie_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`
    );

    this.runInTransaction(() => {
      for (const category of categories) {
        const existing = findByCode.get(companyId, category.code) as { id: string } | undefined;
        if (existing) {
          update.run(
            category.description,
            category.categoryType,
            category.parentCode,
            category.isActive ? 1 : 0,
            existing.id
          );
          counters.updated++;
          continue;
        }
        insert.run(
          randomUUID(),
          companyId,
          category.code,
          category.description,
          category.categoryType,
          category.parentCode,
          category.isActive ? 1 : 0
        );
        counters.created++;
      }
    });

    return counters;
  }

  /**
   * Puxa o cadastro de veiculos do OMIE (/transportador/veiculo/) para `vehicles`.
   * O que interessa e a **UF da placa**: a NF-e pede placa E UF do veiculo, e o bloco
   * `frete` do pedido de venda leva os dois (`placa` + `placa_estado`). Sem esse sync a UF
   * simplesmente nao existia no KyberRock e o pedido saia so com a placa.
   *
   * Idempotente e casado por placa normalizada (so letras/numeros): veiculo local que
   * ja existe recebe a UF e o `omie_vehicle_id`; o que so existe no OMIE entra como
   * cadastro novo com `source = 'omie'`. Nunca sobrescreve uma UF ja preenchida a mao
   * com vazio — o cadastro do OMIE pode nao ter a UF de todos os veiculos.
   *
   * O endpoint de veiculos nao esta liberado em todo tenant; indisponibilidade e
   * tratada por quem chama (o sync da entidade registra o erro sem derrubar o resto).
   */
  async syncVehicles(companyId: string): Promise<MasterEntitySyncCounters> {
    const omieVehicles = await this.vehiclesService.listAll();
    const counters: MasterEntitySyncCounters = {
      fetched: omieVehicles.length,
      created: 0,
      updated: 0,
      skipped: 0
    };

    const findLocal = this.db.prepare(
      `SELECT id, plate_state, omie_vehicle_id
         FROM vehicles
        WHERE company_id = ?
          AND UPPER(REPLACE(REPLACE(COALESCE(plate_normalized, plate), ' ', ''), '-', '')) = ?
          AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1`
    );
    const update = this.db.prepare(
      `UPDATE vehicles
          SET plate_state = COALESCE(?, plate_state),
              omie_vehicle_id = COALESCE(?, omie_vehicle_id),
              last_synced_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`
    );
    const insert = this.db.prepare(
      `INSERT INTO vehicles
         (id, company_id, plate, plate_normalized, plate_state, description, omie_vehicle_id,
          source, is_active, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'omie', ?, datetime('now'), datetime('now'), datetime('now'))`
    );

    this.runInTransaction(() => {
      for (const vehicle of omieVehicles) {
        if (!vehicle.plate) {
          counters.skipped++;
          continue;
        }
        const omieId = vehicle.id > 0 ? vehicle.id : null;
        const existing = findLocal.get(companyId, vehicle.plate) as
          | { id: string; plate_state: string | null; omie_vehicle_id: number | null }
          | undefined;

        if (existing) {
          // Nada de novo (UF igual e vinculo ja feito): nao conta como atualizado.
          const sameState =
            vehicle.plateState === null || existing.plate_state === vehicle.plateState;
          const sameOmieId = omieId === null || existing.omie_vehicle_id === omieId;
          if (sameState && sameOmieId) {
            counters.skipped++;
            continue;
          }
          update.run(vehicle.plateState, omieId, existing.id);
          counters.updated++;
          continue;
        }

        insert.run(
          randomUUID(),
          companyId,
          vehicle.plate,
          vehicle.plate,
          vehicle.plateState,
          vehicle.description,
          omieId,
          vehicle.isActive ? 1 : 0
        );
        counters.created++;
      }
    });

    return counters;
  }

  /**
   * Puxa as contas correntes do OMIE (nome + nCodCC) para accounts. Idempotente:
   * contas ja puxadas (mesmo omie_code) nao mudam; contas locais sem codigo com o
   * mesmo nome sao adotadas; as demais entram como novas contas vindas do OMIE.
   *
   * Alem da adocao por nome exato, as contas padrao do KyberRock (Caixinha, OMIE Cash,
   * GetNet) sao reconciliadas com a conta corrente correspondente do OMIE por nome
   * canonico (ignorando espacos/acentos/pontuacao), de modo que variacoes de grafia
   * do OMIE ("OMIECASH", "Omie Cash", "Get Net") ainda vinculem o nCodCC certo. Assim
   * o meio de pagamento apontado para a conta padrao (ex.: boleto -> OMIE Cash) leva a
   * conta corrente correta no pedido/OS em vez de cair na conta padrao do tenant.
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
    // Conta padrao (caixinha/omie_cash/getnet) da empresa, alvo da reconciliacao canonica.
    const findDefaultByCode = this.db.prepare(
      "SELECT id, name, omie_code FROM accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL"
    );
    // Conta (qualquer) que ja carrega este nCodCC — usada para detectar a duplicata que
    // um sync antigo criou quando o nome canonico ainda nao era reconhecido.
    const findByOmieCode = this.db.prepare(
      "SELECT id, is_system FROM accounts WHERE company_id = ? AND omie_code = ? AND deleted_at IS NULL"
    );
    const setOmieCode = this.db.prepare(
      "UPDATE accounts SET omie_code = ?, updated_at = datetime('now') WHERE id = ?"
    );
    // Transfere as formas de pagamento da conta duplicada para a conta padrao antes de aposenta-la.
    const repointPaymentMethods = this.db.prepare(
      "UPDATE payment_methods SET account_id = ?, updated_at = datetime('now') WHERE account_id = ? AND deleted_at IS NULL"
    );
    const retireDuplicate = this.db.prepare(
      `UPDATE accounts
         SET omie_code = NULL, is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
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

        // 1) Reconcilia a conta padrao do KyberRock (Caixinha/OMIE Cash/GetNet) com a conta
        //    corrente do OMIE por nome canonico, tolerando variacoes de grafia.
        const canonicalCode = canonicalDefaultAccountCode(account.name);
        if (canonicalCode) {
          const seed = findDefaultByCode.get(companyId, canonicalCode) as
            | { id: string; name: string; omie_code: string | null }
            | undefined;
          if (seed) {
            if (seed.omie_code === omieCode) {
              counters.skipped++;
              continue;
            }
            if (seed.omie_code === null) {
              // Um sync antigo pode ter criado uma conta separada com este nCodCC; aposenta-a
              // e transfere para a conta padrao as formas de pagamento que apontavam para ela.
              const duplicate = findByOmieCode.get(companyId, omieCode) as
                | { id: string; is_system: number }
                | undefined;
              if (duplicate && duplicate.id !== seed.id && duplicate.is_system === 0) {
                repointPaymentMethods.run(seed.id, duplicate.id);
                retireDuplicate.run(duplicate.id);
              }
              setOmieCode.run(omieCode, seed.id);
              adoptableByName.delete(normalizeAccountName(seed.name));
              counters.updated++;
              continue;
            }
            // seed ja vinculado a outro nCodCC: segue no fluxo padrao abaixo.
          }
        }

        // 2) Fluxo padrao: pula quem ja tem o codigo, adota conta local de mesmo nome, senao insere.
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
    const transportadoras = customers.filter((customer) => isOmieCarrierCadastro(customer));

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

    const documentlessIndex = this.buildDocumentlessLocalIndex("carriers", companyId);
    const adopted = new Set<string>();

    for (const supplier of carriers) {
      upsert.run(
        this.resolveExistingCarrierId(companyId, supplier, documentlessIndex, adopted),
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

  /**
   * Cadastros locais SEM CNPJ/CPF e sem codigo OMIE, agrupados pelo nome normalizado.
   *
   * Sao os "cadastros da correria": caminhao na fila, o operador salva o cliente so com o
   * nome para nao segurar a balanca. Enquanto estao assim, nenhuma das travas por documento
   * consegue reconhece-los — e e por isso que precisam de um indice proprio.
   *
   * O indice e montado UMA vez por passada e nao e reconsultado a cada cadastro do OMIE:
   * quem adota uma linha risca ela do jogo pelo conjunto `adopted`, e uma consulta nova
   * traria de volta a linha que a iteracao anterior ja levou.
   */
  private buildDocumentlessLocalIndex(
    table: "customers" | "carriers",
    companyId: string
  ): Map<string, string[]> {
    const nameColumns = table === "customers" ? ["legal_name", "trade_name"] : ["name"];
    const rows = this.db
      .prepare(
        `SELECT id, ${nameColumns.join(", ")} FROM ${table}
         WHERE company_id = ?
           AND deleted_at IS NULL
           AND omie_customer_id IS NULL
           AND ${DOCUMENT_KEY_SQL} = ''`
      )
      .all(companyId) as Array<Record<string, string | null>>;

    const index = new Map<string, string[]>();
    for (const row of rows) {
      const id = row.id as string;
      for (const column of nameColumns) {
        const key = normalizeMatchKey(row[column] ?? "");
        if (!key) continue;
        const ids = index.get(key);
        if (!ids) index.set(key, [id]);
        else if (!ids.includes(id)) ids.push(id);
      }
    }
    return index;
  }

  /**
   * O cadastro da correria que este cadastro do OMIE vem completar — ou nada.
   *
   * Mesma regra que a importacao por planilha ja aplica (`customer-import.ts`): um cadastro
   * local SEM documento pode ser o mesmo cliente que chega com CNPJ/CPF, porque nao ha
   * documento local para contradizer. Cadastro que ja TEM documento nunca casa por nome —
   * matriz e filial, ou o CPF do dono e o CNPJ da empresa, dividem o nome e sao clientes
   * diferentes.
   *
   * Empate nao vira palpite: dois cadastros locais sem documento com o mesmo nome deixam a
   * decisao para o operador, e o cadastro do OMIE entra como linha propria (aqui a passada
   * nao pode abortar como a planilha aborta — ela sincroniza a base inteira).
   */
  private adoptDocumentlessLocalCadastro(
    index: Map<string, string[]>,
    adopted: Set<string>,
    names: Array<string | null | undefined>
  ): string | null {
    const candidates = new Set<string>();
    for (const name of names) {
      const key = normalizeMatchKey(name ?? "");
      if (!key) continue;
      for (const id of index.get(key) ?? []) {
        if (!adopted.has(id)) candidates.add(id);
      }
    }
    if (candidates.size !== 1) return null;
    const [id] = [...candidates];
    adopted.add(id);
    return id;
  }

  /**
   * Id local a usar para um cliente vindo do OMIE. Adota o cadastro que ja existe
   * aqui — primeiro pelo codigo OMIE, depois pelo CNPJ/CPF, por fim pelo nome quando o
   * cadastro local ainda esta sem documento — antes de cair no id derivado `omie_<id>`.
   *
   * Sem isso, um cliente criado localmente e depois enviado ao OMIE voltava no pull
   * seguinte como uma LINHA NOVA (o upsert so casa por id, e o local tem uuid): a
   * lista ficava com dois cadastros identicos do mesmo cliente.
   */
  private resolveExistingCustomerId(
    companyId: string,
    customer: Customer,
    documentlessIndex: Map<string, string[]>,
    adopted: Set<string>
  ): string {
    const byOmieId = this.db
      .prepare(
        "SELECT id FROM customers WHERE company_id = ? AND omie_customer_id = ? AND deleted_at IS NULL LIMIT 1"
      )
      .get(companyId, customer.id) as { id: string } | undefined;
    if (byOmieId) return byOmieId.id;

    const key = documentKey(customer.document);
    if (key) {
      const byDocument = this.db
        .prepare(
          `SELECT id FROM customers
           WHERE company_id = ?
             AND deleted_at IS NULL
             AND ${DOCUMENT_KEY_SQL} = ?
           LIMIT 1`
        )
        .get(companyId, key) as { id: string } | undefined;
      if (byDocument) return byDocument.id;
    }

    const byName = this.adoptDocumentlessLocalCadastro(documentlessIndex, adopted, [
      customer.tradeName,
      customer.name
    ]);
    if (byName) return byName;

    return resolveOmieLocalId(this.db, "customers", companyId, `omie_${customer.id}`);
  }

  /** Mesma adocao do cliente, para a transportadora (ver resolveExistingCustomerId). */
  private resolveExistingCarrierId(
    companyId: string,
    carrier: Customer,
    documentlessIndex: Map<string, string[]>,
    adopted: Set<string>
  ): string {
    const byOmieId = this.db
      .prepare(
        "SELECT id FROM carriers WHERE company_id = ? AND omie_customer_id = ? AND deleted_at IS NULL LIMIT 1"
      )
      .get(companyId, carrier.id) as { id: string } | undefined;
    if (byOmieId) return byOmieId.id;

    const key = documentKey(carrier.document);
    if (key) {
      const byDocument = this.db
        .prepare(
          `SELECT id FROM carriers
           WHERE company_id = ?
             AND deleted_at IS NULL
             AND ${DOCUMENT_KEY_SQL} = ?
           LIMIT 1`
        )
        .get(companyId, key) as { id: string } | undefined;
      if (byDocument) return byDocument.id;
    }

    const byName = this.adoptDocumentlessLocalCadastro(documentlessIndex, adopted, [
      carrier.tradeName,
      carrier.name
    ]);
    if (byName) return byName;

    return resolveOmieLocalId(this.db, "carriers", companyId, `omie_supplier_${carrier.id}`);
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
    this.db
      .prepare(
        `
      UPDATE customer_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND customer_id IN (
          SELECT id FROM customers
          WHERE company_id = ? AND source = 'omie' AND needs_push = 0
        )
    `
      )
      .run(companyId);

    this.db
      .prepare(
        `
      UPDATE customers
      SET default_carrier_id = NULL,
          deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND deleted_at IS NULL
        AND source = 'omie'
        AND needs_push = 0
    `
      )
      .run(companyId);
  }

  private clearCarriers(companyId: string): void {
    // Mesma regra de reconciliacao dos clientes: mexe apenas em transportadoras vindas do
    // OMIE sem push pendente. As relacoes sao resetadas somente para essas transportadoras.
    const omieCarrierFilter =
      "carrier_id IN (SELECT id FROM carriers WHERE company_id = ? AND source = 'omie' AND needs_push = 0)";

    this.db
      .prepare(
        `
      UPDATE customer_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND ${omieCarrierFilter}
    `
      )
      .run(companyId);

    this.db
      .prepare(
        `
      UPDATE driver_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND ${omieCarrierFilter}
    `
      )
      .run(companyId);

    this.db
      .prepare(
        `
      UPDATE vehicle_carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND ${omieCarrierFilter}
    `
      )
      .run(companyId);

    this.db
      .prepare(
        `
      UPDATE vehicles
      SET carrier_id = NULL,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND ${omieCarrierFilter}
    `
      )
      .run(companyId, companyId);

    this.db
      .prepare(
        `
      UPDATE customers
      SET default_carrier_id = NULL,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND default_carrier_id IN (
          SELECT id FROM carriers WHERE company_id = ? AND source = 'omie' AND needs_push = 0
        )
    `
      )
      .run(companyId, companyId);

    this.db
      .prepare(
        `
      UPDATE carriers
      SET deleted_at = datetime('now'),
          is_active = 0,
          updated_at = datetime('now')
      WHERE company_id = ?
        AND deleted_at IS NULL
        AND source = 'omie'
        AND needs_push = 0
    `
      )
      .run(companyId);
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
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Mapeia o nome de uma conta corrente do OMIE para o codigo da conta padrao do
 * KyberRock (caixinha/omie_cash/getnet), ou null quando nao e uma das contas
 * conhecidas. A comparacao usa o nome "achatado" (sem acentos, espacos ou
 * pontuacao) para tolerar as variacoes de grafia do OMIE — "OMIE Cash",
 * "OMIECASH", "Omie-Cash", "Get Net" etc. — e garantir que a conta padrao adote o
 * nCodCC correto mesmo quando o nome nao bate exatamente.
 */
function canonicalDefaultAccountCode(name: string): string | null {
  const flat = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!flat) return null;
  if (flat.includes("omiecash")) return "omie_cash";
  if (flat.includes("getnet")) return "getnet";
  if (flat.includes("caixinha")) return "caixinha";
  if (flat.includes("bonificacao")) return "bonificacao";
  if (flat.includes("emcarteira")) return "em_carteira";
  return null;
}
