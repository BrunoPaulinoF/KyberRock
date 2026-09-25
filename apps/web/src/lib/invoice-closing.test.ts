import { describe, expect, it } from "vitest";

import { INVOICE_CLOSING_NOTE } from "./desktop/invoice-closing-render";
import { escapeHtml } from "./desktop/report-document";
import {
  buildInvoiceClosingFiles,
  buildInvoiceClosingReport,
  computeCreditInvoiceSchedule,
  creditClosingConfigFromCustomer,
  defaultInvoiceClosingPeriod,
  groupDuplicateWeighings,
  invoiceNumberLabel,
  isBillable,
  lineSituation,
  omieReference,
  periodSchedule,
  resolveInvoiceClosingPeriod,
  resolveSituation,
  type DuplicateCandidate,
  type InvoiceClosingOptions,
  type InvoiceClosingPeriodSelection
} from "./invoice-closing";
import type { BillingRequest, Customer, Operation } from "./queries";

function op(id: string, extra: Partial<Operation> = {}): Operation {
  return {
    id,
    company_id: "co",
    unit_id: "u1",
    status: "synced",
    operation_type: "invoice",
    operation_code: Number(id.replace(/\D/g, "")) || 1,
    customer_id: "c1",
    customer_name: "CLIENTE UM",
    plate: "ABC1D23",
    product_id: "p1",
    product_description: "PEDRISCO",
    carrier_id: null,
    carrier_name: "TRANSPORTES BETA",
    driver_name: "JOSE",
    entry_weight_kg: 15000,
    exit_weight_kg: 41000,
    net_weight_kg: 26000,
    unit_price_cents: 6500,
    price_unit: "ton",
    product_total_cents: 169000,
    freight_total_cents: 0,
    total_cents: 169000,
    created_at: "2026-09-17T12:00:00.000Z",
    closed_at: "2026-09-17T13:00:00.000Z",
    omie_invoice_number: null,
    omie_billing_status: null,
    omie_billing_message: null,
    omie_sales_order_id: null,
    omie_service_order_id: null,
    ...extra
  } as Operation;
}

function customer(id: string, extra: Partial<Customer> = {}): Customer {
  return {
    id,
    trade_name: `CLIENTE ${id.toUpperCase()}`,
    legal_name: `CLIENTE ${id.toUpperCase()} LTDA`,
    document: null,
    omie_customer_id: null,
    credit_account_enabled: false,
    credit_periodicity: null,
    credit_closing_day: null,
    credit_boleto_days: null,
    credit_second_closing_day: null,
    credit_second_boleto_days: null,
    credit_closing_weekday: null,
    ...extra
  } as Customer;
}

const secondHalf: InvoiceClosingPeriodSelection = {
  kind: "biweekly",
  month: "2026-09",
  half: 2,
  weekDay: "2026-09-24",
  customStart: "2026-09-01",
  customEnd: "2026-09-10"
};

function options(extra: Partial<InvoiceClosingOptions> = {}): InvoiceClosingOptions {
  return {
    startDate: "2026-09-16",
    endDate: "2026-09-30",
    basis: "period",
    periodCycle: "biweekly",
    cycles: [],
    customerId: null,
    plates: [],
    search: "",
    ...extra
  };
}

describe("periodo do fechamento", () => {
  it("quinzena, mes, semana e personalizado como no desktop", () => {
    expect(resolveInvoiceClosingPeriod(secondHalf)).toMatchObject({
      start: "2026-09-16",
      end: "2026-09-30",
      label: "2a quinzena de setembro de 2026",
      cycle: "biweekly"
    });
    expect(resolveInvoiceClosingPeriod({ ...secondHalf, half: 1 })).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-15"
    });
    expect(
      resolveInvoiceClosingPeriod({ ...secondHalf, kind: "monthly", month: "2026-02" })
    ).toMatchObject({ start: "2026-02-01", end: "2026-02-28", cycle: "monthly" });
    // 24/09/2026 e quinta: a semana comeca na segunda 21.
    expect(resolveInvoiceClosingPeriod({ ...secondHalf, kind: "weekly" })).toMatchObject({
      start: "2026-09-21",
      end: "2026-09-27",
      cycle: "weekly"
    });
    // Intervalo invertido e trocado de lugar.
    expect(
      resolveInvoiceClosingPeriod({
        ...secondHalf,
        kind: "custom",
        customStart: "2026-09-10",
        customEnd: "2026-09-01"
      })
    ).toMatchObject({ start: "2026-09-01", end: "2026-09-10", cycle: null });
  });

  it("abre na quinzena de hoje", () => {
    expect(defaultInvoiceClosingPeriod(new Date(2026, 8, 24))).toMatchObject({
      kind: "biweekly",
      month: "2026-09",
      half: 2
    });
    expect(defaultInvoiceClosingPeriod(new Date(2026, 8, 15)).half).toBe(1);
  });
});

describe("vencimento", () => {
  it("base periodo: fecha no ultimo dia e vence no prazo do segundo fechamento", () => {
    expect(periodSchedule("2026-09-30", null)).toEqual({
      closingDate: "2026-09-30",
      dueDate: "2026-09-30"
    });
    const config = creditClosingConfigFromCustomer(
      customer("c1", {
        credit_account_enabled: true,
        credit_periodicity: "biweekly",
        credit_boleto_days: 5,
        credit_second_boleto_days: 10
      })
    );
    expect(periodSchedule("2026-09-30", config)).toEqual({
      closingDate: "2026-09-30",
      dueDate: "2026-10-10"
    });
  });

  it("base cadastro: a venda cai no proximo fechamento", () => {
    const biweekly = {
      periodicity: "biweekly" as const,
      firstClosingDay: 1,
      secondClosingDay: 16,
      firstBoletoDays: 10,
      secondBoletoDays: 15
    };
    expect(computeCreditInvoiceSchedule(biweekly, "2026-09-10")).toEqual({
      closingDate: "2026-09-16",
      dueDate: "2026-10-01"
    });
    expect(computeCreditInvoiceSchedule(biweekly, "2026-09-20")).toEqual({
      closingDate: "2026-10-01",
      dueDate: "2026-10-11"
    });
    expect(
      computeCreditInvoiceSchedule(
        { periodicity: "monthly", closingDay: 31, boletoDays: 0 },
        "2026-02-10"
      )
    ).toEqual({ closingDate: "2026-02-28", dueDate: "2026-02-28" });
    // 24/09/2026 e quinta (4); fechamento no sabado (6).
    expect(
      computeCreditInvoiceSchedule(
        { periodicity: "weekly", closingWeekday: 6, boletoDays: 3 },
        "2026-09-24"
      )
    ).toEqual({ closingDate: "2026-09-26", dueDate: "2026-09-29" });
  });
});

describe("situacao e nota", () => {
  it("le as mesmas colunas do desktop", () => {
    expect(resolveSituation(op("o1", { omie_billing_status: "billed" }))).toBe("billed");
    expect(resolveSituation(op("o1", { omie_sales_order_id: 9 }))).toBe("sent");
    expect(resolveSituation(op("o1", { omie_billing_status: "failed" }))).toBe("failed");
    expect(
      resolveSituation(op("o1", { operation_type: "internal", omie_service_order_id: 3 }))
    ).toBe("sent");
    expect(resolveSituation(op("o1"))).toBe("pending");
  });

  it("venda interna nao cobra nota", () => {
    expect(invoiceNumberLabel(null, "internal").state).toBe("not_applicable");
    expect(invoiceNumberLabel(null, "invoice").text).toBe("Sem nota");
    expect(invoiceNumberLabel("123", "invoice").state).toBe("number");
  });
});

describe("repetidas", () => {
  const candidate = (id: string, extra: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
    operationId: id,
    couponNumber: Number(id.slice(1)),
    createdAt: `2026-09-1${id.slice(1)}T10:00:00Z`,
    date: `2026-09-1${id.slice(1)}`,
    customerKey: "doc:1",
    customerName: "CLIENTE",
    plate: "ABC1D23",
    productKey: "p1",
    productDescription: "PEDRISCO",
    entryWeightKg: 15000,
    exitWeightKg: 41000,
    totalCents: 100,
    operationType: "invoice",
    invoiceNumber: null,
    ...extra
  });

  it("sem nota, fica a ultima; com nota, fica a que tem nota", () => {
    const [group] = groupDuplicateWeighings([candidate("x1"), candidate("x2")]);
    expect(group.keepers.map((c) => c.operationId)).toEqual(["x2"]);
    expect(group.duplicates.map((c) => c.operationId)).toEqual(["x1"]);

    const [billed] = groupDuplicateWeighings([
      candidate("x1", { invoiceNumber: "55" }),
      candidate("x2")
    ]);
    expect(billed.keepers.map((c) => c.operationId)).toEqual(["x1"]);
  });

  it("pesos diferentes sao viagens diferentes", () => {
    expect(
      groupDuplicateWeighings([candidate("x1"), candidate("x2", { exitWeightKg: 41010 })])
    ).toEqual([]);
  });
});

describe("relatorio do fechamento", () => {
  const customers = [
    customer("c1", { document: "12.345.678/0001-90" }),
    // O mesmo CNPJ cadastrado de novo: e o MESMO cliente.
    customer("c1b", { document: "12345678000190", trade_name: "CLIENTE UM (BALANCA)" }),
    customer("c2")
  ];

  it("uma fatura por cliente real, fechando no fim do periodo", () => {
    const report = buildInvoiceClosingReport(
      {
        operations: [
          op("o1"),
          op("o2", { customer_id: "c1b" }),
          op("o3", { customer_id: "c2", omie_invoice_number: "77" }),
          op("o4", { status: "cancelled" })
        ],
        customers
      },
      options()
    );
    expect(report.invoices).toHaveLength(2);
    expect(report.customers).toBe(2);
    expect(report.invoices[0]).toMatchObject({
      customerName: "CLIENTE C1",
      closingDate: "2026-09-30",
      dueDate: "2026-09-30",
      cycleLabel: "Quinzenal",
      operationsWithoutInvoice: 2
    });
    expect(report.totals.operations).toBe(3);
    expect(report.withoutInvoice.operations).toBe(2);
    expect(report.byCarrier[0]).toMatchObject({ carrierName: "TRANSPORTES BETA", trips: 3 });
  });

  it("base cadastro: cliente sem credito vai para fora do fechamento", () => {
    const report = buildInvoiceClosingReport(
      { operations: [op("o1", { customer_id: "c2" })], customers },
      options({ basis: "customer" })
    );
    expect(report.invoices).toEqual([]);
    expect(report.pendingSetup).toMatchObject([{ customerName: "CLIENTE C2", operations: 1 }]);
    expect(report.rows[0].closingDate).toBeNull();
  });

  it("placa marcada separa a fatura por caminhao", () => {
    const report = buildInvoiceClosingReport(
      {
        operations: [op("o1"), op("o2", { plate: "XYZ9K88" }), op("o3", { plate: "QWE2R34" })],
        customers
      },
      options({ plates: ["abc1d23", "XYZ9K88"] })
    );
    expect(report.invoices.map((invoice) => invoice.plate)).toEqual(["ABC1D23", "XYZ9K88"]);
    expect(report.availablePlates).toEqual(["ABC1D23", "QWE2R34", "XYZ9K88"]);
  });

  it("repetida sai da fatura e nao entra no pedido de faturamento", () => {
    const operations = [
      op("o1", { created_at: "2026-09-17T10:00:00Z" }),
      op("o2", { created_at: "2026-09-18T10:00:00Z" })
    ];
    const report = buildInvoiceClosingReport(
      { operations, customers, duplicateRows: operations },
      options()
    );
    expect(report.duplicates).toHaveLength(1);
    expect(report.totals.operations).toBe(1);
    const repeated = report.rows.find((line) => line.operationId === "o1");
    expect(repeated?.isDuplicate).toBe(true);
    expect(repeated && isBillable(repeated)).toBe(false);
    expect(report.rows.filter(isBillable).map((line) => line.operationId)).toEqual(["o2"]);
  });

  it("pedido na fila da balanca nao e pedido de novo", () => {
    const request = {
      id: "r1",
      operation_id: "o1",
      status: "pending",
      requested_at: "2026-09-20T10:00:00Z",
      processed_at: null,
      result_message: null
    } as BillingRequest;
    const report = buildInvoiceClosingReport(
      {
        operations: [op("o1"), op("o2", { operation_type: "internal" })],
        customers,
        billingRequests: [request]
      },
      options()
    );
    const [first, second] = report.rows;
    expect(isBillable(first)).toBe(false);
    expect(lineSituation(first).label).toBe("Aguardando a balanca");
    expect(isBillable(second)).toBe(false);
  });

  it("busca e filtro de cliente pelo cadastro real", () => {
    const report = buildInvoiceClosingReport(
      {
        operations: [op("o1"), op("o2", { customer_id: "c1b" }), op("o3", { customer_id: "c2" })],
        customers
      },
      options({ customerId: "c1b" })
    );
    expect(report.rows.map((line) => line.operationId)).toEqual(["o1", "o2"]);

    const searched = buildInvoiceClosingReport(
      { operations: [op("o1"), op("o2", { plate: "XYZ9K88" })], customers },
      options({ search: "xyz-9k88" })
    );
    expect(searched.rows.map((line) => line.operationId)).toEqual(["o2"]);
  });

  it("traz o envelope e os campos que o documento do desktop le", () => {
    const operations = [
      op("o1", { created_at: "2026-09-17T10:00:00Z", omie_sales_order_id: 555 }),
      op("o2", { created_at: "2026-09-18T10:00:00Z", customer_id: "c1b" })
    ];
    const report = buildInvoiceClosingReport(
      { operations, customers, duplicateRows: operations },
      options({
        plates: [" xyz9k88", "abc1d23", "ABC1D23"],
        search: "  ",
        periodLabel: "2a quinzena de setembro de 2026"
      })
    );
    expect(report).toMatchObject({
      startDate: "2026-09-16",
      endDate: "2026-09-30",
      periodLabel: "2a quinzena de setembro de 2026",
      filters: {
        basis: "period",
        periodCycle: "biweekly",
        cycles: [],
        customerId: null,
        // Normalizadas e em ordem, como o desktop: e a lista que vai no nome do arquivo.
        plates: ["ABC1D23", "XYZ9K88"],
        search: null
      }
    });
    const line = report.rows.find((row) => row.operationId === "o1");
    // O documento como esta no cadastro (o desktop nao remascara) e sem numero visivel do
    // pedido, que a nuvem nao projeta.
    expect(line).toMatchObject({ customerDocument: "12.345.678/0001-90", omieOrderNumber: null });
    expect(report.duplicates[0].kept[0]).toMatchObject({
      operationId: "o2",
      operationTypeLabel: "Com nota",
      inPeriod: true
    });
    expect(report.duplicates[0].repeats[0]).toMatchObject({ operationId: "o1", inPeriod: true });

    const joined = buildInvoiceClosingReport({ operations, customers }, options());
    expect(joined.invoices[0].customerIds).toEqual(["c1", "c1b"]);

    const pending = buildInvoiceClosingReport(
      { operations: [op("o1", { customer_id: "c2" })], customers },
      options({ basis: "customer" })
    );
    expect(pending.pendingSetup[0].customerId).toBe("c2");
  });

  it("omie: pedido ou OS, com o numero visivel quando ha", () => {
    expect(
      omieReference({ omieOrderNumber: "1234", omieSalesOrderId: 9, omieServiceOrderId: null })
    ).toBe("Pedido 9 (nº 1234)");
    expect(
      omieReference({ omieOrderNumber: null, omieSalesOrderId: null, omieServiceOrderId: 8 })
    ).toBe("OS 8");
    expect(
      omieReference({ omieOrderNumber: null, omieSalesOrderId: null, omieServiceOrderId: null })
    ).toBe("-");
  });
});

describe("arquivos do fechamento (os do desktop)", () => {
  const customers = [customer("c1", { document: "12.345.678/0001-90" }), customer("c2")];
  const generatedAt = new Date(2026, 9, 1, 8, 30);

  it("nome do arquivo com o ciclo e as placas, igual ao desktop", () => {
    const period = buildInvoiceClosingReport(
      { operations: [op("o1")], customers },
      options({ periodLabel: "2a quinzena de setembro de 2026" })
    );
    const files = buildInvoiceClosingFiles(period, ["pdf", "excel"], generatedAt);
    expect(files.pdf.map((file) => file.filename)).toEqual([
      "fechamento-faturas-quinzenal-2026-09-16-a-2026-09-30.pdf"
    ]);
    expect(files.xls.map((file) => file.filename)).toEqual([
      "fechamento-faturas-quinzenal-2026-09-16-a-2026-09-30.xls"
    ]);

    const custom = buildInvoiceClosingReport(
      { operations: [op("o1")], customers },
      options({ periodCycle: null, plates: ["xyz9k88", "ABC1D23"] })
    );
    expect(buildInvoiceClosingFiles(custom, ["excel"]).xls[0].filename).toBe(
      "fechamento-faturas-periodo-abc1d23-xyz9k88-2026-09-16-a-2026-09-30.xls"
    );
    expect(buildInvoiceClosingFiles(custom, ["excel"]).pdf).toEqual([]);

    const byCycle = buildInvoiceClosingReport(
      { operations: [op("o1")], customers },
      options({
        basis: "customer",
        cycles: ["monthly", "weekly"],
        plates: ["A1", "B2", "C3", "D4"]
      })
    );
    expect(buildInvoiceClosingFiles(byCycle, ["pdf"]).pdf[0].filename).toBe(
      "fechamento-faturas-mensal-semanal-4-placas-2026-09-16-a-2026-09-30.pdf"
    );
  });

  it("PDF e planilha com as secoes, colunas e totais do desktop", () => {
    const operations = [
      op("o1", { created_at: "2026-09-17T10:00:00Z", freight_total_cents: 26000 }),
      op("o2", { created_at: "2026-09-18T10:00:00Z" }),
      op("o3", {
        customer_id: "c2",
        plate: "XYZ9K88",
        net_weight_kg: 10000,
        total_cents: 65000,
        product_total_cents: 65000,
        omie_invoice_number: "4321"
      })
    ];
    const report = buildInvoiceClosingReport(
      { operations, customers, duplicateRows: operations },
      options({ periodLabel: "2a quinzena de setembro de 2026" })
    );
    const { pdf, xls } = buildInvoiceClosingFiles(report, ["pdf", "excel"], generatedAt);
    const html = pdf[0].html;
    for (const text of [
      "<title>Fechamento de faturas</title>",
      "@page",
      "Quinzenal",
      "2a quinzena de setembro de 2026 - 16/09/2026 a 30/09/2026",
      "Carga a carga",
      "Faturas do periodo",
      "Pesagem a pesagem (3) - 1 fora do fechamento",
      "Transportadores e placas",
      "Pesagens repetidas (1)",
      "Total a faturar",
      "Cargas sem nota",
      "TOTAL DO PERIODO",
      "Produto (R$/t)",
      "Pedido/OS OMIE",
      "CLIENTE C1 — Quinzenal — fecha 30/09/2026 — vence 30/09/2026",
      "12.345.678/0001-90",
      "4321"
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain(escapeHtml(INVOICE_CLOSING_NOTE));

    const sheet = xls[0].html;
    expect(sheet).toContain("xmlns:x=");
    expect(sheet).toContain("<h1>Fechamento de faturas</h1>");
    expect(sheet).toContain("Faturas do periodo");
    expect(sheet).toContain("TOTAL DO PERIODO");
    expect(sheet).toContain("x:num");
  });
});
