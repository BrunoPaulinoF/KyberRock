import type { KyberRockDesktopApi } from "../preload/api-types";
import type { PaymentTermCacheEntry } from "../services/cache-store";
import { tryParsePaymentCondition } from "../services/payment-condition-parser";

/** Texto canonico da condicao (rules_json.raw) de um payment_term local. */
export function extractConditionRaw(rulesJson: string): string {
  try {
    const rules = JSON.parse(rulesJson || "{}") as { raw?: string };
    return typeof rules.raw === "string" ? rules.raw : "";
  } catch {
    return "";
  }
}

/**
 * Resolve a condicao digitada livre ("5", "7 14 21", "7/14/21") para um
 * payment_term local: reusa uma condicao existente com a mesma regra (raw
 * normalizado igual) ou cria uma nova na hora. O termo resultante segue no
 * fechamento e, sem codigo OMIE vinculado, a parcela e criada no cadastro do
 * OMIE pelo proprio envio do pedido/OS.
 */
export async function resolveConditionTermId(
  desktopApi: KyberRockDesktopApi,
  conditionText: string
): Promise<string> {
  const parsed = tryParsePaymentCondition(conditionText);
  if (!parsed) {
    throw new Error(
      'Condicao de pagamento invalida. Use formatos como "5", "7 14 21" ou "7/14/21".'
    );
  }

  const termResult = await desktopApi.queryCache({ entityType: "payment_term", limit: 200 });
  const existing = (termResult.rows as PaymentTermCacheEntry[]).find(
    (term) => extractConditionRaw(term.rulesJson) === parsed.raw
  );
  if (existing) return existing.id;

  const created = (await desktopApi.paymentTermsCreate({
    name: parsed.summary,
    condition: parsed.raw
  })) as { id: string };
  return created.id;
}
