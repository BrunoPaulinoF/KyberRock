import { describe, expect, it } from "vitest";

import {
  isAdvanceCategoryDescription,
  mapAdvancesFromReceivables,
  mapOmieReceivableRaw,
  selectAdvanceCategoryCodes
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
