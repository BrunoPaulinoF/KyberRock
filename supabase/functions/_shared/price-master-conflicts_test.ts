import { describe, expect, it } from "vitest";

import {
  findRowsToRetire,
  isLiveRow,
  naturalKeyOf,
  PRICE_MASTER_TABLES
} from "./price-master-conflicts";

describe("conflito de chave natural no cadastro de preco da principal", () => {
  it("derruba a linha da outra balanca que ocupa a mesma chave", () => {
    const retire = findRowsToRetire(
      [{ id: "master-1", key: ["cust-1", "prod-1"] }],
      [{ id: "follower-1", key: ["cust-1", "prod-1"] }]
    );

    expect(retire).toEqual(["follower-1"]);
  });

  it("nao mexe na propria linha da principal nem em par que ela nao enviou", () => {
    const retire = findRowsToRetire(
      [{ id: "master-1", key: ["cust-1", "prod-1"] }],
      [
        { id: "master-1", key: ["cust-1", "prod-1"] },
        { id: "outra-1", key: ["cust-2", "prod-1"] }
      ]
    );

    expect(retire).toEqual([]);
  });

  // A principal excluindo um preco nao ocupa a chave: derrubar a linha de outra maquina ali
  // apagaria um preco que ninguem pediu para apagar.
  it("exclusao enviada pela principal nao derruba linha nenhuma", () => {
    const incoming = [{ id: "master-1", deleted_at: "2026-08-27T10:00:00.000Z" }].filter(isLiveRow);

    expect(incoming).toEqual([]);
    expect(findRowsToRetire([], [{ id: "follower-1", key: ["cust-1", "prod-1"] }])).toEqual([]);
  });

  it("trata coluna ausente e nula como a mesma chave (frete sem produto)", () => {
    expect(naturalKeyOf({ customer_id: "cust-1" }, ["customer_id", "product_id"])).toEqual([
      "cust-1",
      null
    ]);
    expect(
      naturalKeyOf({ customer_id: "cust-1", product_id: null }, ["customer_id", "product_id"])
    ).toEqual(["cust-1", null]);

    expect(
      findRowsToRetire(
        [
          {
            id: "master-1",
            key: naturalKeyOf({ customer_id: "cust-1" }, ["customer_id", "product_id"])
          }
        ],
        [
          {
            id: "follower-1",
            key: naturalKeyOf({ customer_id: "cust-1", product_id: null }, [
              "customer_id",
              "product_id"
            ])
          }
        ]
      )
    ).toEqual(["follower-1"]);
  });

  it("so lista tabela de preco com chave natural disputada", () => {
    expect(PRICE_MASTER_TABLES.map((entry) => entry.table)).toEqual([
      "customer_special_prices",
      "product_default_prices",
      "customer_freight_rules"
    ]);
    // Tabela de preco (cabecalho, itens e vinculo) nao tem indice unico por chave natural
    // na nuvem: nada e recusado ali, entao nao ha o que liberar.
    for (const entry of PRICE_MASTER_TABLES) {
      expect(entry.naturalKey.length).toBeGreaterThan(0);
    }
  });

  it("linha viva e a que nao tem deleted_at", () => {
    expect(isLiveRow({ id: "a" })).toBe(true);
    expect(isLiveRow({ id: "a", deleted_at: null })).toBe(true);
    expect(isLiveRow({ id: "a", deleted_at: "2026-08-27T10:00:00.000Z" })).toBe(false);
  });
});
