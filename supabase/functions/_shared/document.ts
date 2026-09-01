/**
 * CNPJ/CPF na nuvem — o espelho de `packages/shared/src/format.ts`.
 *
 * As Edge Functions sao Deno e nao enxergam os workspaces npm, entao a regra do documento
 * vive aqui de novo. Ela e curta e nao muda: se um dia mudar, os dois lados tem de mudar
 * juntos (o desktop e a nuvem comparam o MESMO documento para decidir se dois cadastros
 * sao o mesmo cliente).
 *
 * CNPJ ALFANUMERICO (IN RFB 2.229/2024): as 12 primeiras posicoes do CNPJ passam a aceitar
 * LETRAS alem de digitos; so os dois verificadores do fim continuam numericos. O tamanho
 * (14), a mascara e a conta do verificador sao os mesmos, entao um CNPJ ja emitido, so com
 * digitos, continua passando pelas regras de sempre.
 *
 * Por isso o documento e normalizado por "letras e digitos, em maiuscula" e nao por
 * `replace(/\D/g, "")`: jogar a letra fora transformaria "12.ABC.345/01DE-35" em
 * "1234501" + "35" — um documento ERRADO, que o OMIE gravaria no cadastro e a NF-e sairia
 * com ele. Recusar e sempre melhor do que enviar outro documento.
 */

export const CNPJ_LENGTH = 14;

/** Forma de um CNPJ (numerico ou alfanumerico): 12 alfanumericos + 2 verificadores. */
const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;
const CPF_SHAPE = /^[0-9]{11}$/;

const CNPJ_DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** O documento como e guardado e comparado: so letras e digitos, maiusculo, ate 14 posicoes. */
export function normalizeDocument(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, CNPJ_LENGTH);
}

/**
 * Qual dos dois documentos o valor tem FORMA de ser — sem conferir verificador.
 *
 * Antes essas decisoes eram tomadas por `digits.length === 11`, o que passa a mentir com o
 * CNPJ alfanumerico: um CNPJ com tres letras tem 11 digitos e viraria "CPF" (e o cadastro
 * subiria ao OMIE como pessoa fisica).
 */
export function documentKind(value: string | null | undefined): "cpf" | "cnpj" | null {
  const document = normalizeDocument(value);
  if (CPF_SHAPE.test(document)) return "cpf";
  if (CNPJ_SHAPE.test(document)) return "cnpj";
  return null;
}

/**
 * Valor de um caractere no verificador: codigo ASCII menos 48. Para digito da o proprio
 * numero ('0' -> 0 ... '9' -> 9), o que mantem o CNPJ numerico e o CPF na conta de sempre;
 * para letra vale de 17 ('A') a 42 ('Z'), como manda a Receita.
 */
function charValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += charValue(base[i]) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const document = normalizeDocument(value);
  if (!CNPJ_SHAPE.test(document)) return false;
  if (/^(.)\1+$/.test(document)) return false;
  const dv1 = checkDigit(document.slice(0, 12), CNPJ_DV1_WEIGHTS);
  const dv2 = checkDigit(document.slice(0, 13), CNPJ_DV2_WEIGHTS);
  return document.slice(12) === `${dv1}${dv2}`;
}

export function isValidCpf(value: string | null | undefined): boolean {
  const document = normalizeDocument(value);
  if (!CPF_SHAPE.test(document)) return false;
  if (/^(\d)\1+$/.test(document)) return false;
  const dv1 = checkDigit(document.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = checkDigit(document.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return document.slice(9) === `${dv1}${dv2}`;
}

export function isValidDocument(value: string | null | undefined): boolean {
  const kind = documentKind(value);
  if (kind === "cpf") return isValidCpf(value);
  if (kind === "cnpj") return isValidCnpj(value);
  return false;
}
