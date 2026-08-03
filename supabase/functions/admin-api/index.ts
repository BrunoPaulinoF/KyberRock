import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

type SupabaseAdminClient = ReturnType<typeof createClient>;

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
  | "update_device_unit";

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

function generateSixDigitCode(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0] % 1_000_000).padStart(6, "0");
}

function maskSecret(value: string): string {
  if (!value || value.length < 6) return "********";
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}
