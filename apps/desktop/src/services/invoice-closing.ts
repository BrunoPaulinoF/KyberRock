import type { DesktopDatabase } from "../database/sqlite.js";
import { computeCreditInvoiceSchedule, creditClosingConfigFromCustomer } from "./credit-invoice.js";
import type { CreditClosingConfig } from "./credit-invoice.js";
import {
  resolveSituation,
  resolveSituationDetail,
  WEIGHING_BILLING_SITUATION_LABEL
} from "./weighing-billing-situation.js";
import type { WeighingBillingSituation } from "./weighing-billing-situation.js";
import { CLOSED_OPERATION_STATUS_SQL_LIST } from "./weighing-operations.js";
import { INVOICE_CLOSING_CYCLE_LABEL, isInvoiceClosingCycle } from "./invoice-closing-cycle.js";
import type { InvoiceClosingCycle } from "./invoice-closing-cycle.js";

/**
 * Fechamento de faturas: a fatura de TODOS os clientes de um ciclo, de uma vez.
 *
 * O relatorio por cliente ja existia e responde "quanto este cliente comprou". A pergunta
 * do fechamento e outra: "quais clientes fecham quinzenal, e quanto cada um deve nesta
 * quinzena?". Sem ela a atendente abria cliente por cliente da lista inteira, sem nunca
 * saber se tinha esquecido algum — e esquecer um cliente no fechamento e nao cobrar o mes.
 *
 * O CICLO nao e escolhido aqui: vem da "Periodicidade do fechamento" do cadastro do
 * cliente (`credit_periodicity`), que ja e Mensal/Quinzenal/Semanal na tela de Cadastros.
 * Ou seja, o mesmo campo que define quando o credito do cliente fecha define em qual
 * fechamento ele aparece — dois lugares dizendo a mesma coisa acabariam divergindo.
 *
 * A conta de QUANDO fecha e QUANDO vence e a de `credit-invoice.ts`, ja testada e ja usada
 * pela fatura de fiado: cada pesagem cai no PROXIMO fechamento na data dela ou depois, e o
 * vencimento e o prazo de boleto daquele fechamento. Por isso uma quinzena pode devolver
 * duas faturas do mesmo cliente (a que fechou dia 1 e a que fechou dia 16), cada uma com o
 * seu vencimento — que e exatamente como a cobranca sai.
 *
 * Escopo igual ao dos demais relatorios (`ReportService`, `CustomerReportService`,
 * `WeighingBillingReportService`): operacoes CONCLUIDAS da unidade, sem as excluidas e sem
 * as canceladas, no intervalo de `date(created_at)`. Manter a mesma base de data e o mesmo
 * conjunto de status e o que faz o total daqui bater com o dos outros.
 *
 * O boleto NAO sai daqui: quem emite e o OMIE, a partir do pedido que o KyberRock ja
 * mandou. Este documento e a conferencia que acompanha a cobranca — a lista de tudo que
 * entrou na fatura, com nota, vale, placa e transportador linha a linha.
 */

/** Uma pesagem dentro da fatura — a linha que a atendente confere. */
export interface InvoiceClosingLine {
  operationId: string;
  /**
   * O cliente da pesagem, repetido em cada linha.
   *
   * Dentro da fatura ele e obvio — e o do titulo. Ele existe aqui para a lista "pesagem a
   * pesagem", que mistura os clientes todos numa tabela so: sem a coluna, uma linha
   * solta nao diria de quem e a carga.
   */
  customerId: string;
  customerName: string;
  customerDocument: string | null;
  /**
   * Numero do VALE: o codigo do cupom que saiu com o motorista (`operation_code`, o "COD"
   * impresso). E por ele que o cliente contesta uma carga, entao e ele que tem de estar na
   * fatura.
   */
  couponNumber: number | null;
  /** Data da operacao (`created_at`), a mesma base dos demais relatorios. */
  date: string;
  /** Saida da balanca — quando a pesagem de fato fechou. Null nas operacoes antigas. */
  closedAt: string | null;
  /**
   * O fechamento em que esta carga caiu, e o vencimento dele.
   *
   * Repetidos na linha porque a lista "pesagem a pesagem" mistura as faturas todas: sem
   * eles, uma carga solta nao diria em qual fatura foi cobrada — que e justamente o que se
   * quer saber quando o cliente contesta.
   */
  closingDate: string;
  dueDate: string;
  /** Numero da nota fiscal emitida no OMIE; null enquanto a nota nao saiu. */
  invoiceNumber: string | null;
  /** Numero VISIVEL do pedido/OS no OMIE — o equivalente ao "orcamento" do sistema antigo. */
  omieOrderNumber: string | null;
  /**
   * Codigos INTERNOS do documento no OMIE. Nao sao o numero que se digita na busca de la
   * (esse e o `omieOrderNumber`), mas sao o que diz se a pesagem chegou ao OMIE como pedido
   * de venda ou como ordem de servico — a diferenca entre a venda com nota e a interna.
   */
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
  plate: string;
  carrierName: string;
  driverName: string;
  /** Codigo do produto no cadastro, quando ha — e por ele que o produto e conferido. */
  productCode: string | null;
  productDescription: string;
  netWeightKg: number;
  /** Preco aplicado na pesagem, e a unidade dele ("ton" / "kg"), para conferir a conta. */
  unitPriceCents: number | null;
  priceUnit: string | null;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  operationType: "invoice" | "internal";
  operationTypeLabel: string;
  situation: WeighingBillingSituation;
  situationLabel: string;
  /** O motivo gravado pelo OMIE, quando ha — e o que explica uma pesagem parada. */
  situationDetail: string | null;
}

export interface InvoiceClosingTotals {
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

/** A fatura de um cliente num fechamento. */
export interface InvoiceClosingInvoice {
  customerId: string;
  customerName: string;
  customerDocument: string | null;
  /**
   * A placa que separa esta fatura, ou null quando a fatura e a do cliente inteiro.
   *
   * So vem preenchida com o filtro de placas em uso: sem ele o fechamento continua sendo um
   * por cliente, que e como a cobranca sai. Com placas escolhidas, o mesmo cliente rende uma
   * fatura por caminhao — que e como o acerto de quem leva a carga e conferido.
   */
  plate: string | null;
  cycle: InvoiceClosingCycle;
  cycleLabel: string;
  /** Data em que a fatura fecha (YYYY-MM-DD). */
  closingDate: string;
  /** Vencimento do boleto daquele fechamento (YYYY-MM-DD). */
  dueDate: string;
  lines: InvoiceClosingLine[];
  totals: InvoiceClosingTotals;
  /** Pesagens da fatura que ainda estao sem nota fiscal emitida no OMIE. */
  operationsWithoutInvoice: number;
}

/** Uma placa dentro do resumo do transportador. */
export interface InvoiceClosingPlateRow {
  plate: string;
  trips: number;
  netWeightKg: number;
  freightCents: number;
  totalCents: number;
}

/**
 * O transportador e as placas dele no periodo.
 *
 * Existe porque o pagamento do transportador e feito EM CIMA do mesmo fechamento: a
 * atendente fecha a fatura do cliente e, com as mesmas viagens, acerta com quem levou.
 * Ter os dois no mesmo documento evita a segunda passada manual pela mesma lista.
 */
export interface InvoiceClosingCarrierRow {
  carrierName: string;
  trips: number;
  netWeightKg: number;
  freightCents: number;
  totalCents: number;
  plates: InvoiceClosingPlateRow[];
}

/**
 * Cliente com movimento no periodo que NAO entrou em fechamento nenhum, por nao ter
 * periodicidade definida no cadastro.
 *
 * Aparece no relatorio de proposito: um fechamento que simplesmente omite o cliente sem
 * dizer nada e pior que um fechamento vazio — a atendente so descobriria o buraco quando o
 * cliente deixasse de ser cobrado.
 */
export interface InvoiceClosingPendingCustomer {
  customerId: string;
  customerName: string;
  operations: number;
  totalCents: number;
}

export interface InvoiceClosingFilters {
  cycles: InvoiceClosingCycle[];
  customerId: string | null;
  /** Placas escolhidas, ja normalizadas. Vazio e "todas", com a fatura inteira do cliente. */
  plates: string[];
  search: string | null;
}

export interface InvoiceClosingReport {
  startDate: string;
  endDate: string;
  periodLabel: string | null;
  filters: InvoiceClosingFilters;
  /** Uma fatura por (cliente, fechamento), do fechamento mais antigo para o mais novo. */
  invoices: InvoiceClosingInvoice[];
  /**
   * As MESMAS pesagens das faturas, numa lista so, na ordem em que foram feitas.
   *
   * As faturas respondem "quanto cada cliente deve"; esta lista responde a pergunta de
   * conferencia — "cade a carga tal?" —, que numa tela dividida em blocos por cliente
   * obrigaria a abrir fatura por fatura ate achar. E tambem a forma que se filtra e soma
   * na planilha: uma tabela unica com a coluna do cliente, e nao um bloco por cliente.
   */
  rows: InvoiceClosingLine[];
  totals: InvoiceClosingTotals;
  /** Quantos clientes distintos entraram no fechamento. */
  customers: number;
  /** Tudo que entrou na fatura mas ainda esta sem nota emitida no OMIE. */
  withoutInvoice: InvoiceClosingTotals;
  byCarrier: InvoiceClosingCarrierRow[];
  pendingSetup: InvoiceClosingPendingCustomer[];
  /**
   * Todas as placas que rodaram no periodo, para o filtro da tela.
   *
   * Sai de proposito de ANTES do filtro de placa: se a lista viesse do resultado ja
   * filtrado, escolher uma placa apagaria as outras da tela e nao haveria como marcar a
   * segunda. O que a encolhe e o periodo, o cliente e a busca — nao a propria selecao.
   */
  availablePlates: string[];
}

export interface InvoiceClosingOptions {
  /** Vazio (ou ausente) traz todos os ciclos configurados. */
  cycles?: InvoiceClosingCycle[] | null;
  customerId?: string | null;
  /**
   * Placas escolhidas. Vazio (ou ausente) traz todas as placas, com uma fatura por cliente;
   * com placas escolhidas, o fechamento sai separado por placa.
   */
  plates?: string[] | null;
  /** Busca livre por cliente, placa, transportador, nota, vale ou pedido. */
  search?: string | null;
  periodLabel?: string | null;
}

interface InvoiceClosingSourceRow {
  id: string;
  operation_code: number | null;
  created_at: string;
  exit_at: string | null;
  operation_type: "invoice" | "internal";
  customer_id: string;
  customer_trade_name: string | null;
  customer_legal_name: string | null;
  customer_document: string | null;
  credit_account_enabled: number;
  credit_periodicity: string;
  credit_closing_day: number | null;
  credit_boleto_days: number | null;
  credit_second_closing_day: number | null;
  credit_second_boleto_days: number | null;
  credit_closing_weekday: number | null;
  product_code: string | null;
  product_description: string | null;
  plate: string | null;
  carrier_name: string | null;
  driver_name: string | null;
  net_weight_kg: number | null;
  unit_price_cents: number | null;
  price_unit: string | null;
  product_total_cents: number | null;
  freight_total_cents: number | null;
  total_cents: number | null;
  omie_sales_order_id: number | null;
  omie_service_order_id: number | null;
  omie_order_number: string | null;
  omie_invoice_number: string | null;
  omie_billing_status: string | null;
  omie_billing_message: string | null;
}

export class InvoiceClosingService {
  constructor(private readonly db: DesktopDatabase) {}

  getReport(
    startDate: string,
    endDate: string,
    unitId: string,
    options: InvoiceClosingOptions = {}
  ): InvoiceClosingReport {
    const customerId = options.customerId ?? null;
    // Ciclo vazio e "todos": um filtro que zera a lista quando ninguem escolheu nada
    // pareceria uma quinzena sem movimento.
    const cycles = (options.cycles ?? []).filter(isInvoiceClosingCycle);
    const search = (options.search ?? "").trim();
    // Placa vazia e "todas", pelo mesmo motivo do ciclo. E, so quando ha placa escolhida, o
    // fechamento passa a sair separado por placa.
    const plates = normalizePlateList(options.plates ?? []);
    const selectedPlates = new Set(plates);
    const splitByPlate = plates.length > 0;

    const sourceRows = this.loadRows(startDate, endDate, unitId, customerId);

    const invoices = new Map<string, InvoiceClosingInvoice>();
    const pending = new Map<string, InvoiceClosingPendingCustomer>();
    const lines: InvoiceClosingLine[] = [];
    const carrierRows: Array<{ line: InvoiceClosingLine; carrierName: string }> = [];
    const availablePlates = new Set<string>();

    for (const row of sourceRows) {
      const line = mapLine(row);
      if (!matchesSearch(line, row, search)) continue;

      // Antes do filtro de placa: a lista de opcoes da tela nao pode encolher a cada placa
      // marcada, senao nao haveria como marcar a segunda.
      const plate = normalizePlate(line.plate);
      availablePlates.add(plate);
      if (splitByPlate && !selectedPlates.has(plate)) continue;

      const config = closingConfigFor(row);
      if (!config) {
        addPending(pending, row, line);
        continue;
      }
      if (cycles.length > 0 && !cycles.includes(config.periodicity)) continue;

      const schedule = computeCreditInvoiceSchedule(config, parseIsoDate(line.date));
      line.closingDate = schedule.closingDate;
      line.dueDate = schedule.dueDate;
      const key = splitByPlate
        ? `${row.customer_id}|${schedule.closingDate}|${plate}`
        : `${row.customer_id}|${schedule.closingDate}`;
      const invoice = invoices.get(key) ?? {
        customerId: row.customer_id,
        customerName: customerName(row),
        customerDocument: row.customer_document,
        plate: splitByPlate ? plate : null,
        cycle: config.periodicity,
        cycleLabel: INVOICE_CLOSING_CYCLE_LABEL[config.periodicity],
        closingDate: schedule.closingDate,
        dueDate: schedule.dueDate,
        lines: [],
        totals: emptyTotals(),
        operationsWithoutInvoice: 0
      };
      invoice.lines.push(line);
      if (!line.invoiceNumber) invoice.operationsWithoutInvoice += 1;
      invoices.set(key, invoice);

      lines.push(line);
      carrierRows.push({ line, carrierName: line.carrierName });
    }

    const orderedInvoices = [...invoices.values()]
      .map((invoice) => ({ ...invoice, totals: buildTotals(invoice.lines) }))
      .sort(
        (a, b) =>
          a.closingDate.localeCompare(b.closingDate) ||
          a.customerName.localeCompare(b.customerName, "pt-BR") ||
          (a.plate ?? "").localeCompare(b.plate ?? "", "pt-BR")
      );

    return {
      startDate,
      endDate,
      periodLabel: options.periodLabel ?? null,
      filters: { cycles, customerId, plates, search: search || null },
      invoices: orderedInvoices,
      rows: lines,
      totals: buildTotals(lines),
      customers: new Set(orderedInvoices.map((invoice) => invoice.customerId)).size,
      withoutInvoice: buildTotals(lines.filter((line) => !line.invoiceNumber)),
      byCarrier: groupByCarrier(carrierRows),
      pendingSetup: [...pending.values()].sort((a, b) => b.totalCents - a.totalCents),
      availablePlates: [...availablePlates].sort((a, b) => a.localeCompare(b, "pt-BR"))
    };
  }

  private loadRows(
    startDate: string,
    endDate: string,
    unitId: string,
    customerId: string | null
  ): InvoiceClosingSourceRow[] {
    return this.db
      .prepare(
        `SELECT
           o.id, o.operation_code, o.created_at,
           o.exit_weight_captured_at as exit_at,
           o.operation_type, o.customer_id,
           cust.trade_name as customer_trade_name,
           COALESCE(cust.legal_name, o.remote_customer_name) as customer_legal_name,
           cust.document as customer_document,
           cust.credit_account_enabled, cust.credit_periodicity,
           cust.credit_closing_day, cust.credit_boleto_days,
           cust.credit_second_closing_day, cust.credit_second_boleto_days,
           cust.credit_closing_weekday,
           p.code as product_code,
           COALESCE(p.description, o.remote_product_description) as product_description,
           COALESCE(v.plate, o.remote_plate) as plate,
           -- A transportadora da operacao manda; sem ela, a do cadastro do veiculo, que e
           -- de quem o caminhao e quando ninguem escolheu nada na balanca.
           COALESCE(crr.name, vcrr.name) as carrier_name,
           COALESCE(d.name, o.remote_driver_name) as driver_name,
           o.net_weight_kg, o.unit_price_cents, o.price_unit,
           o.product_total_cents, o.freight_total_cents, o.total_cents,
           o.omie_sales_order_id, o.omie_service_order_id, o.omie_order_number,
           o.omie_invoice_number, o.omie_billing_status, o.omie_billing_message
         FROM weighing_operations o
         JOIN customers cust ON cust.id = o.customer_id
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN vehicles v ON v.id = o.vehicle_id
         LEFT JOIN drivers d ON d.id = o.driver_id
         LEFT JOIN carriers crr ON crr.id = o.carrier_id
         LEFT JOIN carriers vcrr ON vcrr.id = v.carrier_id
         WHERE o.unit_id = ?
           AND (? IS NULL OR o.customer_id = ?)
           AND o.deleted_at IS NULL
           AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
           AND date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
         ORDER BY o.created_at ASC, o.operation_code ASC`
      )
      .all(unitId, customerId, customerId, startDate, endDate) as InvoiceClosingSourceRow[];
  }
}

function mapLine(row: InvoiceClosingSourceRow): InvoiceClosingLine {
  const situation = resolveSituation(row);
  return {
    operationId: row.id,
    customerId: row.customer_id,
    customerName: customerName(row),
    customerDocument: row.customer_document,
    couponNumber: row.operation_code,
    date: row.created_at.slice(0, 10),
    closedAt: row.exit_at,
    // Preenchidos quando a linha entra numa fatura: e o fechamento que decide as duas datas.
    closingDate: "",
    dueDate: "",
    invoiceNumber: (row.omie_invoice_number ?? "").trim() || null,
    omieOrderNumber: (row.omie_order_number ?? "").trim() || null,
    omieSalesOrderId: row.omie_sales_order_id,
    omieServiceOrderId: row.omie_service_order_id,
    plate: (row.plate ?? "").trim() || "SEM PLACA",
    carrierName: (row.carrier_name ?? "").trim() || "Sem transportadora",
    driverName: (row.driver_name ?? "").trim() || "-",
    productCode: (row.product_code ?? "").trim() || null,
    productDescription: (row.product_description ?? "").trim() || "N/A",
    netWeightKg: row.net_weight_kg ?? 0,
    unitPriceCents: row.unit_price_cents,
    priceUnit: row.price_unit,
    productTotalCents: row.product_total_cents ?? 0,
    freightTotalCents: row.freight_total_cents ?? 0,
    totalCents: row.total_cents ?? 0,
    operationType: row.operation_type,
    operationTypeLabel: row.operation_type === "internal" ? "Interna" : "Com nota",
    situation,
    situationLabel: WEIGHING_BILLING_SITUATION_LABEL[situation],
    situationDetail: resolveSituationDetail(row, situation)
  };
}

/**
 * A placa como o filtro compara e como a tela lista: sem espacos e em maiuscula.
 *
 * A mesma placa digitada com espaco ou em minuscula em cadastros diferentes viraria duas
 * opcoes na lista — e escolher uma delas deixaria metade das viagens de fora do fechamento.
 */
export function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase();
}

/** As placas escolhidas, normalizadas, sem vazias e sem repetidas. */
export function normalizePlateList(plates: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const plate of plates) {
    if (typeof plate !== "string") continue;
    const normalized = normalizePlate(plate);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function customerName(row: InvoiceClosingSourceRow): string {
  return (
    (row.customer_trade_name ?? "").trim() ||
    (row.customer_legal_name ?? "").trim() ||
    "Sem cliente"
  );
}

/**
 * A configuracao de fechamento do cliente, ou null quando ele nao tem uma.
 *
 * Reusa `creditClosingConfigFromCustomer` de proposito: o dia em que a fatura fecha e o
 * prazo do boleto sao os MESMOS que a fatura de fiado usa. Duas leituras diferentes do
 * mesmo cadastro dariam duas datas de vencimento para a mesma cobranca.
 */
function closingConfigFor(row: InvoiceClosingSourceRow): CreditClosingConfig | null {
  const periodicity = isInvoiceClosingCycle(row.credit_periodicity)
    ? row.credit_periodicity
    : "monthly";
  return creditClosingConfigFromCustomer({
    creditAccountEnabled: row.credit_account_enabled === 1,
    creditPeriodicity: periodicity,
    creditClosingDay: row.credit_closing_day,
    creditBoletoDays: row.credit_boleto_days,
    creditSecondClosingDay: row.credit_second_closing_day,
    creditSecondBoletoDays: row.credit_second_boleto_days,
    creditClosingWeekday: row.credit_closing_weekday
  });
}

function addPending(
  pending: Map<string, InvoiceClosingPendingCustomer>,
  row: InvoiceClosingSourceRow,
  line: InvoiceClosingLine
): void {
  const entry = pending.get(row.customer_id) ?? {
    customerId: row.customer_id,
    customerName: customerName(row),
    operations: 0,
    totalCents: 0
  };
  entry.operations += 1;
  entry.totalCents += line.totalCents;
  pending.set(row.customer_id, entry);
}

/**
 * Data local a partir do `YYYY-MM-DD` da operacao.
 *
 * `new Date("2026-07-16")` seria lida como MEIA-NOITE UTC e, num fuso a oeste, voltaria
 * como dia 15 — jogando a pesagem do dia 16 para o fechamento anterior. O construtor por
 * partes nao tem essa armadilha, e e o mesmo que `credit-invoice.ts` espera.
 */
function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** Busca livre por cliente, placa, transportador, motorista, produto, nota, vale ou pedido. */
function matchesSearch(
  line: InvoiceClosingLine,
  row: InvoiceClosingSourceRow,
  search: string
): boolean {
  if (!search) return true;
  const term = search.toLowerCase();
  return [
    line.customerName,
    row.customer_document ?? "",
    line.plate,
    line.carrierName,
    line.driverName,
    line.productDescription,
    line.invoiceNumber ?? "",
    line.omieOrderNumber ?? "",
    line.couponNumber === null ? "" : String(line.couponNumber)
  ].some((field) => field.toLowerCase().includes(term));
}

function emptyTotals(): InvoiceClosingTotals {
  return { operations: 0, netWeightKg: 0, productCents: 0, freightCents: 0, totalCents: 0 };
}

export function buildTotals(lines: readonly InvoiceClosingLine[]): InvoiceClosingTotals {
  return {
    operations: lines.length,
    netWeightKg: sum(lines, (line) => line.netWeightKg),
    productCents: sum(lines, (line) => line.productTotalCents),
    freightCents: sum(lines, (line) => line.freightTotalCents),
    totalCents: sum(lines, (line) => line.totalCents)
  };
}

function groupByCarrier(
  entries: ReadonlyArray<{ line: InvoiceClosingLine; carrierName: string }>
): InvoiceClosingCarrierRow[] {
  const carriers = new Map<
    string,
    InvoiceClosingCarrierRow & { byPlate: Map<string, InvoiceClosingPlateRow> }
  >();

  for (const { line, carrierName: name } of entries) {
    const carrier = carriers.get(name) ?? {
      carrierName: name,
      trips: 0,
      netWeightKg: 0,
      freightCents: 0,
      totalCents: 0,
      plates: [],
      byPlate: new Map<string, InvoiceClosingPlateRow>()
    };
    carrier.trips += 1;
    carrier.netWeightKg += line.netWeightKg;
    carrier.freightCents += line.freightTotalCents;
    carrier.totalCents += line.totalCents;

    const plate = carrier.byPlate.get(line.plate) ?? {
      plate: line.plate,
      trips: 0,
      netWeightKg: 0,
      freightCents: 0,
      totalCents: 0
    };
    plate.trips += 1;
    plate.netWeightKg += line.netWeightKg;
    plate.freightCents += line.freightTotalCents;
    plate.totalCents += line.totalCents;
    carrier.byPlate.set(line.plate, plate);

    carriers.set(name, carrier);
  }

  return [...carriers.values()]
    .map(({ byPlate, ...carrier }) => ({
      ...carrier,
      plates: [...byPlate.values()].sort(
        (a, b) => b.trips - a.trips || a.plate.localeCompare(b.plate)
      )
    }))
    .sort((a, b) => b.trips - a.trips || a.carrierName.localeCompare(b.carrierName, "pt-BR"));
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
