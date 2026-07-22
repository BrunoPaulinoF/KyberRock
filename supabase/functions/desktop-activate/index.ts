import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { pickNextDeviceColor } from "../_shared/device-colors.ts";

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
    installationId?: string;
  };

  const activationCode = String(body.activationCode ?? "").trim();
  const deviceName = String(body.deviceName ?? "").trim() || "Desktop balanca";
  const installationId = String(body.installationId ?? "").trim() || null;

  if (!/^\d{6}$/.test(activationCode)) {
    return jsonResponse({ error: "Codigo de ativacao invalido" }, 400);
  }

  const activationCodeHash = await sha256Hex(activationCode);
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, legal_name, document, is_active")
    .eq("desktop_activation_code_hash", activationCodeHash)
    .single();

  if (companyError || !company) {
    return jsonResponse({ error: "Codigo de ativacao invalido ou expirado" }, 401);
  }

  const typedCompany = company as CompanyRow;

  if (!typedCompany.is_active) {
    return jsonResponse({ error: "Não autorizado. Empresa bloqueada pelo administrador." }, 403);
  }

  const { data: units, error: unitsError } = await supabase
    .from("units")
    .select("id, company_id, name, timezone, is_active")
    .eq("company_id", typedCompany.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);

  if (unitsError) throw unitsError;
  const typedUnit = (units?.[0] ?? null) as UnitRow | null;
  if (!typedUnit) {
    return jsonResponse({ error: "Pedreira sem unidade ativa cadastrada" }, 403);
  }

  const deviceToken = createDeviceToken();
  const tokenHash = await sha256Hex(deviceToken);
  const now = new Date().toISOString();

  // Multiplos desktops por pedreira: cada computador (installation_id) tem seu
  // proprio registro e token. Ativar um computador novo NAO rotaciona o token
  // dos demais — todos continuam operando em paralelo na mesma unidade.
  const { data: companyDevices, error: existingDeviceError } = await supabase
    .from("device_registrations")
    .select("id, installation_id, color, is_active")
    .eq("company_id", typedCompany.id)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false });

  if (existingDeviceError) throw existingDeviceError;
  type ExistingDevice = {
    id: string;
    installation_id: string | null;
    color: string | null;
    is_active: boolean;
  };
  const typedDevices = (companyDevices ?? []) as ExistingDevice[];
  // Reativacao do mesmo computador: reusa o registro daquela instalacao.
  // Sem correspondencia, adota o registro legado (anterior ao multi-desktop,
  // sem installation_id) mais recente, preservando o id historico das operacoes.
  const existingDevice = installationId
    ? (typedDevices.find((device) => device.installation_id === installationId) ??
      typedDevices.find((device) => !device.installation_id))
    : typedDevices.find((device) => !device.installation_id);
  const deviceId = existingDevice?.id ?? `desktop-${crypto.randomUUID()}`;
  const deviceColor =
    existingDevice?.color ??
    pickNextDeviceColor(
      typedDevices.filter((device) => device.id !== deviceId).map((device) => device.color)
    );

  if (existingDevice) {
    const { error: updateDeviceError } = await supabase
      .from("device_registrations")
      .update({
        unit_id: typedUnit.id,
        name: deviceName,
        installation_id: installationId ?? existingDevice.installation_id,
        color: deviceColor,
        token_hash: tokenHash,
        is_active: true,
        last_seen_at: now,
        updated_at: now
      })
      .eq("id", deviceId);
    if (updateDeviceError) throw updateDeviceError;
  } else {
    const { error: deviceError } = await supabase.from("device_registrations").insert({
      id: deviceId,
      company_id: typedCompany.id,
      unit_id: typedUnit.id,
      name: deviceName,
      installation_id: installationId,
      color: deviceColor,
      token_hash: tokenHash,
      is_active: true,
      last_seen_at: now,
      created_at: now,
      updated_at: now
    });

    if (deviceError) throw deviceError;
  }

  const publishableKey =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("KYBERROCK_DESKTOP_PUBLISHABLE_KEY") ??
    null;

  return jsonResponse({
    status: "approved",
    message: "Desktop ativado com sucesso.",
    companyId: typedCompany.id,
    companyLegalName: typedCompany.legal_name,
    companyTradeName: typedCompany.name,
    companyDocument: typedCompany.document,
    unitId: typedUnit.id,
    unitName: typedUnit.name,
    unitTimezone: typedUnit.timezone,
    deviceId,
    deviceToken,
    deviceName,
    deviceColor,
    installationId,
    supabaseUrl,
    publishableKey,
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
