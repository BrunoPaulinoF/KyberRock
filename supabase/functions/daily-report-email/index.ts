import { createClient } from "jsr:@supabase/supabase-js@2";
// Mesma lib de SMTP usada no desktop (sendTestEmail); o bundler das Edge
// Functions so resolve especificadores jsr:/npm:, entao nada de deno.land aqui.
import nodemailer from "npm:nodemailer@9.0.1";
import {
  localNow,
  reportPeriod,
  shouldSendAt,
  type ReportPeriod
} from "../_shared/report-schedule.ts";
import {
  buildTruckReport,
  renderTruckReportHtml,
  renderTruckReportWhatsapp,
  type TruckReport,
  type TruckReportRow
} from "./truck-report.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

type ReportType = "sales" | "trucks" | "both";

// Operacoes fechadas localmente contam no relatorio mesmo depois de avancarem no
// ciclo de sync (o status do cloud espelha o status local no momento do push).
const CLOSED_STATUSES = ["closed_local", "pending_omie", "synced"];

interface Recipient {
  email: string | null;
  whatsappPhone: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  scheduleFrequency: string;
  scheduleTime: string;
  reportTypes: ReportType;
  displayName: string | null;
}

interface DispatchResult {
  companyId: string;
  unitId: string;
  date: string;
  recipients: number;
  status: "sent" | "partial" | "failed" | "skipped";
  reason?: string;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const smtpHost = Deno.env.get("SMTP_HOST") ?? "";
  const smtpUser = Deno.env.get("SMTP_USER") ?? "";
  const smtpPassword = Deno.env.get("SMTP_PASSWORD") ?? "";
  const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "587");
  const senderEmail = Deno.env.get("DAILY_REPORT_SENDER") ?? smtpUser;
  const uazapiInstanceToken = Deno.env.get("UAZAPI_INSTANCE_TOKEN") ?? "";
  const uazapiWhatsappUrl = Deno.env.get("UAZAPI_WHATSAPP_URL") ?? "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Somente chamadas server-side: o scheduler (que encaminha o segredo do cron) ou
  // um chamador com a service role key. Deployada com verify_jwt=false e auth
  // propria (como desktop-download); o JWT anon do loader-web nao dispara envios.
  if (!(await isAuthorized(req, supabase, serviceRoleKey))) {
    return jsonResponse({ error: "Acesso negado." }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    companyId?: string;
    unitId?: string;
    force?: boolean;
  };
  const now = localNow(new Date());
  const targetDate = body.date ?? now.date;
  const force = body.force === true;

  const companyFilter = body.companyId
    ? supabase.from("companies").select("id, name").eq("id", body.companyId)
    : supabase.from("companies").select("id, name").eq("is_active", true);
  const { data: companies, error: companiesError } = await companyFilter;
  if (companiesError) {
    return jsonResponse({ error: companiesError.message }, 500);
  }

  const results: DispatchResult[] = [];

  for (const company of companies ?? []) {
    // Configuracao de canais cadastrada pelo desktop (tela de Relatorios);
    // os envs SMTP_*/UAZAPI_* do projeto ficam como fallback.
    const { data: channelSettings } = await supabase
      .from("report_channel_settings")
      .select(
        "smtp_host, smtp_port, smtp_user, smtp_password, smtp_sender, whatsapp_url, whatsapp_instance_token"
      )
      .eq("company_id", company.id)
      .maybeSingle();
    const companySmtpHost = (channelSettings?.smtp_host as string | null) || smtpHost;
    const companySmtpPort = Number(channelSettings?.smtp_port ?? 0) || smtpPort;
    const companySmtpUser = (channelSettings?.smtp_user as string | null) || smtpUser;
    const companySmtpPassword = (channelSettings?.smtp_password as string | null) || smtpPassword;
    const companySenderEmail =
      (channelSettings?.smtp_sender as string | null) || senderEmail || companySmtpUser;
    const companyUazapiUrl = (channelSettings?.whatsapp_url as string | null) || uazapiWhatsappUrl;
    const companyUazapiToken =
      (channelSettings?.whatsapp_instance_token as string | null) || uazapiInstanceToken;

    const unitFilter = body.unitId
      ? supabase.from("units").select("id, name").eq("id", body.unitId).eq("company_id", company.id)
      : supabase
          .from("units")
          .select("id, name")
          .eq("company_id", company.id)
          .eq("is_active", true);
    const { data: units, error: unitsError } = await unitFilter;
    if (unitsError) {
      results.push({
        companyId: company.id,
        unitId: body.unitId ?? "",
        date: targetDate,
        recipients: 0,
        status: "failed",
        error: unitsError.message
      });
      continue;
    }

    for (const unit of units ?? []) {
      const result = await dispatchForUnit({
        supabase,
        company,
        unit,
        targetDate,
        nowHour: now.hour,
        force,
        senderEmail: companySenderEmail,
        smtpHost: companySmtpHost,
        smtpPort: companySmtpPort,
        smtpUser: companySmtpUser,
        smtpPassword: companySmtpPassword,
        uazapiInstanceToken: companyUazapiToken,
        uazapiWhatsappUrl: companyUazapiUrl
      });
      results.push(result);
    }
  }

  return jsonResponse({ results });
});

async function isAuthorized(
  req: Request,
  supabase: ReturnType<typeof createClient>,
  serviceRoleKey: string
): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) return true;

  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  if (!providedSecret) return false;
  const envSecret = Deno.env.get("CRON_SHARED_SECRET") ?? "";
  if (envSecret && providedSecret === envSecret) return true;

  const { data } = await supabase.rpc("get_cron_secret");
  return typeof data === "string" && data.length > 0 && providedSecret === data;
}

interface UnitContent {
  period: ReportPeriod;
  salesHtml: string | null;
  salesWhatsapp: string | null;
  truckHtml: string | null;
  truckWhatsapp: string | null;
}

async function dispatchForUnit(params: {
  supabase: ReturnType<typeof createClient>;
  company: { id: string; name: string };
  unit: { id: string; name: string };
  targetDate: string;
  nowHour: number;
  force: boolean;
  senderEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  uazapiInstanceToken: string;
  uazapiWhatsappUrl: string;
}): Promise<DispatchResult> {
  const { supabase, company, unit, targetDate, nowHour, force, senderEmail } = params;

  const { data: recipientRows, error: recipientsError } = await supabase
    .from("report_recipients")
    .select(
      "email, whatsapp_phone, send_email, send_whatsapp, schedule_frequency, schedule_time, report_types, display_name"
    )
    .eq("company_id", company.id)
    .eq("is_active", true);

  if (recipientsError) {
    return recordFailure(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      scheduleHour: nowHour,
      error: recipientsError.message
    });
  }

  const recipients: Recipient[] = (recipientRows ?? []).map((row) => {
    const reportTypes: ReportType =
      row.report_types === "trucks" || row.report_types === "both"
        ? (row.report_types as ReportType)
        : "sales";
    return {
      email: (row.email as string | null) ?? null,
      whatsappPhone: (row.whatsapp_phone as string | null) ?? null,
      sendEmail: row.send_email !== false,
      sendWhatsapp: row.send_whatsapp === true,
      scheduleFrequency: (row.schedule_frequency as string | null) ?? "daily",
      scheduleTime: (row.schedule_time as string | null) ?? "20:00",
      reportTypes,
      displayName: (row.display_name as string | null) ?? null
    };
  });

  if (recipients.length === 0) {
    return recordFailure(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      scheduleHour: nowHour,
      error: "Sem destinatarios ativos"
    });
  }

  // O cron roda toda hora; so envia para quem configurou ESTA hora (e, para
  // semanais/mensais, o dia certo). Sem ninguem agendado agora, nao registra nada.
  const due = force
    ? recipients
    : recipients.filter((recipient) =>
        shouldSendAt({
          frequency: recipient.scheduleFrequency,
          scheduleTime: recipient.scheduleTime,
          nowDate: targetDate,
          nowHour
        })
      );
  if (due.length === 0) {
    return {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      recipients: 0,
      status: "skipped",
      reason: "Nenhum destinatario agendado para esta hora"
    };
  }

  // Deduplicacao: um retry do cron (ou chamada dupla) na mesma hora nao reenvia.
  if (!force) {
    const { data: existing } = await supabase
      .from("daily_report_dispatches")
      .select("id")
      .eq("company_id", company.id)
      .eq("unit_id", unit.id)
      .eq("report_date", targetDate)
      .eq("schedule_hour", nowHour)
      .in("status", ["sent", "partial"])
      .limit(1);
    if (existing && existing.length > 0) {
      return {
        companyId: company.id,
        unitId: unit.id,
        date: targetDate,
        recipients: 0,
        status: "skipped",
        reason: "Ja despachado nesta hora"
      };
    }
  }

  // Conteudo por frequencia (o periodo semanal/mensal difere do diario), montado
  // sob demanda e reaproveitado entre destinatarios da mesma frequencia.
  const contentCache = new Map<string, UnitContent>();
  const contentFor = async (frequency: string): Promise<UnitContent> => {
    const key = frequency === "weekly" || frequency === "monthly" ? frequency : "daily";
    const cached = contentCache.get(key);
    if (cached) return cached;
    const period = reportPeriod(key, targetDate);
    const summary = await buildSalesSummary(supabase, company.id, unit.id, period);
    const truckReport = await buildTruckSummary(supabase, company.id, unit.id, period);
    const hasTrucks = truckReport.totalOperations > 0;
    const content: UnitContent = {
      period,
      salesHtml: summary
        ? renderEmailHtml({
            companyName: company.name,
            unitName: unit.name,
            title: `Fechamento ${period.frequencyLabel} ${period.label}`,
            summary
          })
        : null,
      salesWhatsapp: summary
        ? renderWhatsappText({
            companyName: company.name,
            unitName: unit.name,
            title: `Fechamento ${period.frequencyLabel} ${period.label}`,
            summary
          })
        : null,
      truckHtml: hasTrucks
        ? renderTruckReportHtml({
            companyName: company.name,
            unitName: unit.name,
            date: period.label,
            report: truckReport
          })
        : null,
      truckWhatsapp: hasTrucks
        ? renderTruckReportWhatsapp({ date: period.label, report: truckReport })
        : null
    };
    contentCache.set(key, content);
    return content;
  };

  let dispatched = 0;
  let targets = 0;
  const errors: string[] = [];

  for (const recipient of due) {
    const content = await contentFor(recipient.scheduleFrequency);
    const wantsSales = recipient.reportTypes === "sales" || recipient.reportTypes === "both";
    const wantsTrucks = recipient.reportTypes === "trucks" || recipient.reportTypes === "both";
    const emailHtml =
      [wantsSales ? content.salesHtml : null, wantsTrucks ? content.truckHtml : null]
        .filter((part): part is string => Boolean(part))
        .join('<hr style="margin:28px 0;border:none;border-top:1px solid #cbd5e1" />') || null;
    const whatsappBody =
      [wantsSales ? content.salesWhatsapp : null, wantsTrucks ? content.truckWhatsapp : null]
        .filter((part): part is string => Boolean(part))
        .join("\n\n") || null;
    const subject = wantsSales
      ? `Fechamento ${content.period.frequencyLabel} ${content.period.label} - ${company.name} (${unit.name})`
      : `Controle de caminhoes ${content.period.label} - ${company.name} (${unit.name})`;

    if (recipient.sendEmail && recipient.email) {
      targets += 1;
      if (!emailHtml) {
        errors.push(`email ${recipient.email}: sem dados no periodo (${content.period.label})`);
      } else {
        try {
          if (!params.smtpHost || !params.smtpUser || !params.smtpPassword || !senderEmail) {
            throw new Error(
              "Provedor SMTP nao configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASSWORD."
            );
          }
          await sendSmtpEmail({
            host: params.smtpHost,
            port: params.smtpPort,
            user: params.smtpUser,
            password: params.smtpPassword,
            from: senderEmail,
            to: recipient.email,
            subject,
            html: emailHtml
          });
          dispatched += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha SMTP";
          errors.push(`email ${recipient.email}: ${message}`);
        }
      }
    }

    if (recipient.sendWhatsapp && recipient.whatsappPhone) {
      targets += 1;
      if (!whatsappBody) {
        errors.push(
          `whatsapp ${recipient.whatsappPhone}: sem dados no periodo (${content.period.label})`
        );
      } else {
        try {
          if (!params.uazapiInstanceToken || !params.uazapiWhatsappUrl) {
            throw new Error(
              "WhatsApp nao configurado. Defina UAZAPI_INSTANCE_TOKEN e UAZAPI_WHATSAPP_URL."
            );
          }
          await sendUazapiWhatsappMessage({
            instanceToken: params.uazapiInstanceToken,
            baseUrl: params.uazapiWhatsappUrl,
            to: recipient.whatsappPhone,
            text: whatsappBody,
            trackId: `daily-report:${company.id}:${unit.id}:${targetDate}:${nowHour}:${recipient.whatsappPhone}`
          });
          dispatched += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha WhatsApp";
          errors.push(`whatsapp ${recipient.whatsappPhone}: ${message}`);
        }
      }
    }
  }

  const lastError = errors.length > 0 ? truncate(errors.join(" | "), 2000) : null;

  if (targets === 0) {
    return recordFailure(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      scheduleHour: nowHour,
      error: "Sem canais ativos para envio"
    });
  }

  const status: DispatchResult["status"] =
    dispatched === targets ? "sent" : dispatched > 0 ? "partial" : "failed";

  await supabase.from("daily_report_dispatches").insert({
    company_id: company.id,
    unit_id: unit.id,
    report_date: targetDate,
    schedule_hour: nowHour,
    recipients_count: dispatched,
    status,
    last_error: lastError
  });

  return {
    companyId: company.id,
    unitId: unit.id,
    date: targetDate,
    recipients: dispatched,
    status,
    error: lastError ?? undefined
  };
}

async function recordFailure(
  supabase: ReturnType<typeof createClient>,
  input: { companyId: string; unitId: string; date: string; scheduleHour: number; error: string }
): Promise<DispatchResult> {
  await supabase.from("daily_report_dispatches").insert({
    company_id: input.companyId,
    unit_id: input.unitId,
    report_date: input.date,
    schedule_hour: input.scheduleHour,
    recipients_count: 0,
    status: "failed",
    last_error: input.error
  });
  return {
    companyId: input.companyId,
    unitId: input.unitId,
    date: input.date,
    recipients: 0,
    status: "failed",
    error: input.error
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

interface SalesSummary {
  totalOperations: number;
  totalNetWeightKg: number;
  totalProductCents: number;
  totalFreightCents: number;
  totalCents: number;
  averagePricePerKgCents: number;
  byProduct: Array<{ description: string; weightKg: number; totalCents: number }>;
}

async function buildSalesSummary(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  unitId: string,
  period: ReportPeriod
): Promise<SalesSummary | null> {
  const { data, error } = await supabase
    .from("weighing_operations")
    .select(
      "net_weight_kg, product_total_cents, freight_total_cents, total_cents, product_description"
    )
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .in("status", CLOSED_STATUSES)
    .gte("created_at", period.startUtc)
    .lt("created_at", period.endUtc);

  if (error) return null;
  if (!data || data.length === 0) return null;

  const totalOperations = data.length;
  const totalNetWeightKg = data.reduce((sum, row) => sum + Number(row.net_weight_kg ?? 0), 0);
  const totalProductCents = data.reduce(
    (sum, row) => sum + Number(row.product_total_cents ?? 0),
    0
  );
  const totalFreightCents = data.reduce(
    (sum, row) => sum + Number(row.freight_total_cents ?? 0),
    0
  );
  const totalCents = data.reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0);
  const averagePricePerKgCents =
    totalNetWeightKg > 0 ? Math.round(totalCents / totalNetWeightKg) : 0;
  const byProduct = aggregateProducts(
    data.map((row) => ({
      description: row.product_description as string | null,
      weightKg: Number(row.net_weight_kg ?? 0),
      totalCents: Number(row.product_total_cents ?? 0)
    }))
  );

  return {
    totalOperations,
    totalNetWeightKg,
    totalProductCents,
    totalFreightCents,
    totalCents,
    averagePricePerKgCents,
    byProduct
  };
}

async function buildTruckSummary(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  unitId: string,
  period: ReportPeriod
): Promise<TruckReport> {
  const { data, error } = await supabase
    .from("weighing_operations")
    .select("plate, driver_name, product_description, net_weight_kg, created_at, closed_at")
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .in("status", CLOSED_STATUSES)
    .not("closed_at", "is", null)
    .gte("created_at", period.startUtc)
    .lt("created_at", period.endUtc);

  if (error || !data) return buildTruckReport([]);

  const rows: TruckReportRow[] = data.map((row) => ({
    plate: row.plate as string | null,
    driverName: row.driver_name as string | null,
    productDescription: row.product_description as string | null,
    netWeightKg: Number(row.net_weight_kg ?? 0),
    createdAt: row.created_at as string | null,
    closedAt: row.closed_at as string | null
  }));
  return buildTruckReport(rows);
}

function aggregateProducts(
  rows: Array<{ description: string | null; weightKg: number; totalCents: number }>
): Array<{ description: string; weightKg: number; totalCents: number }> {
  const map = new Map<string, { description: string; weightKg: number; totalCents: number }>();
  for (const row of rows) {
    const key = row.description ?? "N/A";
    const entry = map.get(key) ?? { description: key, weightKg: 0, totalCents: 0 };
    entry.weightKg += row.weightKg;
    entry.totalCents += row.totalCents;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.totalCents - a.totalCents);
}

function renderEmailHtml(input: {
  companyName: string;
  unitName: string;
  title: string;
  summary: SalesSummary;
}): string {
  const centsToBRL = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const productRows = input.summary.byProduct
    .map(
      (product) =>
        `<tr><td>${escapeHtml(product.description)}</td><td class="num">${(product.weightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</td><td class="num">${centsToBRL(product.totalCents)}</td></tr>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(input.title)}</title></head><body style="font-family:Arial,sans-serif;color:#0f172a;padding:24px;background:#f8fafc"><h1 style="margin:0 0 4px;font-size:22px">${escapeHtml(input.title)}</h1><p style="margin:0 0 16px;color:#475569">${escapeHtml(input.companyName)} - ${escapeHtml(input.unitName)}</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#1e293b;color:#fff"><th>Carregamentos</th><th>Tonelagem</th><th>Produto</th><th>Frete</th><th>Total</th><th>Preco medio (kg)</th></tr></thead><tbody><tr><td>${input.summary.totalOperations}</td><td>${(input.summary.totalNetWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</td><td>${centsToBRL(input.summary.totalProductCents)}</td><td>${centsToBRL(input.summary.totalFreightCents)}</td><td>${centsToBRL(input.summary.totalCents)}</td><td>${centsToBRL(input.summary.averagePricePerKgCents)}</td></tr></tbody></table><h2 style="margin:24px 0 8px;font-size:16px">Produtos vendidos</h2><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#e2e8f0"><th>Produto</th><th>Peso</th><th>Valor</th></tr></thead><tbody>${productRows}</tbody></table></body></html>`;
}

const WHATSAPP_MAX_PRODUCTS = 8;

function renderWhatsappText(input: {
  companyName: string;
  unitName: string;
  title: string;
  summary: SalesSummary;
}): string {
  const centsToBRL = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const products = input.summary.byProduct
    .slice(0, WHATSAPP_MAX_PRODUCTS)
    .map(
      (product) =>
        `- ${product.description}: ${(product.weightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t | ${centsToBRL(product.totalCents)}`
    )
    .join("\n");
  const omitted = input.summary.byProduct.length - WHATSAPP_MAX_PRODUCTS;

  return [
    `*${input.title}*`,
    `${input.companyName} - ${input.unitName}`,
    `Carregamentos: ${input.summary.totalOperations}`,
    `Tonelagem: ${(input.summary.totalNetWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t`,
    `Produto: ${centsToBRL(input.summary.totalProductCents)}`,
    `Frete: ${centsToBRL(input.summary.totalFreightCents)}`,
    `Total: ${centsToBRL(input.summary.totalCents)}`,
    `Preco medio/kg: ${centsToBRL(input.summary.averagePricePerKgCents)}`,
    products ? `Produtos vendidos:\n${products}` : "",
    omitted > 0 ? `... e mais ${omitted} produto(s)` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Porta 465 = TLS implicito; 587 = STARTTLS (requireTLS impede fallback em claro).
async function sendSmtpEmail(input: {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.port === 465,
    requireTLS: input.port !== 465,
    auth: { user: input.user, pass: input.password }
  });
  try {
    await transporter.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html
    });
  } finally {
    transporter.close();
  }
}

async function sendUazapiWhatsappMessage(input: {
  instanceToken: string;
  baseUrl: string;
  to: string;
  text: string;
  trackId: string;
}): Promise<void> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: {
      token: input.instanceToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      number: input.to,
      text: input.text,
      linkPreview: false,
      async: false,
      track_source: "kyberrock",
      track_id: input.trackId
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`UAZAPI WhatsApp falhou (${response.status}): ${details}`);
  }
}
