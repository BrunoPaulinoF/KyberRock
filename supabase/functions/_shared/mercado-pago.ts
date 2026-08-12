// Cliente do Mercado Pago para o boleto da mensalidade.
//
// Escopo deliberadamente pequeno: criar boleto, consultar e cancelar. Nada de
// SDK — a API e REST simples e o SDK oficial arrastaria dependencia npm para
// dentro do Deno Deploy sem ganho nenhum.
//
// O `fetch` e injetavel para o teste (`mercado-pago_test.ts`, vitest) exercitar
// payload, cabecalho de idempotencia e tratamento de erro sem rede.

export const MERCADO_PAGO_API_BASE = "https://api.mercadopago.com";

/** `payment_method_id` do boleto bancario no Mercado Pago. */
export const BOLETO_PAYMENT_METHOD_ID = "bolbradesco";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MercadoPagoPayer {
  email: string;
  /** Razao social (PJ) ou nome completo (PF). */
  name: string;
  /** So digitos: 11 (CPF) ou 14 (CNPJ). */
  document: string;
  zipCode: string;
  streetName: string;
  streetNumber: string;
  neighborhood: string;
  city: string;
  federalUnit: string;
}

export interface CreateBoletoInput {
  accessToken: string;
  /** Chave de idempotencia — o mesmo formato do OMIE: `kyberrock:{...}`. */
  idempotencyKey: string;
  amountCents: number;
  description: string;
  /** Vencimento em `YYYY-MM-DD`. */
  dueDate: string;
  payer: MercadoPagoPayer;
  /** Id da fatura; volta nas notificacoes e amarra o pagamento a ela. */
  externalReference: string;
  notificationUrl?: string | null;
  fetchImpl?: FetchLike;
}

export interface BoletoResult {
  paymentId: string;
  status: string;
  statusDetail: string | null;
  /** Pagina do boleto (PDF/HTML) do Mercado Pago. */
  url: string | null;
  /** Linha digitavel / codigo de barras. */
  barcode: string | null;
  expiresAt: string | null;
  raw: Record<string, unknown>;
}

export class MercadoPagoError extends Error {
  readonly status: number;
  readonly details: string;

  constructor(message: string, status: number, details: string) {
    super(message);
    this.name = "MercadoPagoError";
    this.status = status;
    this.details = details;
  }
}

/** Boleto so aceita pessoa fisica ou juridica; o resto e recusado na API. */
function identificationFor(document: string): { type: string; number: string } | null {
  const digits = document.replace(/\D/g, "");
  if (digits.length === 11) return { type: "CPF", number: digits };
  if (digits.length === 14) return { type: "CNPJ", number: digits };
  return null;
}

/**
 * O Mercado Pago pede `first_name`/`last_name` separados. Razao social nao tem
 * sobrenome, entao o primeiro termo vira nome e o resto sobrenome — com
 * fallback para nao mandar `last_name` vazio, que a API recusa.
 */
export function splitPayerName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Cliente", lastName: "KyberRock" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Vencimento com hora e fuso, como a API exige
 * (`2026-09-05T23:59:59.000-03:00`). Data pura e recusada, e sem o fim do dia o
 * boleto vence a meia-noite — antes de o cliente conseguir pagar.
 */
export function boletoExpirationTimestamp(dueDate: string): string {
  return `${dueDate}T23:59:59.000-03:00`;
}

export function buildBoletoPayload(
  input: Omit<CreateBoletoInput, "accessToken" | "idempotencyKey" | "fetchImpl">
): Record<string, unknown> {
  const identification = identificationFor(input.payer.document);
  if (!identification) {
    throw new MercadoPagoError(
      "CNPJ/CPF do cadastro de cobranca invalido para emissao de boleto.",
      400,
      input.payer.document
    );
  }
  const { firstName, lastName } = splitPayerName(input.payer.name);
  const payload: Record<string, unknown> = {
    transaction_amount: Math.round(input.amountCents) / 100,
    description: input.description,
    payment_method_id: BOLETO_PAYMENT_METHOD_ID,
    date_of_expiration: boletoExpirationTimestamp(input.dueDate),
    external_reference: input.externalReference,
    payer: {
      email: input.payer.email,
      first_name: firstName,
      last_name: lastName,
      // PJ paga boleto como `association`; PF como `individual`. Mandar o tipo
      // errado faz a API recusar o CNPJ.
      entity_type: identification.type === "CNPJ" ? "association" : "individual",
      identification,
      address: {
        zip_code: input.payer.zipCode.replace(/\D/g, ""),
        street_name: input.payer.streetName,
        street_number: input.payer.streetNumber,
        neighborhood: input.payer.neighborhood,
        city: input.payer.city,
        federal_unit: input.payer.federalUnit.toUpperCase().slice(0, 2)
      }
    }
  };
  if (input.notificationUrl) payload.notification_url = input.notificationUrl;
  return payload;
}

/**
 * Extrai do pagamento o que a fatura guarda. O link do boleto aparece em dois
 * lugares distintos conforme a conta/versao da API, e a linha digitavel em
 * outros dois — por isso a cascata em vez de um caminho unico.
 */
export function extractBoletoResult(payment: Record<string, unknown>): BoletoResult {
  const transactionDetails = (payment.transaction_details ?? {}) as Record<string, unknown>;
  const pointOfInteraction = (payment.point_of_interaction ?? {}) as Record<string, unknown>;
  const transactionData = (pointOfInteraction.transaction_data ?? {}) as Record<string, unknown>;
  const barcodeBlock = (payment.barcode ?? {}) as Record<string, unknown>;
  const nestedBarcode = (transactionData.barcode ?? {}) as Record<string, unknown>;

  const url =
    stringOrNull(transactionDetails.external_resource_url) ??
    stringOrNull(transactionData.ticket_url) ??
    null;
  const barcode =
    stringOrNull(barcodeBlock.content) ??
    stringOrNull(nestedBarcode.content) ??
    stringOrNull(transactionDetails.digitable_line) ??
    null;

  return {
    paymentId: String(payment.id ?? ""),
    status: String(payment.status ?? "unknown"),
    statusDetail: stringOrNull(payment.status_detail),
    url,
    barcode,
    expiresAt: stringOrNull(payment.date_of_expiration)?.slice(0, 10) ?? null,
    raw: payment
  };
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

async function mercadoPagoRequest(input: {
  accessToken: string;
  path: string;
  method: "GET" | "POST" | "PUT";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  fetchImpl?: FetchLike;
}): Promise<Record<string, unknown>> {
  const doFetch = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    "Content-Type": "application/json"
  };
  if (input.idempotencyKey) headers["X-Idempotency-Key"] = input.idempotencyKey;

  const response = await doFetch(`${MERCADO_PAGO_API_BASE}${input.path}`, {
    method: input.method,
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined
  });

  const raw = await response.text().catch(() => "");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    throw new MercadoPagoError(
      describeMercadoPagoError(parsed, response.status),
      response.status,
      raw
    );
  }
  return parsed;
}

/**
 * Mensagem util a partir do corpo de erro. A API devolve o motivo real em
 * `cause[].description`; sem isso a tela mostrava so "400" e ninguem descobria
 * que faltava o bairro do pagador.
 */
export function describeMercadoPagoError(body: Record<string, unknown>, status: number): string {
  const causes = Array.isArray(body.cause) ? body.cause : [];
  const described = causes
    .map((cause) => {
      const item = (cause ?? {}) as Record<string, unknown>;
      return stringOrNull(item.description) ?? stringOrNull(item.code);
    })
    .filter((value): value is string => Boolean(value));
  if (described.length > 0) return `Mercado Pago: ${described.join("; ")}`;
  const message = stringOrNull(body.message) ?? stringOrNull(body.error);
  return message ? `Mercado Pago: ${message}` : `Mercado Pago respondeu ${status}.`;
}

export async function createBoleto(input: CreateBoletoInput): Promise<BoletoResult> {
  const payment = await mercadoPagoRequest({
    accessToken: input.accessToken,
    path: "/v1/payments",
    method: "POST",
    body: buildBoletoPayload(input),
    idempotencyKey: input.idempotencyKey,
    fetchImpl: input.fetchImpl
  });
  return extractBoletoResult(payment);
}

export async function getPayment(input: {
  accessToken: string;
  paymentId: string;
  fetchImpl?: FetchLike;
}): Promise<BoletoResult> {
  const payment = await mercadoPagoRequest({
    accessToken: input.accessToken,
    path: `/v1/payments/${encodeURIComponent(input.paymentId)}`,
    method: "GET",
    fetchImpl: input.fetchImpl
  });
  return extractBoletoResult(payment);
}

export async function cancelPayment(input: {
  accessToken: string;
  paymentId: string;
  fetchImpl?: FetchLike;
}): Promise<BoletoResult> {
  const payment = await mercadoPagoRequest({
    accessToken: input.accessToken,
    path: `/v1/payments/${encodeURIComponent(input.paymentId)}`,
    method: "PUT",
    body: { status: "cancelled" },
    fetchImpl: input.fetchImpl
  });
  return extractBoletoResult(payment);
}

/** Pagamento confirmado — o unico estado que quita a fatura e destrava o acesso. */
export function isPaidStatus(status: string): boolean {
  return status === "approved";
}

/** Boleto que nao vai mais ser pago: pede reemissao em vez de espera. */
export function isDeadStatus(status: string): boolean {
  return status === "cancelled" || status === "rejected" || status === "refunded";
}

/**
 * Id do pagamento numa notificacao do Mercado Pago. O formato varia conforme a
 * origem (IPN antigo, webhook novo, teste do painel), entao aceitamos todos em
 * vez de exigir um.
 */
export function extractNotificationPaymentId(input: {
  url: string;
  body: Record<string, unknown>;
}): string | null {
  const params = new URL(input.url).searchParams;
  const topic = (
    params.get("topic") ??
    params.get("type") ??
    stringOrNull(input.body.type) ??
    ""
  ).toLowerCase();
  const action = (stringOrNull(input.body.action) ?? "").toLowerCase();

  // `merchant_order` carrega o id do PEDIDO, nao do pagamento: consultar
  // /v1/payments com ele devolve 404 e a fatura ficaria com erro fantasma.
  if (topic && topic !== "payment") return null;
  if (action && !action.startsWith("payment.")) return null;

  const data = (input.body.data ?? {}) as Record<string, unknown>;
  return (
    stringOrNull(data.id) ??
    stringOrNull(input.body.id) ??
    stringOrNull(params.get("data.id")) ??
    stringOrNull(params.get("id"))
  );
}
