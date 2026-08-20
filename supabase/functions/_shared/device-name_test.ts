import { describe, expect, it } from "vitest";

import { DEVICE_NAME_MAX_LENGTH, normalizeDeviceName, parseDeviceName } from "./device-name.ts";

describe("normalizeDeviceName", () => {
  it("tira espacos das pontas e colapsa os do meio", () => {
    expect(normalizeDeviceName("  Balanca    2 ")).toBe("Balanca 2");
  });

  it("trata o que nao e texto como vazio", () => {
    expect(normalizeDeviceName(undefined)).toBe("");
    expect(normalizeDeviceName(null)).toBe("");
    expect(normalizeDeviceName(42)).toBe("");
  });
});

describe("parseDeviceName", () => {
  it("aceita e devolve o nome normalizado", () => {
    expect(parseDeviceName(" Balanca  da  entrada ")).toEqual({
      ok: true,
      name: "Balanca da entrada"
    });
  });

  it("recusa nome vazio", () => {
    // Nome vazio na nuvem viraria o generico "Computador" no espelho local de
    // TODAS as maquinas da pedreira (ver unit-devices.ts) — some a identificacao
    // sem erro nenhum na tela.
    expect(parseDeviceName("   ")).toEqual({
      ok: false,
      error: "Informe o nome do computador."
    });
    expect(parseDeviceName(undefined).ok).toBe(false);
  });

  it("recusa nome longo demais para a legenda", () => {
    const result = parseDeviceName("x".repeat(DEVICE_NAME_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(String(DEVICE_NAME_MAX_LENGTH));
  });

  it("aceita exatamente o limite", () => {
    const name = "x".repeat(DEVICE_NAME_MAX_LENGTH);
    expect(parseDeviceName(name)).toEqual({ ok: true, name });
  });
});
