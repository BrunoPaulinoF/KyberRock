import type { DesktopDatabase } from "../database/sqlite.js";
import type { CustomerImportRecord } from "./customer-import-sheet.js";
import { normalizeMatchKey } from "./customer-import-sheet.js";
import type { CustomerRow, UpdateCustomerInput } from "./customers.js";
import { createCustomer, findCustomerByDocument, updateCustomer } from "./customers.js";
import { removeCustomerSpecialPrice, setCustomerSpecialPrice } from "./product-prices.js";

/**
 * Aplica a planilha consolidada no banco local.
 *
 * O KyberRock e offline-first: o cadastro nasce aqui, e o `omie-sync` empurra depois. Por
 * isso a importacao so escreve no SQLite e marca `needs_push` — quem fala com o OMIE
 * continua sendo o sync, com a idempotencia dele. Cliente que ja existe (mesmo CNPJ/CPF)
 * tem os campos da planilha SOBRESCRITOS; quem nao existe e criado.
 */

export interface ImportCustomersOptions {
  companyId: string;
  /** Simula tudo e desfaz no fim: mesmo relatorio, banco intacto. */
  dryRun?: boolean;
  /** Celula vazia apaga o valor atual. Padrao: celula vazia mantem o que ja existe. */
  clearEmpty?: boolean;
  /** Apaga os precos especiais do cliente que nao aparecem na planilha. */
  replacePrices?: boolean;
  /** Pula quem ficou sem CNPJ/CPF (o OMIE recusa cadastro sem documento). */
  requireDocument?: boolean;
  /** Nome do produto na planilha -> codigo ou descricao do produto no KyberRock. */
  productAliases?: Record<string, string>;
  now?: Date;
}

export type ImportEntryAction = "created" | "updated" | "unchanged" | "skipped" | "error";

export interface ImportCustomerEntry {
  sourceLine: number;
  customer: string;
  document: string | null;
  action: ImportEntryAction;
  customerId: string | null;
  /** Campos do cadastro que a planilha alterou. */
  changedFields: string[];
  pricesApplied: number;
  pricesRemoved: number;
  /** Produtos da planilha que nao existem no KyberRock. */
  unresolvedProducts: string[];
  message: string | null;
}

export interface ImportCustomersReport {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  pricesApplied: number;
  pricesRemoved: number;
  /** Produtos nao encontrados, sem repetir — a lista que o operador precisa cadastrar. */
  unresolvedProducts: string[];
  entries: ImportCustomerEntry[];
}

interface ProductIndexEntry {
  id: string;
  code: string | null;
  description: string;
}

const ROLLBACK_SENTINEL = "__kyberrock_import_dry_run__";

export function importCustomers(
  database: DesktopDatabase,
  records: readonly CustomerImportRecord[],
  options: ImportCustomersOptions
): ImportCustomersReport {
  const report: ImportCustomersReport = {
    dryRun: options.dryRun === true,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    pricesApplied: 0,
    pricesRemoved: 0,
    unresolvedProducts: [],
    entries: []
  };

  const run = database.transaction(() => {
    const products = loadProductIndex(database, options.companyId);
    const customersByName = loadCustomerNameIndex(database, options.companyId);

    for (const record of records) {
      const entry = importRecord(database, record, options, products, customersByName);
      report.entries.push(entry);
    }

    if (options.dryRun) {
      // better-sqlite3 so desfaz a transacao se ela terminar com excecao.
      throw new Error(ROLLBACK_SENTINEL);
    }
  });

  try {
    run();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) throw error;
  }

  const unresolved = new Set<string>();
  for (const entry of report.entries) {
    switch (entry.action) {
      case "created":
        report.created++;
        break;
      case "updated":
        report.updated++;
        break;
      case "unchanged":
        report.unchanged++;
        break;
      case "skipped":
        report.skipped++;
        break;
      case "error":
        report.failed++;
        break;
    }
    report.pricesApplied += entry.pricesApplied;
    report.pricesRemoved += entry.pricesRemoved;
    entry.unresolvedProducts.forEach((product) => unresolved.add(product));
  }
  report.unresolvedProducts = [...unresolved].sort((left, right) => left.localeCompare(right));

  return report;
}

function importRecord(
  database: DesktopDatabase,
  record: CustomerImportRecord,
  options: ImportCustomersOptions,
  products: Map<string, ProductIndexEntry[]>,
  customersByName: Map<string, CustomerRow[]>
): ImportCustomerEntry {
  const displayName = record.tradeName || record.legalName || "(sem nome)";
  const entry: ImportCustomerEntry = {
    sourceLine: record.sourceLine,
    customer: displayName,
    document: record.document,
    action: "skipped",
    customerId: null,
    changedFields: [],
    pricesApplied: 0,
    pricesRemoved: 0,
    unresolvedProducts: [],
    message: null
  };

  if (!record.document && options.requireDocument) {
    entry.message = "Sem CNPJ/CPF na planilha.";
    return entry;
  }

  try {
    const existing = findExistingCustomer(database, record, options.companyId, customersByName);

    if (existing) {
      const patch = buildUpdateInput(record, existing, options.clearEmpty === true);
      entry.customerId = existing.id;
      entry.changedFields = Object.keys(patch);

      if (entry.changedFields.length > 0) {
        // `overrideOmieFields` libera os campos que o OMIE normalmente tranca e passa o
        // cadastro para 'hybrid' — sem isso a planilha nao entraria em cliente vindo do
        // OMIE, e o que entrasse nunca seria empurrado de volta.
        updateCustomer(database, existing.id, patch, options.now ?? new Date(), {
          overrideOmieFields: true
        });
        entry.action = "updated";
      } else {
        entry.action = "unchanged";
      }
    } else {
      const created = createCustomer(
        database,
        {
          companyId: options.companyId,
          tradeName: record.tradeName || record.legalName || displayName,
          legalName: record.legalName || record.tradeName || displayName,
          document: record.document ?? undefined,
          phone: record.phone ?? undefined,
          email: record.email ?? undefined,
          observations: record.observations ?? undefined,
          creditLimitCents: record.creditLimitCents ?? undefined,
          nfRequired: record.nfRequired ?? undefined,
          zipcode: record.zipcode ?? undefined,
          addressStreet: record.addressStreet ?? undefined,
          addressNumber: record.addressNumber ?? undefined,
          addressComplement: record.addressComplement ?? undefined,
          neighborhood: record.neighborhood ?? undefined,
          city: record.city ?? undefined,
          state: record.state ?? undefined
        },
        options.now ?? new Date()
      );

      entry.customerId = created.id;
      entry.action = "created";
      indexCustomer(customersByName, created);
    }

    if (!record.document) {
      entry.message =
        "Sem CNPJ/CPF — o OMIE vai recusar este cadastro ate o documento ser preenchido.";
    }

    applyPrices(database, entry, record, options, products);
  } catch (error) {
    entry.action = "error";
    entry.customerId = null;
    entry.message = error instanceof Error ? error.message : String(error);
  }

  return entry;
}

/**
 * O CNPJ/CPF manda: e por ele que o OMIE identifica o cliente. Sem documento na planilha,
 * cai para o nome — e nome repetido vira erro em vez de escolher um dos dois.
 */
function findExistingCustomer(
  database: DesktopDatabase,
  record: CustomerImportRecord,
  companyId: string,
  customersByName: Map<string, CustomerRow[]>
): CustomerRow | null {
  if (record.document) {
    const found = findCustomerByDocument(database, companyId, record.document);
    if (found) {
      return database.prepare("SELECT * FROM customers WHERE id = ?").get(found.id) as CustomerRow;
    }
  }

  const candidates = new Set<CustomerRow>();
  for (const name of [record.tradeName, record.legalName]) {
    if (!name) continue;
    for (const row of customersByName.get(normalizeMatchKey(name)) ?? []) {
      candidates.add(row);
    }
  }

  const matches = [...candidates];
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  throw new Error(
    `"${record.tradeName || record.legalName}" casa com ${matches.length} clientes ja cadastrados. ` +
      `Preencha o CNPJ/CPF na planilha para desempatar.`
  );
}

/** Campos vazios na planilha nao apagam o cadastro, a menos que `clearEmpty` peca. */
function buildUpdateInput(
  record: CustomerImportRecord,
  existing: CustomerRow,
  clearEmpty: boolean
): UpdateCustomerInput {
  const patch: UpdateCustomerInput = {};

  const setText = (
    key: "tradeName" | "legalName" | "document" | "phone" | "email" | "observations",
    value: string | null,
    current: string | null
  ): void => {
    if (value === null && !clearEmpty) return;
    if ((value ?? null) === (current ?? null)) return;
    patch[key] = value ?? "";
  };

  const setNullableText = (
    key:
      | "zipcode"
      | "addressStreet"
      | "addressNumber"
      | "addressComplement"
      | "neighborhood"
      | "city"
      | "state",
    value: string | null,
    current: string | null
  ): void => {
    if (value === null && !clearEmpty) return;
    if ((value ?? null) === (current ?? null)) return;
    patch[key] = value;
  };

  // Nome vazio nunca apaga: `legal_name`/`trade_name` sao NOT NULL no banco.
  if (record.tradeName && record.tradeName !== existing.trade_name) {
    patch.tradeName = record.tradeName;
  }
  const legalName = record.legalName ?? record.tradeName;
  if (legalName && legalName !== existing.legal_name) {
    patch.legalName = legalName;
  }

  setText("document", record.document, existing.document);
  setText("phone", record.phone, existing.phone);
  setText("email", record.email, existing.email);
  setNullableText("zipcode", record.zipcode, existing.zipcode);
  setNullableText("addressStreet", record.addressStreet, existing.address_street);
  setNullableText("addressNumber", record.addressNumber, existing.address_number);
  setNullableText("addressComplement", record.addressComplement, existing.address_complement);
  setNullableText("neighborhood", record.neighborhood, existing.neighborhood);
  setNullableText("city", record.city, existing.city);
  setNullableText("state", record.state, existing.state);
  setText("observations", record.observations, existing.observations);

  if (record.creditLimitCents !== null && record.creditLimitCents !== existing.credit_limit_cents) {
    patch.creditLimitCents = record.creditLimitCents;
  } else if (
    record.creditLimitCents === null &&
    clearEmpty &&
    existing.credit_limit_cents !== null
  ) {
    patch.creditLimitCents = null;
  }

  if (record.nfRequired !== null && record.nfRequired !== (existing.nf_required === 1)) {
    patch.nfRequired = record.nfRequired;
  }

  return patch;
}

function applyPrices(
  database: DesktopDatabase,
  entry: ImportCustomerEntry,
  record: CustomerImportRecord,
  options: ImportCustomersOptions,
  products: Map<string, ProductIndexEntry[]>
): void {
  if (!entry.customerId) return;

  const aliases = normalizeAliases(options.productAliases);
  const appliedProductIds = new Set<string>();

  for (const price of record.prices) {
    const product = resolveProduct(products, aliases, price.product);
    if (!product) {
      entry.unresolvedProducts.push(price.product);
      continue;
    }

    appliedProductIds.add(product.id);

    const current = database
      .prepare(
        `SELECT unit_price_cents FROM customer_special_prices
         WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL AND is_active = 1
         LIMIT 1`
      )
      .get(entry.customerId, product.id) as { unit_price_cents: number } | undefined;

    if (current?.unit_price_cents === price.unitPriceCents) continue;

    setCustomerSpecialPrice(
      database,
      {
        companyId: options.companyId,
        customerId: entry.customerId,
        productId: product.id,
        unitPriceCents: price.unitPriceCents
      },
      options.now ?? new Date()
    );
    entry.pricesApplied++;
  }

  if (!options.replacePrices || record.prices.length === 0) return;

  const existingPrices = database
    .prepare(
      `SELECT product_id FROM customer_special_prices
       WHERE customer_id = ? AND deleted_at IS NULL AND is_active = 1`
    )
    .all(entry.customerId) as Array<{ product_id: string }>;

  for (const row of existingPrices) {
    if (appliedProductIds.has(row.product_id)) continue;
    removeCustomerSpecialPrice(
      database,
      entry.customerId,
      row.product_id,
      options.now ?? new Date()
    );
    entry.pricesRemoved++;
  }
}

// ---------------------------------------------------------------------------
// Indices
// ---------------------------------------------------------------------------

function loadProductIndex(
  database: DesktopDatabase,
  companyId: string
): Map<string, ProductIndexEntry[]> {
  const rows = database
    .prepare(
      `SELECT id, code, description FROM products
       WHERE company_id = ? AND deleted_at IS NULL AND is_active = 1`
    )
    .all(companyId) as Array<{ id: string; code: string | null; description: string }>;

  const index = new Map<string, ProductIndexEntry[]>();
  for (const row of rows) {
    const product: ProductIndexEntry = { id: row.id, code: row.code, description: row.description };
    for (const key of [normalizeMatchKey(row.description), normalizeMatchKey(row.code ?? "")]) {
      if (!key) continue;
      const bucket = index.get(key);
      if (bucket) bucket.push(product);
      else index.set(key, [product]);
    }
  }
  return index;
}

function loadCustomerNameIndex(
  database: DesktopDatabase,
  companyId: string
): Map<string, CustomerRow[]> {
  const rows = database
    .prepare("SELECT * FROM customers WHERE company_id = ? AND deleted_at IS NULL")
    .all(companyId) as CustomerRow[];

  const index = new Map<string, CustomerRow[]>();
  rows.forEach((row) => indexCustomer(index, row));
  return index;
}

function indexCustomer(index: Map<string, CustomerRow[]>, row: CustomerRow): void {
  for (const name of [row.trade_name, row.legal_name]) {
    const key = normalizeMatchKey(name ?? "");
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) {
      if (!bucket.includes(row)) bucket.push(row);
    } else {
      index.set(key, [row]);
    }
  }
}

function normalizeAliases(aliases: Record<string, string> | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const [from, to] of Object.entries(aliases ?? {})) {
    map.set(normalizeMatchKey(from), normalizeMatchKey(to));
  }
  return map;
}

/**
 * Casa o nome do produto da planilha com o cadastro: alias explicito, depois descricao ou
 * codigo exatos e, por ultimo, um unico produto que contenha o nome. Duas descricoes
 * parecidas ("Brita 1" e "Brita 1 lavada") viram produto nao resolvido — preco no produto
 * errado sai caro na nota.
 */
function resolveProduct(
  products: Map<string, ProductIndexEntry[]>,
  aliases: Map<string, string>,
  name: string
): ProductIndexEntry | null {
  const key = aliases.get(normalizeMatchKey(name)) ?? normalizeMatchKey(name);
  if (!key) return null;

  const exact = products.get(key);
  if (exact?.length === 1) return exact[0];
  if (exact && exact.length > 1) return null;

  const partial = new Set<ProductIndexEntry>();
  for (const [candidateKey, entries] of products) {
    if (candidateKey.includes(key) || key.includes(candidateKey)) {
      entries.forEach((entry) => partial.add(entry));
    }
  }

  const unique = [...partial];
  return unique.length === 1 ? unique[0] : null;
}

// ---------------------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------------------

export interface CompanyOption {
  id: string;
  tradeName: string;
  legalName: string;
}

export function listCompanies(database: DesktopDatabase): CompanyOption[] {
  return (
    database
      .prepare(
        `SELECT id, trade_name, legal_name FROM companies
         WHERE deleted_at IS NULL ORDER BY trade_name ASC`
      )
      .all() as Array<{ id: string; trade_name: string; legal_name: string }>
  ).map((row) => ({ id: row.id, tradeName: row.trade_name, legalName: row.legal_name }));
}

/** Sem `--empresa`, usa a unica empresa do banco (o caso normal de uma instalacao). */
export function resolveCompanyId(database: DesktopDatabase, requested?: string): string {
  const companies = listCompanies(database);

  if (requested) {
    const found = companies.find((company) => company.id === requested);
    if (!found) {
      throw new Error(
        `Empresa "${requested}" nao existe neste banco. Empresas: ${
          companies.map((company) => `${company.id} (${company.tradeName})`).join(", ") ||
          "(nenhuma)"
        }.`
      );
    }
    return found.id;
  }

  if (companies.length === 0) {
    throw new Error(
      "Nenhuma empresa cadastrada neste banco. Abra o KyberRock e ative a instalacao antes de importar."
    );
  }
  if (companies.length > 1) {
    throw new Error(
      `Ha ${companies.length} empresas neste banco. Informe --empresa <id>: ${companies
        .map((company) => `${company.id} (${company.tradeName})`)
        .join(", ")}.`
    );
  }

  return companies[0].id;
}
