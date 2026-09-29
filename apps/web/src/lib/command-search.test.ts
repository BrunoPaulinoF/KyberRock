import { describe, expect, it } from "vitest";

import {
  commandScore,
  normalizeSearch,
  plateFromQuery,
  rankCommands,
  receiptCodeFromQuery
} from "./command-search";

const commands = [
  { id: "painel", label: "Painel", keywords: ["início"] },
  { id: "operacoes", label: "Operações", keywords: ["pesagens", "fila"] },
  { id: "relatorios", label: "Relatórios", keywords: ["fechamento diário"] },
  { id: "relatorio-cliente", label: "Relatório por cliente" },
  { id: "fechamento", label: "Fechamento de faturas" }
];

describe("normalizeSearch", () => {
  it("tira acento, caixa e espaco repetido", () => {
    expect(normalizeSearch("  Operações   Abertas ")).toBe("operacoes abertas");
  });
});

describe("rankCommands", () => {
  it("acha sem acento e sem maiuscula", () => {
    expect(rankCommands("operacoes", commands).map((c) => c.id)).toEqual(["operacoes"]);
  });

  it("nome que comeca com o texto vem antes do que so contem", () => {
    expect(rankCommands("rel", commands).map((c) => c.id)).toEqual([
      "relatorios",
      "relatorio-cliente"
    ]);
  });

  it("acha pelos outros nomes da tela", () => {
    expect(rankCommands("fila", commands).map((c) => c.id)).toEqual(["operacoes"]);
    expect(rankCommands("fechamento", commands).map((c) => c.id)).toEqual([
      "fechamento",
      "relatorios"
    ]);
  });

  it("texto vazio mostra tudo na ordem do menu", () => {
    expect(rankCommands("", commands, 3).map((c) => c.id)).toEqual([
      "painel",
      "operacoes",
      "relatorios"
    ]);
    expect(commandScore("xyz", commands[0])).toBeNull();
  });
});

describe("plateFromQuery", () => {
  it("placa antiga e Mercosul, com ou sem traco", () => {
    expect(plateFromQuery("abc-1234")).toBe("ABC1234");
    expect(plateFromQuery("RKX2B47")).toBe("RKX2B47");
    expect(plateFromQuery("rkx 2b47")).toBe("RKX2B47");
  });

  it("o que nao e placa fica de fora", () => {
    expect(plateFromQuery("operacoes")).toBeNull();
    expect(plateFromQuery("AB1234")).toBeNull();
    expect(plateFromQuery("1234567")).toBeNull();
  });
});

describe("receiptCodeFromQuery", () => {
  it("numero do topo e da copia", () => {
    expect(receiptCodeFromQuery("003249")).toBe("003249");
    expect(receiptCodeFromQuery("COD 003249")).toBe("003249");
    expect(receiptCodeFromQuery("000004038-4")).toBe("000004038-4");
  });

  it("texto que nao e numero de cupom", () => {
    expect(receiptCodeFromQuery("12")).toBeNull();
    expect(receiptCodeFromQuery("brita")).toBeNull();
  });
});
