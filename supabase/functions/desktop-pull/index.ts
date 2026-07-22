import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

type PullBody = {
  deviceId?: string;
  deviceToken?: string;
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: PullBody;
    try {
      body = (await req.json()) as PullBody;
    } catch {
      return jsonResponse({ error: "Corpo da requisicao invalido" }, 400);
    }

    const deviceId = String(body.deviceId ?? "");
    const deviceToken = String(body.deviceToken ?? "");
    if (!deviceId || !deviceToken) {
      return jsonResponse({ error: "deviceId e deviceToken sao obrigatorios" }, 400);
    }

    const { data: device, error: deviceError } = await supabase
      .from("device_registrations")
      .select("id, company_id, unit_id, token_hash, is_active")
      .eq("id", deviceId)
      .single();
    if (deviceError || !device?.is_active) {
      return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
    }

    const tokenHash = await sha256Hex(deviceToken);
    if (!safeEqual(tokenHash, device.token_hash)) {
      return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
    }

    const companyId = device.company_id;
    const unitId = device.unit_id;

    const [
      { data: customers, error: custErr },
      { data: products, error: prodErr },
      { data: operations, error: opsErr },
      { data: loadingRequests, error: lrErr },
      { data: printReceipts, error: prErr },
      { data: devices, error: devErr }
    ] = await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true),
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true),
      supabase
        .from("weighing_operations")
        .select("*")
        .eq("company_id", companyId)
        .eq("unit_id", unitId)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("loading_requests")
        .select("*")
        .eq("company_id", companyId)
        .eq("unit_id", unitId)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("print_receipts")
        .select("*")
        .eq("unit_id", unitId)
        .order("printed_at", { ascending: false })
        .limit(1000),
      // Dispositivos da unidade: nome + cor para a legenda multi-desktop e para
      // satisfazer a FK local device_id das operacoes criadas em outras maquinas.
      supabase
        .from("device_registrations")
        .select("id, company_id, unit_id, name, color, installation_id, is_active, created_at, updated_at")
        .eq("unit_id", unitId)
    ]);

    const errors: string[] = [];
    if (custErr) errors.push(`customers: ${custErr.message}`);
    if (prodErr) errors.push(`products: ${prodErr.message}`);
    if (opsErr) errors.push(`weighing_operations: ${opsErr.message}`);
    if (lrErr) errors.push(`loading_requests: ${lrErr.message}`);
    if (prErr) errors.push(`print_receipts: ${prErr.message}`);
    if (devErr) errors.push(`device_registrations: ${devErr.message}`);

    await supabase
      .from("device_registrations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", deviceId);

    if (errors.length > 0) {
      return jsonResponse(
        { error: "Falha ao buscar dados", details: errors },
        500
      );
    }

    return jsonResponse({
      ok: true,
      customers: customers ?? [],
      products: products ?? [],
      operations: operations ?? [],
      loadingRequests: loadingRequests ?? [],
      printReceipts: printReceipts ?? [],
      devices: devices ?? []
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Erro interno no desktop-pull",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});
