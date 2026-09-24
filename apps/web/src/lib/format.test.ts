import { describe, expect, it } from "vitest";

import {
  documentKind,
  formatDocument,
  formatMoney,
  isValidDocument,
  normalizeDocument,
  localDay,
  parseMoneyToCents,
  periodToIso
} from "./format";

describe("documento", () => {
  it("mantem a letra do CNPJ alfanumerico e valida o verificador", () => {
    expect(normalizeDocument("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
    expect(isValidDocument("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidDocument("11.222.333/0001-81")).toBe(true);
    expect(isValidDocument("11.222.333/0001-82")).toBe(false);
    expect(isValidDocument("529.982.247-25")).toBe(true);
  });

  it("decide CPF ou CNPJ pela FORMA, nunca pelo tamanho", () => {
    expect(documentKind("529.982.247-25")).toBe("cpf");
    expect(documentKind("12ABC34501DE35")).toBe("cnpj");
    expect(documentKind("123")).toBeNull();
  });

  it("formata para exibir", () => {
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument(null)).toBe("");
  });
});

describe("dinheiro", () => {
  it("le reais com virgula e devolve centavos inteiros", () => {
    expect(parseMoneyToCents("65,00")).toBe(6500);
    expect(parseMoneyToCents("1.234,56")).toBe(123456);
    expect(parseMoneyToCents("R$ 12,5")).toBe(1250);
    expect(parseMoneyToCents("70")).toBe(7000);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-1")).toBeNull();
  });

  it("formata centavos em reais", () => {
    expect(formatMoney(123456).replace(/\u00a0/g, " ")).toBe("R$ 1.234,56");
  });
});

describe("periodo", () => {
  it("converte dias locais (Brasilia) em intervalo ISO meio-aberto", () => {
    expect(periodToIso("2026-09-01", "2026-09-15")).toEqual({
      startIso: "2026-09-01T03:00:00.000Z",
      endIso: "2026-09-16T03:00:00.000Z"
    });
  });

  it("agrupa pelo dia de Brasilia, nao pelo dia em UTC", () => {
    // 21h30 de 23/09 em Brasilia ja e 24/09 em UTC.
    expect(localDay("2026-09-24T00:30:00.000Z")).toBe("2026-09-23");
    expect(localDay("2026-09-24T03:00:00.000Z")).toBe("2026-09-24");
  });
});
