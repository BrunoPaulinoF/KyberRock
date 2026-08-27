import { describe, expect, it } from "vitest";

import {
  isLiveRow,
  naturalKeyOf,
  resolvePriceConflicts,
  winsConflict,
  PRICE_MASTER_TABLES
} from "./price-master-conflicts";

const PAR = ["cust-1", "prod-1"];

describe("conflito de chave natural entre balancas principais", () => {
  it("a linha editada por ultimo derruba a que estava na nuvem", () => {
    const resolucao = resolvePriceConflicts(
      [{ id: "pc-a", key: PAR, updatedAt: "2026-08-27T12:00:00.000Z" }],
      [{ id: "pc-b", key: PAR, updatedAt: "2026-08-27T10:00:00.000Z" }]
    );

    expect(resolucao).toEqual({ retire: ["pc-b"], skip: [] });
  });

  /**
   * O outro lado da mesma regra — e o que impede as duas principais de se derrubarem
   * alternadamente a cada ciclo. Perder e SAIR do payload: tentar gravar estouraria o
   * indice unico e viraria erro de sincronizacao eterno num caso que nao e erro nenhum.
   */
  it("a linha mais antiga sai do payload em vez de ser recusada pelo indice", () => {
    const resolucao = resolvePriceConflicts(
      [{ id: "pc-a", key: PAR, updatedAt: "2026-08-27T10:00:00.000Z" }],
      [{ id: "pc-b", key: PAR, updatedAt: "2026-08-27T12:00:00.000Z" }]
    );

    expect(resolucao).toEqual({ retire: [], skip: ["pc-a"] });
  });

  /**
   * As duas principais chegam a MESMA conclusao sem se falar — e o que faz o preco
   * convergir em vez de oscilar. Aqui a mesma disputa e resolvida pelos dois lados.
   */
  it("as duas pontas decidem igual, seja qual for quem sincroniza primeiro", () => {
    const a = { id: "pc-a", key: PAR, updatedAt: "2026-08-27T12:00:00.000Z" };
    const b = { id: "pc-b", key: PAR, updatedAt: "2026-08-27T10:00:00.000Z" };

    // A publica encontrando B na nuvem: A vence.
    expect(resolvePriceConflicts([a], [b])).toEqual({ retire: ["pc-b"], skip: [] });
    // B publica encontrando A na nuvem: A continua vencendo.
    expect(resolvePriceConflicts([b], [a])).toEqual({ retire: [], skip: ["pc-b"] });
  });

  it("empate no relogio cai no id, e o desempate e o mesmo dos dois lados", () => {
    const mesmaHora = "2026-08-27T12:00:00.000Z";
    const a = { id: "pc-a", key: PAR, updatedAt: mesmaHora };
    const b = { id: "pc-b", key: PAR, updatedAt: mesmaHora };

    expect(winsConflict(b, a)).toBe(true);
    expect(winsConflict(a, b)).toBe(false);
    expect(resolvePriceConflicts([b], [a])).toEqual({ retire: ["pc-a"], skip: [] });
    expect(resolvePriceConflicts([a], [b])).toEqual({ retire: [], skip: ["pc-a"] });
  });

  it("linha sem hora de edicao vale como a mais antiga", () => {
    expect(
      winsConflict(
        { id: "pc-a", key: PAR, updatedAt: null },
        { id: "pc-b", key: PAR, updatedAt: "2026-08-27T10:00:00.000Z" }
      )
    ).toBe(false);
    // Hora invalida nao pode virar NaN e passar a ganhar de todo mundo por acidente.
    expect(
      winsConflict(
        { id: "pc-a", key: PAR, updatedAt: "isto nao e uma data" },
        { id: "pc-b", key: PAR, updatedAt: "2026-08-27T10:00:00.000Z" }
      )
    ).toBe(false);
  });

  it("nao mexe na propria linha nem em par que a principal nao enviou", () => {
    const resolucao = resolvePriceConflicts(
      [{ id: "pc-a", key: PAR, updatedAt: "2026-08-27T12:00:00.000Z" }],
      [
        { id: "pc-a", key: PAR, updatedAt: "2026-08-27T10:00:00.000Z" },
        { id: "outra", key: ["cust-2", "prod-1"], updatedAt: "2026-08-27T10:00:00.000Z" }
      ]
    );

    expect(resolucao).toEqual({ retire: [], skip: [] });
  });

  // A principal excluindo um preco nao ocupa a chave: quem chama filtra com `isLiveRow`
  // antes, para nao apagar um preco que ninguem pediu para apagar.
  it("exclusao enviada pela principal nao entra na disputa", () => {
    const vivas = [{ id: "pc-a", deleted_at: "2026-08-27T10:00:00.000Z" }].filter(isLiveRow);

    expect(vivas).toEqual([]);
    expect(isLiveRow({ id: "a" })).toBe(true);
    expect(isLiveRow({ id: "a", deleted_at: null })).toBe(true);
  });

  it("trata coluna ausente e nula como a mesma chave (frete sem produto)", () => {
    expect(naturalKeyOf({ customer_id: "cust-1" }, ["customer_id", "product_id"])).toEqual([
      "cust-1",
      null
    ]);
    expect(
      naturalKeyOf({ customer_id: "cust-1", product_id: null }, ["customer_id", "product_id"])
    ).toEqual(["cust-1", null]);
  });

  it("so lista tabela de preco com chave natural disputada", () => {
    expect(PRICE_MASTER_TABLES.map((entry) => entry.table)).toEqual([
      "customer_special_prices",
      "product_default_prices",
      "customer_freight_rules"
    ]);
  });
});
