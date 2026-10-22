import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  buildPriceVolumeReport,
  filterPriceVolumeReport,
  periodTitle,
  priceVolumeFileBase,
  paymentTermLabel,
  priceVolumeReportHtml,
  priceVolumeSpreadsheetHtml,
  volumeLabel,
  type PriceVolumeCadastro,
  type PriceVolumeCustomerRow,
  type PriceVolumeOperation
} from "./customer-price-volume";

function customer(partial: Partial<PriceVolumeCustomerRow>): PriceVolumeCustomerRow {
  return {
    id: "c1",
    trade_name: "AREIAO CONSTRUCOES",
    legal_name: "AREIAO CONSTRUCOES LTDA",
    document: "12.345.678/0001-90",
    omie_customer_id: null,
    deleted_at: null,
    is_active: true,
    default_payment_term_id: null,
    ...partial
  };
}

function op(partial: Partial<PriceVolumeOperation>): PriceVolumeOperation {
  return {
    customer_id: "c1",
    customer_name: "AREIAO CONSTRUCOES",
    product_id: "brita1",
    product_description: "Brita 1",
    net_weight_kg: 10000,
    payment_term_id: null,
    ...partial
  };
}

function cadastro(partial: Partial<PriceVolumeCadastro> = {}): PriceVolumeCadastro {
  return {
    customers: [customer({})],
    paymentTerms: [
      { id: "t30", name: "1 parcela em 30 dias" },
      { id: "tvista", name: "A Vista" }
    ],
    specialPrices: [],
    products: [
      { id: "brita1", description: "Brita 1", code: "87", unit_price_cents: 4500 },
      { id: "po", description: "Pó de Pedra", code: "3", unit_price_cents: 8475 },
      { id: "rachao", description: "Rachão", code: "62", unit_price_cents: 5300 }
    ],
    defaultPrices: [{ product_id: "rachao", unit_price_cents: 5100 }],
    ...partial
  };
}

describe("buildPriceVolumeReport", () => {
  it("soma o volume de cada material e mostra o preco especial do cadastro", () => {
    const report = buildPriceVolumeReport(
      [op({}), op({ net_weight_kg: 12500 }), op({ product_id: "rachao", net_weight_kg: 8000 })],
      cadastro({
        specialPrices: [
          {
            customer_id: "c1",
            product_id: "brita1",
            unit_price_cents: 4200,
            updated_at: "2026-08-01T00:00:00Z"
          }
        ]
      })
    );
    expect(report.customers).toHaveLength(1);
    const [row] = report.customers;
    expect(
      row.products.map((p) => [p.productName, p.priceCents, p.priceSource, p.weightKg])
    ).toEqual([
      ["Brita 1", 4200, "special", 22500],
      // Sem preco especial: a tabela padrao vence o valor do OMIE, como na balanca.
      ["Rachão", 5100, "default", 8000]
    ]);
    expect(row.loads).toBe(3);
    expect(row.weightKg).toBe(30500);
    expect(report.totals).toEqual({ customers: 1, loads: 3, weightKg: 30500 });
    expect(report.materials.map((m) => [m.productName, m.weightKg])).toEqual([
      ["Brita 1", 22500],
      ["Rachão", 8000]
    ]);
  });

  it("lista o produto do cadastro que nao carregou no periodo, sem volume", () => {
    const report = buildPriceVolumeReport(
      [op({})],
      cadastro({
        specialPrices: [
          {
            customer_id: "c1",
            product_id: "po",
            unit_price_cents: 8000,
            updated_at: "2026-08-01T00:00:00Z"
          }
        ]
      })
    );
    const po = report.customers[0].products.find((p) => p.productId === "po");
    expect(po).toMatchObject({ priceCents: 8000, priceSource: "special", weightKg: 0, loads: 0 });
    expect(volumeLabel(po!)).toBe("-");
    // O material sem carga nao entra no volume por material.
    expect(report.materials.map((m) => m.productName)).toEqual(["Brita 1"]);
  });

  it("dois precos especiais do mesmo produto: vale o atualizado por ultimo", () => {
    const report = buildPriceVolumeReport(
      [op({})],
      cadastro({
        specialPrices: [
          {
            customer_id: "c1",
            product_id: "brita1",
            unit_price_cents: 4000,
            updated_at: "2026-07-01T00:00:00Z"
          },
          {
            customer_id: "c1",
            product_id: "brita1",
            unit_price_cents: 4300,
            updated_at: "2026-09-01T00:00:00Z"
          }
        ]
      })
    );
    expect(report.customers[0].products[0].priceCents).toBe(4300);
  });

  it("junta os cadastros gemeos (mesmo documento) num cliente so", () => {
    const report = buildPriceVolumeReport(
      [op({ customer_id: "c1" }), op({ customer_id: "c1-balanca", net_weight_kg: 5000 })],
      cadastro({
        customers: [
          customer({}),
          customer({ id: "c1-balanca", document: "12345678000190", default_payment_term_id: "t30" })
        ],
        specialPrices: [
          {
            customer_id: "c1-balanca",
            product_id: "brita1",
            unit_price_cents: 4100,
            updated_at: "2026-08-01T00:00:00Z"
          }
        ]
      })
    );
    expect(report.customers).toHaveLength(1);
    expect(report.customers[0]).toMatchObject({
      name: "AREIAO CONSTRUCOES",
      paymentTerm: "1 parcela em 30 dias",
      paymentTermSource: "cadastro",
      weightKg: 15000,
      loads: 2
    });
    expect(report.customers[0].products[0]).toMatchObject({ priceCents: 4100 });
  });

  it("sem prazo no cadastro, usa o mais frequente das cargas do periodo e marca", () => {
    const report = buildPriceVolumeReport(
      [
        op({ payment_term_id: "tvista" }),
        op({ payment_term_id: "t30" }),
        op({ payment_term_id: "t30" })
      ],
      cadastro()
    );
    const [row] = report.customers;
    expect(row).toMatchObject({ paymentTerm: "1 parcela em 30 dias", paymentTermSource: "loads" });
    expect(paymentTermLabel(row)).toBe("1 parcela em 30 dias (pelas cargas)");
  });

  it("o prazo do cadastro vence o das cargas", () => {
    const report = buildPriceVolumeReport(
      [op({ payment_term_id: "t30" })],
      cadastro({ customers: [customer({ default_payment_term_id: "tvista" })] })
    );
    expect(report.customers[0]).toMatchObject({
      paymentTerm: "A Vista",
      paymentTermSource: "cadastro"
    });
  });

  it("sem prazo nenhum mostra Nao informado", () => {
    const report = buildPriceVolumeReport([op({})], cadastro());
    expect(paymentTermLabel(report.customers[0])).toBe("Não informado");
  });

  it("cliente com preco especial sem carga so entra quando pedido", () => {
    const base = cadastro({
      customers: [
        customer({}),
        customer({ id: "c2", trade_name: "BRITAS DO VALE", document: null })
      ],
      specialPrices: [
        {
          customer_id: "c2",
          product_id: "po",
          unit_price_cents: 7900,
          updated_at: "2026-08-01T00:00:00Z"
        }
      ]
    });
    expect(buildPriceVolumeReport([op({})], base).customers.map((c) => c.name)).toEqual([
      "AREIAO CONSTRUCOES"
    ]);
    const all = buildPriceVolumeReport([op({})], base, { includeIdle: true });
    expect(all.customers.map((c) => c.name)).toEqual(["AREIAO CONSTRUCOES", "BRITAS DO VALE"]);
    expect(all.customers[1]).toMatchObject({ loads: 0, weightKg: 0 });
  });

  it("produto sem preco nenhum e venda sem cadastro", () => {
    const report = buildPriceVolumeReport(
      [
        op({
          customer_id: null,
          customer_name: "BALCAO",
          product_id: null,
          product_description: "Areia"
        })
      ],
      cadastro()
    );
    expect(report.customers[0]).toMatchObject({ customerId: null, name: "BALCAO" });
    expect(report.customers[0].products[0]).toMatchObject({
      productName: "Areia",
      priceCents: null,
      priceSource: "none"
    });
  });
});

describe("filterPriceVolumeReport", () => {
  const report = buildPriceVolumeReport(
    [op({}), op({ customer_id: "c2", net_weight_kg: 4000 })],
    cadastro({
      customers: [
        customer({}),
        customer({ id: "c2", trade_name: "João Pedras", document: "AB.CDE.FGH/0001-12" })
      ]
    })
  );

  it("acha pelo nome sem acento e refaz os totais", () => {
    const found = filterPriceVolumeReport(report, "joao");
    expect(found.customers.map((c) => c.name)).toEqual(["João Pedras"]);
    expect(found.totals).toEqual({ customers: 1, loads: 1, weightKg: 4000 });
  });

  it("acha pelo documento com ou sem pontuacao, sem perder a letra", () => {
    expect(filterPriceVolumeReport(report, "12345678").customers).toHaveLength(1);
    expect(filterPriceVolumeReport(report, "abcdefgh").customers[0].name).toBe("João Pedras");
  });

  it("busca vazia devolve tudo", () => {
    expect(filterPriceVolumeReport(report, "  ")).toBe(report);
  });
});

describe("documentos", () => {
  const report = buildPriceVolumeReport(
    [op({ payment_term_id: "t30" })],
    cadastro({
      specialPrices: [
        {
          customer_id: "c1",
          product_id: "po",
          unit_price_cents: 8000,
          updated_at: "2026-08-01T00:00:00Z"
        }
      ]
    })
  );
  const input = {
    report,
    periodLabel: periodTitle({ start: "2026-08-01", end: "2026-09-30" }),
    unitName: "Todas as unidades",
    generatedAt: new Date("2026-10-01T12:00:00Z")
  };

  it("nomeia o periodo e o arquivo pelas datas escolhidas", () => {
    expect(periodTitle({ start: "2026-08-01", end: "2026-09-30" })).toBe("01/08/2026 a 30/09/2026");
    expect(periodTitle({ start: "2026-09-15", end: "2026-09-15" })).toBe("15/09/2026");
    expect(priceVolumeFileBase({ start: "2026-08-01", end: "2026-09-30" })).toBe(
      "precos-e-volume-por-cliente-2026-08-01-a-2026-09-30"
    );
  });

  it("o PDF traz cliente, prazo, preco e volume", () => {
    const html = priceVolumeReportHtml(input);
    expect(html).toContain("01/08/2026 a 30/09/2026");
    expect(html).toContain("AREIAO CONSTRUCOES");
    expect(html).toContain("1 parcela em 30 dias (pelas cargas)");
    expect(html).toContain("R$\u00a045,00");
    expect(html).toContain("10,000 t");
    expect(html).toContain('rowspan="2"');
  });

  it("a planilha repete o cliente em toda linha e tipa preco e volume", () => {
    const html = priceVolumeSpreadsheetHtml(input);
    expect(html.match(/<td[^>]*>AREIAO CONSTRUCOES<\/td>/g)).toHaveLength(2);
    expect(html).toContain('x:num="45"');
    expect(html).toContain('x:num="10"');
    // Documento continua texto (o CNPJ nao vira numero).
    expect(html).toMatch(/<td style='mso-number-format:"\\@"'>12\.345\.678\/0001-90<\/td>/);
    expect(html).toContain("Cargas do período");
  });
});
