import { describe, expect, it } from "vitest";

import { compareSortValues, sortRows, type Column } from "./ui";

interface Row {
  name: string;
  tons: number | null;
}

const columns: Column<Row>[] = [
  { key: "name", header: "Cliente", render: (row) => row.name, sortValue: (row) => row.name },
  { key: "tons", header: "Toneladas", render: () => null, sortValue: (row) => row.tons },
  { key: "acoes", header: "", render: () => null }
];

const rows: Row[] = [
  { name: "Ângela", tons: 12 },
  { name: "bruno", tons: null },
  { name: "Carlos", tons: 3 },
  { name: "Areial 10", tons: 7 },
  { name: "Areial 2", tons: 7 }
];

describe("sortRows", () => {
  it("sem ordem escolhida devolve a lista como veio", () => {
    expect(sortRows(rows, columns, null)).toBe(rows);
  });

  it("texto pelo alfabeto do portugues, sem ligar para acento, caixa e numero no nome", () => {
    const names = sortRows(rows, columns, { key: "name", dir: "asc" }).map((row) => row.name);
    expect(names).toEqual(["Ângela", "Areial 2", "Areial 10", "bruno", "Carlos"]);
  });

  it("numero como numero; vazio fica no fim nos dois sentidos", () => {
    const asc = sortRows(rows, columns, { key: "tons", dir: "asc" }).map((row) => row.tons);
    const desc = sortRows(rows, columns, { key: "tons", dir: "desc" }).map((row) => row.tons);
    expect(asc).toEqual([3, 7, 7, 12, null]);
    expect(desc).toEqual([12, 7, 7, 3, null]);
  });

  it("coluna sem valor de ordenacao nao reordena", () => {
    expect(sortRows(rows, columns, { key: "acoes", dir: "asc" })).toBe(rows);
  });
});

describe("compareSortValues", () => {
  it("vazio vai depois de qualquer valor", () => {
    expect(compareSortValues(null, 1)).toBeGreaterThan(0);
    expect(compareSortValues("a", "")).toBeLessThan(0);
    expect(compareSortValues(undefined, null)).toBe(0);
  });
});
