import { describe, expect, it } from "vitest";

import {
  averageStageDurations,
  formatDuration,
  groupByStage,
  stageDurations,
  stageOf,
  timeInCurrentStage,
  type StageTruck
} from "./truck-stages";

const MIN = 60_000;
const T0 = Date.parse("2026-09-28T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();

function truck(overrides: Partial<StageTruck> = {}): StageTruck {
  return {
    operationId: "op-1",
    plate: "ABC1D23",
    customerName: "Cliente",
    productDescription: "Brita 1",
    driverName: "Joao",
    entryAt: at(0),
    loadStartedAt: null,
    loadedAt: null,
    exitAt: null,
    ...overrides
  };
}

describe("stageOf", () => {
  it("segue ENTRADA -> CARREGANDO -> SAIDA pelos carimbos do carregador", () => {
    expect(stageOf(truck())).toBe("entrada");
    expect(stageOf(truck({ loadStartedAt: at(5) }))).toBe("carregando");
    expect(stageOf(truck({ loadStartedAt: at(5), loadedAt: at(20) }))).toBe("saida");
    // "Concluir" sem "Iniciar": ja esta carregado.
    expect(stageOf(truck({ loadedAt: at(20) }))).toBe("saida");
  });
});

describe("stageDurations", () => {
  it("caminhao que ja saiu: cada etapa com o seu tempo", () => {
    const durations = stageDurations(
      truck({ loadStartedAt: at(10), loadedAt: at(35), exitAt: at(42) }),
      T0 + 999 * MIN
    );
    expect(durations).toEqual({
      entrada: 10 * MIN,
      carregando: 25 * MIN,
      saida: 7 * MIN,
      total: 42 * MIN
    });
  });

  it("sem carimbo do carregador, o tempo todo fica na entrada", () => {
    const durations = stageDurations(truck({ exitAt: at(30) }), T0 + 999 * MIN);
    expect(durations).toEqual({
      entrada: 30 * MIN,
      carregando: null,
      saida: null,
      total: 30 * MIN
    });
  });

  it("'Concluir' sem 'Iniciar': o carregamento fica na entrada", () => {
    const durations = stageDurations(truck({ loadedAt: at(20), exitAt: at(26) }), T0);
    expect(durations.entrada).toBe(20 * MIN);
    expect(durations.carregando).toBeNull();
    expect(durations.saida).toBe(6 * MIN);
  });

  it("quem ainda esta na pedreira conta ate agora", () => {
    const now = T0 + 18 * MIN;
    const current = truck({ loadStartedAt: at(4) });
    expect(stageDurations(current, now).carregando).toBe(14 * MIN);
    expect(timeInCurrentStage(current, now)).toBe(14 * MIN);
  });

  it("carimbo fora de ordem nao da tempo negativo", () => {
    const durations = stageDurations(
      truck({ loadStartedAt: at(-5), loadedAt: at(50), exitAt: at(40) }),
      T0
    );
    expect(durations.entrada).toBe(0);
    expect(durations.saida).toBe(0);
    expect(durations.total).toBe(40 * MIN);
  });
});

describe("groupByStage", () => {
  it("separa por etapa, quem esta ha mais tempo na etapa primeiro", () => {
    const now = T0 + 60 * MIN;
    const groups = groupByStage(
      [
        truck({ operationId: "novo", entryAt: at(50) }),
        truck({ operationId: "antigo", entryAt: at(10) }),
        truck({ operationId: "carregando", loadStartedAt: at(55) }),
        truck({ operationId: "pronto", loadedAt: at(58) })
      ],
      now
    );
    expect(groups.entrada.map((row) => row.operationId)).toEqual(["antigo", "novo"]);
    expect(groups.carregando.map((row) => row.operationId)).toEqual(["carregando"]);
    expect(groups.saida.map((row) => row.operationId)).toEqual(["pronto"]);
  });
});

describe("averageStageDurations", () => {
  it("media so entre quem tem o carimbo da etapa", () => {
    const averages = averageStageDurations(
      [
        truck({ loadStartedAt: at(10), loadedAt: at(30), exitAt: at(40) }),
        truck({ exitAt: at(20) })
      ],
      T0
    );
    expect(averages.entrada).toBe(15 * MIN);
    expect(averages.carregando).toBe(20 * MIN);
    expect(averages.saida).toBe(10 * MIN);
    expect(averages.total).toBe(30 * MIN);
  });

  it("sem ninguem, sem media", () => {
    expect(averageStageDurations([], T0).entrada).toBeNull();
  });
});

describe("formatDuration", () => {
  it("fala a lingua de quem esta na pedreira", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(30_000)).toBe("agora");
    expect(formatDuration(8 * MIN)).toBe("8 min");
    expect(formatDuration(65 * MIN)).toBe("1h 05min");
    expect(formatDuration(27 * 60 * MIN)).toBe("1d 3h");
  });
});
