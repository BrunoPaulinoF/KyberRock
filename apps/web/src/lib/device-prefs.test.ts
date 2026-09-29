import { describe, expect, it } from "vitest";

import { parseStoredFlag, readDeviceFlag, serializeFlag, writeDeviceFlag } from "./device-prefs";

describe("preferencias do aparelho", () => {
  it("le liga/desliga e cai no padrao com valor estranho ou ausente", () => {
    expect(parseStoredFlag("1", false)).toBe(true);
    expect(parseStoredFlag(" TRUE ", false)).toBe(true);
    expect(parseStoredFlag("0", true)).toBe(false);
    expect(parseStoredFlag("false", true)).toBe(false);
    expect(parseStoredFlag(null, true)).toBe(true);
    expect(parseStoredFlag(undefined, false)).toBe(false);
    expect(parseStoredFlag("sim", false)).toBe(false);
  });

  it("ida e volta", () => {
    expect(parseStoredFlag(serializeFlag(true), false)).toBe(true);
    expect(parseStoredFlag(serializeFlag(false), true)).toBe(false);
  });

  it("sem armazenamento, ler da o padrao e gravar nao quebra", () => {
    // O teste roda fora do navegador: nao ha `window.localStorage`.
    expect(readDeviceFlag("kyberrock.teste", true)).toBe(true);
    expect(readDeviceFlag("kyberrock.teste", false)).toBe(false);
    expect(() => writeDeviceFlag("kyberrock.teste", true)).not.toThrow();
  });
});
