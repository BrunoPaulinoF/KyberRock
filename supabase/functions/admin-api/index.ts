import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyAdminSession } from "../_shared/admin-session.ts";
import { deviceUnitAssignment } from "../_shared/device-unit.ts";
import { parseDeviceName } from "../_shared/device-name.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import {
  deleteAuthUser,
  findAuthUserIdByEmail,
  isEmailAlreadyRegisteredError
} from "../_shared/admin-users.ts";
import type { AuthUserGateway } from "../_shared/admin-users.ts";
import {
  buildCompanyCredentials,
  buildDeviceCredentials,
  buildUserCredentials
} from "../_shared/admin-credentials.ts";
import {
  decryptCredential,
  encryptCredential,
  isCipherConfigured
} from "../_shared/credential-cipher.ts";
import { summarizeDesktopReleases } from "../_shared/desktop-releases.ts";
import {
  applyPullRequests,
  bodiesUnavailable,
  entriesFromCommits,
  pickReleaseNoteRefs,
  pullNumbersToFetch,
  type ReleaseNoteRefs
} from "../_shared/desktop-release-notes.ts";

/**
 * Cliente generico do Supabase. Nao usamos `ReturnType<typeof createClient>`
 * porque, sem um tipo `Database` gerado, o retorno concreto tipa as tabelas como
 * `never` e todo `.insert()`/`.update()` deste arquivo vira erro de compilacao —
 * mesmo o payload sendo valido em tempo de execucao. Mesmo motivo do
 * `admin-billing`.
 */
type SupabaseAdminClient = SupabaseClient;

/** Adapta o cliente Supabase ao gateway minimo usado pelos helpers de `_shared/admin-users.ts`. */
function authUsers(supabase: SupabaseAdminClient): AuthUserGateway {
  return {
    async deleteUser(userId) {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      return { error };
    },
    async getUserById(userId) {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      return { user: data?.user ? { id: data.user.id, email: data.user.email } : null, error };
    }
  };
}

/**
 * Apaga as contas do Auth dos perfis atingidos por uma exclusao em cascata (pedreira/unidade).
 * As RPCs `delete_company`/`delete_unit` removem `user_profiles`, mas nao alcancam `auth.users`:
 * sem esta limpeza a conta ficava orfa e o e-mail seguia bloqueado para novos cadastros.
 */
async function deleteAuthUsersForScope(
  supabase: SupabaseAdminClient,
  column: "company_id" | "unit_id",
  value: string
): Promise<void> {
  const { data, error } = await supabase.from("user_profiles").select("id").eq(column, value);
  if (error) throw error;
  const gateway = authUsers(supabase);
  for (const profile of (data ?? []) as Array<{ id: string }>) {
    await deleteAuthUser(gateway, profile.id);
  }
}

type AdminAction =
  | "list"
  | "create_company"
  | "toggle_company"
  | "update_company"
  | "update_company_price_password"
  | "delete_company"
  | "create_unit"
  | "toggle_unit"
  | "update_unit"
  | "delete_unit"
  | "generate_desktop_activation_code"
  | "create_loader"
  | "toggle_loader"
  | "update_loader_unit"
  | "update_loader_password"
  | "delete_loader"
  | "toggle_device"
  | "update_device_name"
  | "update_device_unit"
  | "update_device_channel"
  | "update_device_price_master"
  | "delete_device"
  | "get_ai_settings"
  | "update_ai_settings"
  | "list_desktop_releases"
  | "request_desktop_update"
  | "clear_desktop_update_notice"
  | "get_desktop_release_notes"
  | "promote_desktop_release"
  | "reveal_credentials";

/**
 * Configuracao da IA do assistente da documentacao. E uma linha unica e global:
 * todas as pedreiras usam a mesma conta. Ver a migracao
 * `202608070003_ai_assistant_settings.sql`.
 */
const AI_SETTINGS_ID = true;
const AI_SETTINGS_TABLE = "ai_assistant_settings";
/** Enviado pela UI para dizer "mantenha a chave que ja esta gravada". */
const AI_KEY_UNCHANGED = "********";

/**
 * Chave do cofre de senhas. Fica no secret do Supabase, FORA do banco: um dump
 * de `user_password_vault` sozinho nao abre nada. Sem ela o cofre simplesmente
 * nao funciona — e a tela de credenciais explica como liga-lo.
 */
const CREDENTIAL_KEY_ENV = "KYBERROCK_CREDENTIAL_KEY";

function credentialKey(): string {
  return Deno.env.get(CREDENTIAL_KEY_ENV) ?? "";
}

/**
 * Guarda no cofre a senha que o painel acabou de definir.
 *
 * Best-effort DE PROPOSITO: criar um usuario ou redefinir uma senha nao pode
 * falhar porque o cofre nao esta configurado ou porque a gravacao deu erro. O
 * acesso do usuario e o que importa; a copia para consulta e conveniencia.
 */
async function storePasswordInVault(
  supabase: SupabaseAdminClient,
  userId: string,
  password: string
): Promise<void> {
  const key = credentialKey();
  if (!isCipherConfigured(key) || !password) return;
  try {
    const ciphertext = await encryptCredential(password, key);
    await supabase
      .from("user_password_vault")
      .upsert({ user_id: userId, ciphertext, updated_at: new Date().toISOString() });
  } catch {
    // Cofre indisponivel nao pode derrubar o cadastro.
  }
}

/** Le e decifra a senha guardada. Devolve null quando nao ha, ou quando nao abre. */
async function readPasswordFromVault(
  supabase: SupabaseAdminClient,
  userId: string
): Promise<{ password: string | null; savedAt: string | null }> {
  const key = credentialKey();
  if (!isCipherConfigured(key)) return { password: null, savedAt: null };
  try {
    const { data } = await supabase
      .from("user_password_vault")
      .select("ciphertext, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    const row = data as { ciphertext?: string; updated_at?: string } | null;
    if (!row?.ciphertext) return { password: null, savedAt: null };
    return {
      password: await decryptCredential(row.ciphertext, key),
      savedAt: row.updated_at ?? null
    };
  } catch {
    return { password: null, savedAt: null };
  }
}

/**
 * Aneis de atualizacao do desktop. `beta` recebe as versoes em avaliacao antes da
 * frota; `latest` (padrao) so recebe o que ja foi liberado para producao.
 */
type DesktopUpdateChannel = "latest" | "beta";

function normalizeUpdateChannel(value: unknown): DesktopUpdateChannel {
  return typeof value === "string" && value.trim().toLowerCase() === "beta" ? "beta" : "latest";
}

const DEVICE_LIST_COLUMNS =
  "id, company_id, unit_id, name, color, installation_id, is_active, last_seen_at, created_at, updated_at";

/**
 * Lista as balancas tolerando a coluna `update_channel` ainda nao existir.
 *
 * As Edge Functions sao implantadas pelo CI a cada push, mas as migracoes SQL sao
 * aplicadas a parte. Sem a segunda tentativa, nessa janela o painel inteiro
 * deixaria de carregar (a `list` faz um Promise.all e qualquer erro derruba tudo)
 * por causa de uma coluna cosmetica.
 */
async function selectDevicesForList(supabase: SupabaseAdminClient) {
  // Da mais completa para a mais antiga: cada coluna acrescentada por migracao entra numa
  // tentativa propria, para a lista continuar carregando no projeto que ainda nao a tem.
  const attempts = [
    `${DEVICE_LIST_COLUMNS}, update_channel, is_price_master, app_version, app_version_seen_at, update_notice_version, update_notice_sent_at, update_notice_seen_at`,
    `${DEVICE_LIST_COLUMNS}, update_channel, is_price_master, app_version, app_version_seen_at`,
    `${DEVICE_LIST_COLUMNS}, update_channel, is_price_master`,
    `${DEVICE_LIST_COLUMNS}, update_channel`,
    DEVICE_LIST_COLUMNS
  ];

  let last = await supabase
    .from("device_registrations")
    .select(attempts[0])
    .order("created_at", { ascending: false });
  for (const columns of attempts.slice(1)) {
    if (!last.error) return last;
    last = await supabase
      .from("device_registrations")
      .select(columns)
      .order("created_at", { ascending: false });
  }
  return last;
}

// ---------------------------------------------------------------------------
// Distribuicao do desktop.
//
// O `desktop-release.yml` deixa todo build parado num RASCUNHO de release; o
// `desktop-promote.yml` e quem publica a versao no anel de teste (pre-release)
// ou em producao (estavel). O painel so LE as releases e DISPARA aquele
// workflow — nunca mexe numa release diretamente. Por isso o token de escrita
// precisa apenas de `Actions: write`, e nao de `Contents: write`: quem edita a
// release e o proprio Actions, com o GITHUB_TOKEN do run.
//
// A listagem, porem, tem um requisito proprio: `GET /releases` so devolve
// RASCUNHO para quem tem acesso de escrita no repositorio. Como rascunho e
// exatamente o estado "parado" — a materia-prima da tela — um token so de
// leitura carrega a aba sem nenhuma versao para promover. Por isso listamos
// preferindo o token de administracao (`GH_ACTIONS_TOKEN`, que deve ter
// tambem `Contents: read and write`) e so caimos no de leitura publica se ele
// nao existir.
// ---------------------------------------------------------------------------

const GITHUB_OWNER = Deno.env.get("GH_RELEASES_OWNER") ?? "BrunoPaulinoF";
const GITHUB_REPO = Deno.env.get("GH_RELEASES_REPO") ?? "KyberRock";
/** PAT fine-grained, so este repo, `Contents: read`. Ja existe (desktop-download). */
const GITHUB_READ_TOKEN_ENV = "GH_RELEASES_TOKEN";
/** PAT fine-grained, so este repo, `Actions: write` + `Contents: read and write`. */
const GITHUB_ACTIONS_TOKEN_ENV = "GH_ACTIONS_TOKEN";
const PROMOTE_WORKFLOW_FILE = "desktop-promote.yml";
const RELEASE_WORKFLOW_FILE = "desktop-release.yml";
/**
 * Alvos que o painel pode disparar. `reabilitar` fica so na pagina do Actions:
 * e raro e deliberado.
 *
 * `parar` e o cancelamento do teste: devolve a versao ao rascunho sem condenar
 * a release, ao contrario de `reprovar`, que marca a versao para sempre.
 */
const PANEL_PROMOTE_TARGETS = ["beta", "latest", "reprovar", "parar"] as const;
const PROMOTE_WORKFLOW_REF = "main";

/**
 * `run_number` dos builds de desktop que ainda estao rodando.
 *
 * Serve para a tela dizer "compilando" em vez de "incompleto" enquanto os
 * assets sobem: a versao de um build e `MAJOR.MINOR.<run_number>`, entao o
 * numero do run identifica a versao. Sem isso todo merge pintava a linha de
 * vermelho por alguns minutos, e vermelho tem que querer dizer problema.
 *
 * Best-effort DE PROPOSITO: qualquer falha aqui devolve lista vazia e a tela
 * volta a leitura anterior. Uma consulta cosmetica nao pode derrubar a aba.
 */
async function buildingRunNumbers(token: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${RELEASE_WORKFLOW_FILE}/runs?per_page=10`,
      { headers: githubHeaders(token) }
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { workflow_runs?: unknown };
    const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    const numbers: string[] = [];
    for (const run of runs as Array<Record<string, unknown>>) {
      if (run?.status !== "completed" && typeof run?.run_number === "number") {
        numbers.push(String(run.run_number));
      }
    }
    return numbers;
  } catch {
    return [];
  }
}

/**
 * Tag da release que o GitHub responde HOJE em `GET /releases/latest`.
 *
 * E a unica fonte de verdade sobre qual versao a frota esta recebendo: o
 * `make_latest` de uma promocao nao aparece em campo nenhum da listagem, entao
 * depois de uma volta atras a estavel mais nova da lista NAO e mais a producao.
 * Sem esta consulta a tela apontaria como atual justamente a versao de onde se
 * voltou — e ofereceria os botoes errados em cima disso.
 *
 * Best-effort DE PROPOSITO: falha aqui devolve `null` e a classificacao cai na
 * heuristica antiga (a estavel mais nova), que e certa enquanto nao ha
 * regressao em vigor. Uma consulta a mais nao pode derrubar a aba.
 */
async function currentProductionTag(token: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers: githubHeaders(token) }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { tag_name?: unknown };
    return typeof payload.tag_name === "string" ? payload.tag_name : null;
  } catch {
    return null;
  }
}

/**
 * Commits que entraram numa versao: o intervalo entre a versao anterior e ela.
 *
 * Duas chamadas no pior caso, e so quando alguem abre "O que mudou" numa linha
 * — a aba em si nao gasta nada com isto. O `compare` e a leitura boa (todo
 * merge do intervalo, inclusive os que nao geraram build proprio por causa do
 * filtro de paths do `desktop-release.yml`); o commit avulso e a rede de
 * seguranca da versao mais antiga da janela, que nao tem anterior com que
 * comparar, e ainda assim responde "qual PR gerou este build".
 *
 * Best-effort DE PROPOSITO: qualquer falha degrada para a leitura menor e, no
 * limite, para lista vazia — a tela diz que nao achou, nunca quebra.
 */
async function releaseNoteCommits(token: string, refs: ReleaseNoteRefs): Promise<unknown[]> {
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
  if (refs.base) {
    try {
      const response = await fetch(`${api}/compare/${refs.base}...${refs.head}?per_page=100`, {
        headers: githubHeaders(token)
      });
      if (response.ok) {
        const payload = (await response.json()) as { commits?: unknown };
        if (Array.isArray(payload.commits) && payload.commits.length > 0) return payload.commits;
      }
    } catch {
      // Cai no commit avulso abaixo.
    }
  }

  try {
    const response = await fetch(`${api}/commits/${refs.head}`, { headers: githubHeaders(token) });
    if (!response.ok) return [];
    return [await response.json()];
  } catch {
    return [];
  }
}

/**
 * O texto de cada PR.
 *
 * Exige `Pull requests: read` no PAT, que e uma permissao A MAIS do que a aba
 * precisava ate agora — por isso a falha aqui e silenciosa e nao derruba nada:
 * sem ela a tela continua mostrando QUAIS PRs entraram na versao (isso vem da
 * mensagem do merge commit, que sai com `Contents: read`) e explica o que falta
 * para mostrar o texto.
 */
async function pullRequestDetails(token: string, numbers: readonly number[]): Promise<unknown[]> {
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
  const results = await Promise.all(
    numbers.map(async (number) => {
      try {
        const response = await fetch(`${api}/pulls/${number}`, { headers: githubHeaders(token) });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    })
  );
  return results.filter((result) => result !== null);
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kyberrock-admin"
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const sessionSecret = Deno.env.get("KYBERROCK_ADMIN_SESSION_SECRET") ?? "";
  const sessionToken = req.headers.get("x-admin-session");

  const session = await verifyAdminSession(sessionToken, sessionSecret);
  if (!session) {
    return jsonResponse({ error: "Sessao administrativa invalida" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = (await req.json().catch(() => ({}))) as {
    action?: AdminAction;
    payload?: Record<string, unknown>;
  };
  const payload = body.payload ?? {};

  try {
    if (body.action === "list") {
      const [companies, units, users, devices] = await Promise.all([
        supabase
          .from("companies")
          .select(
            "id, name, legal_name, document, is_active, omie_app_key, omie_app_secret, desktop_activation_code, desktop_activation_code_rotated_at, created_at, updated_at"
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("units")
          .select("id, company_id, name, timezone, is_active, created_at, updated_at")
          .order("created_at", { ascending: false }),
        supabase.from("user_profiles").select("*").order("created_at", { ascending: false }),
        selectDevicesForList(supabase)
      ]);
      if (companies.error) throw companies.error;
      if (units.error) throw units.error;
      if (users.error) throw users.error;
      if (devices.error) throw devices.error;
      const maskedCompanies = (companies.data ?? []).map((c) => ({
        ...c,
        omie_app_key: c.omie_app_key ? maskSecret(c.omie_app_key) : null,
        omie_app_secret: c.omie_app_secret ? "********" : null
      }));
      // Normaliza aqui para a tela nunca precisar decidir o que fazer com uma
      // balanca cujo canal a nuvem ainda nao conhece: ela aparece em producao,
      // que e o padrao correto.
      const normalizedDevices = (devices.data ?? []).map((device) => ({
        ...device,
        update_channel: normalizeUpdateChannel(
          (device as { update_channel?: unknown }).update_channel
        ),
        // Sem a coluna (migracao pendente) nenhuma balanca aparece como principal, que e o
        // estado real: sem principal definida cada uma publica o proprio cadastro de preco.
        is_price_master: (device as { is_price_master?: unknown }).is_price_master === true
      }));
      return jsonResponse({
        companies: maskedCompanies,
        units: units.data,
        users: users.data,
        devices: normalizedDevices
      });
    }

    if (body.action === "create_company") {
      const omieAppKey = payload.omieAppKey ? String(payload.omieAppKey).trim() : null;
      const omieAppSecret = payload.omieAppSecret ? String(payload.omieAppSecret).trim() : null;
      const { data, error } = await supabase
        .from("companies")
        .insert({
          name: String(payload.name ?? ""),
          legal_name: String(payload.legalName ?? payload.legal_name ?? ""),
          document: payload.document ? String(payload.document) : null,
          omie_app_key: omieAppKey && omieAppKey.length > 0 ? omieAppKey : null,
          omie_app_secret: omieAppSecret && omieAppSecret.length > 0 ? omieAppSecret : null,
          is_active: true
        })
        .select("*")
        .single();
      if (error) throw error;
      // Mascara tanto a app key quanto o secret na resposta. O caminho "list" ja mascarava a
      // key (maskSecret), mas o retorno do create devolvia data.omie_app_key cru ao cliente.
      return jsonResponse({
        company: {
          ...data,
          omie_app_key: data.omie_app_key ? maskSecret(data.omie_app_key) : null,
          omie_app_secret: data.omie_app_secret ? "********" : null
        }
      });
    }

    if (body.action === "toggle_company") {
      const { error } = await supabase
        .from("companies")
        .update({
          is_active: Boolean(payload.isActive),
          updated_at: new Date().toISOString()
        })
        .eq("id", String(payload.companyId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "create_unit") {
      const { data, error } = await supabase
        .from("units")
        .insert({
          company_id: String(payload.companyId),
          name: String(payload.name ?? ""),
          timezone: "America/Sao_Paulo",
          is_active: true
        })
        .select("*")
        .single();
      if (error) throw error;
      return jsonResponse({ unit: data });
    }

    if (body.action === "toggle_unit") {
      const { error } = await supabase
        .from("units")
        .update({
          is_active: Boolean(payload.isActive),
          updated_at: new Date().toISOString()
        })
        .eq("id", String(payload.unitId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "generate_desktop_activation_code") {
      const companyId = String(payload.companyId ?? "");
      const code = generateSixDigitCode();
      const codeHash = await sha256Hex(code);
      const rotatedAt = new Date().toISOString();
      const { data, error } = await supabase
        .from("companies")
        .update({
          desktop_activation_code: code,
          desktop_activation_code_hash: codeHash,
          desktop_activation_code_rotated_at: rotatedAt,
          updated_at: rotatedAt
        })
        .eq("id", companyId)
        .select("id, desktop_activation_code, desktop_activation_code_rotated_at")
        .single();
      if (error) throw error;
      return jsonResponse({ code, unit: data });
    }

    if (body.action === "create_loader") {
      const email = String(payload.email ?? "")
        .trim()
        .toLowerCase();
      const password = String(payload.password ?? "");
      const name = String(payload.name ?? "").trim();
      const unitId = String(payload.unitId ?? "");
      // "loader" (carregador, ve fila da unidade) ou "comercial" (extrai
      // relatorios de venda da empresa inteira no loader-web).
      const role = String(payload.role ?? "loader") === "comercial" ? "comercial" : "loader";
      const { data: unit, error: unitError } = await supabase
        .from("units")
        .select("company_id")
        .eq("id", unitId)
        .single();
      if (unitError) throw unitError;
      const created = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });
      let userId = created.data?.user?.id ?? "";
      if (created.error) {
        if (!isEmailAlreadyRegisteredError(created.error)) throw created.error;
        // O e-mail ja existe no Auth. Se ainda houver perfil, e um usuario de verdade e o
        // cadastro deve falhar. Sem perfil, e uma conta orfa deixada por exclusoes antigas de
        // unidade/pedreira: reaproveitamos definindo a senha nova em vez de travar o admin.
        const orphanId = await findAuthUserIdByEmail(async (page) => {
          const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          return { users: data?.users ?? [] };
        }, email);
        if (!orphanId) throw created.error;
        const { data: existingProfile, error: existingError } = await supabase
          .from("user_profiles")
          .select("id")
          .eq("id", orphanId)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existingProfile) {
          return jsonResponse({ error: "Ja existe um usuario com este e-mail." }, 400);
        }
        const recovered = await supabase.auth.admin.updateUserById(orphanId, {
          password,
          email_confirm: true
        });
        if (recovered.error) throw recovered.error;
        userId = orphanId;
      }
      const { error: profileError } = await supabase.from("user_profiles").insert({
        id: userId,
        email,
        name,
        role,
        company_id: unit.company_id,
        unit_id: unitId,
        is_active: true
      });
      if (profileError) throw profileError;
      await storePasswordInVault(supabase, userId, password);
      return jsonResponse({ userId });
    }

    if (body.action === "toggle_loader") {
      const { error } = await supabase
        .from("user_profiles")
        .update({
          is_active: Boolean(payload.isActive),
          updated_at: new Date().toISOString()
        })
        .eq("id", String(payload.userId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    /**
     * Move um carregador/comercial para outra unidade. `company_id` acompanha a unidade
     * escolhida: o carregador enxerga a fila pela unidade e o comercial extrai relatorio pela
     * pedreira, entao deixar os dois campos fora de sincronia esvazia as duas telas.
     */
    if (body.action === "update_loader_unit") {
      const userId = String(payload.userId ?? "");
      const unitId = String(payload.unitId ?? "");
      if (!userId || !unitId)
        return jsonResponse({ error: "Usuario ou unidade nao informado" }, 400);
      const { data: unit, error: unitError } = await supabase
        .from("units")
        .select("id, company_id")
        .eq("id", unitId)
        .single();
      if (unitError) throw unitError;
      const { error } = await supabase
        .from("user_profiles")
        .update({
          unit_id: unit.id,
          company_id: unit.company_id,
          updated_at: new Date().toISOString()
        })
        .eq("id", userId);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    // Define uma nova senha para um usuario ja cadastrado. O Auth guarda apenas o hash, entao
    // nao ha como exibir a senha atual: quando o admin precisa saber a senha de alguem, o
    // caminho e definir uma nova aqui.
    if (body.action === "update_loader_password") {
      const userId = String(payload.userId ?? "");
      const password = String(payload.password ?? "");
      if (!userId) return jsonResponse({ error: "Usuario nao informado" }, 400);
      if (password.length < 6) {
        return jsonResponse({ error: "A senha deve ter ao menos 6 caracteres" }, 400);
      }
      const updated = await supabase.auth.admin.updateUserById(userId, { password });
      if (updated.error) throw updated.error;
      await storePasswordInVault(supabase, userId, password);
      return jsonResponse({ ok: true });
    }

    // Exclui um carregador/comercial de vez. user_profiles.id referencia auth.users com
    // "on delete cascade", entao apagar o usuario do Auth ja remove o perfil; o delete
    // explicito abaixo cobre o caso do perfil orfao (usuario do Auth removido antes).
    if (body.action === "delete_loader") {
      const userId = String(payload.userId ?? "");
      if (!userId) return jsonResponse({ error: "Usuario nao informado" }, 400);
      await deleteAuthUser(authUsers(supabase), userId);
      const { error } = await supabase.from("user_profiles").delete().eq("id", userId);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "toggle_device") {
      const { error } = await supabase
        .from("device_registrations")
        .update({
          is_active: Boolean(payload.isActive),
          updated_at: new Date().toISOString()
        })
        .eq("id", String(payload.deviceId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    /**
     * Apaga o registro de um desktop. Ate aqui so dava para BLOQUEAR: teste,
     * maquina trocada e ativacao duplicada ficavam para sempre na lista, e o
     * numero de computador da pedreira (indice unico por unidade) continuava
     * ocupado por uma balanca que nao existe mais.
     *
     * A balanca em si nao e prejudicada de forma irreversivel: ela perde a
     * ativacao e volta com o codigo da pedreira. As operacoes ja projetadas
     * ficam (`weighing_operations.device_id` e `on delete set null`).
     */
    if (body.action === "delete_device") {
      const deviceId = String(payload.deviceId ?? "");
      if (!deviceId) return jsonResponse({ error: "Dispositivo nao informado" }, 400);
      const { error } = await supabase.from("device_registrations").delete().eq("id", deviceId);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    /**
     * Renomeia um desktop ja ativado.
     *
     * O nome nao vale so para a lista do painel: ele e o rotulo que TODAS as
     * maquinas da pedreira exibem para essa balanca (legenda de cores da tela de
     * Operacoes e o campo "Computador" do detalhe). Cada desktop reescreve o
     * espelho local `devices` com o que vem do `desktop-status`, que ele chama a
     * cada 5 s, entao a troca aparece nas outras maquinas em segundos — sem
     * reativar nada e sem tocar em token, numero de cupom ou unidade.
     */
    if (body.action === "update_device_name") {
      const deviceId = String(payload.deviceId ?? "");
      if (!deviceId) return jsonResponse({ error: "Dispositivo nao informado" }, 400);
      const parsed = parseDeviceName(payload.name);
      if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
      const { error } = await supabase
        .from("device_registrations")
        .update({ name: parsed.name, updated_at: new Date().toISOString() })
        .eq("id", deviceId);
      if (error) throw error;
      return jsonResponse({ ok: true, name: parsed.name });
    }

    // Move um desktop ja ativado para a pedreira certa. A projecao das operacoes
    // segue o registro do dispositivo (desktop-sync), entao a fila do carregador
    // da pedreira escolhida passa a receber as entradas dessa balanca.
    if (body.action === "update_device_unit") {
      const deviceId = String(payload.deviceId ?? "");
      const unitId = String(payload.unitId ?? "");
      const { data: device, error: deviceError } = await supabase
        .from("device_registrations")
        .select("company_id, unit_id")
        .eq("id", deviceId)
        .single();
      if (deviceError) throw deviceError;
      const { data: unit, error: unitError } = await supabase
        .from("units")
        .select("id, company_id")
        .eq("id", unitId)
        .single();
      if (unitError) throw unitError;
      if (unit.company_id !== device.company_id) {
        return jsonResponse({ error: "A pedreira escolhida e de outra empresa" }, 400);
      }
      // O numero do computador e por pedreira: leva-lo para a unidade destino
      // estourava o indice unico (unit_id, device_number) quando la ja existia
      // um computador com o mesmo numero.
      const { error } = await supabase
        .from("device_registrations")
        .update({
          ...deviceUnitAssignment(device.unit_id as string | null, unitId),
          updated_at: new Date().toISOString()
        })
        .eq("id", deviceId);
      if (error) throw error;
      // Renumera na pedreira destino. Best-effort: a troca de pedreira ja esta
      // gravada e o `desktop-status` atribui o numero na proxima validacao.
      const { data: assignedNumber } = await supabase.rpc("assign_device_number", {
        p_device_id: deviceId
      });
      return jsonResponse({
        ok: true,
        deviceNumber: typeof assignedNumber === "number" ? assignedNumber : null
      });
    }

    if (body.action === "update_device_channel") {
      const deviceId = String(payload.deviceId ?? "");
      if (!deviceId) {
        return jsonResponse({ error: "Informe a balanca" }, 400);
      }
      // Entrar no anel de teste tem que ser explicito: qualquer valor que nao
      // seja exatamente `beta` devolve a balanca para producao, em vez de
      // gravar lixo numa coluna que decide o que a maquina do cliente instala.
      const updateChannel = normalizeUpdateChannel(payload.updateChannel);
      const { error } = await supabase
        .from("device_registrations")
        .update({ update_channel: updateChannel, updated_at: new Date().toISOString() })
        .eq("id", deviceId);
      if (error) {
        // Migracao ainda nao aplicada: diz o que fazer em vez de estourar um
        // erro de PostgREST cru na tela.
        if (/update_channel/.test(error.message ?? "")) {
          return jsonResponse(
            {
              error:
                "A coluna update_channel ainda nao existe no banco. Aplique a migracao 202608190001_device_update_channel.sql e tente de novo."
            },
            409
          );
        }
        throw error;
      }
      return jsonResponse({ ok: true, updateChannel });
    }

    /**
     * Marca (ou dispensa) uma balanca principal de precos da pedreira.
     *
     * Preco padrao, preco especial por cliente, tabela de preco e valor de frete do
     * cadastro nascem no SQLite de uma balanca. As principais publicam esse cadastro e as
     * demais espelham o que vem delas — e o que acaba com o preco especial que existe numa
     * balanca e nao na outra. Sem nenhuma principal, cada maquina continua publicando o
     * proprio cadastro (o comportamento anterior a este campo).
     *
     * Cada balanca e marcada por conta propria: marcar uma NAO rebaixa as outras. Mais de
     * uma principal por pedreira e o caso normal (a da portaria e a do escritorio, por
     * exemplo), e entre elas vence quem editou a linha por ultimo — ver
     * `_shared/price-master-conflicts.ts`.
     */
    if (body.action === "update_device_price_master") {
      const deviceId = String(payload.deviceId ?? "");
      if (!deviceId) return jsonResponse({ error: "Informe a balanca" }, 400);
      const isPriceMaster = payload.isPriceMaster === true;

      const { error } = await supabase
        .from("device_registrations")
        .update({ is_price_master: isPriceMaster, updated_at: new Date().toISOString() })
        .eq("id", deviceId);
      if (error) {
        if (/is_price_master/.test(error.message ?? "")) {
          return jsonResponse(
            {
              error:
                "A coluna is_price_master ainda nao existe no banco. Aplique a migracao 202608270001_device_price_master.sql e tente de novo."
            },
            409
          );
        }
        throw error;
      }

      return jsonResponse({ ok: true, isPriceMaster });
    }

    if (body.action === "update_company") {
      const updatePayload: Record<string, unknown> = {
        name: String(payload.name ?? ""),
        legal_name: String(payload.legalName ?? ""),
        document: payload.document ? String(payload.document) : null,
        updated_at: new Date().toISOString()
      };
      if (payload.omieAppKey !== undefined) {
        const key = String(payload.omieAppKey ?? "").trim();
        updatePayload.omie_app_key = key.length > 0 ? key : null;
      }
      if (payload.omieAppSecret !== undefined) {
        const secret = String(payload.omieAppSecret ?? "").trim();
        if (secret.length > 0 && secret !== "********") {
          updatePayload.omie_app_secret = secret;
        } else if (secret.length === 0) {
          updatePayload.omie_app_secret = null;
        }
      }
      const { error } = await supabase
        .from("companies")
        .update(updatePayload)
        .eq("id", String(payload.companyId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "update_company_price_password") {
      const password = String(payload.priceChangePassword ?? "").trim();
      if (!/^\d{4}$/.test(password)) {
        return jsonResponse({ error: "A senha deve ter exatamente 4 digitos numericos" }, 400);
      }
      const { error } = await supabase
        .from("companies")
        .update({
          price_change_password: password,
          updated_at: new Date().toISOString()
        })
        .eq("id", String(payload.companyId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "update_unit") {
      const updatePayload: Record<string, unknown> = {
        name: String(payload.name ?? ""),
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase
        .from("units")
        .update(updatePayload)
        .eq("id", String(payload.unitId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    // Exclusao de empresa/unidade exige apenas a sessao administrativa ja validada no topo
    // (verifyAdminSession) mais a confirmacao na UI. A senha do administrador foi removida a
    // pedido do produto: quem chega aqui ja passou pelo login do admin.
    if (body.action === "delete_company" || body.action === "delete_unit") {
      if (body.action === "delete_company") {
        const companyId = String(payload.companyId ?? "");
        if (!companyId) return jsonResponse({ error: "Pedreira nao informada" }, 400);
        await deleteAuthUsersForScope(supabase, "company_id", companyId);
        const { error } = await supabase.rpc("delete_company", { target_company_id: companyId });
        if (error) throw error;
        return jsonResponse({ ok: true });
      }
      if (body.action === "delete_unit") {
        const unitId = String(payload.unitId ?? "");
        if (!unitId) return jsonResponse({ error: "Unidade nao informada" }, 400);
        await deleteAuthUsersForScope(supabase, "unit_id", unitId);
        const { error } = await supabase.rpc("delete_unit", { target_unit_id: unitId });
        if (error) throw error;
        return jsonResponse({ ok: true });
      }
    }

    /**
     * Credenciais de UM cadastro, sob demanda (o botao de olho do console).
     *
     * Fica fora do `list` de proposito: segredo que viaja em todo carregamento
     * de tela e segredo em cache de navegador, log de proxy e aba aberta a
     * tarde inteira. Aqui ele so sai quando alguem pede, para um registro.
     *
     * O que nao da para mostrar (senha do usuario, token do desktop) volta com
     * `value: null` e o motivo — ver `_shared/admin-credentials.ts`.
     */
    if (body.action === "list_desktop_releases") {
      // Preferencia deliberada pelo token de administracao: e o unico que
      // enxerga rascunho, e rascunho e todo build ainda nao distribuido. Com o
      // token de leitura a aba abre, mas so mostra o que ja foi publicado.
      const token =
        Deno.env.get(GITHUB_ACTIONS_TOKEN_ENV) ?? Deno.env.get(GITHUB_READ_TOKEN_ENV) ?? "";
      if (!token) {
        return jsonResponse(
          {
            error: `Secret ${GITHUB_ACTIONS_TOKEN_ENV} ausente. Cadastre um PAT fine-grained deste repositorio com Actions: write e Contents: read and write.`
          },
          503
        );
      }

      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`,
        { headers: githubHeaders(token) }
      );
      if (!response.ok) {
        return jsonResponse(
          { error: `Falha ao consultar as versoes no GitHub (${response.status}).` },
          502
        );
      }

      // Quantas balancas recebem o que. Sem isso a tela diz "esta em teste" sem
      // dizer em teste ONDE — e uma versao no anel de teste com zero balancas
      // marcadas nunca sera avaliada por ninguem.
      const { data: deviceRows } = await selectDevicesForList(supabase);
      const channelCounts: Record<DesktopUpdateChannel, number> = { latest: 0, beta: 0 };
      for (const row of (deviceRows ?? []) as Array<Record<string, unknown>>) {
        // Balanca bloqueada nao recebe nada, entao nao conta como destinatario.
        if (row.is_active === false) continue;
        channelCounts[normalizeUpdateChannel(row.update_channel)] += 1;
      }

      /**
       * O que cada balanca esta RODANDO — que nao e o que foi liberado.
       *
       * Liberar para producao nao instala nada: a maquina verifica a cada 30
       * min e so troca quando o operador fecha o app. A frota fica dias com
       * duas ou tres versoes ao mesmo tempo, e ate agora essa distancia era
       * invisivel no painel. A versao vem do proprio desktop pelo
       * `desktop-status` (coluna `app_version`); `null` e "ainda nao se
       * reportou", nunca "desatualizada".
       *
       * Os nomes de pedreira sao uma leitura extra e BEST-EFFORT: sem eles o
       * grafico ainda responde a pergunta (versao por balanca), entao uma falha
       * aqui nao pode derrubar a aba que distribui as versoes.
       */
      const unitNames = new Map<string, string>();
      const { data: unitRows } = await supabase.from("units").select("id, name");
      for (const unit of (unitRows ?? []) as Array<Record<string, unknown>>) {
        if (typeof unit.id === "string") unitNames.set(unit.id, String(unit.name ?? ""));
      }

      const devices = ((deviceRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ""),
        name: typeof row.name === "string" && row.name.length > 0 ? row.name : "Sem nome",
        unitName: unitNames.get(String(row.unit_id ?? "")) ?? null,
        version: typeof row.app_version === "string" ? row.app_version : null,
        versionSeenAt: typeof row.app_version_seen_at === "string" ? row.app_version_seen_at : null,
        // Aviso de atualizacao pendente nesta balanca — e se ele ja chegou nela.
        noticeVersion:
          typeof row.update_notice_version === "string" ? row.update_notice_version : null,
        noticeSentAt:
          typeof row.update_notice_sent_at === "string" ? row.update_notice_sent_at : null,
        noticeSeenAt:
          typeof row.update_notice_seen_at === "string" ? row.update_notice_seen_at : null,
        updateChannel: normalizeUpdateChannel(row.update_channel),
        isActive: row.is_active !== false,
        lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : null
      }));

      return jsonResponse({
        releases: summarizeDesktopReleases(await response.json(), {
          buildingRunNumbers: await buildingRunNumbers(token),
          currentProductionTag: await currentProductionTag(token)
        }),
        channelCounts,
        devices,
        canPromote: Boolean(Deno.env.get(GITHUB_ACTIONS_TOKEN_ENV)),
        actionsUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${PROMOTE_WORKFLOW_FILE}`
      });
    }

    /**
     * O que entrou numa versao — o texto dos PRs, sob demanda.
     *
     * Fica FORA do `list_desktop_releases` de proposito: a aba se recarrega
     * sozinha de poucos em poucos segundos enquanto uma promocao esta a
     * caminho, e a API do GitHub tem limite por hora. Cruzar release com PR
     * custa duas a doze chamadas; pagar isso a cada verificacao de fundo, para
     * trinta versoes que ninguem esta lendo, secaria o limite que as promocoes
     * de verdade precisam. Aqui a conta so acontece quando alguem abre uma
     * linha.
     *
     * A regra de leitura vive em `_shared/desktop-release-notes.ts` (puro e
     * testado); este bloco so busca o que ela pede.
     */
    if (body.action === "get_desktop_release_notes") {
      const token =
        Deno.env.get(GITHUB_ACTIONS_TOKEN_ENV) ?? Deno.env.get(GITHUB_READ_TOKEN_ENV) ?? "";
      if (!token) {
        return jsonResponse(
          {
            error: `Secret ${GITHUB_ACTIONS_TOKEN_ENV} ausente. Cadastre um PAT fine-grained deste repositorio com Actions: write e Contents: read and write.`
          },
          503
        );
      }

      const version = String(payload.version ?? "")
        .replace(/^v/, "")
        .trim();
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        return jsonResponse({ error: "Versao invalida." }, 400);
      }

      const listing = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`,
        { headers: githubHeaders(token) }
      );
      if (!listing.ok) {
        return jsonResponse(
          { error: `Falha ao consultar as versoes no GitHub (${listing.status}).` },
          502
        );
      }

      const refs = pickReleaseNoteRefs(await listing.json(), version);
      if (!refs) {
        return jsonResponse(
          {
            error: `Nao foi possivel localizar o commit da versao ${version} no GitHub.`
          },
          404
        );
      }

      const { entries, omitted } = entriesFromCommits(await releaseNoteCommits(token, refs));
      const detailed = applyPullRequests(
        entries,
        await pullRequestDetails(token, pullNumbersToFetch(entries))
      );

      return jsonResponse({
        version,
        tag: refs.tag,
        baseVersion: refs.baseVersion,
        entries: detailed,
        omitted,
        releaseUrl: refs.releaseUrl,
        compareUrl: refs.base
          ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/compare/${refs.base}...${refs.head}`
          : null,
        bodiesUnavailable: bodiesUnavailable(detailed)
      });
    }

    /**
     * Pede a uma ou mais balancas que atualizem para uma versao.
     *
     * Nao instala nada e nao pode instalar: o desktop reinicia para aplicar a
     * atualizacao, e uma balanca pesando caminhao nao pode ser reiniciada pela
     * nuvem. O que isto faz e deixar o recado — o `desktop-status` o entrega no
     * ping que ja existe e o operador ve na tela dele, com o botao de atualizar
     * agora. Quem decide a hora continua sendo quem esta na balanca.
     *
     * Os ids vem da tela de proposito: e ela que ja sabe, pelo grafico da frota,
     * quais balancas estao atras da versao pedida. Aqui so se confere o formato
     * — mandar o recado para quem ja esta na versao seria inofensivo (o proprio
     * `desktop-status` apaga o aviso no primeiro ping), mas apareceria no painel
     * como um aviso pendente que ninguem pediu.
     */
    if (body.action === "request_desktop_update") {
      const version = String(payload.version ?? "")
        .replace(/^v/, "")
        .trim();
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        return jsonResponse({ error: "Versao invalida." }, 400);
      }

      const deviceIds = Array.isArray(payload.deviceIds)
        ? (payload.deviceIds as unknown[]).filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        : [];
      if (deviceIds.length === 0) {
        return jsonResponse({ error: "Nenhuma balanca informada." }, 400);
      }

      const sentAt = new Date().toISOString();
      const { error } = await supabase
        .from("device_registrations")
        .update({
          update_notice_version: version,
          update_notice_sent_at: sentAt,
          // Zerado a cada disparo: a marca responde "esta balanca recebeu ESTE
          // recado", nao "ja recebeu algum um dia".
          update_notice_seen_at: null,
          updated_at: sentAt
        })
        .in("id", deviceIds);
      if (error) {
        if (/update_notice/.test(error.message ?? "")) {
          return jsonResponse(
            {
              error:
                "As colunas de aviso de atualizacao ainda nao existem no banco. Aplique a migracao 202608280003_device_update_notice.sql e tente de novo."
            },
            409
          );
        }
        throw error;
      }

      return jsonResponse({ ok: true, version, notified: deviceIds.length, sentAt });
    }

    /** Cancela o aviso pendente — o recado sai da tela do operador no proximo ping. */
    if (body.action === "clear_desktop_update_notice") {
      const deviceIds = Array.isArray(payload.deviceIds)
        ? (payload.deviceIds as unknown[]).filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        : [];
      if (deviceIds.length === 0) {
        return jsonResponse({ error: "Nenhuma balanca informada." }, 400);
      }

      const { error } = await supabase
        .from("device_registrations")
        .update({
          update_notice_version: null,
          update_notice_sent_at: null,
          update_notice_seen_at: null,
          updated_at: new Date().toISOString()
        })
        .in("id", deviceIds);
      if (error) throw error;

      return jsonResponse({ ok: true, cleared: deviceIds.length });
    }

    if (body.action === "promote_desktop_release") {
      const token = Deno.env.get(GITHUB_ACTIONS_TOKEN_ENV) ?? "";
      if (!token) {
        return jsonResponse(
          {
            error: `Secret ${GITHUB_ACTIONS_TOKEN_ENV} ausente. Cadastre um PAT fine-grained deste repositorio com Actions: write para promover pelo painel.`
          },
          503
        );
      }

      const version = String(payload.version ?? "")
        .replace(/^v/, "")
        .trim();
      const requested = String(payload.target ?? "");
      const target = (PANEL_PROMOTE_TARGETS as readonly string[]).includes(requested)
        ? requested
        : "beta";
      const force = payload.force === true;
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        return jsonResponse({ error: "Versao invalida." }, 400);
      }

      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${PROMOTE_WORKFLOW_FILE}/dispatches`,
        {
          method: "POST",
          headers: { ...githubHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            ref: PROMOTE_WORKFLOW_REF,
            inputs: { version, target, force }
          })
        }
      );
      // O dispatch responde 204 e o resultado so aparece no run. As travas de
      // verdade (nunca testada, versao regressiva, release incompleta) vivem no
      // workflow; a tela apenas evita oferecer o botao que seria recusado.
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return jsonResponse(
          {
            error: `O GitHub recusou o disparo (${response.status}). ${detail.slice(0, 300)}`.trim()
          },
          502
        );
      }

      return jsonResponse({
        ok: true,
        version,
        target,
        runsUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${PROMOTE_WORKFLOW_FILE}`
      });
    }

    if (body.action === "reveal_credentials") {
      const type = String(payload.type ?? "");
      const id = String(payload.id ?? "");
      if (!id) return jsonResponse({ error: "Registro nao informado" }, 400);

      if (type === "company") {
        const { data, error } = await supabase
          .from("companies")
          .select(
            "id, name, legal_name, document, omie_app_key, omie_app_secret, price_change_password, desktop_activation_code, desktop_activation_code_rotated_at"
          )
          .eq("id", id)
          .single();
        if (error) throw error;
        await recordCredentialAccess(supabase, {
          companyId: id,
          entityType: "company",
          entityId: id
        });
        return jsonResponse({ ok: true, bundle: buildCompanyCredentials(data) });
      }

      if (type === "user") {
        const { data, error } = await supabase
          .from("user_profiles")
          .select("id, name, email, role, is_active, company_id")
          .eq("id", id)
          .single();
        if (error) throw error;
        await recordCredentialAccess(supabase, {
          companyId: (data as { company_id?: string }).company_id ?? null,
          entityType: "user",
          entityId: id
        });
        const vault = await readPasswordFromVault(supabase, id);
        return jsonResponse({
          ok: true,
          bundle: buildUserCredentials(data, {
            password: vault.password,
            savedAt: vault.savedAt,
            cipherConfigured: isCipherConfigured(credentialKey())
          })
        });
      }

      if (type === "device") {
        const { data: device, error: deviceError } = await supabase
          .from("device_registrations")
          .select("id, name, company_id, unit_id, is_active, last_seen_at")
          .eq("id", id)
          .single();
        if (deviceError) throw deviceError;
        const { data: company, error: companyError } = await supabase
          .from("companies")
          .select("id, name, desktop_activation_code")
          .eq("id", (device as { company_id: string }).company_id)
          .single();
        if (companyError) throw companyError;
        await recordCredentialAccess(supabase, {
          companyId: (device as { company_id?: string }).company_id ?? null,
          unitId: (device as { unit_id?: string }).unit_id ?? null,
          entityType: "device",
          entityId: id
        });
        return jsonResponse({ ok: true, bundle: buildDeviceCredentials(device, company) });
      }

      return jsonResponse({ error: "Tipo de cadastro invalido" }, 400);
    }

    if (body.action === "get_ai_settings") {
      const { data, error } = await supabase
        .from(AI_SETTINGS_TABLE)
        .select("provider, api_key, model, is_enabled, updated_at")
        .eq("id", AI_SETTINGS_ID)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as {
        provider?: string;
        api_key?: string | null;
        model?: string;
        is_enabled?: boolean;
        updated_at?: string;
      } | null;
      const apiKey = String(row?.api_key ?? "");
      // A chave NUNCA volta para o navegador. O painel so precisa saber se ela
      // existe e reconhecer qual esta gravada — os 4 ultimos caracteres bastam.
      return jsonResponse({
        ok: true,
        settings: {
          provider: row?.provider ?? "openai",
          model: row?.model ?? "",
          isEnabled: row?.is_enabled !== false,
          hasApiKey: apiKey.length > 0,
          apiKeyPreview: apiKey.length >= 4 ? `••••${apiKey.slice(-4)}` : "",
          updatedAt: row?.updated_at ?? null
        }
      });
    }

    if (body.action === "update_ai_settings") {
      const model = String(payload.model ?? "").trim();
      if (!model) {
        return jsonResponse({ error: "Escolha o modelo de IA" }, 400);
      }

      const updatePayload: Record<string, unknown> = {
        id: AI_SETTINGS_ID,
        provider: String(payload.provider ?? "openai").trim() || "openai",
        model,
        is_enabled: payload.isEnabled !== false,
        updated_at: new Date().toISOString()
      };

      // Mesmo contrato do segredo do OMIE: a mascara mantem a chave atual,
      // string vazia apaga, qualquer outra coisa substitui. Sem isso, salvar o
      // modelo sem redigitar a chave apagaria a chave.
      if (payload.apiKey !== undefined) {
        const key = String(payload.apiKey ?? "").trim();
        if (key.length === 0) {
          updatePayload.api_key = null;
        } else if (key !== AI_KEY_UNCHANGED) {
          updatePayload.api_key = key;
        }
      }

      const { error } = await supabase.from(AI_SETTINGS_TABLE).upsert(updatePayload);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 400);
  }
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Erro inesperado");
  }
  return "Erro inesperado";
}

/**
 * Registra QUE alguem abriu as credenciais de um cadastro — nunca o que foi
 * exibido. A trilha existe para responder "quem viu a app key do OMIE na semana
 * passada"; gravar o valor junto transformaria a propria auditoria num segundo
 * lugar de onde o segredo vaza.
 *
 * Best-effort: falha de trilha nao pode derrubar a consulta.
 */
async function recordCredentialAccess(
  supabase: SupabaseAdminClient,
  input: {
    companyId?: string | null;
    unitId?: string | null;
    entityType: string;
    entityId: string;
  }
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      company_id: input.companyId ?? null,
      unit_id: input.unitId ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: "credentials_revealed",
      reason: "Consulta de credenciais pelo painel administrativo"
    });
  } catch {
    // Trilha e diagnostico, nao pre-requisito.
  }
}

function generateSixDigitCode(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0] % 1_000_000).padStart(6, "0");
}

function maskSecret(value: string): string {
  if (!value || value.length < 6) return "********";
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}
