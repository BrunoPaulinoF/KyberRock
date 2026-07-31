// Logica pura (sem Deno/fetch) dos adiantamentos de clientes no OMIE.
//
// Adiantamento = dinheiro que o cliente depositou antes de comprar. No OMIE ele
// e lancado como um titulo de contas a receber classificado numa categoria de
// adiantamento e baixado quando o valor entra. O KyberRock nao cria esse
// lancamento: o financeiro e feito no OMIE, e o desktop apenas espelha o saldo
// para abater as compras da balanca.
//
// Fica em _shared (e nao dentro de omie-sync/index.ts) para ser testado com
// vitest, como omie-customer-classification.ts.

/** Titulo a receber do OMIE ja normalizado (datas ISO, valores em centavos). */
export interface OmieReceivableTitle {
  /** codigo_lancamento_omie. */
  id: number;
  integrationCode: string | null;
  customerOmieCode: number | null;
  documentNumber: string | null;
  issueDate: string | null; // ISO yyyy-mm-dd
  dueDate: string | null; // ISO yyyy-mm-dd
  amountCents: number;
  /** Valor efetivamente baixado (dinheiro que entrou). */
  receivedAmountCents: number;
  receivedDate: string | null; // ISO yyyy-mm-dd
  categoryCode: string | null;
  observation: string | null;
  cancelled: boolean;
}

/** Adiantamento do cliente derivado de um titulo a receber. */
export interface OmieCustomerAdvance {
  titleId: number;
  integrationCode: string | null;
  customerOmieCode: number;
  /** Valor recebido em centavos (zero quando o titulo foi cancelado). */
  amountCents: number;
  issueDate: string | null;
  receivedDate: string | null;
  categoryCode: string | null;
  documentNumber: string | null;
  observation: string | null;
  cancelled: boolean;
}

export interface OmieReceivableRaw {
  codigo_lancamento_omie?: number | string;
  codigoLancamentoOmie?: number | string;
  codigo_lancamento_integracao?: string;
  codigoLancamentoIntegracao?: string;
  codigo_cliente_fornecedor?: number | string;
  codigoClienteFornecedor?: number | string;
  numero_documento?: string;
  numeroDocumento?: string;
  data_emissao?: string;
  dataEmissao?: string;
  data_vencimento?: string;
  dataVencimento?: string;
  valor_documento?: number | string;
  valorDocumento?: number | string;
  valor_pago?: number | string;
  valorPago?: number | string;
  valor_baixado?: number | string;
  valorBaixado?: number | string;
  data_pagamento?: string;
  dataPagamento?: string;
  data_baixa?: string;
  dataBaixa?: string;
  codigo_categoria?: string;
  codigoCategoria?: string;
  observacao?: string;
  status_titulo?: string;
  statusTitulo?: string;
  cancelado?: string;
}

/** Status textuais do OMIE que significam "o dinheiro entrou". */
const SETTLED_STATUSES = ["RECEBIDO", "LIQUIDADO", "PAGO", "CONCILIADO", "BAIXADO"];

/**
 * True quando a descricao da categoria OMIE e de adiantamento de clientes. O
 * plano de contas padrao do OMIE cria "Adiantamento de Clientes"; quem renomeou
 * a categoria continua batendo pelo radical "adiantament". Adiantamento a
 * fornecedor e dinheiro que a empresa pagou — nunca vira credito do cliente.
 */
export function isAdvanceCategoryDescription(description: string | null | undefined): boolean {
  if (!description) return false;
  const normalized = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized.includes("adiantament")) return false;
  return !normalized.includes("fornecedor");
}

/**
 * Codigos das categorias de adiantamento de clientes dentro do plano de contas
 * espelhado do OMIE. Categorias inativas ficam de fora: nao recebem lancamento
 * novo, mas titulos antigos ja importados continuam valendo pelo codigo.
 */
export function selectAdvanceCategoryCodes(
  categories: ReadonlyArray<{ code: string; description: string; isActive?: boolean }>
): string[] {
  const codes = new Set<string>();
  for (const category of categories) {
    if (category.isActive === false) continue;
    if (isAdvanceCategoryDescription(category.description)) codes.add(category.code);
  }
  return [...codes];
}

/** Normaliza uma linha de ListarContasReceber. Retorna null se nao tem id. */
export function mapOmieReceivableRaw(raw: OmieReceivableRaw): OmieReceivableTitle | null {
  if (!raw || typeof raw !== "object") return null;
  const id = toNumber(pickFirst(raw.codigo_lancamento_omie, raw.codigoLancamentoOmie));
  if (id === null) return null;

  const amountCents = toCents(pickFirst(raw.valor_documento, raw.valorDocumento));
  const statusText = (pickFirst(raw.status_titulo, raw.statusTitulo) ?? "").toUpperCase();
  const cancelled =
    statusText.includes("CANCELAD") || (pickFirst(raw.cancelado) ?? "").toUpperCase() === "S";
  const receivedDate = parseOmieDate(
    pickFirst(raw.data_pagamento, raw.dataPagamento, raw.data_baixa, raw.dataBaixa)
  );
  const reportedReceived = toCents(
    pickFirst(raw.valor_pago, raw.valorPago, raw.valor_baixado, raw.valorBaixado)
  );

  return {
    id,
    integrationCode: pickFirst(raw.codigo_lancamento_integracao, raw.codigoLancamentoIntegracao),
    customerOmieCode: toNumber(
      pickFirst(raw.codigo_cliente_fornecedor, raw.codigoClienteFornecedor)
    ),
    documentNumber: pickFirst(raw.numero_documento, raw.numeroDocumento),
    issueDate: parseOmieDate(pickFirst(raw.data_emissao, raw.dataEmissao)),
    dueDate: parseOmieDate(pickFirst(raw.data_vencimento, raw.dataVencimento)),
    amountCents,
    receivedAmountCents: resolveReceivedAmountCents({
      reported: reportedReceived,
      amountCents,
      statusText,
      receivedDate,
      cancelled
    }),
    receivedDate,
    categoryCode: pickFirst(raw.codigo_categoria, raw.codigoCategoria),
    observation: pickFirst(raw.observacao),
    cancelled
  };
}

/**
 * Converte o titulo em adiantamento. Retorna null quando o titulo esta fora das
 * categorias de adiantamento, nao tem cliente, ou ainda nao foi recebido — nesse
 * caso o cliente prometeu, mas nao depositou, e nada pode ser abatido.
 */
export function toCustomerAdvance(
  title: OmieReceivableTitle,
  advanceCategoryCodes: ReadonlySet<string>
): OmieCustomerAdvance | null {
  if (title.customerOmieCode === null) return null;
  if (!title.categoryCode || !advanceCategoryCodes.has(title.categoryCode)) return null;
  if (!title.cancelled && title.receivedAmountCents <= 0) return null;

  return {
    titleId: title.id,
    integrationCode: title.integrationCode,
    customerOmieCode: title.customerOmieCode,
    amountCents: title.cancelled ? 0 : title.receivedAmountCents,
    issueDate: title.issueDate,
    receivedDate: title.receivedDate,
    categoryCode: title.categoryCode,
    documentNumber: title.documentNumber,
    observation: title.observation,
    cancelled: title.cancelled
  };
}

/** Mapeia uma pagina inteira de ListarContasReceber para adiantamentos. */
export function mapAdvancesFromReceivables(
  rows: ReadonlyArray<OmieReceivableRaw>,
  advanceCategoryCodes: ReadonlySet<string>
): OmieCustomerAdvance[] {
  const advances: OmieCustomerAdvance[] = [];
  for (const raw of rows) {
    const title = mapOmieReceivableRaw(raw);
    if (!title) continue;
    const advance = toCustomerAdvance(title, advanceCategoryCodes);
    if (advance) advances.push(advance);
  }
  return advances;
}

/**
 * Valor recebido do titulo. O ListarContasReceber nem sempre traz o valor
 * baixado: quando o status diz que o titulo foi liquidado (ou ha data de
 * pagamento) sem valor explicito, o recebido e o proprio valor do documento.
 */
function resolveReceivedAmountCents(input: {
  reported: number;
  amountCents: number;
  statusText: string;
  receivedDate: string | null;
  cancelled: boolean;
}): number {
  if (input.cancelled) return 0;
  if (input.reported > 0) return input.reported;
  const settled =
    SETTLED_STATUSES.some((status) => input.statusText.includes(status)) ||
    input.receivedDate !== null;
  return settled ? input.amountCents : 0;
}

/** "dd/mm/aaaa" (OMIE) para "yyyy-mm-dd" (ISO). */
export function parseOmieDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** "yyyy-mm-dd" (ISO) para "dd/mm/aaaa" (OMIE). */
export function formatOmieDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
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
