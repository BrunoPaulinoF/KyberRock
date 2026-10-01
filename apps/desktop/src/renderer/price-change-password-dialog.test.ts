import { describe, expect, it } from "vitest";

import { priceUnlockMessage, withoutPasswordHint } from "./PriceChangePasswordDialog";

describe("janela da senha com a balanca liberada pelo comercial", () => {
  it("diz ate quando esta liberada", () => {
    const now = new Date(2026, 9, 1, 14, 0);
    expect(priceUnlockMessage({ indefinite: true, until: null }, now)).toContain("sem prazo");
    expect(
      priceUnlockMessage(
        { indefinite: false, until: new Date(2026, 9, 1, 15, 30).toISOString() },
        now
      )
    ).toContain("ate 15:30");
    expect(
      priceUnlockMessage(
        { indefinite: false, until: new Date(2026, 9, 2, 2, 0).toISOString() },
        now
      )
    ).toContain("ate 02/10 as 02:00");
  });

  it("tira da descricao o pedido de senha e mantem o que a acao faz", () => {
    expect(withoutPasswordHint("Digite a senha de preco para alterar precos.")).toBe("");
    expect(
      withoutPasswordHint(
        "Isto remove da lista todas as operacoes canceladas. Digite a senha de preco para confirmar."
      )
    ).toBe("Isto remove da lista todas as operacoes canceladas.");
    expect(
      withoutPasswordHint(
        "Peca a senha ao comercial. A alteracao fica registrada e aparece para o comercial no KyberRock Web."
      )
    ).toBe("A alteracao fica registrada e aparece para o comercial no KyberRock Web.");
  });
});
