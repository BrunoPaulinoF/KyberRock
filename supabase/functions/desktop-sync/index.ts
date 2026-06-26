import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

type CloudPayload = {
  deviceId?: string;
  deviceToken?: string;
  operations?: Record<string, unknown>[];
  loadingRequests?: Record<string, unknown>[];
  printReceipts?: Record<string, unknown>[];
  customers?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: CloudPayload;
    try {
      body = (await req.json()) as CloudPayload;
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
      .select("id, token_hash, is_active")
      .eq("id", deviceId)
      .single();
    if (deviceError || !device?.is_active) {
      return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
    }

    const tokenHash = await sha256Hex(deviceToken);
    if (!safeEqual(tokenHash, device.token_hash)) {
      return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
    }

    const counts = {
      customers: 0,
      products: 0,
      operations: 0,
      loadingRequests: 0,
      printReceipts: 0
    };
    const stepErrors: string[] = [];

    // Ordem importa: dependencias antes de dependentes (FK customers/products -> operations/loadingRequests/printReceipts).
    if (body.customers?.length) {
      const { error } = await supabase
        .from("customers")
        .upsert(body.customers, { onConflict: "id" });
      if (error) {
        stepErrors.push(`customers: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.customers = body.customers.length;
      }
    }
    if (body.products?.length) {
      const { error } = await supabase.from("products").upsert(body.products, { onConflict: "id" });
      if (error) {
        stepErrors.push(`products: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.products = body.products.length;
      }
    }
    if (body.operations?.length) {
      const { error } = await supabase
        .from("weighing_operations")
        .upsert(body.operations, { onConflict: "id" });
      if (error) {
        stepErrors.push(`weighing_operations: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.operations = body.operations.length;
      }
    }
    if (body.loadingRequests?.length) {
      const { error } = await supabase
        .from("loading_requests")
        .upsert(body.loadingRequests, { onConflict: "id" });
      if (error) {
        stepErrors.push(`loading_requests: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.loadingRequests = body.loadingRequests.length;
      }
    }
    if (body.printReceipts?.length) {
      const { error } = await supabase
        .from("print_receipts")
        .upsert(body.printReceipts, { onConflict: "id" });
      if (error) {
        stepErrors.push(`print_receipts: ${error.message} (code=${error.code ?? "n/a"})`);
      } else {
        counts.printReceipts = body.printReceipts.length;
      }
    }

    // Heartbeat sempre: nao perder o last_seen_at mesmo se algum upsert falhou.
    await supabase
      .from("device_registrations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", deviceId);

    if (stepErrors.length > 0) {
      return jsonResponse(
        {
          error: "Falha ao persistir alguns payloads",
          details: stepErrors,
          counts
        },
        500
      );
    }

    return jsonResponse({ ok: true, counts });
  } catch (error) {
    return jsonResponse(
      {
        error: "Erro interno no desktop-sync",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});
