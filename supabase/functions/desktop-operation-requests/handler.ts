/**
 * `desktop-operation-requests` — a balanca executora pega e devolve os pedidos de pesagem do
 * site.
 *
 * Ver migracao `202609250001` e `_shared/operation-requests.ts`. Mesmo desenho do
 * `desktop-billing-requests`, autenticado por dispositivo (`deviceId` + `deviceToken`):
 *
 *  - `claim`: so a balanca marcada como executora da unidade (`executes_web_operations`) pega
 *    pedidos — as outras recebem `executor: false` e deixam de perguntar. Cada pergunta carimba
 *    `web_executor_seen_at` (no maximo a cada 20 s): e por ele que o site mostra "conectada".
 *    Pedido `processing` ha mais de 5 min sem resposta volta para `pending` antes.
 *  - `report`: devolve o resultado de cada pedido que ESTE dispositivo pegou.
 *
 * A parte pura e testavel esta aqui; `index.ts` liga ao Supabase.
 */

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";
import { isReadUnavailable, type PostgrestLikeError } from "../_shared/db-read-error.ts";
import { isStaleOperationClaim, shouldTouchExecutor } from "../_shared/operation-requests.ts";

export interface DeviceRow {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
  executes_web_operations?: boolean | null;
  web_executor_seen_at?: string | null;
}

export interface OperationRequestRow {
  id: string;
  kind: string;
  operation_id: string;
  payload: unknown;
  requested_by_name?: string | null;
  status: string;
  claimed_at?: string | null;
}

export interface OperationRequestOutcome {
  status: "done" | "failed";
  message: string;
  result: Record<string, unknown> | null;
  printStatus: "printed" | "failed" | "skipped" | null;
  printMessage: string | null;
}

export interface OperationRequestStore {
  getDevice(
    deviceId: string
  ): Promise<{ data: DeviceRow | null; error: PostgrestLikeError | null }>;
  touchExecutor(deviceId: string, nowIso: string): Promise<void>;
  listPending(unitId: string, limit: number): Promise<OperationRequestRow[]>;
  listProcessing(unitId: string): Promise<OperationRequestRow[]>;
  /** Marca `processing` so os que ainda estao `pending`; devolve os que de fato pegou. */
  claim(ids: string[], deviceId: string, nowIso: string): Promise<OperationRequestRow[]>;
  release(ids: string[], nowIso: string): Promise<void>;
  report(
    id: string,
    deviceId: string,
    outcome: OperationRequestOutcome,
    nowIso: string
  ): Promise<void>;
}

export interface OperationRequestsDependencies {
  store: OperationRequestStore;
  now?: () => Date;
}

/** Pesagem e uma de cada vez na balanca; lote pequeno mantem a fila andando em ordem. */
const MAX_CLAIM = 5;
const MAX_MESSAGE = 2000;

type RequestBody = {
  deviceId?: unknown;
  deviceToken?: unknown;
  action?: unknown;
  limit?: unknown;
  results?: unknown;
};

function printStatus(value: unknown): OperationRequestOutcome["printStatus"] {
  return value === "printed" || value === "failed" || value === "skipped" ? value : null;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function handleOperationRequests(
  req: Request,
  deps: OperationRequestsDependencies
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Corpo da requisicao invalido" }, 400);
  }

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");
  if (!deviceId || !deviceToken) {
    return jsonResponse({ error: "deviceId e deviceToken sao obrigatorios" }, 400);
  }

  const { data: device, error } = await deps.store.getDevice(deviceId);
  // Leitura que falhou nao e "nao autorizado" (ver `_shared/db-read-error.ts`).
  if (isReadUnavailable(error)) {
    return jsonResponse({ error: "Cadastro indisponivel no momento" }, 503);
  }
  if (error || !device?.is_active) {
    return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
  }
  if (!safeEqual(await sha256Hex(deviceToken), device.token_hash)) {
    return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
  }

  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();

  try {
    if (body.action === "claim") {
      // So a executora da unidade pega pedido: duas balancas pesando o mesmo pedido seriam
      // dois caminhoes no patio. As outras ficam sabendo e param de perguntar.
      if (device.executes_web_operations !== true) {
        return jsonResponse({ ok: true, executor: false, requests: [] });
      }
      if (shouldTouchExecutor(device.web_executor_seen_at, now)) {
        await deps.store.touchExecutor(device.id, nowIso);
      }

      const limitRaw = Number(body.limit ?? MAX_CLAIM);
      const limit =
        Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_CLAIM) : MAX_CLAIM;

      const stale = (await deps.store.listProcessing(device.unit_id)).filter((row) =>
        isStaleOperationClaim(row.claimed_at, now)
      );
      if (stale.length > 0) {
        await deps.store.release(
          stale.map((row) => row.id),
          nowIso
        );
      }

      const pending = await deps.store.listPending(device.unit_id, limit);
      if (pending.length === 0) return jsonResponse({ ok: true, executor: true, requests: [] });
      const claimed = await deps.store.claim(
        pending.map((row) => row.id),
        device.id,
        nowIso
      );
      // A ordem de chegada importa (a entrada antes do fechamento do mesmo caminhao): o update
      // condicional nao garante ordem, entao reordena pela lista pendente.
      const order = new Map(pending.map((row, index) => [row.id, index]));
      claimed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      return jsonResponse({
        ok: true,
        executor: true,
        requests: claimed.map((row) => ({
          id: row.id,
          kind: row.kind,
          operationId: row.operation_id,
          payload: plainObject(row.payload) ?? {},
          requestedByName: row.requested_by_name ?? null
        }))
      });
    }

    if (body.action === "report") {
      const results = Array.isArray(body.results) ? body.results : [];
      let reported = 0;
      for (const item of results as Array<Record<string, unknown>>) {
        const id = String(item?.id ?? "");
        const status =
          item?.status === "done" ? "done" : item?.status === "failed" ? "failed" : null;
        if (!id || !status) continue;
        await deps.store.report(
          id,
          device.id,
          {
            status,
            message: String(item?.message ?? "").slice(0, MAX_MESSAGE),
            result: plainObject(item?.result),
            printStatus: printStatus(item?.printStatus),
            printMessage:
              typeof item?.printMessage === "string"
                ? item.printMessage.slice(0, MAX_MESSAGE)
                : null
          },
          nowIso
        );
        reported++;
      }
      return jsonResponse({ ok: true, reported });
    }

    return jsonResponse({ error: "Acao desconhecida" }, 400);
  } catch (caught) {
    console.error("desktop-operation-requests falhou", { action: body.action, error: caught });
    return jsonResponse(
      { error: caught instanceof Error ? caught.message : "Erro inesperado" },
      500
    );
  }
}
