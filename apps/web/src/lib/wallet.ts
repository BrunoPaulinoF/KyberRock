/**
 * Carteira no site — espelho de `apps/desktop/src/services/wallet.ts`, lendo a nuvem.
 *
 * Vendas fechadas na forma "em carteira": a nota sai, mas COMO o cliente vai pagar so e
 * definido num fechamento futuro. A leitura e direta (`weighing_operations` com
 * `payment_method_id` de uma forma `is_wallet`); fechar e reabrir continuam pela `web-api`
 * (`settle_wallet` / `reopen_wallet`, docs/web-api.md 4.7).
 */

import { localDay } from "./format";
import { buildIdentityIndex, identityKeyFor } from "./invoice-closing";
import { matchesSearch } from "./operation";
import type { Customer, Operation, PaymentMethod } from "./queries";
import { supabase } from "./supabase";

export type WalletStatusFilter = "open" | "settled" | "all";

/** Uma venda em carteira (operacao fechada cuja forma de pagamento e "em carteira"). */
export interface WalletOperation {
  operationId: string;
  /** Saida da balanca; cai na criacao quando ausente. */
  soldAt: string;
  /** Dia da venda (`YYYY-MM-DD`, fuso da pedreira) — a base do filtro de periodo. */
  operationDate: string;
  customerId: string | null;
  customerName: string;
  plate: string;
  productDescription: string;
  netWeightKg: number | null;
  totalCents: number;
  /** Parte da venda que saiu do adiantamento do cliente no fechamento da balanca. */
  advanceAppliedCents: number;
  /** Quanto ainda ha para receber: total menos o que o adiantamento cobriu. */
  openAmountCents: number;
  settlementMethodId: string | null;
  settlementMethodName: string | null;
  settlementDueDate: string | null;
  settledAt: string | null;
  settlementNote: string | null;
  /** Quitada pelo adiantamento no fechamento da balanca: nao reabre. */
  settledByAdvance: boolean;
}

export interface WalletCustomerGroup {
  key: string;
  customerId: string | null;
  customerName: string;
  operations: WalletOperation[];
  totalCents: number;
  openTotalCents: number;
}

export interface WalletSummary {
  openCount: number;
  openTotalCents: number;
  settledCount: number;
  settledTotalCents: number;
  advanceAppliedTotalCents: number;
}

export interface WalletReport {
  groups: WalletCustomerGroup[];
  summary: WalletSummary;
}

export const EMPTY_WALLET_REPORT: WalletReport = {
  groups: [],
  summary: {
    openCount: 0,
    openTotalCents: 0,
    settledCount: 0,
    settledTotalCents: 0,
    advanceAppliedTotalCents: 0
  }
};

/** Nome exibido da forma de pagamento: o apelido manda. */
export function paymentMethodDisplayName(method: Pick<PaymentMethod, "alias" | "name">): string {
  return method.alias?.trim() || method.name;
}

export function toWalletOperation(
  op: Operation,
  customer: Pick<Customer, "trade_name"> | undefined,
  methodsById: Map<string, Pick<PaymentMethod, "alias" | "name">>
): WalletOperation {
  const totalCents = op.total_cents ?? 0;
  // Nunca negativo, e nunca mais que a propria venda.
  const advanceAppliedCents = Math.min(Math.max(0, op.omie_advance_settle_cents ?? 0), totalCents);
  const soldAt = op.closed_at ?? op.created_at;
  const method = op.wallet_settlement_method_id
    ? methodsById.get(op.wallet_settlement_method_id)
    : undefined;
  return {
    operationId: op.id,
    soldAt,
    operationDate: localDay(soldAt),
    customerId: op.customer_id,
    customerName:
      customer?.trade_name?.trim() || op.customer_name?.trim() || "Cliente nao informado",
    plate: op.plate ?? "-",
    productDescription: op.product_description ?? "-",
    netWeightKg: op.net_weight_kg,
    totalCents,
    advanceAppliedCents,
    openAmountCents: totalCents - advanceAppliedCents,
    settlementMethodId: op.wallet_settlement_method_id,
    settlementMethodName: method ? paymentMethodDisplayName(method) : null,
    settlementDueDate: op.wallet_settlement_due_date,
    settledAt: op.wallet_settled_at,
    settlementNote: op.wallet_settlement_note,
    settledByAdvance:
      op.wallet_settled_at !== null &&
      op.wallet_settlement_method_id === null &&
      advanceAppliedCents > 0
  };
}

/**
 * As vendas em carteira agrupadas por cliente REAL (o cadastro duplicado nao parte o cliente
 * em dois blocos), mais recentes primeiro dentro do grupo, grupos pelo maior total.
 */
export function buildWalletReport(
  operations: readonly Operation[],
  context: {
    customers: readonly Customer[];
    methods: ReadonlyArray<Pick<PaymentMethod, "id" | "alias" | "name">>;
    search?: string;
  }
): WalletReport {
  const customersById = new Map(context.customers.map((customer) => [customer.id, customer]));
  const identities = buildIdentityIndex(context.customers);
  const methodsById = new Map(context.methods.map((method) => [method.id, method]));
  const search = context.search?.trim() ?? "";

  const rows = operations
    .filter((op) => op.status !== "cancelled")
    .map((op) =>
      toWalletOperation(
        op,
        op.customer_id ? customersById.get(op.customer_id) : undefined,
        methodsById
      )
    )
    .filter(
      (op) =>
        !search ||
        [op.customerName, op.plate, op.productDescription].some((field) =>
          matchesSearch(field, search)
        )
    )
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt));

  const groups = new Map<string, WalletCustomerGroup>();
  const summary: WalletSummary = { ...EMPTY_WALLET_REPORT.summary };

  for (const operation of rows) {
    const openCents = operation.settledAt ? 0 : operation.openAmountCents;
    const key = operation.customerId
      ? identityKeyFor(identities, operation.customerId)
      : `name:${operation.customerName}`;
    const group = groups.get(key);
    if (group) {
      group.operations.push(operation);
      group.totalCents += operation.totalCents;
      group.openTotalCents += openCents;
    } else {
      groups.set(key, {
        key,
        customerId: operation.customerId,
        customerName: operation.customerName,
        operations: [operation],
        totalCents: operation.totalCents,
        openTotalCents: openCents
      });
    }

    summary.advanceAppliedTotalCents += operation.advanceAppliedCents;
    if (operation.settledAt) {
      summary.settledCount++;
      summary.settledTotalCents += operation.totalCents;
    } else {
      summary.openCount++;
      summary.openTotalCents += operation.openAmountCents;
    }
  }

  return {
    groups: [...groups.values()].sort((a, b) => b.totalCents - a.totalCents),
    summary
  };
}

/** A selecao que cada botao pode mandar: fechar so o que esta em aberto, reabrir so o fechado a mao. */
export function splitSelection(selected: readonly WalletOperation[]): {
  openIds: string[];
  reopenIds: string[];
  totalCents: number;
} {
  return {
    openIds: selected.filter((op) => !op.settledAt).map((op) => op.operationId),
    // Quitada pelo adiantamento nao reabre (a web-api recusa o lote inteiro): fica de fora.
    reopenIds: selected
      .filter((op) => op.settledAt && !op.settledByAdvance)
      .map((op) => op.operationId),
    totalCents: selected.reduce((sum, op) => sum + op.openAmountCents, 0)
  };
}

const CLOSED_STATUSES = ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"];
const PAGE = 1000;

/**
 * Vendas em carteira da empresa. `period` recorta pela data em que a pesagem FECHOU
 * (`closed_at`, com a criacao para a pesagem antiga) — a mesma base do Fechamento de faturas.
 */
export async function loadWalletOperations(
  companyId: string,
  walletMethodIds: readonly string[],
  status: WalletStatusFilter,
  period: { startIso: string; endIso: string } | null
): Promise<Operation[]> {
  if (walletMethodIds.length === 0) return [];
  const rows: Operation[] = [];
  for (let page = 0; page < 50; page++) {
    let query = supabase
      .from("weighing_operations")
      .select("*")
      .eq("company_id", companyId)
      .in("payment_method_id", [...walletMethodIds])
      .in("status", CLOSED_STATUSES);
    if (status === "open") query = query.is("wallet_settled_at", null);
    if (status === "settled") query = query.not("wallet_settled_at", "is", null);
    if (period) {
      query = query.or(
        [
          `and(closed_at.gte."${period.startIso}",closed_at.lt."${period.endIso}")`,
          `and(closed_at.is.null,created_at.gte."${period.startIso}",created_at.lt."${period.endIso}")`
        ].join(",")
      );
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
