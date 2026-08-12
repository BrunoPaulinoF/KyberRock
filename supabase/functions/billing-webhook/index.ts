// Notificacoes de pagamento do Mercado Pago.
//
// E o caminho RAPIDO da baixa: o boleto compensa, o Mercado Pago avisa aqui e a
// fatura e quitada em segundos — junto com a liberacao do acesso de quem estava
// bloqueado por inadimplencia. A reconsulta do `billing-run` (2x por dia)
// continua existindo como rede de seguranca para notificacao perdida.
//
// Publica (`verify_jwt = false`): quem chama e o Mercado Pago, que nao tem JWT
// do Supabase. A seguranca nao esta em confiar no corpo da requisicao — o id
// recebido e usado para CONSULTAR a API do Mercado Pago com o nosso access
// token, e so a resposta dela decide se a fatura foi paga. Um POST forjado no
// maximo provoca uma consulta a mais. Quando o segredo de assinatura estiver
// configurado, a assinatura tambem e conferida antes disso.
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  applyPaymentStatus,
  loadBillingSettings,
  recordBillingEvent
} from "../_shared/billing-engine.ts";
import type { BillingInvoiceRow } from "../_shared/billing-engine.ts";
import { extractNotificationPaymentId, getPayment } from "../_shared/mercado-pago.ts";
import { hmacSha256Hex, safeEqual } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

/**
 * Assinatura do webhook do Mercado Pago: header `x-signature` com `ts=` e `v1=`,
 * validado sobre `id:{data.id};request-id:{x-request-id};ts:{ts};`. Retorna true
 * quando nao ha segredo configurado — a conferencia e opcional e a consulta a
 * API continua sendo a fonte da verdade.
 */
async function isSignatureValid(input: {
  secret: string;
  signatureHeader: string | null;
  requestId: string | null;
  paymentId: string;
}): Promise<boolean> {
  if (!input.secret) return true;
  if (!input.signatureHeader) return false;

  const parts = new Map<string, string>();
  for (const chunk of input.signatureHeader.split(",")) {
    const [key, value] = chunk.split("=");
    if (key && value) parts.set(key.trim(), value.trim());
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return false;

  const manifest = `id:${input.paymentId};request-id:${input.requestId ?? ""};ts:${ts};`;
  const expected = await hmacSha256Hex(input.secret, manifest);
  return safeEqual(v1, expected);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes." }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const paymentId = extractNotificationPaymentId({ url: req.url, body });

  // Notificacao que nao e de pagamento (merchant_order, teste do painel sem id):
  // 200 de propósito. Erro faria o Mercado Pago reenviar em loop para sempre.
  if (!paymentId) return jsonResponse({ ok: true, ignored: true });

  try {
    const settings = await loadBillingSettings(supabase);
    if (!settings.mercadoPagoAccessToken) {
      return jsonResponse({ ok: true, ignored: true, reason: "sem access token" });
    }

    const signatureOk = await isSignatureValid({
      secret: settings.mercadoPagoWebhookSecret,
      signatureHeader: req.headers.get("x-signature"),
      requestId: req.headers.get("x-request-id"),
      paymentId
    });
    if (!signatureOk) {
      await recordBillingEvent(supabase, {
        eventType: "webhook_rejected",
        message: `Assinatura invalida na notificacao do pagamento ${paymentId}.`
      });
      return jsonResponse({ error: "Assinatura invalida" }, 401);
    }

    // Fonte da verdade: o proprio Mercado Pago, nunca o corpo da notificacao.
    const payment = await getPayment({
      accessToken: settings.mercadoPagoAccessToken,
      paymentId
    });

    // `external_reference` e o id da fatura (gravado na emissao); o
    // `boleto_payment_id` cobre boleto emitido antes dessa amarracao existir.
    const externalReference = String(
      (payment.raw as { external_reference?: unknown }).external_reference ?? ""
    );
    const { data, error } = await supabase
      .from("billing_invoices")
      .select("*")
      .or(
        [externalReference ? `id.eq.${externalReference}` : "", `boleto_payment_id.eq.${paymentId}`]
          .filter(Boolean)
          .join(",")
      )
      .limit(1);
    if (error) throw error;
    const invoice = ((data ?? [])[0] ?? null) as unknown as BillingInvoiceRow | null;

    if (!invoice) {
      await recordBillingEvent(supabase, {
        eventType: "webhook_orphan",
        message: `Pagamento ${paymentId} sem fatura correspondente.`,
        payload: { status: payment.status, externalReference }
      });
      return jsonResponse({ ok: true, ignored: true, reason: "fatura nao encontrada" });
    }

    const result = await applyPaymentStatus(supabase, {
      settings,
      invoice,
      status: payment.status
    });

    return jsonResponse({
      ok: true,
      invoiceId: invoice.id,
      status: result.status,
      changed: result.changed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar notificacao.";
    console.error("billing-webhook:", message);
    // 500 aqui e proposital: o Mercado Pago reenvia, e uma falha transitoria de
    // rede nao pode custar a baixa do pagamento.
    return jsonResponse({ error: message }, 500);
  }
});
