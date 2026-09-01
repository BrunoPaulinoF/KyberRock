// Tipos e helpers de apresentacao do backoffice financeiro.
//
// Nada de regra de negocio aqui: quem decide fechamento, vencimento, rateio e
// bloqueio e o `_shared/billing-cycle.ts` das Edge Functions, e a tela recebe o
// resultado pronto em `billing_plan`. O que vive neste arquivo e o que a tela
// precisa para MOSTRAR — formatacao de dinheiro e data, rotulo de status,
// filtro e totalizacao — coberto por `billing.test.ts`.
//
// A duplicacao de formatadores com `packages/shared` e proposital: o loader-web
// nao depende de `@kyberrock/shared` (o Dockerfile so instala e builda este
// workspace), e criar essa dependencia por causa de dois formatadores custaria
// mais que os poucos que estao aqui.

import { rankBySearch } from "./search-ranking";

export type InvoiceStatus = "draft" | "open" | "paid" | "overdue" | "canceled";

export interface BillingPeriodView {
  periodStart: string;
  periodEnd: string;
  closingDate: string;
  dueDate: string;
  billedDays: number;
  fullPeriodDays: number;
  isProrated: boolean;
  referenceLabel: string;
  amountCents?: number;
}

export interface BillingPlanView {
  graceDays: number;
  closingDay: number;
  dueDay: number;
  monthlyAmountCents: number;
  nextPeriod: BillingPeriodView | null;
  nextAmountCents: number | null;
  blockers: string[];
  missing: { boleto: string[]; whatsapp: string[] };
  readyToClose: boolean;
}

export interface BillingCompany {
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
  billing_plan: BillingPlanView;
}

export interface BillingInvoice {
  id: string;
  company_id: string;
  number: string;
  status: InvoiceStatus;
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
  boleto_status: string | null;
  boleto_payment_id: string | null;
  boleto_url: string | null;
  boleto_barcode: string | null;
  boleto_error: string | null;
  boleto_issued_at: string | null;
  whatsapp_to: string | null;
  whatsapp_sent_at: string | null;
  whatsapp_error: string | null;
  paid_at: string | null;
  paid_amount_cents: number | null;
  payment_method: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  blocked_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Situacao de um segredo. Repare no que NAO existe aqui: o valor. Ele mora no
 * secret do Supabase, e lido pela Edge Function com `Deno.env.get()` e nunca
 * chega ao navegador — a tela conhece so o nome da variavel (fixo no codigo),
 * se ela esta preenchida e os quatro ultimos caracteres, o bastante para
 * reconhecer qual credencial esta ativa. A tela EXIBE isso; nao edita.
 */
export interface BillingSecretStatus {
  key: string;
  label: string;
  purpose: string;
  missingHint: string;
  required: boolean;
  envVar: string;
  configured: boolean;
  preview: string;
}

export interface BillingSettingsView {
  mercadoPagoEnvironment: string;
  secrets: BillingSecretStatus[];
  whatsappUrl: string;
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

export interface BillingSummary {
  openCount: number;
  openAmountCents: number;
  overdueCount: number;
  overdueAmountCents: number;
  paidCount: number;
  paidAmountCents: number;
  blockedCompanies: number;
  billedCompanies: number;
  monthlyRecurringCents: number;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Rascunho",
  open: "Em aberto",
  paid: "Paga",
  overdue: "Vencida",
  canceled: "Cancelada"
};

/** Nome do tom do `Badge` do design system — nao cor crua. */
export type StatusTone = "neutral" | "ok" | "warn" | "danger" | "info";

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, StatusTone> = {
  draft: "neutral",
  open: "info",
  paid: "ok",
  overdue: "danger",
  canceled: "neutral"
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status;
}

export function invoiceStatusTone(status: string): StatusTone {
  return INVOICE_STATUS_TONES[status as InvoiceStatus] ?? "neutral";
}

/** Centavos como "R$ 1.234,56". */
export function formatCents(cents: number | null | undefined): string {
  const value = Math.round(Number(cents ?? 0));
  const negative = value < 0;
  const absolute = Math.abs(value);
  const reais = Math.floor(absolute / 100);
  const centavos = String(absolute % 100).padStart(2, "0");
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${grouped},${centavos}`;
}

/** Centavos para o campo de texto do formulario ("1234,56"), sem o "R$". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (Math.round(cents) / 100).toFixed(2).replace(".", ",");
}

/**
 * Texto digitado para centavos. Aceita "1.234,56", "1234.56" e "1234" — o
 * operador cola valor de planilha, de e-mail e digita a mao, e recusar um
 * desses formatos vira valor de mensalidade errado.
 */
export function parseMoneyToCents(value: string): number | null {
  const cleaned = value.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else if (hasDot) {
    // Ponto so e decimal com UM ponto e 1-2 digitos depois: "1.500" e mil e
    // quinhentos, nao um e meio.
    const groups = cleaned.split(".");
    const fraction = groups[groups.length - 1] ?? "";
    const isDecimal = groups.length === 2 && fraction.length >= 1 && fraction.length <= 2;
    normalized = isDecimal ? cleaned : cleaned.replace(/\./g, "");
  } else {
    normalized = cleaned;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** "2026-08-25" -> "25/08/2026". */
export function formatDateBr(date: string | null | undefined): string {
  const value = (date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateTimeBr(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString("pt-BR");
}

/** Dias de atraso; zero ou negativo enquanto o vencimento nao passou. */
export function daysOverdue(dueDate: string, today: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0;
  const diff = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return Math.round(diff / 86_400_000);
}

export interface InvoiceFilter {
  companyId?: string;
  status?: string;
  search?: string;
}

/**
 * Filtro da lista de faturas. A busca cobre numero, referencia e nome da
 * pedreira — os tres jeitos de alguem procurar "aquela fatura" — e ORDENA o resultado
 * pela proximidade com o que foi digitado.
 *
 * Sem a ordem, procurar "0042" trazia a fatura 0042 no meio da lista, atras de qualquer
 * "1000425" que tivesse sido emitida antes. Sem busca, a ordem da lista nao e tocada: ela
 * ja vem cronologica da consulta, que e como o financeiro le.
 */
export function filterInvoices(
  invoices: BillingInvoice[],
  companiesById: Map<string, string>,
  filter: InvoiceFilter
): BillingInvoice[] {
  const scoped = invoices.filter((invoice) => {
    if (filter.companyId && invoice.company_id !== filter.companyId) return false;
    if (filter.status && invoice.status !== filter.status) return false;
    return true;
  });

  return rankBySearch(
    scoped,
    (invoice) => [
      invoice.number,
      invoice.reference_label,
      companiesById.get(invoice.company_id) ?? ""
    ],
    filter.search ?? ""
  );
}

/** Totais da lista JA FILTRADA — o rodape precisa refletir o que esta na tela. */
export function summarizeInvoiceList(invoices: BillingInvoice[]): {
  count: number;
  totalCents: number;
  openCents: number;
  overdueCents: number;
  paidCents: number;
} {
  let totalCents = 0;
  let openCents = 0;
  let overdueCents = 0;
  let paidCents = 0;
  for (const invoice of invoices) {
    if (invoice.status === "canceled") continue;
    totalCents += invoice.amount_cents;
    if (invoice.status === "open") openCents += invoice.amount_cents;
    if (invoice.status === "overdue") overdueCents += invoice.amount_cents;
    if (invoice.status === "paid") paidCents += invoice.paid_amount_cents ?? invoice.amount_cents;
  }
  return { count: invoices.length, totalCents, openCents, overdueCents, paidCents };
}

/** Frase do proximo fechamento na linha da pedreira. */
export function describeNextClosing(company: BillingCompany): string {
  const plan = company.billing_plan;
  if (!company.billing_enabled) return "Cobranca automatica desligada";
  if (!plan.nextPeriod) return "Informe a data de virada do sistema";
  const amount = plan.nextAmountCents === null ? "" : ` — ${formatCents(plan.nextAmountCents)}`;
  const proration = plan.nextPeriod.isProrated
    ? ` (proporcional, ${plan.nextPeriod.billedDays}/${plan.nextPeriod.fullPeriodDays} dias)`
    : "";
  return `Fecha em ${formatDateBr(plan.nextPeriod.closingDate)}, vence em ${formatDateBr(plan.nextPeriod.dueDate)}${amount}${proration}`;
}

/** Baixa o PDF devolvido em base64 pelo admin-billing. */
export function downloadBase64Pdf(base64: string, fileName: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Situacao de um segredo pelo identificador, com um vazio seguro quando o backend e mais antigo. */
export function findSecret(
  settings: Pick<BillingSettingsView, "secrets">,
  key: string
): BillingSecretStatus {
  return (
    (settings.secrets ?? []).find((secret) => secret.key === key) ?? {
      key,
      label: key,
      purpose: "",
      missingHint: "",
      required: false,
      envVar: "",
      configured: false,
      preview: ""
    }
  );
}

// ---------------------------------------------------------------------------
// Trilha (billing_events)
// ---------------------------------------------------------------------------

export interface BillingEvent {
  id: string;
  company_id: string | null;
  invoice_id: string | null;
  event_type: string;
  message: string | null;
  created_at: string;
}

const BILLING_EVENT_LABELS: Record<string, string> = {
  invoice_created: "Fatura criada",
  invoice_updated: "Fatura ajustada",
  invoice_canceled: "Fatura cancelada",
  invoice_deleted: "Fatura excluida",
  invoice_paid: "Pagamento confirmado",
  invoice_sent: "Enviada por WhatsApp",
  invoice_send_failed: "Falha no envio",
  boleto_issued: "Boleto emitido",
  boleto_failed: "Falha na emissao do boleto",
  boleto_status_changed: "Situacao do boleto mudou",
  company_blocked: "Pedreira bloqueada",
  company_released: "Pedreira liberada",
  company_blocked_manually: "Bloqueio manual",
  company_released_manually: "Liberacao manual",
  company_billing_updated: "Cadastro de cobranca alterado",
  settings_updated: "Configuracao alterada",
  billing_run_failed: "Passada automatica falhou",
  webhook_orphan: "Notificacao sem fatura",
  webhook_rejected: "Notificacao recusada"
};

/** Rotulo do evento; tipo desconhecido aparece cru em vez de sumir. */
export function billingEventLabel(eventType: string): string {
  return BILLING_EVENT_LABELS[eventType] ?? eventType;
}

const BILLING_EVENT_DANGER = new Set([
  "invoice_send_failed",
  "boleto_failed",
  "company_blocked",
  "company_blocked_manually",
  "billing_run_failed",
  "webhook_rejected"
]);

const BILLING_EVENT_OK = new Set([
  "invoice_paid",
  "invoice_sent",
  "boleto_issued",
  "company_released",
  "company_released_manually"
]);

export function billingEventTone(eventType: string): StatusTone {
  if (BILLING_EVENT_DANGER.has(eventType)) return "danger";
  if (BILLING_EVENT_OK.has(eventType)) return "ok";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Ativacao: o que ainda falta para a cobranca rodar
// ---------------------------------------------------------------------------

/** Aba que resolve o item — o botao da lista leva direto para la. */
export type ActivationTarget = "companies" | "settings";

/**
 * `pending` impede a cobranca de funcionar; `warn` e recomendacao (o motor roda
 * sem, mas alguem vai reclamar depois). A distincao existe para a tela nao
 * pintar de vermelho o que e so capricho.
 */
export type ActivationStatus = "ok" | "pending" | "warn";

export interface ActivationStep {
  id: string;
  title: string;
  detail: string;
  /** Detalhamento item a item (campo que falta, pedreira incompleta). */
  items: string[];
  status: ActivationStatus;
  target: ActivationTarget;
}

/**
 * O documento do emitente sem mascara, como o `_shared/document.ts` da nuvem: letras e
 * digitos em maiuscula. As letras ficam porque o CNPJ alfanumerico (IN RFB 2.229/2024) as
 * tem nas 12 primeiras posicoes — tirar seria reprovar um CNPJ valido no checklist.
 */
function normalizeDocument(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** CPF (11 digitos) ou CNPJ (12 alfanumericos + 2 verificadores). */
function hasDocumentShape(value: string): boolean {
  return /^[0-9]{11}$/.test(value) || /^[0-9A-Z]{12}[0-9]{2}$/.test(value);
}

/**
 * A lista de "o que falta preencher" da aba Financeiro, montada so com o que o
 * `admin-billing` ja devolve na carga da tela.
 *
 * Existe porque a cobranca depende de quatro coisas em lugares diferentes —
 * secret do Supabase, linha de configuracao, cadastro do emitente e cadastro de
 * cada pedreira — e, faltando qualquer uma, o sintoma so aparecia no fechamento
 * (fatura sem boleto, boleto sem envio, ciclo que nao fecha). Aqui o operador ve
 * a pendencia antes, com o nome exato do campo.
 */
export function buildActivationChecklist(input: {
  settings: BillingSettingsView;
  companies: BillingCompany[];
}): ActivationStep[] {
  const { settings, companies } = input;
  const steps: ActivationStep[] = [];

  const accessToken = findSecret(settings, "mercadoPagoAccessToken");
  steps.push({
    id: "mercado-pago-token",
    title: "Credencial do Mercado Pago",
    detail: accessToken.configured
      ? `Secret ${accessToken.envVar} configurado (${accessToken.preview}).`
      : `Grave o access token da conta que emite os boletos em Supabase > Edge Functions > Secrets, com o nome ${accessToken.envVar || "MERCADO_PAGO_ACCESS_TOKEN"}. Sem ele nenhum boleto e emitido.`,
    items: [],
    status: accessToken.configured ? "ok" : "pending",
    target: "settings"
  });

  const whatsappToken = findSecret(settings, "whatsappInstanceToken");
  const whatsappMissing: string[] = [];
  if (!whatsappToken.configured) {
    whatsappMissing.push(`Secret ${whatsappToken.envVar || "UAZAPI_INSTANCE_TOKEN"} no Supabase`);
  }
  if (!settings.whatsappUrl.trim()) whatsappMissing.push("URL da instancia UAZAPI");
  if (!settings.whatsappInstanceName.trim()) whatsappMissing.push("Nome da instancia");
  steps.push({
    id: "whatsapp",
    title: "WhatsApp da cobranca",
    detail:
      whatsappMissing.length === 0
        ? `Instancia ${settings.whatsappInstanceName} pronta para entregar fatura e boleto.`
        : "Sem isso a fatura e gerada e o boleto sai, mas nada chega ao cliente.",
    items: whatsappMissing,
    status: whatsappMissing.length === 0 ? "ok" : "pending",
    target: "settings"
  });

  const issuerMissing: string[] = [];
  if (!settings.issuerName.trim()) issuerMissing.push("Nome do emitente");
  if (!hasDocumentShape(normalizeDocument(settings.issuerDocument))) {
    issuerMissing.push("CNPJ do emitente");
  }
  if (!settings.issuerEmail.trim() && !settings.issuerPhone.trim()) {
    issuerMissing.push("E-mail ou telefone de suporte");
  }
  steps.push({
    id: "issuer",
    title: "Emitente da fatura",
    detail:
      issuerMissing.length === 0
        ? `${settings.issuerName} identificada na fatura, no boleto e na mensagem.`
        : "Aparece no cabecalho do PDF, na descricao do boleto e na mensagem do WhatsApp.",
    items: issuerMissing,
    status: issuerMissing.length === 0 ? "ok" : "warn",
    target: "settings"
  });

  steps.push(buildCompaniesStep(companies));

  const webhookSecret = findSecret(settings, "mercadoPagoWebhookSecret");
  steps.push({
    id: "webhook-secret",
    title: "Assinatura do webhook (opcional)",
    detail: webhookSecret.configured
      ? `Secret ${webhookSecret.envVar} configurado.`
      : "Sem ele a baixa continua funcionando: o webhook confirma o pagamento consultando a API do Mercado Pago. A assinatura so evita a consulta de um POST forjado.",
    items: [],
    status: webhookSecret.configured ? "ok" : "warn",
    target: "settings"
  });

  const isSandbox = settings.mercadoPagoEnvironment === "sandbox";
  steps.push({
    id: "environment",
    title: "Ambiente do Mercado Pago",
    detail: isSandbox
      ? "Sandbox: os boletos emitidos sao de teste e nao cobram ninguem. Troque para Producao antes de faturar de verdade."
      : "Producao: os boletos emitidos cobram de verdade.",
    items: [],
    status: isSandbox ? "warn" : "ok",
    target: "settings"
  });

  return steps;
}

function buildCompaniesStep(companies: BillingCompany[]): ActivationStep {
  const base = { id: "companies", title: "Pedreiras a faturar", target: "companies" as const };

  if (companies.length === 0) {
    return {
      ...base,
      detail: "Nenhuma pedreira cadastrada. Cadastre em Pedreiras antes de configurar a cobranca.",
      items: [],
      status: "pending"
    };
  }

  const enabled = companies.filter((company) => company.billing_enabled);
  const incomplete = enabled.filter((company) => !company.billing_plan.readyToClose);
  const ready = enabled.length - incomplete.length;

  if (enabled.length === 0) {
    return {
      ...base,
      detail:
        'Nenhuma pedreira com cobranca ativa. Abra "Cobranca" na pedreira, informe o valor acertado e a data de virada e marque "Cobrar automaticamente no fechamento".',
      items: companies.map(describeCompanyPending),
      status: "pending"
    };
  }

  if (incomplete.length > 0) {
    return {
      ...base,
      detail:
        ready > 0
          ? `${ready} pedreira(s) prontas; ${incomplete.length} ainda nao fecham por falta de cadastro.`
          : "Cobranca ativa, mas o cadastro nao permite fechar o ciclo.",
      items: incomplete.map(describeCompanyPending),
      status: ready > 0 ? "warn" : "pending"
    };
  }

  return {
    ...base,
    detail: `${ready} pedreira(s) com cobranca ativa e cadastro completo.`,
    items: [],
    status: "ok"
  };
}

/** "Pedreira X: Valor acertado nao informado, CEP em falta". */
function describeCompanyPending(company: BillingCompany): string {
  const pending = [...company.billing_plan.blockers];
  if (!company.billing_enabled) pending.unshift("Cobranca automatica desligada");
  return pending.length > 0 ? `${company.name}: ${pending.join(", ")}` : company.name;
}

/** Quantos itens ainda travam a cobranca (o `warn` nao conta). */
export function countActivationBlockers(steps: ActivationStep[]): number {
  return steps.filter((step) => step.status === "pending").length;
}

export function isActivationComplete(steps: ActivationStep[]): boolean {
  return steps.every((step) => step.status === "ok");
}
