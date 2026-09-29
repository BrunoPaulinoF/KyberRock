/**
 * Contas da ficha do cliente no site (Precos especiais, Frete, Transporte e Entrega futura) —
 * as mesmas da ficha do cliente na balanca (`CustomersView` do desktop). Puro e testado: a tela
 * so desenha.
 */

import { getFreightModalityInfo } from "./desktop/freight";
import type { Product, ProductDefaultPrice } from "./queries";

/**
 * O preco padrao de cada produto, pela regra do `PricingService` da balanca: o da tabela de preco
 * padrao ou, sem ela, o valor unitario do OMIE gravado no produto. Produto sem preco (ou com
 * zero) fica fora do mapa.
 */
export function defaultPriceByProduct(
  products: readonly Pick<Product, "id" | "unit_price_cents">[],
  defaults: readonly Pick<ProductDefaultPrice, "product_id" | "unit_price_cents">[]
): Map<string, number> {
  const table = new Map(defaults.map((price) => [price.product_id, price.unit_price_cents]));
  const map = new Map<string, number>();
  for (const product of products) {
    const price = table.get(product.id) ?? product.unit_price_cents;
    if (price != null && price > 0) map.set(product.id, price);
  }
  return map;
}

/** Uma linha do quadro "Frete do cliente" (o `toCustomerFreightEntries` do desktop). */
export interface CustomerFreightEntry {
  key: string;
  productId: string | null;
  /** "Todos os produtos" ou o nome do produto. */
  scopeLabel: string;
  /** `null` e a regra unica antiga, que vale para qualquer tipo de frete. */
  modality: string | null;
  modalityLabel: string;
  baseValueCents: number;
  /** `manual` = combinado no cadastro; `last_used` = memoria da ultima venda de uma balanca. */
  source: "manual" | "last_used";
}

export interface FreightRuleRowLike {
  id: string;
  product_id: string | null;
  rule_json: unknown;
  is_active: boolean;
  deleted_at: string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Achata as regras de frete do cliente numa linha por valor: a regra unica antiga (quando tem
 * valor) e cada tipo de frete configurado ou memorizado. O "todos os produtos" vem primeiro;
 * depois, por produto, na ordem do nome.
 */
export function customerFreightEntries(
  rules: readonly FreightRuleRowLike[],
  productNames: ReadonlyMap<string, string>
): CustomerFreightEntry[] {
  const live = rules
    .filter((rule) => rule.is_active && !rule.deleted_at)
    .map((rule) => ({
      rule,
      scopeLabel: rule.product_id
        ? (productNames.get(rule.product_id) ?? "Produto")
        : "Todos os produtos"
    }))
    .sort((a, b) => {
      if (!a.rule.product_id !== !b.rule.product_id) return a.rule.product_id ? 1 : -1;
      return a.scopeLabel.localeCompare(b.scopeLabel, "pt-BR");
    });

  const entries: CustomerFreightEntry[] = [];
  for (const { rule, scopeLabel } of live) {
    const payload = asObject(rule.rule_json) ?? {};
    const legacy = finiteNumber(payload.baseValueCents) ?? 0;
    if (legacy > 0) {
      entries.push({
        key: `${rule.id}:any`,
        productId: rule.product_id,
        scopeLabel,
        modality: null,
        modalityLabel: "Qualquer tipo",
        baseValueCents: legacy,
        source: "manual"
      });
    }
    const modalities = asObject(payload.modalities) ?? {};
    for (const [modality, raw] of Object.entries(modalities)) {
      const value = asObject(raw);
      const base = finiteNumber(value?.baseValueCents);
      if (!value || base === null) continue;
      entries.push({
        key: `${rule.id}:${modality}`,
        productId: rule.product_id,
        scopeLabel,
        modality,
        modalityLabel: getFreightModalityInfo(modality).label,
        baseValueCents: base,
        source: value.source === "manual" ? "manual" : "last_used"
      });
    }
  }
  return entries;
}

/** Numero da NF-e so com digitos (a balanca grava assim). */
export function normalizeNfeNumber(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Total da nota em kg, digitado em quilos ("30000", "30.000", "30000,5"). Vazio, zero ou lixo e
 * `null`: nota sem controle de saldo — a mesma regra da balanca.
 */
export function parseTotalWeightKg(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/\./g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Um item da NF-e de entrega futura, como a `web-api` devolve (`lookup_future_billing_invoice`). */
export interface FutureInvoiceItem {
  /** O produto do cadastro que casou com o item (codigo do OMIE ou do produto); null = nenhum. */
  productId: string | null;
  productDescription: string | null;
  /** O nome do produto como esta na nota. */
  invoiceDescription: string;
  quantity: number;
  unit: string | null;
  /** O volume em kg; null quando a unidade nao e de peso (m3, unidade...). */
  totalWeightKg: number | null;
}

export interface FutureInvoice {
  invoiceNumber: string;
  series: string | null;
  issueDate: string | null;
  customerName: string | null;
  /** A nota foi emitida para outro cliente no OMIE. */
  otherCustomer: boolean;
  items: FutureInvoiceItem[];
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A resposta da `web-api`, conferida campo a campo (a tela nao confia no formato). */
export function parseFutureInvoices(result: Record<string, unknown>): FutureInvoice[] {
  const invoices = Array.isArray(result.invoices) ? result.invoices : [];
  return invoices.flatMap((raw): FutureInvoice[] => {
    if (!raw || typeof raw !== "object") return [];
    const invoice = raw as Record<string, unknown>;
    const invoiceNumber = textOrNull(invoice.invoiceNumber);
    if (!invoiceNumber) return [];
    const items = (Array.isArray(invoice.items) ? invoice.items : []).flatMap(
      (rawItem): FutureInvoiceItem[] => {
        if (!rawItem || typeof rawItem !== "object") return [];
        const item = rawItem as Record<string, unknown>;
        const quantity = numberOrNull(item.quantity);
        if (quantity === null) return [];
        return [
          {
            productId: textOrNull(item.productId),
            productDescription: textOrNull(item.productDescription),
            invoiceDescription: textOrNull(item.invoiceDescription) ?? "Produto da nota",
            quantity,
            unit: textOrNull(item.unit),
            totalWeightKg: numberOrNull(item.totalWeightKg)
          }
        ];
      }
    );
    return [
      {
        invoiceNumber,
        series: textOrNull(invoice.series),
        issueDate: textOrNull(invoice.issueDate),
        customerName: textOrNull(invoice.customerName),
        otherCustomer: invoice.otherCustomer === true,
        items
      }
    ];
  });
}

/** O que o formulario recebe ao usar um item da nota. */
export interface FutureInvoiceFill {
  /** `null` = o produto da nota nao casou com nenhum do cadastro: a pessoa escolhe. */
  productId: string | null;
  /** O total em kg ja no formato do campo ("30000"); "" quando nao da para converter. */
  totalKg: string;
  /** O que avisar na tela (produto sem cadastro, unidade sem conversao). */
  notes: string[];
}

/** "30 TON", "12,5 M3". */
export function quantityLabel(item: Pick<FutureInvoiceItem, "quantity" | "unit">): string {
  const quantity = item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return item.unit ? `${quantity} ${item.unit}` : quantity;
}

/**
 * Preenche produto e total do formulario com um item da nota. O total so vem quando a unidade
 * da nota e de peso: m3 sem a densidade viraria um saldo inventado, e a balanca baixaria a nota
 * errado a cada pesagem — ai o campo fica para a pessoa, com o aviso.
 */
export function futureInvoiceFill(item: FutureInvoiceItem): FutureInvoiceFill {
  const notes: string[] = [];
  if (!item.productId) {
    notes.push(
      `O produto da nota (${item.invoiceDescription}) nao casou com nenhum do cadastro: escolha o produto.`
    );
  }
  if (item.totalWeightKg === null) {
    notes.push(
      `A nota esta em ${item.unit ?? "outra unidade"} (${quantityLabel(item)}): informe o total em quilos.`
    );
  }
  return {
    productId: item.productId,
    totalKg:
      item.totalWeightKg === null ? "" : String(Math.round(item.totalWeightKg * 1000) / 1000),
    notes
  };
}
