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
 * chega ao navegador — a tela conhece so o nome da variavel, se ela esta
 * preenchida e os quatro ultimos caracteres, o bastante para reconhecer qual
 * credencial esta ativa.
 */
export interface BillingSecretStatus {
  key: string;
  label: string;
  missingHint: string;
  envVar: string;
  isCustomEnvVar: boolean;
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

export interface StatusTone {
  background: string;
  color: string;
}

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, StatusTone> = {
  draft: { background: "#e2e8f0", color: "#334155" },
  open: { background: "#dbeafe", color: "#1d4ed8" },
  paid: { background: "#dcfce7", color: "#166534" },
  overdue: { background: "#fee2e2", color: "#991b1b" },
  canceled: { background: "#f1f5f9", color: "#64748b" }
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status;
}

export function invoiceStatusTone(status: string): StatusTone {
  return INVOICE_STATUS_TONES[status as InvoiceStatus] ?? INVOICE_STATUS_TONES.draft;
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
 * pedreira — os tres jeitos de alguem procurar "aquela fatura".
 */
export function filterInvoices(
  invoices: BillingInvoice[],
  companiesById: Map<string, string>,
  filter: InvoiceFilter
): BillingInvoice[] {
  const search = (filter.search ?? "").trim().toLowerCase();
  return invoices.filter((invoice) => {
    if (filter.companyId && invoice.company_id !== filter.companyId) return false;
    if (filter.status && invoice.status !== filter.status) return false;
    if (!search) return true;
    const companyName = (companiesById.get(invoice.company_id) ?? "").toLowerCase();
    return (
      invoice.number.toLowerCase().includes(search) ||
      invoice.reference_label.toLowerCase().includes(search) ||
      companyName.includes(search)
    );
  });
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
      missingHint: "",
      envVar: "",
      isCustomEnvVar: false,
      configured: false,
      preview: ""
    }
  );
}
