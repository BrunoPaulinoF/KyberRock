import { describe, expect, it } from "vitest";

import {
  CUSTOM_PERIOD_LABEL,
  INSIGHTS_PERIOD_OPTIONS,
  formatDayLabel,
  resolveInsightsRange,
  toIsoDate
} from "./insights-period";

// Quarta-feira, 12/03/2025 (meio do mes, para "mes atual" e "mes anterior" ficarem obvios).
const NOW = new Date(2025, 2, 12, 15, 30);

describe("resolveInsightsRange nos periodos prontos", () => {
  it("hoje comeca e termina no mesmo dia", () => {
    expect(resolveInsightsRange("today", "", "", NOW)).toEqual({
      start: "2025-03-12",
      end: "2025-03-12",
      label: "Hoje"
    });
  });

  it("7 e 30 dias incluem o dia de hoje na contagem", () => {
    expect(resolveInsightsRange("7d", "", "", NOW)).toMatchObject({
      start: "2025-03-06",
      end: "2025-03-12"
    });
    expect(resolveInsightsRange("30d", "", "", NOW)).toMatchObject({
      start: "2025-02-11",
      end: "2025-03-12"
    });
  });

  it("mes atual vai do dia 1 ate hoje e mes anterior cobre o mes inteiro", () => {
    expect(resolveInsightsRange("month", "", "", NOW)).toMatchObject({
      start: "2025-03-01",
      end: "2025-03-12"
    });
    expect(resolveInsightsRange("lastMonth", "", "", NOW)).toMatchObject({
      start: "2025-02-01",
      end: "2025-02-28"
    });
  });
});

describe("resolveInsightsRange no periodo personalizado", () => {
  it("usa exatamente as datas escolhidas pelo operador", () => {
    expect(resolveInsightsRange("custom", "2025-01-05", "2025-02-20", NOW)).toEqual({
      start: "2025-01-05",
      end: "2025-02-20",
      label: CUSTOM_PERIOD_LABEL
    });
  });

  it("aceita um unico dia", () => {
    expect(resolveInsightsRange("custom", "2025-01-05", "2025-01-05", NOW)).toMatchObject({
      start: "2025-01-05",
      end: "2025-01-05"
    });
  });

  // Datas invertidas viram um periodo valido em vez de um relatorio vazio sem explicacao.
  it("troca as datas de lugar quando a inicial e maior que a final", () => {
    expect(resolveInsightsRange("custom", "2025-02-20", "2025-01-05", NOW)).toMatchObject({
      start: "2025-01-05",
      end: "2025-02-20"
    });
  });

  // O input de data fica vazio enquanto o operador escolhe (ou quando ele limpa o campo):
  // cair em hoje mantem o relatorio consultavel em vez de disparar uma busca sem inicio.
  it("cai no dia de hoje quando um dos campos esta vazio", () => {
    expect(resolveInsightsRange("custom", "", "2025-04-01", NOW)).toMatchObject({
      start: "2025-03-12",
      end: "2025-04-01"
    });
    expect(resolveInsightsRange("custom", "2025-01-05", "", NOW)).toMatchObject({
      start: "2025-01-05",
      end: "2025-03-12"
    });
    expect(resolveInsightsRange("custom", "", "", NOW)).toMatchObject({
      start: "2025-03-12",
      end: "2025-03-12"
    });
  });

  // O PDF imprime "<label> · <inicio> a <fim>": um rotulo com as datas as repetiria.
  it("rotula o periodo pelo nome, deixando as datas para quem renderiza", () => {
    expect(resolveInsightsRange("custom", "2025-01-05", "2025-02-20", NOW).label).toBe(
      CUSTOM_PERIOD_LABEL
    );
  });
});

describe("formatacao das datas do periodo", () => {
  it("converte a data do banco para o formato lido na tela", () => {
    expect(formatDayLabel("2025-03-12")).toBe("12/03/2025");
  });

  it("devolve como veio o que nao e uma data ISO", () => {
    expect(formatDayLabel("hoje")).toBe("hoje");
  });

  it("usa o dia local, sem deslocar por fuso", () => {
    // new Date(...).toISOString() daria 11/03 em fusos a oeste de Greenwich.
    expect(toIsoDate(new Date(2025, 2, 12, 21, 0))).toBe("2025-03-12");
  });
});

describe("opcoes de periodo oferecidas na tela", () => {
  it("oferece o periodo personalizado depois dos periodos prontos", () => {
    expect(INSIGHTS_PERIOD_OPTIONS.map((option) => option.id)).toEqual([
      "today",
      "7d",
      "30d",
      "month",
      "lastMonth",
      "custom"
    ]);
    expect(INSIGHTS_PERIOD_OPTIONS.at(-1)).toEqual({ id: "custom", label: "Personalizado" });
  });
});
