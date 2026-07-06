import { computeCreditInvoiceSchedule, type CreditClosingConfig } from "./credit-invoice.js";

/**
 * Consolidacao do fechamento do credito do cliente (fiado) em uma unica fatura.
 *
 * Regra da reuniao (06/07): o fiado deve ser lancado UMA UNICA VEZ no OMIE, pela
 * conta OMIE Cash (nao mais uma por operacao pela caixinha). Este modulo monta o
 * rascunho da fatura do periodo (soma das operacoes) com uma chave idempotente
 * deterministica, de modo que reenvios nao dupliquem o pedido no OMIE.
 *
 * O envio efetivo ao OMIE (mapeando este rascunho para o pedido de venda) e o
 * disparo do fechamento no periodo sao passos de integracao a parte.
 */

/** Codigo da conta pela qual a fatura de fiado e lancada no OMIE. */
export const FIADO_INVOICE_ACCOUNT_CODE = "omie_cash";

export interface FiadoOperationLine {
  operationId: string;
  amountCents: number;
}

export interface FiadoInvoiceDraft {
  customerId: string;
  /** Data de fechamento da fatura (YYYY-MM-DD). */
  closingDate: string;
  /** Data de vencimento do boleto (YYYY-MM-DD). */
  dueDate: string;
  /** Valor total consolidado do periodo, em centavos. */
  totalCents: number;
  /** Operacoes incluidas nesta fatura. */
  operationIds: string[];
  /** Conta pela qual a fatura e lancada no OMIE (OMIE Cash). */
  accountCode: string;
  /** Chave idempotente: garante um unico lancamento no OMIE por fechamento. */
  idempotencyKey: string;
}

/**
 * Monta a chave idempotente da fatura de fiado. O mesmo cliente + data de
 * fechamento sempre gera a mesma chave, garantindo um unico pedido no OMIE.
 */
export function buildFiadoInvoiceIdempotencyKey(
  unitId: string,
  customerId: string,
  closingDate: string
): string {
  return `kyberrock:${unitId}:fiado_${customerId}_${closingDate}:create_sales_order`;
}

export interface BuildFiadoInvoiceInput {
  unitId: string;
  customerId: string;
  closingConfig: CreditClosingConfig;
  operations: FiadoOperationLine[];
  /** Data de referencia dentro do periodo (ex.: uma das operacoes). */
  referenceDate: Date;
}

/**
 * Consolida as operacoes de credito de um periodo em uma unica fatura, com a
 * data de fechamento/vencimento derivada da periodicidade do cliente.
 */
export function buildFiadoInvoiceDraft(input: BuildFiadoInvoiceInput): FiadoInvoiceDraft {
  if (input.operations.length === 0) {
    throw new Error("Nenhuma operacao de credito para faturar no periodo.");
  }
  for (const operation of input.operations) {
    if (!Number.isInteger(operation.amountCents) || operation.amountCents < 0) {
      throw new Error(`Valor invalido na operacao ${operation.operationId}.`);
    }
  }

  const schedule = computeCreditInvoiceSchedule(input.closingConfig, input.referenceDate);
  const totalCents = input.operations.reduce((sum, operation) => sum + operation.amountCents, 0);

  return {
    customerId: input.customerId,
    closingDate: schedule.closingDate,
    dueDate: schedule.dueDate,
    totalCents,
    operationIds: input.operations.map((operation) => operation.operationId),
    accountCode: FIADO_INVOICE_ACCOUNT_CODE,
    idempotencyKey: buildFiadoInvoiceIdempotencyKey(
      input.unitId,
      input.customerId,
      schedule.closingDate
    )
  };
}
