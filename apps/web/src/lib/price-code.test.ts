import { describe, expect, it } from "vitest";

import { formatPriceCode, readPriceCode, secondsLeft } from "./price-code";

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
