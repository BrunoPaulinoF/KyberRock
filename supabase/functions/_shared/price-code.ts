/**
 * Senha rotativa de preco (migracao `202609280001_senha_rotativa_de_preco`).
 *
 * A senha que libera mudar preco (e as outras acoes protegidas da balanca) deixou de ser fixa
 * (`companies.price_change_password`, o famoso "0000"): agora e um codigo de 6 digitos que troca
 * a cada 45 segundos, como o token do banco. Quem VE o codigo e o comercial (tela "Senha de
 * preco" do site, acao `price_code` da `web-api`); quem pede e quem esta na balanca ou no site
 * com outro perfil. Codigo vencido nao vale mais.
 *
 * O codigo sai de uma chave secreta por pedreira (`company_price_codes.secret`, so a chave de
 * servico le) e do relogio: e o HOTP da RFC 4226 (HMAC-SHA1 + truncamento dinamico) com o
 * contador = numero da janela de 45 s desde 1970. Nada e gravado por codigo — e isso que deixa
 * a balanca conferir SEM internet, com a mesma chave (recebida no `desktop-status`) e o proprio
 * relogio corrigido pelo da nuvem.
 *
 * A MESMA conta vive no desktop (`apps/desktop/src/services/price-code.ts`, com `node:crypto`)
 * e os dois testes batem nos mesmos valores da RFC. Mudou aqui, mude la: se divergirem, o
 * codigo que o comercial le nao abre a balanca.
 */

/** Quanto tempo cada codigo vale. */
export const PRICE_CODE_PERIOD_SECONDS = 45;
/** Tamanho do codigo. */
export const PRICE_CODE_DIGITS = 6;

const PERIOD_MS = PRICE_CODE_PERIOD_SECONDS * 1000;
const encoder = new TextEncoder();

/** Numero da janela de 45 s em que `nowMs` cai (o contador do HOTP). */
export function priceCodeStep(nowMs: number): number {
  return Math.floor(nowMs / PERIOD_MS);
}

/** Quando a janela atual acaba (em ms desde 1970): e ai que o codigo troca. */
export function priceCodeExpiresAt(nowMs: number): number {
  return (priceCodeStep(nowMs) + 1) * PERIOD_MS;
}

/** Chave boa o bastante para gerar codigo. Curta demais = chave que nao foi criada direito. */
export function isUsablePriceCodeSecret(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 16;
}

/**
 * Chave nova (64 caracteres hex, 256 bits). Normalmente quem cria e o banco (default da coluna e
 * gatilho em `companies`); isto cobre a pedreira que ficou sem linha.
 */
export function newPriceCodeSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function counterBytes(step: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let value = step;
  for (let index = 7; index >= 0; index--) {
    bytes[index] = value % 256;
    value = Math.floor(value / 256);
  }
  return bytes;
}

/** Codigo de uma janela especifica (HOTP da RFC 4226 com `PRICE_CODE_DIGITS` digitos). */
export async function priceCodeForStep(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(step)));
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    (hash[offset + 1] << 16) |
    (hash[offset + 2] << 8) |
    hash[offset + 3];
  return String(binary % 10 ** PRICE_CODE_DIGITS).padStart(PRICE_CODE_DIGITS, "0");
}

export interface CurrentPriceCode {
  code: string;
  /** ISO de quando o codigo vence (e o proximo passa a valer). */
  expiresAt: string;
  periodSeconds: number;
}

/** O codigo que vale agora e ate quando. */
export async function currentPriceCode(secret: string, nowMs: number): Promise<CurrentPriceCode> {
  return {
    code: await priceCodeForStep(secret, priceCodeStep(nowMs)),
    expiresAt: new Date(priceCodeExpiresAt(nowMs)).toISOString(),
    periodSeconds: PRICE_CODE_PERIOD_SECONDS
  };
}

/** So o codigo da janela ATUAL vale: o vencido e recusado, sem tolerancia. */
export async function verifyPriceCode(
  secret: string,
  typed: string,
  nowMs: number
): Promise<boolean> {
  const clean = typed.replace(/\s+/g, "");
  if (!/^\d+$/.test(clean) || clean.length !== PRICE_CODE_DIGITS) return false;
  const expected = await priceCodeForStep(secret, priceCodeStep(nowMs));
  let diff = 0;
  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ clean.charCodeAt(index);
  }
  return diff === 0;
}
