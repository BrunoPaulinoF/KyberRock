import { beforeEach, describe, expect, it } from "vitest";

import { readInstalledAppVersion, setInstalledAppVersion } from "./app-version";

describe("app-version", () => {
  beforeEach(() => setInstalledAppVersion(null));

  it("guarda a versao gravada pelo processo principal", () => {
    setInstalledAppVersion("0.8.201");

    expect(readInstalledAppVersion()).toBe("0.8.201");
  });

  it("aceita a tag com 'v' e espacos ao redor", () => {
    setInstalledAppVersion(" v0.8.201 ");

    expect(readInstalledAppVersion()).toBe("0.8.201");
  });

  it("descarta o que nao e MAJOR.MINOR.PATCH em vez de reportar lixo", () => {
    // O valor vira uma barra no grafico da frota no painel: "0.8.201-dev" ao
    // lado de "0.8.201" seriam duas versoes diferentes para quem olha.
    for (const value of ["", "0.8", "0.8.201-dev", "desconhecida", undefined]) {
      setInstalledAppVersion(value);
      expect(readInstalledAppVersion()).toBeNull();
    }
  });
});
