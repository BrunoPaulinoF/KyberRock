/**
 * Planilha de verdade (`.xlsx`) a partir do HTML das planilhas dos relatorios.
 *
 * Os relatorios montam a planilha como HTML de tabelas (`report-document.ts`, `sheetTable`) e
 * ate aqui esse HTML era gravado com extensao `.xls`. O Excel abre esse arquivo, mas como
 * "pagina da web": avisa que o formato nao bate com a extensao, abre em Modo Protegido (so
 * leitura ate clicar em "Habilitar edicao") e, ao salvar, continua gravando HTML — formula,
 * filtro e formatacao nova se perdem ou nao funcionam direito. Era a queixa de "nao consigo
 * editar nem usar formula".
 *
 * Aqui o MESMO HTML vira um `.xlsx` (Office Open XML): o conteudo, a ordem e os textos sao os
 * de sempre, e cada celula leva o tipo que `sheet-cell.ts` ja tinha decidido — o `x:num` vira
 * numero de verdade com o formato de exibicao (`R$`, `kg`, `t`, data), e o resto vira texto
 * (documento, vale, codigo e placa nao perdem o zero a esquerda). Titulo, cabecalho azul,
 * linha de total, largura das colunas e celulas mescladas acompanham.
 *
 * Sem dependencia: o `.xlsx` e um ZIP de alguns XMLs, e o ZIP sai "armazenado" (sem
 * compressao), com o CRC-32 calculado aqui. So usa `TextEncoder`, entao roda igual no
 * processo principal do Electron e no navegador (a copia do site e `lib/desktop/html-to-xlsx.ts`,
 * guardada byte a byte pelo `desktop-copies.test.ts`).
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** "relatorio.xls" -> "relatorio.xlsx" (o nome que os relatorios ja montam). */
export function xlsxFileName(name: string): string {
  if (/\.xlsx$/i.test(name)) return name;
  if (/\.xls$/i.test(name)) return `${name}x`;
  return `${name}.xlsx`;
}

type CellKind = "title" | "subtitle" | "heading" | "note" | "header" | "body" | "total";

export interface SheetCellData {
  text: string;
  /** Valor numerico (o `x:num` do HTML); ausente = texto. */
  number?: number;
  /** Formato do Excel ja sem o escape do CSS (`R$ #,##0.00`, `@`, `dd/mm/yyyy`...). */
  format?: string;
  kind: CellKind;
  colspan: number;
  alignRight: boolean;
}

export type SheetRowData = SheetCellData[];

// ---------------------------------------------------------------------------
// Leitura do HTML
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const value =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function attribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attrs);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? "";
}

/** Tira o escape do CSS (`\X` vira `X`): e o formato que o Excel receberia do HTML. */
export function unescapeCssFormat(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function msoNumberFormat(style: string | null): string | undefined {
  if (!style) return undefined;
  const match = /mso-number-format\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(style);
  return match ? unescapeCssFormat(match[1]) : undefined;
}

function cleanText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

const SKIPPED = new Set(["head", "style", "script", "title"]);
const BLOCKS: Record<string, CellKind> = {
  h1: "title",
  h2: "heading",
  h3: "heading",
  p: "subtitle"
};

/**
 * Le o HTML da planilha na ordem em que ele aparece: titulos e paragrafos viram uma linha de
 * uma celula; cada tabela vira as suas linhas; uma linha em branco separa os blocos.
 */
export function parseSpreadsheetHtml(html: string): SheetRowData[] {
  const rows: SheetRowData[] = [];
  const token =
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?)\/?>|([^<]+)/g;
  let skip = 0;
  let tableDepth = 0;
  let row: SheetRowData | null = null;
  let rowClass = "";
  let cell: { tag: string; attrs: string; text: string } | null = null;
  let block: { kind: CellKind; text: string } | null = null;

  const blankLine = () => {
    const last = rows[rows.length - 1];
    if (rows.length > 0 && last.length > 0) rows.push([]);
  };

  for (let match = token.exec(html); match; match = token.exec(html)) {
    const [whole, closing, rawTag, attrs = "", text] = match;
    if (whole.startsWith("<!--")) continue;
    if (text !== undefined) {
      if (skip > 0) continue;
      if (cell) cell.text += text;
      else if (block) block.text += text;
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (SKIPPED.has(tag)) {
      skip = Math.max(0, skip + (closing ? -1 : 1));
      continue;
    }
    if (skip > 0) continue;

    if (tag === "br") {
      if (cell) cell.text += " ";
      else if (block) block.text += " ";
      continue;
    }

    if (tag === "table") {
      if (closing) {
        tableDepth = Math.max(0, tableDepth - 1);
        if (tableDepth === 0) blankLine();
      } else {
        if (tableDepth === 0) blankLine();
        tableDepth += 1;
      }
      continue;
    }

    if (tableDepth > 0) {
      if (tag === "tr") {
        if (closing) {
          if (row && row.length > 0) rows.push(row);
          row = null;
        } else {
          row = [];
          rowClass = (attribute(attrs, "class") ?? "").toLowerCase();
        }
        continue;
      }
      if (tag === "td" || tag === "th") {
        if (!closing) {
          cell = { tag, attrs, text: "" };
          continue;
        }
        if (cell) {
          const current = cell;
          cell = null;
          row ??= [];
          const numberText = attribute(current.attrs, "x:num");
          const numeric = numberText === null ? Number.NaN : Number(numberText);
          const colspan = Math.max(
            1,
            Number.parseInt(attribute(current.attrs, "colspan") ?? "1", 10) || 1
          );
          const className = (attribute(current.attrs, "class") ?? "").toLowerCase();
          row.push({
            text: cleanText(current.text),
            number: Number.isFinite(numeric) ? numeric : undefined,
            format: msoNumberFormat(attribute(current.attrs, "style")),
            kind: current.tag === "th" ? "header" : /\btotal\b/.test(rowClass) ? "total" : "body",
            colspan,
            alignRight: /\bnum\b/.test(className)
          });
        }
        continue;
      }
      continue;
    }

    const blockKind = BLOCKS[tag];
    if (blockKind) {
      if (!closing) {
        const className = (attribute(attrs, "class") ?? "").toLowerCase();
        block = { kind: tag === "p" && /\bnote\b/.test(className) ? "note" : blockKind, text: "" };
        continue;
      }
      if (block) {
        const content = cleanText(block.text);
        const kind = block.kind;
        block = null;
        if (!content) continue;
        if (kind === "heading" || kind === "title") blankLine();
        rows.push([{ text: content, kind, colspan: 1, alignRight: false }]);
      }
    }
  }
  while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

// ---------------------------------------------------------------------------
// Escrita do .xlsx
// ---------------------------------------------------------------------------

/** Caractere de controle (menos tab, quebra de linha e retorno) e proibido no XML. */
function isForbiddenXmlChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
}

function xml(text: string): string {
  return Array.from(text)
    .filter((char) => !isForbiddenXmlChar(char))
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function columnLetter(index: number): string {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const rest = (value - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

/** Fonte, preenchimento e borda de cada tipo de celula (indices do `styles.xml`). */
const KIND_STYLE: Record<CellKind, { font: number; fill: number; border: number }> = {
  title: { font: 3, fill: 0, border: 0 },
  subtitle: { font: 6, fill: 0, border: 0 },
  heading: { font: 4, fill: 0, border: 0 },
  note: { font: 5, fill: 0, border: 0 },
  header: { font: 2, fill: 2, border: 1 },
  body: { font: 0, fill: 0, border: 1 },
  total: { font: 1, fill: 3, border: 1 }
};

const TEXT_FORMAT_ID = 49;

class StyleBook {
  private readonly formats = new Map<string, number>();
  private readonly xfs = new Map<string, number>();
  private readonly xfList: string[] = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  ];

  style(kind: CellKind, format: string | undefined, alignRight: boolean): number {
    const numFmtId = this.formatId(format);
    const { font, fill, border } = KIND_STYLE[kind];
    const key = `${numFmtId}|${font}|${fill}|${border}|${alignRight ? "r" : ""}`;
    const known = this.xfs.get(key);
    if (known !== undefined) return known;
    const align = alignRight
      ? '<alignment horizontal="right" vertical="top"/>'
      : '<alignment vertical="top"/>';
    const applied = [
      numFmtId ? ' applyNumberFormat="1"' : "",
      font ? ' applyFont="1"' : "",
      fill ? ' applyFill="1"' : "",
      border ? ' applyBorder="1"' : ""
    ].join("");
    this.xfList.push(
      `<xf numFmtId="${numFmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${applied} applyAlignment="1">${align}</xf>`
    );
    const index = this.xfList.length - 1;
    this.xfs.set(key, index);
    return index;
  }

  private formatId(format: string | undefined): number {
    if (!format || format === "General") return 0;
    if (format === "@") return TEXT_FORMAT_ID;
    const known = this.formats.get(format);
    if (known !== undefined) return known;
    const id = 164 + this.formats.size;
    this.formats.set(format, id);
    return id;
  }

  toXml(): string {
    const numFmts = [...this.formats.entries()]
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xml(code)}"/>`)
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.formats.size ? `<numFmts count="${this.formats.size}">${numFmts}</numFmts>` : "") +
      '<fonts count="7">' +
      '<font><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="16"/><color rgb="FF1D4ED8"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="12"/><color rgb="FF1D4ED8"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><i/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/><family val="2"/></font>' +
      "</fonts>" +
      '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>' +
      "</fills>" +
      '<borders count="2">' +
      "<border><left/><right/><top/><bottom/><diagonal/></border>" +
      '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right>' +
      '<top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>' +
      "</borders>" +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfList.length}">${this.xfList.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }
}

const TABLE_KINDS = new Set<CellKind>(["header", "body", "total"]);

/** Texto que o Excel leria como numero se alguem o redigitasse (codigo, vale, documento). */
const NUMBER_LIKE_TEXT = /^[\d\s.,/-]+$/;

/**
 * O formato de TEXTO (`@`) so fica onde ele protege algo: o codigo, o vale e o documento que,
 * redigitados, perderiam o zero a esquerda. Nome e celula vazia ficam no formato Geral — com
 * `@` neles, a formula que alguem escrevesse na linha de total ficaria como texto, que e
 * justamente o que a planilha de verdade veio resolver.
 */
function cellFormat(cell: SheetCellData): string | undefined {
  if (cell.format !== "@") return cell.format;
  return cell.text && NUMBER_LIKE_TEXT.test(cell.text) ? "@" : undefined;
}

function sheetXml(rows: SheetRowData[], styles: StyleBook): string {
  const widths: number[] = [];
  const merges: string[] = [];
  const rowXml: string[] = [];

  rows.forEach((cells, rowIndex) => {
    const rowNumber = rowIndex + 1;
    let column = 0;
    const cellXml: string[] = [];
    for (const cell of cells) {
      const ref = `${columnLetter(column)}${rowNumber}`;
      const style = styles.style(
        cell.kind,
        cellFormat(cell),
        cell.alignRight && cell.number === undefined
      );
      if (cell.number !== undefined) {
        cellXml.push(`<c r="${ref}" s="${style}"><v>${Number(cell.number.toFixed(10))}</v></c>`);
      } else if (cell.text) {
        cellXml.push(
          `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`
        );
      } else {
        cellXml.push(`<c r="${ref}" s="${style}"/>`);
      }
      if (TABLE_KINDS.has(cell.kind)) {
        if (cell.colspan > 1) {
          // A borda e o fundo da area mesclada vem das celulas vazias que ela cobre.
          for (let extra = 1; extra < cell.colspan; extra++) {
            cellXml.push(`<c r="${columnLetter(column + extra)}${rowNumber}" s="${style}"/>`);
          }
          merges.push(`${ref}:${columnLetter(column + cell.colspan - 1)}${rowNumber}`);
        } else {
          widths[column] = Math.max(widths[column] ?? 0, cell.text.length);
        }
      }
      column += cell.colspan;
    }
    rowXml.push(`<row r="${rowNumber}">${cellXml.join("")}</row>`);
  });

  const cols = widths
    .map((length, index) => {
      if (length === undefined) return "";
      const width = Math.min(Math.max(length * 1.1 + 3, 9), 70).toFixed(1);
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    })
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rowXml.join("")}</sheetData>` +
    (merges.length
      ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
      : "") +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    "</worksheet>"
  );
}

/** Nome de aba valido no Excel: ate 31 caracteres e sem `[]:*?/\`. */
export function safeSheetName(name: string): string {
  const clean = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || "Relatorio").slice(0, 31);
}

/** O `.xlsx` (bytes do ZIP) das linhas dadas. */
export function buildXlsx(rows: SheetRowData[], sheetName = "Relatorio"): Uint8Array {
  const styles = new StyleBook();
  const sheet = sheetXml(rows, styles);
  const files: Array<[string, string]> = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>"
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>"
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${xml(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>` +
        "</workbook>"
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>"
    ],
    ["xl/worksheets/sheet1.xml", sheet],
    ["xl/styles.xml", styles.toXml()]
  ];
  return zipStore(files);
}

/** O HTML da planilha de um relatorio, pronto como `.xlsx`. */
export function spreadsheetHtmlToXlsx(html: string, sheetName = "Relatorio"): Uint8Array {
  return buildXlsx(parseSpreadsheetHtml(html), sheetName);
}

// ---------------------------------------------------------------------------
// ZIP (metodo "armazenado")
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<[string, string]>): Uint8Array {
  const encoder = new TextEncoder();
  const entries = files.map(([name, content]) => {
    const data = encoder.encode(content);
    return { name: encoder.encode(name), data, crc: crc32(data) };
  });
  // 1980-01-01 00:00 no formato do DOS: a data nao importa para o Excel.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;

  const localSize = entries.reduce(
    (sum, entry) => sum + 30 + entry.name.length + entry.data.length,
    0
  );
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  const offsets: number[] = [];

  for (const entry of entries) {
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    output.set(entry.name, offset + 30);
    output.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
  }

  const centralStart = offset;
  entries.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, offsets[index], true);
    output.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);
  return output;
}
