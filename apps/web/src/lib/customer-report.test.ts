import { describe, expect, it } from "vitest";

import {
  buildCustomerOptions,
  buildCustomerReport,
  buildCustomerReportFiles,
  buildCustomersOverview,
  buildCustomersOverviewFiles,
  customerReportTables,
  dueDaysFromRules,
  formatDatesSummary,
  invoiceNumberText,
  maxDueDays,
  resolveCustomerIdGroup,
  resolveRange,
  splitInstallmentAmounts,
  type ReportCustomerRow,
  type ReportLookups,
  type ReportOperationRow
} from "./customer-report";

function customer(overrides: Partial<ReportCustomerRow> & { id: string }): ReportCustomerRow {
  return {
    legal_name: "CLIENTE LTDA",
    trade_name: "CLIENTE",
    document: null,
    phone: null,
    email: null,
    address_street: null,
    address_number: null,
    neighborhood: null,
    city: null,
    state: null,
    credit_limit_cents: null,
    open_receivables_cents: 0,
    omie_customer_id: null,
    default_payment_term_id: null,
    default_carrier_id: null,
    is_active: true,
    deleted_at: null,
    ...overrides
  };
}

function operation(
  overrides: Partial<ReportOperationRow> & { id: string; closed_at: string | null }
): ReportOperationRow {
  return {
    operation_code: 1,
    status: "synced",
    operation_type: "invoice",
    cancel_reason: null,
    created_at: overrides.closed_at ?? "2026-09-01T12:00:00Z",
    customer_id: "c1",
    customer_name: "CLIENTE",
    product_id: "p1",
    product_description: "PEDRISCO",
    plate: "ABC1D23",
    driver_name: "JOSE",
    carrier_id: null,
    carrier_name: null,
    freight_type: "none",
    freight_json: null,
    freight_total_cents: 0,
    entry_weight_kg: 15_000,
    exit_weight_kg: 25_000,
    net_weight_kg: 10_000,
    unit_price_cents: 6_500,
    base_unit_price_cents: 6_500,
    applied_price_table_name: null,
    price_savings_percent: null,
    product_total_cents: 65_000,
    total_cents: 65_000,
    payment_method_id: null,
    payment_term_id: null,
    omie_sales_order_id: null,
    omie_service_order_id: null,
    omie_invoice_number: null,
    omie_billing_status: null,
    cloud_synced_at: "2026-09-01T12:00:00Z",
    ...overrides
  };
}

const LOOKUPS: ReportLookups = {
  customers: [
    customer({ id: "c1", trade_name: "ALFA", document: "12.345.678/0001-95" }),
    customer({ id: "c2", trade_name: "ALFA (OMIE)", document: "12345678000195" }),
    customer({ id: "c3", trade_name: "BETA" })
  ],
  products: [{ id: "p1", code: "PED", description: "PEDRISCO", unit: "t" }],
  carriers: [],
  paymentMethods: [{ id: "pm1", name: "BOLETO" }],
  paymentTerms: [
    { id: "t28", name: "28 DIAS", rules_json: { installments: [{ dueDays: 28 }] } },
    {
      id: "t3060",
      name: "30/60",
      rules_json: JSON.stringify({ installments: [{ dueDays: 30 }, { dueDays: 60 }] })
    }
  ]
};

describe("resolveRange", () => {
  it("mes anterior vai do primeiro ao ultimo dia do mes passado", () => {
    expect(resolveRange("lastMonth", "", "", "2026-03-15")).toMatchObject({
      start: "2026-02-01",
      end: "2026-02-28"
    });
  });

  it("proximos 30 dias comecam hoje", () => {
    expect(resolveRange("next30d", "", "", "2026-09-24")).toMatchObject({
      start: "2026-09-24",
      end: "2026-10-23"
    });
  });

  it("datas personalizadas invertidas viram um periodo valido", () => {
    expect(resolveRange("custom", "2026-09-10", "2026-09-01", "2026-09-24")).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-10"
    });
  });
});

describe("cliente real", () => {
  it("o seletor mostra uma opcao por documento e ignora inativos", () => {
    const options = buildCustomerOptions([
      ...LOOKUPS.customers,
      customer({ id: "c4", trade_name: "GAMA", is_active: false })
    ]);
    expect(options.map((option) => option.name)).toEqual(["ALFA", "BETA"]);
  });

  it("o CNPJ com letra nao vira o mesmo cliente de outro documento", () => {
    const options = buildCustomerOptions([
      customer({ id: "a", trade_name: "A", document: "12.ABC.345/01DE-35" }),
      customer({ id: "b", trade_name: "B", document: "12.345/01-35" })
    ]);
    expect(options).toHaveLength(2);
  });

  it("escolher um cadastro traz as cargas do duplicado", () => {
    expect(resolveCustomerIdGroup(LOOKUPS.customers, "c1").sort()).toEqual(["c1", "c2"]);
    expect(resolveCustomerIdGroup(LOOKUPS.customers, "c3")).toEqual(["c3"]);
  });
});

describe("prazos da condicao", () => {
  it("le o rules_json em objeto ou texto, e sem prazo e a vista", () => {
    expect(dueDaysFromRules({ installments: [{ dueDays: 7 }, { dueDays: 14 }] })).toEqual([7, 14]);
    expect(dueDaysFromRules('{"installments":[{"dueDays":28}]}')).toEqual([28]);
    expect(dueDaysFromRules({ raw: "a vista" })).toEqual([0]);
    expect(dueDaysFromRules("{quebrado")).toEqual([0]);
  });

  it("o prazo mais longo decide quanto a leitura volta no tempo", () => {
    expect(maxDueDays(LOOKUPS)).toBe(60);
  });

  it("o rateio bate o total na ultima parcela", () => {
    expect(splitInstallmentAmounts(10_000, 3)).toEqual([3333, 3333, 3334]);
  });
});

describe("buildCustomerReport", () => {
  const rows: ReportOperationRow[] = [
    // Aberta em 31/08, fechada em 01/09 (Brasilia): e venda de SETEMBRO.
    operation({
      id: "o1",
      created_at: "2026-08-31T20:00:00Z",
      closed_at: "2026-09-01T13:00:00Z",
      payment_term_id: "t28",
      omie_invoice_number: "4521"
    }),
    // Fechada as 22h de 30/09 em Brasilia (01/10 em UTC): ainda e setembro.
    operation({ id: "o2", closed_at: "2026-10-01T01:00:00Z", customer_id: "c2" }),
    // Compra de julho com parcela 30/60 vencendo em setembro.
    operation({
      id: "o3",
      closed_at: "2026-07-20T12:00:00Z",
      payment_term_id: "t3060",
      total_cents: 100_000
    }),
    operation({
      id: "o4",
      status: "cancelled",
      cancel_reason: "Desistiu",
      closed_at: null,
      created_at: "2026-09-10T12:00:00Z"
    })
  ];

  const report = buildCustomerReport({
    customerId: "c1",
    rows,
    lookups: LOOKUPS,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    referenceDate: "2026-09-24"
  });

  it("recorta o periodo pela data de fechamento no fuso da pedreira", () => {
    expect(report.operations.map((op) => op.id)).toEqual(["o1", "o2"]);
    expect(report.totals.operations).toBe(2);
    expect(report.totals.totalCents).toBe(130_000);
    expect(report.totals.avgPriceCentsPerTon).toBe(6_500);
  });

  it("separa as canceladas", () => {
    expect(report.cancelledOperations.map((op) => op.id)).toEqual(["o4"]);
    expect(report.totals.cancelledOperations).toBe(1);
  });

  it("traz as parcelas que vencem no periodo, inclusive de compra anterior", () => {
    expect(
      report.installments.map((item) => [item.operationId, item.dueDate, item.situation])
    ).toEqual([
      ["o3", "2026-09-18", "overdue"],
      ["o1", "2026-09-29", "upcoming"],
      // Sem condicao: a vista, vence no proprio dia da venda.
      ["o2", "2026-09-30", "upcoming"]
    ]);
    expect(report.installmentTotals.overdueCents).toBe(50_000);
    expect(report.installmentTotals.nextDueDate).toBe("2026-09-29");
  });

  it("junta os produtos com os dias de carregamento", () => {
    expect(report.byProduct).toHaveLength(1);
    expect(report.byProduct[0]).toMatchObject({
      productCode: "PED",
      operations: 2,
      dates: ["2026-09-01", "2026-09-30"]
    });
    expect(formatDatesSummary(report.byProduct[0].dates)).toBe("01/09/2026, 30/09/2026");
  });

  it("o modelo completo acrescenta as tabelas de transporte e operacoes", () => {
    expect(customerReportTables(report, "simplified")).toHaveLength(7);
    const complete = customerReportTables(report, "complete").map((table) => table.title);
    expect(complete).toContain("Operacoes (detalhado)");
    expect(complete).toContain("Operacoes canceladas");
  });

  it("gera um arquivo por modelo x formato, com os nomes do desktop", () => {
    const files = buildCustomerReportFiles(
      report,
      ["simplified", "complete"],
      ["pdf", "excel"],
      new Date("2026-09-24T12:00:00Z")
    );
    expect(files.pdf.map((file) => file.filename)).toEqual([
      "relatorio-cliente-alfa-simplificado-2026-09-01-a-2026-09-30.pdf",
      "relatorio-cliente-alfa-completo-2026-09-01-a-2026-09-30.pdf"
    ]);
    expect(files.xls.map((file) => file.filename)).toEqual([
      "relatorio-cliente-alfa-simplificado-2026-09-01-a-2026-09-30.xls",
      "relatorio-cliente-alfa-completo-2026-09-01-a-2026-09-30.xls"
    ]);
    expect(buildCustomerReportFiles(report, ["complete"], ["excel"]).pdf).toHaveLength(0);
  });
});

describe("documentos do desktop", () => {
  const rows: ReportOperationRow[] = [
    operation({
      id: "d1",
      operation_code: 42,
      created_at: "2026-09-02T11:00:00Z",
      closed_at: "2026-09-02T11:45:00Z",
      applied_price_table_name: "TABELA OBRA",
      freight_type: "cif",
      freight_json: JSON.stringify({ destination: "Obra Centro", rule: { name: "Por tonelada" } }),
      freight_total_cents: 5_000,
      total_cents: 70_000,
      omie_sales_order_id: 998877,
      omie_invoice_number: "4521",
      payment_term_id: "t28",
      payment_method_id: "pm1"
    }),
    operation({
      id: "d2",
      operation_type: "internal",
      created_at: "2026-09-03T10:00:00Z",
      closed_at: "2026-09-03T12:10:00Z",
      entry_weight_kg: null
    }),
    operation({
      id: "d3",
      status: "cancelled",
      cancel_reason: "Desistiu",
      closed_at: null,
      created_at: "2026-09-04T12:00:00Z"
    })
  ];
  const lookups: ReportLookups = {
    ...LOOKUPS,
    customers: [
      customer({
        id: "c1",
        trade_name: "ALFA",
        document: "12.345.678/0001-95",
        address_street: "Rua A",
        address_number: "10",
        neighborhood: "Centro",
        default_payment_term_id: "t28"
      })
    ]
  };
  const report = buildCustomerReport({
    customerId: "c1",
    rows,
    lookups,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    periodLabel: "Mes atual",
    referenceDate: "2026-09-24"
  });
  const generatedAt = new Date("2026-09-24T15:00:00Z");

  it("monta os campos que o documento do desktop le", () => {
    expect(report.periodLabel).toBe("Mes atual");
    expect(report.customer.addressLine).toBe("Rua A, 10 - Centro");
    expect(report.customer.defaultPaymentTermName).toBe("28 DIAS");
    expect(report.byDay.map((row) => row.period)).toEqual(["2026-09-02", "2026-09-03"]);
    const [first, second] = report.operations;
    expect(first).toMatchObject({
      operationTypeLabel: "Com nota",
      entryWeightKg: 15_000,
      exitWeightKg: 25_000,
      priceTableName: "TABELA OBRA",
      freightModality: "cif",
      freightModalityLabel: "Valor so no sistema",
      freightDestination: "Obra Centro",
      freightRuleName: "Por tonelada",
      minutesInside: 45,
      productUnit: "t"
    });
    expect(second).toMatchObject({ operationTypeLabel: "Interna", entryWeightKg: null });
    expect(report.totals).toMatchObject({
      avgNetWeightKg: 10_000,
      invoiceOperations: 1,
      internalOperations: 1,
      cancelledOperations: 1,
      cancelledNetWeightKg: 10_000,
      firstOperationDate: "2026-09-02",
      lastOperationDate: "2026-09-03"
    });
    expect(report.byProduct[0]).toMatchObject({
      firstDate: "2026-09-02",
      lastDate: "2026-09-03"
    });
    expect(report.byPlate[0]).toMatchObject({
      totalMinutes: 175,
      avgMinutes: 88,
      lastOperationAt: "2026-09-03T12:10:00Z"
    });
    expect(report.installments[0]).toMatchObject({ dueDate: "2026-09-03", daysUntilDue: -21 });
  });

  it("o PDF simplificado traz as secoes, as colunas e os totais do desktop", () => {
    const html = buildCustomerReportFiles(report, ["simplified"], ["pdf"], generatedAt).pdf[0].html;
    for (const text of [
      "<h1>Relatorio do cliente</h1>",
      "Mes atual &middot; 01/09/2026 a 30/09/2026",
      "Simplificado",
      "Cadastro do cliente",
      "Vencimentos no periodo",
      "Produtos comprados",
      "Materiais por dia",
      "Placas",
      "Viagens por placa e motorista",
      "Compras por mes",
      "Preco medio/t",
      "Nota fiscal",
      "4521",
      "Interna (sem NF-e)",
      "000042",
      "TOTAL",
      "Total comprado",
      "size:A4 portrait"
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Operacoes (detalhado)");
  });

  it("o PDF completo acrescenta transporte, pagamentos, operacoes e canceladas", () => {
    const html = buildCustomerReportFiles(report, ["complete"], ["pdf"], generatedAt).pdf[0].html;
    for (const text of [
      "Completo",
      "Rua A, 10 - Centro",
      "Parcelas a pagar (detalhado)",
      "Transporte por transportadora",
      "Tipos de frete",
      "Pagamentos por forma",
      "Pagamentos por condicao",
      "Compras por dia",
      "Operacoes (detalhado)",
      "Entrada (kg)",
      "Tabela",
      "TABELA OBRA",
      "Valor so no sistema - Obra Centro",
      "998877",
      "Operacoes canceladas",
      "Desistiu",
      "size:A4 landscape"
    ]) {
      expect(html).toContain(text);
    }
  });

  it("a planilha e o HTML de tabelas tipadas do desktop", () => {
    const xls = buildCustomerReportFiles(report, ["complete"], ["excel"], generatedAt).xls[0].html;
    for (const text of [
      "xmlns:x=",
      "Resumo",
      "Vencimentos por mes",
      "Parcelas a pagar",
      "Produtos",
      "Viagens por placa",
      "Operacoes",
      "Canceladas",
      "Observacao sobre vencimentos",
      "x:num"
    ]) {
      expect(xls).toContain(text);
    }
  });

  it("o resumo de todos os clientes sai com os documentos do desktop", () => {
    const overview = buildCustomersOverview({
      rows,
      lookups,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      periodLabel: "Mes atual",
      referenceDate: "2026-09-24"
    });
    expect(overview.periodLabel).toBe("Mes atual");
    const files = buildCustomersOverviewFiles(overview, ["pdf", "excel"], generatedAt);
    expect(files.pdf.map((file) => file.filename)).toEqual([
      "relatorio-clientes-2026-09-01-a-2026-09-30.pdf"
    ]);
    expect(files.xls.map((file) => file.filename)).toEqual([
      "relatorio-clientes-2026-09-01-a-2026-09-30.xls"
    ]);
    for (const text of [
      "<h1>Relatorio por cliente</h1>",
      "Todos os clientes",
      "Resumo do periodo",
      "Clientes no periodo",
      "Materiais por cliente",
      "TOTAL",
      "size:A4 landscape"
    ]) {
      expect(files.pdf[0].html).toContain(text);
    }
    expect(files.xls[0].html).toContain("Relatorio por cliente - todos os clientes");
  });
});

describe("buildCustomersOverview", () => {
  it("um cliente por linha, do que mais faturou, com quem so tem parcela no periodo", () => {
    const overview = buildCustomersOverview({
      rows: [
        operation({ id: "a", closed_at: "2026-09-05T12:00:00Z", total_cents: 10_000 }),
        operation({
          id: "b",
          customer_id: "c3",
          closed_at: "2026-09-06T12:00:00Z",
          total_cents: 90_000
        }),
        operation({
          id: "c",
          customer_id: null,
          customer_name: null,
          closed_at: "2026-08-20T12:00:00Z",
          payment_term_id: "t28"
        })
      ],
      lookups: LOOKUPS,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      referenceDate: "2026-09-24"
    });
    expect(overview.customers.map((row) => row.customer.name)).toEqual([
      "BETA",
      "ALFA",
      "Sem cliente"
    ]);
    expect(overview.totals.totalCents).toBe(100_000);
    expect(overview.installmentTotals.installments).toBe(3);
    expect(overview.customers[2].installmentTotals.installments).toBe(1);
  });
});

describe("invoiceNumberText", () => {
  it("interna nao cobra nota", () => {
    expect(invoiceNumberText(null, "internal")).toBe("Interna (sem NF-e)");
    expect(invoiceNumberText(" ", "invoice")).toBe("Sem nota");
    expect(invoiceNumberText("123", "invoice")).toBe("123");
  });
});
