import type { OmieClient } from "./omie-client.js";

/**
 * Categoria (plano de contas gerencial) do OMIE. E o `codigo_categoria` enviado em
 * `informacoes_adicionais` do pedido de venda — o que classifica a receita no DRE.
 */
export interface OmieCategory {
  /** Codigo da categoria (ex: "1.01.01"). String: preserva os pontos e zeros. */
  code: string;
  description: string;
  /** "R" receita, "D" despesa, quando o OMIE informa. */
  categoryType: string | null;
  /** Categoria de nivel superior (codigo do pai), quando houver. */
  parentCode: string | null;
  isActive: boolean;
}

export interface ListCategoriesParam {
  pagina: number;
  registros_por_pagina?: number;
}

interface OmieCategoryRaw {
  codigo?: string | number;
  codigo_categoria?: string | number;
  descricao?: string;
  descricao_padrao?: string;
  tipo_categoria?: string;
  categoria_superior?: string;
  conta_inativa?: string;
  nao_exibir?: string;
}

/** Lista uma pagina de categorias do OMIE (ListarCategorias). */
export async function listCategories(
  client: OmieClient,
  param: ListCategoriesParam
): Promise<OmieCategory[]> {
  const response = (await client.call("/geral/categorias/", "ListarCategorias", param)) as Record<
    string,
    unknown
  >;

  const categories: OmieCategory[] = [];
  for (const item of extractRows(response)) {
    const mapped = mapCategoryRaw(item);
    if (mapped) categories.push(mapped);
  }
  return categories;
}

export class OmieCategoriesService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 100): Promise<OmieCategory[]> {
    const all: OmieCategory[] = [];
    let page = 1;

    for (;;) {
      const categories = await listCategories(this.client, {
        pagina: page,
        registros_por_pagina: pageSize
      });
      if (categories.length === 0) break;
      all.push(...categories);
      if (categories.length < pageSize) break;
      page++;
    }

    return all;
  }
}

const KNOWN_LIST_KEYS = ["categoria_cadastro", "categoriaCadastro", "ListarCategorias"];

function extractRows(response: Record<string, unknown>): OmieCategoryRaw[] {
  if (!response || typeof response !== "object") return [];
  for (const key of KNOWN_LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value as OmieCategoryRaw[];
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as OmieCategoryRaw[];
  }
  return [];
}

function mapCategoryRaw(item: OmieCategoryRaw): OmieCategory | null {
  if (!item || typeof item !== "object") return null;
  const code = String(item.codigo ?? item.codigo_categoria ?? "").trim();
  const description = (item.descricao ?? item.descricao_padrao ?? "").trim();
  if (!code || !description) return null;
  // `nao_exibir` marca categorias estruturais (totalizadoras): nao servem para
  // classificar um pedido, entao entram como inativas para nao aparecerem na escolha.
  const hidden = (item.nao_exibir ?? "").trim().toUpperCase() === "S";
  const inactive = (item.conta_inativa ?? "").trim().toUpperCase() === "S";
  return {
    code,
    description,
    categoryType: item.tipo_categoria?.trim() || null,
    parentCode: item.categoria_superior?.trim() || null,
    isActive: !hidden && !inactive
  };
}
