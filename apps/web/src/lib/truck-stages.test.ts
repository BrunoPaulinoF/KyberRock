import { describe, expect, it } from "vitest";

import {
  ENTRY_WINDOW_MINUTES,
  averageDurations,
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
    exitAt: null,
    ...overrides
  };
}

describe("stageOf", () => {
  it("segue a pesagem da balanca: recem-chegou, em aberto, concluida", () => {
    expect(ENTRY_WINDOW_MINUTES).toBe(10);
    expect(stageOf(truck(), T0 + 3 * MIN)).toBe("entrada");
    expect(stageOf(truck(), T0 + 10 * MIN)).toBe("carregando");
    expect(stageOf(truck(), T0 + 90 * MIN)).toBe("carregando");
    expect(stageOf(truck({ exitAt: at(40) }), T0 + 41 * MIN)).toBe("saida");
  });
});

describe("stageDurations", () => {
  it("operacao concluida: janela de entrada, o resto aguardando, e o total", () => {
    expect(stageDurations(truck({ exitAt: at(42) }), T0 + 999 * MIN)).toEqual({
      entrada: 10 * MIN,
      carregando: 32 * MIN,
      total: 42 * MIN
    });
  });

  it("saiu dentro da janela: nao passou pelo carregando", () => {
    expect(stageDurations(truck({ exitAt: at(6) }), T0)).toEqual({
      entrada: 6 * MIN,
      carregando: null,
      total: 6 * MIN
    });
  });

  it("quem ainda esta na pedreira conta ate agora", () => {
    const now = T0 + 25 * MIN;
    expect(stageDurations(truck(), now).carregando).toBe(15 * MIN);
    expect(timeInCurrentStage(truck(), now)).toBe(15 * MIN);
    expect(timeInCurrentStage(truck(), T0 + 4 * MIN)).toBe(4 * MIN);
    expect(timeInCurrentStage(truck({ exitAt: at(30) }), now)).toBe(30 * MIN);
  });

  it("saida antes da entrada (relogio de outra maquina) nao da tempo negativo", () => {
    expect(stageDurations(truck({ exitAt: at(-5) }), T0).total).toBe(0);
  });
});

describe("groupByStage", () => {
  it("separa por etapa: mais tempo primeiro, e a ultima saida primeiro", () => {
    const now = T0 + 60 * MIN;
    const groups = groupByStage(
      [
        truck({ operationId: "chegou", entryAt: at(55) }),
        truck({ operationId: "patio-novo", entryAt: at(40) }),
        truck({ operationId: "patio-antigo", entryAt: at(5) }),
        truck({ operationId: "saiu-cedo", entryAt: at(0), exitAt: at(20) }),
        truck({ operationId: "saiu-agora", entryAt: at(10), exitAt: at(58) })
      ],
      now
    );
    expect(groups.entrada.map((row) => row.operationId)).toEqual(["chegou"]);
    expect(groups.carregando.map((row) => row.operationId)).toEqual(["patio-antigo", "patio-novo"]);
    expect(groups.saida.map((row) => row.operationId)).toEqual(["saiu-agora", "saiu-cedo"]);
  });
});

describe("averageDurations", () => {
  it("espera media so de quem passou da janela; total de todos", () => {
    const averages = averageDurations(
      [truck({ exitAt: at(40) }), truck({ exitAt: at(20) }), truck({ exitAt: at(6) })],
      T0
    );
    expect(averages.carregando).toBe(20 * MIN);
    expect(averages.total).toBe(22 * MIN);
  });

  it("sem ninguem, sem media", () => {
    expect(averageDurations([], T0)).toEqual({ carregando: null, total: null });
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

describe("canceladas", () => {
  it("cancelada vai para a coluna propria, a ultima cancelada primeiro", () => {
    const now = T0 + 60 * MIN;
    const groups = groupByStage(
      [
        truck({ operationId: "cedo", cancelledAt: at(15), cancelReason: "Desistiu" }),
        truck({ operationId: "agora", entryAt: at(40), cancelledAt: at(55) }),
        truck({ operationId: "patio", entryAt: at(20) })
      ],
      now
    );
    expect(groups.cancelada.map((row) => row.operationId)).toEqual(["agora", "cedo"]);
    expect(groups.carregando.map((row) => row.operationId)).toEqual(["patio"]);
    expect(stageOf(truck({ cancelledAt: at(3) }), T0 + 5 * MIN)).toBe("cancelada");
  });

  it("o tempo da cancelada para no cancelamento", () => {
    const cancelled = truck({ cancelledAt: at(25) });
    expect(stageDurations(cancelled, T0 + 999 * MIN).total).toBe(25 * MIN);
    expect(timeInCurrentStage(cancelled, T0 + 999 * MIN)).toBe(25 * MIN);
  });
});
