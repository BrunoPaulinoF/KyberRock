import { describe, expect, it, vi } from "vitest";

import {
  CLOSED_PAGE_SIZE,
  loadClosedOperationsData,
  pendingOmieIdsOf,
  RECENT_ACTIVITY_LIMIT,
  RECENT_WINDOW_MS
} from "./closed-operations-data";
import type { OmieDeliveryState } from "./omie-delivery-notifications";

/**
 * O que estes testes travam e o CONTRATO da carga da aba Concluidas: quem pede o que, com
 * quais parametros. E aqui que a paginacao pode silenciosamente estragar a tela -- pedindo
 * pagina onde precisava do conjunto inteiro (a busca) ou esquecendo as pendentes (os
 * avisos de envio ao OMIE).
 */
describe("carga da aba Concluidas", () => {
  function fakeApi() {
    return {
      listClosedWeighingOperations: vi.fn().mockResolvedValue([]),
      countClosedWeighingOperations: vi.fn().mockResolvedValue(0),
      listClosedOperationProductDescriptions: vi.fn().mockResolvedValue([]),
      listClosedOperationsNeedingOmieAttention: vi.fn().mockResolvedValue([]),
      listClosedWeighingOperationsUpdatedSince: vi.fn().mockResolvedValue([]),
      listRecentClosedWeighingOperations: vi.fn().mockResolvedValue([])
    };
  }

  it("sem busca, a tabela pede so uma pagina", async () => {
    const api = fakeApi();
    await loadClosedOperationsData(api);

    expect(api.listClosedWeighingOperations).toHaveBeenCalledWith({
      limit: CLOSED_PAGE_SIZE,
      offset: 0
    });
  });

  it("COM busca, a tabela pede o conjunto inteiro", async () => {
    // A ordenacao por proximidade nao tem equivalente em SQL: paginar antes de pontuar
    // mudaria qual linha aparece primeiro. Sem limite, portanto.
    const api = fakeApi();
    await loadClosedOperationsData(api, { search: "levisa" });

    expect(api.listClosedWeighingOperations).toHaveBeenCalledWith({});
    const [[args]] = api.listClosedWeighingOperations.mock.calls;
    expect(args).not.toHaveProperty("limit");
  });

  it("busca so de espacos nao conta como busca", async () => {
    const api = fakeApi();
    await loadClosedOperationsData(api, { search: "   " });

    expect(api.listClosedWeighingOperations).toHaveBeenCalledWith({
      limit: CLOSED_PAGE_SIZE,
      offset: 0
    });
  });

  it("o filtro de produto vai para o SQL, na pagina e na contagem", async () => {
    const api = fakeApi();
    await loadClosedOperationsData(api, { productFilter: "Brita 1", pageSize: 50 });

    expect(api.listClosedWeighingOperations).toHaveBeenCalledWith({
      productDescription: "Brita 1",
      limit: 50,
      offset: 0
    });
    expect(api.countClosedWeighingOperations).toHaveBeenCalledWith({
      productDescription: "Brita 1"
    });
  });

  it('"all" nao vira filtro', async () => {
    const api = fakeApi();
    await loadClosedOperationsData(api, { productFilter: "all" });

    expect(api.countClosedWeighingOperations).toHaveBeenCalledWith({});
  });

  it("o seletor de produtos NAO e filtrado pelo produto escolhido", async () => {
    // Senao, escolher um produto esvaziaria o proprio seletor e o operador nao
    // conseguiria mais voltar para "todos".
    const api = fakeApi();
    await loadClosedOperationsData(api, { productFilter: "Brita 1" });

    expect(api.listClosedOperationProductDescriptions).toHaveBeenCalledWith();
  });

  it("o alerta fiscal nao e filtrado nem paginado", async () => {
    // O alerta e sobre a pedreira inteira: filtrar por produto ou por pagina esconderia
    // operacao com problema fiscal que o operador precisa ver.
    const api = fakeApi();
    await loadClosedOperationsData(api, { productFilter: "Brita 1", pageSize: 10 });

    expect(api.listClosedOperationsNeedingOmieAttention).toHaveBeenCalledWith();
  });

  it("o recorte recente leva a janela e as pendentes do ciclo anterior", async () => {
    const api = fakeApi();
    const now = new Date("2026-08-28T12:00:00.000Z");

    await loadClosedOperationsData(api, { pendingOmieIds: ["op-1", "op-2"], now });

    const [since, ids] = api.listClosedWeighingOperationsUpdatedSince.mock.calls[0];
    expect(since).toBe(new Date(now.getTime() - RECENT_WINDOW_MS).toISOString());
    expect(ids).toEqual(["op-1", "op-2"]);
  });

  it("sem pendentes, o recorte recente vai so com a janela", async () => {
    const api = fakeApi();
    await loadClosedOperationsData(api);

    const [, ids] = api.listClosedWeighingOperationsUpdatedSince.mock.calls[0];
    expect(ids).toEqual([]);
  });

  it("devolve cada recorte no seu campo", async () => {
    const api = fakeApi();
    api.listClosedWeighingOperations.mockResolvedValue([{ id: "pagina" }]);
    api.countClosedWeighingOperations.mockResolvedValue(42);
    api.listClosedOperationProductDescriptions.mockResolvedValue(["Brita 1"]);
    api.listClosedOperationsNeedingOmieAttention.mockResolvedValue([{ id: "alerta" }]);
    api.listClosedWeighingOperationsUpdatedSince.mockResolvedValue([{ id: "recente" }]);
    api.listRecentClosedWeighingOperations.mockResolvedValue([{ id: "ultima" }]);

    const data = await loadClosedOperationsData(api);

    expect(data.page).toEqual([{ id: "pagina" }]);
    expect(data.total).toBe(42);
    expect(data.products).toEqual(["Brita 1"]);
    expect(data.omieAttention).toEqual([{ id: "alerta" }]);
    expect(data.recent).toEqual([{ id: "recente" }, { id: "ultima" }]);
  });

  it("a uniao do recorte recente nao repete operacao", () => {
    // As duas consultas se sobrepoem por natureza: a operacao de hoje e tambem uma das
    // ultimas alteradas. Se a uniao duplicasse, o painel somaria peso e faturamento em
    // dobro nos numeros do dia.
    const api = fakeApi();
    const mesma = { id: "op-1", netWeightKg: 1000 };
    api.listClosedWeighingOperationsUpdatedSince.mockResolvedValue([mesma]);
    api.listRecentClosedWeighingOperations.mockResolvedValue([mesma, { id: "op-2" }]);

    return loadClosedOperationsData(api).then((data) => {
      expect(data.recent).toEqual([mesma, { id: "op-2" }]);
      expect(data.recent.filter((o) => o.id === "op-1")).toHaveLength(1);
    });
  });

  it("a atividade recente do painel tem consulta propria, com folga sobre o que mostra", () => {
    // Num dia parado a janela de 24 h devolve vazio; e esta consulta que mantem a
    // atividade recente do painel mostrando o que mostrava antes.
    const api = fakeApi();
    return loadClosedOperationsData(api).then(() => {
      expect(api.listRecentClosedWeighingOperations).toHaveBeenCalledWith(RECENT_ACTIVITY_LIMIT);
      expect(RECENT_ACTIVITY_LIMIT).toBeGreaterThanOrEqual(5);
    });
  });

  it("a janela cobre o dia inteiro em qualquer fuso", () => {
    expect(RECENT_WINDOW_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe("ids pendentes de envio ao OMIE", () => {
  it("devolve so os pendentes", () => {
    const states = new Map<string, OmieDeliveryState>([
      ["a", "pending"],
      ["b", "delivered"],
      ["c", "failed"],
      ["d", "pending"]
    ]);

    expect(pendingOmieIdsOf(states)).toEqual(["a", "d"]);
  });

  it("mapa vazio devolve lista vazia", () => {
    expect(pendingOmieIdsOf(new Map())).toEqual([]);
  });
});
