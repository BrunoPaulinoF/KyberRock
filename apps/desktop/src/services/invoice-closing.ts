import type { DesktopDatabase } from "../database/sqlite.js";
import { computeCreditInvoiceSchedule, creditClosingConfigFromCustomer } from "./credit-invoice.js";
import type { CreditClosingConfig } from "./credit-invoice.js";
import {
  buildCustomerIdentityIndex,
  identityKeyForOperation,
  resolveCustomerIdGroup
} from "./customer-identity.js";
import type { CustomerIdentityIndex } from "./customer-identity.js";
import {
  resolveSituation,
  resolveSituationDetail,
  WEIGHING_BILLING_SITUATION_LABEL
} from "./weighing-billing-situation.js";
import type { WeighingBillingSituation } from "./weighing-billing-situation.js";
import { CLOSED_OPERATION_STATUS_SQL_LIST } from "./weighing-operations.js";
import { INVOICE_CLOSING_CYCLE_LABEL, isInvoiceClosingCycle } from "./invoice-closing-cycle.js";
import type { InvoiceClosingCycle } from "./invoice-closing-cycle.js";
import { findDuplicateWeighings } from "./weighing-duplicates.js";
import type { DuplicateWeighingGroup } from "./weighing-duplicates.js";

/**
 * Fechamento de faturas: a fatura de TODOS os clientes de um ciclo, de uma vez.
 *
 * O relatorio por cliente ja existia e responde "quanto este cliente comprou". A pergunta
 * do fechamento e outra: "quais clientes fecham quinzenal, e quanto cada um deve nesta
 * quinzena?". Sem ela a atendente abria cliente por cliente da lista inteira, sem nunca
 * saber se tinha esquecido algum — e esquecer um cliente no fechamento e nao cobrar o mes.
 *
 * O fechamento tem DUAS bases, e a escolhida muda quem entra em fatura:
 *
 *  - `period` (padrao): a fatura e a do PERIODO que a atendente escolheu na tela — a
 *    quinzena, o mes, a semana. Toda pesagem do periodo entra na fatura do cliente dela,
 *    tenha ele conta de credito no cadastro ou nao. E o que a cobranca precisa: o cliente
 *    que compra EM CARTEIRA nao tem periodicidade cadastrada e, na outra base, as cargas
 *    dele simplesmente nao entravam em fatura nenhuma — a quinzena inteira ficava sem ser
 *    cobrada, sem ninguem perceber.
 *  - `customer`: a base antiga, em que o ciclo vem da "Periodicidade do fechamento" do
 *    cadastro (`credit_periodicity`). Continua aqui para quem organiza a cobranca por
 *    cliente, e nao por quinzena.
 *
 * Na base `customer` a conta de QUANDO fecha e QUANDO vence e a de `credit-invoice.ts`, ja
 * testada e ja usada pela fatura de fiado: cada pesagem cai no PROXIMO fechamento na data
 * dela ou depois. Por isso uma quinzena pode devolver duas faturas do mesmo cliente (a que
 * fechou dia 1 e a que fechou dia 16), cada uma com o seu vencimento. Na base `period` o
 * fechamento e o ULTIMO dia do periodo escolhido, uma fatura por cliente, e o vencimento e
 * o prazo de boleto do cadastro contado dali (sem prazo cadastrado, vence no fechamento).
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
   * O fechamento em que esta carga caiu, e o vencimento dele — ou NULL quando ela nao caiu
   * em fatura nenhuma, por o cliente nao ter periodicidade de fechamento no cadastro.
   *
   * Repetidos na linha porque a lista "pesagem a pesagem" mistura as faturas todas: sem
   * eles, uma carga solta nao diria em qual fatura foi cobrada — que e justamente o que se
   * quer saber quando o cliente contesta. E o null e a informacao mais importante da
   * lista: e a carga que ninguem esta cobrando.
   */
  closingDate: string | null;
  dueDate: string | null;
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
  /**
   * A MESMA carga ja esta no fechamento por outra pesagem: esta aqui e o relancamento que
   * ficou para tras (ver `weighing-duplicates.ts`).
   *
   * A linha continua na lista de conferencia — sumir com ela deixaria a atendente sem
   * entender por que o total da lista nao bate com o das faturas —, mas ela NAO entra em
   * fatura nenhuma: cobrar as duas e cobrar a mesma carga duas vezes, e e essa soma a mais
   * que fazia o fechamento do KyberRock nao bater com o do OMIE.
   */
  isDuplicate: boolean;
  /** O vale da pesagem que ficou valendo, para a linha repetida se explicar sozinha. */
  duplicateOfCouponNumber: number | null;
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
  /**
   * Todos os cadastros de `customers` que sao este mesmo cliente.
   *
   * Quase sempre e um so. Passa de um quando a base tem o cliente duplicado — tipicamente o
   * cadastro que veio do OMIE e o que nasceu na balanca, com o mesmo CNPJ. A fatura e uma
   * so (o cliente e um so), e esta lista e o que diz de quais cadastros as cargas vieram.
   */
  customerIds: string[];
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
  /**
   * O ciclo da fatura. Null quando o fechamento e de um periodo personalizado, que nao e
   * quinzena, mes nem semana — a coluna mostra o rotulo de `cycleLabel`.
   */
  cycle: InvoiceClosingCycle | null;
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

/** Uma pesagem dentro de um grupo de repetidas. */
export interface InvoiceClosingDuplicateEntry {
  operationId: string;
  couponNumber: number | null;
  date: string;
  totalCents: number;
  operationTypeLabel: string;
  /** Numero da nota emitida no OMIE, quando ha. */
  invoiceNumber: string | null;
  /** True quando esta pesagem esta no periodo e nos filtros da tela. */
  inPeriod: boolean;
}

/**
 * A mesma carga registrada mais de uma vez — o relancamento feito para corrigir preco ou
 * tipo de venda, sem que a errada fosse cancelada. Veja `weighing-duplicates.ts`.
 */
export interface InvoiceClosingDuplicateGroup {
  key: string;
  customerName: string;
  plate: string;
  productDescription: string;
  entryWeightKg: number;
  exitWeightKg: number;
  /** A(s) que continua(m) valendo no fechamento. */
  kept: InvoiceClosingDuplicateEntry[];
  /** As repetidas, que saem da fatura e podem ser canceladas. */
  repeats: InvoiceClosingDuplicateEntry[];
  /** Quanto este grupo tirou das faturas desta tela. */
  removedTotalCents: number;
  /**
   * Duas notas fiscais para a mesma carga. O KyberRock nao tira nenhuma das duas da fatura
   * — as duas existem no OMIE —, e o conserto e cancelar uma nota la dentro.
   */
  billedMoreThanOnce: boolean;
}

/**
 * De onde sai o fechamento de cada carga: do PERIODO escolhido na tela ou da periodicidade
 * cadastrada no cliente. Veja o cabecalho do modulo.
 */
export type InvoiceClosingBasis = "period" | "customer";

export function isInvoiceClosingBasis(value: unknown): value is InvoiceClosingBasis {
  return value === "period" || value === "customer";
}

export interface InvoiceClosingFilters {
  basis: InvoiceClosingBasis;
  /** O ciclo que o periodo escolhido representa (base `period`); null no personalizado. */
  periodCycle: InvoiceClosingCycle | null;
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
   * TODAS as pesagens do periodo, na ordem em que foram feitas — inclusive as dos clientes
   * que ficaram fora do fechamento.
   *
   * As faturas respondem "quanto cada cliente deve"; esta lista responde a pergunta de
   * conferencia — "cade a carga tal?" —, e para isso ela nao pode esconder carga nenhuma.
   * Uma pedreira onde a maior parte dos clientes ainda nao tem periodicidade no cadastro
   * teria aqui uma lista quase vazia, escondendo justamente as cargas que ninguem esta
   * cobrando — que sao as que mais precisam ser vistas. Por isso o escopo desta lista e o
   * PERIODO, e nao as faturas, igual ao da Conferencia de faturamento.
   *
   * Nas cargas de fora, `closingDate`/`dueDate` vem null: e o que separa "cobrada na fatura
   * tal" de "nao esta em fatura nenhuma".
   */
  rows: InvoiceClosingLine[];
  /**
   * O total da lista acima — o periodo inteiro. Difere de `totals` (que e o das FATURAS)
   * exatamente pelo que ficou fora do fechamento, e por isso os dois existem: o primeiro e
   * o que a balanca fechou, o segundo e o que esta sendo cobrado.
   */
  rowTotals: InvoiceClosingTotals;
  totals: InvoiceClosingTotals;
  /**
   * As cargas registradas duas vezes que este fechamento encontrou.
   *
   * Sao a explicacao do total: sem esta lista, tirar as repetidas da fatura seria o
   * fechamento "perdendo" dinheiro sem dizer por que. Com ela, a atendente ve a carga, o
   * vale que ficou valendo e o que sobrou para cancelar.
   */
  duplicates: InvoiceClosingDuplicateGroup[];
  /** O que as repetidas tirariam das faturas se ainda estivessem nelas. */
  duplicateTotals: InvoiceClosingTotals;
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
  /**
   * De onde sai o fechamento. Ausente e `period` — o fechamento do periodo escolhido, que
   * e o que a tela pergunta e o unico que enxerga o cliente sem conta de credito.
   */
  basis?: InvoiceClosingBasis | null;
  /**
   * O ciclo que o periodo escolhido representa (quinzena, mes, semana), so na base
   * `period`. E o rotulo da fatura; null num intervalo personalizado.
   */
  periodCycle?: InvoiceClosingCycle | null;
  /**
   * Vazio (ou ausente) traz todos os ciclos configurados. Vale so na base `customer`: na
   * base `period` quem escolhe o ciclo e a atendente, no seletor de periodo.
   */
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
  // Nulos porque o LEFT JOIN de `customers` e a propria coluna da operacao permitem: a
  // pesagem antiga pode nao ter cliente, e o cadastro dela pode ter sido excluido depois.
  customer_id: string | null;
  customer_trade_name: string | null;
  customer_legal_name: string | null;
  customer_document: string | null;
  credit_account_enabled: number | null;
  credit_periodicity: string | null;
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
    const basis = isInvoiceClosingBasis(options.basis) ? options.basis : "period";
    const periodCycle = isInvoiceClosingCycle(options.periodCycle) ? options.periodCycle : null;
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

    // O cliente escolhido no filtro pode estar cadastrado mais de uma vez (o cadastro do
    // OMIE e o da balanca). O filtro vale para o cliente REAL: sem isso, escolher LEVISA
    // trazia so as cargas de uma das duas linhas e a metade restante nao era cobrada.
    const identities = buildCustomerIdentityIndex(this.db);
    const customerIds = customerId ? resolveCustomerIdGroup(this.db, customerId) : null;

    const sourceRows = this.loadRows(startDate, endDate, unitId, customerIds);

    // A mesma carga registrada duas vezes. Sai de uma busca PROPRIA, mais larga que o
    // periodo da tela: o relancamento que corrige o preco de uma quinzena costuma ser feito
    // dias depois, e olhando so o periodo a original ficaria na fatura e a correcao fora
    // dela — a fatura cobraria justamente a errada.
    const duplicateGroups = findDuplicateWeighings(this.db, unitId, startDate, endDate);
    const duplicateKeeper = new Map<string, number | null>();
    for (const group of duplicateGroups) {
      const keeperCoupon = group.keepers[0]?.couponNumber ?? null;
      for (const repeat of group.duplicates) {
        duplicateKeeper.set(repeat.operationId, keeperCoupon);
      }
    }

    const invoices = new Map<string, InvoiceClosingInvoice>();
    const pending = new Map<string, InvoiceClosingPendingCustomer>();
    // `lines` e o que entrou em fatura (a base dos totais do fechamento); `rows` e o
    // periodo inteiro (a base da lista de conferencia). A diferenca entre os dois e
    // exatamente o que aparece em "Clientes fora do fechamento".
    const lines: InvoiceClosingLine[] = [];
    const rows: InvoiceClosingLine[] = [];
    const carrierRows: Array<{ line: InvoiceClosingLine; carrierName: string }> = [];
    const availablePlates = new Set<string>();

    // Os ids que aparecem na tela depois dos filtros: e o que decide quais grupos de
    // repetidas viram aviso e quanto eles tiraram DESTE fechamento.
    const visibleOperationIds = new Set<string>();
    const duplicateLines: InvoiceClosingLine[] = [];

    for (const row of sourceRows) {
      const line = mapLine(row);
      if (!matchesSearch(line, row, search)) continue;

      // Antes do filtro de placa: a lista de opcoes da tela nao pode encolher a cada placa
      // marcada, senao nao haveria como marcar a segunda.
      const plate = normalizePlate(line.plate);
      availablePlates.add(plate);
      if (splitByPlate && !selectedPlates.has(plate)) continue;

      const config = closingConfigFor(row);
      // Ciclo escolhido: a carga sem periodicidade no cadastro nao pertence a ciclo nenhum,
      // entao ela sai junto com os ciclos que nao foram marcados. So na base `customer` —
      // na base `period` o ciclo e o do periodo escolhido, igual para todo mundo.
      if (
        basis === "customer" &&
        cycles.length > 0 &&
        (!config || !cycles.includes(config.periodicity))
      ) {
        continue;
      }

      // A lista de conferencia vem ANTES da fatura: ela e do periodo, nao das faturas, e
      // mostrar so o que entrou em fatura esconderia justamente a carga que ninguem cobra.
      rows.push(line);
      visibleOperationIds.add(line.operationId);

      // Repetida: continua na lista de conferencia (com o vale da que ficou valendo), mas
      // nao entra em fatura nenhuma nem em "clientes fora do fechamento" — ela nao e uma
      // carga a cobrar, e uma carga que ja esta sendo cobrada na outra linha.
      if (duplicateKeeper.has(line.operationId)) {
        line.isDuplicate = true;
        line.duplicateOfCouponNumber = duplicateKeeper.get(line.operationId) ?? null;
        duplicateLines.push(line);
        continue;
      }

      // Base `customer` sem credito habilitado: a carga nao pertence a fechamento nenhum e
      // vai para "Clientes fora do fechamento". Na base `period` isso nao existe — todo
      // mundo que teve carga no periodo entra na fatura do periodo.
      if (basis === "customer" && !config) {
        addPending(pending, identityKey(identities, row), row, line);
        continue;
      }

      const schedule =
        basis === "period"
          ? periodSchedule(endDate, config)
          : computeCreditInvoiceSchedule(config as CreditClosingConfig, parseIsoDate(line.date));
      line.closingDate = schedule.closingDate;
      line.dueDate = schedule.dueDate;

      const cycle = basis === "period" ? periodCycle : (config as CreditClosingConfig).periodicity;
      const identity = identityKey(identities, row);
      const key = splitByPlate
        ? `${identity}|${schedule.closingDate}|${plate}`
        : `${identity}|${schedule.closingDate}`;
      const invoice = invoices.get(key) ?? {
        customerId: row.customer_id ?? "",
        customerIds: [],
        customerName: customerName(row),
        customerDocument: row.customer_document,
        plate: splitByPlate ? plate : null,
        cycle,
        cycleLabel: cycle === null ? "Periodo" : INVOICE_CLOSING_CYCLE_LABEL[cycle],
        closingDate: schedule.closingDate,
        dueDate: schedule.dueDate,
        lines: [],
        totals: emptyTotals(),
        operationsWithoutInvoice: 0
      };
      invoice.lines.push(line);
      if (row.customer_id && !invoice.customerIds.includes(row.customer_id)) {
        invoice.customerIds.push(row.customer_id);
      }
      // O documento pode faltar num dos cadastros duplicados: o primeiro que tiver manda,
      // senao a fatura sairia sem CNPJ so por causa da linha que veio primeiro.
      if (!invoice.customerDocument && row.customer_document) {
        invoice.customerDocument = row.customer_document;
      }
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
      filters: { basis, periodCycle, cycles, customerId, plates, search: search || null },
      invoices: orderedInvoices,
      duplicates: buildDuplicateGroups(duplicateGroups, visibleOperationIds),
      duplicateTotals: buildTotals(duplicateLines),
      rows,
      rowTotals: buildTotals(rows),
      totals: buildTotals(lines),
      // Por CLIENTE REAL: com o cadastro duplicado, contar `customerId` diria "2 clientes"
      // onde ha um so — e com o filtro de placa diria um por caminhao.
      customers: new Set(
        orderedInvoices.map((invoice) => identityKeyForOperation(identities, invoice.customerId))
      ).size,
      withoutInvoice: buildTotals(lines.filter((line) => !line.invoiceNumber)),
      byCarrier: groupByCarrier(carrierRows),
      pendingSetup: [...pending.values()].sort((a, b) => b.totalCents - a.totalCents),
      availablePlates: [...availablePlates].sort((a, b) => a.localeCompare(b, "pt-BR"))
    };
  }

  /**
   * As pesagens do periodo.
   *
   * `customerIds` e o grupo do cliente escolhido no filtro — ele proprio e os cadastros
   * duplicados dele —, ou null para "todos os clientes".
   */
  private loadRows(
    startDate: string,
    endDate: string,
    unitId: string,
    customerIds: string[] | null
  ): InvoiceClosingSourceRow[] {
    // Nunca interpolado: a lista sai de `customers.id` da propria base, mas o `IN (...)`
    // segue por placeholders como o resto das consultas do modulo.
    const customerFilter =
      customerIds && customerIds.length > 0
        ? `AND o.customer_id IN (${customerIds.map(() => "?").join(", ")})`
        : "";

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
         -- LEFT JOIN de proposito: com JOIN, a pesagem cujo cadastro de cliente sumiu da
         -- base (excluido, ou nunca projetado) desaparecia do fechamento inteiro — carga
         -- pesada, saida da pedreira e invisivel para quem cobra. Sem o cadastro o nome
         -- ainda vem de remote_customer_name, gravado na propria operacao.
         LEFT JOIN customers cust ON cust.id = o.customer_id
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN vehicles v ON v.id = o.vehicle_id
         LEFT JOIN drivers d ON d.id = o.driver_id
         LEFT JOIN carriers crr ON crr.id = o.carrier_id
         LEFT JOIN carriers vcrr ON vcrr.id = v.carrier_id
         WHERE o.unit_id = ?
           ${customerFilter}
           AND o.deleted_at IS NULL
           AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
           AND date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
         ORDER BY o.created_at ASC, o.operation_code ASC`
      )
      .all(unitId, ...(customerIds ?? []), startDate, endDate) as InvoiceClosingSourceRow[];
  }
}

function mapLine(row: InvoiceClosingSourceRow): InvoiceClosingLine {
  const situation = resolveSituation(row);
  return {
    operationId: row.id,
    customerId: row.customer_id ?? "",
    customerName: customerName(row),
    customerDocument: row.customer_document,
    couponNumber: row.operation_code,
    date: row.created_at.slice(0, 10),
    closedAt: row.exit_at,
    // Preenchidas quando a linha entra numa fatura: e o fechamento que decide as duas datas.
    closingDate: null,
    dueDate: null,
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
    situationDetail: resolveSituationDetail(row, situation),
    // Preenchidos quando a deteccao de repetidas reconhece a linha.
    isDuplicate: false,
    duplicateOfCouponNumber: null
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

/** A chave do cliente REAL da pesagem — a que junta os cadastros duplicados numa fatura so. */
function identityKey(index: CustomerIdentityIndex, row: InvoiceClosingSourceRow): string {
  return identityKeyForOperation(index, row.customer_id);
}

/**
 * O fechamento da base `period`: fecha no ULTIMO dia do periodo escolhido.
 *
 * O vencimento e o prazo de boleto do cadastro contado dali, quando o cliente tem um. Quem
 * compra em carteira normalmente nao tem — e ai a fatura vence no proprio fechamento, que
 * e o unico prazo que o sistema pode afirmar sem inventar. Quem combina o vencimento com o
 * cliente registra ele na Carteira, no fechamento da venda.
 */
function periodSchedule(
  endDate: string,
  config: CreditClosingConfig | null
): { closingDate: string; dueDate: string } {
  const boletoDays = periodBoletoDays(config);
  if (boletoDays <= 0) return { closingDate: endDate, dueDate: endDate };

  const due = parseIsoDate(endDate);
  due.setDate(due.getDate() + boletoDays);
  const year = due.getFullYear();
  const month = String(due.getMonth() + 1).padStart(2, "0");
  const day = String(due.getDate()).padStart(2, "0");
  return { closingDate: endDate, dueDate: `${year}-${month}-${day}` };
}

/**
 * Prazo de boleto do cadastro. Na quinzena vale o do SEGUNDO fechamento: o periodo fechado
 * a mao termina no fim dele, que e o papel do segundo fechamento no cadastro.
 */
function periodBoletoDays(config: CreditClosingConfig | null): number {
  if (!config) return 0;
  if (config.periodicity === "biweekly") return config.secondBoletoDays;
  return config.boletoDays;
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
  key: string,
  row: InvoiceClosingSourceRow,
  line: InvoiceClosingLine
): void {
  // Pela chave do cliente REAL: o cliente cadastrado duas vezes aparecia duas vezes nesta
  // lista, com o movimento dele partido ao meio.
  const entry = pending.get(key) ?? {
    customerId: row.customer_id ?? "",
    customerName: customerName(row),
    operations: 0,
    totalCents: 0
  };
  entry.operations += 1;
  entry.totalCents += line.totalCents;
  pending.set(key, entry);
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

/**
 * Os grupos de repetidas que interessam a ESTA tela: os que tem alguma pesagem entre as
 * linhas que sobraram dos filtros.
 *
 * Um grupo inteiro de outro cliente, ou de uma placa que a atendente nem escolheu, so
 * atrapalharia a conferencia do que esta na tela. E o valor "tirado da fatura" e contado
 * pelas repetidas VISIVEIS pelo mesmo motivo: e o que explica o total mostrado aqui.
 */
function buildDuplicateGroups(
  groups: readonly DuplicateWeighingGroup[],
  visibleOperationIds: ReadonlySet<string>
): InvoiceClosingDuplicateGroup[] {
  const entry = (
    candidate: DuplicateWeighingGroup["duplicates"][number]
  ): InvoiceClosingDuplicateEntry => ({
    operationId: candidate.operationId,
    couponNumber: candidate.couponNumber,
    date: candidate.date,
    totalCents: candidate.totalCents,
    operationTypeLabel: candidate.operationType === "internal" ? "Interna" : "Com nota",
    invoiceNumber: candidate.invoiceNumber,
    inPeriod: visibleOperationIds.has(candidate.operationId)
  });

  return groups
    .filter((group) =>
      [...group.keepers, ...group.duplicates].some((candidate) =>
        visibleOperationIds.has(candidate.operationId)
      )
    )
    .map((group) => ({
      key: group.key,
      customerName: group.customerName,
      plate: group.plate,
      productDescription: group.productDescription,
      entryWeightKg: group.entryWeightKg,
      exitWeightKg: group.exitWeightKg,
      kept: group.keepers.map(entry),
      repeats: group.duplicates.map(entry),
      removedTotalCents: group.duplicates
        .filter((candidate) => visibleOperationIds.has(candidate.operationId))
        .reduce((total, candidate) => total + candidate.totalCents, 0),
      billedMoreThanOnce: group.billedMoreThanOnce
    }));
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
