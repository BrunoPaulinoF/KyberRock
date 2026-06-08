import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

type DeviceRow = {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => ({})) as {
    deviceId?: string;
    deviceToken?: string;
  };

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");

  const { data: device, error: deviceError } = await supabase
    .from("device_registrations")
    .select("id, company_id, unit_id, token_hash, is_active")
    .eq("id", deviceId)
    .single();

  if (deviceError || !device) {
    return jsonResponse({ status: "invalid_device", allowed: false, message: "Desktop nao registrado." });
  }

  const typedDevice = device as DeviceRow;
  const tokenHash = await sha256Hex(deviceToken);
  if (!safeEqual(tokenHash, typedDevice.token_hash)) {
    return jsonResponse({ status: "invalid_device", allowed: false, message: "Token do desktop invalido." });
  }

  if (!typedDevice.is_active) {
    return jsonResponse({ status: "device_blocked", allowed: false, message: "Este desktop foi bloqueado pelo administrador." });
  }

  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("id, company_id, name, is_active")
    .eq("id", typedDevice.unit_id)
    .single();
  if (unitError || !unit?.is_active) {
    return jsonResponse({ status: "unit_blocked", allowed: false, message: "Pedreira/unidade bloqueada pelo administrador." });
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, is_active")
    .eq("id", typedDevice.company_id)
    .single();
  if (companyError || !company?.is_active) {
    return jsonResponse({ status: "company_blocked", allowed: false, message: "Empresa bloqueada pelo administrador." });
  }

  const checkedAt = new Date().toISOString();
  await supabase
    .from("device_registrations")
    .update({ last_seen_at: checkedAt, updated_at: checkedAt })
    .eq("id", typedDevice.id);

  return jsonResponse({
    status: "approved",
    allowed: true,
    message: "Acesso aprovado. Sistema liberado.",
    companyId: typedDevice.company_id,
    unitId: typedDevice.unit_id,
    deviceId: typedDevice.id,
    checkedAt
  });
});
