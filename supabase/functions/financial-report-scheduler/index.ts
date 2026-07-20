import { createClient } from "jsr:@supabase/supabase-js@2";
import { localNow } from "../_shared/report-schedule.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
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

  // Mesmo segredo de cron do daily-report-scheduler (Vault 'cron_shared_secret',
  // migracao 202607150002), validado contra o env e, na ausencia dele, contra o
  // Vault — nenhum env manual e necessario para o job pg_cron funcionar.
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

  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    companyId?: string;
    force?: boolean;
  };
  const date = body.date ?? url.searchParams.get("date") ?? localNow(new Date()).date;
  const companyId = body.companyId ?? url.searchParams.get("companyId") ?? undefined;
  const force = body.force === true || url.searchParams.get("force") === "true";

  const { data, error } = await supabase.functions.invoke("financial-report-email", {
    body: { date, companyId, force },
    headers: { "x-cron-secret": providedSecret }
  });

  if (error) {
    return jsonResponse({ error: error.message, data }, 500);
  }

  return jsonResponse({ ok: true, date, companyId: companyId ?? null, data });
});
