import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-session",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface Recipient {
  email: string;
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

  if (!smtpHost || !smtpUser || !smtpPassword || !senderEmail) {
    return jsonResponse(
      { error: "Provedor SMTP nao configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASSWORD." },
      500
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    companyId?: string;
    unitId?: string;
  };
  const targetDate = body.date ?? new Date().toISOString().slice(0, 10);

  const companyFilter = body.companyId ? supabase.from("companies").select("id, name").eq("id", body.companyId) : supabase.from("companies").select("id, name").eq("is_active", true);
  const { data: companies, error: companiesError } = await companyFilter;
  if (companiesError) {
    return jsonResponse({ error: companiesError.message }, 500);
  }

  const results: DispatchResult[] = [];

  for (const company of companies ?? []) {
    const unitFilter = body.unitId
      ? supabase.from("units").select("id, name").eq("id", body.unitId).eq("company_id", company.id)
      : supabase.from("units").select("id, name").eq("company_id", company.id).eq("is_active", true);
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
        smtpPassword
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
}): Promise<DispatchResult> {
  const { supabase, company, unit, targetDate, senderEmail } = params;

  const { data: recipients, error: recipientsError } = await supabase
    .from("report_recipients")
    .select("email, display_name")
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
  if (!summary) {
    return recordError(supabase, {
      companyId: company.id,
      unitId: unit.id,
      date: targetDate,
      error: "Resumo vazio"
    });
  }

  const html = renderEmailHtml({
    companyName: company.name,
    unitName: unit.name,
    date: targetDate,
    summary
  });

  let dispatched = 0;
  let lastError: string | null = null;
  for (const recipient of recipients as Recipient[]) {
    try {
      await sendSmtpEmail({
        host: params.smtpHost,
        port: params.smtpPort,
        user: params.smtpUser,
        password: params.smtpPassword,
        from: senderEmail,
        to: recipient.email,
        subject: `Fechamento diario ${targetDate} - ${company.name}`,
        html
      });
      dispatched += 1;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Falha SMTP";
    }
  }

  const status: DispatchResult["status"] =
    dispatched === recipients.length
      ? "sent"
      : dispatched > 0
        ? "partial"
        : "failed";

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
  return { companyId: input.companyId, unitId: input.unitId, date: input.date, recipients: 0, status: "failed", error: input.error };
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
    .select("net_weight_kg, product_total_cents, freight_total_cents, total_cents, product_description")
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .eq("status", "closed_local")
    .gte("created_at", `${date}T00:00:00Z`)
    .lt("created_at", nextDay(date));

  if (error) return null;
  if (!data || data.length === 0) return null;

  const totalOperations = data.length;
  const totalNetWeightKg = data.reduce((sum, row) => sum + Number(row.net_weight_kg ?? 0), 0);
  const totalProductCents = data.reduce((sum, row) => sum + Number(row.product_total_cents ?? 0), 0);
  const totalFreightCents = data.reduce((sum, row) => sum + Number(row.freight_total_cents ?? 0), 0);
  const totalCents = data.reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0);
  const averagePricePerKgCents = totalNetWeightKg > 0 ? Math.round(totalCents / totalNetWeightKg) : 0;
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
  await conn.write(
    encoder.encode(`${headers}\r\n\r\n${input.html}\r\n.\r\n`)
  );
  const dataResponse = await readResponse();
  if (!dataResponse.startsWith("250")) throw new Error(`SMTP DATA falhou: ${dataResponse.trim()}`);
  await sendCommand("QUIT");
  conn.close();
}
