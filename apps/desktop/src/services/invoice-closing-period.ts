import { INVOICE_CLOSING_CYCLE_LABEL } from "./invoice-closing-cycle.js";
import type { InvoiceClosingCycle } from "./invoice-closing-cycle.js";

/**
 * O PERIODO do fechamento, escolhido por quem fecha.
 *
 * A tela de Fechamento de faturas nasceu perguntando ao CADASTRO do cliente quando a
 * fatura dele fecha. Isso resolve a pedreira onde todo cliente tem periodicidade e credito
 * configurados — e deixa de fora, sem aviso util, o cliente que compra em carteira: ele nao
 * tem conta de credito, entao nao pertencia a ciclo nenhum e as cargas dele nao entravam em
 * fatura, mesmo tendo acabado de rodar a quinzena inteira.
 *
 * Aqui a pergunta e a que a atendente realmente faz: "qual quinzena eu estou fechando?".
 * Ela escolhe quinzena / mes / semana (ou um intervalo qualquer) e o fechamento e daquele
 * periodo, para todo cliente que teve carga nele — em carteira, a prazo ou a vista.
 *
 * Modulo puro de proposito (sem SQLite, sem Node): a tela monta os presets com ele e o
 * servico do fechamento usa o mesmo calculo para rotular a fatura. Duas contas de quinzena
 * em lugares diferentes acabariam discordando sobre o dia 16.
 */

export type InvoiceClosingPeriodKind = "biweekly" | "monthly" | "weekly" | "custom";

export const INVOICE_CLOSING_PERIOD_KINDS: readonly InvoiceClosingPeriodKind[] = [
  "biweekly",
  "monthly",
  "weekly",
  "custom"
];

export const INVOICE_CLOSING_PERIOD_KIND_LABEL: Record<InvoiceClosingPeriodKind, string> = {
  biweekly: "Quinzena",
  monthly: "Mes",
  weekly: "Semana",
  custom: "Personalizado"
};

/** Qual das duas quinzenas do mes: a do dia 1 ao 15, ou a do 16 ao ultimo dia. */
export type FortnightHalf = 1 | 2;

export interface InvoiceClosingPeriodSelection {
  kind: InvoiceClosingPeriodKind;
  /** Mes de referencia (`YYYY-MM`) da quinzena e do mes. */
  month: string;
  half: FortnightHalf;
  /** Dia dentro da semana escolhida (`YYYY-MM-DD`). */
  weekDay: string;
  /** Intervalo do modo personalizado (`YYYY-MM-DD`). */
  customStart: string;
  customEnd: string;
}

export interface InvoiceClosingPeriodRange {
  start: string;
  end: string;
  label: string;
  /**
   * O ciclo que este periodo representa, ou null no personalizado.
   *
   * E o que a fatura mostra na coluna "Ciclo": quem fecha a segunda quinzena de agosto
   * espera ler "Quinzenal" ali, e nao a periodicidade que por acaso esta no cadastro.
   */
  cycle: InvoiceClosingCycle | null;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];

/** `YYYY-MM-DD` de uma data LOCAL. Nunca via ISO/UTC: veja `parseLocalDate`. */
export function toIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM` do mes de uma data local. */
export function toIsoMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Data LOCAL a partir de `YYYY-MM-DD`.
 *
 * `new Date("2026-08-16")` e lida como meia-noite UTC e, no fuso do Brasil, volta como dia
 * 15 — jogando o primeiro dia da segunda quinzena para a primeira. O construtor por partes
 * nao tem essa armadilha.
 */
export function parseLocalDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function normalizeMonth(month: string, fallback: Date): { year: number; monthIndex0: number } {
  if (!MONTH_PATTERN.test(month)) {
    return { year: fallback.getFullYear(), monthIndex0: fallback.getMonth() };
  }
  const [year, monthNumber] = month.split("-").map((part) => Number(part));
  return { year, monthIndex0: monthNumber - 1 };
}

function monthLabel(year: number, monthIndex0: number): string {
  return `${MONTH_NAMES[monthIndex0]} de ${year}`;
}

/** Segunda-feira da semana de `date` — a semana comercial comeca na segunda. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0 = domingo. O domingo pertence a semana que comecou na segunda anterior.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

/** `DD/MM/YYYY` a partir de `YYYY-MM-DD`. */
export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/**
 * O intervalo do periodo escolhido.
 *
 * A quinzena e sempre 1-15 / 16-fim do mes: e o corte que o comercio usa e o mesmo que o
 * cadastro de credito ja traz por padrao (dias de fechamento 1 e 16). Intervalo invertido
 * no personalizado e trocado de lugar em vez de devolver periodo impossivel, que voltaria
 * vazio sem explicar o porque.
 */
export function resolveInvoiceClosingPeriod(
  selection: InvoiceClosingPeriodSelection,
  now: Date = new Date()
): InvoiceClosingPeriodRange {
  if (selection.kind === "custom") {
    const today = toIsoDay(now);
    const start = DATE_PATTERN.test(selection.customStart) ? selection.customStart : today;
    const end = DATE_PATTERN.test(selection.customEnd) ? selection.customEnd : today;
    const [from, to] = start <= end ? [start, end] : [end, start];
    return {
      start: from,
      end: to,
      label: `Periodo de ${formatDayLabel(from)} a ${formatDayLabel(to)}`,
      cycle: null
    };
  }

  if (selection.kind === "weekly") {
    const reference = DATE_PATTERN.test(selection.weekDay)
      ? parseLocalDate(selection.weekDay)
      : now;
    const start = startOfWeek(reference);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      start: toIsoDay(start),
      end: toIsoDay(end),
      label: `Semana de ${formatDayLabel(toIsoDay(start))} a ${formatDayLabel(toIsoDay(end))}`,
      cycle: "weekly"
    };
  }

  const { year, monthIndex0 } = normalizeMonth(selection.month, now);
  const lastDay = daysInMonth(year, monthIndex0);
  const monthPrefix = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;

  if (selection.kind === "monthly") {
    return {
      start: `${monthPrefix}-01`,
      end: `${monthPrefix}-${String(lastDay).padStart(2, "0")}`,
      label: `Mes de ${monthLabel(year, monthIndex0)}`,
      cycle: "monthly"
    };
  }

  const first = selection.half !== 2;
  return {
    start: first ? `${monthPrefix}-01` : `${monthPrefix}-16`,
    end: first ? `${monthPrefix}-15` : `${monthPrefix}-${String(lastDay).padStart(2, "0")}`,
    label: `${first ? "1a" : "2a"} quinzena de ${monthLabel(year, monthIndex0)}`,
    cycle: "biweekly"
  };
}

/** A selecao inicial das telas: a quinzena em que hoje esta. */
export function defaultInvoiceClosingPeriod(now: Date = new Date()): InvoiceClosingPeriodSelection {
  const today = toIsoDay(now);
  return {
    kind: "biweekly",
    month: toIsoMonth(now),
    half: now.getDate() <= 15 ? 1 : 2,
    weekDay: today,
    customStart: today,
    customEnd: today
  };
}

/** O rotulo do ciclo de um periodo — "Personalizado" quando o intervalo e livre. */
export function periodCycleLabel(range: InvoiceClosingPeriodRange): string {
  return range.cycle === null ? "Personalizado" : INVOICE_CLOSING_CYCLE_LABEL[range.cycle];
}
