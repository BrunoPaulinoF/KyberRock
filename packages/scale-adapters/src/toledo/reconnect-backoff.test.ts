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

  it("mantem as primeiras tentativas curtas e constantes dentro da janela rapida", () => {
    // A queda do meio do expediente dura poucos segundos: o conversor serial<->TCP
    // segura a sessao antiga e recusa o app ate liberar. Comecando em 5s e dobrando,
    // a terceira recusa marcava a proxima tentativa para 20s depois e o app dormia a
    // soneca inteira com a balanca ja livre.
    const opcoes = { fastAttempts: 15, fastIntervalMs: 2000 };
    const janela = [1, 2, 8, 15].map((a) => reconnectDelayMs(a, 5000, 30_000, opcoes));

    expect(janela).toEqual([2000, 2000, 2000, 2000]);
  });

  it("volta a curva normal quando a janela rapida acaba, sem cobra-la em dobro", () => {
    // Passada a janela a queda ja e longa: a curva recomeca do intervalo base e
    // chega ao mesmo teto. Contar o expoente desde a tentativa 1 saltaria direto
    // para 30s e devolveria o problema que a janela veio resolver.
    const opcoes = { fastAttempts: 15, fastIntervalMs: 2000 };
    const depois = [16, 17, 18, 19, 20].map((a) => reconnectDelayMs(a, 5000, 30_000, opcoes));

    expect(depois).toEqual([5000, 10_000, 20_000, 30_000, 30_000]);
  });

  it("janela rapida nunca deixa a espera MAIOR que a curva normal", () => {
    expect(reconnectDelayMs(1, 5000, 30_000, { fastAttempts: 3, fastIntervalMs: 9000 })).toBe(5000);
  });

  it("sem janela configurada, a curva historica nao muda", () => {
    const semJanela = [1, 2, 3, 4].map((a) => reconnectDelayMs(a, 5000, 30_000, {}));

    expect(semJanela).toEqual([5000, 10_000, 20_000, 30_000]);
  });

  it("trata a primeira tentativa como o intervalo base", () => {
    expect(reconnectDelayMs(1, 5000, 30_000)).toBe(5000);
    expect(reconnectDelayMs(0, 5000, 30_000)).toBe(5000);
  });
});
