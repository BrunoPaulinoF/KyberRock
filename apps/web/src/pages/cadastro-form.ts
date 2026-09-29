import type { CepAddress } from "../lib/cep";
import { normalizeDocument } from "../lib/format";
import { maskCep, maskDocument, maskPhone } from "../lib/masks";

/*
 * O que os formularios de cadastro (cliente, motorista, transportadora, destinatario) precisam
 * em volta das mascaras de `lib/masks.ts`. A mascara e so de TELA:
 *
 * - o valor que ja estava gravado sobe COMO ESTAVA enquanto ninguem mexe no campo — abrir e
 *   salvar para trocar o endereco nao pode reescrever o telefone;
 * - o que foi digitado com a mascara sobe no formato da balanca: telefone e CEP so com os
 *   digitos (`normalizePhone` do desktop). Com o traco, o telefone chegaria cortado ao OMIE:
 *   `splitPhoneForOmie` le os digitos so ate o primeiro separador ("(15) 99999-9999" viraria
 *   o numero "99999").
 */

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Letras e digitos, em maiuscula: o que a mascara nao pode perder. */
function significant(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * O valor gravado com a mascara da tela, so quando ela nao perde nada dele: telefone com ramal,
 * com DDI ou com texto solto aparece do jeito que esta gravado.
 */
export function maskStored(
  value: string | null | undefined,
  mask: (input: string) => string
): string {
  const text = value ?? "";
  const masked = mask(text);
  return significant(masked) === significant(text) ? masked : text;
}

/**
 * `maskPhone` sem cortar digito: acima de 11 (DDI colado sem o "+", ramal), o campo fica como
 * foi digitado em vez de jogar digito fora.
 */
export function maskPhoneInput(value: string): string {
  return digitsOf(value).length > 11 ? value : maskPhone(value);
}

/**
 * O que um campo com mascara manda para a `web-api`. Igual ao que abriu: o valor gravado, do
 * jeito que esta. Mexido e no formato da mascara: `strip` tira a pontuacao que ela pos. Fora do
 * formato (ramal, "+55 ..."): vai como foi digitado. Vazio vai `null` (limpa o campo).
 */
export function maskedToSave(
  field: { value: string; initial: string; stored: string | null | undefined },
  mask: (input: string) => string,
  strip: (input: string) => string
): string | null {
  if (field.value === field.initial) return field.stored?.trim() || null;
  const text = field.value.trim();
  if (!text) return null;
  return mask(text) === text ? strip(text) || null : text;
}

/** Telefone: so os digitos, como a balanca grava; numero com "+" (exterior) vai como digitado. */
export function phoneToSave(
  value: string,
  initial: string,
  stored: string | null | undefined
): string | null {
  return maskedToSave({ value, initial, stored }, maskPhone, (text) =>
    text.startsWith("+") ? text : digitsOf(text)
  );
}

/** CEP: so os 8 digitos, como a balanca grava. */
export function cepToSave(
  value: string,
  initial: string,
  stored: string | null | undefined
): string | null {
  return maskedToSave({ value, initial, stored }, maskCep, digitsOf);
}

/** CPF/CNPJ sem a pontuacao — e sem perder letra (CNPJ alfanumerico). */
export function documentToSave(
  value: string,
  initial: string,
  stored: string | null | undefined
): string | null {
  return maskedToSave({ value, initial, stored }, maskDocument, normalizeDocument);
}

export interface AddressFields {
  addressStreet: string;
  neighborhood: string;
  city: string;
  state: string;
}

/**
 * O endereco que veio do CEP, so nos campos VAZIOS: o que a pessoa ja digitou fica. `null`
 * quando nao havia nada a preencher.
 */
export function fillEmptyAddress<T extends AddressFields>(form: T, address: CepAddress): T | null {
  const patch: Partial<AddressFields> = {};
  const fill = (key: keyof AddressFields, value: string) => {
    if (!form[key].trim() && value.trim()) patch[key] = value.trim();
  };
  fill("addressStreet", address.street);
  fill("neighborhood", address.district);
  fill("city", address.city);
  fill("state", address.state.toUpperCase().slice(0, 2));
  return Object.keys(patch).length > 0 ? { ...form, ...patch } : null;
}

/**
 * O WhatsApp gravado (55 + DDD + numero, so digitos) do jeito que a pessoa digita:
 * "(11) 99999-9999". A `web-api` poe o 55 de volta; numero de outro pais aparece com "+".
 */
export function whatsappForInput(stored: string | null | undefined): string {
  const digits = digitsOf(stored ?? "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return maskPhone(digits);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return maskPhone(digits.slice(2));
  }
  return `+${digits}`;
}

/**
 * A mensagem de erro da `web-api` no campo dela: `rules` e uma lista de (campo, trecho da
 * mensagem). Nenhum casou: `null`, e ela continua no alto da janela.
 */
export function fieldOfError<K extends string>(
  message: string,
  rules: ReadonlyArray<readonly [field: K, pattern: RegExp]>
): K | null {
  return rules.find(([, pattern]) => pattern.test(message))?.[0] ?? null;
}
