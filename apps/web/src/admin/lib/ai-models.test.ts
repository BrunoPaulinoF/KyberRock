import { describe, expect, it } from "vitest";

import {
  AI_MODEL_CUSTOM,
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
  findAiModelHint,
  isKnownAiModel
} from "./ai-models";

describe("AI_MODEL_OPTIONS", () => {
  it("oferece pelo menos uma opcao", () => {
    expect(AI_MODEL_OPTIONS.length).toBeGreaterThan(0);
  });

  it("nao repete modelo", () => {
    const ids = AI_MODEL_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("explica cada opcao para quem escolhe", () => {
    for (const option of AI_MODEL_OPTIONS) {
      expect(option.label.trim(), `${option.id} sem rotulo`).not.toHaveLength(0);
      expect(option.hint.trim(), `${option.id} sem explicacao`).not.toHaveLength(0);
    }
  });

  // O valor sentinela do "Outro" nao pode colidir com um id de modelo, senao
  // escolher aquele modelo abriria o campo de texto livre.
  it("nao colide com o valor sentinela de modelo livre", () => {
    expect(AI_MODEL_OPTIONS.some((option) => option.id === AI_MODEL_CUSTOM)).toBe(false);
  });

  it("tem o padrao dentro da lista, para o select abrir ja selecionado", () => {
    expect(isKnownAiModel(DEFAULT_AI_MODEL)).toBe(true);
  });
});

describe("isKnownAiModel", () => {
  it("reconhece um modelo da lista", () => {
    expect(isKnownAiModel(AI_MODEL_OPTIONS[0].id)).toBe(true);
  });

  // Modelo fora da lista cai no campo livre em vez de sumir: a lista e de
  // interface, e o backend aceita qualquer texto. Sem isso, abrir o painel com
  // um modelo novo gravado mostraria outro modelo selecionado.
  it("nao reconhece modelo fora da lista", () => {
    expect(isKnownAiModel("modelo-que-saiu-ontem")).toBe(false);
    expect(isKnownAiModel("")).toBe(false);
  });
});

describe("findAiModelHint", () => {
  it("devolve a explicacao do modelo conhecido", () => {
    expect(findAiModelHint(DEFAULT_AI_MODEL)).not.toHaveLength(0);
  });

  it("devolve vazio para modelo desconhecido", () => {
    expect(findAiModelHint("modelo-que-saiu-ontem")).toBe("");
  });
});
