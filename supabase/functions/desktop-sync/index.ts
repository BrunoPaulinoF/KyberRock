import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => ({})) as {
    deviceId?: string;
    deviceToken?: string;
    operations?: Record<string, unknown>[];
    loadingRequests?: Record<string, unknown>[];
    customers?: Record<string, unknown>[];
    products?: Record<string, unknown>[];
  };

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");
  const { data: device, error: deviceError } = await supabase
    .from("device_registrations")
    .select("id, token_hash, is_active")
    .eq("id", deviceId)
    .single();
  if (deviceError || !device?.is_active) return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);

  const tokenHash = await sha256Hex(deviceToken);
  if (!safeEqual(tokenHash, device.token_hash)) return jsonResponse({ error: "Token de dispositivo invalido" }, 401);

  const counts = { operations: 0, loadingRequests: 0, customers: 0, products: 0 };
  if (body.customers?.length) {
    const { error } = await supabase.from("customers").upsert(body.customers, { onConflict: "id" });
    if (error) throw error;
    counts.customers = body.customers.length;
  }
  if (body.products?.length) {
    const { error } = await supabase.from("products").upsert(body.products, { onConflict: "id" });
    if (error) throw error;
    counts.products = body.products.length;
  }
  if (body.operations?.length) {
    const { error } = await supabase.from("weighing_operations").upsert(body.operations, { onConflict: "id" });
    if (error) throw error;
    counts.operations = body.operations.length;
  }
  if (body.loadingRequests?.length) {
    const { error } = await supabase.from("loading_requests").upsert(body.loadingRequests, { onConflict: "id" });
    if (error) throw error;
    counts.loadingRequests = body.loadingRequests.length;
  }

  await supabase.from("device_registrations").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
  return jsonResponse({ ok: true, counts });
});
