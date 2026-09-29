import { describe, expect, it } from "vitest";

import { isoDayOr, isoMonthOr, listOf, oneOf } from "./url-filters";

describe("filtros do endereco", () => {
  const PERIODS = ["today", "7d", "month", "custom"] as const;

  it("aceita so os valores conhecidos; link velho ou digitado errado vira o padrao", () => {
    expect(oneOf("7d", PERIODS, "month")).toBe("7d");
    expect(oneOf("custom", PERIODS, "month")).toBe("custom");
    expect(oneOf("", PERIODS, "month")).toBe("month");
    expect(oneOf("semana-que-vem", PERIODS, "month")).toBe("month");
  });

  it("le a lista de multipla escolha sem repetir e sem o que nao existe", () => {
    const SITUATIONS = ["billed", "pending", "failed"] as const;
    expect(listOf("", SITUATIONS)).toEqual([]);
    expect(listOf("pending,failed", SITUATIONS)).toEqual(["pending", "failed"]);
    expect(listOf("failed, pending,failed,xyz", SITUATIONS)).toEqual(["failed", "pending"]);
  });

  it("so deixa passar data que existe, para a leitura do periodo nao quebrar", () => {
    expect(isoDayOr("2026-09-15", "2026-09-29")).toBe("2026-09-15");
    expect(isoDayOr("", "2026-09-29")).toBe("2026-09-29");
    expect(isoDayOr("15/09/2026", "2026-09-29")).toBe("2026-09-29");
    expect(isoDayOr("2026-13-01", "2026-09-29")).toBe("2026-09-29");
    expect(isoMonthOr("2026-09", "2026-01")).toBe("2026-09");
    expect(isoMonthOr("2026-9", "2026-01")).toBe("2026-01");
    expect(isoMonthOr("2026-00", "2026-01")).toBe("2026-01");
  });
});
