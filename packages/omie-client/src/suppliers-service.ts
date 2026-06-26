import type { OmieClient } from "./omie-client.js";

export interface Supplier {
  id: number;
  integrationCode?: string;
  name: string;
  tradeName?: string;
  document?: string;
  email?: string;
  phone?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  isActive: boolean;
  tags?: Record<string, unknown> | unknown[];
}

export interface ListSuppliersParam {
  pagina: number;
  registrosPorPagina?: number;
}

interface OmieSupplierRaw {
  codigo_cliente_fornecedor?: number | string;
  codigoClienteFornecedor?: number | string;
  codigo_cliente_integracao?: string;
  codigoClienteIntegracao?: string;
  razao_social?: string;
  razaoSocial?: string;
  nome_fantasia?: string;
  nomeFantasia?: string;
  cnpj_cpf?: string;
  cnpjCpf?: string;
  email?: string;
  endereco?: string;
  endereco_numero?: string;
  enderecoNumero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  telefone1_ddd?: string;
  telefone1Ddd?: string;
  telefone1_numero?: string;
  telefone1Numero?: string;
  tags?: Array<{ tag: string }> | Record<string, unknown>;
  inativo?: string;
}

export async function listSuppliers(
  client: OmieClient,
  params: ListSuppliersParam
): Promise<{ items: Supplier[]; totalPages: number; currentPage: number }> {
  const response = await client.call<
    { pagina: number; registros_por_pagina: number },
    {
      nRegPorPagina?: number;
      nTotPaginas?: number;
      nPagina?: number;
      fornecedoresCadastro?: OmieSupplierRaw[];
    }
  >("/geral/fornecedores/", "ListarFornecedores", {
    pagina: params.pagina,
    registros_por_pagina: params.registrosPorPagina ?? 50
  });

  const items = (response.fornecedoresCadastro ?? []).map(mapSupplier);
  return {
    items,
    totalPages: response.nTotPaginas ?? 1,
    currentPage: response.nPagina ?? params.pagina
  };
}

function mapSupplier(raw: OmieSupplierRaw): Supplier {
  const id = Number(raw.codigo_cliente_fornecedor ?? raw.codigoClienteFornecedor ?? 0);
  const tags = parseTags(raw.tags);
  const phoneDdd = pickFirst(raw.telefone1_ddd, raw.telefone1Ddd);
  const phoneNumber = pickFirst(raw.telefone1_numero, raw.telefone1Numero);
  const phone = phoneDdd && phoneNumber ? `(${phoneDdd}) ${phoneNumber}` : undefined;

  return {
    id,
    integrationCode: String(raw.codigo_cliente_integracao ?? raw.codigoClienteIntegracao ?? ""),
    name: String(raw.razao_social ?? raw.razaoSocial ?? "").trim(),
    tradeName: String(raw.nome_fantasia ?? raw.nomeFantasia ?? "").trim() || undefined,
    document: String(raw.cnpj_cpf ?? raw.cnpjCpf ?? "").trim() || undefined,
    email: pickFirst(raw.email),
    phone,
    zipcode: pickFirst(raw.cep),
    addressStreet: pickFirst(raw.endereco),
    addressNumber: pickFirst(raw.endereco_numero, raw.enderecoNumero),
    addressComplement: pickFirst(raw.complemento),
    neighborhood: pickFirst(raw.bairro),
    city: pickFirst(raw.cidade),
    state: pickFirst(raw.estado),
    isActive: String(raw.inativo ?? "").trim().toUpperCase() !== "S",
    tags
  };
}

function parseTags(
  tags: Array<{ tag: string }> | Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!tags) return undefined;
  if (Array.isArray(tags)) {
    return { tags: tags.map((t) => t.tag) };
  }
  return tags;
}

export function hasTransportadoraTag(supplier: Supplier): boolean {
  return hasSupplierTag(supplier, "transportadora");
}

export function hasClienteTag(supplier: Supplier): boolean {
  return hasSupplierTag(supplier, "cliente");
}

function hasSupplierTag(supplier: Supplier, expectedTag: string): boolean {
  if (!supplier.tags) return false;
  const tagValues: string[] = [];
  if (Array.isArray(supplier.tags)) {
    tagValues.push(...supplier.tags.map((t) => String((t as { tag?: string }).tag ?? t)));
  } else if (typeof supplier.tags === "object") {
    const tagsArray = supplier.tags.tags;
    if (Array.isArray(tagsArray)) {
      tagValues.push(...tagsArray.map(String));
    }
  }
  return tagValues.some((t) => t.toLowerCase().includes(expectedTag));
}

function pickFirst(...values: Array<string | number | null | undefined>): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

export class OmieSuppliersService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 50): Promise<Supplier[]> {
    const all: Supplier[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { items, totalPages, currentPage } = await listSuppliers(this.client, {
        pagina: page,
        registrosPorPagina: pageSize
      });

      if (items.length === 0) break;
      all.push(...items);

      hasMore = currentPage < totalPages;
      page++;
    }

    return all;
  }
}
