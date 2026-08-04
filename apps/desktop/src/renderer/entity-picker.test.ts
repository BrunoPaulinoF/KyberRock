import { describe, expect, it, vi } from "vitest";

import type { CacheQueryOptions } from "../services/cache-store";
import {
  ENTITY_PICKER_PAGE_SIZE,
  buildEntityPickerItems,
  filterEntityPickerItems,
  loadAllCacheRows
} from "./entity-picker";

describe("entity picker items", () => {
  it("uses the trade name and falls back to the legal name when it is blank", () => {
    const items = buildEntityPickerItems("customer", [
      { id: "c1", tradeName: "  ", legalName: "LEVISA MINERACAO LTDA", document: "12345678000190" },
      { id: "c2", tradeName: "Pedreira Alfa", legalName: "Alfa Mineracao SA" }
    ]);

    expect(items.map((item) => item.title)).toEqual(["LEVISA MINERACAO LTDA", "Pedreira Alfa"]);
  });

  it("falls back to the document and then to the id when there is no name at all", () => {
    const items = buildEntityPickerItems("carrier", [
      { id: "t1", name: "", document: "98765432000155" },
      { id: "t2", name: "" }
    ]);

    expect(items.map((item) => item.title).sort()).toEqual(["98765432000155", "t2"]);
  });

  it("sorts alphabetically and flags inactive records instead of hiding them", () => {
    const items = buildEntityPickerItems("customer", [
      { id: "c1", tradeName: "Zeta", isActive: true },
      { id: "c2", tradeName: "Levisa", isActive: false },
      { id: "c3", tradeName: "Alfa", isActive: true }
    ]);

    expect(items.map((item) => item.title)).toEqual(["Alfa", "Levisa", "Zeta"]);
    expect(items.find((item) => item.title === "Levisa")?.isActive).toBe(false);
  });

  it("keeps the subtitle only when it adds information", () => {
    const [sameName, differentName] = buildEntityPickerItems("customer", [
      { id: "c1", tradeName: "Alfa", legalName: "Alfa" },
      { id: "c2", tradeName: "Beta", legalName: "Beta Mineracao SA" }
    ]);

    expect(sameName.subtitle).toBeNull();
    expect(differentName.subtitle).toBe("Beta Mineracao SA");
  });

  it("shows the document in the subtitle, next to the legal name", () => {
    const [item] = buildEntityPickerItems("customer", [
      { id: "c1", tradeName: "Levisa", legalName: "Levisa Mineracao", document: "12345678000190" }
    ]);

    expect(item.subtitle).toBe("Levisa Mineracao · 12345678000190");
  });
});

describe("entity picker search", () => {
  const items = buildEntityPickerItems("customer", [
    {
      id: "c1",
      tradeName: "Levisa",
      legalName: "Levisa Mineracao",
      document: "12.345.678/0001-90"
    },
    { id: "c2", tradeName: "Concreteira Sao Joao", legalName: "Sao Joao SA" },
    { id: "c3", tradeName: "Construtora São Paulo", legalName: "SP Ltda" }
  ]);

  it("matches a fragment anywhere in the name", () => {
    expect(filterEntityPickerItems(items, "visa").map((item) => item.id)).toEqual(["c1"]);
  });

  it("ignores case and accents", () => {
    expect(filterEntityPickerItems(items, "SAO PAULO").map((item) => item.id)).toEqual(["c3"]);
  });

  it("matches the document typed with or without punctuation", () => {
    expect(filterEntityPickerItems(items, "12345678000190").map((item) => item.id)).toEqual(["c1"]);
    expect(filterEntityPickerItems(items, "12.345.678/0001-90").map((item) => item.id)).toEqual([
      "c1"
    ]);
  });

  it("returns everything when the search is empty", () => {
    expect(filterEntityPickerItems(items, "   ")).toHaveLength(3);
  });
});

describe("loadAllCacheRows", () => {
  it("pages through the cache until the full list is read", async () => {
    const total = ENTITY_PICKER_PAGE_SIZE + 3;
    const all = Array.from({ length: total }, (_, index) => ({ id: `c${index}` }));
    const queryCache = vi.fn(async (options: CacheQueryOptions) => {
      const offset = options.offset ?? 0;
      const limit = options.limit ?? ENTITY_PICKER_PAGE_SIZE;
      return { rows: all.slice(offset, offset + limit), total };
    });

    const rows = await loadAllCacheRows({ queryCache }, "customer");

    expect(rows).toHaveLength(total);
    expect(queryCache).toHaveBeenCalledTimes(2);
    expect(rows[total - 1]).toEqual({ id: `c${total - 1}` });
  });

  it("stops after a single page when everything fits", async () => {
    const queryCache = vi.fn(async () => ({ rows: [{ id: "c1" }], total: 1 }));

    const rows = await loadAllCacheRows({ queryCache }, "carrier");

    expect(rows).toEqual([{ id: "c1" }]);
    expect(queryCache).toHaveBeenCalledTimes(1);
  });

  it("reads inactive records by default so the list matches the cadastro screen", async () => {
    const queryCache = vi.fn(async () => ({ rows: [] as unknown[], total: 0 }));

    await loadAllCacheRows({ queryCache }, "customer");

    expect(queryCache).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "customer", activeOnly: false })
    );
  });
});
