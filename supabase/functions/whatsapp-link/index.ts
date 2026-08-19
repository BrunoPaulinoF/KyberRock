import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";
import {
  WHATSAPP_LINK_TTL_MINUTES,
  buildWhatsappLinkUrl,
  generateWhatsappLinkToken,
  normalizeQrCodeDataUrl,
  routeWhatsappLinkPath,
  whatsappLinkExpiresAt,
  whatsappLinkRemainingMs,
  whatsappLinkState,
  type WhatsappLinkState
} from "../_shared/whatsapp-link.ts";

// ---------------------------------------------------------------------------
// Link temporario para conectar o WhatsApp da pedreira (15 minutos).
//
// O QR code que a tela de Relatorios mostra so serve a quem esta na frente do
// computador da balanca -- e o celular dono do numero quase nunca esta ali.
// Aqui a balanca pede um endereco publico e curto, manda por qualquer meio para
// quem tem o aparelho, e essa pessoa escaneia o QR pelo proprio celular.
//
// Dois caminhos numa funcao so:
//
//   POST /whatsapp-link                 -> API do desktop (deviceId +
//                                          deviceToken): cria e cancela link.
//   POST /whatsapp-link/c/<token>/state -> QR e estado atualizados, de 3 em 3 s,
//                                          consultados pela pagina do convidado.
//
// A PAGINA nao mora aqui: ela e a rota `/whatsapp/<token>` do loader-web. As
// Edge Functions respondem HTML como `text/plain` com `nosniff` (protecao
// anti-phishing do dominio `*.supabase.co`), entao uma pagina servida daqui
// chegaria ao celular do convidado como codigo-fonte. O que atravessa esse
// filtro e JSON -- e e so JSON que esta funcao devolve.
//
// O que NUNCA sai daqui e a credencial da instancia UAZAPI: quem fala com a
// UAZAPI e esta funcao, com o token que a pedreira ja empurrou para
// `report_channel_settings`. O navegador do convidado recebe so a imagem do QR.
//
// A UAZAPI so e chamada no /state, ou seja, quando alguem realmente abriu a
// pagina: quem manda o link por WhatsApp faz o proprio WhatsApp buscar a pagina
// para montar a previa, e uma previa nao pode rotacionar o QR de ninguem.
//
// Publica de proposito (verify_jwt = false em config.toml) -- quem abre e um
// celular qualquer, sem sessao do Supabase. O que protege e o token de 256 bits
// guardado como hash, o prazo de 15 minutos e o fato de o link morrer assim que
// o pareamento acontece.
// ---------------------------------------------------------------------------

const LINKS_TABLE = "whatsapp_connection_links";
const CHANNEL_SETTINGS_TABLE = "report_channel_settings";
/** Secret com o endereco publico do loader-web (ex.: https://app.suaempresa.com.br). */
const SITE_URL_ENV = "KYBERROCK_SITE_URL";
const UAZAPI_TIMEOUT_MS = 20_000;

/**
 * Client visto pelos handlers: so o encadeamento realmente usado, como em
 * `omie-sync`. `createClient` sem os tipos gerados do banco infere `never` nos
 * argumentos de insert/update, e ai qualquer linha vira erro de tipo assim que o
 * client passa por um parametro. Declarar a forma minima resolve sem `any` e
 * ainda documenta o que esta funcao faz no banco.
 */
type QueryResult = { data: unknown; error: { message: string } | null };

interface SupabaseQueryLike extends PromiseLike<QueryResult> {
  select(columns: string): SupabaseQueryLike;
  eq(column: string, value: string): SupabaseQueryLike;
  is(column: string, value: null): SupabaseQueryLike;
  lt(column: string, value: string): SupabaseQueryLike;
  single(): PromiseLike<QueryResult>;
  maybeSingle(): PromiseLike<QueryResult>;
}

type SupabaseClient = {
  from(table: string): {
    select(columns: string): SupabaseQueryLike;
    insert(values: Record<string, unknown>): SupabaseQueryLike;
    update(values: Record<string, unknown>): SupabaseQueryLike;
    delete(): SupabaseQueryLike;
  };
};

type DeviceRow = {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
};

type LinkRow = {
  id: string;
  company_id: string;
  expires_at: string;
  revoked_at: string | null;
  connected_at: string | null;
  open_count: number | null;
};

type ChannelSettingsRow = {
  whatsapp_url: string | null;
  whatsapp_instance_token: string | null;
};

function serviceClient(): SupabaseClient {
  // O cast e a fronteira entre o client real e a forma minima acima. Sem os
  // tipos gerados do banco, comparar os dois tipos derruba o compilador com
  // "type instantiation is excessively deep" -- e o que o client faz aqui esta
  // descrito em SupabaseClient, linha por linha.
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  return client as unknown as SupabaseClient;
}

/**
 * Endereco publico do site (loader-web), de onde sai a pagina do convidado.
 * Nome fixo no codigo, valor no secret do Supabase -- mesma convencao dos
 * segredos do financeiro. Sem ele nao ha link para montar, e recusar com o
 * motivo e melhor que devolver um endereco que abre em lugar nenhum.
 */
function siteUrl(): string {
  return (Deno.env.get(SITE_URL_ENV) ?? "").trim().replace(/\/+$/, "");
}

// --- UAZAPI ----------------------------------------------------------------

interface UazapiState {
  status: string;
  qrcode: string | null;
  paircode: string | null;
  profileName: string | null;
}

function mapUazapiState(payload: Record<string, unknown>): UazapiState {
  const instance = (payload["instance"] ?? {}) as Record<string, unknown>;
  return {
    status: typeof instance["status"] === "string" ? instance["status"] : "disconnected",
    qrcode: normalizeQrCodeDataUrl(instance["qrcode"]),
    paircode: typeof instance["paircode"] === "string" ? instance["paircode"] : null,
    profileName: typeof instance["profileName"] === "string" ? instance["profileName"] : null
  };
}

async function uazapiRequest(
  baseUrl: string,
  path: string,
  method: "GET" | "POST",
  instanceToken: string
): Promise<UazapiState> {
  const url = `${baseUrl.trim().replace(/\/+$/, "")}${path}`;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", token: instanceToken },
    body: method === "POST" ? "{}" : undefined,
    signal: AbortSignal.timeout(UAZAPI_TIMEOUT_MS)
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`UAZAPI ${path} respondeu ${response.status}: ${text.slice(0, 160)}`);
  }
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return mapUazapiState(json);
}

async function readChannelSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ baseUrl: string; instanceToken: string } | null> {
  const { data } = await supabase
    .from(CHANNEL_SETTINGS_TABLE)
    .select("whatsapp_url, whatsapp_instance_token")
    .eq("company_id", companyId)
    .maybeSingle();
  const row = (data ?? null) as ChannelSettingsRow | null;
  const baseUrl = row?.whatsapp_url?.trim() ?? "";
  const instanceToken = row?.whatsapp_instance_token?.trim() ?? "";
  if (!baseUrl || !instanceToken) return null;
  return { baseUrl, instanceToken };
}

// --- API do desktop --------------------------------------------------------

async function authenticateDevice(
  supabase: SupabaseClient,
  deviceId: string,
  deviceToken: string
): Promise<DeviceRow | null> {
  if (!deviceId || !deviceToken) return null;
  const { data } = await supabase
    .from("device_registrations")
    .select("id, company_id, unit_id, token_hash, is_active")
    .eq("id", deviceId)
    .maybeSingle();
  const device = (data ?? null) as DeviceRow | null;
  if (!device || !device.is_active) return null;
  const tokenHash = await sha256Hex(deviceToken);
  return safeEqual(tokenHash, device.token_hash) ? device : null;
}

/**
 * Cancela os links ainda validos da pedreira. Chamado tanto pelo botao de
 * cancelar quanto antes de criar um novo: dois links vivos ao mesmo tempo
 * significam duas janelas de pareamento abertas, e ninguem consegue lembrar
 * quantas mandou.
 */
async function revokeActiveLinks(
  supabase: SupabaseClient,
  companyId: string,
  now: string,
  linkId?: string
): Promise<void> {
  let query = supabase
    .from(LINKS_TABLE)
    .update({ revoked_at: now })
    .eq("company_id", companyId)
    .is("revoked_at", null)
    .is("connected_at", null);
  if (linkId) query = query.eq("id", linkId);
  await query;
}

async function handleCreate(supabase: SupabaseClient, device: DeviceRow): Promise<Response> {
  const site = siteUrl();
  if (!site) {
    return jsonResponse(
      {
        error: `O endereco do site nao esta configurado na nuvem (secret ${SITE_URL_ENV}). Fale com o suporte: sem ele o link nao tem para onde apontar.`
      },
      503
    );
  }

  const settings = await readChannelSettings(supabase, device.company_id);
  if (!settings) {
    // Sem a configuracao na nuvem o link abriria numa pagina que nao tem como
    // gerar QR nenhum. Melhor recusar aqui, com o motivo.
    return jsonResponse(
      {
        error:
          "A configuracao do WhatsApp (servidor e token da instancia) ainda nao chegou na nuvem. Salve a configuracao com internet e tente de novo."
      },
      409
    );
  }

  const createdAt = new Date();
  const nowIso = createdAt.toISOString();
  await revokeActiveLinks(supabase, device.company_id, nowIso);

  const token = generateWhatsappLinkToken();
  const expiresAt = whatsappLinkExpiresAt(createdAt);
  const { data, error } = await supabase
    .from(LINKS_TABLE)
    .insert({
      company_id: device.company_id,
      unit_id: device.unit_id,
      device_id: device.id,
      token_hash: await sha256Hex(token),
      created_at: nowIso,
      expires_at: expiresAt
    })
    .select("id")
    .single();

  if (error || !data) {
    return jsonResponse(
      { error: `Falha ao gerar o link temporario: ${error?.message ?? "sem resposta"}` },
      500
    );
  }

  // Faxina barata: os links vencidos da propria pedreira nao servem a ninguem
  // depois de um dia, e ninguem mais vai passar por aqui para limpa-los.
  const yesterday = new Date(createdAt.getTime() - 24 * 60 * 60_000).toISOString();
  await supabase
    .from(LINKS_TABLE)
    .delete()
    .eq("company_id", device.company_id)
    .lt("expires_at", yesterday);

  return jsonResponse({
    id: (data as { id: string }).id,
    url: buildWhatsappLinkUrl(site, token),
    createdAt: nowIso,
    expiresAt,
    ttlMinutes: WHATSAPP_LINK_TTL_MINUTES
  });
}

async function handleApi(supabase: SupabaseClient, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    deviceId?: string;
    deviceToken?: string;
    action?: string;
    linkId?: string;
  };

  const device = await authenticateDevice(
    supabase,
    String(body.deviceId ?? ""),
    String(body.deviceToken ?? "")
  );
  if (!device) return jsonResponse({ error: "Desktop nao autorizado." }, 401);

  const { data: company } = await supabase
    .from("companies")
    .select("is_active")
    .eq("id", device.company_id)
    .maybeSingle();
  if ((company as { is_active?: boolean } | null)?.is_active === false) {
    return jsonResponse({ error: "Empresa bloqueada pelo administrador." }, 403);
  }

  const action = String(body.action ?? "create");
  if (action === "create") return handleCreate(supabase, device);
  if (action === "revoke") {
    await revokeActiveLinks(
      supabase,
      device.company_id,
      new Date().toISOString(),
      body.linkId ? String(body.linkId) : undefined
    );
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: `Acao desconhecida: ${action}` }, 400);
}

// --- Pagina publica e estado ----------------------------------------------

async function findLink(supabase: SupabaseClient, token: string): Promise<LinkRow | null> {
  const { data } = await supabase
    .from(LINKS_TABLE)
    .select("id, company_id, expires_at, revoked_at, connected_at, open_count")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  return (data ?? null) as LinkRow | null;
}

async function handleState(supabase: SupabaseClient, token: string): Promise<Response> {
  const link = await findLink(supabase, token);
  // Link inexistente e link vencido dizem a mesma coisa ao visitante de
  // proposito: nao ha nada aqui. Distinguir os dois so ensinaria a quem varre
  // enderecos quais tokens ja existiram.
  if (!link) return jsonResponse({ state: "expired" as WhatsappLinkState }, 404);

  const state = whatsappLinkState(link);
  if (state !== "active") {
    return jsonResponse({ state, expiresAt: link.expires_at });
  }

  // Cada abertura da pagina conta: e o unico rastro de quem usou o link.
  await supabase
    .from(LINKS_TABLE)
    .update({ last_opened_at: new Date().toISOString(), open_count: (link.open_count ?? 0) + 1 })
    .eq("id", link.id);

  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", link.company_id)
    .maybeSingle();

  const settings = await readChannelSettings(supabase, link.company_id);
  const base = {
    state,
    companyName: (company as { name?: string | null } | null)?.name?.trim() || null,
    expiresAt: link.expires_at,
    remainingMs: whatsappLinkRemainingMs(link.expires_at)
  };
  if (!settings) {
    return jsonResponse({ ...base, error: "WhatsApp nao configurado nesta pedreira." });
  }

  try {
    let instance = await uazapiRequest(
      settings.baseUrl,
      "/instance/status",
      "GET",
      settings.instanceToken
    );

    // Um QR so nasce depois do /instance/connect. Sem esta condicao, chamar
    // connect a cada 3 s rotacionaria o QR debaixo da camera de quem esta
    // escaneando.
    if (instance.status !== "connected" && (instance.status !== "connecting" || !instance.qrcode)) {
      await uazapiRequest(settings.baseUrl, "/instance/connect", "POST", settings.instanceToken);
      instance = await uazapiRequest(
        settings.baseUrl,
        "/instance/status",
        "GET",
        settings.instanceToken
      );
    }

    if (instance.status === "connected") {
      const connectedAt = new Date().toISOString();
      // O link morre no pareamento: ele existia para essa unica tarefa, e
      // deixa-lo vivo daria a quem tem a URL uma segunda chance de parear.
      await supabase.from(LINKS_TABLE).update({ connected_at: connectedAt }).eq("id", link.id);
      // A balanca ainda vai descobrir isso no proprio ciclo, mas quem le
      // `report_channel_settings` e o envio de relatorio -- e ele nao pode
      // esperar o desktop acordar para saber que ha numero conectado.
      await supabase
        .from(CHANNEL_SETTINGS_TABLE)
        .update({ whatsapp_status: "connected", updated_at: connectedAt })
        .eq("company_id", link.company_id);
      return jsonResponse({
        ...base,
        state: "connected" as WhatsappLinkState,
        profileName: instance.profileName
      });
    }

    return jsonResponse({
      ...base,
      status: instance.status,
      qrcode: instance.qrcode,
      paircode: instance.paircode
    });
  } catch (error) {
    // Falha de rede com a UAZAPI nao fecha o link: a pagina mostra o aviso e
    // continua tentando ate o prazo acabar.
    return jsonResponse({
      ...base,
      error: error instanceof Error ? error.message : "Falha ao falar com o servidor do WhatsApp."
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const route = routeWhatsappLinkPath(new URL(req.url).pathname);
  const supabase = serviceClient();

  try {
    if (route.kind === "api") {
      if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      return await handleApi(supabase, req);
    }
    if (route.kind === "state" && route.token) {
      if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      return await handleState(supabase, route.token);
    }
  } catch (error) {
    console.error("whatsapp-link:", error);
    return jsonResponse({ error: "Falha interna no link de conexao." }, 500);
  }

  return jsonResponse({ error: "Rota desconhecida." }, 404);
});
