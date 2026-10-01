/**
 * Senha rotativa de preco na balanca.
 *
 * A senha que libera mudar preco (e as outras acoes protegidas: limpar historico, liberar o
 * relatorio financeiro) deixou de ser fixa: e um codigo de 6 digitos que troca a cada 45 s e que
 * so o comercial ve, na tela "Senha de preco" do site. Codigo vencido nao vale mais.
 *
 * O codigo sai de uma chave da pedreira e do relogio (HOTP da RFC 4226). A chave chega pelo
 * `desktop-status` (o ping de 30 s que ja existia) e fica no `local_settings`: e isso que deixa a
 * balanca conferir o codigo SEM internet. Junto vai a hora da nuvem, e a diferenca para o relogio
 * deste computador fica guardada — balanca com o relogio errado ainda confere o codigo certo,
 * porque o site conta os 45 s pelo relogio da nuvem.
 *
 * A mesma conta vive na nuvem (`supabase/functions/_shared/price-code.ts`, com WebCrypto). Os
 * dois testes batem nos mesmos valores da RFC: se divergirem, o codigo que o comercial le nao
 * abre a balanca.
 */

import { createHmac } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import { realNowMs } from "./cloud-clock.js";
import { readLocalSetting, readStringLocalSetting, writeLocalSetting } from "./local-settings.js";

/** Quanto tempo cada codigo vale. */
export const PRICE_CODE_PERIOD_SECONDS = 45;
/** Tamanho do codigo. */
export const PRICE_CODE_DIGITS = 6;

const PERIOD_MS = PRICE_CODE_PERIOD_SECONDS * 1000;
const SECRET_SETTING = "price_code_secret";
const CLOCK_OFFSET_SETTING = "price_code_clock_offset_ms";
const UNLOCK_SETTING = "price_unlock";

/** Numero da janela de 45 s em que `nowMs` cai (o contador do HOTP). */
export function priceCodeStep(nowMs: number): number {
  return Math.floor(nowMs / PERIOD_MS);
}

export function isUsablePriceCodeSecret(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 16;
}

/** Codigo de uma janela especifica (HOTP da RFC 4226 com `PRICE_CODE_DIGITS` digitos). */
export function priceCodeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", Buffer.from(secret, "utf8")).update(counter).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    (hash[offset + 1] << 16) |
    (hash[offset + 2] << 8) |
    hash[offset + 3];
  return String(binary % 10 ** PRICE_CODE_DIGITS).padStart(PRICE_CODE_DIGITS, "0");
}

/** So o codigo da janela ATUAL vale: o vencido e recusado, sem tolerancia. */
export function verifyPriceCode(secret: string, typed: string, nowMs: number): boolean {
  const clean = typed.replace(/\s+/g, "");
  if (!/^\d+$/.test(clean) || clean.length !== PRICE_CODE_DIGITS) return false;
  const expected = priceCodeForStep(secret, priceCodeStep(nowMs));
  let diff = 0;
  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ clean.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Guarda o que o `desktop-status` mandou. Chave ausente e "nuvem antiga" (ou migracao pendente):
 * o que ja estava gravado continua valendo. `serverTime` e a hora da nuvem na resposta, e
 * `receivedAtMs` a deste computador quando ela chegou.
 */
export function applyPriceCodeFromCloud(
  database: DesktopDatabase,
  input: { secret: unknown; serverTime?: string | null; receivedAtMs: number }
): void {
  if (!isUsablePriceCodeSecret(input.secret)) return;
  if (readStringLocalSetting(database, SECRET_SETTING) !== input.secret) {
    writeLocalSetting(database, SECRET_SETTING, input.secret);
  }
  const serverMs = input.serverTime ? Date.parse(input.serverTime) : Number.NaN;
  if (Number.isFinite(serverMs)) {
    writeLocalSetting(database, CLOCK_OFFSET_SETTING, Math.round(serverMs - input.receivedAtMs));
  }
}

/**
 * Confere a senha digitada contra o codigo rotativo. `null` quando esta balanca ainda nao
 * recebeu a chave (nunca falou com a nuvem depois da atualizacao): quem chama decide o que fazer.
 */
export function verifyStoredPriceCode(
  database: DesktopDatabase,
  typed: string,
  // Relogio REAL: o deslocamento da nuvem e somado aqui embaixo, e o `Date` do processo ja
  // vem corrigido (`cloud-clock.ts`) — somar sobre ele corrigiria duas vezes.
  nowMs: number = realNowMs()
): boolean | null {
  const secret = readStringLocalSetting(database, SECRET_SETTING);
  if (!isUsablePriceCodeSecret(secret)) return null;
  return verifyPriceCode(secret, typed, nowMs + readClockOffsetMs(database));
}

/**
 * Liberacao sem senha que o comercial deu no site (tela "Senha de preco",
 * `supabase/functions/_shared/price-unlock.ts`): por um tempo (`until`) ou sem prazo.
 */
export interface PriceUnlockStatus {
  indefinite: boolean;
  /** ISO de quando volta a pedir senha (hora da nuvem); `null` quando e sem prazo. */
  until: string | null;
}

function readClockOffsetMs(database: DesktopDatabase): number {
  const offset = readLocalSetting<unknown>(database, CLOCK_OFFSET_SETTING);
  return typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
}

/**
 * Guarda a liberacao que o `desktop-status` mandou. `undefined` e "nuvem antiga" (ou migracao
 * pendente): o que ja estava gravado continua valendo. `null` e "pede senha" — e o que desfaz a
 * liberacao quando o comercial tira.
 */
export function applyPriceUnlockFromCloud(database: DesktopDatabase, unlock: unknown): void {
  if (unlock === undefined) return;
  let next: PriceUnlockStatus | null = null;
  if (unlock && typeof unlock === "object") {
    const value = unlock as { indefinite?: unknown; until?: unknown };
    if (value.indefinite === true) {
      next = { indefinite: true, until: null };
    } else if (typeof value.until === "string" && Number.isFinite(Date.parse(value.until))) {
      next = { indefinite: false, until: value.until };
    }
  }
  // O ping e de 30 s: so grava quando mudou, como a chave.
  const current = readLocalSetting<unknown>(database, UNLOCK_SETTING);
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    writeLocalSetting(database, UNLOCK_SETTING, next);
  }
}

/**
 * A liberacao em vigor agora, ou `null` (pede senha). O prazo e conferido aqui, pelo relogio da
 * nuvem: liberacao por 30 min vence na hora certa mesmo com a balanca sem internet.
 */
export function readPriceUnlock(
  database: DesktopDatabase,
  // Relogio REAL, pelo mesmo motivo de `verifyStoredPriceCode`.
  nowMs: number = realNowMs()
): PriceUnlockStatus | null {
  const stored = readLocalSetting<unknown>(database, UNLOCK_SETTING);
  if (!stored || typeof stored !== "object") return null;
  const value = stored as { indefinite?: unknown; until?: unknown };
  if (value.indefinite === true) return { indefinite: true, until: null };
  if (typeof value.until !== "string") return null;
  const untilMs = Date.parse(value.until);
  if (!Number.isFinite(untilMs) || untilMs <= nowMs + readClockOffsetMs(database)) return null;
  return { indefinite: false, until: value.until };
}
