import { describe, expect, it } from "vitest";

import { deviceUnitAssignment } from "./device-unit.ts";

const UNIT_A = "00e8d9f6-d2a3-46da-b1f0-226aeb884b6a";
const UNIT_B = "92562db3-0c38-424e-ac8b-80e78a598100";

describe("deviceUnitAssignment", () => {
  it("zera o numero do computador ao mudar de pedreira", () => {
    // Cenario do bug: desktop numero 1 na pedreira A movido para a pedreira B,
    // que ja tem um numero 1. Levar o numero antigo violava o indice unico
    // (unit_id, device_number) e a troca de pedreira falhava com
    // "duplicate key value violates unique constraint".
    expect(deviceUnitAssignment(UNIT_A, UNIT_B)).toEqual({
      unit_id: UNIT_B,
      device_number: null
    });
  });

  it("preserva o numero quando a pedreira nao muda", () => {
    // Reativacao na mesma pedreira: zerar o numero aqui faria o sufixo do cupom
    // dancar a cada reativacao, sem necessidade.
    expect(deviceUnitAssignment(UNIT_A, UNIT_A)).toEqual({ unit_id: UNIT_A });
  });

  it("renumera registro que ainda nao tinha pedreira", () => {
    expect(deviceUnitAssignment(null, UNIT_A)).toEqual({ unit_id: UNIT_A, device_number: null });
    expect(deviceUnitAssignment(undefined, UNIT_A)).toEqual({
      unit_id: UNIT_A,
      device_number: null
    });
  });
});
