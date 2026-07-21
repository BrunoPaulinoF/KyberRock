import { createClient } from "jsr:@supabase/supabase-js@2";
// Mesma lib de SMTP usada no daily-report-email/desktop (sendTestEmail); o
// bundler das Edge Functions so resolve especificadores jsr:/npm:.
import nodemailer from "npm:nodemailer@9.0.1";
import { buildTablePdf } from "../_shared/pdf.ts";
import {
  addDays,
  localNow,
  reportPeriod,
  shouldSendAt,
  type ReportPeriod
} from "../_shared/report-schedule.ts";
import {
  accountsPayableTotalsCents,
  buildAccountsPayableTable,
  buildFinancialWhatsappCaption,
  buildStatementTable,
  formatCentsBRL,
  type AccountPayableItem,
  type AccountPayableStatus,
  type StatementEntryItem
} from "./financial-report.ts";

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

// ---------------------------------------------------------------------------
// Cliente OMIE minimo, auto-contido nesta function. Edge Functions sao
// buildadas isoladamente pelo Deno e nao resolvem pacotes npm workspace
// locais (packages/omie-client e Node/npm) — mesma razao pela qual
// supabase/functions/omie-sync reimplementa sua propria chamada OMIE em
// omie-sync-core.ts em vez de importar o pacote.
// ---------------------------------------------------------------------------

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";
const OMIE_REQUEST_DELAY_MS = 3_000;
const OMIE_REDUNDANT_WAIT_MS = 65_000;
const OMIE_MAX_RETRIES = 1;
const MAX_SUPPLIER_LOOKUPS = 60;

interface OmieCredentials {
  appKey: string;
  appSecret: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOmieOnce<TParam, TResponse>(
  credentials: OmieCredentials,
  endpoint: string,
  call: string,
  param: TParam
): Promise<TResponse> {
  const response = await fetch(`${OMIE_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      param: [param],
      app_key: credentials.appKey,
      app_secret: credentials.appSecret
    })
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const faultstring =
    data && typeof data === "object" && "faultstring" in data ? String(data.faultstring) : null;
  if (!response.ok || faultstring) {
    throw new Error(
      `OMIE ${call} falhou (${response.status}): ${faultstring ?? response.statusText}`
    );
  }
  return data as TResponse;
}

/** Chama a API do OMIE com uma unica tentativa extra em erro de consumo redundante. */
async function callOmie<TParam, TResponse>(
  credentials: OmieCredentials,
  endpoint: string,
  call: string,
  param: TParam
): Promise<TResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOmieOnce<TParam, TResponse>(credentials, endpoint, call, param);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < OMIE_MAX_RETRIES && /REDUNDANT|Consumo redundante/i.test(message)) {
        await sleep(OMIE_REDUNDANT_WAIT_MS);
        continue;
      }
      throw error;
    }
  }
}

function parseOmieDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function formatOmieDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function toCents(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
}

function pickFirst(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function firstArray(response: Record<string, unknown>, knownKeys: string[]): unknown[] {
  for (const key of knownKeys) {
    const value = response[key];
    if (Array.isArray(value)) return value;
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

// --- Contas a pagar (ListarContasPagar) -------------------------------------

async function listAccountsPayableInRange(
  credentials: OmieCredentials,
  startIsoDate: string,
  endIsoDate: string
): Promise<AccountPayableItem[]> {
  const all: AccountPayableItem[] = [];
  let page = 1;
  let hasMore = true;
  const pageSize = 200;

  while (hasMore) {
    await sleep(OMIE_REQUEST_DELAY_MS);
    const response = await callOmie<Record<string, unknown>, Record<string, unknown>>(
      credentials,
      "/financas/contapagar/",
      "ListarContasPagar",
      {
        pagina: page,
        registros_por_pagina: pageSize,
        apenas_importado_api: "N",
        filtrar_por_data_de: formatOmieDate(startIsoDate),
        filtrar_por_data_ate: formatOmieDate(endIsoDate)
      }
    );

    const rawItems = firstArray(response, ["conta_pagar_cadastro", "contaPagarCadastro"]);
    for (const raw of rawItems) {
      const mapped = mapAccountPayable(raw as Record<string, unknown>);
      if (mapped) all.push(mapped);
    }

    hasMore = rawItems.length === pageSize;
    page++;
  }

  return all.filter(
    (item) => item.dueDate !== null && item.dueDate >= startIsoDate && item.dueDate <= endIsoDate
  );
}

function mapAccountPayable(item: Record<string, unknown>): AccountPayableItem | null {
  if (!item) return null;
  const idValue = pickFirst(
    item.codigo_lancamento_omie as string | number | undefined,
    item.codigoLancamentoOmie as string | number | undefined
  );
  const id = idValue === null ? null : Number(idValue);
  if (id === null || !Number.isFinite(id)) return null;

  const amountCents = toCents(
    pickFirst(item.valor_documento as string | number, item.valorDocumento as string | number)
  );
  const paidAmountCents = toCents(
    pickFirst(item.valor_pago as string | number, item.valorPago as string | number)
  );
  const dueDate = parseOmieDate(
    pickFirst(item.data_vencimento as string, item.dataVencimento as string)
  );
  const supplierCodeValue = pickFirst(
    item.codigo_cliente_fornecedor as string | number,
    item.codigoClienteFornecedor as string | number
  );

  return {
    id,
    supplierOmieCode: supplierCodeValue === null ? null : Number(supplierCodeValue),
    documentNumber: pickFirst(item.numero_documento as string, item.numeroDocumento as string),
    dueDate,
    amountCents,
    paidAmountCents,
    status: computeStatus({ amountCents, paidAmountCents, dueDate })
  };
}

function computeStatus(input: {
  amountCents: number;
  paidAmountCents: number;
  dueDate: string | null;
}): AccountPayableStatus {
  if (input.paidAmountCents > 0 && input.paidAmountCents >= input.amountCents) return "paid";
  if (input.paidAmountCents > 0) return "partial";
  const today = new Date().toISOString().slice(0, 10);
  if (input.dueDate !== null && input.dueDate < today) return "overdue";
  return "open";
}

async function resolveSupplierNames(
  credentials: OmieCredentials,
  supplierCodes: number[]
): Promise<{ names: Map<number, string>; capped: boolean }> {
  const unique = Array.from(new Set(supplierCodes));
  const capped = unique.length > MAX_SUPPLIER_LOOKUPS;
  const toResolve = unique.slice(0, MAX_SUPPLIER_LOOKUPS);
  const names = new Map<number, string>();

  for (const code of toResolve) {
    await sleep(OMIE_REQUEST_DELAY_MS);
    try {
      const response = await callOmie<Record<string, unknown>, Record<string, unknown>>(
        credentials,
        "/geral/clientes/",
        "ConsultarCliente",
        { codigo_cliente_omie: code }
      );
      const name = pickFirst(response.razao_social as string, response.razaoSocial as string);
      if (name) names.set(code, name);
    } catch {
      // Sem nome resolvido, o relatorio cai no fallback "Fornecedor #codigo".
    }
  }

  return { names, capped };
}

// --- Extrato de conta corrente (ListarContasCorrentes + ListarExtrato) -----

interface CheckingAccount {
  code: number;
  name: string;
}

async function listActiveCheckingAccounts(
  credentials: OmieCredentials
): Promise<CheckingAccount[]> {
  await sleep(OMIE_REQUEST_DELAY_MS);
  const response = await callOmie<Record<string, unknown>, Record<string, unknown>>(
    credentials,
    "/geral/contacorrente/",
    "ListarContasCorrentes",
    { pagina: 1, registros_por_pagina: 100 }
  );
  const rawItems = firstArray(response, [
    "ListarContasCorrentes",
    "conta_corrente_lista",
    "contaCorrenteLista"
  ]);
  const accounts: CheckingAccount[] = [];
  for (const raw of rawItems) {
    const item = raw as Record<string, unknown>;
    const codeValue = pickFirst(
      item.nCodCC as string | number,
      item.codigo_conta_corrente as string | number
    );
    const code = codeValue === null ? null : Number(codeValue);
    const name = pickFirst(item.descricao as string);
    const inactive = pickFirst(item.inativa as string)?.toUpperCase() === "S";
    if (code !== null && Number.isFinite(code) && name && !inactive) {
      accounts.push({ code, name });
    }
  }
  return accounts;
}

async function fetchAccountStatement(
  credentials: OmieCredentials,
  account: CheckingAccount,
  startIsoDate: string,
  endIsoDate: string
): Promise<StatementEntryItem[]> {
  await sleep(OMIE_REQUEST_DELAY_MS);
  const response = await callOmie<Record<string, unknown>, Record<string, unknown>>(
    credentials,
    "/financas/extrato/",
    "ListarExtrato",
    {
      nCodCC: account.code,
      dPeriodoInicial: formatOmieDate(startIsoDate),
      dPeriodoFinal: formatOmieDate(endIsoDate),
      pagina: 1,
      registros_por_pagina: 500
    }
  );

  const rawItems = firstArray(response, [
    "listaMovimento",
    "lista_movimento",
    "movimentos",
    "extrato"
  ]);
  const entries: StatementEntryItem[] = [];
  for (const raw of rawItems) {
    const item = raw as Record<string, unknown>;
    const natureRaw =
      pickFirst(item.cNatureza as string, item.natureza as string)?.toUpperCase() ?? null;
    const saldoValue = pickFirst(item.nSaldo as string | number, item.saldo as string | number);
    entries.push({
      accountName: account.name,
      date: parseOmieDate(
        pickFirst(
          item.dData as string,
          item.data as string,
          item.dDataMovimento as string,
          item.dataMovimento as string
        )
      ),
      description: pickFirst(
        item.cDescricao as string,
        item.descricao as string,
        item.cHistorico as string,
        item.historico as string
      ),
      documentNumber: pickFirst(item.cNumDocumento as string, item.numeroDocumento as string),
      nature: natureRaw === "D" || natureRaw === "C" ? (natureRaw as "D" | "C") : null,
      amountCents: toCents(
        pickFirst(
          item.nValorMovimento as string | number,
          item.valorMovimento as string | number,
          item.nValor as string | number,
          item.valor as string | number
        )
      ),
      runningBalanceCents: saldoValue === null ? null : toCents(saldoValue)
    });
  }
  return entries;
}

// --- Envio (SMTP + UAZAPI) ---------------------------------------------------

async function sendSmtpEmailWithAttachments(input: {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments: Array<{ filename: string; content: Uint8Array; contentType: string }>;
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
      html: input.html,
      attachments: input.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.content),
        contentType: attachment.contentType
      }))
    });
  } finally {
    transporter.close();
  }
}

async function sendUazapiDocument(input: {
  instanceToken: string;
  baseUrl: string;
  to: string;
  fileBase64: string;
  docName: string;
  mimetype: string;
  caption?: string;
  trackId: string;
}): Promise<void> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/send/media`, {
    method: "POST",
    headers: { token: input.instanceToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      number: input.to,
      type: "document",
      file: input.fileBase64,
      docName: input.docName,
      mimetype: input.mimetype,
      text: input.caption ?? "",
      async: true,
      track_source: "kyberrock",
      track_id: input.trackId
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`UAZAPI WhatsApp (documento) falhou (${response.status}): ${details}`);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ---------------------------------------------------------------------------

interface FinancialRecipient {
  email: string | null;
  whatsappPhone: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  scheduleFrequency: string;
  scheduleTime: string;
}

// Hora efetiva do relatorio financeiro: usa a hora especifica (financial_schedule_time)
// quando o destinatario definiu uma; caso contrario, cai no schedule_time geral.
function resolveFinancialScheduleTime(
  financialScheduleTime: string | null,
  scheduleTime: string
): string {
  const trimmed = financialScheduleTime?.trim();
  return trimmed ? trimmed : scheduleTime;
}

interface DispatchResult {
  companyId: string;
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

  if (!(await isAuthorized(req, supabase, serviceRoleKey))) {
    return jsonResponse({ error: "Acesso negado." }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    companyId?: string;
    force?: boolean;
  };
  const now = localNow(new Date());
  const targetDate = body.date ?? now.date;
  const force = body.force === true;

  const companyFilter = body.companyId
    ? supabase
        .from("companies")
        .select("id, name, omie_app_key, omie_app_secret")
        .eq("id", body.companyId)
    : supabase
        .from("companies")
        .select("id, name, omie_app_key, omie_app_secret")
        .eq("is_active", true);
  const { data: companies, error: companiesError } = await companyFilter;
  if (companiesError) {
    return jsonResponse({ error: companiesError.message }, 500);
  }

  const results: DispatchResult[] = [];

  for (const company of companies ?? []) {
    const omieAppKey = (company.omie_app_key as string | null) ?? "";
    const omieAppSecret = (company.omie_app_secret as string | null) ?? "";
    if (!omieAppKey || !omieAppSecret) {
      results.push({
        companyId: company.id,
        date: targetDate,
        recipients: 0,
        status: "skipped",
        reason: "OMIE nao configurado para esta empresa"
      });
      continue;
    }

    const { data: channelSettings } = await supabase
      .from("report_channel_settings")
      .select(
        "smtp_host, smtp_port, smtp_user, smtp_password, smtp_sender, whatsapp_url, whatsapp_instance_token"
      )
      .eq("company_id", company.id)
      .maybeSingle();

    const result = await dispatchForCompany({
      supabase,
      company: { id: company.id, name: company.name as string },
      credentials: { appKey: omieAppKey, appSecret: omieAppSecret },
      targetDate,
      nowHour: now.hour,
      force,
      senderEmail: (channelSettings?.smtp_sender as string | null) || senderEmail || smtpUser,
      smtpHost: (channelSettings?.smtp_host as string | null) || smtpHost,
      smtpPort: Number(channelSettings?.smtp_port ?? 0) || smtpPort,
      smtpUser: (channelSettings?.smtp_user as string | null) || smtpUser,
      smtpPassword: (channelSettings?.smtp_password as string | null) || smtpPassword,
      uazapiInstanceToken:
        (channelSettings?.whatsapp_instance_token as string | null) || uazapiInstanceToken,
      uazapiWhatsappUrl: (channelSettings?.whatsapp_url as string | null) || uazapiWhatsappUrl
    });
    results.push(result);
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

async function dispatchForCompany(params: {
  supabase: ReturnType<typeof createClient>;
  company: { id: string; name: string };
  credentials: OmieCredentials;
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
  const { supabase, company, targetDate, nowHour, force, senderEmail } = params;

  const { data: recipientRows, error: recipientsError } = await supabase
    .from("report_recipients")
    .select(
      "email, whatsapp_phone, send_email, send_whatsapp, schedule_frequency, schedule_time, financial_schedule_time"
    )
    .eq("company_id", company.id)
    .eq("is_active", true)
    .eq("send_financial", true);

  if (recipientsError) {
    return recordFailure(supabase, {
      companyId: company.id,
      date: targetDate,
      scheduleHour: nowHour,
      error: recipientsError.message
    });
  }

  const recipients: FinancialRecipient[] = (recipientRows ?? []).map((row) => ({
    email: (row.email as string | null) ?? null,
    whatsappPhone: (row.whatsapp_phone as string | null) ?? null,
    sendEmail: row.send_email !== false,
    sendWhatsapp: row.send_whatsapp === true,
    scheduleFrequency: (row.schedule_frequency as string | null) ?? "daily",
    scheduleTime: resolveFinancialScheduleTime(
      (row.financial_schedule_time as string | null) ?? null,
      (row.schedule_time as string | null) ?? "20:00"
    )
  }));

  if (recipients.length === 0) {
    return {
      companyId: company.id,
      date: targetDate,
      recipients: 0,
      status: "skipped",
      reason: "Sem destinatarios do relatorio financeiro"
    };
  }

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
      date: targetDate,
      recipients: 0,
      status: "skipped",
      reason: "Nenhum destinatario agendado para esta hora"
    };
  }

  if (!force) {
    const { data: existing } = await supabase
      .from("financial_report_dispatches")
      .select("id")
      .eq("company_id", company.id)
      .eq("report_date", targetDate)
      .eq("schedule_hour", nowHour)
      .in("status", ["sent", "partial"])
      .limit(1);
    if (existing && existing.length > 0) {
      return {
        companyId: company.id,
        date: targetDate,
        recipients: 0,
        status: "skipped",
        reason: "Ja despachado nesta hora"
      };
    }
  }

  // Conteudo por frequencia (o periodo semanal/mensal difere do diario), montado
  // uma vez e reaproveitado entre destinatarios da mesma frequencia.
  const contentCache = new Map<
    string,
    {
      period: ReportPeriod;
      emailHtml: string;
      whatsappCaption: string;
      attachments: Array<{ filename: string; content: Uint8Array; contentType: string }>;
    }
  >();

  const contentFor = async (frequency: string) => {
    const key = frequency === "weekly" || frequency === "monthly" ? frequency : "daily";
    const cached = contentCache.get(key);
    if (cached) return cached;

    const period = reportPeriod(key, targetDate);
    // Contas a pagar: janela ampla (ate 180 dias antes do inicio do periodo)
    // para nao perder titulos vencidos antigos ainda em aberto, filtrando
    // depois para status != "paid" — o relatorio mostra o que esta pendente
    // "a data do envio", nao so o que vence exatamente dentro do periodo.
    const payableWindowStart = addDays(period.start, -180);
    const payableWindowEnd = addDays(period.endExclusive, -1);
    const allPayables = await listAccountsPayableInRange(
      params.credentials,
      payableWindowStart,
      payableWindowEnd
    );
    const pendingPayables = allPayables.filter((item) => item.status !== "paid");
    const { names: supplierNames } = await resolveSupplierNames(
      params.credentials,
      pendingPayables
        .map((item) => item.supplierOmieCode)
        .filter((code): code is number => code !== null)
    );

    const accounts = await listActiveCheckingAccounts(params.credentials);
    const statementEntries: StatementEntryItem[] = [];
    const statementStart = period.start;
    const statementEnd = addDays(period.endExclusive, -1);
    for (const account of accounts) {
      const entries = await fetchAccountStatement(
        params.credentials,
        account,
        statementStart,
        statementEnd
      );
      statementEntries.push(...entries);
    }

    const payableTable = buildAccountsPayableTable(pendingPayables, supplierNames);
    const statementTable = buildStatementTable(statementEntries);
    const totals = accountsPayableTotalsCents(pendingPayables);

    const payablePdf = await buildTablePdf({
      title: "Contas a pagar",
      subtitle: `${company.name} - ${period.label}`,
      generatedAtLabel: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      columns: payableTable.columns,
      rows: payableTable.rows,
      emptyMessage: "Nenhuma conta a pagar em aberto.",
      footerNote: `Total em aberto: ${formatCentsBRL(totals.openCents)} | Vencido: ${formatCentsBRL(totals.overdueCents)}`
    });
    const statementPdf = await buildTablePdf({
      title: "Extrato financeiro (OMIE)",
      subtitle: `${company.name} - ${period.label}`,
      generatedAtLabel: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      columns: statementTable.columns,
      rows: statementTable.rows,
      emptyMessage: "Nenhuma movimentacao no periodo."
    });

    const emailHtml = renderEmailHtml({
      companyName: company.name,
      period,
      payableRowsCount: pendingPayables.length,
      totals,
      statementRowsCount: statementEntries.length
    });
    const whatsappCaption = buildFinancialWhatsappCaption({
      companyName: company.name,
      periodLabel: period.label,
      accountsPayableCount: pendingPayables.length,
      accountsPayableOpenCents: totals.openCents,
      accountsPayableOverdueCents: totals.overdueCents,
      statementEntriesCount: statementEntries.length
    });

    const content = {
      period,
      emailHtml,
      whatsappCaption,
      attachments: [
        {
          filename: `contas-a-pagar-${targetDate}.pdf`,
          content: payablePdf,
          contentType: "application/pdf"
        },
        {
          filename: `extrato-financeiro-${targetDate}.pdf`,
          content: statementPdf,
          contentType: "application/pdf"
        }
      ]
    };
    contentCache.set(key, content);
    return content;
  };

  let dispatched = 0;
  let targets = 0;
  const errors: string[] = [];

  for (const recipient of due) {
    let content: Awaited<ReturnType<typeof contentFor>>;
    try {
      content = await contentFor(recipient.scheduleFrequency);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar OMIE";
      errors.push(`omie: ${message}`);
      continue;
    }

    if (recipient.sendEmail && recipient.email) {
      targets += 1;
      try {
        if (!params.smtpHost || !params.smtpUser || !params.smtpPassword || !senderEmail) {
          throw new Error(
            "Provedor SMTP nao configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASSWORD."
          );
        }
        await sendSmtpEmailWithAttachments({
          host: params.smtpHost,
          port: params.smtpPort,
          user: params.smtpUser,
          password: params.smtpPassword,
          from: senderEmail,
          to: recipient.email,
          subject: `Financeiro OMIE - ${content.period.label} - ${company.name}`,
          html: content.emailHtml,
          attachments: content.attachments
        });
        dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha SMTP";
        errors.push(`email ${recipient.email}: ${message}`);
      }
    }

    if (recipient.sendWhatsapp && recipient.whatsappPhone) {
      targets += 1;
      try {
        if (!params.uazapiInstanceToken || !params.uazapiWhatsappUrl) {
          throw new Error(
            "WhatsApp nao configurado. Defina UAZAPI_INSTANCE_TOKEN e UAZAPI_WHATSAPP_URL."
          );
        }
        for (const attachment of content.attachments) {
          await sendUazapiDocument({
            instanceToken: params.uazapiInstanceToken,
            baseUrl: params.uazapiWhatsappUrl,
            to: recipient.whatsappPhone,
            fileBase64: `data:${attachment.contentType};base64,${toBase64(attachment.content)}`,
            docName: attachment.filename,
            mimetype: attachment.contentType,
            caption: content.whatsappCaption,
            trackId: `financial-report:${company.id}:${targetDate}:${nowHour}:${recipient.whatsappPhone}:${attachment.filename}`
          });
        }
        dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha WhatsApp";
        errors.push(`whatsapp ${recipient.whatsappPhone}: ${message}`);
      }
    }
  }

  const lastError = errors.length > 0 ? truncate(errors.join(" | "), 2000) : null;

  if (targets === 0) {
    return recordFailure(supabase, {
      companyId: company.id,
      date: targetDate,
      scheduleHour: nowHour,
      error: "Sem canais ativos para envio"
    });
  }

  const status: DispatchResult["status"] =
    dispatched === targets ? "sent" : dispatched > 0 ? "partial" : "failed";

  await supabase.from("financial_report_dispatches").insert({
    company_id: company.id,
    report_date: targetDate,
    schedule_hour: nowHour,
    recipients_count: dispatched,
    status,
    last_error: lastError
  });

  return {
    companyId: company.id,
    date: targetDate,
    recipients: dispatched,
    status,
    error: lastError ?? undefined
  };
}

async function recordFailure(
  supabase: ReturnType<typeof createClient>,
  input: { companyId: string; date: string; scheduleHour: number; error: string }
): Promise<DispatchResult> {
  await supabase.from("financial_report_dispatches").insert({
    company_id: input.companyId,
    report_date: input.date,
    schedule_hour: input.scheduleHour,
    recipients_count: 0,
    status: "failed",
    last_error: input.error
  });
  return {
    companyId: input.companyId,
    date: input.date,
    recipients: 0,
    status: "failed",
    error: input.error
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderEmailHtml(input: {
  companyName: string;
  period: ReportPeriod;
  payableRowsCount: number;
  totals: { openCents: number; overdueCents: number };
  statementRowsCount: number;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Financeiro OMIE - ${escapeHtml(input.period.label)}</title></head><body style="font-family:Arial,sans-serif;color:#0f172a;padding:24px;background:#f8fafc"><h1 style="margin:0 0 4px;font-size:22px">Financeiro OMIE - ${escapeHtml(input.period.label)}</h1><p style="margin:0 0 16px;color:#475569">${escapeHtml(input.companyName)}</p><p>Contas a pagar em aberto: <strong>${input.payableRowsCount}</strong> (${formatCentsBRL(input.totals.openCents)}), sendo <strong>${formatCentsBRL(input.totals.overdueCents)}</strong> vencido.</p><p>Extrato financeiro: <strong>${input.statementRowsCount}</strong> lancamento(s) no periodo.</p><p style="color:#64748b;font-size:13px">Detalhes completos nos PDFs em anexo.</p></body></html>`;
}
