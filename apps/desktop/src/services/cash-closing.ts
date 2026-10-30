import { randomUUID } from "node:crypto";

import { isNoCustomerId } from "@kyberrock/shared";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import {
  NO_ACCOUNT_KEY,
  type CashClosingAccount,
  type CashClosingNoCharge,
  type CashClosingNoChargeKind,
  type CashClosingReceivable,
  type CashClosingReceivableKind,
  type CashClosingReport,
  type SavedCashClosing
} from "./cash-closing-model.js";
import { freightValueGoesToInvoice } from "./freight.js";
import { existingLocalReference } from "./local-references.js";
import { orderInstallmentPlan, resolveOrderPaymentSchedule } from "./order-installments.js";
import {
  CLOSED_OPERATION_STATUS_SQL_LIST,
  operationSaleDay,
  operationSaleDaySql
} from "./weighing-operation-status.js";

/**
 * Fechamento do caixa do dia: o que foi VENDIDO x o que ENTROU, conta por conta.
 *
 * Era o item P0 que faltava da reuniao de 06/07 ("fechamento do dia espelhando faturamento x
 * formas de recebimento, analogo ao fechamento de caixa"). As contas (caixinha, OMIE Cash,
 * GetNet) e o vinculo forma -> conta ja existiam desde a migracao 27 justamente para isso,
 * mas nenhuma tela juntava os dois lados: o operador somava os cupons na mao para conferir a
 * gaveta.
 *
 * Tres blocos, e cada centavo vendido no dia cai em exatamente um:
 * - RECEBIDO HOJE, por conta: a parte a vista das vendas do dia (a parcela que vence no
 *   proprio dia da venda) e o fechamento de carteira lancado no dia com recebimento na hora.
 *   E aqui que entra o "conferido": o que o operador contou na gaveta, viu no extrato do PIX
 *   ou no relatorio da maquininha.
 * - A RECEBER: boleto, parcelas a prazo, carteira e fiado. Nao e dinheiro no caixa hoje.
 * - SEM ENTRADA DE DINHEIRO: bonificacao, pesagem SEM CLIENTE e a parte paga com o
 *   adiantamento que o cliente ja tinha depositado.
 *
 * O valor de cada venda e o COBRADO do cliente (o total do pedido do OMIE): o frete que fica
 * so no sistema nao e cobrado na balanca e nao pode aparecer como diferenca de caixa.
 *
 * O dia e o da venda no calendario de Sao Paulo (`operationSaleDaySql`), o mesmo de todo
 * relatorio de dinheiro da balanca e da emissao do pedido no OMIE.
 */

export * from "./cash-closing-model.js";

interface SaleRow {
  id: string;
  customer_id: string | null;
  payment_term_id: string | null;
  exit_weight_captured_at: string | null;
  net_weight_kg: number | null;
  product_total_cents: number | null;
  freight_total_cents: number | null;
  freight_type: string | null;
  omie_advance_settle_cents: number | null;
  payment_method_id: string | null;
  payment_method_name: string | null;
  payment_method_code: string | null;
  payment_method_omie_code: string | null;
  is_wallet: number | null;
  is_customer_credit: number | null;
  account_id: string | null;
  account_name: string | null;
}

interface WalletSettlementRow {
  id: string;
  wallet_settled_at: string | null;
  wallet_settlement_due_date: string | null;
  product_total_cents: number | null;
  freight_total_cents: number | null;
  freight_type: string | null;
  omie_advance_settle_cents: number | null;
  payment_method_name: string | null;
  payment_method_code: string | null;
  payment_method_omie_code: string | null;
  account_id: string | null;
  account_name: string | null;
}

export function getCashClosingReport(
  database: DesktopDatabase,
  unitId: string,
  date: string
): CashClosingReport {
  assertIsoDate(date);
  const accounts = new Map<string, CashClosingAccount>();
  const receivables = new Map<string, CashClosingReceivable>();
  const noCharge = new Map<CashClosingNoChargeKind, CashClosingNoCharge>();

  const sales = database
    .prepare(
      `SELECT o.id, o.customer_id, o.payment_term_id, o.exit_weight_captured_at, o.net_weight_kg,
              o.product_total_cents, o.freight_total_cents, o.freight_type,
              o.omie_advance_settle_cents, o.payment_method_id,
              COALESCE(NULLIF(TRIM(pm.alias), ''), pm.name) AS payment_method_name,
              pm.code AS payment_method_code, pm.omie_code AS payment_method_omie_code,
              pm.is_wallet, pm.is_customer_credit,
              ac.id AS account_id, ac.name AS account_name
       FROM weighing_operations o
       LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
       LEFT JOIN accounts ac ON ac.id = pm.account_id AND ac.deleted_at IS NULL
       WHERE o.unit_id = ?
         AND o.deleted_at IS NULL
         AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
         AND ${operationSaleDaySql("o")} = date(?)`
    )
    .all(unitId, date) as SaleRow[];

  let netWeightKg = 0;
  let soldCents = 0;
  for (const sale of sales) {
    const charged = chargedCents(sale);
    netWeightKg += sale.net_weight_kg ?? 0;
    soldCents += charged;

    if (charged <= 0 || isNoCustomerId(sale.customer_id)) {
      addNoCharge(noCharge, "sem_cobranca", charged);
      continue;
    }
    if (isBonificacao(sale)) {
      addNoCharge(noCharge, "bonificacao", charged);
      continue;
    }

    // O que o adiantamento ja cobriu foi dinheiro de outro dia: nao entra no caixa de hoje
    // nem fica a receber.
    const advance = Math.min(Math.max(sale.omie_advance_settle_cents ?? 0, 0), charged);
    if (advance > 0) addNoCharge(noCharge, "adiantamento", advance);
    const due = charged - advance;
    if (due <= 0) continue;

    const methodName = sale.payment_method_name ?? "Sem forma informada";
    if (!sale.payment_method_id || !sale.payment_method_name) {
      addReceivable(receivables, "sem_forma", methodName, due);
    } else if (sale.is_wallet === 1) {
      addReceivable(receivables, "carteira", methodName, due);
    } else if (sale.is_customer_credit === 1) {
      addReceivable(receivables, "fiado", methodName, due);
    } else if (isBoleto(sale)) {
      addReceivable(receivables, "boleto", methodName, due);
    } else {
      // A parte que vence no proprio dia da venda e a vista; o resto e prazo. E a mesma conta
      // das parcelas do pedido do OMIE (`orderInstallmentPlan`), entao "7/14/21" nunca
      // aparece como dinheiro no caixa e "entrada + 30" separa as duas partes certinho.
      const schedule = resolveOrderPaymentSchedule(
        database,
        sale.payment_term_id,
        sale.exit_weight_captured_at
      );
      const installments = orderInstallmentPlan(schedule, due);
      const today = installments
        .filter((installment) => installment.dueDate <= schedule.issueDate)
        .reduce((sum, installment) => sum + installment.valueCents, 0);
      if (today > 0) {
        addAccountLine(accounts, sale.account_id, sale.account_name, "sales", methodName, today);
      }
      if (due - today > 0) addReceivable(receivables, "a_prazo", methodName, due - today);
    }
  }

  // Fechamento de carteira lancado no dia: venda de outro dia que o cliente veio pagar hoje.
  // So conta como caixa quando o recebimento foi na hora (sem vencimento futuro e sem boleto).
  const settlements = database
    .prepare(
      `SELECT o.id, o.wallet_settled_at, o.wallet_settlement_due_date,
              o.product_total_cents, o.freight_total_cents, o.freight_type,
              o.omie_advance_settle_cents,
              COALESCE(NULLIF(TRIM(pm.alias), ''), pm.name) AS payment_method_name,
              pm.code AS payment_method_code, pm.omie_code AS payment_method_omie_code,
              ac.id AS account_id, ac.name AS account_name
       FROM weighing_operations o
       JOIN payment_methods pm ON pm.id = o.wallet_settlement_method_id
       LEFT JOIN accounts ac ON ac.id = pm.account_id AND ac.deleted_at IS NULL
       WHERE o.unit_id = ?
         AND o.deleted_at IS NULL
         AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
         AND o.wallet_settled_at IS NOT NULL
         AND o.wallet_settled_at >= ? AND o.wallet_settled_at < ?`
    )
    .all(unitId, shiftDate(date, -1), shiftDate(date, 2)) as WalletSettlementRow[];

  for (const settlement of settlements) {
    if (operationSaleDay(settlement.wallet_settled_at) !== date) continue;
    if (settlement.wallet_settlement_due_date && settlement.wallet_settlement_due_date > date) {
      continue;
    }
    if (isBoleto(settlement)) continue;
    const charged = chargedCents(settlement);
    const advance = Math.min(Math.max(settlement.omie_advance_settle_cents ?? 0, 0), charged);
    const received = charged - advance;
    if (received <= 0) continue;
    addAccountLine(
      accounts,
      settlement.account_id,
      settlement.account_name,
      "walletSettlements",
      settlement.payment_method_name ?? "Sem forma informada",
      received
    );
  }

  const accountList = [...accounts.values()].sort(compareAccounts);
  const receivableList = [...receivables.values()].sort(
    (a, b) =>
      RECEIVABLE_ORDER.indexOf(a.kind) - RECEIVABLE_ORDER.indexOf(b.kind) ||
      b.totalCents - a.totalCents
  );
  const noChargeList = NO_CHARGE_ORDER.map((kind) => noCharge.get(kind)).filter(
    (line): line is CashClosingNoCharge => Boolean(line)
  );

  return {
    date,
    operations: sales.length,
    netWeightKg,
    soldCents,
    receivedCents: accountList.reduce((sum, account) => sum + account.expectedCents, 0),
    receivableCents: receivableList.reduce((sum, line) => sum + line.totalCents, 0),
    noChargeCents: noChargeList.reduce((sum, line) => sum + line.totalCents, 0),
    accounts: accountList,
    receivables: receivableList,
    noCharge: noChargeList,
    saved: readSavedCashClosing(database, unitId, date)
  };
}

export interface SaveCashClosingInput {
  identity: LocalDesktopIdentity;
  date: string;
  countedCents: Record<string, number>;
  notes?: string | null;
}

/**
 * Grava a conferencia do dia (o que foi contado em cada conta e a observacao). Uma por dia e
 * pedreira: salvar de novo substitui, e cada gravacao fica na auditoria com o valor anterior.
 */
export function saveCashClosing(
  database: DesktopDatabase,
  input: SaveCashClosingInput,
  now: Date = new Date()
): SavedCashClosing {
  assertIsoDate(input.date);
  const countedCents: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.countedCents ?? {})) {
    if (!key.trim()) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error("Valor conferido invalido.");
    }
    countedCents[key] = Math.round(value);
  }
  const notes = (input.notes ?? "").trim().slice(0, 2000);
  const savedAt = now.toISOString();
  const unitId = input.identity.unitId;
  const previous = readSavedCashClosing(database, unitId, input.date);

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO cash_closings (id, unit_id, closing_date, counted_json, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(unit_id, closing_date) DO UPDATE SET
           counted_json = excluded.counted_json,
           notes = excluded.notes,
           updated_at = excluded.updated_at`
      )
      .run(randomUUID(), unitId, input.date, JSON.stringify(countedCents), notes, savedAt, savedAt);

    database
      .prepare(
        `INSERT INTO audit_logs (id, company_id, unit_id, device_id, entity_type, entity_id, action, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, 'cash_closing', ?, 'cash_closing_saved', ?, ?, ?)`
      )
      .run(
        randomUUID(),
        existingLocalReference(database, "companies", input.identity.companyId),
        existingLocalReference(database, "units", unitId),
        existingLocalReference(database, "devices", input.identity.deviceId),
        input.date,
        previous ? JSON.stringify(previous) : null,
        JSON.stringify({ countedCents, notes }),
        savedAt
      );
  })();

  return { countedCents, notes, savedAt };
}

function readSavedCashClosing(
  database: DesktopDatabase,
  unitId: string,
  date: string
): SavedCashClosing | null {
  const row = database
    .prepare(
      "SELECT counted_json, notes, updated_at FROM cash_closings WHERE unit_id = ? AND closing_date = ?"
    )
    .get(unitId, date) as
    | { counted_json: string; notes: string | null; updated_at: string }
    | undefined;
  if (!row) return null;
  let countedCents: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(row.counted_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      countedCents = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, number] => typeof entry[1] === "number"
        )
      );
    }
  } catch {
    // Conferencia corrompida: o relatorio continua abrindo, so sem o que foi contado.
  }
  return { countedCents, notes: row.notes ?? "", savedAt: row.updated_at };
}

const RECEIVABLE_ORDER: CashClosingReceivableKind[] = [
  "boleto",
  "a_prazo",
  "carteira",
  "fiado",
  "sem_forma"
];

const NO_CHARGE_ORDER: CashClosingNoChargeKind[] = ["bonificacao", "adiantamento", "sem_cobranca"];

/**
 * Valor cobrado do cliente: o produto e, quando o frete vai na nota, o frete. O frete que fica
 * so no sistema e do transportador e nao passa pelo caixa da pedreira.
 */
function chargedCents(row: {
  product_total_cents: number | null;
  freight_total_cents: number | null;
  freight_type: string | null;
}): number {
  const product = row.product_total_cents ?? 0;
  const freight = row.freight_total_cents ?? 0;
  const freightCharged = row.freight_type ? freightValueGoesToInvoice(row.freight_type) : true;
  return product + (freightCharged ? freight : 0);
}

function isBonificacao(row: { payment_method_code: string | null }): boolean {
  return row.payment_method_code === "bonificacao";
}

/** Boleto pela forma de fabrica ou pelo meio 15 (boleto) do OMIE/NF-e. */
function isBoleto(row: {
  payment_method_code: string | null;
  payment_method_omie_code: string | null;
}): boolean {
  return row.payment_method_code === "boleto" || row.payment_method_omie_code === "15";
}

function addAccountLine(
  accounts: Map<string, CashClosingAccount>,
  accountId: string | null,
  accountName: string | null,
  bucket: "sales" | "walletSettlements",
  methodName: string,
  cents: number
): void {
  const key = accountId ?? NO_ACCOUNT_KEY;
  const account = accounts.get(key) ?? {
    key,
    accountName: accountId ? (accountName ?? "Conta") : "Sem conta vinculada",
    expectedCents: 0,
    sales: [],
    walletSettlements: []
  };
  account.expectedCents += cents;
  const lines = account[bucket];
  const line = lines.find((item) => item.paymentMethodName === methodName);
  if (line) {
    line.operations += 1;
    line.totalCents += cents;
  } else {
    lines.push({ paymentMethodName: methodName, operations: 1, totalCents: cents });
  }
  accounts.set(key, account);
}

function addReceivable(
  receivables: Map<string, CashClosingReceivable>,
  kind: CashClosingReceivableKind,
  methodName: string,
  cents: number
): void {
  const key = `${kind}:${methodName}`;
  const line = receivables.get(key) ?? {
    kind,
    paymentMethodName: methodName,
    operations: 0,
    totalCents: 0
  };
  line.operations += 1;
  line.totalCents += cents;
  receivables.set(key, line);
}

function addNoCharge(
  noCharge: Map<CashClosingNoChargeKind, CashClosingNoCharge>,
  kind: CashClosingNoChargeKind,
  cents: number
): void {
  const line = noCharge.get(kind) ?? { kind, operations: 0, totalCents: 0 };
  line.operations += 1;
  line.totalCents += Math.max(cents, 0);
  noCharge.set(kind, line);
}

/** Contas de verdade primeiro, pelo nome; "sem conta vinculada" por ultimo, para chamar atencao. */
function compareAccounts(a: CashClosingAccount, b: CashClosingAccount): number {
  if (a.key === NO_ACCOUNT_KEY) return 1;
  if (b.key === NO_ACCOUNT_KEY) return -1;
  return a.accountName.localeCompare(b.accountName, "pt-BR");
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function assertIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error("Data do fechamento invalida.");
  }
}
