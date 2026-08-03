import { describe, expect, it } from "vitest";

import {
  PaymentConditionParseError,
  parsePaymentCondition,
  tryParsePaymentCondition
} from "./payment-condition-parser.js";

describe("parsePaymentCondition", () => {
  it("formato 1: dias fixos separados por barra", () => {
    const result = parsePaymentCondition("10/20/30/40");
    expect(result.kind).toBe("fixed_days");
    expect(result.installmentCount).toBe(4);
    expect(result.installments.map((i) => i.dueDays)).toEqual([10, 20, 30, 40]);
    expect(result.installments.map((i) => i.number)).toEqual([1, 2, 3, 4]);
  });

  it("formato 1 tambem aceita dias separados por espaco", () => {
    const result = parsePaymentCondition("7 14 21");
    expect(result.kind).toBe("fixed_days");
    expect(result.installmentCount).toBe(3);
    expect(result.installments.map((i) => i.dueDays)).toEqual([7, 14, 21]);
    expect(result.raw).toBe("7/14/21");
  });

  it("numero isolado e o prazo em dias de uma parcela unica", () => {
    const result = parsePaymentCondition("5");
    expect(result.kind).toBe("single");
    expect(result.installmentCount).toBe(1);
    expect(result.installments).toEqual([{ number: 1, dueDays: 5 }]);
  });

  it("formato 2: primeira a vista e demais em dias", () => {
    const result = parsePaymentCondition("A Vista/40/60");
    expect(result.kind).toBe("fixed_days");
    expect(result.installmentCount).toBe(3);
    expect(result.installments.map((i) => i.dueDays)).toEqual([0, 40, 60]);
  });

  it("aceita variacao de acento e caixa em 'a vista'", () => {
    expect(parsePaymentCondition("à vista/30").installments[0].dueDays).toBe(0);
    expect(parsePaymentCondition("A VISTA").installments[0].dueDays).toBe(0);
  });

  it("formato 3: 'Para 93 dias' gera uma unica parcela", () => {
    const result = parsePaymentCondition("Para 93 dias");
    expect(result.kind).toBe("single");
    expect(result.installmentCount).toBe(1);
    expect(result.installments).toEqual([{ number: 1, dueDays: 93 }]);
  });

  it("formato 3 aceita 'dia' no singular", () => {
    expect(parsePaymentCondition("Para 1 dia").installments[0].dueDays).toBe(1);
  });

  it("formato 4: numero inteiro isolado = prazo em dias apos a venda", () => {
    const result = parsePaymentCondition("50");
    expect(result.kind).toBe("single");
    expect(result.installmentCount).toBe(1);
    expect(result.intervalDays).toBeNull();
    expect(result.installments).toEqual([{ number: 1, dueDays: 50 }]);
    // "50" e "Para 50 dias" descrevem a mesma condicao.
    expect(result.installments).toEqual(parsePaymentCondition("Para 50 dias").installments);
  });

  it("formato 5: 'N Parcelas' = parcelas mensais", () => {
    const result = parsePaymentCondition("3 Parcelas");
    expect(result.kind).toBe("monthly_count");
    expect(result.installmentCount).toBe(3);
    expect(result.installments.map((i) => i.dueDays)).toEqual([30, 60, 90]);
  });

  it("formato 6: periodo + dias (semana, quinzena e mes)", () => {
    expect(parsePaymentCondition("s + 20").installments).toEqual([{ number: 1, dueDays: 27 }]);
    expect(parsePaymentCondition("q + 20").installments).toEqual([{ number: 1, dueDays: 35 }]);
    expect(parsePaymentCondition("m + 20").installments).toEqual([{ number: 1, dueDays: 50 }]);
  });

  it("periodo sozinho vale o proprio prazo (s=7, q=15, m=30)", () => {
    expect(parsePaymentCondition("s").installments[0].dueDays).toBe(7);
    expect(parsePaymentCondition("q").installments[0].dueDays).toBe(15);
    expect(parsePaymentCondition("m").installments[0].dueDays).toBe(30);
    expect(parsePaymentCondition("s").kind).toBe("single");
  });

  it("periodo aceita multiplicador, caixa alta, 'dias' e o nome por extenso", () => {
    expect(parsePaymentCondition("2s").installments[0].dueDays).toBe(14);
    expect(parsePaymentCondition("2q+10").installments[0].dueDays).toBe(40);
    expect(parsePaymentCondition("3m + 5 dias").installments[0].dueDays).toBe(95);
    expect(parsePaymentCondition("S+20").installments[0].dueDays).toBe(27);
    expect(parsePaymentCondition("semana + 20").installments[0].dueDays).toBe(27);
    expect(parsePaymentCondition("quinzena + 20").installments[0].dueDays).toBe(35);
    expect(parsePaymentCondition("mes + 20").installments[0].dueDays).toBe(50);
    expect(parsePaymentCondition("mês").installments[0].dueDays).toBe(30);
    expect(parsePaymentCondition("2 semanas").installments[0].dueDays).toBe(14);
  });

  it("periodo normaliza o raw (mesma condicao = mesmo texto canonico)", () => {
    expect(parsePaymentCondition("S + 20").raw).toBe("s+20");
    expect(parsePaymentCondition("semana + 20").raw).toBe("s+20");
    expect(parsePaymentCondition("q").raw).toBe("q");
    expect(parsePaymentCondition("2 meses + 5").raw).toBe("2m+5");
  });

  it("periodo vale dentro da lista de parcelas e leva os mesmos dias", () => {
    const result = parsePaymentCondition("s+20/m/A Vista");
    expect(result.kind).toBe("fixed_days");
    expect(result.installments.map((i) => i.dueDays)).toEqual([27, 30, 0]);
    expect(result.raw).toBe("s+20/m/A Vista");
    // O periodo e apenas uma forma curta de escrever o prazo: cai nos mesmos dias.
    expect(result.installments).toEqual(parsePaymentCondition("27/30/0").installments);
  });

  it("periodo gera o mesmo summary do prazo equivalente em dias", () => {
    expect(parsePaymentCondition("s+20").summary).toBe("1 parcela em 27 dias");
    expect(parsePaymentCondition("s/q").summary).toBe("2 parcelas (7/15 dias)");
  });

  it("rejeita periodo sem prazo valido", () => {
    expect(() => parsePaymentCondition("s+")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("0s")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("s 20")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("x+20")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("500m")).toThrow(PaymentConditionParseError);
  });

  it("'A Vista' isolado gera uma parcela em 0 dias", () => {
    const result = parsePaymentCondition("A Vista");
    expect(result.kind).toBe("single");
    expect(result.installments).toEqual([{ number: 1, dueDays: 0 }]);
    expect(result.summary).toBe("A vista");
  });

  it("gera um summary legivel", () => {
    expect(parsePaymentCondition("Para 93 dias").summary).toBe("1 parcela em 93 dias");
    expect(parsePaymentCondition("50").summary).toBe("1 parcela em 50 dias");
    expect(parsePaymentCondition("50 parcelas").summary).toBe("50 parcelas mensais");
    expect(parsePaymentCondition("10/20/30").summary).toBe("3 parcelas (10/20/30 dias)");
  });

  it("normaliza espacos em excesso", () => {
    expect(parsePaymentCondition("  A Vista / 40 / 60 ").installmentCount).toBe(3);
    expect(parsePaymentCondition("Para   93   dias").installments[0].dueDays).toBe(93);
  });

  it("rejeita texto vazio", () => {
    expect(() => parsePaymentCondition("")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("   ")).toThrow(PaymentConditionParseError);
  });

  it("rejeita tokens invalidos na lista", () => {
    expect(() => parsePaymentCondition("10/abc/30")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("10//30")).toThrow(PaymentConditionParseError);
  });

  it("rejeita formatos nao reconhecidos", () => {
    expect(() => parsePaymentCondition("qualquer coisa")).toThrow(PaymentConditionParseError);
  });

  it("rejeita quantidade de parcelas acima do limite", () => {
    expect(() => parsePaymentCondition("400 parcelas")).toThrow(PaymentConditionParseError);
  });

  it("rejeita prazo em dias acima do limite", () => {
    expect(() => parsePaymentCondition("4000")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("Para 4000 dias")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("10/4000")).toThrow(PaymentConditionParseError);
  });

  it("tryParsePaymentCondition retorna null em erro", () => {
    expect(tryParsePaymentCondition("nada")).toBeNull();
    expect(tryParsePaymentCondition("10/20")).not.toBeNull();
  });
});
