/**
 * Tipagem das celulas das planilhas geradas pelo desktop.
 *
 * As planilhas sao HTML de tabelas gravado com extensao `.xls` (ver `report-document.ts`).
 * Ate aqui TODA celula saia como texto — o estilo trazia `mso-number-format:"\@"` no `td`
 * inteiro —, entao peso, valor, data e contagem chegavam ao Excel como palavra: nao dava
 * para somar uma coluna, fazer media, ordenar por valor nem escrever formula, que e
 * exatamente para isso que a pedreira pede a planilha em vez do PDF.
 *
 * O que este modulo faz e olhar o texto JA FORMATADO da celula (`R$ 1.234,56`, `15.000 kg`,
 * `1.234,5 t`, `12,3%`, `15/07/2026`, `1h 05min`) e devolver o par que o Excel precisa:
 *
 * - `value`: o numero puro (com ponto decimal), que vai no atributo `x:num` da celula;
 * - `format`: o formato de exibicao, ja escapado para o parser CSS do Excel, que mantem na
 *   tela exatamente o que o relatorio mostrava — inclusive o "kg", o "t" e o "R$".
 *
 * Ou seja: o que se ve continua igual, o que esta na celula passa a ser numero de verdade.
 *
 * O CUIDADO que manda aqui e o oposto do resto: converter demais e pior que converter de
 * menos. Um documento, um numero de vale, um codigo de produto ou uma nota fiscal que virem
 * numero perdem o zero a esquerda e podem sair em notacao cientifica — o arquivo passa a
 * mentir. Por isso a conversao so acontece quando o texto tem a CARA de um numero
 * formatado, e nunca quando:
 *
 * - o cabecalho da coluna e de identificador (vale, nota, codigo, CNPJ/CPF, placa...);
 * - sao digitos soltos com mais de 3 casas e sem separador (`12345678000199` e documento;
 *   contagem de verdade sai do `num()` com ponto de milhar a partir de 1.000);
 * - o numero comeca com zero (`004321` e codigo, nao quatro mil).
 */

/** Numero e formato de exibicao de uma celula que vale como numero na planilha. */
export interface SheetNumberCell {
  /** Valor puro para o `x:num` (o Excel le sempre com ponto decimal). */
  value: number;
  /** Formato de exibicao, ja escapado para o CSS do Excel. */
  format: string;
}

/**
 * Escapa um formato do Excel para o parser CSS dele: toda pontuacao vai precedida de `\`
 * (e a propria barra invertida dobra), como o proprio Office faz ao exportar HTML. Letras,
 * digitos e espacos passam intactos. O CSS desfaz o escape e o Excel recebe o formato
 * limpo — `\@`, por exemplo, chega como `@`.
 */
function cssFormat(excelFormat: string): string {
  return excelFormat.replace(/[\\!-/:-@[-`{-~]/g, (char) => `\\${char}`);
}

/**
 * Texto literal dentro de um formato do Excel. O Excel escapa literal com `\` (senao `t`,
 * `g`, `m`, `d` e `h` viram codigo de data/hora), e esse `\` ainda passa pelo escape do CSS.
 */
function literal(text: string): string {
  return [...text].map((char) => `\\\\${char}`).join("");
}

/** Formato de texto — o que mantem documento, vale e codigo como estao. */
export const SHEET_TEXT_FORMAT = cssFormat("@");

function decimalFormat(decimals: number): string {
  return decimals > 0 ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
}

/**
 * Cabecalhos cujo conteudo e IDENTIFICADOR, nunca quantidade. Comparados pelo nome exato
 * (sem acento, sem ponto final, em minusculas) de proposito: "Nota fiscal" e identificador,
 * mas "Sem nota" e dinheiro — um casamento por pedaco de palavra transformaria a coluna de
 * valor em texto de novo.
 */
const TEXT_HEADERS = new Set([
  "op",
  "operacao",
  "vale",
  "vale que vale",
  "vale(s) repetido(s)",
  "nota",
  "nota fiscal",
  "pedido omie",
  "pedido/os omie",
  "codigo",
  "cod",
  "placa",
  "parcela",
  "tabela",
  "ciclo",
  "telefone",
  "id",
  "numero",
  "n"
]);

/** Sem acento, sem ponto final, sem espaco sobrando e em minusculas. */
function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "")
    .trim();
}

/** Coluna que fica como texto aconteca o que acontecer. */
export function isTextSheetHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  if (TEXT_HEADERS.has(normalized)) return true;
  return (
    normalized.includes("cnpj") ||
    normalized.includes("cpf") ||
    normalized.includes("documento") ||
    normalized.includes("telefone") ||
    normalized.includes("inscricao")
  );
}

/** Numero em pt-BR: ponto de milhar, virgula decimal. */
const PT_BR_NUMBER = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;

interface ParsedNumber {
  value: number;
  decimals: number;
}

/**
 * "1.234,56" -> 1234.56. Devolve `null` para o que so PARECE numero: digitos soltos com
 * mais de tres casas (documento, vale, nota), zero a esquerda (codigo) e sequencia longa
 * demais para caber num numero sem perder digito.
 */
function parsePtBrNumber(raw: string): ParsedNumber | null {
  const text = raw.trim();
  if (!PT_BR_NUMBER.test(text)) return null;

  const negative = text.startsWith("-");
  const [integerText, decimalText = ""] = text.replace(/^-/, "").split(",");
  const digits = integerText.replace(/\./g, "");
  if (digits.length > 1 && digits.startsWith("0")) return null;
  if (digits.length > 15) return null;
  // Digito solto e sem separador acima de tres casas e identificador, nao quantidade:
  // uma contagem de verdade vem do `num()`, que poe o ponto de milhar a partir de 1.000.
  if (!integerText.includes(".") && digits.length > 3) return null;

  const value = Number(`${digits}.${decimalText || "0"}`);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, decimals: decimalText.length };
}

const CURRENCY_CELL = /^(-?)\s*R\$\s*(-?[\d.,]+)(?:\/(t|kg))?$/i;
const PERCENT_CELL = /^(-?[\d.,]+)\s*%$/;
const KG_CELL = /^(-?[\d.,]+)\s*kg$/i;
const TON_CELL = /^(-?[\d.,]+)\s*t$/i;
const DURATION_CELL = /^(?:(\d+)h\s*)?(\d{1,3})min$/i;
const DATE_CELL = /^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const MONTH_CELL = /^(\d{2})\/(\d{4})$/;

/** Serial do Excel: dias desde 30/12/1899, com a hora na parte fracionaria. */
export function excelDateSerial(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
): number {
  const days = Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
  return days + (hours * 3600 + minutes * 60 + seconds) / 86_400;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Le a celula ja formatada e diz se ela vale como numero na planilha — e com que formato.
 * `header` e o cabecalho da coluna (o rotulo da linha, nas tabelas "Campo / Valor"), usado
 * so para blindar as colunas de identificador.
 */
export function classifySheetCell(display: string, header = ""): SheetNumberCell | null {
  const text = display.trim();
  if (!text || text === "-") return null;
  if (isTextSheetHeader(header)) return null;

  const currency = CURRENCY_CELL.exec(text);
  if (currency) {
    const parsed = parsePtBrNumber(currency[2]);
    if (!parsed) return null;
    const unit = currency[3] ? literal(`/${currency[3].toLowerCase()}`) : "";
    const value = currency[1] === "-" ? -parsed.value : parsed.value;
    return { value, format: cssFormat(`R$ ${decimalFormat(2)}`) + unit };
  }

  const percent = PERCENT_CELL.exec(text);
  if (percent) {
    const parsed = parsePtBrNumber(percent[1]);
    if (!parsed) return null;
    // O Excel guarda porcentagem como fracao e multiplica por 100 na tela.
    return { value: parsed.value / 100, format: cssFormat(`${decimalFormat(parsed.decimals)}%`) };
  }

  const kg = KG_CELL.exec(text);
  if (kg) {
    const parsed = parsePtBrNumber(kg[1]);
    if (!parsed) return null;
    return {
      value: parsed.value,
      format: `${cssFormat(decimalFormat(parsed.decimals))} ${literal("kg")}`
    };
  }

  const tons = TON_CELL.exec(text);
  if (tons) {
    const parsed = parsePtBrNumber(tons[1]);
    if (!parsed) return null;
    return {
      value: parsed.value,
      format: `${cssFormat(decimalFormat(parsed.decimals))} ${literal("t")}`
    };
  }

  const duration = DURATION_CELL.exec(text);
  if (duration) {
    const minutes = Number(duration[1] ?? 0) * 60 + Number(duration[2]);
    // Hora de verdade (fracao do dia): assim a coluna de tempo soma e tira media. O `[h]`
    // conta horas corridas, entao um total de 30 horas aparece como 30h, e nao como 6h.
    return { value: minutes / 1440, format: `\\[h\\]${literal("h")} mm${literal("min")}` };
  }

  const date = DATE_CELL.exec(text);
  if (date) {
    const [, day, month, year, hours, minutes, seconds] = date;
    if (!isRealDate(Number(year), Number(month), Number(day))) return null;
    const withTime = hours !== undefined;
    return {
      value: excelDateSerial(
        Number(year),
        Number(month),
        Number(day),
        Number(hours ?? 0),
        Number(minutes ?? 0),
        Number(seconds ?? 0)
      ),
      format: cssFormat(withTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy")
    };
  }

  const month = MONTH_CELL.exec(text);
  if (month) {
    const [, monthText, yearText] = month;
    if (!isRealDate(Number(yearText), Number(monthText), 1)) return null;
    return {
      value: excelDateSerial(Number(yearText), Number(monthText), 1),
      format: cssFormat("mm/yyyy")
    };
  }

  const plain = parsePtBrNumber(text);
  if (plain) {
    return { value: plain.value, format: cssFormat(decimalFormat(plain.decimals)) };
  }

  return null;
}
