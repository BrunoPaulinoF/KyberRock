import type { OmieClient } from "./omie-client.js";

export interface PaymentTerm {
  id: number;
  /** Codigo original da condicao no OMIE (ex.: "000", "015"), usado em codigo_parcela de pedidos. */
  code?: string;
  integrationCode?: string;
  description: string;
  firstInstallmentDays?: number;
  installmentIntervalDays?: number;
  installmentCount?: number;
  installmentType?: string;
  installmentDays?: number[];
  isActive: boolean;
  visible?: boolean;
}

export interface ListPaymentTermsParam {
  pagina: number;
  registros_por_pagina?: number;
  apenas_importado_api?: "S" | "N";
}

interface OmiePaymentTermRaw {
  // Campos do endpoint atual /geral/parcelas/ (ListarParcelas)
  nCodigo?: number | string;
  nParcelas?: number | string;
  // Campos legados / variacoes mantidos por resiliencia
  codigoCondicaoPagamentoOmie?: number | string;
  codigo_condicao_pagamento_omie?: number | string;
  codigoCondicaoPagamentoIntegracao?: string;
  codigo_condicao_pagamento_integracao?: string;
  nCodCondicao?: number | string;
  codigo?: number | string;
  codigoParcela?: number | string;
  descricaoCondicaoPagamento?: string;
  descricao_condicao_pagamento?: string;
  cDescricao?: string;
  descricao?: string;
  descricaoParcela?: string;
  nDiasPrimeiraParcela?: number | string;
  dias_primeira_parcela?: number | string;
  nIntervaloParcelas?: number | string;
  intervalo_parcelas?: number | string;
  nNumeroParcelas?: number | string;
  numero_parcelas?: number | string;
  cTipoParcelas?: string;
  tipo_parcelas?: string;
  aparcela_dias?: number[] | string[];
  cInativo?: string;
  inativo?: string;
  cVisualizar?: string;
  visualizar?: string;
}

export async function listPaymentTerms(
  client: OmieClient,
  param: ListPaymentTermsParam
): Promise<PaymentTerm[]> {
  const response = (await client.call(
    "/geral/parcelas/",
    "ListarParcelas",
    param
  )) as {
    cadastros?: OmiePaymentTermRaw[];
    parcela_cadastro?: OmiePaymentTermRaw[];
    condicoesPagamentoCadastro?: OmiePaymentTermRaw[];
    condicoes_pagamento_cadastro?: OmiePaymentTermRaw[];
    listaCondicoesPagamento?: OmiePaymentTermRaw[];
  };

  const raw =
    response.cadastros ??
    response.parcela_cadastro ??
    response.condicoesPagamentoCadastro ??
    response.condicoes_pagamento_cadastro ??
    response.listaCondicoesPagamento ??
    [];

  const terms: PaymentTerm[] = [];
  for (const item of raw) {
    const mapped = mapOmiePaymentTermRaw(item);
    if (mapped) terms.push(mapped);
  }
  return terms;
}

export class OmiePaymentTermsService {
  constructor(private readonly client: OmieClient) {}

  async listAll(pageSize = 100): Promise<PaymentTerm[]> {
    const all: PaymentTerm[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const terms = await listPaymentTerms(this.client, {
        pagina: page,
        registros_por_pagina: pageSize,
        apenas_importado_api: "N"
      });

      if (terms.length === 0) break;
      all.push(...terms);

      hasMore = terms.length === pageSize;
      page++;
    }

    return all;
  }
}

function mapOmiePaymentTermRaw(item: OmiePaymentTermRaw | null | undefined): PaymentTerm | null {
  if (!item) return null;
  const idValue = pickFirst(
    item.nCodigo,
    item.codigoCondicaoPagamentoOmie,
    item.codigo_condicao_pagamento_omie,
    item.nCodCondicao,
    item.codigo,
    item.codigoParcela
  );
  if (!idValue) return null;
  const id = toNumber(idValue);
  if (id === null) return null;

  const description = pickFirst(
    item.descricaoCondicaoPagamento,
    item.descricao_condicao_pagamento,
    item.cDescricao,
    item.descricao,
    item.descricaoParcela
  );
  if (!description) return null;

  const days = Array.isArray(item.aparcela_dias)
    ? item.aparcela_dias
        .map((value) => toNumber(value))
        .filter((value): value is number => value !== null)
    : null;

  const term: PaymentTerm = {
    id,
    description,
    isActive: !isYesFlag(pickFirst(item.cInativo, item.inativo))
  };

  // Preserva o codigo original da parcela (ex.: "000"), mantendo zeros a esquerda
  // que sao perdidos ao converter para numero e sao exigidos no codigo_parcela do pedido.
  const code = pickFirst(item.nCodigo, item.codigo, item.codigoParcela);
  if (code) term.code = code;

  const integrationCode = pickFirst(
    item.codigoCondicaoPagamentoIntegracao,
    item.codigo_condicao_pagamento_integracao
  );
  if (integrationCode) term.integrationCode = integrationCode;

  const firstInstallmentDays = toNumber(pickFirst(item.nDiasPrimeiraParcela, item.dias_primeira_parcela));
  if (firstInstallmentDays !== null) term.firstInstallmentDays = firstInstallmentDays;

  const installmentIntervalDays = toNumber(pickFirst(item.nIntervaloParcelas, item.intervalo_parcelas));
  if (installmentIntervalDays !== null) term.installmentIntervalDays = installmentIntervalDays;

  const installmentCount = toNumber(pickFirst(item.nParcelas, item.nNumeroParcelas, item.numero_parcelas));
  if (installmentCount !== null) term.installmentCount = installmentCount;

  const installmentType = pickFirst(item.cTipoParcelas, item.tipo_parcelas);
  if (installmentType) term.installmentType = installmentType;

  if (days && days.length > 0) term.installmentDays = days;

  const visibleFlag = pickFirst(item.cVisualizar, item.visualizar);
  if (visibleFlag) term.visible = !isNoFlag(visibleFlag);

  return term;
}

function pickFirst(...values: Array<string | number | null | undefined>): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return undefined;
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
