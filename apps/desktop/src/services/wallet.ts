import type { DesktopDatabase } from "../database/sqlite.js";
import { paymentMethodDisplayName } from "./payment-methods.js";
import { CLOSED_OPERATION_STATUS_SQL_LIST } from "./weighing-operations.js";

/**
 * Carteira: vendas fechadas na forma de pagamento "em carteira".
 *
 * A venda em carteira nasce sem forma de recebimento — o operador escolhe "Em carteira"
 * na balanca, a operacao fecha, a nota sai, mas COMO o cliente vai pagar so e definido
 * num fechamento futuro. Este modulo e a carteira em si: lista o que esta em aberto,
 * registra o fechamento (forma de recebimento + vencimento) e permite reabrir um
 * fechamento lancado errado.
 *
 * Diferenca para o credito do cliente (fiado): o fiado consome o limite/saldo do
 * cadastro e tem periodicidade de fechamento configurada no cliente; a carteira nao
 * mexe no credito e o fechamento e manual, quando o comercial e o cliente combinam.
 */

/** Uma venda em carteira (operacao fechada cuja forma de pagamento e "em carteira"). */
export interface WalletOperation {
  operationId: string;
  /** Data/hora do fechamento da pesagem (saida); cai no created_at quando ausente. */
  soldAt: string;
  customerId: string | null;
  customerName: string;
  plate: string;
  productDescription: string;
  netWeightKg: number | null;
  totalCents: number;
  /** Nome exibido da forma "em carteira" usada na venda (respeita o apelido). */
  paymentMethodName: string;
  /** Forma de recebimento definida no fechamento; null enquanto em aberto. */
  settlementMethodId: string | null;
  settlementMethodName: string | null;
  /** Vencimento combinado no fechamento (YYYY-MM-DD). */
  settlementDueDate: string | null;
  /** Quando o fechamento foi registrado; null = venda ainda em aberto na carteira. */
  settledAt: string | null;
  settlementNote: string | null;
  omieSalesOrderId: number | null;
}

/** Vendas em carteira de um cliente, com o total do grupo. */
export interface WalletCustomerGroup {
  customerId: string | null;
  customerName: string;
  operations: WalletOperation[];
  totalCents: number;
}

export interface WalletSummary {
  openCount: number;
  openTotalCents: number;
  settledCount: number;
  settledTotalCents: number;
}

export interface WalletReport {
  groups: WalletCustomerGroup[];
  summary: WalletSummary;
}

export type WalletStatusFilter = "open" | "settled" | "all";

export interface WalletQuery {
  /** `open` (padrao) = sem fechamento; `settled` = ja fechadas; `all` = as duas. */
  status?: WalletStatusFilter;
  customerId?: string;
  /** Recorte por data da venda (YYYY-MM-DD), inclusivo. */
  startDate?: string;
  endDate?: string;
  /** Busca livre por cliente, placa ou produto. */
  search?: string;
}

export interface SettleWalletInput {
  operationIds: string[];
  /** Forma de pagamento com que o cliente vai pagar (nao pode ser outra "em carteira"). */
  settlementMethodId: string;
  /** Vencimento combinado (YYYY-MM-DD). Opcional: nem todo fechamento tem prazo. */
  dueDate?: string | null;
  note?: string | null;
}

interface WalletOperationRow {
  id: string;
  sold_at: string;
  customer_id: string | null;
  customer_name: string | null;
  plate: string | null;
  product_description: string | null;
  net_weight_kg: number | null;
  total_cents: number | null;
  method_name: string;
  method_alias: string | null;
  settlement_method_id: string | null;
  settlement_method_name: string | null;
  settlement_method_alias: string | null;
  wallet_settlement_due_date: string | null;
  wallet_settled_at: string | null;
  wallet_settlement_note: string | null;
  omie_sales_order_id: number | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, label: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${label} invalida. Use o formato AAAA-MM-DD.`);
  }
}

function mapRow(row: WalletOperationRow): WalletOperation {
  return {
    operationId: row.id,
    soldAt: row.sold_at,
    customerId: row.customer_id,
    customerName: row.customer_name?.trim() || "Cliente nao informado",
    plate: row.plate ?? "-",
    productDescription: row.product_description ?? "-",
    netWeightKg: row.net_weight_kg,
    totalCents: row.total_cents ?? 0,
    paymentMethodName: paymentMethodDisplayName({
      alias: row.method_alias,
      name: row.method_name
    }),
    settlementMethodId: row.settlement_method_id,
    settlementMethodName:
      row.settlement_method_name === null
        ? null
        : paymentMethodDisplayName({
            alias: row.settlement_method_alias,
            name: row.settlement_method_name
          }),
    settlementDueDate: row.wallet_settlement_due_date,
    settledAt: row.wallet_settled_at,
    settlementNote: row.wallet_settlement_note,
    omieSalesOrderId: row.omie_sales_order_id
  };
}

/**
 * Vendas em carteira agrupadas por cliente (mais recentes primeiro dentro do grupo),
 * com o total em aberto e o total ja fechado do recorte.
 */
export function getWalletReport(database: DesktopDatabase, query: WalletQuery = {}): WalletReport {
  const status = query.status ?? "open";
  const conditions: string[] = [
    "pm.is_wallet = 1",
    "o.deleted_at IS NULL",
    `o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})`
  ];
  const params: unknown[] = [];

  if (status === "open") conditions.push("o.wallet_settled_at IS NULL");
  if (status === "settled") conditions.push("o.wallet_settled_at IS NOT NULL");

  if (query.customerId) {
    conditions.push("o.customer_id = ?");
    params.push(query.customerId);
  }
  if (query.startDate) {
    assertDate(query.startDate, "Data inicial");
    conditions.push("date(COALESCE(o.exit_weight_captured_at, o.created_at)) >= date(?)");
    params.push(query.startDate);
  }
  if (query.endDate) {
    assertDate(query.endDate, "Data final");
    conditions.push("date(COALESCE(o.exit_weight_captured_at, o.created_at)) <= date(?)");
    params.push(query.endDate);
  }
  const search = query.search?.trim();
  if (search) {
    conditions.push(
      `(UPPER(COALESCE(c.trade_name, o.remote_customer_name, '')) LIKE UPPER(?)
        OR UPPER(COALESCE(v.plate, o.remote_plate, '')) LIKE UPPER(?)
        OR UPPER(COALESCE(p.description, o.remote_product_description, '')) LIKE UPPER(?))`
    );
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const rows = database
    .prepare(
      `SELECT
         o.id,
         COALESCE(o.exit_weight_captured_at, o.created_at) AS sold_at,
         o.customer_id,
         COALESCE(c.trade_name, o.remote_customer_name) AS customer_name,
         COALESCE(v.plate, o.remote_plate) AS plate,
         COALESCE(p.description, o.remote_product_description) AS product_description,
         o.net_weight_kg, o.total_cents, o.omie_sales_order_id,
         pm.name AS method_name, pm.alias AS method_alias,
         o.wallet_settlement_method_id AS settlement_method_id,
         sm.name AS settlement_method_name, sm.alias AS settlement_method_alias,
         o.wallet_settlement_due_date, o.wallet_settled_at, o.wallet_settlement_note
       FROM weighing_operations o
       JOIN payment_methods pm ON pm.id = o.payment_method_id
       LEFT JOIN payment_methods sm ON sm.id = o.wallet_settlement_method_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN products p ON p.id = o.product_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY sold_at DESC`
    )
    .all(...params) as WalletOperationRow[];

  const operations = rows.map(mapRow);
  const groups = new Map<string, WalletCustomerGroup>();
  const summary: WalletSummary = {
    openCount: 0,
    openTotalCents: 0,
    settledCount: 0,
    settledTotalCents: 0
  };

  for (const operation of operations) {
    const key = operation.customerId ?? `name:${operation.customerName}`;
    const group = groups.get(key);
    if (group) {
      group.operations.push(operation);
      group.totalCents += operation.totalCents;
    } else {
      groups.set(key, {
        customerId: operation.customerId,
        customerName: operation.customerName,
        operations: [operation],
        totalCents: operation.totalCents
      });
    }

    if (operation.settledAt) {
      summary.settledCount++;
      summary.settledTotalCents += operation.totalCents;
    } else {
      summary.openCount++;
      summary.openTotalCents += operation.totalCents;
    }
  }

  return {
    groups: [...groups.values()].sort((a, b) => b.totalCents - a.totalCents),
    summary
  };
}

interface SettlementMethodRow {
  id: string;
  name: string;
  is_wallet: number;
  is_active: number;
}

interface OperationWalletRow {
  id: string;
  is_wallet: number | null;
  wallet_settled_at: string | null;
  status: string;
}

/**
 * Registra o fechamento das vendas em carteira: define a forma de recebimento (e o
 * vencimento combinado) das operacoes escolhidas. Tudo em uma transacao — ou o
 * fechamento inteiro entra, ou nada muda.
 */
export function settleWalletOperations(
  database: DesktopDatabase,
  input: SettleWalletInput,
  now: Date = new Date()
): number {
  const operationIds = [...new Set(input.operationIds.filter((id) => id.trim().length > 0))];
  if (operationIds.length === 0) {
    throw new Error("Selecione ao menos uma venda em carteira para fechar.");
  }

  const method = database
    .prepare(
      "SELECT id, name, is_wallet, is_active FROM payment_methods WHERE id = ? AND deleted_at IS NULL"
    )
    .get(input.settlementMethodId) as SettlementMethodRow | undefined;
  if (!method) {
    throw new Error("Informe a forma de recebimento do fechamento.");
  }
  if (method.is_wallet === 1) {
    // Fechar carteira com carteira nao define recebimento nenhum.
    throw new Error(
      `"${method.name}" e uma forma em carteira. Escolha como o cliente vai pagar (dinheiro, PIX, boleto...).`
    );
  }
  if (method.is_active === 0) {
    throw new Error(`A forma de pagamento "${method.name}" esta inativa.`);
  }

  const dueDate = input.dueDate?.trim() || null;
  if (dueDate) assertDate(dueDate, "Data de vencimento");

  const nowIso = now.toISOString();
  const findOperation = database.prepare(
    `SELECT o.id, o.status, o.wallet_settled_at, pm.is_wallet
     FROM weighing_operations o
     LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
     WHERE o.id = ? AND o.deleted_at IS NULL`
  );
  const update = database.prepare(
    `UPDATE weighing_operations SET
       wallet_settlement_method_id = ?,
       wallet_settlement_due_date = ?,
       wallet_settled_at = ?,
       wallet_settlement_note = ?,
       updated_at = ?
     WHERE id = ?`
  );

  const settle = database.transaction(() => {
    let count = 0;
    for (const operationId of operationIds) {
      const operation = findOperation.get(operationId) as OperationWalletRow | undefined;
      if (!operation) {
        throw new Error(`Operacao ${operationId} nao encontrada.`);
      }
      if (operation.is_wallet !== 1) {
        throw new Error(`A operacao ${operationId} nao foi vendida em carteira.`);
      }
      if (operation.status === "cancelled") {
        throw new Error(`A operacao ${operationId} foi cancelada e nao pode ser fechada.`);
      }
      update.run(method.id, dueDate, nowIso, input.note?.trim() || null, nowIso, operationId);
      count++;
    }
    return count;
  });

  return settle();
}

/**
 * Desfaz o fechamento: a venda volta a ficar em aberto na carteira. Usado quando o
 * fechamento foi lancado na forma errada.
 */
export function reopenWalletOperations(
  database: DesktopDatabase,
  operationIds: string[],
  now: Date = new Date()
): number {
  const ids = [...new Set(operationIds.filter((id) => id.trim().length > 0))];
  if (ids.length === 0) {
    throw new Error("Selecione ao menos uma venda para reabrir.");
  }

  const nowIso = now.toISOString();
  const update = database.prepare(
    `UPDATE weighing_operations SET
       wallet_settlement_method_id = NULL,
       wallet_settlement_due_date = NULL,
       wallet_settled_at = NULL,
       wallet_settlement_note = NULL,
       updated_at = ?
     WHERE id = ? AND deleted_at IS NULL AND wallet_settled_at IS NOT NULL`
  );

  const reopen = database.transaction(() => {
    let count = 0;
    for (const id of ids) {
      count += update.run(nowIso, id).changes;
    }
    return count;
  });

  return reopen();
}
