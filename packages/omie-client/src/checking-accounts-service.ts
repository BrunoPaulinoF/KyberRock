import type { OmieClient } from "./omie-client.js";

/** Conta corrente cadastrada no OMIE (nCodCC + descricao). */
export interface OmieCheckingAccount {
  /** Codigo OMIE da conta corrente (nCodCC). */
  code: number;
  /** Codigo de integracao (cCodCCInt), quando preenchido. */
  integrationCode: string | null;
  name: string;
  type: string | null;
  isActive: boolean;
}

export interface ListCheckingAccountsParam {
  pagina: number;
  registros_por_pagina?: number;
}

interface OmieCheckingAccountRaw {
  nCodCC?: number | string;
  codigo_conta_corrente?: number | string;
  codigoContaCorrente?: number | string;
  cCodCCInt?: string;
  descricao?: string;
  tipo_conta_corrente?: string;
  tipo?: string;
  inativa?: string;
}

/** Lista uma pagina de contas correntes do OMIE (ListarContasCorrentes). */
export async function listCheckingAccounts(
  client: OmieClient,
  param: ListCheckingAccountsParam
): Promise<OmieCheckingAccount[]> {
  const response = (await client.call(
    "/geral/contacorrente/",
    "ListarContasCorrentes",
    param
  )) as Record<string, unknown>;

  const accounts: OmieCheckingAccount[] = [];
  for (const item of extractRows(response)) {
    const mapped = mapCheckingAccountRaw(item);
    if (mapped) accounts.push(mapped);
  }
  return accounts;
}

export class OmieCheckingAccountsService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 100): Promise<OmieCheckingAccount[]> {
    const all: OmieCheckingAccount[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const accounts = await listCheckingAccounts(this.client, {
        pagina: page,
        registros_por_pagina: pageSize
      });

      if (accounts.length === 0) break;
      all.push(...accounts);

      hasMore = accounts.length === pageSize;
      page++;
    }

    return all;
  }
}

// Mesmas chaves toleradas pelo edge function omie-sync (extractFirstAccountCode).
const KNOWN_LIST_KEYS = ["ListarContasCorrentes", "conta_corrente_lista", "contaCorrenteLista"];

function extractRows(response: Record<string, unknown>): OmieCheckingAccountRaw[] {
  if (!response || typeof response !== "object") return [];
  for (const key of KNOWN_LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value as OmieCheckingAccountRaw[];
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as OmieCheckingAccountRaw[];
  }
  return [];
}

function mapCheckingAccountRaw(item: OmieCheckingAccountRaw): OmieCheckingAccount | null {
  if (!item || typeof item !== "object") return null;
  const codeValue = item.nCodCC ?? item.codigo_conta_corrente ?? item.codigoContaCorrente;
  const code = typeof codeValue === "number" ? codeValue : Number(String(codeValue ?? "").trim());
  const name = (item.descricao ?? "").trim();
  if (!Number.isFinite(code) || code <= 0 || !name) return null;
  return {
    code,
    integrationCode: item.cCodCCInt?.trim() || null,
    name,
    type: (item.tipo_conta_corrente ?? item.tipo)?.trim() || null,
    isActive: (item.inativa ?? "").trim().toUpperCase() !== "S"
  };
}
