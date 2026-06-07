import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "@kyberrock/omie-client";

import { buildOmieIntegrationCode } from "@kyberrock/omie-client";
import {
  createSalesOrder,
  createServiceOrder,
  cancelSalesOrder,
  cancelServiceOrder
} from "./omie-orders";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("createSalesOrder", () => {
  it("calls IncluirPedido with mapped data", async () => {
    const client = mockClient({
      codigoPedido: 9876,
      codigoPedidoIntegracao: "KR-001"
    });

    const result = await createSalesOrder(client, {
      integrationCode: "KR-001",
      customerOmieId: 123,
      productOmieId: 456,
      quantity: 10.5,
      unitPrice: 150.0,
      paymentTermCode: "001",
      issueDate: "2026-06-07"
    });

    expect(client.call).toHaveBeenCalledWith(
      "/api/v1/produtos/pedido/",
      "IncluirPedido",
      expect.objectContaining({
        codigoPedidoIntegracao: "KR-001",
        codigoCliente: 123,
        itens: expect.arrayContaining([
          expect.objectContaining({
            codigoProduto: 456,
            quantidade: 10.5,
            valorUnitario: 150.0
          })
        ])
      })
    );

    expect(result.orderId).toBe(9876);
  });
});

describe("createServiceOrder", () => {
  it("calls IncluirOS with mapped data", async () => {
    const client = mockClient({
      codigoOS: 5678,
      codigoOSIntegracao: "KR-OS-001"
    });

    const result = await createServiceOrder(client, {
      integrationCode: "KR-OS-001",
      customerOmieId: 123,
      serviceDescription: "Carregamento de brita",
      quantity: 10.5,
      unitPrice: 150.0,
      issueDate: "2026-06-07"
    });

    expect(client.call).toHaveBeenCalledWith(
      "/api/v1/servicos/os/",
      "IncluirOS",
      expect.objectContaining({
        codigoOSIntegracao: "KR-OS-001",
        codigoCliente: 123,
        servicos: expect.arrayContaining([
          expect.objectContaining({
            descricaoServico: "Carregamento de brita",
            valorTotalServico: 1575
          })
        ])
      })
    );

    expect(result.orderId).toBe(5678);
  });
});

describe("cancelSalesOrder", () => {
  it("calls CancelarPedido", async () => {
    const client = mockClient({
      codigo: 9876,
      codigoStatus: "0",
      descricaoStatus: "OK"
    });

    await cancelSalesOrder(client, { omieOrderId: 9876 });

    expect(client.call).toHaveBeenCalledWith(
      "/api/v1/produtos/pedido/",
      "CancelarPedido",
      { codigoPedido: 9876 }
    );
  });
});

describe("cancelServiceOrder", () => {
  it("calls CancelarOS", async () => {
    const client = mockClient({
      codigo: 5678,
      codigoStatus: "0",
      descricaoStatus: "OK"
    });

    await cancelServiceOrder(client, { omieOrderId: 5678 });

    expect(client.call).toHaveBeenCalledWith(
      "/api/v1/servicos/os/",
      "CancelarOS",
      { codigoOS: 5678 }
    );
  });
});

describe("buildOmieIntegrationCode", () => {
  it("generates stable integration code", () => {
    const code = buildOmieIntegrationCode("unit-1", "op-123", "sales_order");
    expect(code).toBe("kyberrock:unit-1:op-123:sales_order");
  });
});
