/**
 * A `web-api`: TODA escrita do site passa por aqui (contrato em docs/web-api.md do
 * repositorio principal). O supabase-js manda o token da sessao sozinho.
 *
 * Resposta de sucesso: `{ ok: true, ...resultado, warnings: string[] }`. Erro: `{ error }`
 * com o status HTTP — a mensagem ja vem pronta para mostrar ao usuario.
 */

import { supabase } from "./supabase";

export type WebApiAction =
  | "me"
  | "upsert_customer"
  | "set_customer_active"
  | "set_customer_commercial"
  | "upsert_carrier"
  | "set_carrier_active"
  | "upsert_driver"
  | "set_driver_active"
  | "upsert_vehicle"
  | "set_vehicle_active"
  | "set_customer_vehicle"
  | "set_customer_carrier"
  | "set_driver_carrier"
  | "set_vehicle_carrier"
  | "set_product_default_price"
  | "set_customer_special_price"
  | "remove_customer_special_price"
  | "upsert_price_table"
  | "set_price_table_active"
  | "set_price_table_item"
  | "remove_price_table_item"
  | "set_customer_price_table"
  | "settle_wallet"
  | "reopen_wallet"
  | "request_invoice_closing"
  | "operation_status"
  | "request_operation"
  | "list_report_recipients"
  | "save_report_recipient"
  | "delete_report_recipient";

export class WebApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface WebApiResult {
  ok: true;
  warnings: string[];
  [key: string]: unknown;
}

export async function callWebApi(
  action: WebApiAction,
  payload: Record<string, unknown> = {}
): Promise<WebApiResult> {
  const { data, error } = await supabase.functions.invoke<WebApiResult | { error: string }>(
    "web-api",
    { body: { action, payload } }
  );

  if (error) {
    // O supabase-js embrulha o 4xx/5xx: a mensagem da web-api esta no corpo da resposta.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      const body = (await context
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      throw new WebApiError(context.status, body?.error ?? error.message);
    }
    throw new WebApiError(0, error.message);
  }
  if (!data || (data as { error?: string }).error) {
    throw new WebApiError(400, (data as { error?: string })?.error ?? "Resposta vazia da web-api.");
  }
  return data as WebApiResult;
}

/** Sessao 401 = mandar para o login; o resto e mensagem para a tela. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof WebApiError && error.status === 401;
}

export function errorMessage(error: unknown, fallback = "Algo deu errado. Tente de novo."): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
