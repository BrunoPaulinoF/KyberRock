/**
 * "Preços e volume por cliente" (aba da tela Relatorios): para cada cliente, o prazo de
 * pagamento, o preco por tonelada de cada produto que esta no cadastro dele e quanto de cada
 * material ele carregou no mes. E o que o escritorio pede para conferir preco contra volume
 * sem abrir cliente por cliente.
 *
 * As regras sao as que a balanca ja usa, para o numero daqui bater com o da pesagem:
 *
 * - **Preco** = o do `PricingService` do desktop: o preco especial do cliente; sem ele, a tabela
 *   padrao do produto ou, sem ela, o valor do OMIE gravado no produto (`defaultPriceByProduct`).
 *   Entram todos os produtos com preco especial no cadastro, carregados ou nao, e os produtos
 *   carregados no mes que so tem o preco padrao.
 * - **Prazo** = a condicao de pagamento padrao do cadastro. Cliente sem ela mostra a condicao
 *   que mais apareceu nas cargas do mes, marcada como "pelas cargas" — vazio nao ajuda quem
 *   recebe o relatorio, e a carga diz o prazo que de fato foi para o OMIE.
 * - **Volume** = peso liquido das pesagens CONCLUIDAS do mes, pela data de FECHAMENTO (CLAUDE.md,
 *   "Data da pesagem nos relatorios"), a mesma leitura dos outros relatorios da tela.
 * - **Cliente** = o cliente REAL: os cadastros gemeos (mesmo documento ou mesmo codigo OMIE, um
 *   do OMIE e outro de uma balanca) viram uma linha so (`dedupeCustomers`), com os precos
 *   especiais e as cargas de todos eles.
 */

import { dedupeCustomers, type CustomerOptionSource } from "./billing-conference";
import { defaultPriceByProduct } from "./customer-cadastro";
import {
  SPREADSHEET_HTML_ATTRS,
  SPREADSHEET_STYLE,
  documentStyle,
  escapeHtml,
  kpiCards,
  section,
  sheetTable,
  table
} from "./desktop/report-document";
import { formatDocument, formatMoney, formatTons, normalizeDocument } from "./format";
import type {
  CustomerSpecialPrice,
  Operation,
  PaymentTerm,
  Product,
  ProductDefaultPrice
} from "./queries";
import { supabase } from "./supabase";

export type PriceVolumeOperation = Pick<
  Operation,
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "net_weight_kg"
  | "payment_term_id"
>;

export type PriceVolumeCustomerRow = CustomerOptionSource & {
  default_payment_term_id: string | null;
};

/** O cadastro que o relatorio cruza com as cargas do mes. */
export interface PriceVolumeCadastro {
  customers: PriceVolumeCustomerRow[];
  paymentTerms: Array<Pick<PaymentTerm, "id" | "name">>;
  specialPrices: Array<
    Pick<CustomerSpecialPrice, "customer_id" | "product_id" | "unit_price_cents" | "updated_at">
  >;
  products: Array<Pick<Product, "id" | "description" | "code" | "unit_price_cents">>;
  defaultPrices: Array<Pick<ProductDefaultPrice, "product_id" | "unit_price_cents">>;
}

/** De onde veio o preco: especial do cliente, padrao do produto ou nenhum. */
export type PriceVolumeSource = "special" | "default" | "none";

export const PRICE_SOURCE_LABEL: Record<PriceVolumeSource, string> = {
  special: "Especial",
  default: "Padrão",
  none: "Sem preço"
};

export interface PriceVolumeProduct {
  key: string;
  productId: string | null;
  productName: string;
  /** Preco por tonelada do cadastro; `null` quando o produto nao tem preco nenhum. */
  priceCents: number | null;
  priceSource: PriceVolumeSource;
  /** Peso liquido carregado no mes (kg); 0 = tem preco no cadastro, mas nao carregou. */
  weightKg: number;
  loads: number;
}

export interface PriceVolumeCustomer {
  key: string;
  /** Um dos cadastros do cliente (o que abre o cartao Info); `null` = venda so com o nome. */
  customerId: string | null;
  name: string;
  document: string | null;
  paymentTerm: string | null;
  /** `cadastro` = condicao padrao do cliente; `loads` = a mais usada nas cargas do mes. */
  paymentTermSource: "cadastro" | "loads" | null;
  products: PriceVolumeProduct[];
  weightKg: number;
  loads: number;
}

export interface PriceVolumeMaterial {
  key: string;
  productName: string;
  weightKg: number;
  loads: number;
  customers: number;
}

export interface PriceVolumeReport {
  customers: PriceVolumeCustomer[];
  /** Volume de cada material no mes, somando todos os clientes. */
  materials: PriceVolumeMaterial[];
  totals: { customers: number; loads: number; weightKg: number };
}

export interface PriceVolumeOptions {
  /** Inclui quem tem preco especial no cadastro mas nao carregou no mes. */
  includeIdle?: boolean;
}

interface Group {
  key: string;
  customerId: string | null;
  name: string;
  document: string | null;
  ids: string[];
}

function productKey(productId: string | null, description: string | null): string {
  return productId ? `id:${productId}` : `nome:${(description ?? "").trim() || "N/A"}`;
}

function rowName(row: Pick<CustomerOptionSource, "trade_name" | "legal_name">): string {
  return (row.trade_name ?? "").trim() || (row.legal_name ?? "").trim() || "Sem nome";
}

/** Monta o relatorio. Puro: a tela, o PDF e a planilha partem do mesmo resultado. */
export function buildPriceVolumeReport(
  operations: readonly PriceVolumeOperation[],
  cadastro: PriceVolumeCadastro,
  options: PriceVolumeOptions = {}
): PriceVolumeReport {
  const rowById = new Map(cadastro.customers.map((row) => [row.id, row]));
  const termName = new Map(cadastro.paymentTerms.map((term) => [term.id, term.name]));
  const productById = new Map(cadastro.products.map((product) => [product.id, product]));
  const defaultPrice = defaultPriceByProduct(cadastro.products, cadastro.defaultPrices);

  // Cliente real: os cadastros gemeos caem no mesmo grupo (o id de qualquer um acha o grupo).
  const groupById = new Map<string, Group>();
  const liveGroups: Group[] = [];
  for (const option of dedupeCustomers(cadastro.customers)) {
    const group: Group = {
      key: `cliente:${option.id}`,
      customerId: option.id,
      name: option.name,
      document: option.document,
      ids: option.ids
    };
    liveGroups.push(group);
    for (const id of option.ids) groupById.set(id, group);
  }
  const groupFor = (op: PriceVolumeOperation): Group => {
    if (op.customer_id) {
      const known = groupById.get(op.customer_id);
      if (known) return known;
      // Cadastro inativo/excluido sem gemeo vivo: ainda e o cliente daquela carga.
      const row = rowById.get(op.customer_id);
      const group: Group = {
        key: `cliente:${op.customer_id}`,
        customerId: op.customer_id,
        name: row ? rowName(row) : (op.customer_name ?? "").trim() || "Sem nome",
        document: row?.document ?? null,
        ids: [op.customer_id]
      };
      groupById.set(op.customer_id, group);
      return group;
    }
    const name = (op.customer_name ?? "").trim() || "N/A";
    const key = `nome:${name}`;
    const known = groupById.get(key);
    if (known) return known;
    const group: Group = { key, customerId: null, name, document: null, ids: [] };
    groupById.set(key, group);
    return group;
  };

  // Precos especiais vivos de cada grupo; dois do mesmo produto (copia de outra balanca), vale
  // o atualizado por ultimo — o mesmo desempate do cartao Info (`specialPriceLines`).
  const specialsByGroup = new Map<string, Map<string, { cents: number; updatedAt: string }>>();
  for (const special of cadastro.specialPrices) {
    const group = groupById.get(special.customer_id);
    if (!group) continue;
    const byProduct = specialsByGroup.get(group.key) ?? new Map();
    const current = byProduct.get(special.product_id);
    if (!current || special.updated_at > current.updatedAt) {
      byProduct.set(special.product_id, {
        cents: special.unit_price_cents,
        updatedAt: special.updated_at
      });
    }
    specialsByGroup.set(group.key, byProduct);
  }

  interface Acc {
    group: Group;
    products: Map<string, PriceVolumeProduct>;
    termCounts: Map<string, number>;
  }
  const accs = new Map<string, Acc>();
  const accFor = (group: Group): Acc => {
    let acc = accs.get(group.key);
    if (!acc) {
      acc = { group, products: new Map(), termCounts: new Map() };
      accs.set(group.key, acc);
    }
    return acc;
  };
  const productEntry = (
    acc: Acc,
    productId: string | null,
    description: string | null
  ): PriceVolumeProduct => {
    const key = productKey(productId, description);
    let entry = acc.products.get(key);
    if (!entry) {
      const special = productId ? specialsByGroup.get(acc.group.key)?.get(productId) : undefined;
      const fallback = productId ? (defaultPrice.get(productId) ?? null) : null;
      const product = productId ? productById.get(productId) : undefined;
      entry = {
        key,
        productId,
        productName:
          product?.description?.trim() ||
          (description ?? "").trim() ||
          (productId ? "Produto fora do cadastro" : "N/A"),
        priceCents: special ? special.cents : fallback,
        priceSource: special ? "special" : fallback !== null ? "default" : "none",
        weightKg: 0,
        loads: 0
      };
      acc.products.set(key, entry);
    }
    return entry;
  };

  for (const op of operations) {
    const acc = accFor(groupFor(op));
    const entry = productEntry(acc, op.product_id, op.product_description);
    entry.weightKg += op.net_weight_kg ?? 0;
    entry.loads += 1;
    if (op.payment_term_id) {
      acc.termCounts.set(op.payment_term_id, (acc.termCounts.get(op.payment_term_id) ?? 0) + 1);
    }
  }
  if (options.includeIdle) {
    for (const group of liveGroups) {
      if (specialsByGroup.get(group.key)?.size) accFor(group);
    }
  }

  const customers: PriceVolumeCustomer[] = [];
  for (const acc of accs.values()) {
    // Todo produto com preco especial no cadastro aparece, mesmo sem carga no mes.
    for (const productId of specialsByGroup.get(acc.group.key)?.keys() ?? []) {
      productEntry(acc, productId, null);
    }
    const term = paymentTermOf(acc.group, rowById, termName, acc.termCounts);
    const products = [...acc.products.values()].sort((a, b) =>
      a.productName.localeCompare(b.productName, "pt-BR")
    );
    customers.push({
      key: acc.group.key,
      customerId: acc.group.customerId,
      name: acc.group.name,
      document: acc.group.document,
      paymentTerm: term?.name ?? null,
      paymentTermSource: term?.source ?? null,
      products,
      weightKg: products.reduce((sum, product) => sum + product.weightKg, 0),
      loads: products.reduce((sum, product) => sum + product.loads, 0)
    });
  }
  customers.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return summarize(customers);
}

/**
 * O prazo do cliente: a condicao padrao do cadastro (o cadastro principal primeiro, depois os
 * gemeos) ou, sem ela, a mais usada nas cargas do mes (empate pelo nome).
 */
function paymentTermOf(
  group: Group,
  rowById: ReadonlyMap<string, PriceVolumeCustomerRow>,
  termName: ReadonlyMap<string, string>,
  termCounts: ReadonlyMap<string, number>
): { name: string; source: "cadastro" | "loads" } | null {
  for (const id of group.ids) {
    const termId = rowById.get(id)?.default_payment_term_id;
    const name = termId ? termName.get(termId)?.trim() : undefined;
    if (name) return { name, source: "cadastro" };
  }
  let best: { name: string; count: number } | null = null;
  for (const [termId, count] of termCounts) {
    const name = termName.get(termId)?.trim();
    if (!name) continue;
    if (
      !best ||
      count > best.count ||
      (count === best.count && name.localeCompare(best.name, "pt-BR") < 0)
    ) {
      best = { name, count };
    }
  }
  return best ? { name: best.name, source: "loads" } : null;
}

function summarize(customers: PriceVolumeCustomer[]): PriceVolumeReport {
  const materials = new Map<string, PriceVolumeMaterial>();
  for (const customer of customers) {
    for (const product of customer.products) {
      if (product.loads === 0) continue;
      const material = materials.get(product.key) ?? {
        key: product.key,
        productName: product.productName,
        weightKg: 0,
        loads: 0,
        customers: 0
      };
      material.weightKg += product.weightKg;
      material.loads += product.loads;
      material.customers += 1;
      materials.set(product.key, material);
    }
  }
  return {
    customers,
    materials: [...materials.values()].sort((a, b) => b.weightKg - a.weightKg),
    totals: {
      customers: customers.length,
      loads: customers.reduce((sum, customer) => sum + customer.loads, 0),
      weightKg: customers.reduce((sum, customer) => sum + customer.weightKg, 0)
    }
  };
}

/** Sem acento e em minusculas, para a busca achar "Joao" em "João". */
function searchable(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Busca por nome ou documento (com ou sem pontuacao; o CNPJ alfanumerico nao perde a letra).
 * Os totais e o volume por material passam a ser so dos clientes achados.
 */
export function filterPriceVolumeReport(
  report: PriceVolumeReport,
  search: string
): PriceVolumeReport {
  const term = searchable(search.trim());
  if (!term) return report;
  const documentTerm = normalizeDocument(search);
  return summarize(
    report.customers.filter(
      (customer) =>
        searchable(customer.name).includes(term) ||
        (documentTerm.length >= 3 &&
          normalizeDocument(customer.document ?? "").includes(documentTerm))
    )
  );
}

/** "1 parcela em 30 dias" ou "Não informado"; o prazo tirado das cargas leva a marca. */
export function paymentTermLabel(
  customer: Pick<PriceVolumeCustomer, "paymentTerm" | "paymentTermSource">
): string {
  if (!customer.paymentTerm) return "Não informado";
  return customer.paymentTermSource === "loads"
    ? `${customer.paymentTerm} (pelas cargas)`
    : customer.paymentTerm;
}

export function priceLabel(product: Pick<PriceVolumeProduct, "priceCents">): string {
  return product.priceCents === null ? "-" : formatMoney(product.priceCents);
}

/** "12,345 t" ou "-" para o produto do cadastro que nao carregou no mes. */
export function volumeLabel(product: Pick<PriceVolumeProduct, "weightKg" | "loads">): string {
  return product.loads === 0 ? "-" : formatTons(product.weightKg);
}

// ---------------------------------------------------------------------------
// Leitura da nuvem
// ---------------------------------------------------------------------------

const PAGE = 1000;

/** Le todas as paginas (o PostgREST devolve no maximo 1000 por vez). */
async function allRows<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await query(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * O cadastro da empresa que o relatorio usa. Cliente e condicao vem SEM filtro de excluido ou
 * inativo: o cadastro inativo ainda e o gemeo de um vivo, e a condicao desativada ainda e o
 * prazo gravado no cliente.
 */
export async function loadPriceVolumeCadastro(companyId: string): Promise<PriceVolumeCadastro> {
  const [customers, paymentTerms, specialPrices, products, defaultPrices] = await Promise.all([
    allRows<PriceVolumeCustomerRow>((from, to) =>
      supabase
        .from("customers")
        .select(
          "id, trade_name, legal_name, document, omie_customer_id, deleted_at, is_active, default_payment_term_id"
        )
        .eq("company_id", companyId)
        .order("trade_name")
        .order("id")
        .range(from, to)
    ),
    allRows<Pick<PaymentTerm, "id" | "name">>((from, to) =>
      supabase
        .from("payment_terms")
        .select("id, name")
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
    ),
    allRows<PriceVolumeCadastro["specialPrices"][number]>((from, to) =>
      supabase
        .from("customer_special_prices")
        .select("customer_id, product_id, unit_price_cents, updated_at")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("id")
        .range(from, to)
    ),
    allRows<PriceVolumeCadastro["products"][number]>((from, to) =>
      supabase
        .from("products")
        .select("id, description, code, unit_price_cents")
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
    ),
    allRows<PriceVolumeCadastro["defaultPrices"][number]>((from, to) =>
      supabase
        .from("product_default_prices")
        .select("product_id, unit_price_cents")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("id")
        .range(from, to)
    )
  ]);
  return { customers, paymentTerms, specialPrices, products, defaultPrices };
}

// ---------------------------------------------------------------------------
// Exportar (PDF e Excel)
// ---------------------------------------------------------------------------

export interface PriceVolumeExportInput {
  report: PriceVolumeReport;
  /** "Setembro de 2026". */
  monthLabel: string;
  /** "Todas as unidades" ou o nome da unidade. */
  unitName: string;
  generatedAt?: Date;
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

/** "2026-09" -> "Setembro de 2026". */
export function monthTitle(month: string): string {
  const [year, monthNumber] = month.split("-");
  const name = MONTH_NAMES[Number(monthNumber) - 1];
  return name ? `${name} de ${year}` : month;
}

/** Nome do arquivo: `precos-e-volume-por-cliente-2026-09`. */
export function priceVolumeFileBase(month: string): string {
  return `precos-e-volume-por-cliente-${month}`;
}

const NOTE =
  "Preço por tonelada do cadastro: o especial do cliente ou, sem ele, o padrão do produto. " +
  "Volume = peso líquido das pesagens concluídas no mês, pela data de fechamento. " +
  'Prazo "pelas cargas": o cliente não tem condição padrão no cadastro; vale a mais usada nas cargas do mês.';

function kpis(report: PriceVolumeReport): string {
  return kpiCards([
    ["Clientes", report.totals.customers.toLocaleString("pt-BR")],
    ["Cargas", report.totals.loads.toLocaleString("pt-BR")],
    ["Volume carregado", formatTons(report.totals.weightKg)],
    ["Materiais", report.materials.length.toLocaleString("pt-BR")]
  ]);
}

/** A tabela do PDF: o cliente e o prazo uma vez so, com os produtos dele ao lado. */
function customerTable(report: PriceVolumeReport): string {
  const head = [
    "Cliente",
    "Prazo de pagamento",
    "Produto",
    "Preço por t",
    "Origem",
    "Volume no mês"
  ]
    .map((header, index) => `<th${index >= 3 && index !== 4 ? ' class="num"' : ""}>${header}</th>`)
    .join("");
  if (report.customers.length === 0) {
    return `<table class="detail"><thead><tr>${head}</tr></thead><tbody><tr><td class="empty" colspan="6">Nenhum cliente no mês.</td></tr></tbody></table>`;
  }
  const body = report.customers
    .map((customer) => {
      // Sempre ha produto: o cliente entra pela carga ou pelo preco especial.
      const products = customer.products;
      const span = Math.max(products.length, 1);
      const document = customer.document ? formatDocument(customer.document) : "";
      const customerCell = `<td rowspan="${span}"><strong>${escapeHtml(customer.name)}</strong>${
        document ? `<br /><span class="muted">${escapeHtml(document)}</span>` : ""
      }${
        customer.loads
          ? `<br /><span class="muted">Total: ${escapeHtml(formatTons(customer.weightKg))} em ${customer.loads.toLocaleString("pt-BR")} ${customer.loads === 1 ? "carga" : "cargas"}</span>`
          : ""
      }</td><td rowspan="${span}">${escapeHtml(paymentTermLabel(customer))}</td>`;
      return products
        .map((product, index) => {
          const cells = `<td>${escapeHtml(product.productName)}</td><td class="num">${escapeHtml(
            priceLabel(product)
          )}</td><td>${escapeHtml(PRICE_SOURCE_LABEL[product.priceSource])}</td><td class="num">${escapeHtml(
            volumeLabel(product)
          )}</td>`;
          return index === 0
            ? `<tr class="group-start">${customerCell}${cells}</tr>`
            : `<tr>${cells}</tr>`;
        })
        .join("");
    })
    .join("");
  return `<table class="detail grouped"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function materialRows(report: PriceVolumeReport): string[][] {
  return report.materials.map((material) => [
    material.productName,
    material.customers.toLocaleString("pt-BR"),
    material.loads.toLocaleString("pt-BR"),
    formatTons(material.weightKg)
  ]);
}

/** O PDF A4 do botao Exportar PDF. */
export function priceVolumeReportHtml(input: PriceVolumeExportInput): string {
  const { report } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const style = `${documentStyle("portrait")}
section{break-inside:auto}
table.grouped tbody tr:nth-child(even){background:transparent}
table.grouped tr.group-start td{border-top:2px solid #cbd5e1}
table.grouped td{vertical-align:top}
.muted{color:var(--muted)}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Preços e volume por cliente</title><style>${style}</style></head><body>
<div class="header"><div><h1>Preços e volume por cliente</h1><p class="period">${escapeHtml(
    `${input.monthLabel} · ${input.unitName}`
  )}</p></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
${kpis(report)}
${section("Clientes", customerTable(report))}
${section(
  "Volume por material no mês",
  table(
    ["Material", "Clientes", "Cargas", "Volume"],
    materialRows(report),
    [
      "Total",
      report.totals.customers.toLocaleString("pt-BR"),
      report.totals.loads.toLocaleString("pt-BR"),
      formatTons(report.totals.weightKg)
    ],
    "Nenhuma carga no mês."
  )
)}
<p class="note">${escapeHtml(NOTE)}</p>
</body></html>`;
}

/**
 * A planilha do botao Exportar Excel: uma linha por cliente e produto, com o cliente e o prazo
 * repetidos em toda linha — e o que deixa filtrar e somar por cliente no Excel.
 */
export function priceVolumeSpreadsheetHtml(input: PriceVolumeExportInput): string {
  const { report } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const rows: string[][] = [];
  for (const customer of report.customers) {
    for (const product of customer.products) {
      rows.push([
        customer.name,
        customer.document ? formatDocument(customer.document) : "",
        customer.paymentTerm ?? "Não informado",
        customer.paymentTermSource === "loads"
          ? "Cargas do mês"
          : customer.paymentTermSource === "cadastro"
            ? "Cadastro"
            : "",
        product.productName,
        priceLabel(product),
        PRICE_SOURCE_LABEL[product.priceSource],
        volumeLabel(product),
        product.loads.toLocaleString("pt-BR")
      ]);
    }
  }
  const blocks = [
    sheetTable(
      "Preços e volume por cliente",
      [
        "Cliente",
        "Documento",
        "Prazo de pagamento",
        "Origem do prazo",
        "Produto",
        "Preço por t",
        "Origem do preço",
        "Volume no mês",
        "Cargas"
      ],
      rows,
      rows.length
        ? [
            "TOTAL",
            `${report.totals.customers.toLocaleString("pt-BR")} clientes`,
            "",
            "",
            "",
            "",
            "",
            formatTons(report.totals.weightKg),
            report.totals.loads.toLocaleString("pt-BR")
          ]
        : null
    ),
    sheetTable(
      "Volume por material no mês",
      ["Material", "Clientes", "Cargas", "Volume"],
      materialRows(report),
      report.materials.length
        ? [
            "TOTAL",
            report.totals.customers.toLocaleString("pt-BR"),
            report.totals.loads.toLocaleString("pt-BR"),
            formatTons(report.totals.weightKg)
          ]
        : null
    )
  ];
  return `<!doctype html><html ${SPREADSHEET_HTML_ATTRS}><head><meta charset="utf-8" /><title>Preços e volume por cliente</title><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>Preços e volume por cliente</h1><p class="sub">${escapeHtml(
    `${input.monthLabel} · ${input.unitName} · gerado em ${generatedAt.toLocaleString("pt-BR")}`
  )}</p>
${blocks.join("\n")}
<p class="note">${escapeHtml(NOTE)}</p>
</body></html>`;
}
