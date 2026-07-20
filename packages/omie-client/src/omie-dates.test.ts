import { describe, expect, it } from "vitest";

import { formatOmieDate, parseOmieDate, toCents } from "./omie-dates";

describe("parseOmieDate", () => {
  it("converte dd/mm/aaaa para ISO", () => {
    expect(parseOmieDate("15/07/2026")).toBe("2026-07-15");
  });

  it("retorna null para valores invalidos ou ausentes", () => {
    expect(parseOmieDate("2026-07-15")).toBeNull();
    expect(parseOmieDate(undefined)).toBeNull();
    expect(parseOmieDate("")).toBeNull();
  });
});

describe("formatOmieDate", () => {
  it("converte ISO para dd/mm/aaaa", () => {
    expect(formatOmieDate("2026-07-15")).toBe("15/07/2026");
  });
});

describe("toCents", () => {
  it("converte numero e string para centavos", () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("1234,56")).toBe(123456);
  });

  it("retorna 0 para valores vazios ou invalidos", () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents("")).toBe(0);
    expect(toCents("abc")).toBe(0);
  });
});
