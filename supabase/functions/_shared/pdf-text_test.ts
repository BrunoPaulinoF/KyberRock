import { describe, expect, it } from "vitest";

import { toWinAnsiText } from "./pdf-text.ts";

describe("toWinAnsiText", () => {
  it("mantem acentos do portugues e os sinais extras da WinAnsi", () => {
    expect(toWinAnsiText("Itaú Unibanco – Conciliação “ok” €")).toBe(
      "Itaú Unibanco – Conciliação “ok” €"
    );
  });

  it("compoe acento decomposto em vez de perde-lo", () => {
    expect(toWinAnsiText("Aguá")).toBe("Aguá");
  });

  it("troca o que a fonte nao desenha por ? e quebra de linha por espaco", () => {
    expect(toWinAnsiText("PIX ✅ ≥ 10")).toBe("PIX ? ? 10");
    expect(toWinAnsiText("linha 1\nlinha 2\r\n\tfim")).toBe("linha 1 linha 2 fim");
  });
});
