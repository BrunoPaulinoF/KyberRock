// Regras do horario proprio do relatorio financeiro do OMIE, separadas do
// componente para poderem ser testadas direto.
//
// O financeiro do OMIE e montado e enviado pela nuvem (edge function
// financial-report-email), enquanto os relatorios do KyberRock saem do proprio
// computador no horario do card "Envios automaticos". Sao dois envios distintos,
// entao o financeiro tem sempre a sua propria hora — nunca herda a do KyberRock.
// O agendador da nuvem roda de hora em hora e le so a hora, por isso a escolha e
// sempre hora cheia: minutos seriam ignorados no envio.

export const FINANCIAL_HOURS = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`
);

const FALLBACK_FINANCIAL_TIME = "19:00";

/**
 * Hora sugerida ao ligar o financeiro para um destinatario: a hora seguinte a
 * dos relatorios do KyberRock, para os dois envios ja nascerem separados.
 */
export function defaultFinancialTime(kyberRockHour: number): string {
  if (!Number.isInteger(kyberRockHour) || kyberRockHour < 0 || kyberRockHour > 23) {
    return FALLBACK_FINANCIAL_TIME;
  }
  return FINANCIAL_HOURS[(kyberRockHour + 1) % 24] ?? FALLBACK_FINANCIAL_TIME;
}

/** Rotulo da hora dos relatorios do KyberRock ("18:00"), para exibicao. */
export function kyberRockHourLabel(kyberRockHour: number): string {
  return FINANCIAL_HOURS[kyberRockHour] ?? `${String(kyberRockHour).padStart(2, "0")}:00`;
}

/** O destinatario recebe o financeiro na mesma hora dos relatorios do KyberRock. */
export function isSameHourAsKyberRock(
  financialScheduleTime: string | null,
  kyberRockHour: number
): boolean {
  if (!financialScheduleTime) return false;
  return parseInt(financialScheduleTime.slice(0, 2), 10) === kyberRockHour;
}
