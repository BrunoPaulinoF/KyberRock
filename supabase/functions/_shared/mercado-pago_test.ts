import { describe, expect, it, vi } from "vitest";

import {
  BOLETO_PAYMENT_METHOD_ID,
  MERCADO_PAGO_API_BASE,
  MercadoPagoError,
  boletoExpirationTimestamp,
  buildBoletoPayload,
  cancelPayment,
  createBoleto,
  describeMercadoPagoError,
  extractBoletoResult,
  extractNotificationPaymentId,
  getPayment,
  isDeadStatus,
  isPaidStatus,
  splitPayerName
} from "./mercado-pago.ts";

const PAYER = {
  email: "financeiro@serraazul.com.br",
  name: "Serra Azul Mineracao LTDA",
  document: "12345678000199",
  zipCode: "30140-071",
  streetName: "Av. Afonso Pena",
  streetNumber: "1500",
  neighborhood: "Centro",
  city: "Belo Horizonte",
  federalUnit: "mg"
};

const BOLETO_INPUT = {
  amountCents: 60_968,
  description: "Kybernan - Mensalidade 08/2026",
  dueDate: "2026-09-05",
  payer: PAYER,
  externalReference: "invoice-1"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("splitPayerName", () => {
  it("splits a legal name into first and last name", () => {
    expect(splitPayerName("Serra Azul Mineracao LTDA")).toEqual({
      firstName: "Serra",
      lastName: "Azul Mineracao LTDA"
    });
  });

  it("never leaves the last name empty — the API rejects it", () => {
    expect(splitPayerName("Pedreira")).toEqual({ firstName: "Pedreira", lastName: "Pedreira" });
    expect(splitPayerName("   ")).toEqual({ firstName: "Cliente", lastName: "KyberRock" });
  });
});

describe("boletoExpirationTimestamp", () => {
  it("expires at the end of the due date in Sao Paulo", () => {
    expect(boletoExpirationTimestamp("2026-09-05")).toBe("2026-09-05T23:59:59.000-03:00");
  });
});

describe("buildBoletoPayload", () => {
  it("builds the payment body Mercado Pago expects for a boleto", () => {
    expect(buildBoletoPayload(BOLETO_INPUT)).toEqual({
      transaction_amount: 609.68,
      description: "Kybernan - Mensalidade 08/2026",
      payment_method_id: BOLETO_PAYMENT_METHOD_ID,
      date_of_expiration: "2026-09-05T23:59:59.000-03:00",
      external_reference: "invoice-1",
      payer: {
        email: "financeiro@serraazul.com.br",
        first_name: "Serra",
        last_name: "Azul Mineracao LTDA",
        entity_type: "association",
        identification: { type: "CNPJ", number: "12345678000199" },
        address: {
          zip_code: "30140071",
          street_name: "Av. Afonso Pena",
          street_number: "1500",
          neighborhood: "Centro",
          city: "Belo Horizonte",
          federal_unit: "MG"
        }
      }
    });
  });

  it("marks a CPF payer as an individual", () => {
    const payload = buildBoletoPayload({
      ...BOLETO_INPUT,
      payer: { ...PAYER, document: "39053344705", name: "Joao da Silva" }
    });
    const payer = payload.payer as Record<string, unknown>;
    expect(payer.entity_type).toBe("individual");
    expect(payer.identification).toEqual({ type: "CPF", number: "39053344705" });
  });

  it("includes the notification url only when there is one", () => {
    expect(buildBoletoPayload(BOLETO_INPUT).notification_url).toBeUndefined();
    expect(
      buildBoletoPayload({
        ...BOLETO_INPUT,
        notificationUrl: "https://x/functions/v1/billing-webhook"
      }).notification_url
    ).toBe("https://x/functions/v1/billing-webhook");
  });

  it("refuses a document that is neither CPF nor CNPJ", () => {
    expect(() =>
      buildBoletoPayload({ ...BOLETO_INPUT, payer: { ...PAYER, document: "123" } })
    ).toThrow(MercadoPagoError);
  });
});

describe("extractBoletoResult", () => {
  it("reads the boleto link and barcode from transaction_details", () => {
    const result = extractBoletoResult({
      id: 123456789,
      status: "pending",
      status_detail: "pending_waiting_payment",
      date_of_expiration: "2026-09-05T23:59:59.000-03:00",
      transaction_details: { external_resource_url: "https://mp.example/boleto/1" },
      barcode: { content: "34191790010104351004791020150008" }
    });
    expect(result).toMatchObject({
      paymentId: "123456789",
      status: "pending",
      statusDetail: "pending_waiting_payment",
      url: "https://mp.example/boleto/1",
      barcode: "34191790010104351004791020150008",
      expiresAt: "2026-09-05"
    });
  });

  it("falls back to point_of_interaction when the account returns that shape", () => {
    const result = extractBoletoResult({
      id: 987,
      status: "pending",
      point_of_interaction: {
        transaction_data: {
          ticket_url: "https://mp.example/ticket/9",
          barcode: { content: "00190500954014481606906809350314337370000000100" }
        }
      }
    });
    expect(result.url).toBe("https://mp.example/ticket/9");
    expect(result.barcode).toBe("00190500954014481606906809350314337370000000100");
  });

  it("survives a payment with no boleto data at all", () => {
    const result = extractBoletoResult({ id: 1, status: "rejected" });
    expect(result.url).toBeNull();
    expect(result.barcode).toBeNull();
    expect(result.expiresAt).toBeNull();
  });
});

describe("createBoleto", () => {
  it("posts to /v1/payments with the idempotency key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 1,
        status: "pending",
        transaction_details: { external_resource_url: "https://mp.example/boleto/1" }
      })
    );
    const result = await createBoleto({
      ...BOLETO_INPUT,
      accessToken: "TEST-token",
      idempotencyKey: "kyberrock:company-1:invoice-1:create_boleto",
      fetchImpl
    });

    expect(result.paymentId).toBe("1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${MERCADO_PAGO_API_BASE}/v1/payments`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TEST-token");
    expect(headers["X-Idempotency-Key"]).toBe("kyberrock:company-1:invoice-1:create_boleto");
  });

  it("turns the API cause into a message the panel can act on", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          message: "invalid_parameter",
          cause: [{ code: 4037, description: "payer.address.neighborhood is required" }]
        },
        400
      )
    );
    await expect(
      createBoleto({
        ...BOLETO_INPUT,
        accessToken: "TEST-token",
        idempotencyKey: "k",
        fetchImpl
      })
    ).rejects.toThrow("payer.address.neighborhood is required");
  });
});

describe("getPayment and cancelPayment", () => {
  it("reads a payment by id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 55, status: "approved" }));
    const result = await getPayment({ accessToken: "t", paymentId: "55", fetchImpl });
    expect(result.status).toBe("approved");
    expect(fetchImpl.mock.calls[0][0]).toBe(`${MERCADO_PAGO_API_BASE}/v1/payments/55`);
  });

  it("cancels a payment with a PUT", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 55, status: "cancelled" }));
    const result = await cancelPayment({ accessToken: "t", paymentId: "55", fetchImpl });
    expect(result.status).toBe("cancelled");
    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "cancelled" });
  });
});

describe("describeMercadoPagoError", () => {
  it("prefers the cause list, then the message, then the status", () => {
    expect(describeMercadoPagoError({ cause: [{ description: "cep invalido" }] }, 400)).toBe(
      "Mercado Pago: cep invalido"
    );
    expect(describeMercadoPagoError({ message: "unauthorized" }, 401)).toBe(
      "Mercado Pago: unauthorized"
    );
    expect(describeMercadoPagoError({}, 500)).toBe("Mercado Pago respondeu 500.");
  });
});

describe("payment status helpers", () => {
  it("only approved settles the invoice", () => {
    expect(isPaidStatus("approved")).toBe(true);
    expect(isPaidStatus("pending")).toBe(false);
    expect(isPaidStatus("in_process")).toBe(false);
  });

  it("flags the statuses that require reissuing the boleto", () => {
    expect(isDeadStatus("cancelled")).toBe(true);
    expect(isDeadStatus("rejected")).toBe(true);
    expect(isDeadStatus("refunded")).toBe(true);
    expect(isDeadStatus("pending")).toBe(false);
  });
});

describe("extractNotificationPaymentId", () => {
  const url = "https://x.supabase.co/functions/v1/billing-webhook";

  it("reads the new webhook shape", () => {
    expect(
      extractNotificationPaymentId({
        url,
        body: { action: "payment.updated", type: "payment", data: { id: "123" } }
      })
    ).toBe("123");
  });

  it("reads the legacy IPN query string", () => {
    expect(extractNotificationPaymentId({ url: `${url}?topic=payment&id=456`, body: {} })).toBe(
      "456"
    );
    expect(extractNotificationPaymentId({ url: `${url}?type=payment&data.id=789`, body: {} })).toBe(
      "789"
    );
  });

  it("ignores merchant_order — that id is not a payment id", () => {
    expect(
      extractNotificationPaymentId({ url: `${url}?topic=merchant_order&id=456`, body: {} })
    ).toBeNull();
    expect(
      extractNotificationPaymentId({
        url,
        body: { action: "merchant_order.updated", data: { id: "456" } }
      })
    ).toBeNull();
  });

  it("is null when the notification carries no id", () => {
    expect(extractNotificationPaymentId({ url, body: { type: "payment" } })).toBeNull();
  });
});
