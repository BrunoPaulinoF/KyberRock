import { describe, expect, it } from "vitest";

import {
  formatDocument,
  formatPlate,
  isValidCnpj,
  isValidCpf,
  isValidDocument,
  isValidPlate,
  normalizeDocument,
  normalizePlate
} from "./format";

describe("normalizePlate", () => {
  it("uppercases and removes non-alphanumeric characters", () => {
    expect(normalizePlate("abc-1234")).toBe("ABC1234");
  });

  it("strips Mercosul dash", () => {
    expect(normalizePlate("abc1d23")).toBe("ABC1D23");
  });

  it("does not truncate; caller must enforce length", () => {
    expect(normalizePlate("ABC12345")).toBe("ABC12345");
  });

  it("returns empty string for blank input", () => {
    expect(normalizePlate("   ")).toBe("");
  });
});

describe("normalizeDocument", () => {
  it("keeps only digits", () => {
    expect(normalizeDocument("123.456.789-09")).toBe("12345678909");
  });

  it("caps length at 18", () => {
    expect(normalizeDocument("1".repeat(20))).toBe("1".repeat(18));
  });

  it("returns empty for blank", () => {
    expect(normalizeDocument("")).toBe("");
  });
});

describe("plate validation", () => {
  it("accepts old format plates", () => {
    expect(isValidPlate("ABC1234")).toBe(true);
    expect(isValidPlate("abc-1234")).toBe(true);
  });

  it("accepts Mercosul plates", () => {
    expect(isValidPlate("ABC1D23")).toBe(true);
  });

  it("rejects short or oversized plates", () => {
    expect(isValidPlate("AB1234")).toBe(false);
    expect(isValidPlate("ABC12345")).toBe(false);
  });
});

describe("document validation", () => {
  it("accepts valid CPF", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("rejects invalid CPF", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("12345678901")).toBe(false);
  });

  it("accepts valid CNPJ", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("rejects invalid CNPJ", () => {
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });

  it("isValidDocument dispatches by length", () => {
    expect(isValidDocument("529.982.247-25")).toBe(true);
    expect(isValidDocument("11.222.333/0001-81")).toBe(true);
    expect(isValidDocument("123")).toBe(false);
  });
});

describe("formatPlate", () => {
  it("formats old plates with dash", () => {
    expect(formatPlate("abc1234")).toBe("ABC-1234");
  });

  it("formats Mercosul plates without dash", () => {
    expect(formatPlate("abc1d23")).toBe("ABC1D23");
  });
});

describe("formatDocument", () => {
  it("formats CPF", () => {
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
  });

  it("formats CNPJ", () => {
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("returns digits when length is not CPF/CNPJ", () => {
    expect(formatDocument("12345")).toBe("12345");
  });
});
