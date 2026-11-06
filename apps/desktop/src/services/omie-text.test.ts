import { describe, expect, it } from "vitest";

import { repairMojibake } from "./omie-text.js";

describe("repairMojibake", () => {
  it("conserta os nomes que chegaram embaralhados do OMIE", () => {
    expect(repairMojibake("RachÃ£o")).toBe("Rachão");
    expect(repairMojibake("PÃ³ de Pedra")).toBe("Pó de Pedra");
    expect(repairMojibake("VAZAO 50 L/H A 5 KGF/CMÂ²")).toBe("VAZAO 50 L/H A 5 KGF/CM²");
    expect(repairMojibake("PEDREIRA IBIÃšNA")).toBe("PEDREIRA IBIÚNA");
    expect(repairMojibake("BONIFICAÃ‡ÃƒO")).toBe("BONIFICAÇÃO");
    expect(repairMojibake("Brita nÂº 1")).toBe("Brita nº 1");
    expect(repairMojibake("Pedra â€“ lavada")).toBe("Pedra – lavada");
  });

  it("nao mexe em texto que ja esta certo", () => {
    for (const text of [
      "Rachão",
      "Pó de Pedra",
      "ALICATE DE PRESSÃO 10&quot;",
      "CAMISETA PEDREIRA IBIÚNA",
      "BONIFICAÇÃO",
      "Brita nº 1",
      "Bica Corrida",
      "ÃO",
      "Âmbar"
    ]) {
      expect(repairMojibake(text)).toBe(text);
    }
  });

  it("conserta so o trecho quebrado quando o texto mistura os dois", () => {
    expect(repairMojibake("PRESSÃO e RachÃ£o")).toBe("PRESSÃO e Rachão");
  });

  it("devolve vazio e nulo como vieram", () => {
    expect(repairMojibake("")).toBe("");
    expect(repairMojibake(null)).toBeNull();
    expect(repairMojibake(undefined)).toBeUndefined();
  });
});
