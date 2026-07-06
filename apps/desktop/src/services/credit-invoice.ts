/**
 * Calculo do fechamento e vencimento da fatura de credito do cliente (fiado).
 *
 * Modelo mensal simples ja presente no cadastro do cliente:
 *  - `closingDay`  = dia do mes em que a fatura fecha (reuniao 06/07: "dia de fechamento");
 *  - `boletoDays`  = dias apos o fechamento para o vencimento do boleto.
 *
 * Uma operacao entra na fatura que fecha no proximo `closingDay` (inclusive o
 * dia da operacao). Periodicidades semanal/quinzenal ainda nao sao suportadas
 * aqui e dependem da definicao das regras de negocio.
 */

export interface CreditInvoiceSchedule {
  /** Data de fechamento da fatura (YYYY-MM-DD). */
  closingDate: string;
  /** Data de vencimento do boleto (YYYY-MM-DD). */
  dueDate: string;
}

function daysInMonth(year: number, monthIndex0: number): number {
  // O dia 0 do mes seguinte e o ultimo dia do mes atual.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calcula a data de fechamento e a data de vencimento da fatura de credito para
 * uma operacao realizada em `operationDate`.
 *
 * @param closingDay  dia do mes (1-31) em que a fatura fecha.
 * @param boletoDays  dias apos o fechamento para o vencimento (>= 0).
 * @param operationDate  data da operacao (usa o calendario local do operador).
 */
export function computeCreditInvoiceSchedule(
  closingDay: number,
  boletoDays: number,
  operationDate: Date
): CreditInvoiceSchedule {
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
    throw new Error("Dia de fechamento invalido. Informe um dia entre 1 e 31.");
  }
  if (!Number.isInteger(boletoDays) || boletoDays < 0) {
    throw new Error("Dias para vencimento invalido. Informe zero ou mais dias.");
  }

  const year = operationDate.getFullYear();
  const month = operationDate.getMonth(); // 0-based
  const day = operationDate.getDate();

  // Dia de fechamento efetivo deste mes (respeitando meses mais curtos).
  const clampedThisMonth = Math.min(closingDay, daysInMonth(year, month));

  let closingYear = year;
  let closingMonth = month;
  // Se a operacao ja passou do fechamento deste mes, entra na fatura do proximo.
  if (day > clampedThisMonth) {
    closingMonth += 1;
    if (closingMonth > 11) {
      closingMonth = 0;
      closingYear += 1;
    }
  }

  const closingDayActual = Math.min(closingDay, daysInMonth(closingYear, closingMonth));
  const closing = new Date(Date.UTC(closingYear, closingMonth, closingDayActual));

  const due = new Date(closing.getTime());
  due.setUTCDate(due.getUTCDate() + boletoDays);

  return { closingDate: formatUtcDate(closing), dueDate: formatUtcDate(due) };
}
