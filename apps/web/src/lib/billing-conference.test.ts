import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  billingConferenceCsv,
  buildBillingReport,
  dedupeCustomers,
  formatTons,
  invoiceNumberLabel,
  invoiceNumberText,
  mapBillingRow,
  omieReference,
  resolveRange,
  resolveSituation,
  resolveSituationDetail,
  sortBillingRows,
  unitPriceLabel,
  type BillingSourceOperation
} from "./billing-conference";

function op(overrides: Partial<BillingSourceOperation>): BillingSourceOperation {
  return {
    id: "op-1",
    operation_code: 10,
    created_at: "2026-09-10T12:00:00.000Z",
    closed_at: "2026-09-10T13:00:00.000Z",
    operation_type: "invoice",
    customer_id: "c1",
    customer_name: "SNAPSHOT",
    product_id: "p1",
    product_description: "Brita snapshot",
    plate: "ABC1D23",
    net_weight_kg: 10000,
    unit_price_cents: 6500,
    price_unit: "ton",
    product_total_cents: 65000,
    freight_total_cents: 5000,
    total_cents: 70000,
    omie_sales_order_id: null,
    omie_service_order_id: null,
    omie_invoice_number: null,
    omie_billing_status: null,
    omie_billing_message: null,
    ...overrides
  };
}

const base = {
  operation_type: "invoice",
  omie_sales_order_id: null,
  omie_service_order_id: null,
  omie_billing_status: null
};

describe("resolveSituation", () => {
  it("segue a mesma regra do desktop", () => {
    expect(resolveSituation({ ...base, omie_billing_status: "billed" })).toBe("billed");
    expect(resolveSituation({ ...base, omie_sales_order_id: 123 })).toBe("sent");
    expect(resolveSituation({ ...base, omie_billing_status: "cadastro_incompleto" })).toBe(
      "cadastro_incompleto"
    );
    expect(resolveSituation({ ...base, omie_billing_status: "failed" })).toBe("failed");
    expect(resolveSituation(base)).toBe("pending");
    const internal = { ...base, operation_type: "internal" };
    expect(resolveSituation({ ...internal, omie_service_order_id: 9 })).toBe("sent");
    expect(resolveSituation({ ...internal, omie_billing_status: "service_order_failed" })).toBe(
      "failed"
    );
    // Na interna, "failed" (do pedido de venda) nao e recusa da OS.
    expect(resolveSituation({ ...internal, omie_billing_status: "failed" })).toBe("pending");
    expect(resolveSituation({ ...internal, omie_billing_status: "billed" })).toBe("billed");
  });

  it("explica a linha pela mensagem do OMIE ou pelo numero do documento", () => {
    expect(resolveSituationDetail({ ...base, omie_billing_message: " Falta CEP " }, "failed")).toBe(
      "Falta CEP"
    );
    expect(
      resolveSituationDetail(
        { ...base, omie_sales_order_id: 5, omie_billing_message: null },
        "sent"
      )
    ).toBe("Pedido OMIE 5");
    expect(resolveSituationDetail({ ...base, omie_billing_message: null }, "pending")).toBeNull();
  });
});

describe("formatos", () => {
  it("preco unitario com unidade, referencia OMIE e nota", () => {
    expect(unitPriceLabel({ unitPriceCents: null, priceUnit: "ton" })).toBe("-");
    expect(unitPriceLabel({ unitPriceCents: 4200, priceUnit: "kg" })).toMatch(/42,00\/kg$/);
    expect(unitPriceLabel({ unitPriceCents: 4200, priceUnit: "ton" })).toMatch(/42,00\/t$/);
    expect(omieReference({ omieSalesOrderId: 7, omieServiceOrderId: null })).toBe("Pedido 7");
    expect(omieReference({ omieSalesOrderId: null, omieServiceOrderId: 8 })).toBe("OS 8");
    expect(omieReference({ omieSalesOrderId: null, omieServiceOrderId: null })).toBe("-");
    expect(invoiceNumberLabel(" 4521 ", "invoice")).toEqual({
      state: "number",
      text: "4521",
      title: null
    });
    expect(invoiceNumberLabel(null, "invoice").text).toBe("Sem nota");
    expect(invoiceNumberLabel(null, "internal").state).toBe("not_applicable");
    expect(invoiceNumberText(null, "internal")).toBe("Interna (sem NF-e)");
    expect(formatTons(26580)).toBe("26,6 t");
  });
});

describe("resolveRange", () => {
  // 24/09/2026 15h em Brasilia.
  const now = new Date("2026-09-24T18:00:00.000Z");
  it("converte os atalhos em datas no dia da pedreira", () => {
    expect(resolveRange("today", "", "", now)).toEqual({
      start: "2026-09-24",
      end: "2026-09-24",
      label: "Hoje"
    });
    expect(resolveRange("7d", "", "", now).start).toBe("2026-09-18");
    expect(resolveRange("30d", "", "", now).start).toBe("2026-08-26");
    expect(resolveRange("month", "", "", now)).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-24"
    });
    expect(resolveRange("lastMonth", "", "", now)).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
      label: "Mes anterior"
    });
  });

  it("no personalizado troca datas invertidas e completa campo vazio com hoje", () => {
    expect(resolveRange("custom", "2026-09-20", "2026-09-10", now)).toMatchObject({
      start: "2026-09-10",
      end: "2026-09-20"
    });
    expect(resolveRange("custom", "", "2026-09-30", now)).toMatchObject({
      start: "2026-09-24",
      end: "2026-09-30"
    });
  });

  it("vira o dia pelo fuso da pedreira, nao pelo UTC", () => {
    // 01/10 01h UTC ainda e 30/09 em Brasilia.
    expect(resolveRange("today", "", "", new Date("2026-10-01T01:00:00.000Z")).start).toBe(
      "2026-09-30"
    );
  });
});

describe("mapBillingRow", () => {
  it("usa o cadastro para nome, documento e produto e o dia local do fechamento", () => {
    const row = mapBillingRow(
      op({ closed_at: "2026-09-11T01:30:00.000Z" }),
      { trade_name: "Fantasia", legal_name: "Razao", document: "12345678000190" },
      { code: "BR1", description: "Brita 1" }
    );
    expect(row.customerName).toBe("Fantasia");
    expect(row.customerDocument).toBe("12345678000190");
    expect(row.productDescription).toBe("Brita 1");
    expect(row.productCode).toBe("BR1");
    // 22h30 do dia 10 em Brasilia.
    expect(row.date).toBe("2026-09-10");
    expect(row.operationTypeLabel).toBe("Com nota");
  });

  it("sem cadastro, cai no nome gravado na pesagem; sem saida, na criacao", () => {
    const row = mapBillingRow(
      op({ closed_at: null, plate: " ", operation_type: "internal" }),
      undefined,
      undefined
    );
    expect(row.customerName).toBe("SNAPSHOT");
    expect(row.productDescription).toBe("Brita snapshot");
    expect(row.plate).toBe("SEM PLACA");
    expect(row.date).toBe("2026-09-10");
    expect(row.operationTypeLabel).toBe("Interna");
  });
});

describe("buildBillingReport", () => {
  const rows = [
    mapBillingRow(op({ id: "a", omie_billing_status: "billed" }), undefined, undefined),
    mapBillingRow(
      op({ id: "b", omie_sales_order_id: 55, total_cents: 30000, net_weight_kg: 5000 }),
      undefined,
      undefined
    ),
    mapBillingRow(
      op({ id: "c", omie_billing_status: "failed", plate: "XYZ9K88", total_cents: 1000 }),
      undefined,
      undefined
    )
  ];

  it("soma o periodo, separa o que nao foi faturado e ordena o resumo pelo problema", () => {
    const report = buildBillingReport(rows, [], "");
    expect(report.totals.operations).toBe(3);
    expect(report.totals.totalCents).toBe(101000);
    expect(report.unbilled.operations).toBe(2);
    expect(report.unbilled.totalCents).toBe(31000);
    expect(report.bySituation.map((row) => row.situation)).toEqual(["failed", "sent", "billed"]);
  });

  it("filtra por situacao e por busca livre", () => {
    expect(buildBillingReport(rows, ["sent"], "").rows.map((row) => row.operationId)).toEqual([
      "b"
    ]);
    expect(buildBillingReport(rows, [], "xyz9").rows.map((row) => row.operationId)).toEqual(["c"]);
    expect(buildBillingReport(rows, [], "55").rows.map((row) => row.operationId)).toEqual(["b"]);
  });

  it("gera o CSV com resumo, linhas e total", () => {
    const csv = billingConferenceCsv(buildBillingReport(rows, [], ""), {
      start: "2026-09-01",
      end: "2026-09-30",
      label: "Mes atual"
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Mes atual - 01/09/2026 a 30/09/2026");
    expect(csv).toContain("Recusada pelo OMIE;1;10000;10,00");
    expect(csv).toContain("TOTAL;;;;;;25000;;");
  });
});

describe("sortBillingRows", () => {
  it("ordena pelo fechamento e desempata pelo numero da operacao", () => {
    const rows = [
      mapBillingRow(op({ id: "late", closed_at: "2026-09-12T10:00:00Z" }), undefined, undefined),
      mapBillingRow(op({ id: "b", operation_code: 2 }), undefined, undefined),
      mapBillingRow(op({ id: "a", operation_code: 1 }), undefined, undefined)
    ];
    expect(sortBillingRows(rows).map((row) => row.operationId)).toEqual(["a", "b", "late"]);
  });
});

describe("dedupeCustomers", () => {
  it("mostra uma vez o mesmo cliente com dois cadastros, sem perder as letras do CNPJ", () => {
    const options = dedupeCustomers([
      {
        id: "1",
        trade_name: "Alfa",
        legal_name: null,
        document: "12.ABC.345/01DE-35",
        omie_customer_id: null
      },
      {
        id: "2",
        trade_name: "Alfa OMIE",
        legal_name: null,
        document: "12ABC34501DE35",
        omie_customer_id: null
      },
      {
        id: "3",
        trade_name: null,
        legal_name: "Beta",
        document: "12.345.345/0100-35",
        omie_customer_id: null
      },
      { id: "4", trade_name: " ", legal_name: null, document: null, omie_customer_id: 9 }
    ]);
    expect(options.map((option) => option.id)).toEqual(["1", "3", "4"]);
    expect(options[1].name).toBe("Beta");
    expect(options[2].name).toBe("Sem nome");
  });
});
