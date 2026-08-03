import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Leitor de planilhas usado pela importacao de clientes.
 *
 * Le `.csv`/`.txt`/`.tsv` e tambem `.xlsx`/`.xlsm` direto, sem dependencia nova: um
 * arquivo XLSX e um ZIP com XML dentro, e `node:zlib` ja sabe descompactar. Ler o XLSX
 * nativo evita o passo manual de "salvar como CSV" — que no Excel em portugues sai com
 * `;` como separador e virgula decimal, justamente o formato que mais quebra importacao.
 */

export interface SheetRow {
  /** Linha na planilha original (1-based, contando o cabecalho). Usado nos relatorios. */
  lineNumber: number;
  /** Celulas indexadas pelo cabecalho normalizado da coluna. */
  cells: Record<string, string>;
  values: string[];
}

export interface SheetTable {
  /** Nome da aba (arquivos CSV usam o nome do arquivo). */
  name: string;
  headers: string[];
  rows: SheetRow[];
}

export interface ReadSpreadsheetOptions {
  /** Nome da aba ou indice 1-based. Padrao: a primeira aba com conteudo. */
  sheet?: string | number;
}

const TEXT_EXTENSIONS = new Set([".csv", ".txt", ".tsv"]);
const ZIP_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xltx"]);

export function readSpreadsheet(
  filePath: string,
  options: ReadSpreadsheetOptions = {}
): SheetTable {
  const buffer = readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();

  if (isZipArchive(buffer) || ZIP_EXTENSIONS.has(extension)) {
    if (!isZipArchive(buffer)) {
      throw new Error(`Arquivo "${path.basename(filePath)}" nao e um XLSX valido.`);
    }
    const sheets = parseXlsx(buffer);
    const sheet = pickSheet(sheets, options.sheet, filePath);
    return toSheetTable(sheet.name, sheet.matrix);
  }

  if (!TEXT_EXTENSIONS.has(extension) && extension !== "") {
    throw new Error(
      `Formato nao suportado: "${extension}". Use .csv, .tsv ou .xlsx (no Excel: Arquivo > Salvar como).`
    );
  }

  const matrix = parseDelimitedText(decodeText(buffer));
  return toSheetTable(path.basename(filePath, extension), matrix);
}

/** Le TODAS as abas de um arquivo (usado para listar as opcoes de `--aba`). */
export function readSpreadsheetSheetNames(filePath: string): string[] {
  const buffer = readFileSync(filePath);
  if (!isZipArchive(buffer)) return [path.basename(filePath)];
  return parseXlsx(buffer).map((sheet) => sheet.name);
}

/**
 * Monta a tabela a partir da matriz bruta: a primeira linha com pelo menos um valor vira
 * o cabecalho, as seguintes viram registros. Linhas totalmente vazias sao descartadas —
 * planilha de escritorio quase sempre tem uma sobra de linhas em branco no fim.
 */
export function toSheetTable(name: string, matrix: string[][]): SheetTable {
  const headerIndex = matrix.findIndex((row) => row.some((cell) => cell.trim() !== ""));
  if (headerIndex < 0) {
    return { name, headers: [], rows: [] };
  }

  const headers = dedupeHeaders(matrix[headerIndex].map((cell) => cell.trim()));
  const rows: SheetRow[] = [];

  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const values = matrix[index] ?? [];
    if (!values.some((cell) => cell.trim() !== "")) continue;

    const cells: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (!header) return;
      cells[header] = (values[column] ?? "").trim();
    });

    rows.push({ lineNumber: index + 1, cells, values });
  }

  return { name, headers: headers.filter((header) => header !== ""), rows };
}

/**
 * Duas colunas com o mesmo titulo (acontece quando a planilha tem "Preco" repetido)
 * sobrescreveriam uma a outra no registro. O sufixo mantem as duas acessiveis.
 */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    if (!header) return "";
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header} (${count + 1})`;
  });
}

// ---------------------------------------------------------------------------
// CSV / texto delimitado
// ---------------------------------------------------------------------------

function decodeText(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  // BOM do Excel: sem remover, o primeiro cabecalho carrega o caractere invisivel na
  // frente ("Nome" deixa de ser "Nome") e nenhuma coluna casa.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Descobre o separador pela primeira linha nao vazia. O Excel em pt-BR exporta com `;`
 * (a virgula ja e o separador decimal), o resto do mundo com `,`.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestCount = -1;

  for (const candidate of candidates) {
    const count = countOutsideQuotes(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return bestCount > 0 ? best : ";";
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count++;
  }
  return count;
}

export function parseDelimitedText(text: string, delimiter = detectDelimiter(text)): string[][] {
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    matrix.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      if (text[index + 1] === "\n") index++;
      pushRow();
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) pushRow();

  return matrix;
}

/** Sem o BOM o Excel abre o CSV como ANSI e todo acento vira lixo. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

export function toCsv(rows: readonly (readonly string[])[], delimiter = ";"): string {
  return rows
    .map((row) => row.map((cell) => csvEscape(cell, delimiter)).join(delimiter))
    .join("\r\n");
}

/** Conteudo pronto para gravar e abrir no Excel: com BOM e terminando em nova linha. */
export function toCsvFile(rows: readonly (readonly string[])[], delimiter = ";"): string {
  return `${UTF8_BOM}${toCsv(rows, delimiter)}\r\n`;
}

export function csvEscape(value: string, delimiter = ";"): string {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

interface ParsedSheet {
  name: string;
  matrix: string[][];
}

function isZipArchive(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function pickSheet(
  sheets: ParsedSheet[],
  requested: string | number | undefined,
  filePath: string
): ParsedSheet {
  if (sheets.length === 0) {
    throw new Error(`Nenhuma aba encontrada em "${path.basename(filePath)}".`);
  }

  if (requested === undefined) {
    return (
      sheets.find((sheet) => sheet.matrix.some((row) => row.some((cell) => cell.trim()))) ??
      sheets[0]
    );
  }

  if (typeof requested === "number") {
    const sheet = sheets[requested - 1];
    if (!sheet) {
      throw new Error(
        `Aba ${requested} nao existe em "${path.basename(filePath)}". Abas: ${sheets
          .map((item, index) => `${index + 1}=${item.name}`)
          .join(", ")}.`
      );
    }
    return sheet;
  }

  const wanted = requested.trim().toLowerCase();
  const sheet = sheets.find((item) => item.name.trim().toLowerCase() === wanted);
  if (!sheet) {
    throw new Error(
      `Aba "${requested}" nao existe em "${path.basename(filePath)}". Abas: ${sheets
        .map((item) => item.name)
        .join(", ")}.`
    );
  }
  return sheet;
}

export function parseXlsx(buffer: Buffer): ParsedSheet[] {
  const entries = unzip(buffer);

  const workbookXml = readEntryText(entries, "xl/workbook.xml");
  if (!workbookXml) {
    throw new Error("XLSX invalido: xl/workbook.xml nao encontrado.");
  }

  const sharedStrings = parseSharedStrings(readEntryText(entries, "xl/sharedStrings.xml"));
  const relationships = parseRelationships(readEntryText(entries, "xl/_rels/workbook.xml.rels"));
  const sheets: ParsedSheet[] = [];

  const sheetTagPattern = /<sheet\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  let fallbackIndex = 0;

  while ((match = sheetTagPattern.exec(workbookXml)) !== null) {
    const attributes = match[1];
    fallbackIndex++;
    const name = decodeXmlEntities(readAttribute(attributes, "name") ?? `Planilha${fallbackIndex}`);
    const relationshipId = readAttribute(attributes, "r:id") ?? readAttribute(attributes, "id");
    const target = relationshipId ? relationships.get(relationshipId) : undefined;
    const entryName = resolveSheetEntryName(target, fallbackIndex);
    const sheetXml = readEntryText(entries, entryName);
    if (sheetXml === null) continue;
    sheets.push({ name, matrix: parseSheetXml(sheetXml, sharedStrings) });
  }

  return sheets;
}

function resolveSheetEntryName(target: string | undefined, fallbackIndex: number): string {
  if (!target) return `xl/worksheets/sheet${fallbackIndex}.xml`;
  const cleaned = target.replace(/^\//, "");
  return cleaned.startsWith("xl/") ? cleaned : `xl/${cleaned}`;
}

function readEntryText(entries: Map<string, Buffer>, name: string): string | null {
  const entry = entries.get(name);
  return entry ? entry.toString("utf8") : null;
}

function parseRelationships(xml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;

  const pattern = /<Relationship\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const id = readAttribute(match[1], "Id");
    const target = readAttribute(match[1], "Target");
    if (id && target) map.set(id, decodeXmlEntities(target));
  }
  return map;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    strings.push(match[1] ? extractTextNodes(match[1]) : "");
  }

  return strings;
}

/** Texto de uma celula pode vir quebrado em varios `<t>` (formatacao rica). */
function extractTextNodes(xml: string): string {
  let text = "";
  const pattern = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    text += decodeXmlEntities(match[1] ?? "");
  }
  return text;
}

function parseSheetXml(xml: string, sharedStrings: string[]): string[][] {
  const matrix: string[][] = [];
  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let rowMatch: RegExpExecArray | null;
  let sequentialRow = 0;

  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const attributes = rowMatch[1] ?? rowMatch[3] ?? "";
    const content = rowMatch[2] ?? "";
    const declaredIndex = Number(readAttribute(attributes, "r") ?? "");
    const rowIndex =
      Number.isFinite(declaredIndex) && declaredIndex > 0 ? declaredIndex : sequentialRow + 1;
    sequentialRow = rowIndex;

    const cells: string[] = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cellMatch: RegExpExecArray | null;
    let nextColumn = 0;

    while ((cellMatch = cellPattern.exec(content)) !== null) {
      const cellAttributes = cellMatch[1] ?? cellMatch[3] ?? "";
      const cellContent = cellMatch[2] ?? "";
      const reference = readAttribute(cellAttributes, "r");
      const column = reference ? columnIndexFromReference(reference) : nextColumn;
      nextColumn = column + 1;

      while (cells.length < column) cells.push("");
      cells[column] = readCellValue(cellAttributes, cellContent, sharedStrings);
    }

    // Linhas puladas no XML (a planilha so grava as que tem conteudo) precisam existir
    // na matriz para o numero da linha do relatorio bater com o da planilha.
    while (matrix.length < rowIndex - 1) matrix.push([]);
    matrix[rowIndex - 1] = cells;
  }

  return matrix;
}

function readCellValue(attributes: string, content: string, sharedStrings: string[]): string {
  const type = readAttribute(attributes, "t") ?? "n";

  if (type === "inlineStr") {
    return extractTextNodes(content);
  }

  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(content);
  const raw = valueMatch ? decodeXmlEntities(valueMatch[1]) : "";

  if (type === "s") {
    const index = Number(raw);
    return Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
  }

  if (type === "b") {
    return raw === "1" ? "VERDADEIRO" : "FALSO";
  }

  return raw;
}

/** "AB12" -> 27 (indice 0-based da coluna AB). */
export function columnIndexFromReference(reference: string): number {
  const letters = /^([A-Za-z]+)/.exec(reference)?.[1] ?? "";
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function readAttribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name.replace(/[:.]/g, "\\$&")}\\s*=\\s*"([^"]*)"`);
  return pattern.exec(attributes)?.[1];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// ZIP (somente leitura, o suficiente para XLSX)
// ---------------------------------------------------------------------------

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

export function unzip(buffer: Buffer): Map<string, Buffer> {
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) break;

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (compressedSize === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
      throw new Error(
        "Planilha XLSX no formato ZIP64 (arquivo muito grande). Salve como CSV e importe o CSV."
      );
    }

    if (buffer.readUInt32LE(localHeaderOffset) === LOCAL_FILE_HEADER) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      entries.set(name, compressionMethod === 0 ? Buffer.from(data) : inflateRawSync(data));
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("Arquivo XLSX corrompido: fim do diretorio central nao encontrado.");
}
