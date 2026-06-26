import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyAdminSession } from "../_shared/admin-session.ts";
import { safeEqual, sha256Hex } from "../_shared/crypto.ts";

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
  | "toggle_device";

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
  const body = await req.json().catch(() => ({})) as { action?: AdminAction; payload?: Record<string, unknown> };
  const payload = body.payload ?? {};

  try {
    if (body.action === "list") {
      const [companies, units, users, devices] = await Promise.all([
        supabase
          .from("companies")
          .select("id, name, legal_name, document, is_active, omie_app_key, omie_app_secret, created_at, updated_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("units")
          .select("id, company_id, name, timezone, is_active, desktop_activation_code, desktop_activation_code_rotated_at, desktop_publishable_key, created_at, updated_at")
          .order("created_at", { ascending: false }),
        supabase.from("user_profiles").select("*").order("created_at", { ascending: false }),
        supabase
          .from("device_registrations")
          .select("id, company_id, unit_id, name, is_active, last_seen_at, created_at, updated_at")
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
      return jsonResponse({ companies: maskedCompanies, units: units.data, users: users.data, devices: devices.data });
    }

    if (body.action === "create_company") {
      const omieAppKey = payload.omieAppKey ? String(payload.omieAppKey).trim() : null;
      const omieAppSecret = payload.omieAppSecret ? String(payload.omieAppSecret).trim() : null;
      const { data, error } = await supabase.from("companies").insert({
        name: String(payload.name ?? ""),
        legal_name: String(payload.legalName ?? payload.legal_name ?? ""),
        document: payload.document ? String(payload.document) : null,
        omie_app_key: omieAppKey && omieAppKey.length > 0 ? omieAppKey : null,
        omie_app_secret: omieAppSecret && omieAppSecret.length > 0 ? omieAppSecret : null,
        is_active: true
      }).select("*").single();
      if (error) throw error;
      return jsonResponse({ company: { ...data, omie_app_secret: data.omie_app_secret ? "********" : null } });
    }

    if (body.action === "toggle_company") {
      const { error } = await supabase.from("companies").update({
        is_active: Boolean(payload.isActive),
        updated_at: new Date().toISOString()
      }).eq("id", String(payload.companyId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "create_unit") {
      const publishableKey = String(payload.desktopPublishableKey ?? "").trim();
      const { data, error } = await supabase.from("units").insert({
        company_id: String(payload.companyId),
        name: String(payload.name ?? ""),
        timezone: "America/Sao_Paulo",
        is_active: true,
        desktop_publishable_key: publishableKey.length > 0 ? publishableKey : null
      }).select("*").single();
      if (error) throw error;
      return jsonResponse({ unit: data });
    }

    if (body.action === "toggle_unit") {
      const { error } = await supabase.from("units").update({
        is_active: Boolean(payload.isActive),
        updated_at: new Date().toISOString()
      }).eq("id", String(payload.unitId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "generate_desktop_activation_code") {
      const unitId = String(payload.unitId ?? "");
      const code = generateSixDigitCode();
      const codeHash = await sha256Hex(code);
      const rotatedAt = new Date().toISOString();
      const { data, error } = await supabase.from("units").update({
        desktop_activation_code: code,
        desktop_activation_code_hash: codeHash,
        desktop_activation_code_rotated_at: rotatedAt,
        updated_at: rotatedAt
      }).eq("id", unitId).select("id, desktop_activation_code, desktop_activation_code_rotated_at").single();
      if (error) throw error;
      return jsonResponse({ code, unit: data });
    }

    if (body.action === "create_loader") {
      const email = String(payload.email ?? "").trim().toLowerCase();
      const password = String(payload.password ?? "");
      const name = String(payload.name ?? "").trim();
      const unitId = String(payload.unitId ?? "");
      const { data: unit, error: unitError } = await supabase.from("units").select("company_id").eq("id", unitId).single();
      if (unitError) throw unitError;
      const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      const { error: profileError } = await supabase.from("user_profiles").insert({
        id: created.data.user.id,
        email,
        name,
        role: "loader",
        company_id: unit.company_id,
        unit_id: unitId,
        is_active: true
      });
      if (profileError) throw profileError;
      return jsonResponse({ userId: created.data.user.id });
    }

    if (body.action === "toggle_loader") {
      const { error } = await supabase.from("user_profiles").update({
        is_active: Boolean(payload.isActive),
        updated_at: new Date().toISOString()
      }).eq("id", String(payload.userId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "toggle_device") {
      const { error } = await supabase.from("device_registrations").update({
        is_active: Boolean(payload.isActive),
        updated_at: new Date().toISOString()
      }).eq("id", String(payload.deviceId));
      if (error) throw error;
      return jsonResponse({ ok: true });
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
      const { error } = await supabase.from("companies").update(updatePayload).eq("id", String(payload.companyId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "update_company_price_password") {
      const password = String(payload.priceChangePassword ?? "").trim();
      if (!/^\d{4}$/.test(password)) {
        return jsonResponse({ error: "A senha deve ter exatamente 4 digitos numericos" }, 400);
      }
      const { error } = await supabase.from("companies").update({
        price_change_password: password,
        updated_at: new Date().toISOString()
      }).eq("id", String(payload.companyId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "update_unit") {
      const updatePayload: Record<string, unknown> = {
        name: String(payload.name ?? ""),
        updated_at: new Date().toISOString()
      };
      if (payload.desktopPublishableKey !== undefined) {
        const key = String(payload.desktopPublishableKey ?? "").trim();
        updatePayload.desktop_publishable_key = key.length > 0 ? key : null;
      }
      const { error } = await supabase.from("units").update(updatePayload).eq("id", String(payload.unitId));
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "delete_company" || body.action === "delete_unit") {
      const password = String(payload.adminPassword ?? "");
      if (!await verifyAdminPassword(password)) {
        return jsonResponse({ error: "Senha do administrador incorreta" }, 403);
      }
      if (body.action === "delete_company") {
        const companyId = String(payload.companyId ?? "");
        const { error } = await supabase.rpc("delete_company", { target_company_id: companyId });
        if (error) throw error;
        return jsonResponse({ ok: true });
      }
      if (body.action === "delete_unit") {
        const unitId = String(payload.unitId ?? "");
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

async function verifyAdminPassword(password: string): Promise<boolean> {
  const passwordHash = Deno.env.get("KYBERROCK_ADMIN_PASSWORD_HASH") ?? "";
  const passwordSalt = Deno.env.get("KYBERROCK_ADMIN_PASSWORD_SALT") ?? "";
  if (!passwordHash || !passwordSalt) return false;
  const attemptedHash = await sha256Hex(`${passwordSalt}${password}`);
  return safeEqual(attemptedHash, passwordHash);
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
