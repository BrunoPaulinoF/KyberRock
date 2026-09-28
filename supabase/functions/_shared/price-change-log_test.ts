import { describe, expect, it } from "vitest";

import { priceChangeAction, priceChangeLogRowsFromDevice } from "./price-change-log";

const DEVICE = { id: "dev-1", company_id: "company-1", unit_id: "unit-1" };

describe("historico de preco especial vindo da balanca", () => {
  it("empresa, unidade e balanca saem do token, nao do payload", () => {
    const [row] = priceChangeLogRowsFromDevice(
      [
        {
          id: "log-1",
          company_id: "outra-pedreira",
          device_id: "outra-balanca",
          author_name: "Quem eu quiser",
          action: "alterado",
          customer_id: "c-1",
          customer_name: " Cliente A ",
          product_id: "p-1",
          product_description: "Brita 1",
          old_price_cents: 6500,
          new_price_cents: "7000",
          changed_at: "2026-09-28T12:00:00.000Z"
        }
      ],
      DEVICE
    );
    expect(row).toMatchObject({
      id: "log-1",
      company_id: "company-1",
      unit_id: "unit-1",
      device_id: "dev-1",
      author_name: null,
      source: "balanca",
      action: "alterado",
      customer_name: "Cliente A",
      old_price_cents: 6500,
      new_price_cents: 7000,
      changed_at: "2026-09-28T12:00:00.000Z"
    });
  });

  it("descarta linha sem id, com acao desconhecida ou sem data", () => {
    const rows = priceChangeLogRowsFromDevice(
      [
        { action: "alterado", changed_at: "2026-09-28T12:00:00Z" },
        { id: "a", action: "apagou", changed_at: "2026-09-28T12:00:00Z" },
        { id: "b", action: "removido", changed_at: "nao e data" },
        { id: "c", action: "removido", changed_at: "2026-09-28T12:00:00Z", new_price_cents: null }
      ],
      DEVICE
    );
    expect(rows.map((row) => row.id)).toEqual(["c"]);
    expect(rows[0].new_price_cents).toBeNull();
  });

  it("a acao sai do preco de antes e do de depois", () => {
    expect(priceChangeAction(null, 5000)).toBe("adicionado");
    expect(priceChangeAction(5000, 5500)).toBe("alterado");
    expect(priceChangeAction(5000, null)).toBe("removido");
    // Salvar o mesmo valor de novo nao e alteracao.
    expect(priceChangeAction(5000, 5000)).toBeNull();
  });
});
