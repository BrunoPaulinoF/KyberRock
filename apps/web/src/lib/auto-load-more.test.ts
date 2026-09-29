import { describe, expect, it } from "vitest";

import { autoLoadKey, shouldAutoLoadMore } from "./auto-load-more";

const base = {
  visible: true,
  loading: false,
  left: 250,
  key: autoLoadKey(50, 300),
  askedKey: null
};

describe("shouldAutoLoadMore", () => {
  it("traz a proxima pagina quando o rodape aparece e ainda falta linha", () => {
    expect(shouldAutoLoadMore(base)).toBe(true);
  });

  it("espera o rodape aparecer", () => {
    expect(shouldAutoLoadMore({ ...base, visible: false })).toBe(false);
  });

  it("nao pede de novo enquanto a pagina esta a caminho", () => {
    expect(shouldAutoLoadMore({ ...base, loading: true })).toBe(false);
  });

  it("para no fim da lista", () => {
    expect(shouldAutoLoadMore({ ...base, left: 0, key: autoLoadKey(300, 300) })).toBe(false);
  });

  it("nao repete a mesma pagina que falhou (a lista nao cresceu)", () => {
    expect(shouldAutoLoadMore({ ...base, askedKey: autoLoadKey(50, 300) })).toBe(false);
  });

  it("segue pedindo quando a pagina anterior chegou", () => {
    expect(
      shouldAutoLoadMore({ ...base, key: autoLoadKey(100, 300), askedKey: autoLoadKey(50, 300) })
    ).toBe(true);
  });
});

describe("autoLoadKey", () => {
  it("separa listas diferentes com o mesmo tamanho na tela", () => {
    expect(autoLoadKey(50, 300)).not.toBe(autoLoadKey(50, 120));
  });
});
