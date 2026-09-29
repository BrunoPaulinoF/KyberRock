import { describe, expect, it } from "vitest";

import {
  billingEventLabel,
  billingEventTone,
  buildActivationChecklist,
  centsToInput,
  countActivationBlockers,
  daysOverdue,
  describeNextClosing,
  filterInvoices,
  findSecret,
  formatCents,
  formatDateBr,
  invoiceStatusLabel,
  invoiceStatusTone,
  isActivationComplete,
  parseMoneyToCents,
  summarizeInvoiceList
} from "./billing";
import type { BillingCompany, BillingInvoice, BillingSettingsView } from "./billing";

function invoice(overrides: Partial<BillingInvoice> = {}): BillingInvoice {
  return {
    id: "invoice-1",
    company_id: "company-1",
    number: "FAT-2026-00001",
    status: "open",
    period_start: "2026-08-05",
    period_end: "2026-08-25",
    closing_date: "2026-08-25",
    due_date: "2026-09-05",
    reference_label: "08/2026",
    base_amount_cents: 60_968,
    amount_cents: 60_968,
    discount_cents: 0,
    addition_cents: 0,
    prorated_days: 21,
    full_period_days: 31,
    is_prorated: true,
    notes: null,
    boleto_status: null,
    boleto_payment_id: null,
    boleto_url: null,
    boleto_barcode: null,
    boleto_error: null,
    boleto_issued_at: null,
    whatsapp_to: null,
    whatsapp_sent_at: null,
    whatsapp_error: null,
    paid_at: null,
    paid_amount_cents: null,
    payment_method: null,
    canceled_at: null,
    cancel_reason: null,
    blocked_at: null,
    created_at: "2026-08-25T12:00:00Z",
    updated_at: "2026-08-25T12:00:00Z",
    ...overrides
  };
}

function company(overrides: Partial<BillingCompany> = {}): BillingCompany {
  return {
    id: "company-1",
    name: "Pedreira Serra Azul",
    legal_name: "Serra Azul Mineracao LTDA",
    document: "12345678000199",
    is_active: true,
    payment_blocked: false,
    payment_blocked_reason: null,
    billing_legal_name: null,
    billing_document: null,
    billing_email: "financeiro@serraazul.com.br",
    billing_phone: "31998765432",
    billing_contact_name: null,
    billing_zipcode: "30140071",
    billing_address_street: "Av. Afonso Pena",
    billing_address_number: "1500",
    billing_address_complement: null,
    billing_neighborhood: "Centro",
    billing_city: "Belo Horizonte",
    billing_state: "MG",
    billing_monthly_amount_cents: 90_000,
    billing_start_date: "2026-08-05",
    billing_closing_day: 25,
    billing_due_day: 5,
    billing_grace_days: null,
    billing_enabled: true,
    billing_block_exempt: false,
    billing_notes: null,
    billing_plan: {
      graceDays: 5,
      closingDay: 25,
      dueDay: 5,
      monthlyAmountCents: 90_000,
      nextPeriod: {
        periodStart: "2026-08-05",
        periodEnd: "2026-08-25",
        closingDate: "2026-08-25",
        dueDate: "2026-09-05",
        billedDays: 21,
        fullPeriodDays: 31,
        isProrated: true,
        referenceLabel: "08/2026"
      },
      nextAmountCents: 60_968,
      blockers: [],
      missing: { boleto: [], whatsapp: [] },
      readyToClose: true
    },
    ...overrides
  };
}

describe("formatCents", () => {
  it("formats Brazilian currency", () => {
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(60_968)).toBe("R$ 609,68");
    expect(formatCents(123_456_789)).toBe("R$ 1.234.567,89");
    expect(formatCents(null)).toBe("R$ 0,00");
  });
});

describe("centsToInput", () => {
  it("feeds the form field without the currency symbol", () => {
    expect(centsToInput(90_000)).toBe("900,00");
    expect(centsToInput(60_968)).toBe("609,68");
    expect(centsToInput(null)).toBe("");
  });
});

describe("parseMoneyToCents", () => {
  it("accepts the Brazilian format", () => {
    expect(parseMoneyToCents("1.234,56")).toBe(123_456);
    expect(parseMoneyToCents("900,00")).toBe(90_000);
    expect(parseMoneyToCents("R$ 900")).toBe(90_000);
  });

  it("accepts the format pasted from a spreadsheet", () => {
    expect(parseMoneyToCents("1234.56")).toBe(123_456);
    expect(parseMoneyToCents("1234")).toBe(123_400);
  });

  it("reads a lone thousands separator as thousands, not decimals", () => {
    expect(parseMoneyToCents("1.500")).toBe(150_000);
    expect(parseMoneyToCents("1.234.567")).toBe(123_456_700);
  });

  it("is null for anything that is not a positive amount", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-50")).toBeNull();
  });
});

describe("formatDateBr", () => {
  it("formats ISO dates and ignores the rest", () => {
    expect(formatDateBr("2026-08-25")).toBe("25/08/2026");
    expect(formatDateBr("2026-08-25T10:00:00Z")).toBe("25/08/2026");
    expect(formatDateBr(null)).toBe("");
    expect(formatDateBr("25/08/2026")).toBe("");
  });
});

describe("daysOverdue", () => {
  it("counts the days past the due date", () => {
    expect(daysOverdue("2026-09-05", "2026-09-05")).toBe(0);
    expect(daysOverdue("2026-09-05", "2026-09-11")).toBe(6);
    expect(daysOverdue("2026-09-05", "2026-09-01")).toBe(-4);
    expect(daysOverdue("", "2026-09-01")).toBe(0);
  });
});

describe("invoice status labels", () => {
  it("translates the known statuses and passes through the unknown", () => {
    expect(invoiceStatusLabel("overdue")).toBe("Vencida");
    expect(invoiceStatusLabel("paid")).toBe("Paga");
    expect(invoiceStatusLabel("whatever")).toBe("whatever");
    expect(invoiceStatusTone("overdue")).toBe("danger");
    expect(invoiceStatusTone("paid")).toBe("ok");
    expect(invoiceStatusTone("whatever")).toBe("neutral");
  });
});

describe("filterInvoices", () => {
  const companies = new Map([
    ["company-1", "Pedreira Serra Azul"],
    ["company-2", "Pedreira Morro Alto"]
  ]);
  const invoices = [
    invoice(),
    invoice({ id: "invoice-2", company_id: "company-2", number: "FAT-2026-00002", status: "paid" }),
    invoice({
      id: "invoice-3",
      number: "FAT-2026-00003",
      status: "overdue",
      reference_label: "07/2026"
    })
  ];

  it("filters by company", () => {
    expect(
      filterInvoices(invoices, companies, { companyId: "company-2" }).map((i) => i.id)
    ).toEqual(["invoice-2"]);
  });

  it("filters by status", () => {
    expect(filterInvoices(invoices, companies, { status: "overdue" }).map((i) => i.id)).toEqual([
      "invoice-3"
    ]);
  });

  it("searches by number, reference and company name", () => {
    expect(filterInvoices(invoices, companies, { search: "00002" }).map((i) => i.id)).toEqual([
      "invoice-2"
    ]);
    expect(filterInvoices(invoices, companies, { search: "07/2026" }).map((i) => i.id)).toEqual([
      "invoice-3"
    ]);
    expect(filterInvoices(invoices, companies, { search: "morro" }).map((i) => i.id)).toEqual([
      "invoice-2"
    ]);
  });

  it("returns everything with no filter", () => {
    expect(filterInvoices(invoices, companies, {})).toHaveLength(3);
  });
});

describe("summarizeInvoiceList", () => {
  it("totals only what is on screen and ignores canceled invoices", () => {
    const summary = summarizeInvoiceList([
      invoice({ amount_cents: 10_000, status: "open" }),
      invoice({ id: "b", amount_cents: 20_000, status: "overdue" }),
      invoice({ id: "c", amount_cents: 30_000, status: "paid", paid_amount_cents: 29_000 }),
      invoice({ id: "d", amount_cents: 99_000, status: "canceled" })
    ]);
    expect(summary).toEqual({
      count: 4,
      totalCents: 60_000,
      openCents: 10_000,
      overdueCents: 20_000,
      paidCents: 29_000
    });
  });
});

describe("describeNextClosing", () => {
  it("describes the next closing with the prorated amount", () => {
    expect(describeNextClosing(company())).toBe(
      "Fecha em 25/08/2026, vence em 05/09/2026 — R$ 609,68 (proporcional, 21/31 dias)"
    );
  });

  it("says when automatic billing is off", () => {
    expect(describeNextClosing(company({ billing_enabled: false }))).toBe(
      "Cobranca automatica desligada"
    );
  });

  it("asks for the go-live date when there is no cycle", () => {
    const target = company();
    expect(
      describeNextClosing({
        ...target,
        billing_plan: { ...target.billing_plan, nextPeriod: null, nextAmountCents: null }
      })
    ).toBe("Informe a data de virada do sistema");
  });
});

describe("findSecret", () => {
  const settings = {
    secrets: [
      {
        key: "mercadoPagoAccessToken",
        label: "Access token do Mercado Pago",
        purpose: "Conta que emite os boletos.",
        missingHint: "Sem ele nenhum boleto e emitido.",
        required: true,
        envVar: "MERCADO_PAGO_ACCESS_TOKEN",
        configured: true,
        preview: "••••3456"
      }
    ]
  };

  it("finds the secret by key", () => {
    expect(findSecret(settings, "mercadoPagoAccessToken").envVar).toBe("MERCADO_PAGO_ACCESS_TOKEN");
    expect(findSecret(settings, "mercadoPagoAccessToken").configured).toBe(true);
  });

  it("returns a safe empty status for an unknown key instead of crashing the screen", () => {
    expect(findSecret(settings, "naoExiste")).toEqual({
      key: "naoExiste",
      label: "naoExiste",
      purpose: "",
      missingHint: "",
      required: false,
      envVar: "",
      configured: false,
      preview: ""
    });
  });

  it("survives a backend that does not send the list at all", () => {
    expect(
      findSecret({ secrets: undefined as unknown as typeof settings.secrets }, "x").configured
    ).toBe(false);
  });
});

describe("billingEventLabel / billingEventTone", () => {
  it("translates the known event types", () => {
    expect(billingEventLabel("boleto_issued")).toBe("Boleto emitido");
    expect(billingEventLabel("company_blocked")).toBe("Pedreira bloqueada");
  });

  it("shows an unknown type as it came instead of hiding it", () => {
    expect(billingEventLabel("evento_novo_do_motor")).toBe("evento_novo_do_motor");
    expect(billingEventTone("evento_novo_do_motor")).toBe("neutral");
  });

  it("paints failure red and delivery green", () => {
    expect(billingEventTone("boleto_failed")).toBe("danger");
    expect(billingEventTone("invoice_paid")).toBe("ok");
  });
});

describe("buildActivationChecklist", () => {
  function secret(key: string, configured: boolean) {
    return {
      key,
      label: key,
      purpose: "",
      missingHint: "",
      required: true,
      envVar: key === "mercadoPagoAccessToken" ? "MERCADO_PAGO_ACCESS_TOKEN" : "UAZAPI_TOKEN",
      configured,
      preview: configured ? "••••3456" : ""
    };
  }

  function settings(overrides: Partial<BillingSettingsView> = {}): BillingSettingsView {
    return {
      mercadoPagoEnvironment: "production",
      secrets: [
        secret("mercadoPagoAccessToken", true),
        secret("mercadoPagoWebhookSecret", true),
        secret("whatsappInstanceToken", true)
      ],
      whatsappUrl: "https://kybernan.uazapi.com",
      whatsappInstanceName: "financeiro",
      whatsappStatus: "connected",
      defaultClosingDay: 25,
      defaultDueDay: 5,
      defaultGraceDays: 5,
      autoCloseEnabled: true,
      autoBoletoEnabled: true,
      autoWhatsappEnabled: true,
      autoBlockEnabled: true,
      issuerName: "Kybernan",
      issuerDocument: "12.345.678/0001-99",
      issuerEmail: "financeiro@kybernan.com.br",
      issuerPhone: "31999999999",
      issuerPixKey: "",
      invoiceDescriptionTemplate: "",
      whatsappMessageTemplate: "",
      ...overrides
    };
  }

  function stepById(steps: ReturnType<typeof buildActivationChecklist>, id: string) {
    const step = steps.find((candidate) => candidate.id === id);
    if (!step) throw new Error(`passo ${id} nao encontrado`);
    return step;
  }

  it("clears everything when settings, secrets and one company are complete", () => {
    const steps = buildActivationChecklist({ settings: settings(), companies: [company()] });
    expect(isActivationComplete(steps)).toBe(true);
    expect(countActivationBlockers(steps)).toBe(0);
  });

  it("blocks on the Mercado Pago secret and names the variable to create", () => {
    const steps = buildActivationChecklist({
      settings: settings({
        secrets: [
          secret("mercadoPagoAccessToken", false),
          secret("mercadoPagoWebhookSecret", true),
          secret("whatsappInstanceToken", true)
        ]
      }),
      companies: [company()]
    });
    const step = stepById(steps, "mercado-pago-token");
    expect(step.status).toBe("pending");
    expect(step.detail).toContain("MERCADO_PAGO_ACCESS_TOKEN");
    expect(countActivationBlockers(steps)).toBe(1);
  });

  it("lists every missing piece of the WhatsApp delivery", () => {
    const steps = buildActivationChecklist({
      settings: settings({
        whatsappUrl: "",
        whatsappInstanceName: "",
        secrets: [
          secret("mercadoPagoAccessToken", true),
          secret("mercadoPagoWebhookSecret", true),
          secret("whatsappInstanceToken", false)
        ]
      }),
      companies: [company()]
    });
    const step = stepById(steps, "whatsapp");
    expect(step.status).toBe("pending");
    expect(step.items).toHaveLength(3);
  });

  it("treats the issuer and the webhook signature as recommendations, not blockers", () => {
    const steps = buildActivationChecklist({
      settings: settings({
        issuerDocument: "",
        issuerEmail: "",
        issuerPhone: "",
        secrets: [
          secret("mercadoPagoAccessToken", true),
          secret("mercadoPagoWebhookSecret", false),
          secret("whatsappInstanceToken", true)
        ]
      }),
      companies: [company()]
    });
    expect(stepById(steps, "issuer").status).toBe("warn");
    expect(stepById(steps, "issuer").items).toEqual([
      "CNPJ do emitente",
      "E-mail ou telefone de suporte"
    ]);
    expect(stepById(steps, "webhook-secret").status).toBe("warn");
    expect(countActivationBlockers(steps)).toBe(0);
    expect(isActivationComplete(steps)).toBe(false);
  });

  it("warns while the sandbox is selected", () => {
    const steps = buildActivationChecklist({
      settings: settings({ mercadoPagoEnvironment: "sandbox" }),
      companies: [company()]
    });
    expect(stepById(steps, "environment").status).toBe("warn");
  });

  it("blocks when no company has billing turned on, showing what each one still needs", () => {
    const steps = buildActivationChecklist({
      settings: settings(),
      companies: [
        company({
          billing_enabled: false,
          billing_plan: {
            ...company().billing_plan,
            blockers: ["Valor acertado nao informado", "CEP em falta"],
            readyToClose: false
          }
        })
      ]
    });
    const step = stepById(steps, "companies");
    expect(step.status).toBe("pending");
    expect(step.items).toEqual([
      "Pedreira Serra Azul: Cobranca automatica desligada, Valor acertado nao informado, CEP em falta"
    ]);
  });

  it("only warns when part of the enabled companies is ready", () => {
    const incomplete = company({
      id: "company-2",
      name: "Pedreira Ibiuna",
      billing_plan: {
        ...company().billing_plan,
        blockers: ["Data de virada do sistema nao informada"],
        readyToClose: false
      }
    });
    const steps = buildActivationChecklist({
      settings: settings(),
      companies: [company(), incomplete]
    });
    const step = stepById(steps, "companies");
    expect(step.status).toBe("warn");
    expect(step.items).toEqual(["Pedreira Ibiuna: Data de virada do sistema nao informada"]);
    expect(countActivationBlockers(steps)).toBe(0);
  });

  it("blocks when there is no company at all", () => {
    const steps = buildActivationChecklist({ settings: settings(), companies: [] });
    expect(stepById(steps, "companies").status).toBe("pending");
  });
});
