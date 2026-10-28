import { describe, expect, it } from "vitest";

import {
  MAX_BANK_MOVEMENT_ACCOUNTS,
  normalizeBankMovementAccounts,
  parseCheckingAccounts
} from "./omie-checking-accounts.ts";

describe("parseCheckingAccounts", () => {
  // Formato real do ListarContasCorrentes (Pedreira Ibiuna, 28/10/2026), so os campos usados.
  const response = {
    pagina: 1,
    total_de_paginas: 1,
    ListarContasCorrentes: [
      { nCodCC: 11455896303, descricao: "Caixinha", tipo_conta_corrente: "CX", inativo: "N" },
      { nCodCC: 11455922417, descricao: "Itaú Unibanco", tipo_conta_corrente: "CC", inativo: "N" },
      { nCodCC: 11455922454, descricao: "Sicoob", tipo_conta_corrente: "CC", inativo: "S" },
      { nCodCC: "", descricao: "Sem codigo" },
      { nCodCC: 1, descricao: "  " }
    ]
  };

  it("le codigo, nome e tipo de cada conta", () => {
    expect(parseCheckingAccounts(response).slice(0, 2)).toEqual([
      { code: 11455896303, name: "Caixinha", type: "CX", inactive: false },
      { code: 11455922417, name: "Itaú Unibanco", type: "CC", inactive: false }
    ]);
  });

  it("marca inativa pelo campo `inativo`, que e o que o OMIE manda", () => {
    expect(parseCheckingAccounts(response).find((a) => a.name === "Sicoob")?.inactive).toBe(true);
  });

  it("descarta conta sem codigo ou sem nome", () => {
    expect(parseCheckingAccounts(response)).toHaveLength(3);
  });

  it("devolve lista vazia quando o retorno nao tem a lista", () => {
    expect(parseCheckingAccounts({ faultstring: "erro" })).toEqual([]);
  });
});

describe("normalizeBankMovementAccounts", () => {
  it("mantem a ordem, tira repetidas e codigo invalido", () => {
    expect(
      normalizeBankMovementAccounts([
        { code: 11455922417, name: " Itaú Unibanco " },
        { code: "11455922450", name: "Santander" },
        { code: 11455922417, name: "Itau de novo" },
        { code: -5, name: "Negativa" },
        { code: "abc", name: "Texto" },
        null
      ])
    ).toEqual([
      { code: 11455922417, name: "Itaú Unibanco" },
      { code: 11455922450, name: "Santander" }
    ]);
  });

  it("da um nome quando a conta veio sem", () => {
    expect(normalizeBankMovementAccounts([{ code: 7 }])).toEqual([{ code: 7, name: "Conta 7" }]);
  });

  it("qualquer coisa que nao seja lista vira nenhuma conta", () => {
    expect(normalizeBankMovementAccounts(null)).toEqual([]);
    expect(normalizeBankMovementAccounts({ code: 1 })).toEqual([]);
    expect(normalizeBankMovementAccounts("[]")).toEqual([]);
  });

  it("respeita o teto de contas", () => {
    const many = Array.from({ length: MAX_BANK_MOVEMENT_ACCOUNTS + 3 }, (_, i) => ({
      code: i + 1,
      name: `Conta ${i + 1}`
    }));
    expect(normalizeBankMovementAccounts(many)).toHaveLength(MAX_BANK_MOVEMENT_ACCOUNTS);
  });
});
