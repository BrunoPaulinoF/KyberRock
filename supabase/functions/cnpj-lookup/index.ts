import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";
import { CnpjLookupError, lookupCnpj } from "../_shared/cnpj-lookup.ts";

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
  const body = (await req.json().catch(() => ({}))) as {
    deviceId?: string;
    deviceToken?: string;
    cnpj?: string;
  };

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");
  const { data: device, error: deviceError } = await supabase
    .from("device_registrations")
    .select("id, company_id, unit_id, token_hash, is_active")
    .eq("id", deviceId)
    .single();
  if (deviceError || !device) {
    return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
  }
  const typedDevice = device as DeviceRow;
  const tokenHash = await sha256Hex(deviceToken);
  if (!safeEqual(tokenHash, typedDevice.token_hash)) {
    return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
  }
  if (!typedDevice.is_active) {
    return jsonResponse({ error: "Dispositivo bloqueado" }, 401);
  }

  try {
    const result = await lookupCnpj(String(body.cnpj ?? ""));
    return jsonResponse(
      result.found ? result : { ...result, message: "CNPJ nao encontrado na base da Receita." }
    );
  } catch (error) {
    if (error instanceof CnpjLookupError)
      return jsonResponse({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Falha na consulta do CNPJ.";
    return jsonResponse({ error: message }, 502);
  }
});
