import { beforeEach, describe, expect, it } from "vitest";

import { clearQueryCache, QUERY_CACHE_LIMIT, readCache, writeCache } from "./query-cache";

describe("query-cache", () => {
  beforeEach(() => clearQueryCache());

  it("devolve o que foi guardado pela chave", () => {
    writeCache("painel:c1", { total: 3 });
    expect(readCache("painel:c1")).toEqual({ total: 3 });
    expect(readCache("painel:c2")).toBeUndefined();
  });

  it("sem chave nao guarda nem le", () => {
    writeCache(null, 1);
    writeCache(undefined, 1);
    expect(readCache(null)).toBeUndefined();
    expect(readCache(undefined)).toBeUndefined();
  });

  it("guarda lista vazia e zero (dado de verdade, nao ausencia)", () => {
    writeCache("vazia", []);
    writeCache("zero", 0);
    expect(readCache("vazia")).toEqual([]);
    expect(readCache("zero")).toBe(0);
  });

  it("tira a leitura usada ha mais tempo quando passa do limite", () => {
    for (let index = 0; index < QUERY_CACHE_LIMIT; index++) writeCache(`k${index}`, index);
    // Usar de novo a primeira a poe no fim da fila.
    writeCache("k0", 0);
    writeCache("nova", "x");
    expect(readCache("k0")).toBe(0);
    expect(readCache("k1")).toBeUndefined();
    expect(readCache("nova")).toBe("x");
  });

  it("apaga tudo ao sair", () => {
    writeCache("a", 1);
    clearQueryCache();
    expect(readCache("a")).toBeUndefined();
  });
});
