import type { OmieClient } from "./omie-client";

export interface CreateSalesOrderInput {
  integrationCode: string;
  customerOmieId: number;
  productOmieId: number;
  quantity: number;
  unitPrice: number;
  paymentTermCode?: string;
  issueDate: string;
}

export interface CreateSalesOrderResult {
  orderId: number;
  integrationCode: string;
}

export async function createSalesOrder(
  client: OmieClient,
  input: CreateSalesOrderInput
): Promise<CreateSalesOrderResult> {
  const body = {
    codigoPedidoIntegracao: input.integrationCode,
    codigoCliente: input.customerOmieId,
    dataPrevisao: input.issueDate,
    itens: [
      {
        codigoProduto: input.productOmieId,
        quantidade: input.quantity,
        valorUnitario: input.unitPrice,
        tipoDesconto: "P",
        desconto: 0
      }
    ],
    departamentos: [
      {
        codigo: "1.01.01",
        percentual: 100
      }
    ],
    informacoesAdicionais: {
      codigoCategoria: "1.01.01",
      codigoContaCorrente: 0
    }
  };

  const response = (await client.call(
    "/api/v1/produtos/pedido/",
    "IncluirPedido",
    body
  )) as {
    codigoPedido: number;
    codigoPedidoIntegracao: string;
  };

  return {
    orderId: response.codigoPedido,
    integrationCode: response.codigoPedidoIntegracao
  };
}

export interface CreateServiceOrderInput {
  integrationCode: string;
  customerOmieId: number;
  serviceDescription: string;
  quantity: number;
  unitPrice: number;
  issueDate: string;
}

export interface CreateServiceOrderResult {
  orderId: number;
  integrationCode: string;
}

export async function createServiceOrder(
  client: OmieClient,
  input: CreateServiceOrderInput
): Promise<CreateServiceOrderResult> {
  const total = input.quantity * input.unitPrice;

  const body = {
    codigoOSIntegracao: input.integrationCode,
    codigoCliente: input.customerOmieId,
    dataPrevisao: input.issueDate,
    servicos: [
      {
        codigoServico: 1,
        descricaoServico: input.serviceDescription,
        quantidadeHoras: input.quantity,
        valorTotalServico: total
      }
    ],
    departamentos: [
      {
        codigo: "1.01.01",
        percentual: 100
      }
    ],
    informacoesAdicionais: {
      codigoCategoria: "1.01.01",
      codigoContaCorrente: 0
    }
  };

  const response = (await client.call(
    "/api/v1/servicos/os/",
    "IncluirOS",
    body
  )) as {
    codigoOS: number;
    codigoOSIntegracao: string;
  };

  return {
    orderId: response.codigoOS,
    integrationCode: response.codigoOSIntegracao
  };
}

export interface CancelOrderInput {
  omieOrderId: number;
}

export async function cancelSalesOrder(
  client: OmieClient,
  input: CancelOrderInput
): Promise<void> {
  await client.call("/api/v1/produtos/pedido/", "CancelarPedido", {
    codigoPedido: input.omieOrderId
  });
}

export async function cancelServiceOrder(
  client: OmieClient,
  input: CancelOrderInput
): Promise<void> {
  await client.call("/api/v1/servicos/os/", "CancelarOS", {
    codigoOS: input.omieOrderId
  });
}
