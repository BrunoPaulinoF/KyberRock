import { describe, expect, it } from "vitest";

import { closedPeriodBounds, closedPeriodFilter, closedSearchFilter } from "./closed-operations";

describe("operacoes concluidas: periodo opcional", () => {
  it("sem data nao filtra", () => {
    const bounds = closedPeriodBounds("", "");
    expect(bounds).toEqual({ startIso: null, endIso: null });
    expect(closedPeriodFilter(bounds)).toBeNull();
  });

  it("intervalo pega do comeco do primeiro dia ao fim do ultimo (fuso -03:00)", () => {
    const bounds = closedPeriodBounds("2026-09-01", "2026-09-29");
    expect(bounds).toEqual({
      startIso: "2026-09-01T03:00:00.000Z",
      endIso: "2026-09-30T03:00:00.000Z"
    });
    expect(closedPeriodFilter(bounds)).toBe(
      'and(closed_at.gte."2026-09-01T03:00:00.000Z",closed_at.lt."2026-09-30T03:00:00.000Z"),' +
        'and(closed_at.is.null,created_at.gte."2026-09-01T03:00:00.000Z",created_at.lt."2026-09-30T03:00:00.000Z")'
    );
  });

  it("so uma ponta: aberto do outro lado; datas invertidas sao trocadas", () => {
    expect(closedPeriodBounds("2026-09-10", "")).toEqual({
      startIso: "2026-09-10T03:00:00.000Z",
      endIso: null
    });
    expect(closedPeriodFilter(closedPeriodBounds("", "2026-09-10"))).toBe(
      'and(closed_at.lt."2026-09-11T03:00:00.000Z"),and(closed_at.is.null,created_at.lt."2026-09-11T03:00:00.000Z")'
    );
    expect(closedPeriodBounds("2026-09-30", "2026-09-01")).toEqual(
      closedPeriodBounds("2026-09-01", "2026-09-30")
    );
  });
});

describe("operacoes concluidas: busca", () => {
  it("cliente, produto e placa sem hifen; vazio nao filtra", () => {
    expect(closedSearchFilter("  ")).toBeNull();
    expect(closedSearchFilter("abc-1d23")).toBe(
      "customer_name.ilike.*abc-1d23*,product_description.ilike.*abc-1d23*,plate.ilike.*abc1d23*"
    );
    expect(closedSearchFilter("Silva, Jose")).toContain("customer_name.ilike.*Silva* Jose*");
  });

  it("numero tambem procura a nota fiscal, sem os zeros da esquerda", () => {
    expect(closedSearchFilter("4521")).toContain("omie_invoice_number.eq.4521");
    expect(closedSearchFilter("NF 004521")).toContain("omie_invoice_number.eq.4521");
    expect(closedSearchFilter("nf-e 4521")).toContain("omie_invoice_number.eq.4521");
    expect(closedSearchFilter("Brita")).not.toContain("omie_invoice_number");
  });
});
