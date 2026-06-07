import type { OmieClient } from "./omie-client";

export interface PaymentTerm {
  id: number;
  description: string;
}

export interface ListPaymentTermsParam {
  pagina: number;
  registrosPorPagina?: number;
}

export async function listPaymentTerms(
  client: OmieClient,
  param: ListPaymentTermsParam
): Promise<PaymentTerm[]> {
  const response = (await client.call(
    "/api/v1/geral/condicoespgto/",
    "ListarCondicoesPagamento",
    param
  )) as {
    condicoesPagamentoCadastro: Array<{
      codigoCondicaoPagamentoOmie: number;
      descricaoCondicaoPagamento: string;
    }>;
  };

  return (response.condicoesPagamentoCadastro || []).map((item) => ({
    id: item.codigoCondicaoPagamentoOmie,
    description: item.descricaoCondicaoPagamento
  }));
}

export class OmiePaymentTermsService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 500): Promise<PaymentTerm[]> {
    const all: PaymentTerm[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const terms = await listPaymentTerms(this.client, {
        pagina: page,
        registrosPorPagina: pageSize
      });

      if (terms.length === 0) break;
      all.push(...terms);

      hasMore = terms.length === pageSize;
      page++;
    }

    return all;
  }
}
