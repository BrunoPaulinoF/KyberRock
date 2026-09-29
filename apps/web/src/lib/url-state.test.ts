import { describe, expect, it } from "vitest";

import { mergeParam, rememberedKey } from "./url-state";

describe("mergeParam", () => {
  it("poe, troca e tira um filtro sem mexer nos outros", () => {
    const base = new URLSearchParams("aba=concluidas&busca=brita");
    expect(mergeParam(base, "placa", "ABC1234", "").toString()).toBe(
      "aba=concluidas&busca=brita&placa=ABC1234"
    );
    expect(mergeParam(base, "busca", "areia", "").toString()).toBe("aba=concluidas&busca=areia");
    expect(mergeParam(base, "busca", "", "").toString()).toBe("aba=concluidas");
  });

  it("valor igual ao padrao sai do endereco", () => {
    const base = new URLSearchParams("aba=abertas");
    expect(mergeParam(base, "aba", "abertas", "abertas").toString()).toBe("");
  });

  it("duas mudancas em sequencia se somam (o que o clique com dois filtros faz)", () => {
    const first = mergeParam(new URLSearchParams(), "de", "2026-09-01", "");
    const second = mergeParam(first, "ate", "2026-09-30", "");
    expect(second.toString()).toBe("de=2026-09-01&ate=2026-09-30");
  });

  it("nao altera o original", () => {
    const base = new URLSearchParams("a=1");
    mergeParam(base, "b", "2", "");
    expect(base.toString()).toBe("a=1");
  });
});

describe("rememberedKey", () => {
  it("separa por tela e por filtro", () => {
    expect(rememberedKey("/operacoes", "placa")).toBe("kr.filtro:/operacoes:placa");
  });
});
