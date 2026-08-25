import { describe, expect, it, vi } from "vitest";

import {
  ENTITY_PICKER_PREVIEW_LIMIT,
  ENTITY_PICKER_RESULT_LIMIT,
  buildEntityPickerItems,
  loadEntityPickerPage
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

  it("mantem a ordem que o cache mandou e marca o inativo em vez de esconde-lo", () => {
    // A ordem e a do cache — alfabetica em repouso, por proximidade com a busca. Reordenar
    // aqui desfazia a pontuacao e devolvia o melhor resultado para o meio da lista.
    const items = buildEntityPickerItems("customer", [
      { id: "c1", tradeName: "Zeta", isActive: true },
      { id: "c2", tradeName: "Levisa", isActive: false },
      { id: "c3", tradeName: "Alfa", isActive: true }
    ]);

    expect(items.map((item) => item.title)).toEqual(["Zeta", "Levisa", "Alfa"]);
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

describe("loadEntityPickerPage", () => {
  it("pede a busca ao cache e devolve a pagina com o total que casou", async () => {
    const queryCache = vi.fn(async () => ({
      rows: [{ id: "c1", tradeName: "Levisa" }],
      total: 312
    }));

    const page = await loadEntityPickerPage({ queryCache }, "customer", "levisa");

    expect(queryCache).toHaveBeenCalledWith({
      entityType: "customer",
      search: "levisa",
      activeOnly: false,
      limit: ENTITY_PICKER_RESULT_LIMIT
    });
    expect(page.items.map((item) => item.id)).toEqual(["c1"]);
    // O total e o que CASOU, nao o que coube: e por ele que o rodape avisa que ha mais.
    expect(page.total).toBe(312);
  });

  it("sem busca le so uma amostra, em vez do cadastro inteiro", async () => {
    const queryCache = vi.fn(async () => ({ rows: [] as unknown[], total: 0 }));

    await loadEntityPickerPage({ queryCache }, "carrier", "   ");

    expect(queryCache).toHaveBeenCalledWith({
      entityType: "carrier",
      search: "",
      activeOnly: false,
      limit: ENTITY_PICKER_PREVIEW_LIMIT
    });
  });

  it("le os inativos por padrao, para a lista bater com a tela de cadastro", async () => {
    const queryCache = vi.fn(async () => ({ rows: [] as unknown[], total: 0 }));

    await loadEntityPickerPage({ queryCache }, "customer", "alfa");

    expect(queryCache).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "customer", activeOnly: false })
    );
  });
});
