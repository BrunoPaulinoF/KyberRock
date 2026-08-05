import { describe, expect, it } from "vitest";

import { reconnectDelayMs } from "./reconnect-backoff";

describe("reconnectDelayMs", () => {
  it("mantem o intervalo constante quando nenhum teto e configurado", () => {
    // Comportamento historico dos adaptadores: sem teto, nada de backoff.
    expect(reconnectDelayMs(1, 5000)).toBe(5000);
    expect(reconnectDelayMs(7, 5000)).toBe(5000);
    expect(reconnectDelayMs(50, 100)).toBe(100);
  });

  it("dobra o intervalo ate o teto configurado", () => {
    const delays = [1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelayMs(attempt, 5000, 30_000));

    expect(delays).toEqual([5000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  });

  it("nunca passa do teto, por mais longa que seja a queda", () => {
    // Balanca desligada a noite toda: sem o limite do expoente, 2^n estourava para
    // Infinity e o setTimeout resultante nunca dispararia.
    for (const attempt of [100, 1000, 100_000]) {
      const delay = reconnectDelayMs(attempt, 5000, 30_000);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBe(30_000);
    }
  });

  it("respeita um teto menor que o intervalo base sem encurtar a espera", () => {
    expect(reconnectDelayMs(1, 5000, 1000)).toBe(5000);
  });

  it("trata a primeira tentativa como o intervalo base", () => {
    expect(reconnectDelayMs(1, 5000, 30_000)).toBe(5000);
    expect(reconnectDelayMs(0, 5000, 30_000)).toBe(5000);
  });
});
