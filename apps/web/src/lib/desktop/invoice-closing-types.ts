/**
 * Os tipos que `invoice-closing-render.ts` recebe — copia das declaracoes de
 * `apps/desktop/src/services/invoice-closing.ts`, que no desktop moram junto do servico do
 * SQLite e por isso nao podem ser importadas daqui (o site nao importa outro workspace).
 *
 * O montador do site (`lib/invoice-closing.ts`) estende estes tipos com o que so ele tem (o
 * pedido de faturamento de cada pesagem) e produz exatamente estes campos, com a mesma regra
 * do servico do desktop. Mudou la, mude aqui.
 */

import type { InvoiceClosingCycle } from "./invoice-closing-cycle.js";
import type { WeighingBillingSituation } from "./weighing-billing-situation.js";

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
 * cadastrada no cliente. Veja o cabecalho de `invoice-closing.ts` do desktop.
 */
export type InvoiceClosingBasis = "period" | "customer";

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
