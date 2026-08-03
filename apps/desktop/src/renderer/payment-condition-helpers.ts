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

export type PaymentConditionPreviewStatus = "empty" | "ok" | "invalid";

export interface PaymentConditionPreview {
  status: PaymentConditionPreviewStatus;
  /** Frase pronta para exibir abaixo do campo. */
  message: string;
}

/** Ate quantos prazos aparecem na previa antes de resumir com reticencias. */
const PREVIEW_MAX_DAYS = 6;

function formatDayLabel(days: number): string {
  return days === 0 ? "a vista" : String(days);
}

/** "7, 14 e 21" — com reticencias quando o parcelamento e longo ("12 parcelas"). */
function formatDayList(days: number[]): string {
  const labels =
    days.length > PREVIEW_MAX_DAYS
      ? [...days.slice(0, 3).map(formatDayLabel), "...", formatDayLabel(days[days.length - 1])]
      : days.map(formatDayLabel);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

/**
 * Traduz o texto digitado no campo de condicao para o parcelamento que ele gera,
 * em linguagem de operador ("1 parcela em 27 dias apos a venda"). E a previa
 * mostrada na legenda do campo, para o operador conferir antes de capturar o peso.
 */
export function describePaymentCondition(text: string): PaymentConditionPreview {
  const value = (text ?? "").trim();
  if (!value) {
    return { status: "empty", message: "Vazio = a vista (vencimento no dia da venda)." };
  }

  const parsed = tryParsePaymentCondition(value);
  if (!parsed) {
    return {
      status: "invalid",
      message: "Condicao nao reconhecida. Use um dos formatos abaixo."
    };
  }

  const days = parsed.installments.map((installment) => installment.dueDays);
  if (days.length === 1) {
    return {
      status: "ok",
      message:
        days[0] === 0
          ? "1 parcela a vista (vencimento no dia da venda)."
          : `1 parcela em ${days[0]} dias apos a venda.`
    };
  }
  return {
    status: "ok",
    message: `${days.length} parcelas: ${formatDayList(days)} dias apos a venda.`
  };
}

/**
 * Resolve a condicao digitada livre ("30", "7 14 21", "3 parcelas") para um
 * payment_term local: reusa uma condicao existente com a mesma regra (raw
 * normalizado e prazos iguais) ou cria uma nova na hora. O termo resultante segue no
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
      'Condicao de pagamento invalida. Use formatos como "30" (dias), "7 14 21", "3 parcelas" ' +
        'ou periodo ("s+20" semana, "d+20" dezena, "q+20" quinzena, "m+20" mes).'
    );
  }

  const termResult = await desktopApi.queryCache({ entityType: "payment_term", limit: 200 });
  const existing = (termResult.rows as PaymentTermCacheEntry[]).find((term) =>
    conditionTermMatches(term.rulesJson, parsed)
  );
  if (existing) return existing.id;

  const created = (await desktopApi.paymentTermsCreate({
    name: parsed.summary,
    condition: parsed.raw
  })) as { id: string };
  return created.id;
}
