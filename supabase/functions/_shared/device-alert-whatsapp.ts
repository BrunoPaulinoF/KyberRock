// Envio do alerta de balanca pelo WhatsApp da Kybernan.
//
// A instancia e a GLOBAL do financeiro, nao a de cada pedreira: o aviso e do suporte da
// plataforma, e a instancia da pedreira (relatorios) pode estar desconectada justamente quando
// a balanca dela para. Endereco em `billing_settings.whatsapp_url` (ou `UAZAPI_WHATSAPP_URL`)
// e token no secret de nome fixo em `billing-secrets.ts`.

import { BILLING_SECRETS } from "./billing-secrets.ts";

export interface AlertWhatsappConfig {
  baseUrl: string;
  instanceToken: string;
}

/**
 * Endereco e token da instancia global. `settingsUrl` e o `billing_settings.whatsapp_url`, que
 * quem chama le com o proprio cliente. `null` quando falta algum dos dois: a passada guarda o
 * alerta e tenta na proxima.
 */
export function resolveAlertWhatsappConfig(
  settingsUrl: string | null | undefined
): AlertWhatsappConfig | null {
  const baseUrl = (
    String(settingsUrl ?? "").trim() || (Deno.env.get("UAZAPI_WHATSAPP_URL") ?? "").trim()
  ).replace(/\/+$/, "");
  const tokenVar =
    BILLING_SECRETS.find((secret) => secret.key === "whatsappInstanceToken")?.envVar ??
    "UAZAPI_INSTANCE_TOKEN";
  const instanceToken = (Deno.env.get(tokenVar) ?? "").trim();
  if (!baseUrl || !instanceToken) return null;
  return { baseUrl, instanceToken };
}

export async function sendAlertWhatsappText(
  config: AlertWhatsappConfig,
  input: { to: string; text: string; trackId: string }
): Promise<void> {
  const response = await fetch(`${config.baseUrl}/send/text`, {
    method: "POST",
    headers: { token: config.instanceToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      number: input.to,
      text: input.text,
      linkPreview: false,
      async: false,
      track_source: "kyberrock-device-alert",
      track_id: input.trackId
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`UAZAPI WhatsApp falhou (${response.status}): ${details.slice(0, 200)}`);
  }
}
