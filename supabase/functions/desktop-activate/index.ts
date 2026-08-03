import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveActivationUnit } from "../_shared/activation-unit.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { pickNextDeviceColor } from "../_shared/device-colors.ts";
import { selectDeviceRegistration } from "../_shared/device-registration.ts";
import { deviceUnitAssignment } from "../_shared/device-unit.ts";

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
    previousDeviceId?: string;
    unitId?: string;
  };

  const activationCode = String(body.activationCode ?? "").trim();
  const deviceName = String(body.deviceName ?? "").trim() || "Desktop balanca";
  const installationId = String(body.installationId ?? "").trim() || null;
  // Pedreira escolhida pelo operador quando a empresa tem mais de uma. O codigo
  // de ativacao e da empresa e nao diz em qual pedreira a balanca esta.
  const requestedUnitId = String(body.unitId ?? "").trim() || null;
  // Registro que ESTE computador ja usava (guardado localmente na ativacao
  // anterior). E a unica prova de que um registro legado, sem installation_id,
  // pertence a esta maquina — sem ela, ativar um computador novo tomaria o
  // registro de outro e derrubaria o token dele.
  const previousDeviceId = String(body.previousDeviceId ?? "").trim() || null;

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
    .order("created_at", { ascending: true });

  if (unitsError) throw unitsError;
  const typedUnits = (units ?? []) as UnitRow[];

  // Multiplos desktops por pedreira: cada computador (installation_id) tem seu
  // proprio registro e token. Ativar um computador novo NAO rotaciona o token
  // dos demais — todos continuam operando em paralelo na mesma unidade.
  const { data: companyDevices, error: existingDeviceError } = await supabase
    .from("device_registrations")
    .select("id, installation_id, unit_id, color, is_active")
    .eq("company_id", typedCompany.id)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false });

  if (existingDeviceError) throw existingDeviceError;
  type ExistingDevice = {
    id: string;
    installation_id: string | null;
    unit_id: string | null;
    color: string | null;
    is_active: boolean;
  };
  const typedDevices = (companyDevices ?? []) as ExistingDevice[];
  // Reusa o registro desta maquina (mesma instalacao, ou registro legado que ela
  // apresenta pelo id que ja usava) e nunca o de outro computador da pedreira.
  const existingDevice = selectDeviceRegistration({
    devices: typedDevices,
    installationId,
    previousDeviceId
  });

  // Em qual pedreira esta balanca esta. O codigo e da empresa: com mais de uma
  // pedreira ativa a ativacao pergunta em vez de chutar a mais antiga (era o que
  // deixava a operacao invisivel para o carregador da outra pedreira).
  const unitChoice = resolveActivationUnit({
    units: typedUnits,
    requestedUnitId,
    currentDeviceUnitId: existingDevice?.unit_id ?? null
  });
  if (unitChoice.kind === "no_units") {
    return jsonResponse({ error: "Pedreira sem unidade ativa cadastrada" }, 403);
  }
  if (unitChoice.kind === "unit_not_found") {
    return jsonResponse({ error: "Pedreira invalida para este codigo de ativacao" }, 400);
  }
  if (unitChoice.kind === "selection_required") {
    return jsonResponse({
      status: "unit_selection_required",
      message: "Escolha em qual pedreira este computador esta instalado.",
      companyId: typedCompany.id,
      companyTradeName: typedCompany.name,
      units: unitChoice.units.map((unit) => ({ id: unit.id, name: unit.name }))
    });
  }
  const typedUnit = unitChoice.unit;

  const deviceToken = createDeviceToken();
  const tokenHash = await sha256Hex(deviceToken);
  const now = new Date().toISOString();

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
        // Mudar de pedreira zera o numero do computador: ele e unico por
        // unidade e o `assign_device_number` abaixo renumera no destino.
        ...deviceUnitAssignment(existingDevice.unit_id, typedUnit.id),
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

  // Numero do computador na unidade: sufixo do cupom para duas balancas nunca
  // emitirem o mesmo numero. Falha aqui nao impede a ativacao — o desktop volta
  // a pedir na proxima validacao de acesso.
  const { data: assignedNumber } = await supabase.rpc("assign_device_number", {
    p_device_id: deviceId
  });
  const deviceNumber = typeof assignedNumber === "number" ? assignedNumber : null;

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
    deviceNumber,
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
