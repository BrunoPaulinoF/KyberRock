import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  columnIndexFromReference,
  detectDelimiter,
  parseDelimitedText,
  readSpreadsheet,
  toCsvFile,
  toSheetTable
} from "./spreadsheet-read";

describe("spreadsheet-read", () => {
  const temporaryDirectories: string[] = [];

  function writeTemporaryFile(name: string, content: Buffer | string): string {
    const directory = mkdtempSync(path.join(tmpdir(), "kyberrock-sheet-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, name);
    writeFileSync(filePath, content);
    return filePath;
  }

  afterEach(() => {
    while (temporaryDirectories.length > 0) {
      rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
    }
  });

  it("detects the Excel pt-BR delimiter and keeps decimal commas intact", () => {
    const text = "Nome;Preco Brita 1\r\nPedreira Sul;45,90\r\n";
    expect(detectDelimiter(text)).toBe(";");

    const matrix = parseDelimitedText(text);
    expect(matrix[1]).toEqual(["Pedreira Sul", "45,90"]);
  });

  it("parses quoted fields with delimiters, quotes and line breaks", () => {
    const text = 'Nome;Obs\r\n"Silva; Filhos";"disse ""ok""\nna sexta"\r\n';
    const matrix = parseDelimitedText(text);

    expect(matrix[1][0]).toBe("Silva; Filhos");
    expect(matrix[1][1]).toBe('disse "ok"\nna sexta');
  });

  it("drops the UTF-8 BOM so the first header still matches", () => {
    const filePath = writeTemporaryFile(
      "clientes.csv",
      toCsvFile([
        ["Nome", "CNPJ"],
        ["Pedreira", "1"]
      ])
    );
    const table = readSpreadsheet(filePath);

    expect(table.headers).toEqual(["Nome", "CNPJ"]);
    expect(table.rows[0].cells["Nome"]).toBe("Pedreira");
  });

  it("uses the first non-empty row as the header and keeps the original line numbers", () => {
    const table = toSheetTable("Plan1", [
      [],
      ["", ""],
      ["Nome", "CNPJ"],
      ["Pedreira", "123"],
      ["", ""]
    ]);

    expect(table.headers).toEqual(["Nome", "CNPJ"]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].lineNumber).toBe(4);
  });

  it("keeps duplicated headers addressable instead of overwriting one another", () => {
    const table = toSheetTable("Plan1", [
      ["Telefone", "Telefone"],
      ["1199", "1188"]
    ]);

    expect(table.headers).toEqual(["Telefone", "Telefone (2)"]);
    expect(table.rows[0].cells["Telefone (2)"]).toBe("1188");
  });

  it("reads an xlsx: shared strings, inline strings, numbers and skipped columns", () => {
    const filePath = writeTemporaryFile("clientes.xlsx", buildXlsx());
    const table = readSpreadsheet(filePath);

    expect(table.name).toBe("Clientes");
    expect(table.headers).toEqual(["Nome", "CNPJ", "Preco Brita 1"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells).toEqual({
      Nome: "Pedreira São João",
      CNPJ: "19131243000197",
      "Preco Brita 1": "45.9"
    });
    // Linha com a coluna do meio vazia: o valor precisa cair na coluna certa.
    expect(table.rows[1].cells["Nome"]).toBe("Transportes A & B");
    expect(table.rows[1].cells["CNPJ"]).toBe("");
    expect(table.rows[1].cells["Preco Brita 1"]).toBe("52");
  });

  it("selects the requested xlsx sheet and explains the options when it does not exist", () => {
    const filePath = writeTemporaryFile("clientes.xlsx", buildXlsx());

    expect(readSpreadsheet(filePath, { sheet: 1 }).name).toBe("Clientes");
    expect(() => readSpreadsheet(filePath, { sheet: "Precos" })).toThrow(/Clientes/);
  });

  it("maps spreadsheet references to column indexes", () => {
    expect(columnIndexFromReference("A1")).toBe(0);
    expect(columnIndexFromReference("Z9")).toBe(25);
    expect(columnIndexFromReference("AB12")).toBe(27);
  });
});

// ---------------------------------------------------------------------------
// XLSX minimo montado a mao (ZIP com entradas sem compressao)
// ---------------------------------------------------------------------------

function buildXlsx(): Buffer {
  const sharedStrings = [
    "Nome",
    "CNPJ",
    "Preco Brita 1",
    "Pedreira São João",
    "19131243000197",
    "Transportes A & B"
  ];

  return buildZip([
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Clientes" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`
    },
    {
      name: "xl/sharedStrings.xml",
      content: `<?xml version="1.0"?><sst>${sharedStrings
        .map((value) => `<si><t>${escapeXml(value)}</t></si>`)
        .join("")}</sst>`
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        `<?xml version="1.0"?><worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>45.9</v></c></row>` +
        `<row r="3"><c r="A3" t="inlineStr"><is><t>Transportes A &amp; B</t></is></c><c r="C3"><v>52</v></c></row>` +
        `</sheetData></worksheet>`
    }
  ]);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface ZipEntry {
  name: string;
  content: string;
}

/** ZIP com entradas "stored" (metodo 0) — suficiente para exercitar o leitor. */
function buildZip(entries: readonly ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const dataBuffer = Buffer.from(entry.content, "utf8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 8); // metodo 0 (sem compressao)
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    localChunks.push(localHeader, nameBuffer, dataBuffer);
    centralChunks.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const central = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, central, end]);
}
