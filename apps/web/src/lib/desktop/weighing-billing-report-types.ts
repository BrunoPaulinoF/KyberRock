import type { WeighingBillingSituation } from "./weighing-billing-situation.js";

/**
 * Os tipos que `weighing-billing-report-render.ts` le — copiados das declaracoes de
 * `apps/desktop/src/services/weighing-billing-report.ts`, que no desktop moram junto do servico
 * do SQLite. Mesmos nomes e mesmos campos: o site monta o relatorio da nuvem neste formato
 * (`lib/billing-conference.ts`) e o renderizador copiado do desktop gera o MESMO documento.
 *
 * Mudou la, mude aqui: o `tsc` do site acusa quando o renderizador passa a ler um campo que
 * este arquivo nao tem.
 */

/** Uma pesagem fechada do periodo. */
export interface WeighingBillingRow {
  operationId: string;
  /** Numero sequencial da operacao mostrado ao operador (`operation_code`). */
  operationCode: number | null;
  /**
   * Data da operacao: o dia em que ela FECHOU, a mesma base dos demais relatorios e a mesma
   * que o OMIE usa na emissao do pedido.
   */
  date: string;
  /** Saida da balanca — quando a pesagem de fato fechou. Null nas operacoes antigas. */
  closedAt: string | null;
  customerId: string | null;
  customerName: string;
  customerDocument: string | null;
  productCode: string | null;
  productDescription: string;
  plate: string;
  netWeightKg: number;
  unitPriceCents: number | null;
  /** Unidade do preco aplicado ("ton" / "kg"), para conferir o preco unitario. */
  priceUnit: string | null;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  operationType: "invoice" | "internal";
  operationTypeLabel: string;
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
  /**
   * Numero do pedido/OS como ele aparece DENTRO do OMIE. Os dois campos acima sao o codigo
   * interno da API; e este que se digita na busca do OMIE para achar o documento.
   */
  omieOrderNumber: string | null;
  /** Numero da NOTA FISCAL emitida no OMIE. Null enquanto a nota nao saiu. */
  omieInvoiceNumber: string | null;
  omieBilledAt: string | null;
  situation: WeighingBillingSituation;
  situationLabel: string;
  /** O motivo gravado pelo OMIE, quando ha — e o que explica uma pesagem parada. */
  situationDetail: string | null;
}

export interface WeighingBillingTotals {
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

/** Uma situacao de faturamento e o quanto ela representa no periodo. */
export interface WeighingBillingSituationRow {
  situation: WeighingBillingSituation;
  label: string;
  operations: number;
  netWeightKg: number;
  totalCents: number;
}

export interface WeighingBillingReport {
  startDate: string;
  endDate: string;
  periodLabel: string | null;
  rows: WeighingBillingRow[];
  totals: WeighingBillingTotals;
  /** Uma linha por situacao presente no periodo, da mais critica para a resolvida. */
  bySituation: WeighingBillingSituationRow[];
  /** Tudo que NAO esta faturado (`situation !== "billed"`). */
  unbilled: WeighingBillingTotals;
  /** Filtros aplicados, para o documento exportado dizer o que ele mostra. */
  filters: WeighingBillingFilters;
}

export interface WeighingBillingFilters {
  customerId: string | null;
  situations: WeighingBillingSituation[];
  search: string | null;
}
