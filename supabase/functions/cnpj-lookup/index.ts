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

// Resposta normalizada devolvida ao desktop. Campos ausentes vem como null.
type CnpjLookupResult = {
  found: boolean;
  cnpj: string;
  legalName: string | null;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
};

// Campos da BrasilAPI (/cnpj/v1) que consumimos. Fonte: Receita Federal.
type BrasilApiCnpj = {
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cep?: string | number | null;
  logradouro?: string | null;
  numero?: string | number | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  ddd_telefone_1?: string | null;
  email?: string | null;
  descricao_situacao_cadastral?: string | null;
};

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function clean(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/** "1130611000" -> "(11) 30611000"; devolve o texto original quando nao casa. */
function formatPhone(raw: string | null | undefined): string | null {
  const digits = onlyDigits(String(raw ?? ""));
  if (digits.length < 10) return clean(raw ?? null);
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  return `(${ddd}) ${rest}`;
}

function mapBrasilApi(cnpj: string, data: BrasilApiCnpj): CnpjLookupResult {
  return {
    found: true,
    cnpj,
    legalName: clean(data.razao_social),
    tradeName: clean(data.nome_fantasia) ?? clean(data.razao_social),
    email: clean(data.email),
    phone: formatPhone(data.ddd_telefone_1),
    zipcode: clean(onlyDigits(String(data.cep ?? ""))),
    addressStreet: clean(data.logradouro),
    addressNumber: clean(data.numero),
    addressComplement: clean(data.complemento),
    neighborhood: clean(data.bairro),
    city: clean(data.municipio),
    state: clean(data.uf),
    status: clean(data.descricao_situacao_cadastral)
  };
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
    cnpj?: string;
  };

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");
  const cnpj = onlyDigits(String(body.cnpj ?? ""));

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

  if (cnpj.length !== 14) {
    return jsonResponse({ error: "CNPJ invalido. Informe os 14 digitos." }, 400);
  }

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: "application/json" }
    });
    if (response.status === 404) {
      return jsonResponse({ found: false, cnpj, message: "CNPJ nao encontrado na base da Receita." });
    }
    if (!response.ok) {
      return jsonResponse(
        { error: `Consulta CNPJ indisponivel (HTTP ${response.status}). Tente novamente.` },
        502
      );
    }
    const data = (await response.json()) as BrasilApiCnpj;
    return jsonResponse(mapBrasilApi(cnpj, data) satisfies CnpjLookupResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na consulta do CNPJ.";
    return jsonResponse({ error: message }, 502);
  }
});
