import type { OmieClient } from "./omie-client.js";

/** Meio de pagamento do cadastro do OMIE (codigos padrao NFe: "01" dinheiro, "17" PIX...). */
export interface OmiePaymentMethod {
  /** Codigo OMIE/NFe do meio de pagamento. Preserva zeros a esquerda ("01", "03"). */
  code: string;
  description: string;
  type: string | null;
}

interface OmiePaymentMethodRaw {
  codigo?: string | number;
  descricao?: string;
  tipo?: string;
}

/**
 * Lista os meios de pagamento cadastrados no OMIE (ListarMeiosPagamento).
 * O cadastro e uma lista fixa e pequena — a chamada nao e paginada.
 */
export async function listPaymentMethods(client: OmieClient): Promise<OmiePaymentMethod[]> {
  const response = (await client.call("/geral/meiospagamento/", "ListarMeiosPagamento", {
    codigo: ""
  })) as Record<string, unknown>;

  const methods: OmiePaymentMethod[] = [];
  for (const item of extractRows(response)) {
    const mapped = mapPaymentMethodRaw(item);
    if (mapped) methods.push(mapped);
  }
  return methods;
}

export class OmiePaymentMethodsService {
  constructor(private readonly client: OmieClient) {}

  async listAll(): Promise<OmiePaymentMethod[]> {
    return listPaymentMethods(this.client);
  }
}

const KNOWN_LIST_KEYS = ["meio_pagamento_cadastro", "meioPagamentoCadastro", "meios_pagamento"];

function extractRows(response: Record<string, unknown>): OmiePaymentMethodRaw[] {
  if (!response || typeof response !== "object") return [];
  for (const key of KNOWN_LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value as OmiePaymentMethodRaw[];
  }
  // Fallback tolerante a variacao de contrato: primeira lista presente na resposta.
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as OmiePaymentMethodRaw[];
  }
  return [];
}

function mapPaymentMethodRaw(item: OmiePaymentMethodRaw): OmiePaymentMethod | null {
  if (!item || typeof item !== "object") return null;
  const code =
    typeof item.codigo === "number" ? String(item.codigo) : (item.codigo ?? "").trim();
  const description = (item.descricao ?? "").trim();
  if (!code || !description) return null;
  return {
    code,
    description,
    type: item.tipo?.trim() || null
  };
}
