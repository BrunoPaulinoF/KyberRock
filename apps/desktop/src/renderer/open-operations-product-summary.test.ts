import { describe, expect, it } from "vitest";

import { countOpenOperationsByProduct } from "./open-operations-product-summary";

function operation(productId: string | null, productDescription: string) {
  return { productId, productDescription };
}

describe("countOpenOperationsByProduct", () => {
  it("conta as operacoes abertas de cada produto", () => {
    const counts = countOpenOperationsByProduct([
      operation("prod-brita-1", "Brita 1"),
      operation("prod-po", "Po de pedra"),
      operation("prod-brita-1", "Brita 1"),
      operation("prod-brita-1", "Brita 1")
    ]);

    expect(counts).toEqual([
      { key: "prod-brita-1", label: "Brita 1", count: 3 },
      { key: "prod-po", label: "Po de pedra", count: 1 }
    ]);
  });

  it("ordena pela maior fila e, no empate, pelo nome do produto", () => {
    const counts = countOpenOperationsByProduct([
      operation("prod-rachao", "Rachao"),
      operation("prod-brita-0", "Brita 0"),
      operation("prod-brita-1", "Brita 1"),
      operation("prod-brita-1", "Brita 1")
    ]);

    expect(counts.map((item) => `${item.label}:${item.count}`)).toEqual([
      "Brita 1:2",
      "Brita 0:1",
      "Rachao:1"
    ]);
  });

  // O cadastro e quem manda: a descricao editada no meio do dia nao pode quebrar a
  // contagem do mesmo produto em dois campos.
  it("agrupa pelo cadastro do produto mesmo com descricoes diferentes", () => {
    const counts = countOpenOperationsByProduct([
      operation("prod-brita-1", "Brita 1"),
      operation("prod-brita-1", "BRITA 1 - LAVADA")
    ]);

    expect(counts).toEqual([{ key: "prod-brita-1", label: "Brita 1", count: 2 }]);
  });

  it("agrupa pela descricao quando a operacao nao tem produto cadastrado", () => {
    const counts = countOpenOperationsByProduct([
      operation(null, "Brita 1"),
      operation(null, "brita 1"),
      operation(null, "   ")
    ]);

    expect(counts).toEqual([
      { key: "descricao:brita 1", label: "Brita 1", count: 2 },
      { key: "descricao:sem produto", label: "Sem produto", count: 1 }
    ]);
  });

  it("devolve lista vazia sem operacoes abertas", () => {
    expect(countOpenOperationsByProduct([])).toEqual([]);
  });
});
