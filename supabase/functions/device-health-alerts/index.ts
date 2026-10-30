// Passada do alerta de balanca por WhatsApp.
//
// Quem chama e o pg_cron (migracao 202610300003, de 10 em 10 minutos) com o segredo
// compartilhado no header `x-cron-secret`, como o `billing-run`. A regra de quando avisar
// vive em `_shared/device-alerts.ts`; aqui so se le a frota, grava os alertas e envia.
//
// Idempotente: o alerta e gravado ANTES do envio e so ganha `notified_at` depois que ao menos
// um destinatario recebeu. WhatsApp fora do ar nao perde o aviso — ele sai na passada seguinte —
// e uma passada repetida nao manda a mesma mensagem duas vezes.
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  buildDeviceAlertMessage,
  deviceAlertLabel,
  planDeviceAlerts,
  recipientsForCompany,
  type DeviceAlertInput,
  type DeviceAlertKind,
  type DeviceAlertLine,
  type DeviceAlertRecipient
} from "../_shared/device-alerts.ts";
import {
  resolveAlertWhatsappConfig,
  sendAlertWhatsappText
} from "../_shared/device-alert-whatsapp.ts";
import { isWebDeviceId } from "../_shared/web-device.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

/** Alerta resolvido fica para consulta no painel por este tempo, depois sai. */
const RESOLVED_RETENTION_DAYS = 90;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface DeviceRow {
  id: string;
  company_id: string;
  unit_id: string | null;
  name: string | null;
  device_number: number | null;
  is_active: boolean;
  last_seen_at: string | null;
  health_queue_pending: number | null;
  health_queue_blocked: number | null;
  health_oldest_pending_at: string | null;
  health_last_error: string | null;
}

interface AlertRow {
  id: string;
  device_id: string;
  company_id: string;
  kind: DeviceAlertKind;
  detail: string | null;
  notified_at: string | null;
  resolved_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes." }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Mesma validacao do billing-run: env primeiro, Vault depois.
  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  const envSecret = Deno.env.get("CRON_SHARED_SECRET") ?? "";
  let authorized = Boolean(envSecret) && providedSecret === envSecret;
  let vaultSecretAvailable = false;
  if (!authorized && providedSecret) {
    const { data } = await supabase.rpc("get_cron_secret");
    vaultSecretAvailable = typeof data === "string" && data.length > 0;
    authorized = vaultSecretAvailable && providedSecret === data;
  }
  if (!authorized) {
    if (!envSecret && !vaultSecretAvailable && providedSecret) {
      return jsonResponse(
        {
          error:
            "Segredo do cron nao configurado. Aplique a migracao do Vault ou defina CRON_SHARED_SECRET."
        },
        500
      );
    }
    return jsonResponse({ error: "Acesso negado." }, 401);
  }

  try {
    return jsonResponse({ ok: true, summary: await runDeviceAlerts(supabase, new Date()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na passada de alertas.";
    console.error("device-health-alerts:", message);
    return jsonResponse({ error: message }, 500);
  }
});

type ServiceClient = ReturnType<typeof createClient>;

async function runDeviceAlerts(supabase: ServiceClient, now: Date) {
  const [devicesResult, companiesResult, unitsResult, openResult] = await Promise.all([
    supabase
      .from("device_registrations")
      .select(
        "id, company_id, unit_id, name, device_number, is_active, last_seen_at, health_queue_pending, health_queue_blocked, health_oldest_pending_at, health_last_error"
      ),
    supabase.from("companies").select("id, name, is_active"),
    supabase.from("units").select("id, name"),
    supabase
      .from("device_alerts")
      .select("id, device_id, company_id, kind, detail, notified_at, resolved_at")
      .is("resolved_at", null)
  ]);
  // Sem a frota ou sem os alertas abertos a passada decidiria no escuro: aborta e tenta de novo
  // em 10 minutos, em vez de resolver tudo (ou abrir tudo) por causa de uma leitura que falhou.
  for (const result of [devicesResult, companiesResult, unitsResult, openResult]) {
    if (result.error) throw result.error;
  }

  const companies = new Map(
    ((companiesResult.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>).map(
      (company) => [company.id, company]
    )
  );
  const unitNames = new Map(
    ((unitsResult.data ?? []) as Array<{ id: string; name: string }>).map((unit) => [
      unit.id,
      unit.name
    ])
  );
  // O "dispositivo" do site (`web-<empresa>`) nao e balanca e nunca manda ping.
  const devices = ((devicesResult.data ?? []) as DeviceRow[]).filter(
    (device) => !isWebDeviceId(device.id)
  );
  const labels = new Map(
    devices.map((device) => [
      device.id,
      deviceAlertLabel({
        deviceName: device.name,
        deviceNumber: device.device_number,
        unitName: device.unit_id ? (unitNames.get(device.unit_id) ?? null) : null
      })
    ])
  );
  const inputs: DeviceAlertInput[] = devices.map((device) => ({
    deviceId: device.id,
    companyId: device.company_id,
    isActive: device.is_active && companies.get(device.company_id)?.is_active !== false,
    lastSeenAt: device.last_seen_at,
    queuePending: device.health_queue_pending,
    queueBlocked: device.health_queue_blocked,
    oldestPendingAt: device.health_oldest_pending_at,
    lastError: device.health_last_error
  }));
  const openAlerts = (openResult.data ?? []) as AlertRow[];

  const plan = planDeviceAlerts({
    devices: inputs,
    openAlerts: openAlerts.map((alert) => ({
      id: alert.id,
      deviceId: alert.device_id,
      kind: alert.kind,
      notifiedAt: alert.notified_at
    })),
    now
  });

  const nowIso = now.toISOString();
  let opened = 0;
  for (const alert of plan.open) {
    const { error } = await supabase.from("device_alerts").insert({
      device_id: alert.deviceId,
      company_id: alert.companyId,
      kind: alert.kind,
      detail: alert.detail,
      opened_at: nowIso
    });
    // 23505: outra passada abriu o mesmo alerta ao mesmo tempo — o indice unico ja resolveu.
    if (error && error.code !== "23505") throw error;
    if (!error) opened += 1;
  }
  if (plan.resolve.length > 0) {
    const { error } = await supabase
      .from("device_alerts")
      .update({ resolved_at: nowIso })
      .in(
        "id",
        plan.resolve.map((alert) => alert.id)
      )
      .is("resolved_at", null);
    if (error) throw error;
  }

  // O que falta avisar: abertos ainda sem aviso, e resolvidos que tinham sido avisados.
  // Resolvido que nunca foi avisado (abriu e fechou antes de qualquer envio) sai em silencio.
  const [pendingOpenResult, pendingResolvedResult] = await Promise.all([
    supabase
      .from("device_alerts")
      .select("id, device_id, company_id, kind, detail, notified_at, resolved_at")
      .is("resolved_at", null)
      .is("notified_at", null),
    supabase
      .from("device_alerts")
      .select("id, device_id, company_id, kind, detail, notified_at, resolved_at")
      .not("resolved_at", "is", null)
      .is("resolved_notified_at", null)
  ]);
  if (pendingOpenResult.error) throw pendingOpenResult.error;
  if (pendingResolvedResult.error) throw pendingResolvedResult.error;

  const pendingOpen = (pendingOpenResult.data ?? []) as AlertRow[];
  const silentlyResolved = ((pendingResolvedResult.data ?? []) as AlertRow[]).filter(
    (alert) => !alert.notified_at
  );
  const pendingResolved = ((pendingResolvedResult.data ?? []) as AlertRow[]).filter(
    (alert) => alert.notified_at
  );
  if (silentlyResolved.length > 0) {
    await supabase
      .from("device_alerts")
      .update({ resolved_notified_at: nowIso })
      .in(
        "id",
        silentlyResolved.map((alert) => alert.id)
      );
  }

  const summary = {
    devices: devices.length,
    opened,
    resolved: plan.resolve.length,
    messagesSent: 0,
    pendingNotifications: pendingOpen.length + pendingResolved.length,
    warning: null as string | null
  };
  if (summary.pendingNotifications === 0) {
    await pruneResolvedAlerts(supabase, now);
    return summary;
  }

  const config = resolveAlertWhatsappConfig(await readWhatsappUrl(supabase));
  if (!config) {
    summary.warning =
      "WhatsApp da plataforma nao configurado (billing_settings.whatsapp_url e UAZAPI_INSTANCE_TOKEN): os alertas ficam guardados e saem quando ele estiver configurado.";
    return summary;
  }

  const { data: recipientRows, error: recipientsError } = await supabase
    .from("device_alert_recipients")
    .select("company_id, whatsapp_phone, is_active");
  if (recipientsError) throw recipientsError;
  const recipients = (
    (recipientRows ?? []) as Array<{
      company_id: string | null;
      whatsapp_phone: string;
      is_active: boolean;
    }>
  ).map<DeviceAlertRecipient>((row) => ({
    companyId: row.company_id,
    whatsappPhone: row.whatsapp_phone,
    isActive: row.is_active
  }));

  const companyIds = new Set([
    ...pendingOpen.map((alert) => alert.company_id),
    ...pendingResolved.map((alert) => alert.company_id)
  ]);
  for (const companyId of companyIds) {
    const openedHere = pendingOpen.filter((alert) => alert.company_id === companyId);
    const resolvedHere = pendingResolved.filter((alert) => alert.company_id === companyId);
    const toLine = (alert: AlertRow): DeviceAlertLine => ({
      deviceLabel: labels.get(alert.device_id) ?? "Balança",
      kind: alert.kind,
      detail: alert.detail
    });
    const text = buildDeviceAlertMessage({
      companyName: companies.get(companyId)?.name ?? "Pedreira",
      opened: openedHere.map(toLine),
      resolved: resolvedHere.map(toLine)
    });

    const phones = recipientsForCompany(recipients, companyId);
    let delivered = phones.length === 0;
    let lastError: string | null = phones.length === 0 ? "Nenhum destinatario cadastrado." : null;
    for (const phone of phones) {
      try {
        await sendAlertWhatsappText(config, {
          to: phone,
          text,
          trackId: `device-alert:${companyId}:${nowIso}`
        });
        delivered = true;
        summary.messagesSent += 1;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Falha no envio pelo WhatsApp.";
      }
    }

    if (delivered) {
      if (openedHere.length > 0) {
        await supabase
          .from("device_alerts")
          .update({ notified_at: nowIso, last_error: lastError })
          .in(
            "id",
            openedHere.map((alert) => alert.id)
          );
      }
      if (resolvedHere.length > 0) {
        await supabase
          .from("device_alerts")
          .update({ resolved_notified_at: nowIso, last_error: lastError })
          .in(
            "id",
            resolvedHere.map((alert) => alert.id)
          );
      }
    } else {
      // Ninguem recebeu: fica para a proxima passada, com o motivo para o painel mostrar.
      await supabase
        .from("device_alerts")
        .update({ last_error: lastError })
        .in(
          "id",
          [...openedHere, ...resolvedHere].map((alert) => alert.id)
        );
    }
  }

  await pruneResolvedAlerts(supabase, now);
  return summary;
}

/** Endereco da instancia global, gravado no financeiro do painel. */
async function readWhatsappUrl(supabase: ServiceClient): Promise<string | null> {
  const { data } = await supabase
    .from("billing_settings")
    .select("whatsapp_url")
    .eq("id", true)
    .maybeSingle();
  return (data as { whatsapp_url?: string | null } | null)?.whatsapp_url ?? null;
}

/** Best-effort: limpeza atrasada nao pode derrubar o aviso. */
async function pruneResolvedAlerts(supabase: ServiceClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - RESOLVED_RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await supabase.from("device_alerts").delete().lt("resolved_at", cutoff);
  } catch {
    // Diagnostico, nao pre-requisito.
  }
}
