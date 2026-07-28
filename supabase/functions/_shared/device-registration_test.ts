import { describe, expect, it } from "vitest";

import { selectDeviceRegistration } from "./device-registration.ts";

const PC_A_LEGACY = { id: "desktop-a", installation_id: null };
const PC_A_BOUND = { id: "desktop-a", installation_id: "install-a" };

describe("selectDeviceRegistration", () => {
  it("reusa o registro da mesma instalacao", () => {
    const selected = selectDeviceRegistration({
      devices: [PC_A_BOUND],
      installationId: "install-a",
      previousDeviceId: null
    });

    expect(selected).toBe(PC_A_BOUND);
  });

  it("nao adota o registro de outro computador da pedreira", () => {
    // Cenario do bug: PC A ja operando (registro legado, sem installation_id) e
    // PC B ativando pela primeira vez. Adotar o registro de A rotacionava o token
    // dele e A aparecia como bloqueado.
    const selected = selectDeviceRegistration({
      devices: [PC_A_LEGACY],
      installationId: "install-b",
      previousDeviceId: null
    });

    expect(selected).toBeNull();
  });

  it("adota o registro legado quando a propria maquina apresenta o id que ja usava", () => {
    const selected = selectDeviceRegistration({
      devices: [PC_A_LEGACY],
      installationId: "install-a",
      previousDeviceId: "desktop-a"
    });

    expect(selected).toBe(PC_A_LEGACY);
  });

  it("nao adota registro ja vinculado a outra instalacao, mesmo com o id anterior", () => {
    // Depois de um roubo de registro, o computador prejudicado nao pode toma-lo
    // de volta: ficariam os dois se derrubando a cada ativacao.
    const selected = selectDeviceRegistration({
      devices: [PC_A_BOUND],
      installationId: "install-b",
      previousDeviceId: "desktop-a"
    });

    expect(selected).toBeNull();
  });

  it("ignora id anterior que nao existe mais na empresa", () => {
    const selected = selectDeviceRegistration({
      devices: [PC_A_BOUND],
      installationId: "install-c",
      previousDeviceId: "desktop-removido"
    });

    expect(selected).toBeNull();
  });
});
