// Passada automatica do motor de cobranca.
//
// Quem chama e o pg_cron (migracao 202608120002, 2x por dia), com o segredo
// compartilhado no header `x-cron-secret` — o mesmo mecanismo do
// `daily-report-scheduler`. O painel administrativo tem o botao "rodar agora",
// que passa por `admin-billing` e chama `runBillingCycle` direto; esta funcao
// existe para o agendamento.
//
// A passada e idempotente (ver `runBillingCycle`): repetir no mesmo dia nao
// gera fatura duplicada, nao reemite boleto e nao reenvia WhatsApp.
import { createClient } from "jsr:@supabase/supabase-js@2";

import { runBillingCycle } from "../_shared/billing-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
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

  // Mesma validacao do daily-report-scheduler: env primeiro, Vault depois. O
  // job do pg_cron manda o segredo do Vault, entao nenhuma configuracao manual
  // de Edge Function e necessaria.
  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  const envSecret = Deno.env.get("CRON_SHARED_SECRET") ?? "";
  let authorized = Boolean(envSecret) && providedSecret === envSecret;
  let vaultSecretAvailable = false;
  if (!authorized && providedSecret) {
    const { data } = await supabase.rpc("get_cron_secret");
    vaultSecretAvailable = typeof data === "string" && data.length > 0;
    authorized = vaultSecretAvailable && providedSecret === data;
  }
  if (!authorized) {
    if (!envSecret && !vaultSecretAvailable && providedSecret) {
      return jsonResponse(
        {
          error:
            "Segredo do cron nao configurado. Aplique a migracao do Vault ou defina CRON_SHARED_SECRET."
        },
        500
      );
    }
    return jsonResponse({ error: "Acesso negado." }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as {
    companyId?: string;
    today?: string;
    force?: boolean;
  };

  try {
    const summary = await runBillingCycle(supabase, {
      companyId: body.companyId ?? null,
      today: body.today,
      force: body.force === true
    });
    return jsonResponse({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na passada de cobranca.";
    console.error("billing-run:", message);
    return jsonResponse({ error: message }, 500);
  }
});
