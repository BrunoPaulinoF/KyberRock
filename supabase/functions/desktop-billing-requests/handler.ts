/**
 * `desktop-billing-requests` — a balanca pega e devolve os pedidos de faturamento do site.
 *
 * Ver migracao `202609220004` e `_shared/billing-requests.ts`. Duas acoes, autenticadas por
 * dispositivo como toda funcao da balanca (`deviceId` + `deviceToken`):
 *
 *  - `claim`: pega ate N pedidos `pending` da UNIDADE do dispositivo e os marca `processing`
 *    com o id de quem pegou. Com mais de uma balanca na unidade, a marcacao condicional
 *    (`status = 'pending'`) garante que cada pedido vai para uma so. Pedido `processing` ha
 *    mais de 15 min sem resposta (balanca fechou no meio) volta para `pending` antes.
 *  - `report`: devolve o resultado de cada pedido que ESTE dispositivo pegou.
 *
 * A parte pura e testavel esta aqui; `index.ts` liga ao Supabase.
 */

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";
import { isReadUnavailable, type PostgrestLikeError } from "../_shared/db-read-error.ts";
import { isStaleClaim } from "../_shared/billing-requests.ts";

export interface DeviceRow {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
}

export interface BillingRequestRow {
  id: string;
  operation_id: string;
  status: string;
  claimed_at?: string | null;
}

export interface BillingRequestStore {
  getDevice(
    deviceId: string
  ): Promise<{ data: DeviceRow | null; error: PostgrestLikeError | null }>;
  /** Pedidos `pending` da unidade, dos mais antigos para os mais novos. */
  listPending(unitId: string, limit: number): Promise<BillingRequestRow[]>;
  /** Pedidos `processing` da unidade (para devolver os abandonados). */
  listProcessing(unitId: string): Promise<BillingRequestRow[]>;
  /** Marca `processing` so os que ainda estao `pending`; devolve os que de fato pegou. */
  claim(ids: string[], deviceId: string, nowIso: string): Promise<BillingRequestRow[]>;
  /** Devolve pedidos abandonados para `pending`. */
  release(ids: string[], nowIso: string): Promise<void>;
  /** Grava o resultado de um pedido que este dispositivo pegou. */
  report(
    id: string,
    deviceId: string,
    outcome: { status: "done" | "failed"; message: string },
    nowIso: string
  ): Promise<void>;
}

export interface BillingRequestsDependencies {
  store: BillingRequestStore;
  now?: () => Date;
}

const MAX_CLAIM = 20;

type RequestBody = {
  deviceId?: unknown;
  deviceToken?: unknown;
  action?: unknown;
  limit?: unknown;
  results?: unknown;
};

export async function handleBillingRequests(
  req: Request,
  deps: BillingRequestsDependencies
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
  if (error || !device?.is_active)
    return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
  if (!safeEqual(await sha256Hex(deviceToken), device.token_hash)) {
    return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
  }

  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();

  try {
    if (body.action === "claim") {
      const limitRaw = Number(body.limit ?? MAX_CLAIM);
      const limit =
        Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_CLAIM) : MAX_CLAIM;

      const stale = (await deps.store.listProcessing(device.unit_id)).filter((row) =>
        isStaleClaim(row.claimed_at, now)
      );
      if (stale.length > 0) {
        await deps.store.release(
          stale.map((row) => row.id),
          nowIso
        );
      }

      const pending = await deps.store.listPending(device.unit_id, limit);
      if (pending.length === 0) return jsonResponse({ ok: true, requests: [] });
      const claimed = await deps.store.claim(
        pending.map((row) => row.id),
        device.id,
        nowIso
      );
      return jsonResponse({
        ok: true,
        requests: claimed.map((row) => ({ id: row.id, operationId: row.operation_id }))
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
          { status, message: String(item?.message ?? "").slice(0, 2000) },
          nowIso
        );
        reported++;
      }
      return jsonResponse({ ok: true, reported });
    }

    return jsonResponse({ error: "Acao desconhecida" }, 400);
  } catch (caught) {
    console.error("desktop-billing-requests falhou", { action: body.action, error: caught });
    return jsonResponse(
      { error: caught instanceof Error ? caught.message : "Erro inesperado" },
      500
    );
  }
}
