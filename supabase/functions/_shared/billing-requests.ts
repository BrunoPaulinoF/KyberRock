/**
 * Regras do pedido de faturamento feito pelo site (`billing_requests`).
 *
 * O site nao fatura: ele pede, e a balanca da unidade executa pelo mesmo caminho do botao
 * "Fazer fechamento" (ver migracao `202609220004`). O que vive aqui e a decisao PURA de
 * quais pesagens podem entrar num pedido — a mesma peneira de `runInvoiceClosing` no desktop:
 *
 *  - so venda com nota (`operation_type = 'invoice'`): a venda interna vira OS, nao NF-e;
 *  - so pesagem concluida — aberta ou cancelada nao tem o que faturar;
 *  - nunca quem ja tem nota (`omie_invoice_number`) ou ja esta `billed`: refaturar duplica
 *    a NF-e do cliente, que e problema fiscal, nao retrabalho;
 *  - nunca quem ja tem pedido na fila (`pending`/`processing`): dois pedidos para a mesma
 *    pesagem fariam a balanca tentar duas vezes.
 */

export const BILLING_REQUEST_STATUSES = ["pending", "processing", "done", "failed"] as const;
export type BillingRequestStatus = (typeof BILLING_REQUEST_STATUSES)[number];

/** Status de operacao que contam como "concluida" na nuvem (o desktop projeta `open` para as abertas). */
export const BILLABLE_OPERATION_STATUSES: ReadonlySet<string> = new Set([
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error"
]);

/** Depois de quanto tempo um pedido `processing` sem resposta volta para a fila. */
export const BILLING_REQUEST_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

export interface BillingCandidateOperation {
  id: string;
  operation_type?: unknown;
  status?: unknown;
  omie_billing_status?: unknown;
  omie_invoice_number?: unknown;
}

export interface OpenBillingRequest {
  operation_id: string;
  status: string;
}

export interface BillingRequestSelection {
  eligible: string[];
  skipped: Array<{ operationId: string; reason: string }>;
}

export function selectOperationsForBillingRequest(
  operations: readonly BillingCandidateOperation[],
  openRequests: readonly OpenBillingRequest[]
): BillingRequestSelection {
  const queued = new Set(
    openRequests
      .filter((request) => request.status === "pending" || request.status === "processing")
      .map((request) => request.operation_id)
  );
  const selection: BillingRequestSelection = { eligible: [], skipped: [] };
  const seen = new Set<string>();

  for (const operation of operations) {
    if (seen.has(operation.id)) continue;
    seen.add(operation.id);
    const skip = (reason: string) => selection.skipped.push({ operationId: operation.id, reason });

    if (operation.operation_type !== "invoice") {
      skip("Venda interna: gera ordem de servico, nao nota fiscal. Fora do fechamento.");
      continue;
    }
    if (operation.status === "cancelled") {
      skip("Pesagem cancelada.");
      continue;
    }
    if (!BILLABLE_OPERATION_STATUSES.has(String(operation.status ?? ""))) {
      skip("Pesagem ainda em andamento: so pesagem concluida entra no fechamento.");
      continue;
    }
    const invoiceNumber =
      typeof operation.omie_invoice_number === "string" ? operation.omie_invoice_number.trim() : "";
    if (invoiceNumber.length > 0 || operation.omie_billing_status === "billed") {
      skip(
        invoiceNumber.length > 0 ? `Ja faturada: NF-e ${invoiceNumber}.` : "Ja faturada no OMIE."
      );
      continue;
    }
    if (queued.has(operation.id)) {
      skip("Ja existe um pedido de faturamento em andamento para esta pesagem.");
      continue;
    }
    selection.eligible.push(operation.id);
  }

  return selection;
}

/** Um pedido `processing` ha mais tempo que o limite foi abandonado (balanca fechou no meio). */
export function isStaleClaim(claimedAt: string | null | undefined, now: Date): boolean {
  if (!claimedAt) return true;
  const parsed = Date.parse(claimedAt);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed > BILLING_REQUEST_CLAIM_TIMEOUT_MS;
}
