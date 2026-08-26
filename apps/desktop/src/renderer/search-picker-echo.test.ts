import { describe, expect, it } from "vitest";

import { shouldOpenOnGesture } from "./search-picker-echo";

describe("eco do clique que escolhe uma linha", () => {
  it("em repouso, qualquer gesto abre a lista", () => {
    expect(shouldOpenOnGesture("focus", false)).toBe(true);
    expect(shouldOpenOnGesture("click", false)).toBe(true);
    expect(shouldOpenOnGesture("type", false)).toBe(true);
    expect(shouldOpenOnGesture("arrow-down", false)).toBe(true);
  });

  it("o foco e o clique que o <label> devolve na escolha nao reabrem a lista", () => {
    // Era esse eco que deixava o dropdown aberto depois de escolher o cliente,
    // obrigando o operador a clicar fora da tela para o campo enfim fechar.
    expect(shouldOpenOnGesture("focus", true)).toBe(false);
    expect(shouldOpenOnGesture("click", true)).toBe(false);
  });

  it("teclado passa: o eco do <label> so chega como foco ou clique", () => {
    expect(shouldOpenOnGesture("type", true)).toBe(true);
    expect(shouldOpenOnGesture("arrow-down", true)).toBe(true);
  });
});
