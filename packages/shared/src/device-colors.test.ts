import { describe, expect, it } from "vitest";

import {
  DEVICE_COLOR_PALETTE,
  fallbackDeviceColor,
  pickNextDeviceColor,
  resolveDeviceColor
} from "./device-colors.js";

describe("pickNextDeviceColor", () => {
  it("retorna a primeira cor quando nada esta em uso", () => {
    expect(pickNextDeviceColor([])).toBe(DEVICE_COLOR_PALETTE[0]);
  });

  it("pula cores ja usadas, ignorando caixa e valores vazios", () => {
    const used = [DEVICE_COLOR_PALETTE[0].toUpperCase(), null, undefined, ""];
    expect(pickNextDeviceColor(used)).toBe(DEVICE_COLOR_PALETTE[1]);
  });

  it("cicla a paleta quando todas as cores estao em uso", () => {
    const all = [...DEVICE_COLOR_PALETTE];
    expect(pickNextDeviceColor(all)).toBe(DEVICE_COLOR_PALETTE[0]);
  });
});

describe("fallbackDeviceColor", () => {
  it("e deterministica para o mesmo id", () => {
    expect(fallbackDeviceColor("desktop-abc")).toBe(fallbackDeviceColor("desktop-abc"));
  });

  it("sempre retorna uma cor da paleta", () => {
    for (const id of ["", "a", "desktop-123", "outro-device"]) {
      expect(DEVICE_COLOR_PALETTE).toContain(fallbackDeviceColor(id));
    }
  });
});

describe("resolveDeviceColor", () => {
  it("usa a cor atribuida quando valida", () => {
    expect(resolveDeviceColor("dev", "#123abc")).toBe("#123abc");
  });

  it("cai para a cor deterministica quando a atribuida e invalida ou ausente", () => {
    expect(resolveDeviceColor("dev", "azul")).toBe(fallbackDeviceColor("dev"));
    expect(resolveDeviceColor("dev", null)).toBe(fallbackDeviceColor("dev"));
  });
});
