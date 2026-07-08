import type { OmieClient } from "./omie-client.js";

/**
 * Condicao de pagamento (parcela) do cadastro do OMIE (/geral/parcelas/).
 * O codigo (ex: "000", "030") preserva zeros a esquerda — e ele que vai no
 * codigo_parcela do pedido de venda / cCodParc da OS.
 */
export interface OmieParcela {
  id: number;
  code: string;
  description: string;
  firstInstallmentDays: number | null;
  installmentIntervalDays: number | null;
  installmentCount: number | null;
  installmentType: string | null;
  installmentDays: number[] | null;
  isActive: boolean;
  visible: boolean;
}

export interface ListParcelasParam {
  pagina: number;
  registros_por_pagina?: number;
}

// Mesmos aliases tolerados pelo edge function omie-sync (mapOmiePaymentTermRaw).
interface OmieParcelaRaw {
  nCodigo?: number | string;
  codigo?: number | string;
  codigoParcela?: number | string;
  cDescricao?: string;
  descricao?: string;
  descricaoParcela?: string;
  nDiasPrimeiraParcela?: number | string;
  dias_primeira_parcela?: number | string;
  nIntervaloParcelas?: number | string;
  intervalo_parcelas?: number | string;
  nParcelas?: number | string;
  nNumeroParcelas?: number | string;
  numero_parcelas?: number | string;
  cTipoParcelas?: string;
  tipo_parcelas?: string;
  aparcela_dias?: Array<number | string>;
  cInativo?: string;
  inativo?: string;
  cVisualizar?: string;
  visualizar?: string;
}

/** Lista uma pagina de parcelas do OMIE (ListarParcelas). */
export async function listParcelas(
  client: OmieClient,
  param: ListParcelasParam
): Promise<OmieParcela[]> {
  const response = (await client.call("/geral/parcelas/", "ListarParcelas", {
    ...param,
    apenas_importado_api: "N"
  })) as Record<string, unknown>;

  const parcelas: OmieParcela[] = [];
  for (const item of extractRows(response)) {
    const mapped = mapParcelaRaw(item);
    if (mapped) parcelas.push(mapped);
  }
  return parcelas;
}

export class OmieParcelasService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 100): Promise<OmieParcela[]> {
    const all: OmieParcela[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const parcelas = await listParcelas(this.client, {
        pagina: page,
        registros_por_pagina: pageSize
      });

      if (parcelas.length === 0) break;
      all.push(...parcelas);

      hasMore = parcelas.length === pageSize;
      page++;
    }

    return all;
  }
}

const KNOWN_LIST_KEYS = [
  "cadastros",
  "parcela_cadastro",
  "parcelaCadastro",
  "condicoesPagamentoCadastro"
];

function extractRows(response: Record<string, unknown>): OmieParcelaRaw[] {
  if (!response || typeof response !== "object") return [];
  for (const key of KNOWN_LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value as OmieParcelaRaw[];
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as OmieParcelaRaw[];
  }
  return [];
}

function mapParcelaRaw(item: OmieParcelaRaw): OmieParcela | null {
  if (!item || typeof item !== "object") return null;
  // Preserva o codigo original (ex: "000") — zeros a esquerda sao significativos.
  const code = pickFirst(item.nCodigo, item.codigo, item.codigoParcela);
  const id = toNumber(code);
  const description = pickFirst(item.cDescricao, item.descricao, item.descricaoParcela);
  if (code === null || id === null || !description) return null;

  const days = Array.isArray(item.aparcela_dias)
    ? item.aparcela_dias
        .map((value) => toNumber(value))
        .filter((value): value is number => value !== null)
    : null;

  return {
    id,
    code,
    description,
    firstInstallmentDays: toNumber(pickFirst(item.nDiasPrimeiraParcela, item.dias_primeira_parcela)),
    installmentIntervalDays: toNumber(pickFirst(item.nIntervaloParcelas, item.intervalo_parcelas)),
    installmentCount: toNumber(pickFirst(item.nParcelas, item.nNumeroParcelas, item.numero_parcelas)),
    installmentType: pickFirst(item.cTipoParcelas, item.tipo_parcelas),
    installmentDays: days && days.length > 0 ? days : null,
    isActive: !isYesFlag(pickFirst(item.cInativo, item.inativo)),
    visible: !isNoFlag(pickFirst(item.cVisualizar, item.visualizar))
  };
}

function pickFirst(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
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

function isNoFlag(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "N";
}
