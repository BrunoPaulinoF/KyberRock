/**
 * Periodo de analise da tela de Insights — o mesmo que alimenta os KPIs, os graficos e o
 * relatorio exportado em PDF/Excel. Fica fora do componente para poder ser testado sem
 * montar a tela: a conversao de preset em datas e o que decide quais operacoes entram no
 * relatorio, e errar nela e entregar numero errado ao operador.
 */

export type InsightsPeriod = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";

export interface InsightsDateRange {
  start: string;
  end: string;
  label: string;
}

export const INSIGHTS_PERIOD_OPTIONS: Array<{ id: InsightsPeriod; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Mes atual" },
  { id: "lastMonth", label: "Mes anterior" },
  { id: "custom", label: "Personalizado" }
];

/** Rotulo do periodo personalizado. O PDF ja imprime as datas ao lado (ver reports.ts). */
export const CUSTOM_PERIOD_LABEL = "Periodo personalizado";

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY". Data em outro formato segue como veio. */
export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/**
 * Datas do periodo selecionado. No personalizado, os dois campos vem da tela e podem
 * chegar pela metade: campo vazio (o operador ainda esta escolhendo, ou limpou o input)
 * cai no dia de hoje, e datas invertidas sao trocadas de lugar — assim o relatorio nunca
 * e disparado com um intervalo impossivel, que voltaria vazio sem explicar o porque.
 */
export function resolveInsightsRange(
  period: InsightsPeriod,
  customStart: string,
  customEnd: string,
  now: Date
): InsightsDateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "custom") {
    const start = customStart || toIsoDate(today);
    const end = customEnd || toIsoDate(today);
    return start <= end
      ? { start, end, label: CUSTOM_PERIOD_LABEL }
      : { start: end, end: start, label: CUSTOM_PERIOD_LABEL };
  }
  if (period === "today") {
    return { start: toIsoDate(today), end: toIsoDate(today), label: "Hoje" };
  }
  if (period === "7d") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Ultimos 7 dias" };
  }
  if (period === "30d") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Ultimos 30 dias" };
  }
  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: toIsoDate(start), end: toIsoDate(today), label: "Mes atual" };
  }
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return {
    start: toIsoDate(lastMonthStart),
    end: toIsoDate(lastMonthEnd),
    label: "Mes anterior"
  };
}
