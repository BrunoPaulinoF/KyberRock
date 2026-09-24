import type { DesktopDatabase } from "../database/sqlite.js";

import { parsePaymentCondition, PaymentConditionParseError } from "./payment-condition-parser.js";

/**
 * Trava de compatibilidade entre forma e condicao de pagamento.
 *
 * Regra definida na reuniao de 06/07/2026: "dinheiro nao pode [parcelar]".
 * Ou seja, a forma de pagamento dinheiro so aceita quitacao a vista - sem
 * prazo e sem parcelamento (ex.: 7/14/21/28). As demais formas nao sofrem
 * essa restricao aqui (credito do cliente usa a configuracao de fechamento,
 * tratada em outro fluxo).
 */

export interface PaymentMethodLike {
  /** Codigo da forma de pagamento (ex.: "cash", "pix", "boleto"). */
  code: string;
  isCustomerCredit: boolean;
}

export interface PaymentConditionLike {
  /** Texto cru da condicao no padrao OMIE (ex.: "7/14/21"). Vazio = a vista. */
  raw?: string;
  /** Quantidade de parcelas ja resolvida (usada no parcelamento manual). */
  installmentCount?: number;
}

export interface PaymentGuardResult {
  allowed: boolean;
  message?: string;
}

/** Formas de pagamento que exigem quitacao a vista (sem prazo/parcelas). */
export const CASH_ONLY_METHOD_CODES: ReadonlySet<string> = new Set(["cash"]);

const CASH_REQUIRES_A_VISTA_MESSAGE =
  "Dinheiro so aceita pagamento a vista. Remova o prazo/parcelamento ou troque a forma de pagamento.";

/**
 * Indica se a condicao representa quitacao a vista: no maximo uma parcela e
 * sem dias de prazo. Uma condicao vazia (sem prazo definido) e considerada a
 * vista. Um texto de condicao invalido nunca e tratado como a vista.
 */
export function isCashCondition(condition: PaymentConditionLike | null | undefined): boolean {
  if (!condition) return true;
  if (typeof condition.installmentCount === "number") {
    return condition.installmentCount <= 1;
  }
  const raw = (condition.raw ?? "").trim();
  if (!raw) return true;
  try {
    const parsed = parsePaymentCondition(raw);
    return parsed.installments.length <= 1 && parsed.installments.every((i) => i.dueDays === 0);
  } catch (err) {
    if (err instanceof PaymentConditionParseError) return false;
    throw err;
  }
}

/**
 * Valida a combinacao forma x condicao de pagamento. Retorna
 * `{ allowed: false, message }` quando a combinacao viola uma trava.
 */
export function validatePaymentMethodCondition(
  method: PaymentMethodLike | null | undefined,
  condition: PaymentConditionLike | null | undefined
): PaymentGuardResult {
  if (!method) return { allowed: true };
  if (CASH_ONLY_METHOD_CODES.has(method.code) && !isCashCondition(condition)) {
    return { allowed: false, message: CASH_REQUIRES_A_VISTA_MESSAGE };
  }
  return { allowed: true };
}

/**
 * A mesma trava, lida do SQLite: para quem nao passa pela tela de entrada do desktop (o pedido
 * de pesagem do site, executado pela balanca). Sem isso a regra so existia no renderer e o
 * site gravaria "dinheiro em 7/14/21", que o desktop recusa.
 */
export function assertPaymentMethodConditionAllowed(
  database: DesktopDatabase,
  paymentMethodId: string | null | undefined,
  paymentTermId: string | null | undefined
): void {
  if (!paymentMethodId) return;
  const method = database
    .prepare("SELECT code, is_customer_credit FROM payment_methods WHERE id = ?")
    .get(paymentMethodId) as { code: string | null; is_customer_credit: number } | undefined;
  if (!method) return;
  let raw = "";
  if (paymentTermId) {
    const term = database
      .prepare("SELECT rules_json FROM payment_terms WHERE id = ?")
      .get(paymentTermId) as { rules_json: string | null } | undefined;
    try {
      const rules = JSON.parse(term?.rules_json || "{}") as { raw?: unknown };
      raw = typeof rules.raw === "string" ? rules.raw : "";
    } catch {
      raw = "";
    }
  }
  const result = validatePaymentMethodCondition(
    { code: method.code ?? "", isCustomerCredit: method.is_customer_credit === 1 },
    { raw }
  );
  if (!result.allowed)
    throw new Error(result.message ?? "Forma e condicao de pagamento incompativeis.");
}
