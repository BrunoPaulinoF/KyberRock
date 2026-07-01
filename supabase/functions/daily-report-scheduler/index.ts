import { createClient } from "jsr:@supabase/supabase-js@2";

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

  const authHeader = req.headers.get("x-cron-secret") ?? "";
  const expected = Deno.env.get("CRON_SHARED_SECRET") ?? "";
  if (!expected) {
    return jsonResponse(
      { error: "CRON_SHARED_SECRET nao configurado. Defina nas variaveis de ambiente." },
      500
    );
  }
  if (authHeader !== expected) {
    return jsonResponse({ error: "Acesso negado." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes." }, 500);
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const companyId = url.searchParams.get("companyId");

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.functions.invoke("daily-report-email", {
    body: { date, companyId: companyId ?? undefined }
  });

  if (error) {
    return jsonResponse({ error: error.message, data }, 500);
  }

  return jsonResponse({ ok: true, date, companyId: companyId ?? null, data });
});
