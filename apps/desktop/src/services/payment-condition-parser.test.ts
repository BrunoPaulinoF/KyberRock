import { describe, expect, it } from "vitest";

import {
  PaymentConditionParseError,
  conditionDueDaysForSale,
  installmentDueDaysForSale,
  parsePaymentCondition,
  periodDueDate,
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

  it("formato 6: periodo + dias guarda o periodo e o prazo nominal", () => {
    expect(parsePaymentCondition("q + 15").installments).toEqual([
      { number: 1, dueDays: 30, period: { unit: "q", count: 1, extraDays: 15 } }
    ]);
    expect(parsePaymentCondition("s + 20").installments[0].dueDays).toBe(27);
    expect(parsePaymentCondition("d + 20").installments[0].dueDays).toBe(30);
    expect(parsePaymentCondition("m + 20").installments[0].dueDays).toBe(50);
  });

  it("prazo nominal do periodo sozinho (s=7, d=10, q=15, m=30)", () => {
    expect(parsePaymentCondition("s").installments[0].dueDays).toBe(7);
    expect(parsePaymentCondition("d").installments[0].dueDays).toBe(10);
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
    expect(parsePaymentCondition("D+20").installments[0].dueDays).toBe(30);
    expect(parsePaymentCondition("dezena + 20").installments[0].dueDays).toBe(30);
    expect(parsePaymentCondition("3 dezenas").installments[0].dueDays).toBe(30);
  });

  it("periodo normaliza o raw (mesma condicao = mesmo texto canonico)", () => {
    expect(parsePaymentCondition("S + 20").raw).toBe("s+20");
    expect(parsePaymentCondition("semana + 20").raw).toBe("s+20");
    expect(parsePaymentCondition("q").raw).toBe("q");
    expect(parsePaymentCondition("2 meses + 5").raw).toBe("2m+5");
    expect(parsePaymentCondition("dezena + 20").raw).toBe("d+20");
  });

  it("periodo vale dentro da lista de parcelas", () => {
    const result = parsePaymentCondition("s+20/d+20/m/A Vista");
    expect(result.kind).toBe("fixed_days");
    expect(result.installments.map((i) => i.dueDays)).toEqual([27, 30, 30, 0]);
    expect(result.raw).toBe("s+20/d+20/m/A Vista");
    expect(result.installments.map((i) => i.period?.unit ?? null)).toEqual(["s", "d", "m", null]);
  });

  it("summary do periodo diz que conta do fim do periodo", () => {
    expect(parsePaymentCondition("q+15").summary).toBe("1 parcela no fim da quinzena + 15 dias");
    expect(parsePaymentCondition("m").summary).toBe("1 parcela no fim do mes");
    expect(parsePaymentCondition("2q+10").summary).toBe(
      "1 parcela no fim da 2a quinzena + 10 dias"
    );
    expect(parsePaymentCondition("q/30").summary).toBe("2 parcelas (fim da quinzena / 30 dias)");
    // Sem periodo, o summary de sempre.
    expect(parsePaymentCondition("7/14/21").summary).toBe("3 parcelas (7/14/21 dias)");
  });

  it("rejeita periodo sem prazo valido", () => {
    expect(() => parsePaymentCondition("s+")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("0s")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("s 20")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("x+20")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("500m")).toThrow(PaymentConditionParseError);
    expect(() => parsePaymentCondition("0d")).toThrow(PaymentConditionParseError);
    // "3 dias" nao e periodo: o prazo em dias e o numero solto ("3").
    expect(() => parsePaymentCondition("3 dias")).toThrow(PaymentConditionParseError);
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

describe("vencimento da condicao em periodo (fora periodo)", () => {
  const q15 = { unit: "q", count: 1, extraDays: 15 } as const;

  it("q+15: venda de 01 a 15 vence dia 30, de 16 em diante vence dia 15 do mes seguinte", () => {
    expect(periodDueDate("2026-10-01", q15)).toBe("2026-10-30");
    expect(periodDueDate("2026-10-10", q15)).toBe("2026-10-30");
    expect(periodDueDate("2026-10-15", q15)).toBe("2026-10-30");
    expect(periodDueDate("2026-10-16", q15)).toBe("2026-11-15");
    expect(periodDueDate("2026-10-31", q15)).toBe("2026-11-15");
    // Virada de ano.
    expect(periodDueDate("2026-12-20", q15)).toBe("2027-01-15");
  });

  it("m+10 vence dia 10 do mes seguinte, qualquer que seja o dia da venda", () => {
    const m10 = { unit: "m", count: 1, extraDays: 10 } as const;
    expect(periodDueDate("2026-10-01", m10)).toBe("2026-11-10");
    expect(periodDueDate("2026-10-31", m10)).toBe("2026-11-10");
    expect(periodDueDate("2026-02-14", m10)).toBe("2026-03-10");
  });

  it("dezena fecha nos dias 10, 20 e no ultimo dia do mes", () => {
    const d0 = { unit: "d", count: 1, extraDays: 0 } as const;
    expect(periodDueDate("2026-10-03", d0)).toBe("2026-10-10");
    expect(periodDueDate("2026-10-11", d0)).toBe("2026-10-20");
    expect(periodDueDate("2026-10-21", d0)).toBe("2026-10-31");
    expect(periodDueDate("2026-02-25", d0)).toBe("2026-02-28");
  });

  it("semana termina no domingo", () => {
    const s0 = { unit: "s", count: 1, extraDays: 0 } as const;
    // 2026-10-02 e sexta; 2026-10-04 e domingo.
    expect(periodDueDate("2026-10-02", s0)).toBe("2026-10-04");
    expect(periodDueDate("2026-10-04", s0)).toBe("2026-10-04");
    expect(periodDueDate("2026-10-05", { ...s0, extraDays: 10 })).toBe("2026-10-21");
  });

  it("multiplicador avanca para o fim do periodo seguinte", () => {
    expect(periodDueDate("2026-10-02", { unit: "q", count: 2, extraDays: 0 })).toBe("2026-10-31");
    expect(periodDueDate("2026-10-20", { unit: "q", count: 2, extraDays: 0 })).toBe("2026-11-15");
    expect(periodDueDate("2026-10-20", { unit: "m", count: 2, extraDays: 5 })).toBe("2026-12-05");
  });

  it("prazo em dias contado da venda, que e o que vai para o OMIE", () => {
    expect(installmentDueDaysForSale(parsePaymentCondition("q+15"), "2026-10-02")).toEqual([28]);
    expect(installmentDueDaysForSale(parsePaymentCondition("q+15"), "2026-10-15")).toEqual([15]);
    // Parcela em dias fica como esta; so a em periodo depende da data.
    expect(installmentDueDaysForSale(parsePaymentCondition("A Vista/q+15"), "2026-10-20")).toEqual([
      0, 26
    ]);
  });

  it("le o texto gravado, e so responde quando ha periodo", () => {
    expect(conditionDueDaysForSale("q+12", "2026-10-02")).toEqual([25]);
    expect(conditionDueDaysForSale("30", "2026-10-02")).toBeNull();
    expect(conditionDueDaysForSale("texto qualquer", "2026-10-02")).toBeNull();
    expect(conditionDueDaysForSale(null, "2026-10-02")).toBeNull();
  });
});
