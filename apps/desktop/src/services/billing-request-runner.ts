import type { DesktopDatabase } from "../database/sqlite.js";
import { enqueueSyncJob } from "./sync-queue.js";

/**
 * Executa os pedidos de faturamento que o site deixou na nuvem (`billing_requests`).
 *
 * O site nao fatura: ele pede, e a balanca da unidade executa pelo MESMO caminho do botao
 * "Fazer fechamento" (`processFiscalBillingNow`) — e o unico lugar que sabe montar o pedido
 * do OMIE inteiro (parcelas, meio de pagamento, frete, adiantamento). Ver a migracao
 * `202609220004_billing_projection_and_requests` e `docs/web-api.md`.
 *
 * Roda no tique de 30 s da fila OMIE (`omie-queue-scheduler`). E puro de proposito: quem
 * fala com a nuvem e quem fatura entram por parametro, entao a regra de "o que devolver
 * para o site" e testavel sem OMIE nem Supabase.
 */

export interface BillingRequestClaim {
  id: string;
  operationId: string;
}

export interface BillingRequestOutcome {
  id: string;
  status: "done" | "failed";
  message: string;
}

/** O que `processFiscalBillingNow` devolve, reduzido ao que decide o resultado do pedido. */
export interface BillingAttemptResult {
  billed: boolean;
  blocked?: boolean;
  blockReason?: string | null;
  alreadyBilledInOmie?: boolean;
  billingStatusMessage: string | null;
}

export function outcomeFromBilling(
  claim: BillingRequestClaim,
  result: BillingAttemptResult
): BillingRequestOutcome {
  if (result.billed) {
    return {
      id: claim.id,
      status: "done",
      message:
        result.billingStatusMessage ??
        (result.alreadyBilledInOmie ? "Ja estava faturada no OMIE." : "Faturada no OMIE.")
    };
  }
  return {
    id: claim.id,
    status: "failed",
    message:
      result.blockReason ??
      result.billingStatusMessage ??
      "O OMIE nao confirmou o faturamento. Tente novamente em instantes."
  };
}

/** Falha inesperada (excecao) vira resultado `failed` com a mensagem — nunca some da fila. */
export function outcomeFromError(
  claim: BillingRequestClaim,
  error: unknown
): BillingRequestOutcome {
  return {
    id: claim.id,
    status: "failed",
    message: error instanceof Error ? error.message : String(error)
  };
}

export interface RunBillingRequestsDependencies {
  claim: () => Promise<BillingRequestClaim[]>;
  bill: (operationId: string) => Promise<BillingAttemptResult>;
  report: (outcomes: BillingRequestOutcome[]) => Promise<void>;
  /** Depois de faturar, a operacao precisa subir com o status novo (ver `enqueueBillingCloudPush`). */
  afterBilled?: (operationId: string) => void;
}

export interface RunBillingRequestsResult {
  claimed: number;
  done: number;
  failed: number;
}

export async function runBillingRequests(
  deps: RunBillingRequestsDependencies
): Promise<RunBillingRequestsResult> {
  const claims = await deps.claim();
  const result: RunBillingRequestsResult = { claimed: claims.length, done: 0, failed: 0 };
  if (claims.length === 0) return result;

  const outcomes: BillingRequestOutcome[] = [];
  for (const claim of claims) {
    let outcome: BillingRequestOutcome;
    try {
      outcome = outcomeFromBilling(claim, await deps.bill(claim.operationId));
    } catch (error) {
      outcome = outcomeFromError(claim, error);
    }
    // O status local mudou (billed, cadastro_incompleto, failed...): sobe de qualquer jeito,
    // porque e por ele que a tela do site sabe o que aconteceu com a pesagem.
    deps.afterBilled?.(claim.operationId);
    outcomes.push(outcome);
    if (outcome.status === "done") result.done++;
    else result.failed++;
  }

  // Um relatorio so, no fim: se a balanca cair no meio, o pedido volta para a fila em 15 min
  // pelo lado da nuvem (`isStaleClaim`) e a pesagem ja faturada e pulada pela idempotencia.
  await deps.report(outcomes);
  return result;
}

/**
 * Enfileira o push da operacao para a nuvem depois do faturamento: `processFiscalBillingNow`
 * grava `omie_billing_status`/`omie_invoice_number` no SQLite e nao enfileira nada — ate aqui
 * ninguem fora da balanca precisava saber. Mesmo desenho de `enqueueWalletCloudPush`.
 */
export function enqueueBillingCloudPush(
  database: DesktopDatabase,
  operationId: string,
  now: Date = new Date()
): void {
  enqueueSyncJob(
    database,
    {
      target: "cloud",
      action: "upsert_operation",
      entityType: "operation",
      entityId: operationId,
      idempotencyKey: `cloud:operation:${operationId}:billing:${now.toISOString()}`,
      payload: { operationId }
    },
    now
  );
}
