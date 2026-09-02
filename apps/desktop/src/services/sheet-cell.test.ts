import { describe, expect, it } from "vitest";

import { SHEET_TEXT_FORMAT, classifySheetCell, isTextSheetHeader } from "./sheet-cell.js";

describe("classifySheetCell", () => {
  it("le valor em reais como numero", () => {
    expect(classifySheetCell("R$ 1.234,56", "Total (R$)")).toEqual({
      value: 1234.56,
      format: expect.stringContaining("0")
    });
    expect(classifySheetCell("-R$ 12,00", "Total (R$)")?.value).toBe(-12);
  });

  it("mantem a unidade do preco por tonelada no formato, e o valor puro na celula", () => {
    const cell = classifySheetCell("R$ 48,39/t", "Produto (R$/t)");
    expect(cell?.value).toBe(48.39);
    // "/t" vai como literal escapado para o Excel nao ler barra de fracao.
    expect(cell?.format).toContain("\\\\/\\\\t");
  });

  it("le peso, tonelagem, porcentagem e contagem", () => {
    expect(classifySheetCell("15.000 kg", "Peso (kg)")?.value).toBe(15000);
    expect(classifySheetCell("1.234,5 t", "Tonelagem")?.value).toBe(1234.5);
    // Porcentagem vai como fracao: o Excel multiplica por 100 na exibicao.
    expect(classifySheetCell("12,3%", "Participacao")?.value).toBeCloseTo(0.123, 10);
    expect(classifySheetCell("42", "Carregamentos")?.value).toBe(42);
    expect(classifySheetCell("1.234", "Carregamentos")?.value).toBe(1234);
  });

  it("le data, mes e data com hora como serial do Excel", () => {
    // 15/07/2026 = 46218 dias desde 30/12/1899.
    expect(classifySheetCell("15/07/2026", "Data")?.value).toBe(46218);
    expect(classifySheetCell("07/2026", "Mes")?.value).toBe(46204);
    expect(classifySheetCell("15/07/2026, 12:00", "Gerado em")?.value).toBe(46218.5);
    expect(classifySheetCell("31/02/2026", "Data")).toBeNull();
  });

  it("le duracao como hora de verdade, para a coluna somar", () => {
    const cell = classifySheetCell("1h 05min", "Tempo medio");
    expect(cell?.value).toBeCloseTo(65 / 1440, 10);
    expect(classifySheetCell("42min", "Tempo")?.value).toBeCloseTo(42 / 1440, 10);
  });

  it("nao converte identificador nenhum", () => {
    // O que o relatorio precisa preservar: documento, codigo, vale, nota e placa.
    expect(classifySheetCell("12.345.678/0001-99", "Valor")).toBeNull();
    expect(classifySheetCell("12345678000199", "Valor")).toBeNull();
    expect(classifySheetCell("004321", "Vale")).toBeNull();
    expect(classifySheetCell("004321", "Valor")).toBeNull();
    expect(classifySheetCell("28727", "Nota fiscal")).toBeNull();
    expect(classifySheetCell("28727", "Valor")).toBeNull();
    expect(classifySheetCell("CVP7E80", "Placa")).toBeNull();
    expect(classifySheetCell("1/3", "Parcela")).toBeNull();
    expect(classifySheetCell("(11) 99999-9999", "Valor")).toBeNull();
    expect(classifySheetCell("-", "Total (R$)")).toBeNull();
    expect(classifySheetCell("", "Total (R$)")).toBeNull();
  });

  it("nao deixa o cabecalho de identificador derrubar coluna de dinheiro", () => {
    // "Nota fiscal" e identificador; "Sem nota" e o valor que ficou fora da nota.
    expect(isTextSheetHeader("Nota fiscal")).toBe(true);
    expect(isTextSheetHeader("Sem nota")).toBe(false);
    expect(classifySheetCell("R$ 900,00", "Sem nota")?.value).toBe(900);
    expect(isTextSheetHeader("CNPJ / CPF")).toBe(true);
    expect(isTextSheetHeader("Operacoes")).toBe(false);
    expect(isTextSheetHeader("Op.")).toBe(true);
  });

  it("tem formato de texto para o que fica como esta", () => {
    expect(SHEET_TEXT_FORMAT).toBe("\\@");
  });
});
