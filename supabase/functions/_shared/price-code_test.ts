import { describe, expect, it } from "vitest";

import {
  currentPriceCode,
  isUsablePriceCodeSecret,
  PRICE_CODE_PERIOD_SECONDS,
  priceCodeExpiresAt,
  priceCodeForStep,
  priceCodeStep,
  verifyPriceCode
} from "./price-code";

// Chave e resultados do apendice D da RFC 4226 (HOTP de 6 digitos). O desktop testa os MESMOS
// valores em `apps/desktop/src/services/price-code.test.ts`: e isso que prova que o codigo lido
// pelo comercial no site abre a balanca.
const RFC_SECRET = "12345678901234567890";
const RFC_CODES = ["755224", "287082", "359152", "969429", "338314", "254676"];

describe("senha rotativa de preco", () => {
  it("segue a RFC 4226", async () => {
    for (const [step, code] of RFC_CODES.entries()) {
      expect(await priceCodeForStep(RFC_SECRET, step)).toBe(code);
    }
  });

  it("troca a cada 45 segundos", () => {
    expect(PRICE_CODE_PERIOD_SECONDS).toBe(45);
    expect(priceCodeStep(0)).toBe(0);
    expect(priceCodeStep(44_999)).toBe(0);
    expect(priceCodeStep(45_000)).toBe(1);
    expect(priceCodeExpiresAt(10_000)).toBe(45_000);
  });

  it("diz o codigo de agora e quando ele vence", async () => {
    const current = await currentPriceCode(RFC_SECRET, 50_000);
    expect(current).toEqual({
      code: "287082",
      expiresAt: new Date(90_000).toISOString(),
      periodSeconds: 45
    });
  });

  it("aceita so o codigo da janela atual", async () => {
    expect(await verifyPriceCode(RFC_SECRET, "287082", 60_000)).toBe(true);
    expect(await verifyPriceCode(RFC_SECRET, " 287 082 ", 60_000)).toBe(true);
    // Vencido (janela anterior) e o proximo (ainda nao vale).
    expect(await verifyPriceCode(RFC_SECRET, "755224", 60_000)).toBe(false);
    expect(await verifyPriceCode(RFC_SECRET, "359152", 60_000)).toBe(false);
    // A senha fixa antiga nao abre mais nada.
    expect(await verifyPriceCode(RFC_SECRET, "0000", 60_000)).toBe(false);
    expect(await verifyPriceCode(RFC_SECRET, "", 60_000)).toBe(false);
  });

  it("recusa chave vazia ou curta", () => {
    expect(isUsablePriceCodeSecret(null)).toBe(false);
    expect(isUsablePriceCodeSecret("abc")).toBe(false);
    expect(isUsablePriceCodeSecret(RFC_SECRET)).toBe(true);
  });
});
