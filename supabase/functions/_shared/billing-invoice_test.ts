import { describe, expect, it } from "vitest";

import {
  buildBlockNoticeMessage,
  buildBlockReason,
  buildInvoiceDescription,
  buildInvoiceWhatsappMessage,
  centsToAmount,
  formatCents,
  formatDateBr,
  invoicePdfFileName,
  isReadyForBoleto,
  missingBillingFields,
  normalizeWhatsappNumber,
  onlyDigits,
  resolveBillingCustomer
} from "./billing-invoice.ts";

const COMPLETE_COMPANY = {
  name: "Pedreira Serra Azul",
  legal_name: "Serra Azul Mineracao LTDA",
  document: "12.345.678/0001-99",
  billing_email: " Financeiro@SerraAzul.com.br ",
  billing_phone: "(31) 99876-5432",
  billing_contact_name: "Maria",
  billing_zipcode: "30140-071",
  billing_address_street: "Av. Afonso Pena",
  billing_address_number: "1500",
  billing_address_complement: "Sala 12",
  billing_neighborhood: "Centro",
  billing_city: "Belo Horizonte",
  billing_state: "mg"
};

describe("resolveBillingCustomer", () => {
  it("normalizes the registration into what the boleto needs", () => {
    expect(resolveBillingCustomer(COMPLETE_COMPANY)).toEqual({
      companyName: "Pedreira Serra Azul",
      legalName: "Serra Azul Mineracao LTDA",
      document: "12345678000199",
      email: "financeiro@serraazul.com.br",
      phone: "31998765432",
      contactName: "Maria",
      zipcode: "30140071",
      addressStreet: "Av. Afonso Pena",
      addressNumber: "1500",
      addressComplement: "Sala 12",
      neighborhood: "Centro",
      city: "Belo Horizonte",
      state: "MG"
    });
  });

  it("prefers the billing block over the commercial registration", () => {
    const customer = resolveBillingCustomer({
      ...COMPLETE_COMPANY,
      billing_legal_name: "Serra Azul Filial II LTDA",
      billing_document: "98.765.432/0001-11"
    });
    expect(customer.legalName).toBe("Serra Azul Filial II LTDA");
    expect(customer.document).toBe("98765432000111");
  });

  it("falls back to the company name when there is no legal name at all", () => {
    const customer = resolveBillingCustomer({ name: "Pedreira X" });
    expect(customer.legalName).toBe("Pedreira X");
    expect(customer.document).toBe("");
  });
});

describe("missingBillingFields", () => {
  it("reports nothing missing on a complete registration", () => {
    const customer = resolveBillingCustomer(COMPLETE_COMPANY);
    expect(missingBillingFields(customer)).toEqual({ boleto: [], whatsapp: [] });
    expect(isReadyForBoleto(customer)).toBe(true);
  });

  it("lists every field Mercado Pago requires from the payer", () => {
    const customer = resolveBillingCustomer({ name: "Pedreira X" });
    expect(missingBillingFields(customer).boleto).toEqual([
      "CNPJ/CPF",
      "E-mail de cobranca",
      "CEP",
      "Endereco",
      "Numero",
      "Bairro",
      "Cidade",
      "UF"
    ]);
    expect(isReadyForBoleto(customer)).toBe(false);
  });

  it("keeps the WhatsApp gap out of the boleto gap — a missing phone still bills", () => {
    const customer = resolveBillingCustomer({ ...COMPLETE_COMPANY, billing_phone: null });
    expect(missingBillingFields(customer)).toEqual({
      boleto: [],
      whatsapp: ["WhatsApp de cobranca"]
    });
    expect(isReadyForBoleto(customer)).toBe(true);
  });

  it("rejects a document that is neither CPF nor CNPJ", () => {
    const customer = resolveBillingCustomer({ ...COMPLETE_COMPANY, document: "123" });
    expect(missingBillingFields(customer).boleto).toContain("CNPJ/CPF");
  });
});

describe("formatting", () => {
  it("formats cents as Brazilian currency", () => {
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(90_000)).toBe("R$ 900,00");
    expect(formatCents(123_456_789)).toBe("R$ 1.234.567,89");
    expect(formatCents(-1_050)).toBe("-R$ 10,50");
    expect(formatCents(null)).toBe("R$ 0,00");
  });

  it("formats ISO dates as dd/mm/yyyy and leaves anything else alone", () => {
    expect(formatDateBr("2026-08-25")).toBe("25/08/2026");
    expect(formatDateBr("2026-08-25T12:00:00Z")).toBe("25/08/2026");
    expect(formatDateBr("")).toBe("");
    expect(formatDateBr(null)).toBe("");
  });

  it("converts cents to the decimal amount Mercado Pago expects", () => {
    expect(centsToAmount(90_000)).toBe(900);
    expect(centsToAmount(60_968)).toBe(609.68);
  });

  it("strips everything that is not a digit", () => {
    expect(onlyDigits("12.345.678/0001-99")).toBe("12345678000199");
    expect(onlyDigits(null)).toBe("");
  });
});

describe("normalizeWhatsappNumber", () => {
  it("adds the country code to a national number", () => {
    expect(normalizeWhatsappNumber("(31) 99876-5432")).toBe("5531998765432");
    expect(normalizeWhatsappNumber("3133334444")).toBe("553133334444");
  });

  it("keeps a number that already carries the country code", () => {
    expect(normalizeWhatsappNumber("5531998765432")).toBe("5531998765432");
  });

  it("is empty when there is no phone", () => {
    expect(normalizeWhatsappNumber(null)).toBe("");
  });
});

describe("buildInvoiceDescription", () => {
  const base = {
    issuerName: "Kybernan",
    companyName: "Pedreira Serra Azul",
    referenceLabel: "08/2026",
    periodStart: "2026-08-05",
    periodEnd: "2026-08-25"
  };

  it("uses the default template", () => {
    expect(buildInvoiceDescription(base)).toBe(
      "Kybernan - Mensalidade 08/2026 - Pedreira Serra Azul"
    );
  });

  it("applies a custom template", () => {
    expect(
      buildInvoiceDescription({ ...base, template: "Uso do sistema {periodo} ({pedreira})" })
    ).toBe("Uso do sistema 05/08/2026 a 25/08/2026 (Pedreira Serra Azul)");
  });

  it("leaves an unknown placeholder visible instead of swallowing it", () => {
    expect(buildInvoiceDescription({ ...base, template: "Fatura {inexistente}" })).toBe(
      "Fatura {inexistente}"
    );
  });

  it("truncates to the 255 characters Mercado Pago accepts", () => {
    const description = buildInvoiceDescription({ ...base, companyName: "X".repeat(400) });
    expect(description).toHaveLength(255);
  });
});

describe("buildInvoiceWhatsappMessage", () => {
  const base = {
    issuerName: "Kybernan",
    companyName: "Pedreira Serra Azul",
    invoiceNumber: "FAT-2026-00007",
    referenceLabel: "08/2026",
    periodStart: "2026-08-05",
    periodEnd: "2026-08-25",
    amountCents: 60_968,
    dueDate: "2026-09-05"
  };

  it("carries amount, due date, boleto link and barcode", () => {
    const message = buildInvoiceWhatsappMessage({
      ...base,
      boletoUrl: "https://mp.example/boleto/1",
      boletoBarcode: "34191790010104351004791020150008"
    });
    expect(message).toContain("Fatura 08/2026");
    expect(message).toContain("FAT-2026-00007");
    expect(message).toContain("R$ 609,68");
    expect(message).toContain("05/09/2026");
    expect(message).toContain("https://mp.example/boleto/1");
    expect(message).toContain("34191790010104351004791020150008");
  });

  it("omits the boleto block when there is no boleto yet", () => {
    const message = buildInvoiceWhatsappMessage(base);
    expect(message).not.toContain("Boleto:");
    expect(message).not.toContain("undefined");
    expect(message).toContain("R$ 609,68");
  });

  it("explains the proration of the first invoice", () => {
    const message = buildInvoiceWhatsappMessage({
      ...base,
      isProrated: true,
      proratedDays: 21,
      fullPeriodDays: 31
    });
    expect(message).toContain("21 de 31 dias");
  });

  it("applies a custom template when the panel configures one", () => {
    const message = buildInvoiceWhatsappMessage({
      ...base,
      boletoUrl: "https://mp.example/boleto/1",
      template: "{pedreira}: {valor} ate {vencimento}. {boleto}"
    });
    expect(message).toBe(
      "Pedreira Serra Azul: R$ 609,68 ate 05/09/2026. https://mp.example/boleto/1"
    );
  });
});

describe("block notices", () => {
  it("says what was blocked and why", () => {
    const message = buildBlockNoticeMessage({
      issuerName: "Kybernan",
      companyName: "Pedreira Serra Azul",
      invoiceNumber: "FAT-2026-00007",
      amountCents: 90_000,
      dueDate: "2026-09-05",
      daysOverdue: 6,
      boletoUrl: "https://mp.example/boleto/1"
    });
    expect(message).toContain("Acesso bloqueado");
    expect(message).toContain("R$ 900,00");
    expect(message).toContain("05/09/2026");
    expect(message).toContain("6 dia(s)");
    expect(message).toContain("https://mp.example/boleto/1");
  });

  it("writes the reason shown on the scale screen", () => {
    expect(
      buildBlockReason({ invoiceNumber: "FAT-2026-00007", dueDate: "2026-09-05", daysOverdue: 6 })
    ).toBe("Fatura FAT-2026-00007 vencida em 05/09/2026 (6 dia(s) de atraso).");
  });
});

describe("invoicePdfFileName", () => {
  it("builds a file name without a slash — it would break the download", () => {
    expect(invoicePdfFileName("FAT-2026-00007", "08/2026")).toBe("FAT-2026-00007-08-2026.pdf");
  });
});
