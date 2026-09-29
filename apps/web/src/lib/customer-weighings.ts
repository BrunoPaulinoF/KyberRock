/**
 * Relatorios: o que abre ao clicar num cliente.
 *   - "Pesagens do cliente": todas as pesagens concluidas dele no periodo, separadas por produto
 *     (com o proprio filtro de datas, independente do periodo do relatorio);
 *   - "Info" (o olho): o cartao com o cadastro do cliente e o resumo do periodo — e ali que
 *     ficou o preco medio que saiu da tabela dinamica.
 *
 * Mesma regra dos relatorios de dinheiro (CLAUDE.md, "Data da pesagem nos relatorios"): o periodo
 * e pela data em que a pesagem FECHOU, com a criacao de reserva na operacao antiga.
 */

import { defaultPriceByProduct } from "./customer-cadastro";
import type { CustomerSpecialPrice, Product, ProductDefaultPrice } from "./queries";
import { saleInstant } from "./reports";
import { supabase, type Tables } from "./supabase";

/** Quem e o cliente: o id do cadastro, ou so o nome gravado na pesagem (venda sem cadastro). */
export interface CustomerRef {
  id: string | null;
  name: string;
}

export type CustomerWeighingOperation = Pick<
  Tables<"weighing_operations">,
  | "id"
  | "operation_code"
  | "unit_id"
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "plate"
  | "driver_name"
  | "net_weight_kg"
  | "unit_price_cents"
  | "product_total_cents"
  | "freight_total_cents"
  | "total_cents"
  | "operation_type"
  | "omie_invoice_number"
  | "closed_at"
  | "created_at"
>;

const WEIGHING_COLUMNS =
  "id, operation_code, unit_id, customer_id, customer_name, product_id, product_description, " +
  "plate, driver_name, net_weight_kg, unit_price_cents, product_total_cents, " +
  "freight_total_cents, total_cents, operation_type, omie_invoice_number, closed_at, created_at";

const CLOSED_STATUSES = ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"];

export interface WeighingTotals {
  operations: number;
  netWeightKg: number;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  /** Preco medio do PRODUTO por tonelada (sem frete); 0 sem peso, como na tabela dinamica. */
  avgPriceCentsPerTon: number;
}

export interface ProductWeighings {
  key: string;
  productDescription: string;
  /** Mais recente primeiro. */
  weighings: CustomerWeighingOperation[];
  totals: WeighingTotals;
}

function emptyTotals(): WeighingTotals {
  return {
    operations: 0,
    netWeightKg: 0,
    productTotalCents: 0,
    freightTotalCents: 0,
    totalCents: 0,
    avgPriceCentsPerTon: 0
  };
}

/** Os valores que a soma usa — serve tambem para as pesagens que o relatorio ja carregou. */
export type WeighingAmounts = Pick<
  Tables<"weighing_operations">,
  "net_weight_kg" | "product_total_cents" | "freight_total_cents" | "total_cents"
>;

function add(totals: WeighingTotals, op: WeighingAmounts): void {
  const product = op.product_total_cents ?? 0;
  const freight = op.freight_total_cents ?? 0;
  totals.operations += 1;
  totals.netWeightKg += op.net_weight_kg ?? 0;
  totals.productTotalCents += product;
  totals.freightTotalCents += freight;
  totals.totalCents += op.total_cents ?? product + freight;
}

function withAverage(totals: WeighingTotals): WeighingTotals {
  return {
    ...totals,
    avgPriceCentsPerTon:
      totals.netWeightKg > 0
        ? Math.round(totals.productTotalCents / (totals.netWeightKg / 1000))
        : 0
  };
}

/** Soma de um conjunto de pesagens (o resumo do cartao Info e o topo da lista). */
export function sumWeighings(ops: readonly WeighingAmounts[]): WeighingTotals {
  const totals = emptyTotals();
  for (const op of ops) add(totals, op);
  return withAverage(totals);
}

/**
 * Separa as pesagens por produto — pelo id do cadastro, ou pelo nome quando a pesagem nao tem
 * id (mesma regra da tabela dinamica). Produto que mais vendeu primeiro.
 */
export function groupWeighingsByProduct(
  ops: readonly CustomerWeighingOperation[]
): ProductWeighings[] {
  const groups = new Map<string, ProductWeighings>();
  for (const op of ops) {
    const key = op.product_id ?? `nome:${op.product_description ?? ""}`;
    const group = groups.get(key) ?? {
      key,
      productDescription: op.product_description || "Sem produto",
      weighings: [],
      totals: emptyTotals()
    };
    group.weighings.push(op);
    add(group.totals, op);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      weighings: [...group.weighings].sort((a, b) => saleInstant(b).localeCompare(saleInstant(a))),
      totals: withAverage(group.totals)
    }))
    .sort(
      (a, b) =>
        b.totals.totalCents - a.totals.totalCents ||
        a.productDescription.localeCompare(b.productDescription, "pt-BR")
    );
}

/** As pesagens concluidas do cliente no periodo `[startIso, endIso)` (fechamento). */
export async function loadCustomerWeighings(
  companyId: string,
  customer: CustomerRef,
  startIso: string,
  endIso: string
): Promise<CustomerWeighingOperation[]> {
  const rows: CustomerWeighingOperation[] = [];
  const PAGE = 1000;
  for (let page = 0; page < 20; page++) {
    let query = supabase
      .from("weighing_operations")
      .select(WEIGHING_COLUMNS)
      .eq("company_id", companyId)
      .in("status", CLOSED_STATUSES)
      .or(
        [
          `and(closed_at.gte."${startIso}",closed_at.lt."${endIso}")`,
          `and(closed_at.is.null,created_at.gte."${startIso}",created_at.lt."${endIso}")`
        ].join(",")
      );
    query = customer.id
      ? query.eq("customer_id", customer.id)
      : query.is("customer_id", null).eq("customer_name", customer.name);
    const { data, error } = await query
      .order("closed_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as CustomerWeighingOperation[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Cartao Info
// ---------------------------------------------------------------------------

export type CustomerRow = Tables<"customers">;

export interface CustomerInfo {
  customer: CustomerRow | null;
  paymentMethodName: string | null;
  paymentTermName: string | null;
  carrierName: string | null;
  /** Os precos especiais do cliente, um por produto (ver `specialPriceLines`). */
  specialPrices: SpecialPriceLine[];
}

const NO_CUSTOMER: CustomerInfo = {
  customer: null,
  paymentMethodName: null,
  paymentTermName: null,
  carrierName: null,
  specialPrices: []
};

/** Um preco especial do cliente, como o cartao Info mostra. */
export interface SpecialPriceLine {
  productId: string;
  productDescription: string;
  productCode: string | null;
  specialCents: number;
  /** O preco padrao do produto hoje (tabela padrao ou OMIE); null quando ele nao tem. */
  defaultCents: number | null;
}

/**
 * Os precos especiais do cliente, um por produto, em ordem de nome. O preco padrao vai junto
 * para a comparacao ("65,00 contra 72,00 do padrao"), pela mesma regra da ficha do cliente
 * (`defaultPriceByProduct`). Duas linhas do mesmo produto (copia de outra balanca) viram uma: a
 * atualizada por ultimo, que e a que a balanca principal manteria.
 */
export function specialPriceLines(
  specials: readonly Pick<CustomerSpecialPrice, "product_id" | "unit_price_cents" | "updated_at">[],
  products: readonly Pick<Product, "id" | "description" | "code" | "unit_price_cents">[],
  defaults: readonly Pick<ProductDefaultPrice, "product_id" | "unit_price_cents">[]
): SpecialPriceLine[] {
  const latest = new Map<string, (typeof specials)[number]>();
  for (const special of specials) {
    const current = latest.get(special.product_id);
    if (!current || special.updated_at > current.updated_at) {
      latest.set(special.product_id, special);
    }
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  const defaultByProduct = defaultPriceByProduct(products, defaults);
  return [...latest.values()]
    .map((special) => {
      const product = productById.get(special.product_id);
      return {
        productId: special.product_id,
        productDescription: product?.description || "Produto fora do cadastro",
        productCode: product?.code || null,
        specialCents: special.unit_price_cents,
        defaultCents: defaultByProduct.get(special.product_id) ?? null
      };
    })
    .sort((a, b) => a.productDescription.localeCompare(b.productDescription, "pt-BR"));
}

/** Os precos especiais vivos do cliente, com o nome e o preco padrao de cada produto. */
async function loadSpecialPrices(
  companyId: string,
  customerId: string
): Promise<SpecialPriceLine[]> {
  const { data: specials, error } = await supabase
    .from("customer_special_prices")
    .select("product_id, unit_price_cents, updated_at")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const productIds = [...new Set((specials ?? []).map((special) => special.product_id))];
  if (productIds.length === 0) return [];
  const [products, defaults] = await Promise.all([
    supabase
      .from("products")
      .select("id, description, code, unit_price_cents")
      .eq("company_id", companyId)
      .in("id", productIds),
    supabase
      .from("product_default_prices")
      .select("product_id, unit_price_cents")
      .eq("company_id", companyId)
      .in("product_id", productIds)
      .is("deleted_at", null)
      .eq("is_active", true)
  ]);
  if (products.error) throw new Error(products.error.message);
  if (defaults.error) throw new Error(defaults.error.message);
  return specialPriceLines(specials ?? [], products.data ?? [], defaults.data ?? []);
}

/** O cadastro do cliente, os nomes do que ele so guarda como id e os precos especiais. */
export async function loadCustomerInfo(
  companyId: string,
  customerId: string | null
): Promise<CustomerInfo> {
  if (!customerId) return NO_CUSTOMER;
  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!customer) return NO_CUSTOMER;
  const empty = Promise.resolve({ data: null });
  const [method, term, carrier, specialPrices] = await Promise.all([
    customer.default_payment_method_id
      ? supabase
          .from("payment_methods")
          .select("name")
          .eq("id", customer.default_payment_method_id)
          .maybeSingle()
      : empty,
    customer.default_payment_term_id
      ? supabase
          .from("payment_terms")
          .select("name")
          .eq("id", customer.default_payment_term_id)
          .maybeSingle()
      : empty,
    customer.default_carrier_id
      ? supabase.from("carriers").select("name").eq("id", customer.default_carrier_id).maybeSingle()
      : empty,
    loadSpecialPrices(companyId, customerId)
  ]);
  return {
    customer,
    paymentMethodName: method.data?.name ?? null,
    paymentTermName: term.data?.name ?? null,
    carrierName: carrier.data?.name ?? null,
    specialPrices
  };
}

/** "Rua X, 120 - Sala 2 - Centro". */
export function customerAddress(
  customer: Pick<
    CustomerRow,
    "address_street" | "address_number" | "address_complement" | "neighborhood"
  >
): string {
  const street = [customer.address_street, customer.address_number].filter(Boolean).join(", ");
  return [street, customer.address_complement, customer.neighborhood].filter(Boolean).join(" - ");
}

/** "Ibiuna/SP - CEP 18150-000". */
export function customerCityLine(
  customer: Pick<CustomerRow, "city" | "state" | "zipcode">
): string {
  const city = [customer.city, customer.state].filter(Boolean).join("/");
  const digits = (customer.zipcode ?? "").replace(/\D/g, "");
  const zip = digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : customer.zipcode;
  return [city, zip ? `CEP ${zip}` : ""].filter(Boolean).join(" - ");
}

/** Como o cliente compra a prazo: "Fiado", "Pre-pago" ou "Nao usa". */
export function creditLabel(
  customer: Pick<CustomerRow, "credit_account_enabled" | "credit_mode">
): string {
  if (!customer.credit_account_enabled) return "Nao usa";
  return customer.credit_mode === "prepaid" ? "Pre-pago" : "Fiado";
}
