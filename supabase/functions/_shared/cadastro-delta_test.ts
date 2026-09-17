import { describe, expect, it } from "vitest";

import { parseCadastroDelta } from "./cadastro-delta.ts";

describe("parseCadastroDelta", () => {
  it("minuto sem cadastro novo: lote valido e vazio", () => {
    // A resposta tipica. Vazio NAO e o mesmo que `null`: aqui o delta veio e nao tinha nada,
    // e a balanca pode confiar nisso e nao consultar tabela nenhuma.
    const delta = parseCadastroDelta({ tables: {}, truncated: [] });
    expect(delta).toEqual({ tables: {}, truncated: new Set() });
  });

  it("le as linhas de quem mudou", () => {
    const delta = parseCadastroDelta({
      tables: { customers: [{ id: "c1" }, { id: "c2" }], carriers: [{ id: "t1" }] },
      truncated: []
    });
    expect(delta?.tables.customers).toHaveLength(2);
    expect(delta?.tables.carriers).toEqual([{ id: "t1" }]);
    // Tabela que nao mudou nao aparece — e quem le trata ausencia como lista vazia.
    expect(delta?.tables.products).toBeUndefined();
  });

  it("tabela truncada nao traz linha nenhuma", () => {
    // Meia lista avancaria o cursor por cima do resto: o que passou do teto volta a ser
    // buscado paginado, e ate la nao entra.
    const delta = parseCadastroDelta({
      tables: { customers: [{ id: "c1" }] },
      truncated: ["customers"]
    });
    expect(delta?.truncated.has("customers")).toBe(true);
    expect(delta?.tables.customers).toBeUndefined();
  });

  it("resposta fora do formato manda usar o caminho antigo", () => {
    expect(parseCadastroDelta(null)).toBeNull();
    expect(parseCadastroDelta("tudo certo")).toBeNull();
    expect(parseCadastroDelta([])).toBeNull();
    expect(parseCadastroDelta({ truncated: [] })).toBeNull();
    expect(parseCadastroDelta({ tables: {} })).toBeNull();
    expect(parseCadastroDelta({ tables: [], truncated: [] })).toBeNull();
    expect(parseCadastroDelta({ tables: {}, truncated: "customers" })).toBeNull();
    expect(parseCadastroDelta({ tables: {}, truncated: [7] })).toBeNull();
  });

  it("linha que nao e objeto derruba o lote inteiro, nao so ela", () => {
    // Entrar pela metade custaria cadastro faltando numa balanca; recusar custa uma rodada
    // de viagens a mais.
    expect(parseCadastroDelta({ tables: { customers: ["c1"] }, truncated: [] })).toBeNull();
    expect(parseCadastroDelta({ tables: { customers: "c1" }, truncated: [] })).toBeNull();
  });
});
