import { describe, expect, it } from "vitest";

import {
  compactSearchText,
  normalizeSearchText,
  rankByText,
  rankSearchMatches,
  scoreRow,
  scoreTermAgainstText,
  searchTerms
} from "./search-ranking.js";

const CUSTOMER_FIELDS = [
  { key: "tradeName", weight: 1 },
  { key: "legalName", weight: 0.9 },
  { key: "document", weight: 0.6 },
  { key: "city", weight: 0.4 }
];

function customer(
  tradeName: string,
  legalName = tradeName,
  document = "",
  city = ""
): Record<string, unknown> {
  return { tradeName, legalName, document, city };
}

describe("normalizeSearchText", () => {
  it("tira acento, caixa e pontuacao", () => {
    expect(normalizeSearchText("Construção São João Ltda.")).toBe("construcao sao joao ltda");
  });

  it("texto so de pontuacao vira vazio", () => {
    expect(normalizeSearchText("--/.")).toBe("");
  });
});

describe("compactSearchText", () => {
  it("casa o documento escrito com pontuacao com o gravado sem ela", () => {
    expect(compactSearchText("12.345.678/0001-90")).toBe("12345678000190");
    expect(compactSearchText("ABC-1D23")).toBe("abc1d23");
  });
});

describe("searchTerms", () => {
  it("quebra a frase em termos", () => {
    expect(searchTerms("  Joao   Silva ")).toEqual(["joao", "silva"]);
  });

  it("busca vazia nao tem termo", () => {
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("scoreTermAgainstText", () => {
  it("igual ganha de comeco, que ganha de comeco de palavra, que ganha de trecho solto", () => {
    const exact = scoreTermAgainstText("levisa", "Levisa");
    const prefix = scoreTermAgainstText("levisa", "Levisa Transportes");
    const wordStart = scoreTermAgainstText("levisa", "Transportadora Levisa Norte");
    const inside = scoreTermAgainstText("evisa", "Transportadora Levisa Norte");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it("nome mais curto desempata dentro do mesmo degrau", () => {
    expect(scoreTermAgainstText("levisa", "Levisa Ltda")).toBeGreaterThan(
      scoreTermAgainstText("levisa", "Levisa Transportes e Locacoes Ltda")
    );
  });

  it("acha o CNPJ digitado com pontuacao e a placa digitada com hifen", () => {
    expect(scoreTermAgainstText("12345678000190", "12.345.678/0001-90")).toBeGreaterThan(0);
    expect(scoreTermAgainstText("abc1d23", "ABC-1D23")).toBeGreaterThan(0);
  });

  it("nao casa o que nao esta la", () => {
    expect(scoreTermAgainstText("levisa", "Pedreira Sul")).toBe(0);
  });

  it("casar por pontuacao nunca passa na frente de casar pelo nome", () => {
    // O CNPJ que contem "1234" no meio nao pode subir acima do cliente cujo NOME comeca
    // com o que foi digitado.
    expect(scoreTermAgainstText("1234", "Cliente 1234 Ltda")).toBeGreaterThan(
      scoreTermAgainstText("1234", "98.712.345/0001-00")
    );
  });
});

describe("scoreRow", () => {
  it("cada termo acha o melhor campo por conta propria", () => {
    const row = customer("Levisa", "Levisa Transportes Ltda", "12.345.678/0001-90", "Sorocaba");
    expect(scoreRow(row, CUSTOMER_FIELDS, ["levisa", "sorocaba"])).not.toBeNull();
  });

  it("um termo sem casa nenhuma elimina a linha", () => {
    const row = customer("Levisa", "Levisa Transportes Ltda");
    expect(scoreRow(row, CUSTOMER_FIELDS, ["levisa", "brita"])).toBeNull();
  });

  it("campo de peso maior rende mais que o mesmo casamento num campo de apoio", () => {
    const byName = customer("Sorocaba", "Sorocaba Ltda", "", "Ibiuna");
    const byCity = customer("Levisa", "Levisa Ltda", "", "Sorocaba");
    const nameScore = scoreRow(byName, CUSTOMER_FIELDS, ["sorocaba"]);
    const cityScore = scoreRow(byCity, CUSTOMER_FIELDS, ["sorocaba"]);
    expect(nameScore).not.toBeNull();
    expect(cityScore).not.toBeNull();
    expect(nameScore as number).toBeGreaterThan(cityScore as number);
  });

  it("campo numerico tambem e pesquisavel", () => {
    expect(scoreRow({ omieCode: 4711 }, ["omieCode"], ["4711"])).not.toBeNull();
  });

  it("sem termo nenhum tudo passa", () => {
    expect(scoreRow(customer("Levisa"), CUSTOMER_FIELDS, [])).toBe(0);
  });
});

describe("rankSearchMatches", () => {
  it("poe o que mais se aproxima no topo e o mais distante embaixo", () => {
    const rows = [
      customer("Transportadora Levisa Norte"),
      customer("Levisa Transportes e Locacoes"),
      customer("Levisa"),
      customer("Pedreira Sul")
    ];

    const ranked = rankSearchMatches(rows, CUSTOMER_FIELDS, "levisa");

    expect(ranked.map((row) => row.tradeName)).toEqual([
      "Levisa",
      "Levisa Transportes e Locacoes",
      "Transportadora Levisa Norte"
    ]);
  });

  it("digitar mais termos so pode diminuir a lista", () => {
    const rows = [
      customer("Joao Silva Transportes"),
      customer("Joao Pedro Cargas"),
      customer("Maria Silva Ltda")
    ];

    expect(rankSearchMatches(rows, CUSTOMER_FIELDS, "joao")).toHaveLength(2);
    expect(rankSearchMatches(rows, CUSTOMER_FIELDS, "joao silva")).toHaveLength(1);
  });

  it("a ordem dos termos nao importa", () => {
    const rows = [customer("Joao", "Joao da Pedreira Sul")];
    expect(rankSearchMatches(rows, CUSTOMER_FIELDS, "sul joao")).toHaveLength(1);
    expect(rankSearchMatches(rows, CUSTOMER_FIELDS, "joao sul")).toHaveLength(1);
  });

  it("busca vazia devolve a lista como veio", () => {
    const rows = [customer("B"), customer("A")];
    expect(rankSearchMatches(rows, CUSTOMER_FIELDS, "  ").map((row) => row.tradeName)).toEqual([
      "B",
      "A"
    ]);
  });

  it("empate cai no criterio de desempate de quem chamou", () => {
    const rows = [customer("Brita Zulu"), customer("Brita Alfa")];
    const ranked = rankSearchMatches(rows, CUSTOMER_FIELDS, "brita", {
      tieBreak: (a, b) => String(a.tradeName).localeCompare(String(b.tradeName), "pt-BR")
    });
    expect(ranked.map((row) => row.tradeName)).toEqual(["Brita Alfa", "Brita Zulu"]);
  });

  it("nao devolve a lista original mutada", () => {
    const rows = [customer("B"), customer("A")];
    rankSearchMatches(rows, CUSTOMER_FIELDS, "a");
    expect(rows.map((row) => row.tradeName)).toEqual(["B", "A"]);
  });
});

describe("rankByText", () => {
  it("ordena pelo texto ja montado", () => {
    const items = [
      { id: "1", text: "Pedreira Sul - brita 1 - ABC1D23" },
      { id: "2", text: "Brita 1 - Levisa - XYZ2A34" }
    ];

    const ranked = rankByText(items, (item) => item.text, "brita");
    expect(ranked.map((item) => item.id)).toEqual(["2", "1"]);
  });

  it("exige todos os termos", () => {
    const items = [{ id: "1", text: "Joao Silva brita" }];
    expect(rankByText(items, (item) => item.text, "joao brita")).toHaveLength(1);
    expect(rankByText(items, (item) => item.text, "joao rachao")).toHaveLength(0);
  });

  it("busca vazia devolve tudo na ordem que veio", () => {
    const items = [
      { id: "1", text: "b" },
      { id: "2", text: "a" }
    ];
    expect(rankByText(items, (item) => item.text, "").map((item) => item.id)).toEqual(["1", "2"]);
  });
});
