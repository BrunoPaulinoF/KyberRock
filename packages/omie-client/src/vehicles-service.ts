import type { OmieClient } from "./omie-client.js";

/**
 * Veiculo do cadastro de transporte do OMIE (/transportador/veiculo/).
 * A UF e o dado que faltava no pedido: a NF-e pede placa E UF do veiculo, e o bloco
 * `frete` do pedido de venda leva os dois (`placa` + `placa_estado`).
 */
export interface OmieVehicle {
  /** Codigo OMIE do veiculo (nCodVeic). */
  id: number;
  /** Placa sem espacos/tracos, em maiusculas. */
  plate: string;
  /** UF de emplacamento (2 letras) — null quando o cadastro do OMIE nao tem. */
  plateState: string | null;
  /** Marca/modelo, quando o cadastro traz — vira a descricao do veiculo local. */
  description: string | null;
  isActive: boolean;
}

export interface ListVehiclesParam {
  pagina: number;
  registros_por_pagina?: number;
}

// Nomes tolerados nas duas grafias que o OMIE usa nos cadastros (cCampo e campo_solto).
interface OmieVehicleRaw {
  nCodVeic?: number | string;
  nCodigo?: number | string;
  codigo?: number | string;
  codigo_veiculo?: number | string;
  cPlaca?: string;
  placa?: string;
  cUF?: string;
  uf?: string;
  cUFPlaca?: string;
  uf_placa?: string;
  estado?: string;
  cMarca?: string;
  marca?: string;
  cModelo?: string;
  modelo?: string;
  cDescricao?: string;
  descricao?: string;
  cInativo?: string;
  inativo?: string;
}

/** Lista uma pagina do cadastro de veiculos do OMIE (ListarVeiculos). */
export async function listVehicles(
  client: OmieClient,
  param: ListVehiclesParam
): Promise<OmieVehicle[]> {
  const response = (await client.call(
    "/transportador/veiculo/",
    "ListarVeiculos",
    param
  )) as Record<string, unknown>;

  const vehicles: OmieVehicle[] = [];
  for (const item of extractRows(response)) {
    const mapped = mapVehicleRaw(item);
    if (mapped) vehicles.push(mapped);
  }
  return vehicles;
}

export class OmieVehiclesService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 100): Promise<OmieVehicle[]> {
    const all: OmieVehicle[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const vehicles = await listVehicles(this.client, {
        pagina: page,
        registros_por_pagina: pageSize
      });

      if (vehicles.length === 0) break;
      all.push(...vehicles);

      hasMore = vehicles.length === pageSize;
      page++;
    }

    return all;
  }
}

const KNOWN_LIST_KEYS = ["cadastros", "veiculo_cadastro", "veiculoCadastro", "veiculos"];

function extractRows(response: Record<string, unknown>): OmieVehicleRaw[] {
  if (!response || typeof response !== "object") return [];
  for (const key of KNOWN_LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value as OmieVehicleRaw[];
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as OmieVehicleRaw[];
  }
  return [];
}

/** Placa comparavel: so letras e numeros, em maiusculas (Mercosul ou antiga). */
export function normalizeOmiePlate(plate: string | null | undefined): string {
  return (plate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** UF valida (2 letras) ou null — evita gravar lixo num campo fiscal. */
export function normalizePlateState(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : null;
}

function mapVehicleRaw(item: OmieVehicleRaw): OmieVehicle | null {
  if (!item || typeof item !== "object") return null;

  const plate = normalizeOmiePlate(pickFirst(item.cPlaca, item.placa));
  if (!plate) return null;

  const id = toNumber(pickFirst(item.nCodVeic, item.nCodigo, item.codigo, item.codigo_veiculo));
  const description =
    pickFirst(item.cDescricao, item.descricao) ??
    joinNonEmpty([pickFirst(item.cMarca, item.marca), pickFirst(item.cModelo, item.modelo)]);

  return {
    id: id ?? 0,
    plate,
    plateState: normalizePlateState(
      pickFirst(item.cUF, item.uf, item.cUFPlaca, item.uf_placa, item.estado)
    ),
    description,
    isActive: (pickFirst(item.cInativo, item.inativo) ?? "").toUpperCase() !== "S"
  };
}

function joinNonEmpty(values: Array<string | null>): string | null {
  const parts = values.filter((value): value is string => value !== null && value.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

function pickFirst(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function toNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
