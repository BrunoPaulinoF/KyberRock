import { CNPJ_LENGTH, formatPlate } from "./format";

/*
 * Mascaras de digitacao dos formularios: o campo vai se formatando enquanto a pessoa digita
 * (etapa 4 do plano de UI). Sao so de TELA — quem grava continua normalizando pelo proprio
 * caminho (`normalizeDocument`, etc.), entao aceitar o texto com pontuacao nao muda o que sobe.
 */

/**
 * CPF ou CNPJ enquanto digita. O CNPJ alfanumerico (IN RFB 2.229/2024) tem LETRA nas 12
 * primeiras posicoes: letra nunca e descartada, so a pontuacao. Ate 11 caracteres so com
 * numero, a mascara e de CPF; com letra ou mais de 11, de CNPJ.
 */
export function maskDocument(input: string): string {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, CNPJ_LENGTH);
  const isCnpj = /[A-Z]/.test(raw) || raw.length > 11;
  if (!isCnpj) {
    return joinParts(raw, [3, 3, 3, 2], [".", ".", "-"]);
  }
  return joinParts(raw, [2, 3, 3, 4, 2], [".", ".", "/", "-"]);
}

/** Telefone do Brasil: (11) 1234-5678 ou (11) 91234-5678. Numero com "+" fica como digitado. */
export function maskPhone(input: string): string {
  if (input.trim().startsWith("+")) return input;
  const digits = input.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = digits.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** CEP: 12345-678. */
export function maskCep(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/** Placa: maiuscula, sem espaco; a antiga completa ganha o traco (ABC-1234), a Mercosul nao. */
export function maskPlate(input: string): string {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 7);
  return formatPlate(raw);
}

/** Junta os pedacos ja digitados com a pontuacao entre eles (so ate onde a pessoa chegou). */
function joinParts(raw: string, sizes: number[], separators: string[]): string {
  let out = "";
  let index = 0;
  sizes.forEach((size, part) => {
    if (index >= raw.length) return;
    if (part > 0) out += separators[part - 1];
    out += raw.slice(index, index + size);
    index += size;
  });
  return out;
}
