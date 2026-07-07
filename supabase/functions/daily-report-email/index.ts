import { createClient } from "jsr:@supabase/supabase-js@2";
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
    "authorization, x-client-info, apikey, content-type, x-admin-session",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

type ReportType = "sales" | "trucks" | "both";

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
  status: "sent" | "partial" | "failed";
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

  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    companyId?: string;
    unitId?: string;
  };
  const targetDate = body.date ?? new Date().toISOString().slice(0, 10);

  const companyFilter = body.companyId
    ? supabase.from("companies").select("id, name").eq("id", body.companyId)
    : supabase.from("companies").select("id, name").eq("is_active", true);
  const { data: companies, error: companiesError } = await companyFilter;
  if (companiesError) {
    return jsonResponse({ error: companiesError.message }, 500);
  }

  const results: DispatchResult[] = [];

  for (const company of companies ?? []) {
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
        senderEmail,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPassword,
        uazapiInstanceToken,
        uazapiWhatsappUrl
      });
      results.push(result);
    }
  }

  return jsonResponse({ results });
});

async function dispatchForUnit(params: {
  supabase: ReturnType<typeof createClient>;
  company: { id: string; name: string };
  unit: { id: string; name: string };
  targetDate: string;
  senderEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  uazapiInstanceToken: string;
  uazapiWhatsappUrl: string;
}): Promise<DispatchResult> {
  const { supabase, company, unit, targetDate, senderEmail } = params;

  const { data: recipients, error: recipientsError } = await supabase
    .from("report_recipients")
    .select(
      "email, whatsapp_phone, send_email, send_whatsapp, schedule_frequency, schedule_time, report_types, display_name"
    )
    .eq("company_id", company.id)
    .eq("is_active", true);

  if (recipientsError) {
    return recordError(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      error: recipientsError.message
    });
  }

  if (!recipients || recipients.length === 0) {
    return recordError(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      error: "Sem destinatarios ativos"
    });
  }

  const summary = await buildDailySummary(supabase, company.id, unit.id, targetDate);
  const truckReport = await buildTruckSummary(supabase, company.id, unit.id, targetDate);
  const hasSales = summary !== null;
  const hasTrucks = truckReport.totalOperations > 0;
  if (!hasSales && !hasTrucks) {
    return recordError(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      error: "Resumo vazio"
    });
  }

  const salesHtml = summary
    ? renderEmailHtml({ companyName: company.name, unitName: unit.name, date: targetDate, summary })
    : null;
  const salesWhatsapp = summary
    ? renderWhatsappText({
        companyName: company.name,
        unitName: unit.name,
        date: targetDate,
        summary
      })
    : null;
  const truckHtml = hasTrucks
    ? renderTruckReportHtml({
        companyName: company.name,
        unitName: unit.name,
        date: targetDate,
        report: truckReport
      })
    : null;
  const truckWhatsapp = hasTrucks
    ? renderTruckReportWhatsapp({ date: targetDate, report: truckReport })
    : null;

  let dispatched = 0;
  let targets = 0;
  let lastError: string | null = null;
  for (const row of recipients as Array<{
    email: string | null;
    whatsapp_phone: string | null;
    send_email: boolean | null;
    send_whatsapp: boolean | null;
    schedule_frequency: string | null;
    schedule_time: string | null;
    report_types: string | null;
    display_name: string | null;
  }>) {
    const reportTypes: ReportType =
      row.report_types === "trucks" || row.report_types === "both" ? row.report_types : "sales";
    const recipient: Recipient = {
      email: row.email,
      whatsappPhone: row.whatsapp_phone,
      sendEmail: row.send_email !== false,
      sendWhatsapp: row.send_whatsapp === true,
      scheduleFrequency: row.schedule_frequency ?? "daily",
      scheduleTime: row.schedule_time ?? "20:00",
      reportTypes,
      displayName: row.display_name
    };

    if (
      !shouldSendToday({
        frequency: recipient.scheduleFrequency,
        targetDate,
        scheduleTime: recipient.scheduleTime
      })
    ) {
      continue;
    }

    // Monta o conteudo conforme os relatorios que este destinatario recebe.
    const wantsSales = reportTypes === "sales" || reportTypes === "both";
    const wantsTrucks = reportTypes === "trucks" || reportTypes === "both";
    const emailHtml =
      [wantsSales ? salesHtml : null, wantsTrucks ? truckHtml : null]
        .filter((part): part is string => Boolean(part))
        .join('<hr style="margin:28px 0;border:none;border-top:1px solid #cbd5e1" />') || null;
    const whatsappBody =
      [wantsSales ? salesWhatsapp : null, wantsTrucks ? truckWhatsapp : null]
        .filter((part): part is string => Boolean(part))
        .join("\n\n") || null;
    const subject = wantsSales
      ? `Fechamento diario ${targetDate} - ${company.name}`
      : `Controle de caminhoes ${targetDate} - ${company.name}`;

    if (recipient.sendEmail && recipient.email && emailHtml) {
      targets += 1;
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
        lastError = error instanceof Error ? error.message : "Falha SMTP";
      }
    }

    if (recipient.sendWhatsapp && recipient.whatsappPhone && whatsappBody) {
      targets += 1;
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
          trackId: `daily-report:${company.id}:${unit.id}:${targetDate}:${recipient.whatsappPhone}`
        });
        dispatched += 1;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Falha WhatsApp";
      }
    }
  }

  if (targets === 0) {
    return recordError(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      error: "Sem canais ativos para envio"
    });
  }

  const status: DispatchResult["status"] =
    targets > 0 && dispatched === targets ? "sent" : dispatched > 0 ? "partial" : "failed";

  await supabase.from("daily_report_dispatches").insert({
    company_id: company.id,
    unit_id: unit.id,
    report_date: targetDate,
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

function recordError(
  supabase: ReturnType<typeof createClient>,
  input: { companyId: string; unitId: string; date: string; error: string }
): DispatchResult {
  void supabase.from("daily_report_dispatches").insert({
    company_id: input.companyId,
    unit_id: input.unitId,
    report_date: input.date,
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

interface DailySummary {
  totalOperations: number;
  totalNetWeightKg: number;
  totalProductCents: number;
  totalFreightCents: number;
  totalCents: number;
  averagePricePerKgCents: number;
  byProduct: Array<{ description: string; weightKg: number; totalCents: number }>;
}

async function buildDailySummary(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  unitId: string,
  date: string
): Promise<DailySummary | null> {
  const { data, error } = await supabase
    .from("weighing_operations")
    .select(
      "net_weight_kg, product_total_cents, freight_total_cents, total_cents, product_description"
    )
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .eq("status", "closed_local")
    .gte("created_at", `${date}T00:00:00Z`)
    .lt("created_at", nextDay(date));

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
      description: row.product_description,
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
  date: string
): Promise<TruckReport> {
  const { data, error } = await supabase
    .from("weighing_operations")
    .select("plate, driver_name, product_description, net_weight_kg, created_at, closed_at")
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .eq("status", "closed_local")
    .not("closed_at", "is", null)
    .gte("created_at", `${date}T00:00:00Z`)
    .lt("created_at", nextDay(date));

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

function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function shouldSendToday(input: {
  frequency: string;
  targetDate: string;
  scheduleTime: string;
}): boolean {
  const now = new Date();
  const [hourStr] = input.scheduleTime.split(":");
  const scheduleHour = parseInt(hourStr ?? "20", 10);
  const currentHour = now.getHours();

  if (scheduleHour !== currentHour) return false;

  const freq = input.frequency;
  if (freq === "daily") return true;

  const parts = input.targetDate.split("-").map(Number);
  const target = new Date(Date.UTC(parts[0]!, (parts[1] ?? 1) - 1, parts[2]));

  if (freq === "weekly") {
    return target.getUTCDay() === 1;
  }

  if (freq === "monthly") {
    return target.getUTCDate() === 1;
  }

  return false;
}

function renderEmailHtml(input: {
  companyName: string;
  unitName: string;
  date: string;
  summary: DailySummary;
}): string {
  const centsToBRL = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const productRows = input.summary.byProduct
    .map(
      (product) =>
        `<tr><td>${escapeHtml(product.description)}</td><td class="num">${(product.weightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</td><td class="num">${centsToBRL(product.totalCents)}</td></tr>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Fechamento diario ${input.date}</title></head><body style="font-family:Arial,sans-serif;color:#0f172a;padding:24px;background:#f8fafc"><h1 style="margin:0 0 4px;font-size:22px">Fechamento diario ${input.date}</h1><p style="margin:0 0 16px;color:#475569">${escapeHtml(input.companyName)} - ${escapeHtml(input.unitName)}</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#1e293b;color:#fff"><th>Carregamentos</th><th>Tonelagem</th><th>Produto</th><th>Frete</th><th>Total</th><th>Preco medio (kg)</th></tr></thead><tbody><tr><td>${input.summary.totalOperations}</td><td>${(input.summary.totalNetWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</td><td>${centsToBRL(input.summary.totalProductCents)}</td><td>${centsToBRL(input.summary.totalFreightCents)}</td><td>${centsToBRL(input.summary.totalCents)}</td><td>${centsToBRL(input.summary.averagePricePerKgCents)}</td></tr></tbody></table><h2 style="margin:24px 0 8px;font-size:16px">Produtos vendidos</h2><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#e2e8f0"><th>Produto</th><th>Peso</th><th>Valor</th></tr></thead><tbody>${productRows}</tbody></table></body></html>`;
}

function renderWhatsappText(input: {
  companyName: string;
  unitName: string;
  date: string;
  summary: DailySummary;
}): string {
  const centsToBRL = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const products = input.summary.byProduct
    .slice(0, 8)
    .map(
      (product) =>
        `- ${product.description}: ${(product.weightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t | ${centsToBRL(product.totalCents)}`
    )
    .join("\n");

  return [
    `Fechamento diario ${input.date}`,
    `${input.companyName} - ${input.unitName}`,
    `Carregamentos: ${input.summary.totalOperations}`,
    `Tonelagem: ${(input.summary.totalNetWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t`,
    `Produto: ${centsToBRL(input.summary.totalProductCents)}`,
    `Frete: ${centsToBRL(input.summary.totalFreightCents)}`,
    `Total: ${centsToBRL(input.summary.totalCents)}`,
    `Preco medio/kg: ${centsToBRL(input.summary.averagePricePerKgCents)}`,
    products ? `Produtos vendidos:\n${products}` : ""
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
  const conn = await Deno.connect({ hostname: input.host, port: input.port });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function readResponse(): Promise<string> {
    const buffer = new Uint8Array(4096);
    let total = "";
    while (true) {
      const { bytesRead } = await conn.read(buffer);
      if (!bytesRead) break;
      total += decoder.decode(buffer.subarray(0, bytesRead));
      if (total.endsWith("\r\n")) break;
    }
    return total;
  }

  async function sendCommand(command: string): Promise<string> {
    await conn.write(encoder.encode(`${command}\r\n`));
    return readResponse();
  }

  const banner = await readResponse();
  if (!banner.startsWith("220")) throw new Error(`SMTP banner invalido: ${banner.trim()}`);

  const ehlo = await sendCommand(`EHLO kyberrock`);
  if (!ehlo.startsWith("250")) throw new Error(`SMTP EHLO falhou: ${ehlo.trim()}`);

  await sendCommand("STARTTLS");
  const tls = await Deno.startTls(conn, { hostname: input.host });
  Object.assign(conn, tls);

  await sendCommand(`AUTH LOGIN`);
  await sendCommand(btoa(input.user));
  await sendCommand(btoa(input.password));
  await sendCommand(`MAIL FROM:<${input.from}>`);
  await sendCommand(`RCPT TO:<${input.to}>`);
  await sendCommand("DATA");
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="utf-8"'
  ].join("\r\n");
  await conn.write(encoder.encode(`${headers}\r\n\r\n${input.html}\r\n.\r\n`));
  const dataResponse = await readResponse();
  if (!dataResponse.startsWith("250")) throw new Error(`SMTP DATA falhou: ${dataResponse.trim()}`);
  await sendCommand("QUIT");
  conn.close();
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
