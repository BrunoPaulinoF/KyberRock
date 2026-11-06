import { describe, expect, it } from "vitest";

import { cleanOmieText, decodeHtmlEntities, repairMojibake } from "./omie-text.js";

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

describe("decodeHtmlEntities / cleanOmieText", () => {
  it("troca o codigo HTML que vem do OMIE pelo sinal", () => {
    expect(decodeHtmlEntities("ALICATE DE PRESSÃO 10&quot;")).toBe('ALICATE DE PRESSÃO 10"');
    expect(decodeHtmlEntities("DISCO CORTE INOX STANLEY 9&quot;X1/16&quot;X7/8&quot;")).toBe(
      'DISCO CORTE INOX STANLEY 9"X1/16"X7/8"'
    );
    expect(decodeHtmlEntities("M&amp;M MATERIAIS")).toBe("M&M MATERIAIS");
    expect(decodeHtmlEntities("D&apos;AVILA")).toBe("D'AVILA");
    expect(decodeHtmlEntities("D&#39;AVILA &#x26; FILHOS")).toBe("D'AVILA & FILHOS");
  });

  it("decodifica uma vez so e deixa como veio o que nao reconhece", () => {
    expect(decodeHtmlEntities("&amp;quot;")).toBe("&quot;");
    expect(decodeHtmlEntities("A & B")).toBe("A & B");
    expect(decodeHtmlEntities("PECA &xyz; 1")).toBe("PECA &xyz; 1");
    expect(decodeHtmlEntities("&#0; &#1114112; &#xD800;")).toBe("&#0; &#1114112; &#xD800;");
    expect(decodeHtmlEntities(null)).toBeNull();
  });

  it("cleanOmieText junta os dois consertos", () => {
    expect(cleanOmieText("RachÃ£o 4&quot;")).toBe('Rachão 4"');
    expect(cleanOmieText("Pó de Pedra")).toBe("Pó de Pedra");
    expect(cleanOmieText(undefined)).toBeUndefined();
  });
});
