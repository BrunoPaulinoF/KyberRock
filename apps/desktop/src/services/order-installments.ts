import type { DesktopDatabase } from "../database/sqlite.js";
import { conditionDueDaysForSale } from "./payment-condition-parser.js";
import { operationSaleDay } from "./weighing-operation-status.js";

/**
 * Parcelas do pedido do OMIE de uma pesagem: QUANDO cada uma vence e QUANTO vale.
 *
 * A conta mora aqui, e nao dentro de `buildOmieBillingJob`, porque o cupom tambem imprime o
 * vencimento — e o vencimento do papel tem de ser o do titulo que o OMIE gera. O cupom usava
 * a data da IMPRESSAO: a carga de 20/10 em "1 parcela em 45 dias" saia com VENCTO 20/10 na
 * via original e 27/10 na reimpressao, enquanto o OMIE cobrava em 04/12. Uma segunda conta
 * so para o papel acabaria discordando do titulo de novo na proxima regra que mudasse.
 */

/** Numero de dias tratado como "1 mes" quando so ha a quantidade de parcelas. */
export const MONTHLY_INSTALLMENT_DAYS = 30;

/**
 * Emissao e prazos do pedido, exatamente como `buildOmieBillingJob` os manda ao `omie-sync`.
 */
export interface OrderPaymentSchedule {
  /**
   * Emissao do pedido (yyyy-mm-dd): o dia em que a pesagem FECHOU (`exit_weight_captured_at`)
   * no calendario de Sao Paulo (`operationSaleDay`), o mesmo de `operationSaleDaySql`. Nunca
   * o dia da impressao, e nunca o dia de UTC.
   */
  issueDate: string;
  paymentTermOmieCode: string | null;
  installmentCount: number | null;
  /** Dias de vencimento de cada parcela, contados da emissao; null = a vista. */
  installmentDays: number[] | null;
}

export interface OrderInstallment {
  /** Numero da parcela (1-based). */
  number: number;
  /** Vencimento em ISO (yyyy-mm-dd), dia do calendario, sem hora nem fuso. */
  dueDate: string;
  valueCents: number;
}

interface PaymentTermScheduleRow {
  code: string | null;
  installment_count: number | null;
  installment_days_json: string | null;
  first_installment_days: number | null;
  installment_interval_days: number | null;
  rules_json: string | null;
}

/**
 * Emissao e prazos do pedido da pesagem a partir da condicao de pagamento dela.
 *
 * Espelho OMIE (quando a condicao local esta vinculada a um codigo) tem precedencia; sem
 * vinculo, os campos da propria condicao local (parse do texto digitado) valem — e a edge
 * cria a parcela no cadastro do OMIE a partir deles.
 */
export function resolveOrderPaymentSchedule(
  database: DesktopDatabase,
  paymentTermId: string | null,
  exitCapturedAt: string | null
): OrderPaymentSchedule {
  const term = paymentTermId
    ? (database
        .prepare(
          `SELECT pt.omie_parcela_code AS code,
                  COALESCE(opt.installment_count, pt.installment_count) AS installment_count,
                  COALESCE(opt.installment_days_json, pt.installment_days_json) AS installment_days_json,
                  COALESCE(opt.first_installment_days, pt.first_installment_days) AS first_installment_days,
                  COALESCE(opt.installment_interval_days, pt.installment_interval_days) AS installment_interval_days,
                  -- Ultimo recurso quando as colunas acima estao vazias: a condicao que
                  -- chegou pela nuvem traz so o rules_json (ver upsertCloudPaymentTerms),
                  -- e sem os dias o pedido saia com vencimento = emissao.
                  pt.rules_json AS rules_json
           FROM payment_terms pt
           LEFT JOIN omie_payment_terms opt
             ON opt.company_id = pt.company_id AND opt.code = pt.omie_parcela_code AND opt.is_active = 1
           WHERE pt.id = ?`
        )
        .get(paymentTermId) as PaymentTermScheduleRow | undefined)
    : undefined;

  // Prazo de cada parcela, em dias contados da emissao (o OMIE soma ao `issueDate`). A
  // condicao em periodo ("q+15") depende do dia da venda e vence no fim do periodo mais os
  // dias — por isso ela manda sobre os dias gravados, que sao so o prazo nominal. O dia e o de
  // Sao Paulo: cortar o texto UTC mandava a pesagem das 22h como emissao do dia seguinte.
  const issueDate = operationSaleDay(exitCapturedAt);
  const installmentDays =
    conditionDueDaysForSale(conditionRawFromRulesJson(term?.rules_json), issueDate) ??
    resolveInstallmentDays(term);

  return {
    issueDate,
    paymentTermOmieCode: term?.code ?? null,
    installmentCount: term?.installment_count ?? installmentDays?.length ?? null,
    installmentDays
  };
}

/**
 * Parcelas do pedido na conta do `omie-sync` (`orderDueDays` + `buildInstallmentPlan`):
 * os dias da condicao somados a emissao; sem dias, a quantidade de parcelas em meses de 30
 * dias; sem nada disso, uma parcela a vista vencendo na propria emissao. O total e rateado
 * em percentual igual, com a ultima parcela absorvendo o arredondamento.
 */
export function orderInstallmentPlan(
  schedule: Pick<OrderPaymentSchedule, "issueDate" | "installmentCount" | "installmentDays">,
  totalCents: number
): OrderInstallment[] {
  const dueDays = orderDueDays(schedule);
  const amounts = splitInstallmentAmounts(totalCents, dueDays.length);
  return dueDays.map((days, index) => ({
    number: index + 1,
    dueDate: addDaysToIsoDate(schedule.issueDate, days),
    valueCents: amounts[index]
  }));
}

function orderDueDays(
  schedule: Pick<OrderPaymentSchedule, "installmentCount" | "installmentDays">
): number[] {
  const days = (schedule.installmentDays ?? []).filter(
    (value) => Number.isFinite(value) && value >= 0
  );
  if (days.length > 0) return days;
  const count =
    typeof schedule.installmentCount === "number" && schedule.installmentCount > 0
      ? Math.floor(schedule.installmentCount)
      : 1;
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => MONTHLY_INSTALLMENT_DAYS * (index + 1));
}

/**
 * Rateio do total pelas parcelas na mesma regra do pedido OMIE (percentual igual, com a
 * ultima parcela absorvendo o arredondamento para a soma bater exatamente o total).
 */
export function splitInstallmentAmounts(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [totalCents];
  const basePercent = Math.floor(10000 / count) / 100;
  const amounts: number[] = [];
  let allocated = 0;
  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      amounts.push(totalCents - allocated);
      continue;
    }
    const value = Math.round((totalCents * basePercent) / 100);
    amounts.push(value);
    allocated += value;
  }
  return amounts;
}

/** "2026-07-15" + 30 -> "2026-08-14". Devolve a entrada crua se a data for invalida. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const base = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Prazos gravados no `rules_json` da condicao ("installments[].dueDays").
 *
 * A condicao que chega pela nuvem traz SO o rules_json — as colunas
 * installment_days_json/first_installment_days/installment_count ficam vazias no desktop
 * que a recebeu (ver upsertCloudPaymentTerms). Sem esta leitura, o pedido saia sem
 * prazo nenhum e o OMIE colocava o vencimento na propria data de emissao.
 */
function dueDaysFromRulesJson(rulesJson: string | null | undefined): number[] | null {
  if (!rulesJson) return null;
  try {
    const rules = JSON.parse(rulesJson) as { installments?: Array<{ dueDays?: unknown }> };
    if (!Array.isArray(rules.installments) || rules.installments.length === 0) return null;
    const days = rules.installments.map((installment) => Number(installment?.dueDays));
    return days.every((value) => Number.isInteger(value) && value >= 0) ? days : null;
  } catch {
    return null;
  }
}

/** Texto da condicao (`rules_json.raw`), ou null quando o JSON nao o traz. */
function conditionRawFromRulesJson(rulesJson: string | null | undefined): string | null {
  if (!rulesJson) return null;
  try {
    const rules = JSON.parse(rulesJson) as { raw?: unknown };
    return typeof rules.raw === "string" ? rules.raw : null;
  } catch {
    return null;
  }
}

/**
 * Dias de vencimento das parcelas da condicao OMIE vinculada: usa o JSON explicito
 * (ex: [7,14,21]) quando presente, senao deriva de primeiro dia + intervalo + quantidade.
 * Retorna null quando a condicao nao informa dias (edge trata como a vista).
 */
function resolveInstallmentDays(term: PaymentTermScheduleRow | undefined): number[] | null {
  if (!term) return null;

  if (term.installment_days_json) {
    try {
      const parsed = JSON.parse(term.installment_days_json) as unknown;
      if (Array.isArray(parsed)) {
        const days = parsed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0);
        if (days.length > 0) return days;
      }
    } catch {
      // JSON invalido no espelho OMIE: cai na derivacao abaixo.
    }
  }

  const count = term.installment_count;
  const first = term.first_installment_days;
  if (count && count >= 1 && first !== null && first >= 0) {
    const interval = term.installment_interval_days ?? 0;
    return Array.from({ length: count }, (_, index) => first + index * interval);
  }

  return dueDaysFromRulesJson(term.rules_json);
}
