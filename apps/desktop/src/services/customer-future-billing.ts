import { randomUUID } from "node:crypto";

import { normalizeIntInput } from "@kyberrock/shared";

import type { DesktopDatabase } from "../database/sqlite.js";

/**
 * NF-e de VENDA PARA ENTREGA FUTURA ja emitida contra o cliente.
 *
 * O cliente grande paga uma nota de simples faturamento (CFOP 5.922/6.922) de uma vez e
 * depois vai retirando a carga aos poucos. Cada carga que sai e uma remessa de entrega
 * futura (CFOP 5.116/5.117) que precisa REFERENCIAR aquela nota — e a nota e emitida por
 * tipo de produto, entao a pesagem de rachao tem que sair com o numero da nota de rachao,
 * nao com o da nota de brita.
 *
 * `productId` nulo e a nota que vale para qualquer produto daquele cliente.
 *
 * A nota tambem e emitida por uma QUANTIDADE: `totalWeightKg` e o que ela faturou, e o que
 * ja foi retirado sai da soma das pesagens que a citaram. O mesmo par (cliente, produto)
 * aceita varias notas — quando uma esgota, a proxima assume — e o cadastro guarda a
 * esgotada como historico do que ja foi entregue.
 */
export interface CustomerFutureBillingInvoiceRow {
  id: string;
  customer_id: string;
  product_id: string | null;
  nfe_number: string;
  total_weight_kg: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustomerFutureBillingInvoice {
  id: string;
  customerId: string;
  /** Null = vale para qualquer produto do cliente. */
  productId: string | null;
  productDescription: string | null;
  nfeNumber: string;
  /** Quanto a nota faturou, em kg. Null = nota sem controle de saldo. */
  totalWeightKg: number | null;
  /** Peso liquido ja retirado contra a nota, somado das pesagens que a citaram. */
  withdrawnWeightKg: number;
  /**
   * Quanto ainda da para retirar. Null quando a nota nao declara total (nada a controlar) e
   * negativo quando saiu mais do que ela faturou — o caminhao ja foi embora, entao o quadro
   * mostra o excedido em vez de esconder atras de um zero.
   */
  remainingWeightKg: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetCustomerFutureBillingInvoiceInput {
  customerId: string;
  /** Null/ausente grava a nota que vale para qualquer produto. */
  productId?: string | null;
  nfeNumber: string;
  /** Total faturado na nota, em kg. Null/ausente = nota sem controle de saldo. */
  totalWeightKg?: number | string | null;
}

/** A nota escolhida para carimbar uma pesagem: numero para o documento, id para o saldo. */
export interface ResolvedFutureBillingInvoice {
  id: string;
  nfeNumber: string;
}

/**
 * Numero da nota: so digitos, vazio vira null. Descartar o que nao e digito e seguro aqui
 * (diferente dos e-mails do cadastro, onde apagar esconderia o erro do operador): o campo
 * guarda o nNF da nota, e mascara nenhuma faz sentido nele.
 */
export function normalizeFutureBillingNfeNumber(value: string | null | undefined): string | null {
  const digits = normalizeIntInput(value ?? "");
  return digits.length > 0 ? digits : null;
}

/**
 * Total da nota em kg. Vazio, zero ou lixo viram null — nota sem controle de saldo, que e
 * como o recurso funcionava antes de existir saldo e como fica quem so quer a referencia no
 * cupom. Zero nao e um total plausivel (nota que faturou nada nao existe), entao trata-lo
 * como "nao informado" evita uma nota que nasce esgotada sem o operador entender por que.
 */
export function normalizeFutureBillingTotalWeightKg(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Quanto ja saiu contra a nota `i`.
 *
 * Soma o peso liquido das pesagens que congelaram a nota no fechamento. Cancelada nao conta
 * (a carga voltou) e nem pesagem sem peso liquido (ainda aberta).
 *
 * O segundo ramo do OR recupera as pesagens ANTERIORES a coluna `future_billing_invoice_id`,
 * que congelaram so o numero: sem ele, quem ja estava usando entrega futura veria a nota
 * estrear no quadro com "0 tirado" depois de meia entrega ja ter saido. Nessas o par
 * (cliente, numero) identificava a nota sozinho, porque so existia uma vigente por produto —
 * e o produto ainda e conferido para a nota especifica nao pescar a carga de outra.
 */
const WITHDRAWN_WEIGHT_SUBQUERY = `(
        SELECT COALESCE(SUM(o.net_weight_kg), 0)
        FROM weighing_operations o
        WHERE o.customer_id = i.customer_id
          AND o.status <> 'cancelled'
          AND o.deleted_at IS NULL
          AND o.net_weight_kg IS NOT NULL
          AND (
            o.future_billing_invoice_id = i.id
            OR (
              o.future_billing_invoice_id IS NULL
              AND o.future_billing_nfe_number = i.nfe_number
              AND (i.product_id IS NULL OR o.product_id = i.product_id)
            )
          )
      )`;

const INVOICE_SELECT = `SELECT i.id, i.customer_id, i.product_id, i.nfe_number, i.total_weight_kg,
              i.is_active, i.created_at, i.updated_at, i.deleted_at,
              p.description AS product_description,
              ${WITHDRAWN_WEIGHT_SUBQUERY} AS withdrawn_weight_kg
       FROM customer_future_billing_invoices i
       LEFT JOIN products p ON p.id = i.product_id`;

interface InvoiceQueryRow extends CustomerFutureBillingInvoiceRow {
  product_description: string | null;
  withdrawn_weight_kg: number | null;
}

function mapInvoiceRow(row: InvoiceQueryRow): CustomerFutureBillingInvoice {
  const totalWeightKg = row.total_weight_kg ?? null;
  const withdrawnWeightKg = row.withdrawn_weight_kg ?? 0;
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    productDescription: row.product_description,
    nfeNumber: row.nfe_number,
    totalWeightKg,
    withdrawnWeightKg,
    remainingWeightKg: totalWeightKg === null ? null : totalWeightKg - withdrawnWeightKg,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Notas de entrega futura do cliente, com o saldo de cada uma.
 *
 * A que vale para qualquer produto vem primeiro e, dentro de cada produto, a ordem e a mais
 * antiga primeiro — a MESMA ordem em que elas vao ser consumidas, para o quadro se ler como
 * a fila que e.
 */
export function getCustomerFutureBillingInvoices(
  database: DesktopDatabase,
  customerId: string
): CustomerFutureBillingInvoice[] {
  const rows = database
    .prepare(
      `${INVOICE_SELECT}
       WHERE i.customer_id = ? AND i.deleted_at IS NULL AND i.is_active = 1
       ORDER BY i.product_id IS NULL DESC, p.description ASC, i.created_at ASC, i.id ASC`
    )
    .all(customerId) as InvoiceQueryRow[];
  return rows.map(mapInvoiceRow);
}

/**
 * Nota que a pesagem de (cliente, produto) tem que referenciar.
 *
 * Tres regras, nesta ordem:
 *
 * 1. A nota DO PRODUTO vence a nota geral do cliente — mesma precedencia do frete por
 *    produto. Sem produto informado, so a nota geral serve: uma pesagem de brita nao pode
 *    sair carimbada com a nota de rachao so porque ela e a unica cadastrada.
 * 2. Entre as notas do mesmo grupo, a MAIS ANTIGA primeiro: o cliente termina de retirar a
 *    nota que abriu antes para so depois comecar a proxima.
 * 3. Nota esgotada nao carimba mais nada. A remessa de entrega futura ampara a quantidade
 *    que aquele faturamento cobriu; passou disso, a carga nao e mais entrega futura daquela
 *    nota — vai para a proxima nota com saldo e, nao havendo nenhuma, sai como venda normal
 *    (exatamente o que acontece com quem nunca cadastrou nota).
 *
 * Nota sem total declarado nunca esgota: e a nota "sem controle de saldo", que se comporta
 * como antes de existir saldo.
 */
export function resolveCustomerFutureBillingInvoice(
  database: DesktopDatabase,
  customerId: string | null | undefined,
  productId: string | null | undefined
): ResolvedFutureBillingInvoice | null {
  if (!customerId) return null;

  const withSaldo = `AND (i.total_weight_kg IS NULL OR i.total_weight_kg > ${WITHDRAWN_WEIGHT_SUBQUERY})`;
  const order = "ORDER BY i.created_at ASC, i.id ASC LIMIT 1";

  if (productId) {
    const specific = database
      .prepare(
        `SELECT i.id, i.nfe_number FROM customer_future_billing_invoices i
         WHERE i.customer_id = ? AND i.product_id = ? AND i.deleted_at IS NULL AND i.is_active = 1
         ${withSaldo}
         ${order}`
      )
      .get(customerId, productId) as { id: string; nfe_number: string } | undefined;
    if (specific) return { id: specific.id, nfeNumber: specific.nfe_number };
  }

  const fallback = database
    .prepare(
      `SELECT i.id, i.nfe_number FROM customer_future_billing_invoices i
       WHERE i.customer_id = ? AND i.product_id IS NULL AND i.deleted_at IS NULL AND i.is_active = 1
       ${withSaldo}
       ${order}`
    )
    .get(customerId) as { id: string; nfe_number: string } | undefined;
  return fallback ? { id: fallback.id, nfeNumber: fallback.nfe_number } : null;
}

/**
 * Grava a nota de entrega futura do cliente. Cada NUMERO e uma nota: regravar o mesmo numero
 * no mesmo par (cliente, produto) atualiza o total dela — e assim que o operador corrige a
 * quantidade digitada errada — enquanto um numero novo entra como mais uma nota na fila.
 */
export function setCustomerFutureBillingInvoice(
  database: DesktopDatabase,
  input: SetCustomerFutureBillingInvoiceInput,
  now: Date = new Date()
): CustomerFutureBillingInvoice {
  const nfeNumber = normalizeFutureBillingNfeNumber(input.nfeNumber);
  if (!nfeNumber) {
    throw new Error("Informe o numero da nota fiscal de faturamento futuro.");
  }

  const productId = input.productId ?? null;
  const totalWeightKg = normalizeFutureBillingTotalWeightKg(input.totalWeightKg);
  const timestamp = now.toISOString();
  const existing = (
    productId
      ? database
          .prepare(
            `SELECT id FROM customer_future_billing_invoices
             WHERE customer_id = ? AND product_id = ? AND nfe_number = ? AND deleted_at IS NULL
             LIMIT 1`
          )
          .get(input.customerId, productId, nfeNumber)
      : database
          .prepare(
            `SELECT id FROM customer_future_billing_invoices
             WHERE customer_id = ? AND product_id IS NULL AND nfe_number = ? AND deleted_at IS NULL
             LIMIT 1`
          )
          .get(input.customerId, nfeNumber)
  ) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  if (existing) {
    database
      .prepare(
        `UPDATE customer_future_billing_invoices
         SET total_weight_kg = ?, is_active = 1, updated_at = ?
         WHERE id = ?`
      )
      .run(totalWeightKg, timestamp, id);
  } else {
    database
      .prepare(
        `INSERT INTO customer_future_billing_invoices (
           id, customer_id, product_id, nfe_number, total_weight_kg, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, input.customerId, productId, nfeNumber, totalWeightKg, timestamp, timestamp);
  }

  return getCustomerFutureBillingInvoices(database, input.customerId).find((i) => i.id === id)!;
}

/**
 * Encerra a entrega futura daquela nota. Soft delete (como o resto do cadastro), para a
 * remocao atravessar para a outra balanca em vez de a nota reaparecer no proximo pull.
 */
export function removeCustomerFutureBillingInvoice(
  database: DesktopDatabase,
  invoiceId: string,
  now: Date = new Date()
): void {
  const timestamp = now.toISOString();
  database
    .prepare(
      `UPDATE customer_future_billing_invoices
       SET deleted_at = ?, updated_at = ?, is_active = 0
       WHERE id = ?`
    )
    .run(timestamp, timestamp, invoiceId);
}
