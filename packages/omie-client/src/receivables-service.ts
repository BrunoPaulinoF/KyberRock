import type { OmieClient } from "./omie-client.js";

export interface Receivable {
  id: number;
  clientId: number;
  amount: number;
  dueDate: string;
  status: string;
}

export interface ListReceivablesParam {
  pagina: number;
  registrosPorPagina?: number;
  codigoClienteOmie?: number;
}

export async function listReceivables(
  client: OmieClient,
  param: ListReceivablesParam
): Promise<Receivable[]> {
  const response = (await client.call(
    "//financas/contareceber//",
    "ListarContasReceber",
    param
  )) as {
    contaReceberCadastro: Array<{
      codigoLancamentoOmie: number;
      codigoClienteOmie: number;
      valorDocumento: number;
      dataVencimento: string;
      statusTitulo: string;
    }>;
  };

  return (response.contaReceberCadastro || []).map((item) => ({
    id: item.codigoLancamentoOmie,
    clientId: item.codigoClienteOmie,
    amount: item.valorDocumento,
    dueDate: item.dataVencimento,
    status: item.statusTitulo
  }));
}

export class OmieReceivablesService {
  constructor(private readonly client: OmieClient) {}

  async getTotalOpenAmountForClient(clientId: number): Promise<number> {
    const receivables = await listReceivables(this.client, {
      pagina: 1,
      registrosPorPagina: 500,
      codigoClienteOmie: clientId
    });

    return receivables
      .filter((r) => r.status === "ABERTO")
      .reduce((sum, r) => sum + r.amount, 0);
  }
}
