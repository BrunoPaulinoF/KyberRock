import type { OmieClient } from "./omie-client";

export interface Customer {
  id: number;
  name: string;
  tradeName?: string;
  document: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface ListCustomersParam {
  pagina: number;
  registrosPorPagina?: number;
}

export async function listCustomers(
  client: OmieClient,
  param: ListCustomersParam
): Promise<Customer[]> {
  const response = (await client.call(
    "/api/v1/geral/clientes/",
    "ListarClientes",
    param
  )) as {
    clientesCadastro: Array<{
      codigoClienteOmie: number;
      razaoSocial: string;
      nomeFantasia?: string;
      cnpjCpf: string;
      email?: string;
      telefone1Ddd?: string;
      telefone1Numero?: string;
      endereco?: string;
      enderecoNumero?: string;
      bairro?: string;
      cidade?: string;
      estado?: string;
    }>;
  };

  return (response.clientesCadastro || []).map((item) => ({
    id: item.codigoClienteOmie,
    name: item.razaoSocial,
    tradeName: item.nomeFantasia,
    document: item.cnpjCpf,
    email: item.email,
    phone: item.telefone1Ddd && item.telefone1Numero
      ? `(${item.telefone1Ddd}) ${item.telefone1Numero}`
      : undefined,
    address: [item.endereco, item.enderecoNumero, item.bairro, item.cidade, item.estado]
      .filter(Boolean)
      .join(", ")
  }));
}

export async function getCustomer(
  client: OmieClient,
  codigoClienteOmie: number
): Promise<Customer | null> {
  const response = (await client.call(
    "/api/v1/geral/clientes/",
    "ConsultarCliente",
    { codigoClienteOmie }
  )) as {
    codigoClienteOmie?: number;
    razaoSocial?: string;
    cnpjCpf?: string;
  };

  if (!response.codigoClienteOmie) return null;

  return {
    id: response.codigoClienteOmie,
    name: response.razaoSocial || "",
    document: response.cnpjCpf || ""
  };
}

export class OmieCustomersService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 500): Promise<Customer[]> {
    const all: Customer[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const customers = await listCustomers(this.client, {
        pagina: page,
        registrosPorPagina: pageSize
      });

      if (customers.length === 0) break;
      all.push(...customers);

      hasMore = customers.length === pageSize;
      page++;
    }

    return all;
  }

  async getById(id: number): Promise<Customer | null> {
    return getCustomer(this.client, id);
  }
}
