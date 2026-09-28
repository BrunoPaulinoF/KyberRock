/**
 * Senha rotativa de preco na tela do comercial ("Senha de preco").
 *
 * Quem calcula o codigo e a `web-api` (acao `price_code`): a chave da pedreira nunca chega ao
 * navegador. A resposta traz o codigo, quando ele vence e a hora da nuvem; a tela conta os
 * segundos pelo relogio DA NUVEM (corrigindo o deste computador pela diferenca), porque e por
 * ele que a balanca e a `web-api` decidem se o codigo ainda vale.
 */

/** A senha e o codigo rotativo que so o comercial ve (tela "Senha de preco", `lib/price-code.ts`). */
export const PRICE_CODE_HINT =
  "Troca a cada 45 segundos. Peca ao comercial a senha que esta na tela dele agora.";

export interface PriceCodeResponse {
  code: string;
  expiresAt: string;
  periodSeconds: number;
  serverTime: string;
}

export interface PriceCodeState {
  code: string;
  /** Vencimento, em ms desde 1970, no relogio da nuvem. */
  expiresAtMs: number;
  periodSeconds: number;
  /** Quanto somar ao relogio deste computador para chegar ao da nuvem. */
  clockOffsetMs: number;
}

/** Le a resposta da `web-api`; `null` quando ela veio incompleta. */
export function readPriceCode(
  response: Partial<PriceCodeResponse> | null | undefined,
  receivedAtMs: number
): PriceCodeState | null {
  if (!response || typeof response.code !== "string" || !/^\d+$/.test(response.code)) return null;
  const expiresAtMs = Date.parse(String(response.expiresAt ?? ""));
  if (!Number.isFinite(expiresAtMs)) return null;
  const serverMs = Date.parse(String(response.serverTime ?? ""));
  return {
    code: response.code,
    expiresAtMs,
    periodSeconds:
      typeof response.periodSeconds === "number" && response.periodSeconds > 0
        ? response.periodSeconds
        : 45,
    clockOffsetMs: Number.isFinite(serverMs) ? serverMs - receivedAtMs : 0
  };
}

/** Segundos que faltam para o codigo trocar (arredondado para cima, nunca negativo). */
export function secondsLeft(state: PriceCodeState, nowMs: number): number {
  const left = state.expiresAtMs - (nowMs + state.clockOffsetMs);
  return left <= 0 ? 0 : Math.ceil(left / 1000);
}

/** "123456" vira "123 456": mais facil de ler em voz alta ou por telefone. */
export function formatPriceCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
