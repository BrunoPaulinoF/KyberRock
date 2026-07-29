import { describe, expect, it } from "vitest";

import { scopeRowsToDevice, scopeRowToDevice } from "./device-scope.ts";

const DEVICE = { company_id: "company-1", unit_id: "unit-ibiuna" };

describe("scopeRowToDevice", () => {
  it("grava a operacao na pedreira do registro do dispositivo, nao na do payload", () => {
    // Copia local desatualizada da unidade: sem isto a entrada era projetada na
    // pedreira errada e nunca aparecia na fila do carregador certo.
    expect(
      scopeRowToDevice({ id: "op-1", unit_id: "unit-antiga", company_id: "company-1" }, DEVICE)
    ).toEqual({ id: "op-1", unit_id: "unit-ibiuna", company_id: "company-1" });
  });

  it("preserva os demais campos da linha", () => {
    expect(scopeRowToDevice({ id: "lr-1", status: "open", plate: "ABC1D23" }, DEVICE)).toEqual({
      id: "lr-1",
      status: "open",
      plate: "ABC1D23",
      unit_id: "unit-ibiuna",
      company_id: "company-1"
    });
  });

  it("mantem o payload quando o registro do dispositivo esta sem unidade", () => {
    expect(
      scopeRowToDevice({ id: "op-1", unit_id: "unit-payload" }, { company_id: null, unit_id: null })
    ).toEqual({ id: "op-1", unit_id: "unit-payload" });
  });

  it("aplica a mesma pedreira a todas as linhas do lote", () => {
    expect(scopeRowsToDevice([{ id: "a" }, { id: "b", unit_id: "outra" }], DEVICE)).toEqual([
      { id: "a", company_id: "company-1", unit_id: "unit-ibiuna" },
      { id: "b", company_id: "company-1", unit_id: "unit-ibiuna" }
    ]);
  });
});
