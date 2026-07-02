import type { OmieClient } from "./omie-client.js";

export interface Product {
  id: number;
  description: string;
  code?: string;
  integrationCode?: string;
  detailedDescription?: string;
  unitPrice?: number;
  unitPriceCents?: number;
  unit?: string;
  ncm?: string;
  ean?: string;
  familyCode?: string;
  familyDescription?: string;
  brand?: string;
  model?: string;
  internalNotes?: string;
  grossWeightKg?: number;
  netWeightKg?: number;
  heightM?: number;
  widthM?: number;
  depthM?: number;
  cest?: string;
  itemType?: string;
  icmsOrigin?: string;
  isActive: boolean;
  blocked: boolean;
  fiscalRecommendations?: Record<string, unknown>;
}

export interface ListProductsParam {
  pagina: number;
  registros_por_pagina?: number;
  apenas_importado_api?: "S" | "N";
  filtrar_apenas_omiepdv?: "S" | "N";
  exibir_caracteristicas?: "S" | "N";
  exibir_obs?: "S" | "N";
}

interface OmieProductRaw {
  codigo_produto?: number | string;
  codigoProdutoOmie?: number | string;
  codigo_produto_integracao?: string;
  codigoProdutoIntegracao?: string;
  codigo?: string;
  descricao?: string;
  descr_detalhada?: string;
  descrDetalhada?: string;
  unidade?: string;
  ncm?: string;
  ean?: string;
  valor_unitario?: number | string;
  valorUnitario?: number | string;
  codigo_familia?: number | string;
  codigoFamilia?: number | string;
  descricao_familia?: string;
  descricaoFamilia?: string;
  marca?: string;
  modelo?: string;
  obs_internas?: string;
  obsInternas?: string;
  peso_bruto?: number | string;
  pesoBruto?: number | string;
  peso_liq?: number | string;
  pesoLiq?: number | string;
  altura?: number | string;
  largura?: number | string;
  profundidade?: number | string;
  cest?: string;
  tipoItem?: string;
  tipo_item?: string;
  origem_mercadoria?: string;
  origemMercadoria?: string;
  inativo?: string;
  bloqueado?: string;
  recomendacoes_fiscais?: Record<string, unknown>;
  recomendacoesFiscais?: Record<string, unknown>;
}

export async function listProducts(
  client: OmieClient,
  param: ListProductsParam
): Promise<Product[]> {
  const response = (await client.call("/geral/produtos/", "ListarProdutos", param)) as {
    produto_servico_cadastro?: OmieProductRaw[];
    produtoCadastro?: OmieProductRaw[];
  };

  const raw = response.produto_servico_cadastro ?? response.produtoCadastro ?? [];
  const products: Product[] = [];
  for (const item of raw) {
    const mapped = mapOmieProductRaw(item);
    if (mapped) products.push(mapped);
  }
  return products;
}

export class OmieProductsService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 100): Promise<Product[]> {
    const all: Product[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const products = await listProducts(this.client, {
        pagina: page,
        registros_por_pagina: pageSize,
        apenas_importado_api: "N",
        filtrar_apenas_omiepdv: "N",
        exibir_caracteristicas: "N",
        exibir_obs: "S"
      });

      if (products.length === 0) break;
      all.push(...products);

      hasMore = products.length === pageSize;
      page++;
    }

    return all;
  }
}

function mapOmieProductRaw(item: OmieProductRaw): Product | null {
  const idValue = pickFirst(item.codigo_produto, item.codigoProdutoOmie);
  if (!idValue || !item.descricao) return null;
  const productId = Number(idValue);
  if (!Number.isFinite(productId)) return null;

  const unitPrice = toNumber(pickFirst(item.valor_unitario, item.valorUnitario));
  const recommendations = (item.recomendacoes_fiscais ?? item.recomendacoesFiscais ?? null) as
    | Record<string, unknown>
    | null;
  const icmsOriginFromRecommendations = recommendations
    ? typeof recommendations.origem_mercadoria === "string"
      ? recommendations.origem_mercadoria
      : typeof recommendations.origemMercadoria === "string"
        ? recommendations.origemMercadoria
        : null
    : null;

  const product: Product = {
    id: productId,
    description: item.descricao,
    isActive: !isYesFlag(item.inativo),
    blocked: isYesFlag(item.bloqueado)
  };

  assign(product, "code", pickFirst(item.codigo));
  assign(product, "integrationCode", pickFirst(item.codigo_produto_integracao, item.codigoProdutoIntegracao));
  assign(product, "detailedDescription", pickFirst(item.descr_detalhada, item.descrDetalhada));
  assign(product, "unit", pickFirst(item.unidade));
  assign(product, "ncm", pickFirst(item.ncm));
  assign(product, "ean", pickFirst(item.ean));
  assign(product, "familyCode", pickFirstAsString(item.codigo_familia, item.codigoFamilia));
  assign(product, "familyDescription", pickFirst(item.descricao_familia, item.descricaoFamilia));
  assign(product, "brand", pickFirst(item.marca));
  assign(product, "model", pickFirst(item.modelo));
  assign(product, "internalNotes", pickFirst(item.obs_internas, item.obsInternas));
  assign(product, "cest", pickFirst(item.cest));
  assign(product, "itemType", pickFirst(item.tipoItem, item.tipo_item));
  assign(
    product,
    "icmsOrigin",
    pickFirst(item.origem_mercadoria, item.origemMercadoria, icmsOriginFromRecommendations)
  );

  assignNumber(product, "unitPrice", unitPrice);
  assignNumber(product, "unitPriceCents", unitPrice === null ? null : Math.round(unitPrice * 100));
  assignNumber(product, "grossWeightKg", toNumber(pickFirst(item.peso_bruto, item.pesoBruto)));
  assignNumber(product, "netWeightKg", toNumber(pickFirst(item.peso_liq, item.pesoLiq)));
  assignNumber(product, "heightM", toNumber(item.altura));
  assignNumber(product, "widthM", toNumber(item.largura));
  assignNumber(product, "depthM", toNumber(item.profundidade));

  if (recommendations) product.fiscalRecommendations = recommendations;

  return product;
}

function assign(product: Product, key: keyof Product, value: string | null): void {
  if (value !== null) (product as unknown as Record<string, unknown>)[key as string] = value;
}

function assignNumber(product: Product, key: keyof Product, value: number | null): void {
  if (value !== null) (product as unknown as Record<string, unknown>)[key as string] = value;
}

function pickFirst(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function pickFirstAsString(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      return String(value);
    }
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function isYesFlag(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "S";
}
