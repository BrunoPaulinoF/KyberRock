import { describe, expect, it } from "vitest";

import { resolveActivationUnit } from "./activation-unit.ts";

const UNIT_A = { id: "unit-a", name: "Pedreira A" };
const UNIT_B = { id: "unit-b", name: "Pedreira B" };

describe("resolveActivationUnit", () => {
  it("usa a unica pedreira ativa da empresa sem perguntar nada", () => {
    expect(
      resolveActivationUnit({
        units: [UNIT_A],
        requestedUnitId: null,
        currentDeviceUnitId: null
      })
    ).toEqual({ kind: "resolved", unit: UNIT_A });
  });

  it("pede a escolha quando a empresa tem mais de uma pedreira ativa", () => {
    // Era aqui que a ativacao pegava calada a unidade mais antiga e mandava a
    // fila do carregador da outra pedreira para o vazio.
    expect(
      resolveActivationUnit({
        units: [UNIT_A, UNIT_B],
        requestedUnitId: null,
        currentDeviceUnitId: null
      })
    ).toEqual({ kind: "selection_required", units: [UNIT_A, UNIT_B] });
  });

  it("respeita a pedreira escolhida pelo operador", () => {
    expect(
      resolveActivationUnit({
        units: [UNIT_A, UNIT_B],
        requestedUnitId: "unit-b",
        currentDeviceUnitId: "unit-a"
      })
    ).toEqual({ kind: "resolved", unit: UNIT_B });
  });

  it("recusa uma pedreira que nao e da empresa (ou esta inativa)", () => {
    expect(
      resolveActivationUnit({
        units: [UNIT_A, UNIT_B],
        requestedUnitId: "unit-de-outra-empresa",
        currentDeviceUnitId: null
      })
    ).toEqual({ kind: "unit_not_found" });
  });

  it("mantem a pedreira do registro na reativacao da mesma maquina", () => {
    expect(
      resolveActivationUnit({
        units: [UNIT_A, UNIT_B],
        requestedUnitId: null,
        currentDeviceUnitId: "unit-b"
      })
    ).toEqual({ kind: "resolved", unit: UNIT_B });
  });

  it("volta a perguntar quando a pedreira do registro foi desativada", () => {
    expect(
      resolveActivationUnit({
        units: [UNIT_A, UNIT_B],
        requestedUnitId: null,
        currentDeviceUnitId: "unit-desativada"
      })
    ).toEqual({ kind: "selection_required", units: [UNIT_A, UNIT_B] });
  });

  it("sinaliza empresa sem unidade ativa", () => {
    expect(
      resolveActivationUnit({ units: [], requestedUnitId: "unit-a", currentDeviceUnitId: null })
    ).toEqual({ kind: "no_units" });
  });
});
