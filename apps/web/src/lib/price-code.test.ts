import { describe, expect, it } from "vitest";

import {
  formatPriceCode,
  isUnlockActive,
  readPriceCode,
  readPriceUnlock,
  secondsLeft,
  unlockTimeLeft
} from "./price-code";

const RESPONSE = {
  code: "287082",
  expiresAt: "2026-09-28T12:00:45.000Z",
  periodSeconds: 45,
  serverTime: "2026-09-28T12:00:15.000Z"
};

describe("senha rotativa na tela do comercial", () => {
  it("conta os segundos pelo relogio da nuvem, nao pelo do computador", () => {
    // Este computador esta 10 s adiantado em relacao a nuvem.
    const receivedAt = Date.parse("2026-09-28T12:00:25.000Z");
    const state = readPriceCode(RESPONSE, receivedAt);
    expect(state?.clockOffsetMs).toBe(-10_000);
    expect(secondsLeft(state!, receivedAt)).toBe(30);
    expect(secondsLeft(state!, receivedAt + 29_500)).toBe(1);
    expect(secondsLeft(state!, receivedAt + 30_000)).toBe(0);
    expect(secondsLeft(state!, receivedAt + 90_000)).toBe(0);
  });

  it("recusa resposta incompleta", () => {
    expect(readPriceCode(null, 0)).toBeNull();
    expect(readPriceCode({ ...RESPONSE, code: undefined }, 0)).toBeNull();
    expect(readPriceCode({ ...RESPONSE, expiresAt: "ontem" }, 0)).toBeNull();
  });

  it("separa o codigo em dois blocos para ler em voz alta", () => {
    expect(formatPriceCode("287082")).toBe("287 082");
    expect(formatPriceCode("1234")).toBe("1234");
  });
});

describe("liberar a balanca sem senha", () => {
  const NOW = Date.parse("2026-10-01T15:00:00.000Z");

  it("le a liberacao da web-api; sem o campo, a opcao fica escondida", () => {
    expect(readPriceUnlock(undefined)).toBeUndefined();
    expect(readPriceUnlock(null)).toBeNull();
    expect(readPriceUnlock({ indefinite: true, byName: "Ana" })).toEqual({
      indefinite: true,
      until: null,
      byName: "Ana",
      at: null
    });
    expect(readPriceUnlock({ indefinite: false, until: "ontem" })).toBeNull();
  });

  it("o prazo acaba pelo relogio da nuvem", () => {
    const unlock = readPriceUnlock({ indefinite: false, until: "2026-10-01T15:30:00.000Z" });
    expect(isUnlockActive(unlock, NOW)).toBe(true);
    expect(isUnlockActive(unlock, NOW + 30 * 60_000)).toBe(false);
    // Computador 31 min adiantado em relacao a nuvem: para ela ainda faltam 29 min.
    expect(isUnlockActive(unlock, NOW + 31 * 60_000, -31 * 60_000)).toBe(true);
    expect(isUnlockActive(readPriceUnlock({ indefinite: true }), NOW * 2)).toBe(true);
    expect(isUnlockActive(null, NOW)).toBe(false);
  });

  it("diz quanto falta", () => {
    const until = "2026-10-01T15:30:00.000Z";
    expect(unlockTimeLeft(until, NOW)).toBe("faltam 30 min");
    // A tela ainda nao andou o relogio quando a resposta chega: continua 30.
    expect(unlockTimeLeft(until, NOW - 250)).toBe("faltam 30 min");
    expect(unlockTimeLeft(until, NOW + 29 * 60_000 + 30_000)).toBe("falta 1 min");
    expect(unlockTimeLeft("2026-10-01T16:00:00.000Z", NOW)).toBe("falta 1 h");
    expect(unlockTimeLeft("2026-10-01T16:05:00.000Z", NOW)).toBe("faltam 1 h 05 min");
    expect(unlockTimeLeft("2026-10-01T19:00:00.000Z", NOW)).toBe("faltam 4 h");
  });
});
