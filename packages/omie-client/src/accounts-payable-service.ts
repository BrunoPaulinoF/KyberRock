import type { OmieClient } from "./omie-client.js";
import { formatOmieDate, parseOmieDate, toCents } from "./omie-dates.js";

/**
 * Situacao normalizada de um titulo a pagar. O OMIE nao devolve um status
 * pronto e confiavel em ListarContasPagar — e derivado aqui a partir de
 * valor pago x valor do documento x vencimento.
 */
export type AccountPayableStatus = "paid" | "partial" | "overdue" | "open";

/**
 * Titulo de contas a pagar, ja com apenas os campos essenciais para o relatorio
 * (fornecedor, documento, vencimento, valor, status) — o retorno bruto do OMIE
 * traz dezenas de campos (distribuicao por categoria, flags de bloqueio, etc.)
 * que nao interessam ao destinatario do relatorio.
 */
export interface OmieAccountPayable {
  /** codigo_lancamento_omie — id interno do titulo no OMIE. */
  id: number;
  integrationCode: string | null;
  /** codigo_cliente_fornecedor — resolvido para nome pelo caller via customers-service. */
  supplierOmieCode: number | null;
  documentNumber: string | null;
  documentType: string | null;
  issueDate: string | null; // ISO yyyy-mm-dd
  dueDate: string | null; // ISO yyyy-mm-dd
  amountCents: number;
  paidAmountCents: number;
  paidDate: string | null; // ISO yyyy-mm-dd
  categoryCode: string | null;
  observation: string | null;
  status: AccountPayableStatus;
}

export interface ListAccountsPayableParam {
  pagina: number;
  registros_por_pagina?: number;
  /** Filtra por data de vencimento "de" (dd/mm/aaaa). */
  filtrar_por_data_de?: string;
  /** Filtra por data de vencimento "ate" (dd/mm/aaaa). */
  filtrar_por_data_ate?: string;
}

interface OmieAccountPayableRaw {
  codigo_lancamento_omie?: number | string;
  codigoLancamentoOmie?: number | string;
  codigo_lancamento_integracao?: string;
  codigoLancamentoIntegracao?: string;
  codigo_cliente_fornecedor?: number | string;
  codigoClienteFornecedor?: number | string;
  numero_documento?: string;
  numeroDocumento?: string;
  codigo_tipo_documento?: string;
  codigoTipoDocumento?: string;
  data_emissao?: string;
  dataEmissao?: string;
  data_vencimento?: string;
  dataVencimento?: string;
  valor_documento?: number | string;
  valorDocumento?: number | string;
  valor_pago?: number | string;
  valorPago?: number | string;
  data_pagamento?: string;
  dataPagamento?: string;
  codigo_categoria?: string;
  codigoCategoria?: string;
  observacao?: string;
  status_titulo?: string;
  statusTitulo?: string;
}

const KNOWN_LIST_KEYS = ["conta_pagar_cadastro", "contaPagarCadastro"];

/** Lista uma pagina de titulos a pagar do OMIE (ListarContasPagar). */
export async function listAccountsPayable(
  client: OmieClient,
  param: ListAccountsPayableParam
): Promise<OmieAccountPayable[]> {
  const response = (await client.call("/financas/contapagar/", "ListarContasPagar", {
    ...param,
    apenas_importado_api: "N"
  })) as Record<string, unknown>;

  const items: OmieAccountPayable[] = [];
  for (const raw of extractRows(response)) {
    const mapped = mapAccountPayableRaw(raw);
    if (mapped) items.push(mapped);
  }
  return items;
}

export class OmieAccountsPayableService {
  constructor(private readonly client: OmieClient) {}

  /**
   * Lista todos os titulos a pagar com vencimento no intervalo informado
   * (datas ISO, inclusive). Filtra tanto no request quanto no retorno — o
   * segundo filtro protege contra paginas que o OMIE devolva fora do
   * intervalo pedido.
   */
  async listByDueDateRange(
    startIsoDate: string,
    endIsoDate: string,
    pageSize = 200
  ): Promise<OmieAccountPayable[]> {
    const all: OmieAccountPayable[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const items = await listAccountsPayable(this.client, {
        pagina: page,
        registros_por_pagina: pageSize,
        filtrar_por_data_de: formatOmieDate(startIsoDate),
        filtrar_por_data_ate: formatOmieDate(endIsoDate)
      });

      if (items.length === 0) break;
      all.push(...items);

      hasMore = items.length === pageSize;
      page++;
    }

    return all.filter(
      (item) => item.dueDate !== null && item.dueDate >= startIsoDate && item.dueDate <= endIsoDate
    );
  }
}

function extractRows(response: Record<string, unknown>): OmieAccountPayableRaw[] {
  if (!response || typeof response !== "object") return [];
  for (const key of KNOWN_LIST_KEYS) {
    const value = response[key];
    if (Array.isArray(value)) return value as OmieAccountPayableRaw[];
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as OmieAccountPayableRaw[];
  }
  return [];
}

function mapAccountPayableRaw(item: OmieAccountPayableRaw): OmieAccountPayable | null {
  if (!item || typeof item !== "object") return null;
  const idValue = pickFirst(item.codigo_lancamento_omie, item.codigoLancamentoOmie);
  const id = toNumber(idValue);
  if (id === null) return null;

  const amountCents = toCents(pickFirst(item.valor_documento, item.valorDocumento));
  const paidAmountCents = toCents(pickFirst(item.valor_pago, item.valorPago));
  const dueDate = parseOmieDate(pickFirst(item.data_vencimento, item.dataVencimento));
  const status = computeStatus({ amountCents, paidAmountCents, dueDate });

  return {
    id,
    integrationCode: pickFirst(item.codigo_lancamento_integracao, item.codigoLancamentoIntegracao),
    supplierOmieCode: toNumber(
      pickFirst(item.codigo_cliente_fornecedor, item.codigoClienteFornecedor)
    ),
    documentNumber: pickFirst(item.numero_documento, item.numeroDocumento),
    documentType: pickFirst(item.codigo_tipo_documento, item.codigoTipoDocumento),
    issueDate: parseOmieDate(pickFirst(item.data_emissao, item.dataEmissao)),
    dueDate,
    amountCents,
    paidAmountCents,
    paidDate: parseOmieDate(pickFirst(item.data_pagamento, item.dataPagamento)),
    categoryCode: pickFirst(item.codigo_categoria, item.codigoCategoria),
    observation: pickFirst(item.observacao),
    status
  };
}

function computeStatus(input: {
  amountCents: number;
  paidAmountCents: number;
  dueDate: string | null;
}): AccountPayableStatus {
  if (input.paidAmountCents > 0 && input.paidAmountCents >= input.amountCents) return "paid";
  if (input.paidAmountCents > 0) return "partial";
  const today = new Date().toISOString().slice(0, 10);
  if (input.dueDate !== null && input.dueDate < today) return "overdue";
  return "open";
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
