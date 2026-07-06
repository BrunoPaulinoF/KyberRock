import { describe, expect, it } from "vitest";

import {
  CASH_ONLY_METHOD_CODES,
  isCashCondition,
  validatePaymentMethodCondition
} from "./payment-method-condition-guard.js";

describe("isCashCondition", () => {
  it("treats an empty/undefined condition as a vista", () => {
    expect(isCashCondition(undefined)).toBe(true);
    expect(isCashCondition(null)).toBe(true);
    expect(isCashCondition({})).toBe(true);
    expect(isCashCondition({ raw: "" })).toBe(true);
    expect(isCashCondition({ raw: "   " })).toBe(true);
  });

  it("accepts an explicit a vista condition", () => {
    expect(isCashCondition({ raw: "A Vista" })).toBe(true);
    expect(isCashCondition({ raw: "a vista" })).toBe(true);
  });

  it("rejects any condition with prazo or parcelamento", () => {
    expect(isCashCondition({ raw: "7/14/21" })).toBe(false);
    expect(isCashCondition({ raw: "7/14/21/28" })).toBe(false);
    expect(isCashCondition({ raw: "Para 30 dias" })).toBe(false);
    expect(isCashCondition({ raw: "30" })).toBe(false);
    expect(isCashCondition({ raw: "3 Parcelas" })).toBe(false);
  });

  it("uses installmentCount when provided", () => {
    expect(isCashCondition({ installmentCount: 1 })).toBe(true);
    expect(isCashCondition({ installmentCount: 0 })).toBe(true);
    expect(isCashCondition({ installmentCount: 2 })).toBe(false);
    expect(isCashCondition({ installmentCount: 28 })).toBe(false);
  });

  it("never treats an invalid condition text as a vista", () => {
    expect(isCashCondition({ raw: "??? invalido ???" })).toBe(false);
  });
});

describe("validatePaymentMethodCondition", () => {
  const cash = { code: "cash", isCustomerCredit: false };

  it("allows cash only with a vista", () => {
    expect(validatePaymentMethodCondition(cash, { raw: "A Vista" }).allowed).toBe(true);
    expect(validatePaymentMethodCondition(cash, { raw: "" }).allowed).toBe(true);
    expect(validatePaymentMethodCondition(cash, undefined).allowed).toBe(true);
  });

  it("blocks cash with prazo/parcelamento and returns a message", () => {
    const result = validatePaymentMethodCondition(cash, { raw: "7/14/21/28" });
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/vista/i);
  });

  it("blocks cash with manual installments greater than one", () => {
    expect(validatePaymentMethodCondition(cash, { installmentCount: 3 }).allowed).toBe(false);
    expect(validatePaymentMethodCondition(cash, { installmentCount: 1 }).allowed).toBe(true);
  });

  it("does not restrict non-cash methods", () => {
    const pix = { code: "pix", isCustomerCredit: false };
    const boleto = { code: "boleto", isCustomerCredit: false };
    const credit = { code: "customer_credit", isCustomerCredit: true };
    expect(validatePaymentMethodCondition(pix, { raw: "7/14/21" }).allowed).toBe(true);
    expect(validatePaymentMethodCondition(boleto, { raw: "30" }).allowed).toBe(true);
    expect(validatePaymentMethodCondition(credit, { raw: "7/14/21/28" }).allowed).toBe(true);
  });

  it("is a no-op when the method is unknown", () => {
    expect(validatePaymentMethodCondition(null, { raw: "7/14/21" }).allowed).toBe(true);
  });

  it("keeps cash as the only restricted code by default", () => {
    expect(CASH_ONLY_METHOD_CODES.has("cash")).toBe(true);
    expect(CASH_ONLY_METHOD_CODES.has("pix")).toBe(false);
  });
});
