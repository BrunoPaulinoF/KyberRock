// Motor da cobranca da plataforma: fecha o ciclo, emite o boleto no Mercado
// Pago, manda a fatura pelo WhatsApp, marca vencidas, bloqueia por
// inadimplencia e libera quando o pagamento entra.
//
// Vive em `_shared` porque roda em dois lugares que nao podem divergir:
//   - `billing-run`: passada automatica do pg_cron (2x por dia);
//   - `admin-billing`: os mesmos passos disparados a mao pelo painel.
// Se a regra morasse em uma das duas, "gerar agora" e "gerar sozinho"
// produziriam faturas diferentes.
//
// Toda a matematica esta em `billing-cycle.ts` e todo texto em
// `billing-invoice.ts` — os dois puros e cobertos por teste. Aqui fica so o
// I/O: Supabase, Mercado Pago e UAZAPI.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import {
  billingToday,
  daysOverdue,
  invoiceTotalCents,
  pendingBillingPeriods,
  proratedAmountCents,
  resolveBillingConfig,
  resolveGraceDays,
  shouldBlockForOverdue,
  upcomingBillingPeriod
} from "./billing-cycle.ts";
import type { BillingPeriod } from "./billing-cycle.ts";
import {
  buildBlockNoticeMessage,
  buildBlockReason,
  buildInvoiceDescription,
  buildInvoiceWhatsappMessage,
  formatCents,
  invoicePdfFileName,
  isReadyForBoleto,
  missingBillingFields,
  normalizeWhatsappNumber,
  resolveBillingCustomer
} from "./billing-invoice.ts";
import type { BillingCustomer } from "./billing-invoice.ts";
import { buildInvoicePdf, toBase64 } from "./billing-pdf.ts";
import { resolveAllBillingSecrets } from "./billing-secrets.ts";
import type { ResolvedBillingSecret } from "./billing-secrets.ts";
import {
  MercadoPagoError,
  cancelPayment,
  createBoleto,
  getPayment,
  isDeadStatus,
  isPaidStatus
} from "./mercado-pago.ts";

/** Quantos boletos em aberto sao reconsultados no Mercado Pago por passada. */
const MAX_PAYMENT_POLLS_PER_RUN = 40;

export const BILLING_SETTINGS_TABLE = "billing_settings";
export const BILLING_SETTINGS_ID = true;

export interface BillingSettings {
  /** Valor lido do secret do Supabase. NUNCA sai da Edge Function. */
  mercadoPagoAccessToken: string;
  mercadoPagoEnvironment: string;
  /** Valor lido do secret do Supabase. NUNCA sai da Edge Function. */
  mercadoPagoWebhookSecret: string;
  whatsappUrl: string;
  /** Valor lido do secret do Supabase. NUNCA sai da Edge Function. */
  whatsappInstanceToken: string;
  /**
   * Resumo por segredo (nome da variavel, se esta preenchida, quatro ultimos
   * caracteres). E a UNICA parte dos segredos que pode chegar ao navegador.
   */
  secrets: ResolvedBillingSecret[];
  whatsappInstanceName: string;
  whatsappStatus: string;
  defaultClosingDay: number;
  defaultDueDay: number;
  defaultGraceDays: number;
  autoCloseEnabled: boolean;
  autoBoletoEnabled: boolean;
  autoWhatsappEnabled: boolean;
  autoBlockEnabled: boolean;
  issuerName: string;
  issuerDocument: string;
  issuerEmail: string;
  issuerPhone: string;
  issuerPixKey: string;
  invoiceDescriptionTemplate: string;
  whatsappMessageTemplate: string;
}

export interface BillingCompanyRow {
  id: string;
  name: string;
  legal_name: string | null;
  document: string | null;
  is_active: boolean;
  payment_blocked: boolean | null;
  payment_blocked_reason: string | null;
  billing_legal_name: string | null;
  billing_document: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_contact_name: string | null;
  billing_zipcode: string | null;
  billing_address_street: string | null;
  billing_address_number: string | null;
  billing_address_complement: string | null;
  billing_neighborhood: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_monthly_amount_cents: number | null;
  billing_start_date: string | null;
  billing_closing_day: number | null;
  billing_due_day: number | null;
  billing_grace_days: number | null;
  billing_enabled: boolean;
  billing_block_exempt: boolean;
  billing_notes: string | null;
}

export interface BillingInvoiceRow {
  id: string;
  company_id: string;
  number: string;
  status: string;
  period_start: string;
  period_end: string;
  closing_date: string;
  due_date: string;
  reference_label: string;
  base_amount_cents: number;
  amount_cents: number;
  discount_cents: number;
  addition_cents: number;
  prorated_days: number | null;
  full_period_days: number | null;
  is_prorated: boolean;
  notes: string | null;
  boleto_provider: string;
  boleto_status: string | null;
  boleto_payment_id: string | null;
  boleto_url: string | null;
  boleto_barcode: string | null;
  boleto_expires_at: string | null;
  boleto_error: string | null;
  boleto_attempts: number;
  boleto_issued_at: string | null;
  whatsapp_to: string | null;
  whatsapp_sent_at: string | null;
  whatsapp_error: string | null;
  whatsapp_attempts: number;
  paid_at: string | null;
  paid_amount_cents: number | null;
  payment_method: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  blocked_at: string | null;
  created_at: string;
  updated_at: string;
}

export const COMPANY_BILLING_COLUMNS =
  "id, name, legal_name, document, is_active, payment_blocked, payment_blocked_reason, " +
  "billing_legal_name, billing_document, billing_email, billing_phone, billing_contact_name, " +
  "billing_zipcode, billing_address_street, billing_address_number, billing_address_complement, " +
  "billing_neighborhood, billing_city, billing_state, billing_monthly_amount_cents, " +
  "billing_start_date, billing_closing_day, billing_due_day, billing_grace_days, " +
  "billing_enabled, billing_block_exempt, billing_notes";

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

/**
 * Configuracao global.
 *
 * Os SEGREDOS (access token do Mercado Pago, segredo do webhook, token da
 * instancia de WhatsApp) nao ficam no banco: a tabela guarda so o NOME da
 * variavel e o valor e lido aqui do secret do Supabase. Ver
 * `billing-secrets.ts` e a migracao 202608120003.
 *
 * O resto — URL do WhatsApp, padroes do ciclo, emitente, textos — continua na
 * tabela, porque nao e credencial e precisa ser editavel na tela.
 */
export async function loadBillingSettings(supabase: SupabaseClient): Promise<BillingSettings> {
  const { data, error } = await supabase
    .from(BILLING_SETTINGS_TABLE)
    .select("*")
    .eq("id", BILLING_SETTINGS_ID)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;

  const { values, status } = resolveAllBillingSecrets({
    settingsRow: row,
    readEnv: (name) => Deno.env.get(name)
  });

  return {
    mercadoPagoAccessToken: values.mercadoPagoAccessToken,
    mercadoPagoEnvironment: text(row.mercado_pago_environment) || "production",
    mercadoPagoWebhookSecret: values.mercadoPagoWebhookSecret,
    whatsappUrl: text(row.whatsapp_url) || (Deno.env.get("UAZAPI_WHATSAPP_URL") ?? ""),
    whatsappInstanceToken: values.whatsappInstanceToken,
    secrets: status,
    whatsappInstanceName: text(row.whatsapp_instance_name),
    whatsappStatus: text(row.whatsapp_status),
    defaultClosingDay: Number(row.default_closing_day ?? 25),
    defaultDueDay: Number(row.default_due_day ?? 5),
    defaultGraceDays: Number(row.default_grace_days ?? 5),
    autoCloseEnabled: row.auto_close_enabled !== false,
    autoBoletoEnabled: row.auto_boleto_enabled !== false,
    autoWhatsappEnabled: row.auto_whatsapp_enabled !== false,
    autoBlockEnabled: row.auto_block_enabled !== false,
    issuerName: text(row.issuer_name) || "KyberRock",
    issuerDocument: text(row.issuer_document),
    issuerEmail: text(row.issuer_email),
    issuerPhone: text(row.issuer_phone),
    issuerPixKey: text(row.issuer_pix_key),
    invoiceDescriptionTemplate: text(row.invoice_description_template),
    whatsappMessageTemplate: text(row.whatsapp_message_template)
  };
}

/** URL publica do webhook do Mercado Pago desta instalacao. */
export function webhookUrl(): string | null {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  return base ? `${base.replace(/\/+$/, "")}/functions/v1/billing-webhook` : null;
}

// ---------------------------------------------------------------------------
// Trilha
// ---------------------------------------------------------------------------

/**
 * Registra o que aconteceu. Best-effort de proposito: a trilha nunca pode
 * derrubar a cobranca — perder um log e barato, perder o boleto nao.
 */
export async function recordBillingEvent(
  supabase: SupabaseClient,
  input: {
    companyId?: string | null;
    invoiceId?: string | null;
    eventType: string;
    message?: string;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from("billing_events").insert({
      company_id: input.companyId ?? null,
      invoice_id: input.invoiceId ?? null,
      event_type: input.eventType,
      message: input.message ?? null,
      payload: input.payload ?? {}
    });
  } catch {
    // Trilha e diagnostico, nao pre-requisito.
  }
}

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

export interface CompanyBillingPlan {
  company: BillingCompanyRow;
  customer: BillingCustomer;
  graceDays: number;
  closingDay: number;
  dueDay: number;
  monthlyAmountCents: number;
  /** Proximo ciclo a fechar; null quando falta configuracao. */
  nextPeriod: BillingPeriod | null;
  /** O que impede a cobranca automatica desta pedreira. */
  blockers: string[];
}

/** Leitura da pedreira do jeito que a tela e o motor precisam: config + pendencias. */
export function buildCompanyBillingPlan(input: {
  company: BillingCompanyRow;
  settings: BillingSettings;
  lastPeriodEnd: string | null;
}): CompanyBillingPlan {
  const { company, settings } = input;
  const customer = resolveBillingCustomer(company);
  const config = resolveBillingConfig({
    startDate: company.billing_start_date,
    closingDay: company.billing_closing_day,
    dueDay: company.billing_due_day,
    defaults: { closingDay: settings.defaultClosingDay, dueDay: settings.defaultDueDay }
  });
  const monthlyAmountCents = Number(company.billing_monthly_amount_cents ?? 0);

  const blockers: string[] = [];
  if (!company.billing_start_date) blockers.push("Data de virada do sistema nao informada");
  if (monthlyAmountCents <= 0) blockers.push("Valor acertado nao informado");
  blockers.push(...missingBillingFields(customer).boleto.map((field) => `${field} em falta`));

  return {
    company,
    customer,
    graceDays: resolveGraceDays(company.billing_grace_days, settings.defaultGraceDays),
    closingDay: company.billing_closing_day ?? settings.defaultClosingDay,
    dueDay: company.billing_due_day ?? settings.defaultDueDay,
    monthlyAmountCents,
    nextPeriod: config ? upcomingBillingPeriod(config, input.lastPeriodEnd) : null,
    blockers
  };
}

/** Ultimo ciclo ja faturado (fatura viva); e de onde o proximo periodo parte. */
export async function lastBilledPeriodEnd(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("billing_invoices")
    .select("period_end")
    .eq("company_id", companyId)
    .neq("status", "canceled")
    .order("period_end", { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ period_end: string }>;
  return rows.length > 0 ? rows[0].period_end : null;
}

export interface CreateInvoiceResult {
  invoice: BillingInvoiceRow | null;
  created: boolean;
  /** Preenchido quando o ciclo ja tinha fatura (indice unico) ou faltou dado. */
  skippedReason?: string;
}

/**
 * Cria a fatura de um ciclo. A corrida entre a passada do cron e o botao do
 * painel e resolvida pelo indice unico `(company_id, period_end)`: quem chega
 * depois recebe 23505 e devolve `created: false` em vez de duplicar a cobranca.
 */
export async function createInvoiceForPeriod(
  supabase: SupabaseClient,
  input: {
    company: BillingCompanyRow;
    period: BillingPeriod;
    monthlyAmountCents: number;
    notes?: string | null;
  }
): Promise<CreateInvoiceResult> {
  if (input.monthlyAmountCents <= 0) {
    return { invoice: null, created: false, skippedReason: "Valor acertado nao informado" };
  }

  const baseAmountCents = proratedAmountCents({
    monthlyAmountCents: input.monthlyAmountCents,
    billedDays: input.period.billedDays,
    fullPeriodDays: input.period.fullPeriodDays
  });

  const { data, error } = await supabase
    .from("billing_invoices")
    .insert({
      company_id: input.company.id,
      status: "open",
      period_start: input.period.periodStart,
      period_end: input.period.periodEnd,
      closing_date: input.period.closingDate,
      due_date: input.period.dueDate,
      reference_label: input.period.referenceLabel,
      base_amount_cents: baseAmountCents,
      amount_cents: invoiceTotalCents({ baseAmountCents }),
      prorated_days: input.period.billedDays,
      full_period_days: input.period.fullPeriodDays,
      is_prorated: input.period.isProrated,
      notes: input.notes ?? null
    })
    .select("*")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const existing = await findInvoiceByPeriod(
        supabase,
        input.company.id,
        input.period.periodEnd
      );
      return { invoice: existing, created: false, skippedReason: "Ciclo ja faturado" };
    }
    throw error;
  }

  const invoice = data as unknown as BillingInvoiceRow;
  await recordBillingEvent(supabase, {
    companyId: input.company.id,
    invoiceId: invoice.id,
    eventType: "invoice_created",
    message: `Fatura ${invoice.number} de ${formatCents(invoice.amount_cents)} referente a ${invoice.reference_label}.`,
    payload: {
      periodStart: invoice.period_start,
      periodEnd: invoice.period_end,
      isProrated: invoice.is_prorated
    }
  });
  return { invoice, created: true };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "23505";
}

async function findInvoiceByPeriod(
  supabase: SupabaseClient,
  companyId: string,
  periodEnd: string
): Promise<BillingInvoiceRow | null> {
  const { data } = await supabase
    .from("billing_invoices")
    .select("*")
    .eq("company_id", companyId)
    .eq("period_end", periodEnd)
    .neq("status", "canceled")
    .maybeSingle();
  return (data as unknown as BillingInvoiceRow) ?? null;
}

export async function getInvoice(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<BillingInvoiceRow> {
  const { data, error } = await supabase
    .from("billing_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (error) throw error;
  return data as unknown as BillingInvoiceRow;
}

export async function getCompany(
  supabase: SupabaseClient,
  companyId: string
): Promise<BillingCompanyRow> {
  const { data, error } = await supabase
    .from("companies")
    .select(COMPANY_BILLING_COLUMNS)
    .eq("id", companyId)
    .single();
  if (error) throw error;
  return data as unknown as BillingCompanyRow;
}

async function updateInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  patch: Record<string, unknown>
): Promise<BillingInvoiceRow> {
  const { data, error } = await supabase
    .from("billing_invoices")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", invoiceId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as BillingInvoiceRow;
}

// ---------------------------------------------------------------------------
// Boleto
// ---------------------------------------------------------------------------

export interface IssueBoletoResult {
  invoice: BillingInvoiceRow;
  issued: boolean;
  error?: string;
}

/**
 * Emite (ou reemite) o boleto da fatura no Mercado Pago.
 *
 * A chave de idempotencia segue o padrao do OMIE
 * (`kyberrock:{companyId}:{invoiceId}:create_boleto`) e carrega a tentativa: um
 * reenvio depois de falha de rede nao duplica cobranca, mas uma reemissao
 * deliberada (boleto cancelado, vencimento novo) precisa de chave nova, senao o
 * Mercado Pago devolveria o boleto velho.
 */
export async function issueBoletoForInvoice(
  supabase: SupabaseClient,
  input: {
    settings: BillingSettings;
    company: BillingCompanyRow;
    invoice: BillingInvoiceRow;
    /** Cancela o boleto anterior antes de emitir outro. */
    reissue?: boolean;
  }
): Promise<IssueBoletoResult> {
  const { settings, company, invoice } = input;

  if (!settings.mercadoPagoAccessToken) {
    return await failBoleto(
      supabase,
      invoice,
      "Access token do Mercado Pago nao configurado no financeiro."
    );
  }
  if (invoice.status === "canceled") {
    return { invoice, issued: false, error: "Fatura cancelada." };
  }
  if (invoice.status === "paid") {
    return { invoice, issued: false, error: "Fatura ja paga." };
  }
  if (invoice.amount_cents <= 0) {
    return await failBoleto(supabase, invoice, "Fatura sem valor a cobrar.");
  }

  const customer = resolveBillingCustomer(company);
  if (!isReadyForBoleto(customer)) {
    return await failBoleto(
      supabase,
      invoice,
      `Cadastro de cobranca incompleto: ${missingBillingFields(customer).boleto.join(", ")}.`
    );
  }

  if (input.reissue && invoice.boleto_payment_id) {
    try {
      await cancelPayment({
        accessToken: settings.mercadoPagoAccessToken,
        paymentId: invoice.boleto_payment_id
      });
    } catch {
      // Boleto ja cancelado/vencido no Mercado Pago: seguir para a emissao nova.
    }
  }

  const attempt = (invoice.boleto_attempts ?? 0) + 1;
  const idempotencyKey =
    attempt === 1
      ? `kyberrock:${company.id}:${invoice.id}:create_boleto`
      : `kyberrock:${company.id}:${invoice.id}:create_boleto:${attempt}`;

  try {
    const boleto = await createBoleto({
      accessToken: settings.mercadoPagoAccessToken,
      idempotencyKey,
      amountCents: invoice.amount_cents,
      description: buildInvoiceDescription({
        issuerName: settings.issuerName,
        companyName: company.name,
        referenceLabel: invoice.reference_label,
        periodStart: invoice.period_start,
        periodEnd: invoice.period_end,
        template: settings.invoiceDescriptionTemplate
      }),
      dueDate: invoice.due_date,
      externalReference: invoice.id,
      notificationUrl: webhookUrl(),
      payer: {
        email: customer.email,
        name: customer.legalName,
        document: customer.document,
        zipCode: customer.zipcode,
        streetName: customer.addressStreet,
        streetNumber: customer.addressNumber,
        neighborhood: customer.neighborhood,
        city: customer.city,
        federalUnit: customer.state
      }
    });

    const updated = await updateInvoice(supabase, invoice.id, {
      boleto_provider: "mercado_pago",
      boleto_status: boleto.status,
      boleto_payment_id: boleto.paymentId,
      boleto_url: boleto.url,
      boleto_barcode: boleto.barcode,
      boleto_expires_at: boleto.expiresAt,
      boleto_error: null,
      boleto_attempts: attempt,
      boleto_issued_at: nowIso()
    });

    await recordBillingEvent(supabase, {
      companyId: company.id,
      invoiceId: invoice.id,
      eventType: "boleto_issued",
      message: `Boleto emitido no Mercado Pago (pagamento ${boleto.paymentId}).`,
      payload: { status: boleto.status, url: boleto.url }
    });

    // Um boleto ja aprovado na emissao e raro, mas acontece com credito em
    // conta; quitar aqui evita fatura paga marcada como em aberto.
    if (isPaidStatus(boleto.status)) {
      const settled = await settleInvoice(supabase, {
        invoice: updated,
        amountCents: updated.amount_cents,
        method: "mercado_pago"
      });
      return { invoice: settled, issued: true };
    }

    return { invoice: updated, issued: true };
  } catch (error) {
    const message =
      error instanceof MercadoPagoError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Falha ao emitir boleto.";
    return await failBoleto(supabase, invoice, message, attempt);
  }
}

async function failBoleto(
  supabase: SupabaseClient,
  invoice: BillingInvoiceRow,
  message: string,
  attempt?: number
): Promise<IssueBoletoResult> {
  const updated = await updateInvoice(supabase, invoice.id, {
    boleto_error: message,
    ...(attempt !== undefined ? { boleto_attempts: attempt } : {})
  });
  await recordBillingEvent(supabase, {
    companyId: invoice.company_id,
    invoiceId: invoice.id,
    eventType: "boleto_failed",
    message
  });
  return { invoice: updated, issued: false, error: message };
}

// ---------------------------------------------------------------------------
// Entrega por WhatsApp
// ---------------------------------------------------------------------------

export interface SendInvoiceResult {
  invoice: BillingInvoiceRow;
  sent: boolean;
  error?: string;
}

/**
 * Manda a fatura para o financeiro da pedreira. O texto (valor, vencimento,
 * link e linha digitavel) vai primeiro e o PDF depois: se o anexo falhar, o
 * cliente ja tem tudo que precisa para pagar, entao a falha do PDF nao invalida
 * o envio.
 */
export async function sendInvoiceWhatsapp(
  supabase: SupabaseClient,
  input: {
    settings: BillingSettings;
    company: BillingCompanyRow;
    invoice: BillingInvoiceRow;
    /** Sobrepoe o numero do cadastro (reenvio para outro contato). */
    to?: string | null;
  }
): Promise<SendInvoiceResult> {
  const { settings, company, invoice } = input;
  const customer = resolveBillingCustomer(company);
  const target = normalizeWhatsappNumber(input.to ?? customer.phone);

  if (!settings.whatsappUrl || !settings.whatsappInstanceToken) {
    return await failWhatsapp(
      supabase,
      invoice,
      "WhatsApp nao configurado no financeiro (URL e token da instancia)."
    );
  }
  if (!target) {
    return await failWhatsapp(supabase, invoice, "Pedreira sem WhatsApp de cobranca cadastrado.");
  }

  const message = buildInvoiceWhatsappMessage({
    issuerName: settings.issuerName,
    companyName: company.name,
    invoiceNumber: invoice.number,
    referenceLabel: invoice.reference_label,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    amountCents: invoice.amount_cents,
    dueDate: invoice.due_date,
    boletoUrl: invoice.boleto_url,
    boletoBarcode: invoice.boleto_barcode,
    pixKey: settings.issuerPixKey,
    isProrated: invoice.is_prorated,
    proratedDays: invoice.prorated_days,
    fullPeriodDays: invoice.full_period_days,
    supportPhone: settings.issuerPhone,
    template: settings.whatsappMessageTemplate
  });

  try {
    await sendWhatsappText({
      baseUrl: settings.whatsappUrl,
      instanceToken: settings.whatsappInstanceToken,
      to: target,
      text: message,
      trackId: `billing-invoice:${invoice.id}`
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Falha no envio pelo WhatsApp.";
    return await failWhatsapp(supabase, invoice, detail);
  }

  // Anexo best-effort: o texto ja saiu, entao um PDF que nao gera (ou um UAZAPI
  // que recusa o documento) nao pode marcar a fatura como nao enviada.
  let attachmentError: string | null = null;
  try {
    const pdf = await renderInvoicePdf({ settings, company, invoice });
    await sendWhatsappDocument({
      baseUrl: settings.whatsappUrl,
      instanceToken: settings.whatsappInstanceToken,
      to: target,
      base64: pdf.base64,
      fileName: pdf.fileName,
      trackId: `billing-invoice-pdf:${invoice.id}`
    });
  } catch (error) {
    attachmentError = error instanceof Error ? error.message : "Falha ao anexar o PDF.";
  }

  const updated = await updateInvoice(supabase, invoice.id, {
    whatsapp_to: target,
    whatsapp_sent_at: nowIso(),
    whatsapp_error: attachmentError,
    whatsapp_attempts: (invoice.whatsapp_attempts ?? 0) + 1
  });

  await recordBillingEvent(supabase, {
    companyId: company.id,
    invoiceId: invoice.id,
    eventType: "invoice_sent",
    message: `Fatura enviada por WhatsApp para ${target}.`,
    payload: attachmentError ? { attachmentError } : {}
  });

  return { invoice: updated, sent: true, error: attachmentError ?? undefined };
}

async function failWhatsapp(
  supabase: SupabaseClient,
  invoice: BillingInvoiceRow,
  message: string
): Promise<SendInvoiceResult> {
  const updated = await updateInvoice(supabase, invoice.id, {
    whatsapp_error: message,
    whatsapp_attempts: (invoice.whatsapp_attempts ?? 0) + 1
  });
  await recordBillingEvent(supabase, {
    companyId: invoice.company_id,
    invoiceId: invoice.id,
    eventType: "invoice_send_failed",
    message
  });
  return { invoice: updated, sent: false, error: message };
}

/** Texto simples pelo UAZAPI — o mesmo endpoint do envio de relatorios. */
async function sendWhatsappText(input: {
  baseUrl: string;
  instanceToken: string;
  to: string;
  text: string;
  trackId: string;
}): Promise<void> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { token: input.instanceToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      number: input.to,
      text: input.text,
      linkPreview: false,
      async: false,
      track_source: "kyberrock-billing",
      track_id: input.trackId
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`UAZAPI WhatsApp falhou (${response.status}): ${details}`);
  }
}

/** PDF como documento. O UAZAPI aceita base64 direto, entao nao ha bucket envolvido. */
async function sendWhatsappDocument(input: {
  baseUrl: string;
  instanceToken: string;
  to: string;
  base64: string;
  fileName: string;
  trackId: string;
}): Promise<void> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/send/media`, {
    method: "POST",
    headers: { token: input.instanceToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      number: input.to,
      type: "document",
      file: `data:application/pdf;base64,${input.base64}`,
      docName: input.fileName,
      async: false,
      track_source: "kyberrock-billing",
      track_id: input.trackId
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`UAZAPI documento falhou (${response.status}): ${details}`);
  }
}

/** Aviso de bloqueio. Best-effort: o bloqueio vale mesmo sem WhatsApp. */
async function notifyBlock(input: {
  settings: BillingSettings;
  company: BillingCompanyRow;
  invoice: BillingInvoiceRow;
  overdueDays: number;
}): Promise<void> {
  const { settings, company, invoice } = input;
  const target = normalizeWhatsappNumber(resolveBillingCustomer(company).phone);
  if (!target || !settings.whatsappUrl || !settings.whatsappInstanceToken) return;
  await sendWhatsappText({
    baseUrl: settings.whatsappUrl,
    instanceToken: settings.whatsappInstanceToken,
    to: target,
    text: buildBlockNoticeMessage({
      issuerName: settings.issuerName,
      companyName: company.name,
      invoiceNumber: invoice.number,
      amountCents: invoice.amount_cents,
      dueDate: invoice.due_date,
      daysOverdue: input.overdueDays,
      boletoUrl: invoice.boleto_url,
      supportPhone: settings.issuerPhone
    }),
    trackId: `billing-block:${invoice.id}`
  });
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function renderInvoicePdf(input: {
  settings: BillingSettings;
  company: BillingCompanyRow;
  invoice: BillingInvoiceRow;
}): Promise<{ base64: string; fileName: string }> {
  const customer = resolveBillingCustomer(input.company);
  const addressParts = [
    [customer.addressStreet, customer.addressNumber].filter(Boolean).join(", "),
    customer.addressComplement,
    customer.neighborhood,
    [customer.city, customer.state].filter(Boolean).join("/"),
    customer.zipcode ? `CEP ${customer.zipcode}` : ""
  ].filter((part) => part && part.length > 0);

  const bytes = await buildInvoicePdf({
    issuerName: input.settings.issuerName,
    issuerDocument: input.settings.issuerDocument,
    issuerEmail: input.settings.issuerEmail,
    issuerPhone: input.settings.issuerPhone,
    issuerPixKey: input.settings.issuerPixKey,
    invoiceNumber: input.invoice.number,
    referenceLabel: input.invoice.reference_label,
    status: input.invoice.status,
    companyName: input.company.name,
    customerLegalName: customer.legalName,
    customerDocument: customer.document,
    customerAddress: addressParts.join(" - "),
    periodStart: input.invoice.period_start,
    periodEnd: input.invoice.period_end,
    closingDate: input.invoice.closing_date,
    dueDate: input.invoice.due_date,
    baseAmountCents: input.invoice.base_amount_cents,
    discountCents: input.invoice.discount_cents,
    additionCents: input.invoice.addition_cents,
    amountCents: input.invoice.amount_cents,
    isProrated: input.invoice.is_prorated,
    proratedDays: input.invoice.prorated_days,
    fullPeriodDays: input.invoice.full_period_days,
    boletoUrl: input.invoice.boleto_url,
    boletoBarcode: input.invoice.boleto_barcode,
    notes: input.invoice.notes,
    generatedAtLabel: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  });

  return {
    base64: toBase64(bytes),
    fileName: invoicePdfFileName(input.invoice.number, input.invoice.reference_label)
  };
}

// ---------------------------------------------------------------------------
// Liquidacao, vencimento e bloqueio
// ---------------------------------------------------------------------------

/** Quita a fatura e reavalia o bloqueio da pedreira. */
export async function settleInvoice(
  supabase: SupabaseClient,
  input: {
    invoice: BillingInvoiceRow;
    amountCents?: number | null;
    method?: string | null;
    settings?: BillingSettings;
  }
): Promise<BillingInvoiceRow> {
  if (input.invoice.status === "paid") return input.invoice;
  const updated = await updateInvoice(supabase, input.invoice.id, {
    status: "paid",
    paid_at: nowIso(),
    paid_amount_cents: input.amountCents ?? input.invoice.amount_cents,
    payment_method: input.method ?? "manual"
  });
  await recordBillingEvent(supabase, {
    companyId: updated.company_id,
    invoiceId: updated.id,
    eventType: "invoice_paid",
    message: `Fatura ${updated.number} quitada (${formatCents(updated.paid_amount_cents ?? updated.amount_cents)}).`,
    payload: { method: updated.payment_method }
  });
  await evaluateCompanyBlock(supabase, {
    companyId: updated.company_id,
    settings: input.settings
  });
  return updated;
}

/**
 * Marca como vencidas as faturas cujo vencimento passou. Roda antes do bloqueio
 * para que a tela e a decisao de bloquear enxerguem o mesmo estado.
 */
export async function markOverdueInvoices(
  supabase: SupabaseClient,
  today = billingToday()
): Promise<number> {
  const { data, error } = await supabase
    .from("billing_invoices")
    .update({ status: "overdue", updated_at: nowIso() })
    .eq("status", "open")
    .lt("due_date", today)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export interface BlockDecision {
  companyId: string;
  blocked: boolean;
  released: boolean;
  reason?: string;
}

/**
 * Decide o bloqueio de UMA pedreira a partir das faturas em aberto.
 *
 * A liberacao e deliberadamente conservadora: so desbloqueia quem FOI bloqueado
 * por este motor (alguma fatura com `blocked_at`). Sem isso, uma pedreira
 * bloqueada a mao pelo administrador voltaria sozinha assim que a cobranca
 * ficasse em dia — o motor desfaria uma decisao que nao e dele.
 */
export async function evaluateCompanyBlock(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    settings?: BillingSettings;
    today?: string;
    /** Passada automatica: `false` no acionamento manual do painel. */
    notify?: boolean;
  }
): Promise<BlockDecision> {
  const settings = input.settings ?? (await loadBillingSettings(supabase));
  const today = input.today ?? billingToday();
  const company = await getCompany(supabase, input.companyId);

  const { data, error } = await supabase
    .from("billing_invoices")
    .select("*")
    .eq("company_id", input.companyId)
    .in("status", ["open", "overdue"])
    .order("due_date", { ascending: true });
  if (error) throw error;
  const openInvoices = (data ?? []) as unknown as BillingInvoiceRow[];

  const graceDays = resolveGraceDays(company.billing_grace_days, settings.defaultGraceDays);
  const blockingInvoice = company.billing_block_exempt
    ? undefined
    : openInvoices.find((invoice) =>
        shouldBlockForOverdue({ dueDate: invoice.due_date, graceDays, today })
      );

  if (blockingInvoice) {
    if (company.payment_blocked === true && blockingInvoice.blocked_at) {
      return { companyId: company.id, blocked: true, released: false };
    }
    const overdueDays = daysOverdue(blockingInvoice.due_date, today);
    const reason = buildBlockReason({
      invoiceNumber: blockingInvoice.number,
      dueDate: blockingInvoice.due_date,
      daysOverdue: overdueDays
    });
    const blockedAt = nowIso();
    const { error: blockError } = await supabase
      .from("companies")
      .update({
        payment_blocked: true,
        payment_blocked_reason: reason,
        payment_blocked_at: blockedAt,
        updated_at: blockedAt
      })
      .eq("id", company.id);
    if (blockError) throw blockError;
    await updateInvoice(supabase, blockingInvoice.id, { blocked_at: blockedAt });
    await recordBillingEvent(supabase, {
      companyId: company.id,
      invoiceId: blockingInvoice.id,
      eventType: "company_blocked",
      message: reason,
      payload: { graceDays, overdueDays }
    });
    if (input.notify !== false) {
      try {
        await notifyBlock({
          settings,
          company,
          invoice: blockingInvoice,
          overdueDays
        });
      } catch {
        // Aviso e cortesia; o bloqueio ja esta gravado.
      }
    }
    return { companyId: company.id, blocked: true, released: false, reason };
  }

  if (company.payment_blocked !== true) {
    return { companyId: company.id, blocked: false, released: false };
  }

  const { count, error: countError } = await supabase
    .from("billing_invoices")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .not("blocked_at", "is", null);
  if (countError) throw countError;
  if (!count) {
    // Bloqueio veio de fora do financeiro: nao e nosso para desfazer.
    return { companyId: company.id, blocked: true, released: false };
  }

  const releasedAt = nowIso();
  const { error: releaseError } = await supabase
    .from("companies")
    .update({
      payment_blocked: false,
      payment_blocked_reason: null,
      payment_blocked_at: null,
      updated_at: releasedAt
    })
    .eq("id", company.id);
  if (releaseError) throw releaseError;
  await recordBillingEvent(supabase, {
    companyId: company.id,
    eventType: "company_released",
    message: "Acesso liberado: nao ha fatura vencida alem da carencia."
  });
  return { companyId: company.id, blocked: false, released: true };
}

// ---------------------------------------------------------------------------
// Conciliacao com o Mercado Pago
// ---------------------------------------------------------------------------

export interface PaymentSyncResult {
  invoice: BillingInvoiceRow;
  changed: boolean;
  status: string | null;
}

/** Reconsulta o boleto no Mercado Pago e aplica o que mudou. */
export async function refreshInvoicePayment(
  supabase: SupabaseClient,
  input: { settings: BillingSettings; invoice: BillingInvoiceRow }
): Promise<PaymentSyncResult> {
  const { settings, invoice } = input;
  if (!invoice.boleto_payment_id || !settings.mercadoPagoAccessToken) {
    return { invoice, changed: false, status: invoice.boleto_status };
  }

  const payment = await getPayment({
    accessToken: settings.mercadoPagoAccessToken,
    paymentId: invoice.boleto_payment_id
  });

  return await applyPaymentStatus(supabase, { settings, invoice, status: payment.status });
}

/** Aplica um status do Mercado Pago (webhook ou reconsulta) na fatura. */
export async function applyPaymentStatus(
  supabase: SupabaseClient,
  input: { settings: BillingSettings; invoice: BillingInvoiceRow; status: string }
): Promise<PaymentSyncResult> {
  const { invoice, status } = input;

  if (isPaidStatus(status)) {
    if (invoice.status === "paid") {
      return { invoice, changed: false, status };
    }
    const paid = await settleInvoice(supabase, {
      invoice: await updateInvoice(supabase, invoice.id, { boleto_status: status }),
      method: "mercado_pago",
      settings: input.settings
    });
    return { invoice: paid, changed: true, status };
  }

  if (status === invoice.boleto_status) {
    return { invoice, changed: false, status };
  }

  const updated = await updateInvoice(supabase, invoice.id, {
    boleto_status: status,
    ...(isDeadStatus(status)
      ? { boleto_error: `Boleto ${status} no Mercado Pago. Reemita para cobrar novamente.` }
      : {})
  });
  await recordBillingEvent(supabase, {
    companyId: invoice.company_id,
    invoiceId: invoice.id,
    eventType: "boleto_status_changed",
    message: `Boleto passou para "${status}".`
  });
  return { invoice: updated, changed: true, status };
}

// ---------------------------------------------------------------------------
// Passada completa
// ---------------------------------------------------------------------------

export interface BillingRunSummary {
  today: string;
  companiesEvaluated: number;
  invoicesCreated: number;
  boletosIssued: number;
  invoicesSent: number;
  invoicesMarkedOverdue: number;
  paymentsSynced: number;
  companiesBlocked: number;
  companiesReleased: number;
  errors: string[];
}

/**
 * Passada completa do motor. E idempotente: rodar duas vezes no mesmo dia nao
 * gera fatura repetida (indice unico), nao reemite boleto (so emite quando
 * ainda nao ha `boleto_payment_id`) e nao reenvia WhatsApp (so envia quando
 * `whatsapp_sent_at` esta vazio).
 */
export async function runBillingCycle(
  supabase: SupabaseClient,
  options: {
    settings?: BillingSettings;
    today?: string;
    /** Restringe a passada a uma pedreira (botao "rodar agora" do painel). */
    companyId?: string | null;
    /** Ignora `auto_close_enabled` e afins — fechamento manual do painel. */
    force?: boolean;
  } = {}
): Promise<BillingRunSummary> {
  const settings = options.settings ?? (await loadBillingSettings(supabase));
  const today = options.today ?? billingToday();
  const summary: BillingRunSummary = {
    today,
    companiesEvaluated: 0,
    invoicesCreated: 0,
    boletosIssued: 0,
    invoicesSent: 0,
    invoicesMarkedOverdue: 0,
    paymentsSynced: 0,
    companiesBlocked: 0,
    companiesReleased: 0,
    errors: []
  };

  let query = supabase
    .from("companies")
    .select(COMPANY_BILLING_COLUMNS)
    .eq("billing_enabled", true);
  if (options.companyId) query = query.eq("id", options.companyId);
  const { data: companiesData, error: companiesError } = await query;
  if (companiesError) throw companiesError;
  const companies = (companiesData ?? []) as unknown as BillingCompanyRow[];

  for (const company of companies) {
    summary.companiesEvaluated += 1;
    try {
      if (settings.autoCloseEnabled || options.force) {
        await closeDueCyclesForCompany(supabase, { company, settings, today, summary, options });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha no fechamento.";
      summary.errors.push(`${company.name}: ${message}`);
      await recordBillingEvent(supabase, {
        companyId: company.id,
        eventType: "billing_run_failed",
        message
      });
    }
  }

  summary.invoicesMarkedOverdue = await markOverdueInvoices(supabase, today);
  summary.paymentsSynced = await syncOpenPayments(supabase, {
    settings,
    companyId: options.companyId ?? null,
    errors: summary.errors
  });

  // O bloqueio avalia TODAS as pedreiras com fatura viva, nao so as de
  // `billing_enabled`: desligar a cobranca automatica de quem ja deve nao pode
  // virar anistia silenciosa.
  if (!settings.autoBlockEnabled && !options.force) return summary;
  const blockTargets = await companiesToEvaluateForBlock(supabase, options.companyId ?? null);
  for (const companyId of blockTargets) {
    try {
      const decision = await evaluateCompanyBlock(supabase, { companyId, settings, today });
      if (decision.blocked && decision.reason) summary.companiesBlocked += 1;
      if (decision.released) summary.companiesReleased += 1;
    } catch (error) {
      summary.errors.push(
        `Bloqueio ${companyId}: ${error instanceof Error ? error.message : "falhou"}`
      );
    }
  }

  return summary;
}

async function closeDueCyclesForCompany(
  supabase: SupabaseClient,
  input: {
    company: BillingCompanyRow;
    settings: BillingSettings;
    today: string;
    summary: BillingRunSummary;
    options: { force?: boolean };
  }
): Promise<void> {
  const { company, settings, today, summary } = input;
  if (!company.is_active) return;

  const config = resolveBillingConfig({
    startDate: company.billing_start_date,
    closingDay: company.billing_closing_day,
    dueDay: company.billing_due_day,
    defaults: { closingDay: settings.defaultClosingDay, dueDay: settings.defaultDueDay }
  });
  const monthlyAmountCents = Number(company.billing_monthly_amount_cents ?? 0);
  if (!config || monthlyAmountCents <= 0) return;

  const periods = pendingBillingPeriods({
    config,
    lastPeriodEnd: await lastBilledPeriodEnd(supabase, company.id),
    today
  });

  for (const period of periods) {
    const created = await createInvoiceForPeriod(supabase, {
      company,
      period,
      monthlyAmountCents
    });
    if (!created.invoice) continue;
    if (created.created) summary.invoicesCreated += 1;

    let invoice = created.invoice;
    if (
      (settings.autoBoletoEnabled || input.options.force) &&
      !invoice.boleto_payment_id &&
      invoice.status !== "paid"
    ) {
      const issued = await issueBoletoForInvoice(supabase, { settings, company, invoice });
      invoice = issued.invoice;
      if (issued.issued) summary.boletosIssued += 1;
    }

    if (
      (settings.autoWhatsappEnabled || input.options.force) &&
      !invoice.whatsapp_sent_at &&
      invoice.status !== "paid"
    ) {
      const sent = await sendInvoiceWhatsapp(supabase, { settings, company, invoice });
      invoice = sent.invoice;
      if (sent.sent) summary.invoicesSent += 1;
    }
  }
}

async function syncOpenPayments(
  supabase: SupabaseClient,
  input: { settings: BillingSettings; companyId: string | null; errors: string[] }
): Promise<number> {
  if (!input.settings.mercadoPagoAccessToken) return 0;
  let query = supabase
    .from("billing_invoices")
    .select("*")
    .in("status", ["open", "overdue"])
    .not("boleto_payment_id", "is", null)
    .order("due_date", { ascending: true })
    .limit(MAX_PAYMENT_POLLS_PER_RUN);
  if (input.companyId) query = query.eq("company_id", input.companyId);

  const { data, error } = await query;
  if (error) throw error;
  const invoices = (data ?? []) as unknown as BillingInvoiceRow[];

  let changed = 0;
  for (const invoice of invoices) {
    try {
      const result = await refreshInvoicePayment(supabase, {
        settings: input.settings,
        invoice
      });
      if (result.changed) changed += 1;
    } catch (error) {
      input.errors.push(
        `Consulta do boleto ${invoice.number}: ${error instanceof Error ? error.message : "falhou"}`
      );
    }
  }
  return changed;
}

/**
 * Quem o bloqueio precisa olhar nesta passada: pedreira com fatura viva (pode
 * passar da carencia) e pedreira que ESTE motor ja bloqueou (pode ter quitado
 * fora do fluxo — baixa manual no painel, pagamento conciliado por outra
 * passada — e merecer a liberacao). Sem o segundo grupo, quem pagou tudo saia
 * da lista de faturas vivas e ficava bloqueado para sempre.
 */
async function companiesToEvaluateForBlock(
  supabase: SupabaseClient,
  companyId: string | null
): Promise<string[]> {
  let liveQuery = supabase
    .from("billing_invoices")
    .select("company_id")
    .in("status", ["open", "overdue"]);
  if (companyId) liveQuery = liveQuery.eq("company_id", companyId);

  let blockedQuery = supabase
    .from("billing_invoices")
    .select("company_id")
    .not("blocked_at", "is", null);
  if (companyId) blockedQuery = blockedQuery.eq("company_id", companyId);

  const [live, blocked] = await Promise.all([liveQuery, blockedQuery]);
  if (live.error) throw live.error;
  if (blocked.error) throw blocked.error;

  const rows = [
    ...((live.data ?? []) as Array<{ company_id: string }>),
    ...((blocked.data ?? []) as Array<{ company_id: string }>)
  ];
  return [...new Set(rows.map((row) => row.company_id))];
}
