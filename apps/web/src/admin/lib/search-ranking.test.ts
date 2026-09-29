import { describe, expect, it } from "vitest";

import { matchesSearch, normalizeSearchText, rankBySearch, searchTerms } from "./search-ranking";

describe("normalizeSearchText", () => {
  it("tira acento, caixa e pontuacao", () => {
    expect(normalizeSearchText("Pedreira São João Ltda.")).toBe("pedreira sao joao ltda");
  });
});

describe("searchTerms", () => {
  it("quebra a frase em termos e ignora a busca vazia", () => {
    expect(searchTerms(" sul  joao ")).toEqual(["sul", "joao"]);
    expect(searchTerms("  ")).toEqual([]);
  });
});

describe("matchesSearch", () => {
  it("exige todos os termos, em qualquer ordem e em qualquer campo", () => {
    const fields = ["Joao Pereira", "joao@pedreirasul.com", "Pedreira Sul"];
    expect(matchesSearch("sul joao", fields)).toBe(true);
    expect(matchesSearch("joao sul", fields)).toBe(true);
    expect(matchesSearch("joao norte", fields)).toBe(false);
  });

  it("ignora acento e pontuacao", () => {
    expect(matchesSearch("sao", ["Pedreira São João"])).toBe(true);
    expect(matchesSearch("12345678000190", ["12.345.678/0001-90"])).toBe(true);
  });

  it("busca vazia passa tudo", () => {
    expect(matchesSearch("   ", ["qualquer coisa"])).toBe(true);
    expect(matchesSearch("", [null, undefined])).toBe(true);
  });
});

describe("rankBySearch", () => {
  it("poe o que mais se aproxima no topo", () => {
    const companies = [
      { id: "1", name: "Transportes Beta Alfa Norte" },
      { id: "2", name: "Pedreira Alfa" },
      { id: "3", name: "Alfa" },
      { id: "4", name: "Pedreira Sul" }
    ];

    const ranked = rankBySearch(companies, (company) => [company.name], "alfa");

    expect(ranked.map((company) => company.id)).toEqual(["3", "2", "1"]);
  });

  it("busca vazia devolve a lista na ordem que veio", () => {
    const rows = [{ name: "b" }, { name: "a" }];
    expect(rankBySearch(rows, (row) => [row.name], "").map((row) => row.name)).toEqual(["b", "a"]);
  });

  it("nao muta a lista original", () => {
    const rows = [{ name: "b" }, { name: "a" }];
    rankBySearch(rows, (row) => [row.name], "a");
    expect(rows.map((row) => row.name)).toEqual(["b", "a"]);
  });
});
