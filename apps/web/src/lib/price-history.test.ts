import { describe, expect, it } from "vitest";

import {
  priceChangeActionLabel,
  priceChangePercent,
  priceChangeSourceLabel,
  priceChangeTone,
  priceHistorySearchFilter
} from "./price-history";

describe("historico de preco especial no site", () => {
  it("rotula a acao e a origem", () => {
    expect(priceChangeActionLabel("adicionado")).toBe("Adicionado");
    expect(priceChangeActionLabel("removido")).toBe("Excluido");
    expect(priceChangeSourceLabel("balanca")).toBe("Balanca");
    expect(priceChangeSourceLabel("site")).toBe("KyberRock Web");
  });

  it("baixa de preco chama atencao; subida e informativa", () => {
    const base = { old_price_cents: 7000, new_price_cents: 6500 };
    expect(priceChangeTone({ ...base, action: "alterado" })).toBe("warning");
    expect(
      priceChangeTone({ action: "alterado", old_price_cents: 6500, new_price_cents: 7000 })
    ).toBe("info");
    expect(priceChangeTone({ ...base, action: "adicionado" })).toBe("success");
    expect(priceChangeTone({ ...base, action: "removido" })).toBe("danger");
  });

  it("variacao so quando houve troca de valor", () => {
    expect(priceChangePercent({ old_price_cents: 6500, new_price_cents: 7000 })).toBe("+7,69%");
    expect(priceChangePercent({ old_price_cents: 7000, new_price_cents: 6500 })).toBe("-7,14%");
    expect(priceChangePercent({ old_price_cents: null, new_price_cents: 7000 })).toBeNull();
    expect(priceChangePercent({ old_price_cents: 7000, new_price_cents: null })).toBeNull();
  });

  it("busca em cliente, produto e quem alterou, sem quebrar o filtro do PostgREST", () => {
    expect(priceHistorySearchFilter("  ")).toBeNull();
    expect(priceHistorySearchFilter("Silva, Jose")).toBe(
      "customer_name.ilike.*Silva* Jose*,product_description.ilike.*Silva* Jose*,author_name.ilike.*Silva* Jose*"
    );
  });
});
