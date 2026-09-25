/**
 * Quando uma condicao de pagamento digitada ("30", "7 14 21") ja existe no cadastro local.
 * Usado pela Nova entrada (`renderer/payment-condition-helpers.ts`) e pela balanca executora ao
 * resolver a condicao de um pedido do site (`runtime.ts`) — a mesma regra nos dois, para o
 * mesmo texto reusar a mesma condicao em vez de criar duplicata.
 */

/** Texto canonico da condicao (rules_json.raw) de um payment_term local. */
export function extractConditionRaw(rulesJson: string): string {
  try {
    const rules = JSON.parse(rulesJson || "{}") as { raw?: string };
    return typeof rules.raw === "string" ? rules.raw : "";
  } catch {
    return "";
  }
}

/** Prazos (em dias) gravados em rules_json de um payment_term local. */
export function extractConditionDueDays(rulesJson: string): number[] | null {
  try {
    const rules = JSON.parse(rulesJson || "{}") as {
      installments?: Array<{ dueDays?: unknown }>;
    };
    if (!Array.isArray(rules.installments)) return null;
    const days = rules.installments.map((installment) => Number(installment?.dueDays));
    return days.every((value) => Number.isFinite(value)) ? days : null;
  } catch {
    return null;
  }
}

/**
 * Indica se um payment_term ja gravado representa exatamente a condicao recem
 * interpretada. Comparar so o texto cru nao basta: o significado de um numero
 * isolado mudou ("5" era 5 parcelas mensais e hoje e uma parcela em 5 dias), entao
 * um termo antigo com o mesmo raw seria reusado aplicando a regra errada.
 */
export function conditionTermMatches(
  rulesJson: string,
  parsed: { raw: string; installments: Array<{ dueDays: number }> }
): boolean {
  if (extractConditionRaw(rulesJson) !== parsed.raw) return false;
  const storedDays = extractConditionDueDays(rulesJson);
  if (storedDays === null) return false;
  const parsedDays = parsed.installments.map((installment) => installment.dueDays);
  return (
    storedDays.length === parsedDays.length &&
    storedDays.every((value, index) => value === parsedDays[index])
  );
}
