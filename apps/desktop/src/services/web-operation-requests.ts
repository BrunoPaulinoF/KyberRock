import type { WeighingOperationSummary } from "./weighing-operations.js";

/**
 * Executa os pedidos de pesagem que o site deixou na nuvem (`operation_requests`).
 *
 * O site nao pesa: ele pede, e ESTA balanca — a marcada no painel como executora da unidade —
 * registra pelas mesmas funcoes dos botoes do desktop (preco, frete, credito, pedido do OMIE,
 * fila do carregador, numero da pesagem) e imprime o cupom do fechamento na impressora dela.
 * Ver a migracao `202609250001_web_operation_requests` e `docs/web-api.md`.
 *
 * Este modulo e a parte pura: quem fala com a nuvem e quem executa entram por parametro, entao
 * "o que devolver para o site" e testavel sem OMIE, Supabase nem impressora.
 */

export const WEB_OPERATION_KINDS = ["entry", "exit", "update", "cancel", "reprint"] as const;
export type WebOperationKind = (typeof WEB_OPERATION_KINDS)[number];

export interface WebOperationClaim {
  id: string;
  kind: WebOperationKind;
  operationId: string;
  payload: Record<string, unknown>;
  requestedByName: string | null;
}

export type WebOperationPrintStatus = "printed" | "failed" | "skipped";

export interface WebOperationOutcome {
  id: string;
  status: "done" | "failed";
  message: string;
  result: Record<string, unknown> | null;
  printStatus: WebOperationPrintStatus | null;
  printMessage: string | null;
}

/** O que a execucao de um pedido devolve para virar o resultado do site. */
export interface WebOperationExecution {
  message: string;
  operation: WeighingOperationSummary | null;
  print?: { status: WebOperationPrintStatus; message: string | null };
}

export function isWebOperationKind(value: unknown): value is WebOperationKind {
  return typeof value === "string" && (WEB_OPERATION_KINDS as readonly string[]).includes(value);
}

/** Le a resposta do `claim`, descartando o que nao for pedido valido. */
export function parseWebOperationClaims(rows: unknown): WebOperationClaim[] {
  if (!Array.isArray(rows)) return [];
  const claims: WebOperationClaim[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    if (typeof row?.id !== "string" || typeof row?.operationId !== "string") continue;
    if (!isWebOperationKind(row.kind)) continue;
    claims.push({
      id: row.id,
      kind: row.kind,
      operationId: row.operationId,
      payload:
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {},
      requestedByName: typeof row.requestedByName === "string" ? row.requestedByName : null
    });
  }
  return claims;
}

/**
 * O resumo da pesagem que volta para o site — o suficiente para mostrar "Pesagem 12.345,
 * liquido 25.120 kg, R$ 1.632,80" sem esperar o push da operacao.
 */
export function summarizeForWeb(operation: WeighingOperationSummary): Record<string, unknown> {
  return {
    operationId: operation.id,
    operationCode: operation.operationCode,
    status: operation.status,
    operationType: operation.operationType,
    plate: operation.plate,
    customerName: operation.customerName,
    productDescription: operation.productDescription,
    driverName: operation.driverName,
    carrierName: operation.carrierName,
    entryWeightKg: operation.entryWeightKg,
    exitWeightKg: operation.exitWeightKg,
    netWeightKg: operation.netWeightKg,
    unitPriceCents: operation.unitPriceCents,
    productTotalCents: operation.productTotalCents,
    freightTotalCents: operation.freightTotalCents,
    totalCents: operation.totalCents
  };
}

export function outcomeFromExecution(
  claim: WebOperationClaim,
  execution: WebOperationExecution
): WebOperationOutcome {
  return {
    id: claim.id,
    status: "done",
    message: execution.message,
    result: execution.operation ? summarizeForWeb(execution.operation) : null,
    printStatus: execution.print?.status ?? null,
    printMessage: execution.print?.message ?? null
  };
}

/** Falha (cadastro incompleto, sem preco, placa ja no patio...) volta com a mensagem do desktop. */
export function outcomeFromError(claim: WebOperationClaim, error: unknown): WebOperationOutcome {
  return {
    id: claim.id,
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
    result: null,
    printStatus: null,
    printMessage: null
  };
}

export interface RunWebOperationRequestsDependencies {
  claim: () => Promise<{ executor: boolean; claims: WebOperationClaim[] }>;
  execute: (claim: WebOperationClaim) => Promise<WebOperationExecution>;
  report: (outcomes: WebOperationOutcome[]) => Promise<void>;
}

export interface RunWebOperationRequestsResult {
  executor: boolean;
  claimed: number;
  done: number;
  failed: number;
}

/**
 * Pega os pedidos e executa UM POR VEZ, na ordem de chegada (a entrada de um caminhao antes do
 * fechamento dele). Cada resultado sobe assim que sai: quem esta no site ve "pronto" da
 * pesagem dele sem esperar as outras do lote. Se o envio do resultado falhar, o pedido volta
 * para a fila em 5 min pelo lado da nuvem e a segunda execucao e segura (a entrada ja tem o
 * id; fechar/cancelar de novo e reconhecido como ja feito).
 */
export async function runWebOperationRequests(
  deps: RunWebOperationRequestsDependencies
): Promise<RunWebOperationRequestsResult> {
  const { executor, claims } = await deps.claim();
  const result: RunWebOperationRequestsResult = {
    executor,
    claimed: claims.length,
    done: 0,
    failed: 0
  };
  for (const claim of claims) {
    let outcome: WebOperationOutcome;
    try {
      outcome = outcomeFromExecution(claim, await deps.execute(claim));
    } catch (error) {
      outcome = outcomeFromError(claim, error);
    }
    if (outcome.status === "done") result.done++;
    else result.failed++;
    await deps.report([outcome]);
  }
  return result;
}

/** Monta a mensagem do cupom a partir do que a impressao devolveu. */
export function printOutcome(receipt: { status: string; errorMessage?: string | null }): {
  status: WebOperationPrintStatus;
  message: string | null;
} {
  if (receipt.status === "printed") return { status: "printed", message: null };
  return {
    status: "failed",
    message: receipt.errorMessage?.trim() || "A impressora nao confirmou a impressao."
  };
}
