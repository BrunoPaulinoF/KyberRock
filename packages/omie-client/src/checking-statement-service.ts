import type { OmieClient } from "./omie-client.js";
import { formatOmieDate, parseOmieDate, toCents } from "./omie-dates.js";

/**
 * Lancamento do extrato de uma conta corrente OMIE (ListarExtrato). Ao
 * contrario de contas a pagar, o extrato e reportado como o OMIE devolve —
 * sem filtragem de linhas, so tipagem/normalizacao dos mesmos campos.
 */
export interface OmieStatementEntry {
  date: string | null; // ISO yyyy-mm-dd
  description: string | null;
  documentNumber: string | null;
  /** "D" (debito) ou "C" (credito). */
  nature: "D" | "C" | null;
  amountCents: number;
  runningBalanceCents: number | null;
  categoryCode: string | null;
  reconciled: boolean;
}

export interface CheckingAccountStatement {
  checkingAccountCode: number;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  entries: OmieStatementEntry[];
}

export interface GetCheckingAccountStatementParam {
  checkingAccountCode: number;
  /** ISO yyyy-mm-dd, inclusive. */
  startDate: string;
  /** ISO yyyy-mm-dd, inclusive. */
  endDate: string;
  pagina?: number;
  registros_por_pagina?: number;
}

interface OmieStatementEntryRaw {
  dData?: string;
  data?: string;
  dDataMovimento?: string;
  dataMovimento?: string;
  cDescricao?: string;
  descricao?: string;
  cHistorico?: string;
  historico?: string;
  cNumDocumento?: string;
  numeroDocumento?: string;
  cNatureza?: string;
  natureza?: string;
  nValorMovimento?: number | string;
  valorMovimento?: number | string;
  nValor?: number | string;
  valor?: number | string;
  nSaldo?: number | string;
  saldo?: number | string;
  cCodCategoria?: string;
  codigoCategoria?: string;
  cConciliado?: string;
  conciliado?: string;
}

const KNOWN_LIST_KEYS = [
  "listaMovimento",
  "lista_movimento",
  "movimentos",
  "extrato",
  "listaExtrato"
];
const KNOWN_OPENING_BALANCE_KEYS = ["nSaldoInicial", "saldo_inicial", "saldoInicial"];
const KNOWN_CLOSING_BALANCE_KEYS = ["nSaldoFinal", "saldo_final", "saldoFinal"];

/** Busca o extrato de uma conta corrente no periodo informado (ListarExtrato). */
export async function getCheckingAccountStatement(
  client: OmieClient,
  param: GetCheckingAccountStatementParam
): Promise<CheckingAccountStatement> {
  const response = (await client.call("/financas/extrato/", "ListarExtrato", {
    nCodCC: param.checkingAccountCode,
    dPeriodoInicial: formatOmieDate(param.startDate),
    dPeriodoFinal: formatOmieDate(param.endDate),
    pagina: param.pagina ?? 1,
    registros_por_pagina: param.registros_por_pagina ?? 500
  })) as Record<string, unknown>;

  const entries = extractRows(response)
    .map(mapStatementEntryRaw)
    .filter((entry): entry is OmieStatementEntry => entry !== null);

  return {
    checkingAccountCode: param.checkingAccountCode,
    openingBalanceCents: pickBalance(response, KNOWN_OPENING_BALANCE_KEYS),
    closingBalanceCents: pickBalance(response, KNOWN_CLOSING_BALANCE_KEYS),
    entries
  };
}

export class OmieCheckingStatementService {
  constructor(private readonly client: OmieClient) {}

  async getStatement(param: GetCheckingAccountStatementParam): Promise<CheckingAccountStatement> {
    return getCheckingAccountStatement(this.client, param);
  }
}

function extractRows(response: Record<string, unknown>): OmieStatementEntryRaw[] {
  if (!response || typeof response !== "object") return [];
  for (const key of KNOWN_LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value as OmieStatementEntryRaw[];
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as OmieStatementEntryRaw[];
  }
  return [];
}

function pickBalance(response: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (key in response) return toCents(response[key]);
  }
  return null;
}

function mapStatementEntryRaw(item: OmieStatementEntryRaw): OmieStatementEntry | null {
  if (!item || typeof item !== "object") return null;
  const date = parseOmieDate(
    pickFirst(item.dData, item.data, item.dDataMovimento, item.dataMovimento)
  );
  const description = pickFirst(item.cDescricao, item.descricao, item.cHistorico, item.historico);
  const natureRaw = pickFirst(item.cNatureza, item.natureza)?.toUpperCase() ?? null;
  const nature: OmieStatementEntry["nature"] =
    natureRaw === "D" || natureRaw === "C" ? natureRaw : null;

  return {
    date,
    description,
    documentNumber: pickFirst(item.cNumDocumento, item.numeroDocumento),
    nature,
    amountCents: toCents(
      pickFirst(item.nValorMovimento, item.valorMovimento, item.nValor, item.valor)
    ),
    runningBalanceCents:
      pickFirst(item.nSaldo, item.saldo) === null
        ? null
        : toCents(pickFirst(item.nSaldo, item.saldo)),
    categoryCode: pickFirst(item.cCodCategoria, item.codigoCategoria),
    reconciled: isYesFlag(pickFirst(item.cConciliado, item.conciliado))
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

function isYesFlag(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "S";
}
