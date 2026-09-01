export function normalizePlate(plate: string): string {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * CNPJ ALFANUMERICO (IN RFB 2.229/2024): as 12 primeiras posicoes do CNPJ passam a aceitar
 * LETRAS alem de digitos; so os dois verificadores do fim continuam numericos. A mascara,
 * o tamanho (14) e a conta do verificador sao os mesmos — um CNPJ ja emitido, so com
 * digitos, continua passando exatamente pelas regras de antes.
 *
 * E por isso que o documento e normalizado por "letras e digitos, em maiuscula" e nao mais
 * por `replace(/\D/g, "")`: jogar a letra fora transformaria "12.ABC.345/01DE-35" em
 * "1234501" + "35", um documento ERRADO — e o cadastro seguiria com ele para o OMIE, para a
 * NF-e e para o boleto. Recusar e sempre melhor do que gravar outro documento (o mesmo
 * motivo pelo qual o CNPJ/CPF nunca e encurtado para caber num campo do OMIE).
 */

/** Posicoes de um CNPJ — as mesmas 14 nos dois formatos. */
export const CNPJ_LENGTH = 14;

/** Forma de um CNPJ (numerico ou alfanumerico): 12 alfanumericos + 2 verificadores. */
const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;
const CPF_SHAPE = /^[0-9]{11}$/;

const CNPJ_DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * O documento como e guardado e comparado: so letras e digitos, maiusculo, no maximo 14
 * posicoes. Serve para CPF e para as duas formas do CNPJ.
 */
export function normalizeDocument(document: string): string {
  return document
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, CNPJ_LENGTH);
}

/**
 * Qual dos dois documentos o valor tem FORMA de ser — sem conferir verificador.
 *
 * Existe porque varias decisoes dependem so da forma: o `pessoa_fisica` do cadastro do
 * OMIE, o tipo de identificacao do boleto, a mascara da tela. Antes essas decisoes eram
 * tomadas por `digits.length === 11`, o que passa a mentir com CNPJ alfanumerico (um CNPJ
 * com tres letras tem 11 digitos e viraria "CPF").
 */
export function documentKind(document: string): "cpf" | "cnpj" | null {
  const value = normalizeDocument(document);
  if (CPF_SHAPE.test(value)) return "cpf";
  if (CNPJ_SHAPE.test(value)) return "cnpj";
  return null;
}

/** CNPJ do formato novo, com pelo menos uma letra. */
export function isAlphanumericCnpj(document: string): boolean {
  const value = normalizeDocument(document);
  return CNPJ_SHAPE.test(value) && /[A-Z]/.test(value);
}

export function isValidPlate(plate: string): boolean {
  const normalized = normalizePlate(plate);
  if (normalized.length !== 7) return false;
  return /^[A-Z0-9]+$/.test(normalized);
}

export function isValidCpf(document: string): boolean {
  const digits = normalizeDocument(document);
  if (!CPF_SHAPE.test(digits)) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const dv1 = computeCheckDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = computeCheckDigit(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.slice(9) === `${dv1}${dv2}`;
}

export function isValidCnpj(document: string): boolean {
  const value = normalizeDocument(document);
  if (!CNPJ_SHAPE.test(value)) return false;
  if (/^(.)\1+$/.test(value)) return false;
  const dv1 = computeCheckDigit(value.slice(0, 12), CNPJ_DV1_WEIGHTS);
  const dv2 = computeCheckDigit(value.slice(0, 13), CNPJ_DV2_WEIGHTS);
  return value.slice(12) === `${dv1}${dv2}`;
}

export function isValidDocument(document: string): boolean {
  const kind = documentKind(document);
  if (kind === "cpf") return isValidCpf(document);
  if (kind === "cnpj") return isValidCnpj(document);
  return false;
}

export function formatPlate(plate: string): string {
  const normalized = normalizePlate(plate);
  if (normalized.length === 7 && /^[A-Z]{3}[0-9]{4}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  }
  if (normalized.length === 7 && /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}${normalized.slice(3, 4)}${normalized.slice(4, 5)}${normalized.slice(5)}`;
  }
  return normalized;
}

/**
 * Mascara do documento. O CNPJ alfanumerico usa a MESMA mascara do numerico
 * ("12.ABC.345/01DE-35"): so o conteudo das posicoes mudou.
 */
export function formatDocument(document: string): string {
  const value = normalizeDocument(document);
  if (CPF_SHAPE.test(value)) {
    return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
  }
  if (value.length === CNPJ_LENGTH) {
    return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
  }
  return value;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(0, 11);
}

export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Separador de e-mails no cadastro do cliente do OMIE: virgula simples. Com a lista assim,
 * o OMIE manda NF-e e boleto para todos os enderecos informados.
 */
export const EMAIL_LIST_SEPARATOR = ", ";

/** Tamanho maximo do campo `email` do cadastro de cliente/fornecedor do OMIE. */
export const OMIE_EMAIL_FIELD_MAX_LENGTH = 500;

/**
 * Tamanho maximo do `email_fatura` do OMIE — o "Utilizar os seguintes enderecos de e-mail"
 * da aba Recomendacoes, que define quem recebe a NF-e e o boleto. E menor que o do campo
 * de contato.
 */
export const OMIE_INVOICE_EMAIL_FIELD_MAX_LENGTH = 200;

/**
 * Tamanho maximo do "Enderecos de e-mail que recebem a NF" do PEDIDO/OS
 * (`informacoes_adicionais.utilizar_emails` do pedido de venda, `Email.cEnviarPara` da OS).
 * O campo do documento e `text` no OMIE, sem limite documentado; cortamos em 500 (o mesmo
 * do campo de e-mail do cadastro) so para nao mandar um texto sem fim.
 */
export const OMIE_ORDER_INVOICE_EMAIL_FIELD_MAX_LENGTH = 500;

/**
 * Quebra a lista de e-mails digitada (ou vinda do OMIE) em enderecos. Aceita virgula, ponto
 * e virgula, quebra de linha e espaco como separadores — e o que aparece quando o operador
 * cola uma lista de outro sistema — e remove repetidos preservando a ordem.
 */
export function parseEmailList(value: string | null | undefined): string[] {
  const emails: string[] = [];
  for (const part of (value ?? "").split(/[,;\s]+/)) {
    const email = normalizeEmail(part);
    if (email.length > 0 && !emails.includes(email)) {
      emails.push(email);
    }
  }
  return emails;
}

/** Lista de e-mails no formato guardado e enviado ao OMIE ("a@x.com, b@y.com"). */
export function formatEmailList(emails: string[]): string {
  return emails.join(EMAIL_LIST_SEPARATOR);
}

/** Normaliza a lista digitada para o formato canonico (minusculas, sem repetidos). */
export function normalizeEmailList(value: string | null | undefined): string {
  return formatEmailList(parseEmailList(value));
}

/** Todos os enderecos da lista sao validos (lista vazia conta como valida). */
export function isValidEmailList(value: string | null | undefined): boolean {
  const parts = (value ?? "").split(/[,;\s]+/).filter((part) => part.trim().length > 0);
  return parts.every((part) => isValidEmail(part));
}

/** Enderecos invalidos da lista, para dizer ao operador qual deles esta errado. */
export function invalidEmailsInList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isValidEmail(part));
}

/**
 * Lista pronta para o campo `email` do OMIE: virgula simples e, no maximo, 500 caracteres.
 * O corte e feito por endereco inteiro — truncar no meio de um e-mail criaria um destinatario
 * invalido e o OMIE recusaria o cadastro inteiro.
 */
export function formatEmailListForOmie(
  value: string | null | undefined,
  maxLength: number = OMIE_EMAIL_FIELD_MAX_LENGTH
): string {
  const emails = parseEmailList(value);
  const accepted: string[] = [];

  for (const email of emails) {
    const candidate = formatEmailList([...accepted, email]);
    if (candidate.length > maxLength) break;
    accepted.push(email);
  }

  return formatEmailList(accepted);
}

export function normalizeCep(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function formatCep(value: string): string {
  const digits = normalizeCep(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function isValidCep(value: string): boolean {
  return normalizeCep(value).length === 8;
}

export function normalizeMoneyInput(value: string): string {
  if (!value) return "";
  const negative = value.trim().startsWith("-");
  const cleaned = value.replace(/[^\d,.-]/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let result: string;
  if (hasComma && hasDot) {
    result = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    result = cleaned.replace(",", ".");
  } else if (hasDot) {
    // Ponto so e decimal quando ha UM ponto com 1-2 digitos depois ("1.5", "1.50").
    // Qualquer outro arranjo ("1.000", "1.000.000", "1.0005") e separador de milhar:
    // continuar digitando depois de um valor formatado nao pode deslocar a casa decimal.
    const groups = cleaned.split(".");
    const fractional = groups[groups.length - 1] ?? "";
    const isDecimal = groups.length === 2 && fractional.length >= 1 && fractional.length <= 2;
    result = isDecimal ? cleaned : cleaned.replace(/\./g, "");
  } else {
    result = cleaned;
  }
  if (result.startsWith(".")) result = `0${result}`;
  if (result.startsWith("-.")) result = result.replace("-.", "-0.");
  const parts = result.replace(/^-/, "").split(".");
  if (parts.length > 2) {
    result = `${parts[0]}.${parts.slice(1).join("")}`;
    if (negative) result = `-${result}`;
  }
  return result;
}

export function formatMoneyInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = typeof value === "number" ? String(value) : value;
  const negative = raw.trim().startsWith("-");
  const digitsOnly = raw.replace(/[^\d,.]/g, "");
  const normalized = normalizeMoneyInput(digitsOnly);
  if (!normalized || normalized === "-") return negative ? "-" : "";
  const abs = normalized.replace(/^-/, "");
  const [intPart = "0", decPart = ""] = abs.split(".");
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const formatted = decPart
    ? `${intFormatted},${decPart.slice(0, 2).padEnd(2, "0")}`
    : intFormatted;
  return negative ? `-${formatted}` : formatted;
}

export function parseMoneyInputToCents(value: string): number | null {
  if (!value || !value.trim()) return null;
  const normalized = normalizeMoneyInput(value);
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function isValidMoneyInput(value: string): boolean {
  if (!value.trim()) return true;
  return parseMoneyInputToCents(value) !== null;
}

export function normalizeIntInput(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Valor de um caractere no verificador do CNPJ: codigo ASCII menos 48. Para digito da o
 * proprio numero ('0' -> 0 ... '9' -> 9), o que faz o CNPJ numerico (e o CPF) continuarem
 * na conta de sempre; para letra vale de 17 ('A') a 42 ('Z'), como manda a Receita.
 */
function documentCharValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

function computeCheckDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += documentCharValue(base[i]) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
