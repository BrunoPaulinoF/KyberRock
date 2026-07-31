import { describe, expect, it } from "vitest";

import {
  isAdvanceAccountName,
  isAdvanceCategoryDescription,
  mapAdvancesFromReceivables,
  mapOmieReceivableRaw,
  planAdvanceSettlement,
  selectAdvanceCategoryCodes,
  selectOrderReceivables
} from "./omie-customer-advances";

describe("isAdvanceCategoryDescription", () => {
  it("reconhece a categoria de adiantamento de clientes", () => {
    expect(isAdvanceCategoryDescription("Adiantamento de Clientes")).toBe(true);
    expect(isAdvanceCategoryDescription("adiantamentos recebidos")).toBe(true);
    expect(isAdvanceCategoryDescription("Adiantaménto de Clientes")).toBe(true);
  });

  it("descarta adiantamento a fornecedores e categorias sem relacao", () => {
    expect(isAdvanceCategoryDescription("Adiantamento a Fornecedores")).toBe(false);
    expect(isAdvanceCategoryDescription("Receita de Vendas")).toBe(false);
    expect(isAdvanceCategoryDescription("")).toBe(false);
  });
});

describe("selectAdvanceCategoryCodes", () => {
  it("pega apenas as categorias ativas de adiantamento de cliente", () => {
    const codes = selectAdvanceCategoryCodes([
      { code: "1.01.01", description: "Venda de Produtos", isActive: true },
      { code: "1.01.05", description: "Adiantamento de Clientes", isActive: true },
      { code: "1.01.06", description: "Adiantamento de Clientes (antiga)", isActive: false },
      { code: "2.02.01", description: "Adiantamento a Fornecedores", isActive: true }
    ]);

    expect(codes).toEqual(["1.01.05"]);
  });
});

describe("mapOmieReceivableRaw", () => {
  it("normaliza datas, valores e cancelamento", () => {
    const title = mapOmieReceivableRaw({
      codigo_lancamento_omie: "5001",
      codigo_cliente_fornecedor: 42,
      codigo_categoria: "1.01.05",
      data_emissao: "10/07/2026",
      data_pagamento: "11/07/2026",
      valor_documento: "1234,50",
      valor_pago: 1234.5,
      status_titulo: "RECEBIDO"
    });

    expect(title).toMatchObject({
      id: 5001,
      customerOmieCode: 42,
      issueDate: "2026-07-10",
      receivedDate: "2026-07-11",
      receivedAmountCents: 123_450,
      cancelled: false
    });
  });

  it("ignora linha sem codigo do lancamento", () => {
    expect(mapOmieReceivableRaw({ codigo_cliente_fornecedor: 42 })).toBeNull();
  });
});

describe("mapAdvancesFromReceivables", () => {
  const codes = new Set(["1.01.05"]);

  it("devolve so adiantamentos recebidos das categorias configuradas", () => {
    const advances = mapAdvancesFromReceivables(
      [
        {
          codigo_lancamento_omie: 1,
          codigo_cliente_fornecedor: 42,
          codigo_categoria: "1.01.05",
          valor_documento: 500,
          valor_pago: 500,
          data_pagamento: "01/07/2026"
        },
        // Venda comum: nao e adiantamento.
        {
          codigo_lancamento_omie: 2,
          codigo_cliente_fornecedor: 42,
          codigo_categoria: "1.01.01",
          valor_documento: 900,
          valor_pago: 900
        },
        // Adiantamento lancado mas ainda nao depositado.
        {
          codigo_lancamento_omie: 3,
          codigo_cliente_fornecedor: 42,
          codigo_categoria: "1.01.05",
          valor_documento: 700,
          data_vencimento: "31/12/2099"
        },
        // Sem cliente: nao da para saber de quem e o credito.
        {
          codigo_lancamento_omie: 4,
          codigo_categoria: "1.01.05",
          valor_documento: 100,
          valor_pago: 100
        }
      ],
      codes
    );

    expect(advances).toHaveLength(1);
    expect(advances[0]).toMatchObject({ titleId: 1, customerOmieCode: 42, amountCents: 50_000 });
  });

  it("mantem o adiantamento cancelado com valor zero para permitir o estorno", () => {
    const advances = mapAdvancesFromReceivables(
      [
        {
          codigo_lancamento_omie: 9,
          codigo_cliente_fornecedor: 42,
          codigo_categoria: "1.01.05",
          valor_documento: 300,
          valor_pago: 300,
          status_titulo: "CANCELADO"
        }
      ],
      codes
    );

    expect(advances[0]).toMatchObject({ titleId: 9, amountCents: 0, cancelled: true });
  });

  it("considera recebido o titulo liquidado sem valor baixado explicito", () => {
    const advances = mapAdvancesFromReceivables(
      [
        {
          codigo_lancamento_omie: 10,
          codigo_cliente_fornecedor: 42,
          codigo_categoria: "1.01.05",
          valor_documento: 250,
          status_titulo: "LIQUIDADO"
        }
      ],
      codes
    );

    expect(advances[0]).toMatchObject({ titleId: 10, amountCents: 25_000 });
  });
});

describe("isAdvanceAccountName", () => {
  it("reconhece a conta corrente de adiantamento de clientes", () => {
    expect(isAdvanceAccountName("Adiantamento de Clientes")).toBe(true);
    expect(isAdvanceAccountName("ADIANTAMENTOS")).toBe(true);
  });

  it("descarta a conta de adiantamento a fornecedores e as demais", () => {
    expect(isAdvanceAccountName("Adiantamento a Fornecedores")).toBe(false);
    expect(isAdvanceAccountName("Caixinha")).toBe(false);
    expect(isAdvanceAccountName(null)).toBe(false);
  });
});

describe("selectOrderReceivables", () => {
  it("pega os titulos do pedido que ainda tem saldo em aberto", () => {
    const receivables = selectOrderReceivables(
      [
        // Titulo do pedido, em aberto: e o que sera baixado com o adiantamento.
        {
          codigo_lancamento_omie: 100,
          nCodPedido: 555,
          valor_documento: 400,
          numero_documento: "NF-9"
        },
        // Mesmo pedido, ja recebido: nao pode ser baixado de novo.
        {
          codigo_lancamento_omie: 101,
          nCodPedido: 555,
          valor_documento: 200,
          valor_pago: 200,
          status_titulo: "RECEBIDO"
        },
        // Outro pedido do mesmo cliente.
        { codigo_lancamento_omie: 102, nCodPedido: 999, valor_documento: 300 },
        // Cancelado no OMIE.
        {
          codigo_lancamento_omie: 103,
          nCodPedido: 555,
          valor_documento: 300,
          status_titulo: "CANCELADO"
        }
      ],
      555
    );

    expect(receivables).toEqual([
      { titleId: 100, openAmountCents: 40_000, documentNumber: "NF-9", orderNumber: null }
    ]);
  });

  it("aceita o vinculo por numero_pedido (ordem de servico)", () => {
    const receivables = selectOrderReceivables(
      [{ codigo_lancamento_omie: 200, numero_pedido: 777, valor_documento: 150 }],
      777
    );

    expect(receivables[0]).toMatchObject({ titleId: 200, openAmountCents: 15_000 });
  });
});

describe("planAdvanceSettlement", () => {
  const receivables = [
    { titleId: 20, openAmountCents: 30_000, documentNumber: null, orderNumber: null },
    { titleId: 10, openAmountCents: 50_000, documentNumber: null, orderNumber: null }
  ];

  it("distribui o adiantamento entre as parcelas, do titulo mais antigo ao mais novo", () => {
    expect(planAdvanceSettlement(receivables, 60_000)).toEqual([
      { titleId: 10, amountCents: 50_000 },
      { titleId: 20, amountCents: 10_000 }
    ]);
  });

  it("nunca baixa mais do que o saldo dos titulos", () => {
    const steps = planAdvanceSettlement(receivables, 500_000);
    expect(steps.reduce((total, step) => total + step.amountCents, 0)).toBe(80_000);
  });

  it("nao gera baixa quando nao ha adiantamento a amortizar", () => {
    expect(planAdvanceSettlement(receivables, 0)).toEqual([]);
  });
});
