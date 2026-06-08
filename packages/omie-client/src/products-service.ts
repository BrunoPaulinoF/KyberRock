import type { OmieClient } from "./omie-client.js";

export interface Product {
  id: number;
  description: string;
  code?: string;
  unitPrice?: number;
  unit?: string;
  ncm?: string;
}

export interface ListProductsParam {
  pagina: number;
  registrosPorPagina?: number;
}

export async function listProducts(
  client: OmieClient,
  param: ListProductsParam
): Promise<Product[]> {
  const response = (await client.call(
    "/api/v1/geral/produtos/",
    "ListarProdutos",
    param
  )) as {
    produtoCadastro: Array<{
      codigoProdutoOmie: number;
      descricao: string;
      codigo?: string;
      valorUnitario?: number;
      unidade?: string;
      ncm?: string;
    }>;
  };

  return (response.produtoCadastro || []).map((item) => ({
    id: item.codigoProdutoOmie,
    description: item.descricao,
    code: item.codigo,
    unitPrice: item.valorUnitario,
    unit: item.unidade,
    ncm: item.ncm
  }));
}

export class OmieProductsService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 500): Promise<Product[]> {
    const all: Product[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const products = await listProducts(this.client, {
        pagina: page,
        registrosPorPagina: pageSize
      });

      if (products.length === 0) break;
      all.push(...products);

      hasMore = products.length === pageSize;
      page++;
    }

    return all;
  }
}
