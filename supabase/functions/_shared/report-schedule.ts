// Regras de agendamento e janelas de periodo do envio automatico de relatorios.
// Puro (sem dependencias Deno) para poder ser testado e compartilhado entre o
// daily-report-scheduler e o daily-report-email.

// Fuso operacional do negocio. O Brasil aboliu o horario de verao em 2019, entao
// America/Sao_Paulo e um deslocamento fixo de -03:00 — se o horario de verao
// voltar, este modulo precisa passar a usar Intl com timeZone.
export const REPORT_UTC_OFFSET = "-03:00";
const REPORT_UTC_OFFSET_HOURS = -3;

export interface LocalNow {
  date: string;
  hour: number;
}

// Data (YYYY-MM-DD) e hora locais de Sao Paulo para um instante UTC.
export function localNow(now: Date): LocalNow {
  const shifted = new Date(now.getTime() + REPORT_UTC_OFFSET_HOURS * 3_600_000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

export function parseScheduleHour(scheduleTime: string | null | undefined, fallback = 20): number {
  const hour = parseInt((scheduleTime ?? "").split(":")[0] ?? "", 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
}

function utcDateFrom(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = utcDateFrom(date);
  value.setUTCDate(value.getUTCDate() + days);
  return toDateString(value);
}

// Decide se um destinatario recebe o relatorio nesta hora local. `nowDate` e a
// data de referencia do envio (hoje em SP) e `nowHour` a hora local atual —
// comparadas com o schedule_time/schedule_frequency configurados no desktop.
export function shouldSendAt(input: {
  frequency: string;
  scheduleTime: string | null | undefined;
  nowDate: string;
  nowHour: number;
}): boolean {
  if (parseScheduleHour(input.scheduleTime) !== input.nowHour) return false;
  if (input.frequency === "daily") return true;
  const target = utcDateFrom(input.nowDate);
  // Padronizado: relatorio semanal sempre na sexta-feira (getUTCDay() === 5).
  if (input.frequency === "weekly") return target.getUTCDay() === 5;
  if (input.frequency === "monthly") return target.getUTCDate() === 1;
  return false;
}

export interface ReportPeriod {
  // Janela em dias locais: [start, endExclusive).
  start: string;
  endExclusive: string;
  // Mesma janela em instantes UTC, prontos para filtros de created_at.
  startUtc: string;
  endUtc: string;
  // "diario" | "semanal" | "mensal" — usado nos titulos.
  frequencyLabel: string;
  // "15/07/2026" | "07/07/2026 a 13/07/2026" | "junho/2026".
  label: string;
}

function localDayStartUtc(date: string): string {
  return new Date(`${date}T00:00:00${REPORT_UTC_OFFSET}`).toISOString();
}

function formatDateBr(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

const MONTH_NAMES_PT = [
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

function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${MONTH_NAMES_PT[(month ?? 1) - 1]}/${year}`;
}

// Janela de dados coberta pelo relatorio de acordo com a frequencia:
// - daily: o proprio dia de referencia;
// - weekly (enviado toda sexta-feira): os 7 dias anteriores, de sexta a quinta;
// - monthly (enviado no dia 1): o mes anterior completo.
export function reportPeriod(frequency: string, referenceDate: string): ReportPeriod {
  if (frequency === "weekly") {
    const start = addDays(referenceDate, -7);
    const lastDay = addDays(referenceDate, -1);
    return {
      start,
      endExclusive: referenceDate,
      startUtc: localDayStartUtc(start),
      endUtc: localDayStartUtc(referenceDate),
      frequencyLabel: "semanal",
      label: `${formatDateBr(start)} a ${formatDateBr(lastDay)}`
    };
  }
  if (frequency === "monthly") {
    const reference = utcDateFrom(referenceDate);
    const start = toDateString(
      new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - 1, 1))
    );
    const endExclusive = toDateString(
      new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1))
    );
    return {
      start,
      endExclusive,
      startUtc: localDayStartUtc(start),
      endUtc: localDayStartUtc(endExclusive),
      frequencyLabel: "mensal",
      label: monthLabel(start)
    };
  }
  const endExclusive = addDays(referenceDate, 1);
  return {
    start: referenceDate,
    endExclusive,
    startUtc: localDayStartUtc(referenceDate),
    endUtc: localDayStartUtc(endExclusive),
    frequencyLabel: "diario",
    label: formatDateBr(referenceDate)
  };
}
