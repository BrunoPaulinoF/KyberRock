/**
 * Leituras do site: direto do Postgres com o login do usuario (RLS abre so a propria
 * empresa — migracao `202609220003`). Toda funcao filtra por `company_id` mesmo assim, para
 * a intencao ficar explicita no codigo.
 */

import { OPEN_STATUS, type OperationRequest } from "./operation";
import { supabase, type Tables } from "./supabase";

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

export const q = {
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
      supabase.from("drivers").select("*").eq("company_id", companyId).order("name").range(from, to)
    ),
  vehicles: (companyId: string) =>
    all<Vehicle>((from, to) =>
      supabase
        .from("vehicles")
        .select("*")
        .eq("company_id", companyId)
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
