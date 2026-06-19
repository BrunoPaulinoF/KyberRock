import { describe, expect, it } from "vitest";

import {
  formatCep,
  formatDocument,
  formatMoneyInput,
  formatPhone,
  formatPlate,
  isValidCep,
  isValidCnpj,
  isValidCpf,
  isValidDocument,
  isValidEmail,
  isValidMoneyInput,
  isValidPlate,
  normalizeCep,
  normalizeDocument,
  normalizeEmail,
  normalizeMoneyInput,
  normalizePhone,
  normalizePlate,
  parseMoneyInputToCents
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

  it("caps length at 14", () => {
    expect(normalizeDocument("1".repeat(20))).toBe("1".repeat(14));
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

describe("normalizePhone", () => {
  it("keeps digits only and caps at 11", () => {
    expect(normalizePhone("(11) 9 1234-5678")).toBe("11912345678");
    expect(normalizePhone("12345678901234")).toBe("12345678901");
  });
});

describe("formatPhone", () => {
  it("formats cellphone with 11 digits", () => {
    expect(formatPhone("11912345678")).toBe("(11) 91234-5678");
  });

  it("formats landline with 10 digits", () => {
    expect(formatPhone("1112345678")).toBe("(11) 1234-5678");
  });
});

describe("normalizeEmail / isValidEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });

  it("accepts valid emails", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("user@.com")).toBe(false);
    expect(isValidEmail("user example.com")).toBe(false);
  });
});

describe("normalizeCep / formatCep / isValidCep", () => {
  it("normalizes to 8 digits", () => {
    expect(normalizeCep("01310-100")).toBe("01310100");
  });

  it("formats CEP", () => {
    expect(formatCep("01310100")).toBe("01310-100");
  });

  it("validates 8-digit CEP", () => {
    expect(isValidCep("01310100")).toBe(true);
    expect(isValidCep("0131")).toBe(false);
  });
});

describe("normalizeMoneyInput", () => {
  it("strips currency symbols and letters", () => {
    expect(normalizeMoneyInput("R$ 1.250,75abc")).toBe("1250.75");
  });

  it("treats dot as thousands separator when no comma is present", () => {
    expect(normalizeMoneyInput("1.500")).toBe("1500");
  });

  it("prefers comma as decimal separator", () => {
    expect(normalizeMoneyInput("1.500,50")).toBe("1500.50");
  });
});

describe("formatMoneyInput", () => {
  it("formats decimal numbers with comma", () => {
    expect(formatMoneyInput("1250.5")).toBe("1.250,50");
  });

  it("formats integers with dot grouping", () => {
    expect(formatMoneyInput("1500")).toBe("1.500");
  });

  it("returns empty for empty input", () => {
    expect(formatMoneyInput("")).toBe("");
  });
});

describe("parseMoneyInputToCents", () => {
  it("parses formatted BRL to cents", () => {
    expect(parseMoneyInputToCents("1.250,75")).toBe(125075);
  });

  it("returns null for invalid input", () => {
    expect(parseMoneyInputToCents("abc")).toBeNull();
  });

  it("returns null for negative values", () => {
    expect(parseMoneyInputToCents("-10")).toBeNull();
  });
});

describe("isValidMoneyInput", () => {
  it("treats empty as valid", () => {
    expect(isValidMoneyInput("")).toBe(true);
  });

  it("accepts formatted BRL", () => {
    expect(isValidMoneyInput("1.250,75")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidMoneyInput("abc")).toBe(false);
  });
});
