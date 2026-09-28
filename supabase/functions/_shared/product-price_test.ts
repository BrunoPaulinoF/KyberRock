import { describe, expect, it } from "vitest";

import { splitProductsByUnitPrice } from "./product-price.ts";

describe("splitProductsByUnitPrice", () => {
  it("produto com preco vai como veio", () => {
    const row = { id: "p1", description: "Brita 1", unit_price_cents: 4500 };
    expect(splitProductsByUnitPrice([row])).toEqual({ priced: [row], unpriced: [] });
  });

  it("nulo sai SEM a coluna, para nao apagar o preco da nuvem", () => {
    const { priced, unpriced } = splitProductsByUnitPrice([
      { id: "p1", description: "Brita 1", unit_price_cents: null }
    ]);
    expect(priced).toEqual([]);
    expect(unpriced).toEqual([{ id: "p1", description: "Brita 1" }]);
    expect(Object.hasOwn(unpriced[0], "unit_price_cents")).toBe(false);
  });

  it("zero tambem nao e preco (e o que o OMIE manda no produto sem valor)", () => {
    const { unpriced } = splitProductsByUnitPrice([{ id: "p1", unit_price_cents: 0 }]);
    expect(unpriced).toEqual([{ id: "p1" }]);
  });

  it("balanca antiga, que nem manda a coluna, segue igual", () => {
    const row = { id: "p1", description: "Brita 1" };
    expect(splitProductsByUnitPrice([row])).toEqual({ priced: [], unpriced: [row] });
  });

  it("divide o lote misto", () => {
    const { priced, unpriced } = splitProductsByUnitPrice([
      { id: "a", unit_price_cents: 100 },
      { id: "b", unit_price_cents: null },
      { id: "c", unit_price_cents: 300 }
    ]);
    expect(priced.map((row) => row.id)).toEqual(["a", "c"]);
    expect(unpriced).toEqual([{ id: "b" }]);
  });
});
