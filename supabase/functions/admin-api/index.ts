import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyAdminSession } from "../_shared/admin-session.ts";

type AdminAction =
  | "list"
  | "create_company"
  | "toggle_company"
  | "create_unit"
  | "create_loader"
  | "toggle_loader";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const sessionSecret = Deno.env.get("KYBERROCK_ADMIN_SESSION_SECRET") ?? "";
  const session = await verifyAdminSession(req.headers.get("x-admin-session"), sessionSecret);
  if (!session) return jsonResponse({ error: "Sessao administrativa invalida" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => ({})) as { action?: AdminAction; payload?: Record<string, unknown> };
  const payload = body.payload ?? {};

  try {
    if (body.action === "list") {
      const [companies, units, users] = await Promise.all([
        supabase.from("companies").select("*").order("created_at", { ascending: false }),
        supabase.from("units").select("*").order("created_at", { ascending: false }),
        supabase.from("user_profiles").select("*").order("created_at", { ascending: false })
      ]);
      if (companies.error) throw companies.error;
      if (units.error) throw units.error;
      if (users.error) throw users.error;
      return jsonResponse({ companies: companies.data, units: units.data, users: users.data });
    }

    if (body.action === "create_company") {
      const { data, error } = await supabase.from("companies").insert({
        name: String(payload.name ?? ""),
        legal_name: String(payload.legalName ?? payload.legal_name ?? ""),
        document: payload.document ? String(payload.document) : null,
        is_active: true
      }).select("*").single();
      if (error) throw error;
      return jsonResponse({ company: data });
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
      const { data, error } = await supabase.from("units").insert({
        company_id: String(payload.companyId),
        name: String(payload.name ?? ""),
        timezone: "America/Sao_Paulo",
        is_active: true
      }).select("*").single();
      if (error) throw error;
      return jsonResponse({ unit: data });
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

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Erro inesperado" }, 400);
  }
});
