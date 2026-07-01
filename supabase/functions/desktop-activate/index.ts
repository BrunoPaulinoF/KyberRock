import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/crypto.ts";

type CompanyRow = {
  id: string;
  name: string;
  legal_name: string;
  document: string | null;
  is_active: boolean;
};

type UnitRow = {
  id: string;
  company_id: string;
  name: string;
  timezone: string;
  is_active: boolean;
  desktop_publishable_key: string | null;
  companies: CompanyRow | CompanyRow[] | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = (await req.json().catch(() => ({}))) as {
    activationCode?: string;
    deviceName?: string;
  };

  const activationCode = String(body.activationCode ?? "").trim();
  const deviceName = String(body.deviceName ?? "").trim() || "Desktop balanca";

  if (!/^\d{6}$/.test(activationCode)) {
    return jsonResponse({ error: "Codigo de ativacao invalido" }, 400);
  }

  const activationCodeHash = await sha256Hex(activationCode);
  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select(
      "id, company_id, name, timezone, is_active, desktop_publishable_key, companies(id, name, legal_name, document, is_active)"
    )
    .eq("desktop_activation_code_hash", activationCodeHash)
    .single();

  if (unitError || !unit) {
    return jsonResponse({ error: "Codigo de ativacao invalido ou expirado" }, 401);
  }

  const typedUnit = unit as UnitRow;
  const company = Array.isArray(typedUnit.companies) ? typedUnit.companies[0] : typedUnit.companies;

  if (!company?.is_active) {
    return jsonResponse({ error: "Não autorizado. Empresa bloqueada pelo administrador." }, 403);
  }

  if (!typedUnit.is_active) {
    return jsonResponse({ error: "Pedreira/unidade bloqueada pelo administrador" }, 403);
  }

  const deviceId = `desktop-${crypto.randomUUID()}`;
  const deviceToken = createDeviceToken();
  const tokenHash = await sha256Hex(deviceToken);
  const now = new Date().toISOString();

  const { error: deviceError } = await supabase.from("device_registrations").insert({
    id: deviceId,
    company_id: company.id,
    unit_id: typedUnit.id,
    name: deviceName,
    token_hash: tokenHash,
    is_active: true,
    last_seen_at: now,
    created_at: now,
    updated_at: now
  });

  if (deviceError) throw deviceError;

  const publishableKey =
    typedUnit.desktop_publishable_key ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("KYBERROCK_DESKTOP_PUBLISHABLE_KEY") ??
    null;

  return jsonResponse({
    status: "approved",
    message: "Desktop ativado com sucesso.",
    companyId: company.id,
    companyLegalName: company.legal_name,
    companyTradeName: company.name,
    companyDocument: company.document,
    unitId: typedUnit.id,
    unitName: typedUnit.name,
    unitTimezone: typedUnit.timezone,
    deviceId,
    deviceToken,
    supabaseUrl,
    publishableKey,
    publishableKeySource: typedUnit.desktop_publishable_key
      ? "unit"
      : publishableKey
        ? "env"
        : "missing",
    checkedAt: now
  });
});

function createDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
