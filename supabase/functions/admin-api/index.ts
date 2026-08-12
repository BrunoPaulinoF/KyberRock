import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyAdminSession } from "../_shared/admin-session.ts";
import { deviceUnitAssignment } from "../_shared/device-unit.ts";
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
  | "update_device_unit"
  | "delete_device"
  | "get_ai_settings"
  | "update_ai_settings"
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
        supabase
          .from("device_registrations")
          .select(
            "id, company_id, unit_id, name, color, installation_id, is_active, last_seen_at, created_at, updated_at"
          )
          .order("created_at", { ascending: false })
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
      return jsonResponse({
        companies: maskedCompanies,
        units: units.data,
        users: users.data,
        devices: devices.data
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
