// Textos e formatacoes da fatura da plataforma: descricao do boleto, mensagem
// de WhatsApp, rotulos de status e o cadastro de cobranca efetivo da pedreira.
//
// Puro (sem Deno, sem fetch): tudo aqui e string, e o teste
// `billing-invoice_test.ts` roda no vitest. O que fala com rede vive em
// `mercado-pago.ts` e `billing-engine.ts`.

export type InvoiceStatus = "draft" | "open" | "paid" | "overdue" | "canceled";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Rascunho",
  open: "Em aberto",
  paid: "Paga",
  overdue: "Vencida",
  canceled: "Cancelada"
};

/** Cadastro de cobranca usado pelo boleto e pela fatura. */
export interface BillingCustomer {
  companyName: string;
  legalName: string;
  document: string;
  email: string;
  phone: string;
  contactName: string;
  zipcode: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface BillingCustomerSource {
  name?: string | null;
  legal_name?: string | null;
  document?: string | null;
  billing_legal_name?: string | null;
  billing_document?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  billing_contact_name?: string | null;
  billing_zipcode?: string | null;
  billing_address_street?: string | null;
  billing_address_number?: string | null;
  billing_address_complement?: string | null;
  billing_neighborhood?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
}

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function onlyDigits(value: string | null | undefined): string {
  return text(value).replace(/\D/g, "");
}

/**
 * Cadastro de cobranca com o fallback para o cadastro principal. Razao social e
 * documento do financeiro divergem do comercial com frequencia (matriz x
 * filial), mas quem nao preencheu o bloco de cobranca nao pode ficar sem
 * boleto por causa disso.
 */
export function resolveBillingCustomer(company: BillingCustomerSource): BillingCustomer {
  return {
    companyName: text(company.name),
    legalName: text(company.billing_legal_name) || text(company.legal_name) || text(company.name),
    document: onlyDigits(company.billing_document) || onlyDigits(company.document),
    email: text(company.billing_email).toLowerCase(),
    phone: onlyDigits(company.billing_phone),
    contactName: text(company.billing_contact_name),
    zipcode: onlyDigits(company.billing_zipcode),
    addressStreet: text(company.billing_address_street),
    addressNumber: text(company.billing_address_number),
    addressComplement: text(company.billing_address_complement),
    neighborhood: text(company.billing_neighborhood),
    city: text(company.billing_city),
    state: text(company.billing_state).toUpperCase().slice(0, 2)
  };
}

export interface MissingBillingFields {
  boleto: string[];
  whatsapp: string[];
}

/**
 * O que ainda falta no cadastro para emitir e entregar. Separado por canal
 * porque sao decisoes diferentes: sem endereco nao ha boleto, mas sem telefone
 * o boleto sai igual — so nao vai pelo WhatsApp.
 *
 * A lista e a que o Mercado Pago exige do pagador do boleto: documento, e-mail
 * e endereco completo. Faltando um deles a API recusa a cobranca inteira, entao
 * e melhor dizer isso na tela do que descobrir no fechamento.
 */
export function missingBillingFields(customer: BillingCustomer): MissingBillingFields {
  const boleto: string[] = [];
  if (!customer.legalName) boleto.push("Razao social");
  if (customer.document.length !== 11 && customer.document.length !== 14) {
    boleto.push("CNPJ/CPF");
  }
  if (!customer.email.includes("@")) boleto.push("E-mail de cobranca");
  if (customer.zipcode.length !== 8) boleto.push("CEP");
  if (!customer.addressStreet) boleto.push("Endereco");
  if (!customer.addressNumber) boleto.push("Numero");
  if (!customer.neighborhood) boleto.push("Bairro");
  if (!customer.city) boleto.push("Cidade");
  if (customer.state.length !== 2) boleto.push("UF");

  const whatsapp: string[] = [];
  if (customer.phone.length < 10) whatsapp.push("WhatsApp de cobranca");

  return { boleto, whatsapp };
}

export function isReadyForBoleto(customer: BillingCustomer): boolean {
  return missingBillingFields(customer).boleto.length === 0;
}

/** Valor em centavos como "R$ 1.234,56". */
export function formatCents(cents: number | null | undefined): string {
  const value = Math.round(Number(cents ?? 0));
  const negative = value < 0;
  const absolute = Math.abs(value);
  const reais = Math.floor(absolute / 100);
  const centavos = String(absolute % 100).padStart(2, "0");
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${grouped},${centavos}`;
}

/** "2026-08-25" -> "25/08/2026". */
export function formatDateBr(date: string | null | undefined): string {
  const value = text(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/** Valor em centavos como numero decimal para a API do Mercado Pago. */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

export interface InvoiceDescriptionInput {
  issuerName: string;
  companyName: string;
  referenceLabel: string;
  periodStart: string;
  periodEnd: string;
  template?: string | null;
}

const DEFAULT_DESCRIPTION_TEMPLATE = "{emitente} - Mensalidade {referencia} - {pedreira}";

/**
 * Descricao do boleto. O template e configuravel no painel; os marcadores
 * desconhecidos ficam como estao, para o erro aparecer no boleto de teste em
 * vez de sumir. O Mercado Pago corta a descricao em 255 caracteres.
 */
export function buildInvoiceDescription(input: InvoiceDescriptionInput): string {
  const template = text(input.template) || DEFAULT_DESCRIPTION_TEMPLATE;
  return applyTemplate(template, {
    emitente: input.issuerName || "KyberRock",
    pedreira: input.companyName,
    referencia: input.referenceLabel,
    periodo: `${formatDateBr(input.periodStart)} a ${formatDateBr(input.periodEnd)}`,
    inicio: formatDateBr(input.periodStart),
    fim: formatDateBr(input.periodEnd)
  }).slice(0, 255);
}

export interface InvoiceWhatsappInput {
  issuerName: string;
  companyName: string;
  invoiceNumber: string;
  referenceLabel: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  dueDate: string;
  boletoUrl?: string | null;
  boletoBarcode?: string | null;
  pixKey?: string | null;
  isProrated?: boolean;
  proratedDays?: number | null;
  fullPeriodDays?: number | null;
  supportPhone?: string | null;
  template?: string | null;
}

/**
 * Mensagem enviada ao financeiro da pedreira. Cada bloco so entra quando tem
 * conteudo: uma fatura sem boleto emitido ainda avisa valor e vencimento em vez
 * de mandar um texto com "undefined" no lugar do link.
 */
export function buildInvoiceWhatsappMessage(input: InvoiceWhatsappInput): string {
  const issuer = input.issuerName || "KyberRock";
  const lines: string[] = [
    `*${issuer} — Fatura ${input.referenceLabel}*`,
    "",
    `Ola${input.companyName ? `, ${input.companyName}` : ""}!`,
    `Segue a fatura ${input.invoiceNumber} referente ao periodo de ${formatDateBr(input.periodStart)} a ${formatDateBr(input.periodEnd)}.`,
    "",
    `*Valor:* ${formatCents(input.amountCents)}`,
    `*Vencimento:* ${formatDateBr(input.dueDate)}`
  ];

  if (input.isProrated && input.proratedDays && input.fullPeriodDays) {
    lines.push(
      `_Primeira fatura proporcional: ${input.proratedDays} de ${input.fullPeriodDays} dias._`
    );
  }

  if (text(input.boletoUrl)) {
    lines.push("", `*Boleto:* ${text(input.boletoUrl)}`);
  }
  if (text(input.boletoBarcode)) {
    lines.push("", "*Linha digitavel:*", text(input.boletoBarcode));
  }
  if (text(input.pixKey)) {
    lines.push("", `*PIX:* ${text(input.pixKey)}`);
  }

  lines.push("", "Qualquer duvida e so responder por aqui.");
  if (text(input.supportPhone)) {
    lines.push(`Suporte: ${text(input.supportPhone)}`);
  }

  const message = lines.join("\n");
  const template = text(input.template);
  if (!template) return message;

  return applyTemplate(template, {
    emitente: issuer,
    pedreira: input.companyName,
    numero: input.invoiceNumber,
    referencia: input.referenceLabel,
    valor: formatCents(input.amountCents),
    vencimento: formatDateBr(input.dueDate),
    periodo: `${formatDateBr(input.periodStart)} a ${formatDateBr(input.periodEnd)}`,
    boleto: text(input.boletoUrl),
    linha_digitavel: text(input.boletoBarcode),
    pix: text(input.pixKey)
  });
}

/** Aviso de bloqueio automatico por inadimplencia. */
export function buildBlockNoticeMessage(input: {
  issuerName: string;
  companyName: string;
  invoiceNumber: string;
  amountCents: number;
  dueDate: string;
  daysOverdue: number;
  boletoUrl?: string | null;
  supportPhone?: string | null;
}): string {
  const issuer = input.issuerName || "KyberRock";
  const lines = [
    `*${issuer} — Acesso bloqueado*`,
    "",
    `Ola${input.companyName ? `, ${input.companyName}` : ""}.`,
    `A fatura ${input.invoiceNumber}, de ${formatCents(input.amountCents)}, venceu em ${formatDateBr(input.dueDate)} e esta com ${input.daysOverdue} dia(s) de atraso.`,
    "O acesso ao sistema da balanca foi bloqueado automaticamente ate a regularizacao."
  ];
  if (text(input.boletoUrl)) {
    lines.push("", `*Boleto:* ${text(input.boletoUrl)}`);
  }
  lines.push("", "Assim que o pagamento for confirmado, o acesso volta sozinho.");
  if (text(input.supportPhone)) {
    lines.push(`Suporte: ${text(input.supportPhone)}`);
  }
  return lines.join("\n");
}

/** Motivo gravado em `companies.payment_blocked_reason` e exibido na balanca. */
export function buildBlockReason(input: {
  invoiceNumber: string;
  dueDate: string;
  daysOverdue: number;
}): string {
  return `Fatura ${input.invoiceNumber} vencida em ${formatDateBr(input.dueDate)} (${input.daysOverdue} dia(s) de atraso).`;
}

function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match
  );
}

/** Numero de WhatsApp no formato do UAZAPI: so digitos, com DDI 55. */
export function normalizeWhatsappNumber(phone: string | null | undefined): string {
  const digits = onlyDigits(phone);
  if (!digits) return "";
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

/** Nome do arquivo PDF anexado no WhatsApp e baixado no painel. */
export function invoicePdfFileName(invoiceNumber: string, referenceLabel: string): string {
  const reference = referenceLabel.replace("/", "-");
  return `${invoiceNumber || "fatura"}-${reference}.pdf`;
}
