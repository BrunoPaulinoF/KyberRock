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

  it("formato 4: numero inteiro isolado = parcelas mensais", () => {
    const result = parsePaymentCondition("50");
    expect(result.kind).toBe("monthly_count");
    expect(result.installmentCount).toBe(50);
    expect(result.intervalDays).toBe(30);
    expect(result.installments[0].dueDays).toBe(30);
    expect(result.installments[49].dueDays).toBe(1500);
  });

  it("formato 5: 'N Parcelas' = parcelas mensais", () => {
    const result = parsePaymentCondition("3 Parcelas");
    expect(result.kind).toBe("monthly_count");
    expect(result.installmentCount).toBe(3);
    expect(result.installments.map((i) => i.dueDays)).toEqual([30, 60, 90]);
  });

  it("'A Vista' isolado gera uma parcela em 0 dias", () => {
    const result = parsePaymentCondition("A Vista");
    expect(result.kind).toBe("single");
    expect(result.installments).toEqual([{ number: 1, dueDays: 0 }]);
    expect(result.summary).toBe("A vista");
  });

  it("gera um summary legivel", () => {
    expect(parsePaymentCondition("Para 93 dias").summary).toBe("1 parcela em 93 dias");
    expect(parsePaymentCondition("50").summary).toBe("50 parcelas mensais");
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
    expect(() => parsePaymentCondition("400")).toThrow(PaymentConditionParseError);
  });

  it("tryParsePaymentCondition retorna null em erro", () => {
    expect(tryParsePaymentCondition("nada")).toBeNull();
    expect(tryParsePaymentCondition("10/20")).not.toBeNull();
  });
});
