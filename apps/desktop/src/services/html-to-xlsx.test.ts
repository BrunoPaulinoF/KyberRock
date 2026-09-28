import { describe, expect, it } from "vitest";

import {
  buildXlsx,
  columnLetter,
  crc32,
  parseSpreadsheetHtml,
  safeSheetName,
  spreadsheetHtmlToXlsx,
  unescapeCssFormat,
  xlsxFileName
} from "./html-to-xlsx";
import { SPREADSHEET_HTML_ATTRS, SPREADSHEET_STYLE, sheetTable } from "./report-document";

/** Le um ZIP "armazenado" (o que o gerador escreve) e devolve os arquivos como texto. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0); // sem compressao
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const data = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, decoder.decode(data));
    offset += 30 + nameLength + size;
  }
  return files;
}

function sampleHtml(): string {
  return (
    `<!doctype html><html ${SPREADSHEET_HTML_ATTRS}><head><meta charset="utf-8">` +
    `<style>${SPREADSHEET_STYLE}</style><title>Titulo da aba</title></head><body>` +
    `<h1>Relatorio &amp; cia</h1><p class="sub">Periodo 01/09/2026 a 28/09/2026</p>` +
    sheetTable(
      "Cargas",
      ["Data", "Cliente", "Vale", "Peso", "Valor"],
      [
        ["01/09/2026", "Polimix <Concreto>", "004321", "15.000 kg", "R$ 1.234,56"],
        ["02/09/2026", "Construtora Ibiuna", "12345678000199", "1.234,5 t", "R$ 99,00"]
      ],
      ["TOTAL", "", "", "16.234 kg", "R$ 1.333,55"]
    ) +
    `<p class="note">Observacao</p></body></html>`
  );
}

describe("parseSpreadsheetHtml", () => {
  it("le titulo, cabecalho, linhas, total e nota na ordem, sem o head", () => {
    const rows = parseSpreadsheetHtml(sampleHtml());
    const texts = rows.map((row) => row.map((cell) => cell.text));
    expect(texts[0]).toEqual(["Relatorio & cia"]);
    expect(texts[1]).toEqual(["Periodo 01/09/2026 a 28/09/2026"]);
    expect(texts).toContainEqual(["Cargas"]);
    expect(texts).toContainEqual(["Data", "Cliente", "Vale", "Peso", "Valor"]);
    expect(texts[texts.length - 1]).toEqual(["Observacao"]);
    expect(JSON.stringify(texts)).not.toContain("Titulo da aba");
  });

  it("numero vira numero com o formato; codigo continua texto", () => {
    const rows = parseSpreadsheetHtml(sampleHtml());
    const first = rows.find((row) => row[1]?.text === "Polimix <Concreto>");
    expect(first).toBeDefined();
    const [date, name, voucher, weight, value] = first ?? [];
    expect(date.number).toBeGreaterThan(46000);
    expect(date.format).toBe("dd/mm/yyyy");
    expect(name.number).toBeUndefined();
    expect(voucher.number).toBeUndefined();
    expect(voucher.text).toBe("004321");
    expect(weight.number).toBe(15000);
    expect(value.number).toBe(1234.56);
    expect(value.format).toBe("R$ #,##0.00");
    const total = rows.find((row) => row[0]?.text === "TOTAL");
    expect(total?.[0].kind).toBe("total");
  });
});

describe("buildXlsx", () => {
  it("gera um xlsx com as partes obrigatorias e celulas tipadas", () => {
    const files = unzip(spreadsheetHtmlToXlsx(sampleHtml(), "Cargas"));
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
      "xl/styles.xml"
    ]);
    const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain("<v>15000</v>");
    expect(sheet).toContain("<v>1234.56</v>");
    expect(sheet).toContain("Polimix &lt;Concreto&gt;");
    expect(sheet).toContain('<t xml:space="preserve">004321</t>');
    const styles = files.get("xl/styles.xml") ?? "";
    expect(styles).toContain('formatCode="R$ #,##0.00"');
    expect(files.get("xl/workbook.xml")).toContain('name="Cargas"');
  });

  it("celula mesclada vira mergeCell", () => {
    const files = unzip(
      buildXlsx([
        [{ text: "Total geral", kind: "total", colspan: 3, alignRight: false }],
        [{ text: "x", kind: "body", colspan: 1, alignRight: false }]
      ])
    );
    expect(files.get("xl/worksheets/sheet1.xml")).toContain('<mergeCell ref="A1:C1"/>');
  });
});

describe("apoio", () => {
  it("crc32 bate com o valor de referencia", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("nomes de coluna, aba e arquivo", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(safeSheetName("Cargas [09/2026]: resumo*")).toBe("Cargas 09 2026 resumo");
    expect(xlsxFileName("relatorio.xls")).toBe("relatorio.xlsx");
    expect(xlsxFileName("relatorio.xlsx")).toBe("relatorio.xlsx");
    expect(unescapeCssFormat("R\\$ \\#\\,\\#\\#0\\.00")).toBe("R$ #,##0.00");
  });
});
