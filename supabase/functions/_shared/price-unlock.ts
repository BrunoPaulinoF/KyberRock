/**
 * Balanca liberada sem a senha de preco (migracao `202610010001_liberar_balanca_sem_senha`).
 *
 * O comercial, na tela "Senha de preco" do site, pode liberar as balancas da pedreira por um
 * tempo ou sem prazo: enquanto liberadas, elas fazem sem senha o que a senha rotativa protege
 * (`_shared/price-code.ts`). Cada mudanca e uma linha em `price_unlocks`; vale a mais recente.
 *
 * O `desktop-status` manda o estado JA CONFERIDO contra a hora da nuvem (`null` = pede senha), e a
 * balanca guarda e confere o prazo sozinha, sem internet (`apps/desktop/src/services/price-code.ts`):
 * liberacao com prazo vence na hora certa mesmo com a balanca offline. A sem prazo so acaba quando
 * a balanca fala com a nuvem de novo — e o que o comercial escolheu.
 */

/** Tempos que a tela oferece. O servidor aceita qualquer valor entre 1 min e o maximo. */
export const PRICE_UNLOCK_MAX_MINUTES = 24 * 60;

/** A liberacao em vigor, como vai para a tela e para a balanca. */
export interface PriceUnlock {
  indefinite: boolean;
  /** ISO de quando volta a pedir senha; `null` quando e sem prazo. */
  until: string | null;
  /** Quem liberou (nome do login do site). */
  byName: string | null;
  /** Quando liberou (ISO). */
  at: string | null;
}

/** O que o comercial pediu: liberar por X minutos, sem prazo, ou voltar a pedir senha. */
export type PriceUnlockRequest =
  | { mode: "minutes"; minutes: number }
  | { mode: "indefinite" }
  | { mode: "off" };

/**
 * A liberacao que a linha mais recente de `price_unlocks` diz estar valendo AGORA, ou `null`
 * quando a balanca deve pedir senha (linha de "pedir senha", prazo vencido, nenhuma linha).
 */
export function activePriceUnlock(
  row: Record<string, unknown> | null | undefined,
  nowMs: number
): PriceUnlock | null {
  if (!row) return null;
  const byName = typeof row.created_by_name === "string" ? row.created_by_name : null;
  const at = typeof row.created_at === "string" ? row.created_at : null;
  if (row.indefinite === true) return { indefinite: true, until: null, byName, at };
  const untilMs = Date.parse(String(row.unlocked_until ?? ""));
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) return null;
  return { indefinite: false, until: new Date(untilMs).toISOString(), byName, at };
}

/** Le o pedido do site; `null` quando ele nao faz sentido (a `web-api` responde 400). */
export function parsePriceUnlockRequest(
  payload: Record<string, unknown>
): PriceUnlockRequest | null {
  const mode = payload.mode;
  if (mode === "off") return { mode: "off" };
  if (mode === "indefinite") return { mode: "indefinite" };
  if (mode !== "minutes") return null;
  const minutes = Number(payload.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > PRICE_UNLOCK_MAX_MINUTES) return null;
  return { mode: "minutes", minutes };
}

/** A linha a gravar em `price_unlocks` para o pedido. */
export function priceUnlockRow(
  request: PriceUnlockRequest,
  input: { id: string; companyId: string; userId: string; userName: string; nowIso: string }
): Record<string, unknown> {
  return {
    id: input.id,
    company_id: input.companyId,
    indefinite: request.mode === "indefinite",
    unlocked_until:
      request.mode === "minutes"
        ? new Date(Date.parse(input.nowIso) + request.minutes * 60_000).toISOString()
        : null,
    created_by: input.userId,
    created_by_name: input.userName || null,
    created_at: input.nowIso
  };
}
