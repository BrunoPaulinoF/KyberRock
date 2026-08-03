import { describe, expect, it } from "vitest";

import {
  conditionTermMatches,
  describePaymentCondition,
  extractConditionDueDays,
  extractConditionRaw
} from "./payment-condition-helpers";
import { parsePaymentCondition } from "../services/payment-condition-parser";

function rulesJson(raw: string, dueDays: number[]): string {
  return JSON.stringify({
    raw,
    installments: dueDays.map((days, index) => ({ number: index + 1, dueDays: days }))
  });
}

describe("extractConditionRaw", () => {
  it("le o texto canonico e tolera json invalido", () => {
    expect(extractConditionRaw(rulesJson("7/14/21", [7, 14, 21]))).toBe("7/14/21");
    expect(extractConditionRaw("{")).toBe("");
    expect(extractConditionRaw("")).toBe("");
  });
});

describe("extractConditionDueDays", () => {
  it("le os prazos gravados e retorna null quando nao ha parcelas", () => {
    expect(extractConditionDueDays(rulesJson("7/14", [7, 14]))).toEqual([7, 14]);
    expect(extractConditionDueDays(JSON.stringify({ raw: "7/14" }))).toBeNull();
    expect(extractConditionDueDays("{")).toBeNull();
  });
});

describe("describePaymentCondition", () => {
  it("explica o campo vazio como a vista", () => {
    expect(describePaymentCondition("")).toEqual({
      status: "empty",
      message: "Vazio = a vista (vencimento no dia da venda)."
    });
  });

  it("explica o prazo unico digitado em dias ou em periodo", () => {
    expect(describePaymentCondition("30").message).toBe("1 parcela em 30 dias apos a venda.");
    // "s+20" cai no mesmo dia que "27": periodo e so uma forma curta de escrever o prazo.
    expect(describePaymentCondition("s + 20").message).toBe("1 parcela em 27 dias apos a venda.");
    expect(describePaymentCondition("q+20").message).toBe("1 parcela em 35 dias apos a venda.");
    expect(describePaymentCondition("m+20").message).toBe("1 parcela em 50 dias apos a venda.");
  });

  it("explica o parcelamento em lista e por quantidade", () => {
    expect(describePaymentCondition("7 14 21").message).toBe(
      "3 parcelas: 7, 14 e 21 dias apos a venda."
    );
    expect(describePaymentCondition("3 parcelas").message).toBe(
      "3 parcelas: 30, 60 e 90 dias apos a venda."
    );
    expect(describePaymentCondition("A Vista/40/60").message).toBe(
      "3 parcelas: a vista, 40 e 60 dias apos a venda."
    );
  });

  it("resume parcelamentos longos", () => {
    expect(describePaymentCondition("12 parcelas").message).toBe(
      "12 parcelas: 30, 60, 90, ... e 360 dias apos a venda."
    );
  });

  it("avisa quando o texto nao e reconhecido", () => {
    expect(describePaymentCondition("qualquer coisa")).toEqual({
      status: "invalid",
      message: "Condicao nao reconhecida. Use um dos formatos abaixo."
    });
  });
});

describe("conditionTermMatches", () => {
  it("reusa a condicao quando o texto e os prazos batem", () => {
    const parsed = parsePaymentCondition("7 14 21");
    expect(conditionTermMatches(rulesJson("7/14/21", [7, 14, 21]), parsed)).toBe(true);
  });

  it("nao reusa uma condicao antiga com o mesmo texto e regra diferente", () => {
    // Termo gravado quando "5" significava 5 parcelas mensais.
    const legacy = rulesJson("5", [30, 60, 90, 120, 150]);
    expect(conditionTermMatches(legacy, parsePaymentCondition("5"))).toBe(false);
    expect(conditionTermMatches(rulesJson("5", [5]), parsePaymentCondition("5"))).toBe(true);
  });

  it("nao reusa quando o texto canonico e outro", () => {
    expect(conditionTermMatches(rulesJson("7/14", [7, 14]), parsePaymentCondition("7 14 21"))).toBe(
      false
    );
  });
});
