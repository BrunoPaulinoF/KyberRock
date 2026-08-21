import { describe, expect, it } from "vitest";

import {
  AUTO_DOWNLOAD_UPDATES,
  AUTO_INSTALL_ON_QUIT,
  createInitialUpdateState,
  getManualUpdateButtonLabel,
  hasUpdateRingChoice,
  updateRingLabel
} from "./update-flow";

describe("auto-update policy", () => {
  it("downloads updates and installs them on quit without operator action", () => {
    expect(AUTO_DOWNLOAD_UPDATES).toBe(true);
    expect(AUTO_INSTALL_ON_QUIT).toBe(true);
  });
});

describe("getManualUpdateButtonLabel", () => {
  it("asks the operator to install only after an update is available", () => {
    expect(getManualUpdateButtonLabel("idle")).toBe("Verificar atualizacao");
    expect(getManualUpdateButtonLabel("available")).toBe("Baixar e instalar atualizacao");
    expect(getManualUpdateButtonLabel("downloaded")).toBe("Reiniciar e instalar");
  });
});

describe("escolha de anel na balanca de teste", () => {
  it("comeca sem nenhuma opcao para escolher", () => {
    const state = createInitialUpdateState();
    expect(state.ringOptions).toEqual([]);
    expect(state.availableRing).toBeNull();
    expect(hasUpdateRingChoice(state)).toBe(false);
  });

  it("so ha escolha com os DOIS aneis oferecendo versao", () => {
    const state = createInitialUpdateState();
    expect(
      hasUpdateRingChoice({ ...state, ringOptions: [{ ring: "beta", version: "0.8.202" }] })
    ).toBe(false);
    expect(
      hasUpdateRingChoice({
        ...state,
        ringOptions: [
          { ring: "beta", version: "0.8.202" },
          { ring: "latest", version: "0.8.201" }
        ]
      })
    ).toBe(true);
  });

  it("o botao leva para a escolha em vez de baixar direto", () => {
    expect(getManualUpdateButtonLabel("available", true)).toBe("Escolher versao para instalar");
    expect(getManualUpdateButtonLabel("idle", true)).toBe("Escolher versao para instalar");
    // Enquanto ha trabalho em andamento o botao continua contando o que faz.
    expect(getManualUpdateButtonLabel("downloading", true)).toBe("Baixando...");
    expect(getManualUpdateButtonLabel("checking", true)).toBe("Verificando...");
  });

  it("traduz o anel para o vocabulario do operador", () => {
    expect(updateRingLabel("beta")).toBe("teste");
    expect(updateRingLabel("latest")).toBe("producao");
  });
});
