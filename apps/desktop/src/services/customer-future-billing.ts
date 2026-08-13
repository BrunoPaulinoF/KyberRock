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
 */
export interface CustomerFutureBillingInvoiceRow {
  id: string;
  customer_id: string;
  product_id: string | null;
  nfe_number: string;
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetCustomerFutureBillingInvoiceInput {
  customerId: string;
  /** Null/ausente grava a nota que vale para qualquer produto. */
  productId?: string | null;
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

const INVOICE_SELECT = `SELECT i.id, i.customer_id, i.product_id, i.nfe_number, i.is_active,
              i.created_at, i.updated_at, i.deleted_at,
              p.description AS product_description
       FROM customer_future_billing_invoices i
       LEFT JOIN products p ON p.id = i.product_id`;

interface InvoiceQueryRow extends CustomerFutureBillingInvoiceRow {
  product_description: string | null;
}

function mapInvoiceRow(row: InvoiceQueryRow): CustomerFutureBillingInvoice {
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    productDescription: row.product_description,
    nfeNumber: row.nfe_number,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Notas de entrega futura do cliente. A que vale para qualquer produto vem primeiro. */
export function getCustomerFutureBillingInvoices(
  database: DesktopDatabase,
  customerId: string
): CustomerFutureBillingInvoice[] {
  const rows = database
    .prepare(
      `${INVOICE_SELECT}
       WHERE i.customer_id = ? AND i.deleted_at IS NULL AND i.is_active = 1
       ORDER BY i.product_id IS NULL DESC, p.description ASC`
    )
    .all(customerId) as InvoiceQueryRow[];
  return rows.map(mapInvoiceRow);
}

/**
 * Numero da nota que a pesagem de (cliente, produto) tem que referenciar.
 *
 * A nota DO PRODUTO vence a nota geral do cliente — mesma precedencia do frete por
 * produto. Sem produto informado, so a nota geral serve: uma pesagem de brita nao pode
 * sair carimbada com a nota de rachao so porque ela e a unica cadastrada.
 */
export function resolveCustomerFutureBillingNfe(
  database: DesktopDatabase,
  customerId: string | null | undefined,
  productId: string | null | undefined
): string | null {
  if (!customerId) return null;

  if (productId) {
    const specific = database
      .prepare(
        `SELECT nfe_number FROM customer_future_billing_invoices
         WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL AND is_active = 1
         LIMIT 1`
      )
      .get(customerId, productId) as { nfe_number: string } | undefined;
    if (specific?.nfe_number) return specific.nfe_number;
  }

  const fallback = database
    .prepare(
      `SELECT nfe_number FROM customer_future_billing_invoices
       WHERE customer_id = ? AND product_id IS NULL AND deleted_at IS NULL AND is_active = 1
       LIMIT 1`
    )
    .get(customerId) as { nfe_number: string } | undefined;
  return fallback?.nfe_number ?? null;
}

/**
 * Grava (ou substitui) a nota de entrega futura do par (cliente, produto). Regravar o
 * mesmo par atualiza o numero em vez de criar uma segunda linha — os indices unicos
 * parciais da migracao 52 nao permitiriam duas notas vigentes para o mesmo par.
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
  const timestamp = now.toISOString();
  const existing = (
    productId
      ? database
          .prepare(
            `SELECT id FROM customer_future_billing_invoices
             WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL LIMIT 1`
          )
          .get(input.customerId, productId)
      : database
          .prepare(
            `SELECT id FROM customer_future_billing_invoices
             WHERE customer_id = ? AND product_id IS NULL AND deleted_at IS NULL LIMIT 1`
          )
          .get(input.customerId)
  ) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  if (existing) {
    database
      .prepare(
        `UPDATE customer_future_billing_invoices
         SET nfe_number = ?, is_active = 1, updated_at = ?
         WHERE id = ?`
      )
      .run(nfeNumber, timestamp, id);
  } else {
    database
      .prepare(
        `INSERT INTO customer_future_billing_invoices (
           id, customer_id, product_id, nfe_number, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, input.customerId, productId, nfeNumber, timestamp, timestamp);
  }

  return getCustomerFutureBillingInvoices(database, input.customerId).find((i) => i.id === id)!;
}

/**
 * Encerra a entrega futura daquele par. Soft delete (como o resto do cadastro), para a
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
