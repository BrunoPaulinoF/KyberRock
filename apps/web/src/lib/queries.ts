/**
 * Leituras do site: direto do Postgres com o login do usuario (RLS abre so a propria
 * empresa — migracao `202609220003`). Toda funcao filtra por `company_id` mesmo assim, para
 * a intencao ficar explicita no codigo.
 */

import { closedPeriodFilter, closedSearchFilter } from "./closed-operations";
import { customerSearchFilter } from "./customer-search";
import { OPEN_STATUS, type OperationRequest } from "./operation";
import { supabase, type Tables } from "./supabase";
import type { Page } from "./use-paged";

export type Customer = Tables<"customers">;
export type Product = Tables<"products">;
export type Carrier = Tables<"carriers">;
export type Driver = Tables<"drivers">;
export type Vehicle = Tables<"vehicles">;
export type PaymentMethod = Tables<"payment_methods">;
export type PaymentTerm = Tables<"payment_terms">;
export type Operation = Tables<"weighing_operations">;
export type BillingRequest = Tables<"billing_requests">;
export type ProductDefaultPrice = Tables<"product_default_prices">;
export type CustomerSpecialPrice = Tables<"customer_special_prices">;
export type Account = Tables<"accounts">;
export type LoadingRequest = Pick<
  Tables<"loading_requests">,
  "operation_id" | "loader_completed_at" | "status"
>;

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

const PAGE = 1000;

/** Le todas as paginas de uma consulta (o PostgREST devolve no maximo 1000 por vez). */
async function all<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await query(page * PAGE, page * PAGE + PAGE - 1);
    fail(error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Colunas da lista de clientes e do seletor — o cadastro inteiro so no formulario. */
export interface CustomerPageFilter {
  search: string;
  includeInactive: boolean;
}

export const q = {
  /** Uma pagina da lista de clientes, ja filtrada no banco, e o total do filtro. */
  customersPage: async (
    companyId: string,
    filter: CustomerPageFilter,
    from: number,
    to: number
  ): Promise<Page<Customer>> => {
    let query = supabase
      .from("customers")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null);
    if (!filter.includeInactive) query = query.eq("is_active", true);
    const search = customerSearchFilter(filter.search);
    if (search) query = query.or(search);
    const { data, error, count } = await query.order("trade_name").order("id").range(from, to);
    fail(error);
    return { rows: data ?? [], total: count ?? data?.length ?? 0 };
  },
  /** Quantos clientes ativos a empresa tem (o contador da secao). */
  activeCustomerCount: async (companyId: string): Promise<number> => {
    const { count, error } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .eq("is_active", true);
    fail(error);
    return count ?? 0;
  },
  /** Busca do seletor de cliente: poucas linhas, so as colunas que ele mostra. */
  searchCustomers: async (
    companyId: string,
    search: string,
    limit = 30
  ): Promise<Array<Pick<Customer, "id" | "trade_name" | "legal_name" | "document">>> => {
    let query = supabase
      .from("customers")
      .select("id, trade_name, legal_name, document")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .eq("is_active", true);
    const filter = customerSearchFilter(search);
    if (filter) query = query.or(filter);
    const { data, error } = await query.order("trade_name").limit(limit);
    fail(error);
    return data ?? [];
  },
  customers: (companyId: string) =>
    all<Customer>((from, to) =>
      supabase
        .from("customers")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("trade_name")
        .range(from, to)
    ),
  products: (companyId: string) =>
    all<Product>((from, to) =>
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("description")
        .range(from, to)
    ),
  carriers: (companyId: string) =>
    all<Carrier>((from, to) =>
      supabase
        .from("carriers")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
    ),
  drivers: (companyId: string) =>
    all<Driver>((from, to) =>
      supabase
        .from("drivers")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
    ),
  vehicles: (companyId: string) =>
    all<Vehicle>((from, to) =>
      supabase
        .from("vehicles")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("plate")
        .range(from, to)
    ),
  paymentMethods: (companyId: string) =>
    all<PaymentMethod>((from, to) =>
      supabase
        .from("payment_methods")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("sort_order")
        .range(from, to)
    ),
  paymentTerms: (companyId: string) =>
    all<PaymentTerm>((from, to) =>
      supabase
        .from("payment_terms")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name")
        .range(from, to)
    ),
  productDefaultPrices: (companyId: string) =>
    all<ProductDefaultPrice>((from, to) =>
      supabase
        .from("product_default_prices")
        .select("*")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .range(from, to)
    ),
  customerSpecialPrices: (companyId: string, customerId: string) =>
    all<CustomerSpecialPrice>((from, to) =>
      supabase
        .from("customer_special_prices")
        .select("*")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .range(from, to)
    ),
  /**
   * Pesagens concluidas do periodo, pela data de FECHAMENTO (`closed_at`) — a data da venda
   * e a que o OMIE usa. Pesagem antiga sem `closed_at` entra pela criacao.
   */
  closedOperations: (companyId: string, startIso: string, endIso: string) =>
    all<Operation>((from, to) =>
      supabase
        .from("weighing_operations")
        .select("*")
        .eq("company_id", companyId)
        .in("status", ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"])
        .or(
          [
            `and(closed_at.gte."${startIso}",closed_at.lt."${endIso}")`,
            `and(closed_at.is.null,created_at.gte."${startIso}",created_at.lt."${endIso}")`
          ].join(",")
        )
        .order("closed_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  /**
   * A aba "Operacoes concluidas": as pesagens concluidas da unidade, mais nova primeiro, uma
   * pagina por vez e ja filtradas no banco. Periodo, produto e busca sao opcionais — sem nenhum,
   * vem o historico inteiro, 50 por vez (`lib/closed-operations.ts`).
   */
  closedOperationsPage: async (
    companyId: string,
    unitId: string,
    filter: {
      startIso: string | null;
      endIso: string | null;
      product: string | null;
      search: string;
    },
    from: number,
    to: number
  ): Promise<Page<Operation>> => {
    let query = supabase
      .from("weighing_operations")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .in("status", ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"]);
    const period = closedPeriodFilter(filter);
    if (period) query = query.or(period);
    if (filter.product) query = query.eq("product_description", filter.product);
    const search = closedSearchFilter(filter.search);
    if (search) query = query.or(search);
    const { data, error, count } = await query
      .order("closed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);
    fail(error);
    return { rows: data ?? [], total: count ?? data?.length ?? 0 };
  },
  /** Vendas em carteira: forma de pagamento `is_wallet`. `open` = ainda sem fechamento. */
  walletOperations: (companyId: string, walletMethodIds: string[], status: "open" | "settled") =>
    all<Operation>((from, to) => {
      let query = supabase
        .from("weighing_operations")
        .select("*")
        .eq("company_id", companyId)
        .in("payment_method_id", walletMethodIds)
        .neq("status", "cancelled")
        .in("status", ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"]);
      query =
        status === "open"
          ? query.is("wallet_settled_at", null)
          : query.not("wallet_settled_at", "is", null);
      return query.order("created_at", { ascending: false }).range(from, to);
    }),
  /** Quantas pesagens estao abertas na unidade (o numero ao lado de "Operacoes" no menu). */
  openOperationCount: async (companyId: string, unitId: string): Promise<number> => {
    const { count, error } = await supabase
      .from("weighing_operations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .eq("status", OPEN_STATUS);
    fail(error);
    return count ?? 0;
  },
  /** Caminhoes no patio da unidade: pesagem com entrada e sem saida. */
  openOperations: (companyId: string, unitId: string) =>
    all<Operation>((from, to) =>
      supabase
        .from("weighing_operations")
        .select("*")
        .eq("company_id", companyId)
        .eq("unit_id", unitId)
        .eq("status", OPEN_STATUS)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  /** Pesagens canceladas da unidade desde `sinceIso` (a aba Canceladas). */
  cancelledOperations: (companyId: string, unitId: string, sinceIso: string) =>
    all<Operation>((from, to) =>
      supabase
        .from("weighing_operations")
        .select("*")
        .eq("company_id", companyId)
        .eq("unit_id", unitId)
        .eq("status", "cancelled")
        .gte("updated_at", sinceIso)
        .order("updated_at", { ascending: false })
        .range(from, to)
    ),
  /** A luz do carregador na fila: carga concluida ou ainda aguardando. */
  loadingRequests: async (companyId: string, operationIds: string[]): Promise<LoadingRequest[]> => {
    if (operationIds.length === 0) return [];
    const { data, error } = await supabase
      .from("loading_requests")
      .select("operation_id, loader_completed_at, status")
      .eq("company_id", companyId)
      .in("operation_id", operationIds);
    fail(error);
    return data ?? [];
  },
  /** As ultimas pesagens do cliente: a Nova entrada repete o arranjo da ultima vez. */
  lastCustomerOperations: async (companyId: string, customerId: string): Promise<Operation[]> => {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select("*")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(5);
    fail(error);
    return data ?? [];
  },
  customerFreightRules: (companyId: string, customerId: string) =>
    all<Tables<"customer_freight_rules">>((from, to) =>
      supabase
        .from("customer_freight_rules")
        .select("*")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .range(from, to)
    ),
  /**
   * Transportadoras vinculadas ao cliente (a aba Transporte da ficha na balanca). Sem filtro de
   * empresa de proposito: vinculo antigo tem `company_id` nulo, e a RLS da tabela ja recorta pela
   * empresa do CLIENTE.
   */
  customerCarrierLinks: async (customerId: string) => {
    const { data, error } = await supabase
      .from("customer_carriers")
      .select("id, carrier_id")
      .eq("customer_id", customerId)
      .eq("is_active", true);
    fail(error);
    return data ?? [];
  },
  /** Placas vinculadas ao cliente: a nova entrada abre o campo Placa ja com elas. */
  customerVehicleLinks: async (companyId: string, customerId: string) => {
    const { data, error } = await supabase
      .from("customer_vehicles")
      .select("id, vehicle_id")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .eq("is_active", true);
    fail(error);
    return data ?? [];
  },
  /** Notas de venda para entrega futura do cliente, mais antiga primeiro (a ordem de consumo). */
  customerFutureBillingInvoices: (companyId: string, customerId: string) =>
    all<Tables<"customer_future_billing_invoices">>((from, to) =>
      supabase
        .from("customer_future_billing_invoices")
        .select("*")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  accounts: (companyId: string) =>
    all<Account>((from, to) =>
      supabase
        .from("accounts")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order")
        .range(from, to)
    ),
  /** Pedidos de pesagem feitos pelo site desde `sinceIso`, mais novo primeiro. */
  operationRequests: async (companyId: string, sinceIso: string): Promise<OperationRequest[]> => {
    const { data, error } = await supabase
      .from("operation_requests")
      .select(
        "id, kind, operation_id, status, requested_by_name, requested_at, processed_at, result_message, result, print_status, print_message"
      )
      .eq("company_id", companyId)
      .gte("requested_at", sinceIso)
      .order("requested_at", { ascending: false })
      .limit(50);
    fail(error);
    // `kind`/`status`/`result` sao texto e JSON no banco; os valores possiveis estao nos CHECKs
    // da migracao `202609250001`.
    return (data ?? []) as unknown as OperationRequest[];
  },
  billingRequests: (companyId: string, operationIds: string[]) =>
    operationIds.length === 0
      ? Promise.resolve([] as BillingRequest[])
      : all<BillingRequest>((from, to) =>
          supabase
            .from("billing_requests")
            .select("*")
            .eq("company_id", companyId)
            .in("operation_id", operationIds)
            .order("requested_at", { ascending: false })
            .range(from, to)
        )
};
