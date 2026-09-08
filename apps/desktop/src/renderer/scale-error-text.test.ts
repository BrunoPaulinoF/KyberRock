import { describe, expect, it } from "vitest";

import { scaleErrorText } from "./scale-error-text";

describe("scaleErrorText", () => {
  it("tira o embrulho do Electron da mensagem que o operador le", () => {
    const wrapped = new Error(
      "Error invoking remote method 'desktop:scale-connect': Error: A balanca em " +
        "192.168.5.190:9001 nao respondeu em 10 segundos."
    );

    expect(scaleErrorText(wrapped, "Falha ao conectar")).toBe(
      "A balanca em 192.168.5.190:9001 nao respondeu em 10 segundos."
    );
  });

  it("preserva a mensagem que ja vem limpa", () => {
    const direct = new Error("Informe o IP da balanca antes de conectar.");

    expect(scaleErrorText(direct, "Falha ao conectar")).toBe(
      "Informe o IP da balanca antes de conectar."
    );
  });

  it("cai no texto padrao quando nao ha mensagem nenhuma", () => {
    expect(scaleErrorText(new Error("   "), "Falha ao conectar")).toBe("Falha ao conectar");
    expect(scaleErrorText("nao e um Error", "Falha ao conectar")).toBe("Falha ao conectar");
  });
});
