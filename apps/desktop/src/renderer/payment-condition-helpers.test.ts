import { describe, expect, it } from "vitest";

import {
  conditionTermMatches,
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
