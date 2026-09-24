import { describe, expect, it } from "vitest";

import {
  countByProduct,
  formatArrival,
  inProgress,
  overtime,
  recentlyCompleted,
  type LoadingItem
} from "./loading";

const NOW = Date.parse("2026-09-24T15:00:00.000Z"); // 12:00 em Brasilia

function item(input: Partial<LoadingItem> & { id: string }): LoadingItem {
  return {
    plate: "ABC1D23",
    customerName: "Cliente",
    driverName: "Motorista",
    productDescription: "Brita 1",
    createdAt: "2026-09-24T14:00:00.000Z",
    loaderCompletedAt: null,
    ...input
  };
}

describe("fila de carregamento", () => {
  it("horario curto no mesmo dia, com data quando a fila virou o dia", () => {
    expect(formatArrival("2026-09-24T13:05:00.000Z", "America/Sao_Paulo", NOW)).toBe("10:05");
    expect(formatArrival("2026-09-23T20:30:00.000Z", "America/Sao_Paulo", NOW)).toBe("23/09 17:30");
    expect(formatArrival(null)).toBe("-");
  });

  it("conta por produto, maior fila primeiro", () => {
    const items = [
      item({ id: "1", productDescription: "Po de pedra" }),
      item({ id: "2", productDescription: "Brita 1" }),
      item({ id: "3", productDescription: "brita 1 " })
    ];
    expect(countByProduct(items)).toEqual([
      { label: "Brita 1", count: 2 },
      { label: "Po de pedra", count: 1 }
    ]);
  });

  it("separa em andamento, acima da media e concluidas ha pouco", () => {
    const items = [
      item({ id: "a", createdAt: "2026-09-24T14:50:00.000Z" }),
      item({ id: "b", createdAt: "2026-09-24T13:00:00.000Z" }),
      item({ id: "c", loaderCompletedAt: "2026-09-24T14:45:00.000Z" }),
      item({ id: "d", loaderCompletedAt: "2026-09-24T13:00:00.000Z" })
    ];
    expect(inProgress(items).map((i) => i.id)).toEqual(["a", "b"]);
    expect(overtime(items, 60, NOW).map((i) => i.id)).toEqual(["b"]);
    expect(overtime(items, null, NOW)).toEqual([]);
    expect(recentlyCompleted(items, NOW).map((i) => i.id)).toEqual(["c"]);
  });
});
