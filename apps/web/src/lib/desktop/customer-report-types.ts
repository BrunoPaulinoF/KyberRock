/**
 * Tipos do relatorio por cliente, copiados de `apps/desktop/src/services/customer-report.ts`.
 *
 * O montador do documento (`customer-report-render.ts`, copia do desktop) importa estes nomes;
 * o site nao pode importar o workspace do desktop (que le o SQLite), entao os tipos moram
 * aqui com os MESMOS nomes e formatos, e `lib/customer-report.ts` monta os mesmos objetos a
 * partir da nuvem. Mudou la, mude aqui: um campo que falte deixa o PDF/planilha do site
 * diferente do da balanca.
 */

import type { FreightModality } from "./freight.js";

export type CustomerReportVariant = "simplified" | "complete";

export const CUSTOMER_REPORT_VARIANTS: readonly CustomerReportVariant[] = [
  "simplified",
  "complete"
];

export function isCustomerReportVariant(value: unknown): value is CustomerReportVariant {
  return value === "simplified" || value === "complete";
}

export interface CustomerReportOption {
  id: string;
  name: string;
  document: string | null;
}

export interface CustomerReportCustomer {
  id: string;
  legalName: string;
  tradeName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  creditLimitCents: number | null;
  openReceivablesCents: number;
  omieCustomerId: number | null;
  defaultPaymentTermName: string | null;
  defaultCarrierName: string | null;
}

export interface CustomerReportOperation {
  id: string;
  /**
   * Numero do CUPOM (`operation_code`, o "COD" impresso no vale que saiu com o motorista).
   * E por ele que o cliente acha a carga no maco de papel que ele guardou — o `id` desta
   * lista nao existe fora do sistema, e o pedido/nota do OMIE so aparecem depois do
   * faturamento. Null nas operacoes antigas, anteriores a numeracao do cupom.
   */
  couponNumber: number | null;
  date: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  operationType: "invoice" | "internal";
  operationTypeLabel: string;
  cancelled: boolean;
  cancelReason: string | null;
  productCode: string | null;
  productDescription: string;
  productUnit: string | null;
  plate: string;
  vehicleDescription: string | null;
  driverName: string;
  driverDocument: string | null;
  carrierName: string | null;
  carrierDocument: string | null;
  freightModality: FreightModality;
  freightModalityLabel: string;
  freightRuleName: string | null;
  freightDestination: string | null;
  freightDistanceKm: number | null;
  freightTotalCents: number;
  entryWeightKg: number | null;
  exitWeightKg: number | null;
  netWeightKg: number;
  entryAt: string | null;
  exitAt: string | null;
  minutesInside: number | null;
  unitPriceCents: number | null;
  baseUnitPriceCents: number | null;
  priceTableName: string | null;
  priceSavingsPercent: number | null;
  productTotalCents: number;
  totalCents: number;
  paymentMethodName: string | null;
  paymentTermName: string | null;
  installments: number | null;
  downPaymentCents: number | null;
  omieSalesOrderId: number | null;
  /**
   * Codigo interno da ORDEM DE SERVICO no OMIE — o documento da venda interna, que emite
   * NFS-e em vez de NF-e. Vem junto do pedido para a tela saber por quais cargas ainda
   * falta perguntar o numero da nota, sem tratar a interna como se nao tivesse documento.
   */
  omieServiceOrderId: number | null;
  /**
   * Numero da NOTA FISCAL emitida no OMIE — o que o cliente pede quando confere a fatura,
   * e o unico numero desta lista que existe fora do KyberRock e fora do OMIE.
   *
   * Diferente do `omieSalesOrderId`, que e o codigo INTERNO do pedido e nao acha nada na
   * busca do OMIE. Null enquanto a nota nao saiu.
   */
  omieInvoiceNumber: string | null;
  omieBillingStatus: string | null;
  omieBilledAt: string | null;
  omieDocumentUrl: string | null;
  cloudSyncedAt: string | null;
  omieSyncedAt: string | null;
}

export interface CustomerReportTotals {
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number;
  avgTicketCents: number;
  avgNetWeightKg: number;
  invoiceOperations: number;
  internalOperations: number;
  cancelledOperations: number;
  cancelledNetWeightKg: number;
  firstOperationDate: string | null;
  lastOperationDate: string | null;
}

export interface CustomerReportProductRow {
  productCode: string | null;
  productDescription: string;
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number;
  /** Dias distintos (YYYY-MM-DD, em ordem) em que o cliente carregou esse material. */
  dates: string[];
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Um material num dia: quanto o cliente carregou daquele material naquela data. E o
 * detalhe por tras da tabela de produtos — a resposta para "o que ele levou, quanto e
 * em que dias".
 */
export interface CustomerReportProductDayRow {
  date: string;
  productCode: string | null;
  productDescription: string;
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number;
}

export interface CustomerReportPlateRow {
  plate: string;
  driverName: string | null;
  carrierName: string | null;
  operations: number;
  netWeightKg: number;
  totalCents: number;
  totalMinutes: number;
  avgMinutes: number;
  lastOperationAt: string | null;
}

export interface CustomerReportCarrierRow {
  carrierName: string;
  carrierDocument: string | null;
  operations: number;
  netWeightKg: number;
  freightCents: number;
  plates: string[];
}

export interface CustomerReportPaymentRow {
  name: string;
  operations: number;
  netWeightKg: number;
  totalCents: number;
}

export interface CustomerReportPeriodRow {
  period: string;
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

/**
 * Situacao do vencimento em relacao ao dia de referencia (hoje). A BAIXA (pagamento
 * efetivo) e controlada no OMIE, nao aqui — "vencida" significa apenas que a data ja
 * passou, nao que o cliente esta inadimplente.
 */
export type CustomerReportInstallmentSituation = "overdue" | "today" | "upcoming";

export interface CustomerReportInstallment {
  operationId: string;
  /** Data da operacao que originou a parcela (saida da balanca, ou criacao). */
  operationDate: string;
  /** Data de vencimento calculada (YYYY-MM-DD). */
  dueDate: string;
  /** Numero da parcela dentro da operacao (1-based) e o total de parcelas dela. */
  number: number;
  installmentCount: number;
  amountCents: number;
  situation: CustomerReportInstallmentSituation;
  /** Dias ate o vencimento (negativo quando ja venceu). */
  daysUntilDue: number;
  productDescription: string;
  plate: string;
  paymentTermName: string | null;
  paymentMethodName: string | null;
  omieSalesOrderId: number | null;
}

export interface CustomerReportInstallmentMonthRow {
  period: string;
  installments: number;
  amountCents: number;
}

export interface CustomerReportInstallmentTotals {
  installments: number;
  amountCents: number;
  overdueInstallments: number;
  overdueCents: number;
  upcomingInstallments: number;
  upcomingCents: number;
  nextDueDate: string | null;
  nextDueCents: number;
}

export interface CustomerReport {
  customer: CustomerReportCustomer;
  startDate: string;
  endDate: string;
  periodLabel: string | null;
  totals: CustomerReportTotals;
  byProduct: CustomerReportProductRow[];
  /** O mesmo agrupamento por material aberto dia a dia, na ordem dos materiais. */
  byProductDay: CustomerReportProductDayRow[];
  byPlate: CustomerReportPlateRow[];
  /**
   * As mesmas operacoes de `operations`, so que na ordem de placa/motorista: as viagens
   * de cada motorista saem juntas e em sequencia. E o detalhe da tabela de placas, como
   * `byProductDay` e o detalhe da tabela de produtos.
   */
  tripsByPlate: CustomerReportOperation[];
  byCarrier: CustomerReportCarrierRow[];
  byPaymentMethod: CustomerReportPaymentRow[];
  byPaymentTerm: CustomerReportPaymentRow[];
  byFreightModality: CustomerReportPaymentRow[];
  byDay: CustomerReportPeriodRow[];
  byMonth: CustomerReportPeriodRow[];
  operations: CustomerReportOperation[];
  cancelledOperations: CustomerReportOperation[];
  /**
   * Parcelas com vencimento DENTRO do periodo, vindas de operacoes de qualquer data
   * (inclusive anteriores ao periodo). E o que permite pedir um periodo futuro e ver
   * os dias em que o cliente ainda tem parcelas a pagar.
   */
  installments: CustomerReportInstallment[];
  installmentsByMonth: CustomerReportInstallmentMonthRow[];
  installmentTotals: CustomerReportInstallmentTotals;
  /** Dia usado para classificar vencida/hoje/a vencer. */
  referenceDate: string;
}

/** Uma linha por cliente no resumo do periodo (ver `CustomersOverview`). */
export interface CustomersOverviewRow {
  customer: CustomerReportCustomerKey;
  totals: CustomerReportTotals;
  installmentTotals: CustomerReportInstallmentTotals;
  /**
   * O que esse cliente carregou de cada material no periodo, com os dias de cada um —
   * as mesmas linhas que sairiam no relatorio individual dele.
   */
  byProduct: CustomerReportProductRow[];
}

/**
 * Resumo comparativo de TODOS os clientes no periodo: um cliente por linha, do que mais
 * faturou para o que menos faturou.
 *
 * Sai dos mesmos carregamentos do relatorio individual (`getCustomerReport`), so que sem
 * filtrar o cliente — a linha de um cliente aqui bate numero a numero com o relatorio
 * dele, em vez de ser uma segunda contagem que pode divergir.
 */
export interface CustomersOverview {
  startDate: string;
  endDate: string;
  periodLabel: string | null;
  /** Dia usado para classificar vencida/hoje/a vencer. */
  referenceDate: string;
  customers: CustomersOverviewRow[];
  totals: CustomerReportTotals;
  installmentTotals: CustomerReportInstallmentTotals;
}

/**
 * Cliente dono das operacoes/parcelas carregadas. Sai junto das linhas para o resumo de
 * "todos os clientes" agrupar sem uma segunda ida ao banco. `id` nulo e a operacao que
 * ficou sem cliente vinculado — ela some do relatorio individual (nao ha quem escolher),
 * mas precisa aparecer no resumo para os totais baterem com os do periodo.
 */
export interface CustomerReportCustomerKey {
  id: string | null;
  name: string;
  document: string | null;
}
