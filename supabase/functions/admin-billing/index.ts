// API do backoffice financeiro (aba "Financeiro" do painel administrativo).
//
// Fica separada do `admin-api` de proposito: cadastro e cobranca sao dois
// assuntos com ritmo e risco diferentes, e o `admin-api` ja carrega usuarios,
// dispositivos e OMIE. Aqui vive tudo que mexe em dinheiro — fatura, boleto do
// Mercado Pago, envio por WhatsApp e bloqueio por inadimplencia.
//
// Autenticacao: a MESMA sessao administrativa do `admin-api`
// (`verifyAdminSession` sobre o header `x-admin-session`), entao quem entra no
// painel ja entra no financeiro, sem segundo login.
//
// As regras nao moram aqui: fechamento, emissao, envio e bloqueio sao os mesmos
// de `_shared/billing-engine.ts` usados pela passada automatica do
// `billing-run`. Esta funcao so traduz acao do painel em chamada do motor.
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyAdminSession } from "../_shared/admin-session.ts";
import {
  BILLING_SETTINGS_ID,
  BILLING_SETTINGS_TABLE,
  COMPANY_BILLING_COLUMNS,
  buildCompanyBillingPlan,
  evaluateCompanyBlock,
  createInvoiceForPeriod,
  getCompany,
  getInvoice,
  issueBoletoForInvoice,
  loadBillingSettings,
  markOverdueInvoices,
  recordBillingEvent,
  refreshInvoicePayment,
  renderInvoicePdf,
  runBillingCycle,
  sendInvoiceWhatsapp,
  settleInvoice
} from "../_shared/billing-engine.ts";
import type { BillingCompanyRow, BillingInvoiceRow } from "../_shared/billing-engine.ts";
import {
  billingToday,
  invoiceTotalCents,
  pendingBillingPeriods,
  proratedAmountCents,
  resolveBillingConfig,
  upcomingBillingPeriod
} from "../_shared/billing-cycle.ts";
import { missingBillingFields, resolveBillingCustomer } from "../_shared/billing-invoice.ts";
import { cancelPayment } from "../_shared/mercado-pago.ts";
import { BILLING_SECRETS, describeEnvVarNameError } from "../_shared/billing-secrets.ts";

/**
 * Cliente generico do Supabase. Nao usamos `ReturnType<typeof createClient>`
 * porque, sem um tipo `Database` gerado, o retorno concreto tipa as tabelas
 * como `never` e todo `.update()` deste arquivo vira erro de compilacao —
 * mesmo o payload sendo valido em tempo de execucao.
 */
type SupabaseAdminClient = SupabaseClient;

type BillingAction =
  | "list"
  | "update_settings"
  | "update_company_billing"
  | "preview_invoice"
  | "generate_invoice"
  | "issue_boleto"
  | "send_invoice"
  | "refresh_invoice"
  | "update_invoice"
  | "mark_invoice_paid"
  | "cancel_invoice"
  | "delete_invoice"
  | "invoice_pdf"
  | "invoice_events"
  | "set_payment_block"
  | "run_cycle";

/** Teto da listagem de faturas do painel. Alem disso a tela pagina por pedreira. */
const INVOICE_LIST_LIMIT = 500;

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function optionalText(value: unknown): string | null {
  const result = text(value);
  return result.length > 0 ? result : null;
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = optionalInt(value);
  return parsed === null || parsed < 0 ? fallback : parsed;
}

/** Data `YYYY-MM-DD` ou null; o painel manda string vazia para limpar. */
function optionalDate(value: unknown): string | null {
  const result = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const sessionSecret = Deno.env.get("KYBERROCK_ADMIN_SESSION_SECRET") ?? "";
  const session = await verifyAdminSession(req.headers.get("x-admin-session"), sessionSecret);
  if (!session) return jsonResponse({ error: "Sessao administrativa invalida" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const body = (await req.json().catch(() => ({}))) as {
    action?: BillingAction;
    payload?: Record<string, unknown>;
  };
  const payload = body.payload ?? {};

  try {
    switch (body.action) {
      case "list":
        return await handleList(supabase);
      case "update_settings":
        return await handleUpdateSettings(supabase, payload);
      case "update_company_billing":
        return await handleUpdateCompanyBilling(supabase, payload);
      case "preview_invoice":
        return await handlePreviewInvoice(supabase, payload);
      case "generate_invoice":
        return await handleGenerateInvoice(supabase, payload);
      case "issue_boleto":
        return await handleIssueBoleto(supabase, payload);
      case "send_invoice":
        return await handleSendInvoice(supabase, payload);
      case "refresh_invoice":
        return await handleRefreshInvoice(supabase, payload);
      case "update_invoice":
        return await handleUpdateInvoice(supabase, payload);
      case "mark_invoice_paid":
        return await handleMarkInvoicePaid(supabase, payload);
      case "cancel_invoice":
        return await handleCancelInvoice(supabase, payload);
      case "delete_invoice":
        return await handleDeleteInvoice(supabase, payload);
      case "invoice_pdf":
        return await handleInvoicePdf(supabase, payload);
      case "invoice_events":
        return await handleInvoiceEvents(supabase, payload);
      case "set_payment_block":
        return await handleSetPaymentBlock(supabase, payload);
      case "run_cycle":
        return await handleRunCycle(supabase, payload);
      default:
        return jsonResponse({ error: "Invalid action" }, 400);
    }
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 400);
  }
});

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

/**
 * Tudo que a tela precisa numa chamada so: configuracao (mascarada), pedreiras
 * com a situacao de cobranca e as faturas recentes.
 *
 * O `lastPeriodEnd` de cada pedreira sai das faturas ja carregadas, e nao de uma
 * consulta por pedreira: com 40 pedreiras seriam 40 idas ao banco para montar
 * uma tela.
 */
async function handleList(supabase: SupabaseAdminClient): Promise<Response> {
  const settings = await loadBillingSettings(supabase);

  const [companiesResult, invoicesResult] = await Promise.all([
    supabase.from("companies").select(COMPANY_BILLING_COLUMNS).order("name", { ascending: true }),
    supabase
      .from("billing_invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(INVOICE_LIST_LIMIT)
  ]);
  if (companiesResult.error) throw companiesResult.error;
  if (invoicesResult.error) throw invoicesResult.error;

  const companies = (companiesResult.data ?? []) as unknown as BillingCompanyRow[];
  const invoices = (invoicesResult.data ?? []) as unknown as BillingInvoiceRow[];

  const lastPeriodEndByCompany = new Map<string, string>();
  for (const invoice of invoices) {
    if (invoice.status === "canceled") continue;
    const current = lastPeriodEndByCompany.get(invoice.company_id);
    if (!current || invoice.period_end > current) {
      lastPeriodEndByCompany.set(invoice.company_id, invoice.period_end);
    }
  }

  const today = billingToday();
  const companyViews = companies.map((company) => {
    const plan = buildCompanyBillingPlan({
      company,
      settings,
      lastPeriodEnd: lastPeriodEndByCompany.get(company.id) ?? null
    });
    const customer = resolveBillingCustomer(company);
    return {
      ...company,
      billing_plan: {
        graceDays: plan.graceDays,
        closingDay: plan.closingDay,
        dueDay: plan.dueDay,
        monthlyAmountCents: plan.monthlyAmountCents,
        nextPeriod: plan.nextPeriod,
        nextAmountCents: plan.nextPeriod
          ? proratedAmountCents({
              monthlyAmountCents: plan.monthlyAmountCents,
              billedDays: plan.nextPeriod.billedDays,
              fullPeriodDays: plan.nextPeriod.fullPeriodDays
            })
          : null,
        blockers: plan.blockers,
        missing: missingBillingFields(customer),
        readyToClose: plan.blockers.length === 0
      }
    };
  });

  const openInvoices = invoices.filter(
    (invoice) => invoice.status === "open" || invoice.status === "overdue"
  );

  return jsonResponse({
    ok: true,
    today,
    settings: {
      mercadoPagoEnvironment: settings.mercadoPagoEnvironment,
      // Os segredos aparecem so como nome da variavel + situacao. O valor fica
      // no secret do Supabase e nao trafega para o navegador em nenhum momento.
      secrets: settings.secrets,
      whatsappUrl: settings.whatsappUrl,
      whatsappInstanceName: settings.whatsappInstanceName,
      whatsappStatus: settings.whatsappStatus,
      defaultClosingDay: settings.defaultClosingDay,
      defaultDueDay: settings.defaultDueDay,
      defaultGraceDays: settings.defaultGraceDays,
      autoCloseEnabled: settings.autoCloseEnabled,
      autoBoletoEnabled: settings.autoBoletoEnabled,
      autoWhatsappEnabled: settings.autoWhatsappEnabled,
      autoBlockEnabled: settings.autoBlockEnabled,
      issuerName: settings.issuerName,
      issuerDocument: settings.issuerDocument,
      issuerEmail: settings.issuerEmail,
      issuerPhone: settings.issuerPhone,
      issuerPixKey: settings.issuerPixKey,
      invoiceDescriptionTemplate: settings.invoiceDescriptionTemplate,
      whatsappMessageTemplate: settings.whatsappMessageTemplate
    },
    companies: companyViews,
    invoices,
    summary: {
      openCount: openInvoices.length,
      openAmountCents: openInvoices.reduce((total, invoice) => total + invoice.amount_cents, 0),
      overdueCount: invoices.filter((invoice) => invoice.status === "overdue").length,
      overdueAmountCents: invoices
        .filter((invoice) => invoice.status === "overdue")
        .reduce((total, invoice) => total + invoice.amount_cents, 0),
      paidCount: invoices.filter((invoice) => invoice.status === "paid").length,
      paidAmountCents: invoices
        .filter((invoice) => invoice.status === "paid")
        .reduce((total, invoice) => total + (invoice.paid_amount_cents ?? invoice.amount_cents), 0),
      blockedCompanies: companies.filter((company) => company.payment_blocked === true).length,
      billedCompanies: companies.filter((company) => company.billing_enabled).length,
      monthlyRecurringCents: companies
        .filter((company) => company.billing_enabled)
        .reduce((total, company) => total + Number(company.billing_monthly_amount_cents ?? 0), 0)
    }
  });
}

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

async function handleUpdateSettings(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const update: Record<string, unknown> = {
    id: BILLING_SETTINGS_ID,
    updated_at: new Date().toISOString()
  };

  if (payload.mercadoPagoEnvironment !== undefined) {
    update.mercado_pago_environment =
      text(payload.mercadoPagoEnvironment) === "sandbox" ? "sandbox" : "production";
  }
  // Segredo NAO passa por aqui. A tela envia apenas o NOME da variavel de
  // ambiente; o valor vive no secret do Supabase e e lido pela Edge Function.
  // Colar o token no campo do nome e o erro provavel, entao ele e recusado com
  // uma mensagem que diz onde o valor deve ir.
  for (const definition of BILLING_SECRETS) {
    const field = `${definition.key}Env`;
    if (payload[field] === undefined) continue;
    const name = text(payload[field]);
    const error = describeEnvVarNameError(name);
    if (error) return jsonResponse({ error: `${definition.label}: ${error}` }, 400);
    update[definition.column] = name.length > 0 ? name : null;
  }

  if (payload.whatsappUrl !== undefined) update.whatsapp_url = optionalText(payload.whatsappUrl);
  if (payload.whatsappInstanceName !== undefined) {
    update.whatsapp_instance_name = optionalText(payload.whatsappInstanceName);
  }
  if (payload.defaultClosingDay !== undefined) {
    update.default_closing_day = clampDay(payload.defaultClosingDay, 25);
  }
  if (payload.defaultDueDay !== undefined) {
    update.default_due_day = clampDay(payload.defaultDueDay, 5);
  }
  if (payload.defaultGraceDays !== undefined) {
    const graceDays = optionalInt(payload.defaultGraceDays);
    if (graceDays === null || graceDays < 0 || graceDays > 365) {
      return jsonResponse({ error: "Dias de inadimplencia deve ficar entre 0 e 365." }, 400);
    }
    update.default_grace_days = graceDays;
  }
  for (const [field, column] of [
    ["autoCloseEnabled", "auto_close_enabled"],
    ["autoBoletoEnabled", "auto_boleto_enabled"],
    ["autoWhatsappEnabled", "auto_whatsapp_enabled"],
    ["autoBlockEnabled", "auto_block_enabled"]
  ] as const) {
    if (payload[field] !== undefined) update[column] = payload[field] === true;
  }
  for (const [field, column] of [
    ["issuerName", "issuer_name"],
    ["issuerDocument", "issuer_document"],
    ["issuerEmail", "issuer_email"],
    ["issuerPhone", "issuer_phone"],
    ["issuerPixKey", "issuer_pix_key"],
    ["invoiceDescriptionTemplate", "invoice_description_template"],
    ["whatsappMessageTemplate", "whatsapp_message_template"]
  ] as const) {
    if (payload[field] !== undefined) update[column] = optionalText(payload[field]);
  }

  const { error } = await supabase.from(BILLING_SETTINGS_TABLE).upsert(update);
  if (error) throw error;
  await recordBillingEvent(supabase, {
    eventType: "settings_updated",
    message: "Configuracao do financeiro atualizada."
  });
  return jsonResponse({ ok: true });
}

function clampDay(value: unknown, fallback: number): number {
  const day = optionalInt(value);
  if (day === null) return fallback;
  return Math.min(Math.max(day, 1), 31);
}

// ---------------------------------------------------------------------------
// Cadastro de cobranca da pedreira
// ---------------------------------------------------------------------------

async function handleUpdateCompanyBilling(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const companyId = text(payload.companyId);
  if (!companyId) return jsonResponse({ error: "Pedreira nao informada" }, 400);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const [field, column] of [
    ["billingLegalName", "billing_legal_name"],
    ["billingDocument", "billing_document"],
    ["billingEmail", "billing_email"],
    ["billingPhone", "billing_phone"],
    ["billingContactName", "billing_contact_name"],
    ["billingZipcode", "billing_zipcode"],
    ["billingAddressStreet", "billing_address_street"],
    ["billingAddressNumber", "billing_address_number"],
    ["billingAddressComplement", "billing_address_complement"],
    ["billingNeighborhood", "billing_neighborhood"],
    ["billingCity", "billing_city"],
    ["billingState", "billing_state"],
    ["billingNotes", "billing_notes"]
  ] as const) {
    if (payload[field] !== undefined) update[column] = optionalText(payload[field]);
  }

  if (payload.billingMonthlyAmountCents !== undefined) {
    const amount = optionalInt(payload.billingMonthlyAmountCents);
    if (amount !== null && amount < 0) {
      return jsonResponse({ error: "O valor acertado nao pode ser negativo." }, 400);
    }
    update.billing_monthly_amount_cents = amount;
  }
  if (payload.billingStartDate !== undefined) {
    update.billing_start_date = optionalDate(payload.billingStartDate);
  }
  if (payload.billingClosingDay !== undefined) {
    const day = optionalInt(payload.billingClosingDay);
    if (day !== null && (day < 1 || day > 31)) {
      return jsonResponse({ error: "O dia do fechamento deve ficar entre 1 e 31." }, 400);
    }
    update.billing_closing_day = day;
  }
  if (payload.billingDueDay !== undefined) {
    const day = optionalInt(payload.billingDueDay);
    if (day !== null && (day < 1 || day > 31)) {
      return jsonResponse({ error: "O dia do vencimento deve ficar entre 1 e 31." }, 400);
    }
    update.billing_due_day = day;
  }
  if (payload.billingGraceDays !== undefined) {
    const graceDays = optionalInt(payload.billingGraceDays);
    if (graceDays !== null && (graceDays < 0 || graceDays > 365)) {
      return jsonResponse({ error: "Os dias de inadimplencia devem ficar entre 0 e 365." }, 400);
    }
    update.billing_grace_days = graceDays;
  }
  if (payload.billingEnabled !== undefined)
    update.billing_enabled = payload.billingEnabled === true;
  if (payload.billingBlockExempt !== undefined) {
    update.billing_block_exempt = payload.billingBlockExempt === true;
  }

  const { error } = await supabase.from("companies").update(update).eq("id", companyId);
  if (error) throw error;

  await recordBillingEvent(supabase, {
    companyId,
    eventType: "company_billing_updated",
    message: "Cadastro de cobranca atualizado."
  });

  // Mudar carencia ou isencao pode liberar (ou travar) o acesso agora mesmo;
  // esperar a proxima passada do cron deixaria a balanca parada a toa.
  const settings = await loadBillingSettings(supabase);
  await evaluateCompanyBlock(supabase, { companyId, settings, notify: false });

  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// Fechamento e fatura
// ---------------------------------------------------------------------------

/** O que sairia no proximo fechamento, sem gravar nada. */
async function handlePreviewInvoice(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const companyId = text(payload.companyId);
  if (!companyId) return jsonResponse({ error: "Pedreira nao informada" }, 400);

  const settings = await loadBillingSettings(supabase);
  const company = await getCompany(supabase, companyId);
  const config = resolveBillingConfig({
    startDate: company.billing_start_date,
    closingDay: company.billing_closing_day,
    dueDay: company.billing_due_day,
    defaults: { closingDay: settings.defaultClosingDay, dueDay: settings.defaultDueDay }
  });
  if (!config) {
    return jsonResponse({ error: "Informe a data de virada do sistema desta pedreira." }, 400);
  }

  const { data, error } = await supabase
    .from("billing_invoices")
    .select("period_end")
    .eq("company_id", companyId)
    .neq("status", "canceled")
    .order("period_end", { ascending: false })
    .limit(1);
  if (error) throw error;
  const lastPeriodEnd =
    ((data ?? [])[0] as { period_end?: string } | undefined)?.period_end ?? null;

  const today = billingToday();
  const monthlyAmountCents = Number(company.billing_monthly_amount_cents ?? 0);
  const nextPeriod = upcomingBillingPeriod(config, lastPeriodEnd);
  const duePeriods = pendingBillingPeriods({ config, lastPeriodEnd, today });

  return jsonResponse({
    ok: true,
    today,
    monthlyAmountCents,
    nextPeriod: {
      ...nextPeriod,
      amountCents: proratedAmountCents({
        monthlyAmountCents,
        billedDays: nextPeriod.billedDays,
        fullPeriodDays: nextPeriod.fullPeriodDays
      })
    },
    duePeriods: duePeriods.map((period) => ({
      ...period,
      amountCents: proratedAmountCents({
        monthlyAmountCents,
        billedDays: period.billedDays,
        fullPeriodDays: period.fullPeriodDays
      })
    })),
    missing: missingBillingFields(resolveBillingCustomer(company))
  });
}

/**
 * Fechamento manual. Sem `force`, so fecha ciclo cujo fechamento ja chegou —
 * fechar o mes que vem por engano geraria boleto com vencimento errado. Com
 * `force`, antecipa o proximo ciclo (usado para cobrar uma pedreira que entrou
 * fora do calendario).
 */
async function handleGenerateInvoice(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const companyId = text(payload.companyId);
  if (!companyId) return jsonResponse({ error: "Pedreira nao informada" }, 400);

  const settings = await loadBillingSettings(supabase);
  const company = await getCompany(supabase, companyId);
  const monthlyAmountCents = Number(company.billing_monthly_amount_cents ?? 0);
  if (monthlyAmountCents <= 0) {
    return jsonResponse({ error: "Informe o valor acertado desta pedreira." }, 400);
  }

  const config = resolveBillingConfig({
    startDate: company.billing_start_date,
    closingDay: company.billing_closing_day,
    dueDay: company.billing_due_day,
    defaults: { closingDay: settings.defaultClosingDay, dueDay: settings.defaultDueDay }
  });
  if (!config) {
    return jsonResponse({ error: "Informe a data de virada do sistema desta pedreira." }, 400);
  }

  const { data, error } = await supabase
    .from("billing_invoices")
    .select("period_end")
    .eq("company_id", companyId)
    .neq("status", "canceled")
    .order("period_end", { ascending: false })
    .limit(1);
  if (error) throw error;
  const lastPeriodEnd =
    ((data ?? [])[0] as { period_end?: string } | undefined)?.period_end ?? null;

  const today = billingToday();
  const force = payload.force === true;
  const periods = force
    ? [upcomingBillingPeriod(config, lastPeriodEnd)]
    : pendingBillingPeriods({ config, lastPeriodEnd, today });

  if (periods.length === 0) {
    return jsonResponse(
      {
        error: `Nenhum ciclo fechado ate hoje (${today}). Use "antecipar fechamento" para cobrar assim mesmo.`
      },
      400
    );
  }

  const created: BillingInvoiceRow[] = [];
  const warnings: string[] = [];

  for (const period of periods) {
    const result = await createInvoiceForPeriod(supabase, {
      company,
      period,
      monthlyAmountCents,
      notes: optionalText(payload.notes)
    });
    if (!result.invoice) {
      warnings.push(result.skippedReason ?? "Ciclo nao gerado.");
      continue;
    }
    if (!result.created) {
      warnings.push(`Ciclo ${period.referenceLabel} ja possuia fatura.`);
      continue;
    }

    let invoice = result.invoice;
    if (payload.issueBoleto !== false) {
      const issued = await issueBoletoForInvoice(supabase, { settings, company, invoice });
      invoice = issued.invoice;
      if (issued.error) warnings.push(`Boleto ${invoice.number}: ${issued.error}`);
    }
    if (payload.sendWhatsapp !== false) {
      const sent = await sendInvoiceWhatsapp(supabase, { settings, company, invoice });
      invoice = sent.invoice;
      if (sent.error) warnings.push(`WhatsApp ${invoice.number}: ${sent.error}`);
    }
    created.push(invoice);
  }

  return jsonResponse({ ok: true, invoices: created, warnings });
}

async function handleIssueBoleto(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const { invoice, company, settings } = await loadInvoiceContext(supabase, payload.invoiceId);
  const result = await issueBoletoForInvoice(supabase, {
    settings,
    company,
    invoice,
    reissue: payload.reissue === true
  });
  if (!result.issued) return jsonResponse({ error: result.error ?? "Boleto nao emitido." }, 400);
  return jsonResponse({ ok: true, invoice: result.invoice });
}

async function handleSendInvoice(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const { invoice, company, settings } = await loadInvoiceContext(supabase, payload.invoiceId);
  const result = await sendInvoiceWhatsapp(supabase, {
    settings,
    company,
    invoice,
    to: optionalText(payload.to)
  });
  if (!result.sent) return jsonResponse({ error: result.error ?? "Fatura nao enviada." }, 400);
  return jsonResponse({ ok: true, invoice: result.invoice, warning: result.error ?? null });
}

async function handleRefreshInvoice(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const { invoice, settings } = await loadInvoiceContext(supabase, payload.invoiceId);
  if (!invoice.boleto_payment_id) {
    return jsonResponse({ error: "Esta fatura ainda nao tem boleto emitido." }, 400);
  }
  const result = await refreshInvoicePayment(supabase, { settings, invoice });
  return jsonResponse({ ok: true, invoice: result.invoice, status: result.status });
}

/**
 * Ajuste manual da fatura. O total e sempre derivado (base + acrescimo -
 * desconto): deixar o operador digitar o total e os componentes ao mesmo tempo
 * criaria fatura que nao fecha com o proprio demonstrativo.
 */
async function handleUpdateInvoice(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const invoice = await getInvoice(supabase, text(payload.invoiceId));
  if (invoice.status === "paid" || invoice.status === "canceled") {
    return jsonResponse({ error: "Fatura paga ou cancelada nao pode ser alterada." }, 400);
  }

  const baseAmountCents =
    payload.baseAmountCents === undefined
      ? invoice.base_amount_cents
      : nonNegativeInt(payload.baseAmountCents, invoice.base_amount_cents);
  const discountCents =
    payload.discountCents === undefined
      ? invoice.discount_cents
      : nonNegativeInt(payload.discountCents, 0);
  const additionCents =
    payload.additionCents === undefined
      ? invoice.addition_cents
      : nonNegativeInt(payload.additionCents, 0);
  const dueDate = optionalDate(payload.dueDate) ?? invoice.due_date;
  const amountCents = invoiceTotalCents({ baseAmountCents, discountCents, additionCents });

  const update: Record<string, unknown> = {
    base_amount_cents: baseAmountCents,
    discount_cents: discountCents,
    addition_cents: additionCents,
    amount_cents: amountCents,
    due_date: dueDate,
    updated_at: new Date().toISOString()
  };
  if (payload.notes !== undefined) update.notes = optionalText(payload.notes);

  // Boleto ja emitido carrega o valor e o vencimento ANTIGOS. Alterar a fatura
  // nao muda o papel que o cliente recebeu, entao a tela precisa dizer que a
  // reemissao ficou obrigatoria — senao a cobranca e a fatura divergem calado.
  const changedCharge = amountCents !== invoice.amount_cents || dueDate !== invoice.due_date;
  if (changedCharge && invoice.boleto_payment_id) {
    update.boleto_error = "Fatura alterada depois da emissao: reemita o boleto.";
  }

  const { data, error } = await supabase
    .from("billing_invoices")
    .update(update)
    .eq("id", invoice.id)
    .select("*")
    .single();
  if (error) throw error;

  await recordBillingEvent(supabase, {
    companyId: invoice.company_id,
    invoiceId: invoice.id,
    eventType: "invoice_updated",
    message: "Fatura ajustada no painel.",
    payload: { amountCents, dueDate }
  });
  return jsonResponse({ ok: true, invoice: data });
}

async function handleMarkInvoicePaid(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const invoice = await getInvoice(supabase, text(payload.invoiceId));
  if (invoice.status === "canceled") {
    return jsonResponse({ error: "Fatura cancelada nao pode ser quitada." }, 400);
  }
  const settings = await loadBillingSettings(supabase);
  const paid = await settleInvoice(supabase, {
    invoice,
    amountCents: optionalInt(payload.amountCents) ?? invoice.amount_cents,
    method: optionalText(payload.method) ?? "manual",
    settings
  });
  return jsonResponse({ ok: true, invoice: paid });
}

/**
 * Cancela a fatura e, quando houver, o boleto no Mercado Pago — deixar o boleto
 * vivo faria o cliente pagar uma cobranca que o painel considera cancelada.
 */
async function handleCancelInvoice(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const { invoice, settings } = await loadInvoiceContext(supabase, payload.invoiceId);
  if (invoice.status === "paid") {
    return jsonResponse({ error: "Fatura paga nao pode ser cancelada." }, 400);
  }

  let boletoWarning: string | null = null;
  if (invoice.boleto_payment_id && settings.mercadoPagoAccessToken) {
    try {
      await cancelPayment({
        accessToken: settings.mercadoPagoAccessToken,
        paymentId: invoice.boleto_payment_id
      });
    } catch (error) {
      boletoWarning = error instanceof Error ? error.message : "Boleto nao pode ser cancelado.";
    }
  }

  const { data, error } = await supabase
    .from("billing_invoices")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      cancel_reason: optionalText(payload.reason),
      updated_at: new Date().toISOString()
    })
    .eq("id", invoice.id)
    .select("*")
    .single();
  if (error) throw error;

  await recordBillingEvent(supabase, {
    companyId: invoice.company_id,
    invoiceId: invoice.id,
    eventType: "invoice_canceled",
    message: optionalText(payload.reason) ?? "Fatura cancelada no painel."
  });
  // Cancelar a unica fatura vencida tira o motivo do bloqueio.
  await evaluateCompanyBlock(supabase, {
    companyId: invoice.company_id,
    settings,
    notify: false
  });

  return jsonResponse({ ok: true, invoice: data, warning: boletoWarning });
}

/**
 * Exclusao definitiva. Existe porque o painel precisa poder limpar teste e erro
 * de cadastro, mas fatura PAGA nao se apaga: e o registro do dinheiro que
 * entrou. Para essa, o caminho e cancelar.
 */
async function handleDeleteInvoice(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const invoice = await getInvoice(supabase, text(payload.invoiceId));
  if (invoice.status === "paid") {
    return jsonResponse(
      { error: "Fatura paga nao pode ser excluida. Cancele-a se necessario." },
      400
    );
  }
  const { error } = await supabase.from("billing_invoices").delete().eq("id", invoice.id);
  if (error) throw error;
  await recordBillingEvent(supabase, {
    companyId: invoice.company_id,
    eventType: "invoice_deleted",
    message: `Fatura ${invoice.number} excluida do painel.`
  });
  const settings = await loadBillingSettings(supabase);
  await evaluateCompanyBlock(supabase, {
    companyId: invoice.company_id,
    settings,
    notify: false
  });
  return jsonResponse({ ok: true });
}

async function handleInvoicePdf(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const { invoice, company, settings } = await loadInvoiceContext(supabase, payload.invoiceId);
  const pdf = await renderInvoicePdf({ settings, company, invoice });
  return jsonResponse({ ok: true, fileName: pdf.fileName, base64: pdf.base64 });
}

async function handleInvoiceEvents(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const invoiceId = optionalText(payload.invoiceId);
  const companyId = optionalText(payload.companyId);
  let query = supabase
    .from("billing_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (invoiceId) query = query.eq("invoice_id", invoiceId);
  else if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await query;
  if (error) throw error;
  return jsonResponse({ ok: true, events: data ?? [] });
}

// ---------------------------------------------------------------------------
// Bloqueio e passada manual
// ---------------------------------------------------------------------------

/**
 * Bloqueio/desbloqueio manual. Bloquear a mao e uma decisao do administrador,
 * entao ela nao carrega `blocked_at` em fatura nenhuma — e justamente isso que
 * impede a passada automatica de desfazer o bloqueio na madrugada seguinte.
 */
async function handleSetPaymentBlock(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  const companyId = text(payload.companyId);
  if (!companyId) return jsonResponse({ error: "Pedreira nao informada" }, 400);
  const blocked = payload.blocked === true;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("companies")
    .update({
      payment_blocked: blocked,
      payment_blocked_reason: blocked
        ? (optionalText(payload.reason) ?? "Bloqueio manual do financeiro.")
        : null,
      payment_blocked_at: blocked ? now : null,
      updated_at: now
    })
    .eq("id", companyId);
  if (error) throw error;

  // Liberar a mao tambem limpa as marcas de bloqueio automatico: sem isso a
  // proxima passada veria a fatura vencida ainda marcada e bloquearia de novo
  // no mesmo dia, desfazendo a decisao do administrador.
  if (!blocked) {
    const { error: clearError } = await supabase
      .from("billing_invoices")
      .update({ blocked_at: null, updated_at: now })
      .eq("company_id", companyId)
      .not("blocked_at", "is", null);
    if (clearError) throw clearError;
  }

  await recordBillingEvent(supabase, {
    companyId,
    eventType: blocked ? "company_blocked_manually" : "company_released_manually",
    message: blocked
      ? (optionalText(payload.reason) ?? "Bloqueio manual do financeiro.")
      : "Acesso liberado manualmente pelo financeiro."
  });
  return jsonResponse({ ok: true });
}

async function handleRunCycle(
  supabase: SupabaseAdminClient,
  payload: Record<string, unknown>
): Promise<Response> {
  await markOverdueInvoices(supabase);
  const summary = await runBillingCycle(supabase, {
    companyId: optionalText(payload.companyId),
    force: payload.force === true
  });
  return jsonResponse({ ok: true, summary });
}

// ---------------------------------------------------------------------------

async function loadInvoiceContext(
  supabase: SupabaseAdminClient,
  invoiceId: unknown
): Promise<{
  invoice: BillingInvoiceRow;
  company: BillingCompanyRow;
  settings: Awaited<ReturnType<typeof loadBillingSettings>>;
}> {
  const id = text(invoiceId);
  if (!id) throw new Error("Fatura nao informada");
  const invoice = await getInvoice(supabase, id);
  const [company, settings] = await Promise.all([
    getCompany(supabase, invoice.company_id),
    loadBillingSettings(supabase)
  ]);
  return { invoice, company, settings };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Erro inesperado");
  }
  return "Erro inesperado";
}
