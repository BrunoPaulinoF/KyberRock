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
  "Troca a cada 45 segundos. Peça ao comercial a senha que está na tela dele agora.";

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

/**
 * Balanca liberada sem a senha (acao `set_price_unlock`, `_shared/price-unlock.ts` na nuvem): o
 * comercial escolhe um tempo ou "sem prazo", e as balancas da pedreira param de pedir a senha ate
 * vencer ou ate ele voltar a pedir. So a balanca: no site a senha continua sendo pedida.
 */
export interface PriceUnlock {
  indefinite: boolean;
  /** ISO de quando volta a pedir senha (hora da nuvem); `null` quando e sem prazo. */
  until: string | null;
  byName: string | null;
  at: string | null;
}

/** Os tempos da tela. `minutes: null` e "sem prazo". */
export const PRICE_UNLOCK_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  minutes: number | null;
}> = [
  { value: "15", label: "15 minutos", minutes: 15 },
  { value: "30", label: "30 minutos", minutes: 30 },
  { value: "60", label: "1 hora", minutes: 60 },
  { value: "120", label: "2 horas", minutes: 120 },
  { value: "240", label: "4 horas", minutes: 240 },
  { value: "480", label: "8 horas", minutes: 480 },
  { value: "indefinite", label: "Sem prazo (até eu tirar)", minutes: null }
];

/**
 * A liberacao que veio da `web-api`. `undefined` quando a resposta nao tem o campo (a nuvem ainda
 * nao tem a tabela): a tela esconde a opcao. `null` e "a balanca pede senha".
 */
export function readPriceUnlock(value: unknown): PriceUnlock | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);
  if (raw.indefinite === true) {
    return { indefinite: true, until: null, byName: text("byName"), at: text("at") };
  }
  const until = text("until");
  if (!until || !Number.isFinite(Date.parse(until))) return null;
  return { indefinite: false, until, byName: text("byName"), at: text("at") };
}

/** Ainda liberada agora? (o prazo pelo relogio da nuvem, como o codigo). */
export function isUnlockActive(
  unlock: PriceUnlock | null | undefined,
  nowMs: number,
  clockOffsetMs = 0
): unlock is PriceUnlock {
  if (!unlock) return false;
  if (unlock.indefinite) return true;
  return Date.parse(unlock.until ?? "") > nowMs + clockOffsetMs;
}

/** "faltam 25 min" / "falta 1 h 05 min": o que sobra da liberacao com prazo. */
export function unlockTimeLeft(untilIso: string, nowMs: number, clockOffsetMs = 0): string {
  const leftMs = Date.parse(untilIso) - (nowMs + clockOffsetMs);
  // Arredonda (e nao para cima): logo depois de liberar por 30 min, a tela diz 30, nao 31.
  const minutes = Math.max(1, Math.round(leftMs / 60_000));
  if (minutes < 60) return `${minutes === 1 ? "falta" : "faltam"} ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = `${hours} h`;
  const label = rest ? `${hoursText} ${String(rest).padStart(2, "0")} min` : hoursText;
  return `${hours === 1 && !rest ? "falta" : "faltam"} ${label}`;
}
