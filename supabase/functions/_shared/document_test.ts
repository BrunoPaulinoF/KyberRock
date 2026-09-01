import { describe, expect, it } from "vitest";

import {
  documentKind,
  isValidCnpj,
  isValidCpf,
  isValidDocument,
  normalizeDocument
} from "./document.ts";

describe("normalizeDocument", () => {
  it("drops the mask of a numeric CNPJ", () => {
    expect(normalizeDocument("12.345.678/0001-99")).toBe("12345678000199");
  });

  it("keeps the letters of an alphanumeric CNPJ, in upper case", () => {
    expect(normalizeDocument("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("returns empty for null", () => {
    expect(normalizeDocument(null)).toBe("");
  });
});

describe("documentKind", () => {
  it("tells CPF from CNPJ by shape, not by digit count", () => {
    expect(documentKind("529.982.247-25")).toBe("cpf");
    expect(documentKind("11.222.333/0001-81")).toBe("cnpj");
    // 11 digitos, mas e um CNPJ: contar digitos mandaria o cadastro ao OMIE como PF.
    expect(documentKind("12.ABC.345/01DE-35")).toBe("cnpj");
    expect(documentKind("123")).toBe(null);
  });
});

describe("isValidCnpj", () => {
  it("accepts both formats", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
  });

  it("rejects wrong check digits and letters in the check digits", () => {
    expect(isValidCnpj("12.ABC.345/01DE-36")).toBe(false);
    expect(isValidCnpj("12ABC34501DEA5")).toBe(false);
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });
});

describe("isValidCpf / isValidDocument", () => {
  it("keeps the CPF rules untouched", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });

  it("dispatches by shape", () => {
    expect(isValidDocument("529.982.247-25")).toBe(true);
    expect(isValidDocument("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidDocument("5299822472A")).toBe(false);
  });
});
