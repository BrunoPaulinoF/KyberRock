import { readAllCacheRows } from "./cache-rows";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { PaymentTermCacheEntry } from "../services/cache-store";
import { tryParsePaymentCondition } from "../services/payment-condition-parser";

// As regras de comparacao moram em `services/`: a balanca executora tambem as usa ao resolver a
// condicao digitada num pedido do site (`runtime.ts`), e o processo principal nao importa tela.
import {
  conditionTermMatches,
  extractConditionDueDays,
  extractConditionRaw
} from "../services/payment-condition-match";

export { conditionTermMatches, extractConditionDueDays, extractConditionRaw };

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

  // A lista INTEIRA, e nao a primeira pagina: aqui o `.find()` decide entre reusar e CRIAR.
  // Com a leitura cortada em 200, uma condicao que existisse a partir da linha 201 nunca era
  // encontrada e o cadastro ganhava uma duplicata a cada fechamento que a usasse.
  const terms = await readAllCacheRows<PaymentTermCacheEntry>(desktopApi, "payment_term", {
    activeOnly: false
  });
  const existing = terms.find((term) => conditionTermMatches(term.rulesJson, parsed));
  if (existing) return existing.id;

  const created = (await desktopApi.paymentTermsCreate({
    name: parsed.summary,
    condition: parsed.raw
  })) as { id: string };
  return created.id;
}
