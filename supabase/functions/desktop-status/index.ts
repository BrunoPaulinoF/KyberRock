import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

type DeviceRow = {
  id: string;
  company_id: string;
  unit_id: string;
  name: string;
  color: string | null;
  device_number: number | null;
  token_hash: string;
  is_active: boolean;
  // Ausente na leitura de emergencia (migracao ainda nao aplicada).
  update_channel?: string | null;
};

/**
 * Anel de atualizacao desta balanca. `beta` recebe as versoes em avaliacao antes
 * da frota; qualquer outra coisa e producao.
 *
 * A normalizacao acontece nos DOIS lados (aqui e em `update-channel.ts` no
 * desktop) de proposito: instalacao antiga tem que continuar em producao mesmo
 * se um dia chegar valor estranho, e balanca de cliente jamais pode entrar no
 * anel de teste por acidente.
 */
function normalizeUpdateChannel(value: unknown): "latest" | "beta" {
  return typeof value === "string" && value.trim().toLowerCase() === "beta" ? "beta" : "latest";
}

/**
 * Le o registro da balanca tolerando a coluna `update_channel` ainda nao existir.
 *
 * As Edge Functions sao implantadas pelo CI a cada push, mas as migracoes SQL
 * sao aplicadas a parte. Entre uma coisa e outra existe uma janela em que esta
 * funcao ja pede a coluna e a tabela ainda nao a tem — e um select com coluna
 * desconhecida falha INTEIRO. Como o chamador trata erro de leitura como
 * "Desktop nao registrado", isso bloquearia TODA a frota ate a migracao ser
 * aplicada. Por isso a segunda tentativa sem a coluna: pior caso, a balanca fica
 * em producao, que e o padrao correto.
 */
const DEVICE_BASE_COLUMNS =
  "id, company_id, unit_id, name, color, device_number, token_hash, is_active";

/**
 * Balanca principal de precos da empresa (`is_price_master`), quando ha uma.
 *
 * Devolve `undefined` — e nao `null` — quando a coluna ainda nao existe no banco: o
 * desktop so grava a principal quando o campo VEM na resposta, entao a janela entre o
 * deploy da funcao e a aplicacao da migracao nao pode ser confundida com "a pedreira nao
 * tem principal". Confundir tiraria o espelhamento de preco das balancas que ja o tem.
 */
async function selectPriceMaster(
  supabase: ReturnType<typeof createClient>,
  companyId: string
): Promise<{ id: string; name: string } | null | undefined> {
  const { data, error } = await supabase
    .from("device_registrations")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("is_price_master", true)
    .limit(1);
  if (error) return undefined;
  const row = (data ?? [])[0] as { id?: unknown; name?: unknown } | undefined;
  if (!row || typeof row.id !== "string") return null;
  return { id: row.id, name: typeof row.name === "string" ? row.name : "" };
}

async function selectDeviceRow(
  supabase: ReturnType<typeof createClient>,
  deviceId: string
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  const withChannel = await supabase
    .from("device_registrations")
    .select(`${DEVICE_BASE_COLUMNS}, update_channel`)
    .eq("id", deviceId)
    .single();
  if (!withChannel.error) {
    return { data: withChannel.data as Record<string, unknown> | null, error: null };
  }

  const fallback = await supabase
    .from("device_registrations")
    .select(DEVICE_BASE_COLUMNS)
    .eq("id", deviceId)
    .single();
  return { data: fallback.data as Record<string, unknown> | null, error: fallback.error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = (await req.json().catch(() => ({}))) as {
    deviceId?: string;
    deviceToken?: string;
  };

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");

  const { data: device, error: deviceError } = await selectDeviceRow(supabase, deviceId);

  if (deviceError || !device) {
    return jsonResponse({
      status: "invalid_device",
      allowed: false,
      message: "Desktop nao registrado."
    });
  }

  const typedDevice = device as DeviceRow;
  const tokenHash = await sha256Hex(deviceToken);
  if (!safeEqual(tokenHash, typedDevice.token_hash)) {
    // O registro existe, mas com outro token: este computador precisa ser
    // reativado (nao e bloqueio do administrador).
    return jsonResponse({
      status: "invalid_device",
      allowed: false,
      message:
        "Este computador precisa ser reativado com o codigo da pedreira. Os demais computadores continuam operando normalmente."
    });
  }

  if (!typedDevice.is_active) {
    return jsonResponse({
      status: "device_blocked",
      allowed: false,
      message: "Este desktop foi bloqueado pelo administrador."
    });
  }

  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("id, company_id, name, is_active")
    .eq("id", typedDevice.unit_id)
    .single();
  if (unitError || !unit?.is_active) {
    return jsonResponse({
      status: "unit_blocked",
      allowed: false,
      message: "Pedreira/unidade bloqueada pelo administrador."
    });
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, is_active, payment_blocked")
    .eq("id", typedDevice.company_id)
    .single();
  if (companyError || !company?.is_active) {
    return jsonResponse({
      status: "company_blocked",
      allowed: false,
      message: "Não autorizado. Empresa bloqueada pelo administrador."
    });
  }

  if (company.payment_blocked === true) {
    return jsonResponse({
      status: "payment_blocked",
      allowed: false,
      message:
        "Acesso bloqueado por falta de pagamento. Regularize a pendência para reativar o acesso."
    });
  }

  // Numero do computador na unidade (sufixo do cupom): maquinas ativadas antes
  // desta versao recebem o numero na primeira validacao, sem precisar reativar.
  let deviceNumber = typedDevice.device_number;
  if (deviceNumber === null || deviceNumber === undefined) {
    const { data: assigned } = await supabase.rpc("assign_device_number", {
      p_device_id: typedDevice.id
    });
    deviceNumber = typeof assigned === "number" ? assigned : null;
  }

  const checkedAt = new Date().toISOString();
  await supabase
    .from("device_registrations")
    .update({ last_seen_at: checkedAt, updated_at: checkedAt })
    .eq("id", typedDevice.id);

  // Legenda multi-desktop: todos os computadores da unidade (nome + cor), para o
  // desktop identificar o responsavel por cada operacao criada por outra maquina.
  const { data: unitDevices } = await supabase
    .from("device_registrations")
    .select("id, name, color, device_number, is_active, last_seen_at")
    .eq("unit_id", typedDevice.unit_id)
    .order("created_at", { ascending: true });

  // Consulta separada da legenda de proposito: `is_price_master` e uma coluna nova, e
  // pedi-la dentro do select acima faria a legenda multi-desktop inteira falhar enquanto
  // a migracao nao fosse aplicada.
  const priceMaster = await selectPriceMaster(supabase, typedDevice.company_id);

  return jsonResponse({
    status: "approved",
    allowed: true,
    message: "Acesso aprovado. Sistema liberado.",
    companyId: typedDevice.company_id,
    unitId: typedDevice.unit_id,
    deviceId: typedDevice.id,
    deviceName: typedDevice.name,
    deviceColor: typedDevice.color,
    deviceNumber,
    // O desktop so grava o canal quando o campo VEM na resposta: enviar sempre
    // (mesmo que 'latest') e o que permite o painel devolver uma balanca de teste
    // para producao. Omitir seria indistinguivel de "nuvem antiga".
    updateChannel: normalizeUpdateChannel(typedDevice.update_channel),
    // Principal de precos da pedreira. Os campos so entram na resposta quando a coluna
    // existe: omitir e o sinal de "nuvem antiga", e o desktop mantem o que ja sabia.
    ...(priceMaster === undefined
      ? {}
      : {
          priceMasterDeviceId: priceMaster?.id ?? null,
          priceMasterDeviceName: priceMaster?.name || null
        }),
    unitDevices: unitDevices ?? [],
    checkedAt
  });
});
