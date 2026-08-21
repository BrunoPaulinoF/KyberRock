import {
  SPREADSHEET_STYLE,
  documentStyle,
  escapeHtml,
  formatBRL,
  formatDayLabel,
  formatTons,
  kpiCards,
  num,
  section,
  sheetTable,
  slug,
  table
} from "./report-document.js";
import { renderTotalBar } from "./report-total-bar.js";
import { INVOICE_CLOSING_CYCLE_LABEL, formatCouponNumber } from "./invoice-closing-cycle.js";
import type {
  InvoiceClosingCarrierRow,
  InvoiceClosingInvoice,
  InvoiceClosingLine,
  InvoiceClosingReport
} from "./invoice-closing.js";

/**
 * Documentos do fechamento de faturas, nos dois formatos ja usados pelos demais
 * relatorios: A4 paisagem (vira PDF pelo `renderHtmlToPdf` do main) e HTML de tabelas
 * gravado como `.xls`.
 *
 * A PLANILHA e o formato principal aqui, e nao um extra: o fechamento e conferido lado a
 * lado com o extrato do cliente e com o acerto do transportador, filtrando e somando
 * coluna por coluna — coisa que num PDF nao se faz. O PDF continua existindo para o que
 * vai anexado a cobranca.
 *
 * O documento repete o desenho do fechamento que a pedreira ja usava: um bloco POR
 * FATURA, com o cliente no titulo, a lista carga a carga e, no fim, os dados da fatura
 * (fechamento, vencimento e valor). Quem recebe o arquivo novo tem de reconhecer nele o
 * arquivo antigo — trocar de sistema ja e mudanca demais para tambem trocar a leitura.
 */

/**
 * Nota fixa nos dois formatos. Diz de onde vem cada coisa: o ciclo e do CADASTRO do
 * cliente, a nota e do OMIE e o boleto tambem. Sem isso, "sem nota" seria lido como falha
 * do KyberRock e a atendente procuraria defeito onde nao ha.
 */
export const INVOICE_CLOSING_NOTE =
  "O ciclo de cada cliente (quinzenal, mensal ou semanal) vem da Periodicidade do " +
  "fechamento no cadastro dele, em Cadastros > Clientes; a data de fechamento e o " +
  "vencimento saem do dia de fechamento e do prazo de boleto ali configurados. A NOTA " +
  "FISCAL e o BOLETO sao emitidos no OMIE, a partir do pedido que o KyberRock ja enviou — " +
  "uma carga sem numero de nota e uma carga que ainda espera a emissao la, nao um erro " +
  "daqui. Valores e pesos sao os fechados na balanca. A lista PESAGEM A PESAGEM cobre o " +
  "periodo inteiro, incluindo as cargas dos clientes que ficaram fora do fechamento — por " +
  "isso o total dela pode ser maior que o total a faturar das faturas.";

const LINE_HEADERS = [
  "Data",
  "Vale",
  "Nota fiscal",
  "Pedido OMIE",
  "Placa",
  "Transportador",
  "Motorista",
  "Produto",
  "Peso (kg)",
  "Produto (R$)",
  "Frete (R$)",
  "Total (R$)",
  "Situacao"
];

const INVOICE_HEADERS = [
  "Cliente",
  "CNPJ/CPF",
  "Ciclo",
  "Fechamento",
  "Vencimento",
  "Cargas",
  "Peso (kg)",
  "Total (R$)",
  "Sem nota"
];

/**
 * Os mesmos cabecalhos com a coluna PLACA no meio, usados quando o fechamento saiu separado
 * por placa. A coluna so aparece nesse caso: no fechamento normal ela estaria vazia em todas
 * as linhas e o arquivo deixaria de ser o que a pedreira ja conhece.
 */
const INVOICE_HEADERS_BY_PLATE = [
  "Cliente",
  "CNPJ/CPF",
  "Placa",
  "Ciclo",
  "Fechamento",
  "Vencimento",
  "Cargas",
  "Peso (kg)",
  "Total (R$)",
  "Sem nota"
];

function invoiceHeaders(report: InvoiceClosingReport): string[] {
  return splitByPlate(report) ? INVOICE_HEADERS_BY_PLATE : INVOICE_HEADERS;
}

function splitByPlate(report: InvoiceClosingReport): boolean {
  return report.filters.plates.length > 0;
}

const CARRIER_HEADERS = [
  "Transportador / placa",
  "Viagens",
  "Peso (kg)",
  "Frete (R$)",
  "Total (R$)"
];

const PENDING_HEADERS = ["Cliente", "Cargas", "Total (R$)"];

/**
 * A lista "pesagem a pesagem": TODAS as cargas do periodo, numa tabela unica com a coluna do
 * CLIENTE — inclusive as dos clientes que ficaram fora do fechamento.
 *
 * E o formato que se filtra e soma na planilha. Os blocos por fatura acima cobrem so o que
 * esta sendo cobrado, e cada um e uma tabela separada — nao da para ordenar por peso,
 * filtrar uma placa ou somar uma coluna atravessando todos os clientes de uma vez.
 */
const DETAIL_HEADERS = [
  "Op.",
  "Vale",
  "Data",
  "Cliente",
  "CNPJ/CPF",
  "Produto",
  "Placa",
  "Transportador",
  "Motorista",
  "Peso (kg)",
  "Preco unit.",
  "Produto (R$)",
  "Frete (R$)",
  "Total (R$)",
  "Tipo",
  "Situacao",
  "Nota fiscal",
  "Pedido/OS OMIE",
  "Fechamento",
  "Vencimento"
];

export function invoiceClosingFileBaseName(report: InvoiceClosingReport): string {
  // Na base `period` o arquivo e da quinzena/mes/semana escolhida, e nao dos ciclos do
  // cadastro: um "fechamento-faturas-todos" esconderia justamente qual periodo foi fechado.
  const cycles =
    report.filters.basis === "period"
      ? slug(
          report.filters.periodCycle
            ? INVOICE_CLOSING_CYCLE_LABEL[report.filters.periodCycle]
            : "periodo",
          "periodo"
        )
      : report.filters.cycles.length
        ? report.filters.cycles
            .map((cycle) => slug(INVOICE_CLOSING_CYCLE_LABEL[cycle], "ciclo"))
            .join("-")
        : "todos";
  return `fechamento-faturas-${cycles}${platesSuffix(report)}-${report.startDate}-a-${report.endDate}`;
}

/**
 * As placas no nome do arquivo — ate tres delas. Quem separa o fechamento por placa costuma
 * gerar um arquivo por caminhao e precisa distinguir um do outro na pasta; acima de tres o
 * nome so cresce, entao vira a contagem.
 */
function platesSuffix(report: InvoiceClosingReport): string {
  const { plates } = report.filters;
  if (plates.length === 0) return "";
  if (plates.length > 3) return `-${plates.length}-placas`;
  return `-${plates.map((plate) => slug(plate, "placa")).join("-")}`;
}

export function renderInvoiceClosingHtml(
  report: InvoiceClosingReport,
  generatedAt: Date = new Date()
): string {
  const { totals, withoutInvoice } = report;

  const kpis: Array<[string, string]> = [
    ["Faturas", num(report.invoices.length)],
    ["Clientes", num(report.customers)],
    ["Cargas", num(totals.operations)],
    ["Tonelagem", formatTons(totals.netWeightKg)],
    ["Frete", formatBRL(totals.freightCents)],
    ["Total a faturar", formatBRL(totals.totalCents)],
    ["Cargas sem nota", num(withoutInvoice.operations)],
    ["Valor sem nota", formatBRL(withoutInvoice.totalCents)]
  ];

  const sections = [
    section(
      splitByPlate(report) ? "Faturas do periodo, por placa" : "Faturas do periodo",
      `${table(
        invoiceHeaders(report),
        report.invoices.map((invoice) => invoiceCells(invoice, splitByPlate(report))),
        report.invoices.length > 0 ? invoiceFooterCells(report) : null,
        "Nenhum cliente com fechamento no periodo."
      )}<p class="note">${escapeHtml(INVOICE_CLOSING_NOTE)}</p>`
    ),
    ...report.invoices.map((invoice) =>
      section(
        invoiceTitle(invoice),
        table(
          LINE_HEADERS,
          invoice.lines.map((line) => lineCells(line)),
          lineFooterCells(invoice),
          "Sem cargas nesta fatura.",
          "detail"
        )
      )
    ),
    section(
      detailTitle(report),
      table(
        DETAIL_HEADERS,
        report.rows.map((line) => detailCells(line)),
        detailFooterCells(report),
        "Nenhuma pesagem nas faturas do periodo.",
        "detail"
      )
    ),
    section(
      "Transportadores e placas",
      table(
        CARRIER_HEADERS,
        carrierCells(report.byCarrier),
        report.byCarrier.length > 0
          ? [
              "TOTAL",
              num(totals.operations),
              num(totals.netWeightKg),
              formatBRL(totals.freightCents),
              formatBRL(totals.totalCents)
            ]
          : null,
        "Sem viagens no periodo."
      )
    ),
    ...(report.pendingSetup.length > 0
      ? [
          section(
            "Clientes fora do fechamento",
            `${table(
              PENDING_HEADERS,
              report.pendingSetup.map((row) => [
                row.customerName,
                num(row.operations),
                formatBRL(row.totalCents)
              ]),
              null,
              "Nenhum."
            )}<p class="note">${escapeHtml(
              "Estes clientes tiveram carga no periodo mas nao entraram em fatura nenhuma: " +
                "falta habilitar o credito e a periodicidade do fechamento no cadastro deles."
            )}</p>`
          )
        ]
      : [])
  ];

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    "Fechamento de faturas"
  )}</title><style>${documentStyle("landscape")}
</style></head><body>
<div class="header"><div><h1>Fechamento de faturas</h1><p class="customer">${escapeHtml(
    scopeText(report)
  )}</p><p class="period">${escapeHtml(periodText(report))}</p><span class="badge">${escapeHtml(
    "Carga a carga"
  )}</span></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
${kpiCards(kpis)}
${sections.join("\n")}
${renderTotalBar([
  { label: "Faturas", value: num(report.invoices.length) },
  { label: "Cargas", value: num(totals.operations) },
  { label: "Tonelagem", value: formatTons(totals.netWeightKg) },
  { label: "Frete", value: formatBRL(totals.freightCents) },
  { label: "Sem nota", value: formatBRL(withoutInvoice.totalCents) },
  { label: "Total a faturar", value: formatBRL(totals.totalCents), emphasis: true }
])}
</body></html>`;
}

export function renderInvoiceClosingSpreadsheet(
  report: InvoiceClosingReport,
  generatedAt: Date = new Date()
): string {
  const { totals } = report;

  const blocks = [
    sheetTable(
      splitByPlate(report) ? "Faturas do periodo, por placa" : "Faturas do periodo",
      invoiceHeaders(report),
      report.invoices.map((invoice) => invoiceCells(invoice, splitByPlate(report))),
      report.invoices.length > 0 ? invoiceFooterCells(report) : null
    ),
    ...report.invoices.map((invoice) =>
      sheetTable(
        invoiceTitle(invoice),
        LINE_HEADERS,
        invoice.lines.map((line) => lineCells(line)),
        lineFooterCells(invoice)
      )
    ),
    sheetTable(
      detailTitle(report),
      DETAIL_HEADERS,
      report.rows.map((line) => detailCells(line)),
      detailFooterCells(report)
    ),
    sheetTable(
      "Transportadores e placas",
      CARRIER_HEADERS,
      carrierCells(report.byCarrier),
      report.byCarrier.length > 0
        ? [
            "TOTAL",
            num(totals.operations),
            num(totals.netWeightKg),
            formatBRL(totals.freightCents),
            formatBRL(totals.totalCents)
          ]
        : null
    ),
    ...(report.pendingSetup.length > 0
      ? [
          sheetTable(
            "Clientes fora do fechamento",
            PENDING_HEADERS,
            report.pendingSetup.map((row) => [
              row.customerName,
              num(row.operations),
              formatBRL(row.totalCents)
            ]),
            null
          )
        ]
      : [])
  ];

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>Fechamento de faturas</h1>
<p class="sub">${escapeHtml(
    `${scopeText(report)} - ${periodText(report)} - gerado em ${generatedAt.toLocaleString("pt-BR")}`
  )}</p>
${blocks.join("\n")}
<p class="note">${escapeHtml(INVOICE_CLOSING_NOTE)}</p>
</body></html>`;
}

/**
 * Titulo da secao. Diz quantas cargas do periodo estao FORA do fechamento sempre que houver
 * alguma: quem abre a planilha precisa saber que a lista e maior que as faturas antes de
 * comparar os dois totais e achar que um deles esta errado.
 */
function detailTitle(report: InvoiceClosingReport): string {
  const outside = report.rows.filter((line) => line.closingDate === null).length;
  const base = `Pesagem a pesagem (${num(report.rows.length)})`;
  return outside > 0 ? `${base} - ${num(outside)} fora do fechamento` : base;
}

function detailCells(line: InvoiceClosingLine): string[] {
  return [
    line.couponNumber === null ? "-" : String(line.couponNumber),
    formatCouponNumber(line.couponNumber),
    formatDayLabel(line.date),
    line.customerName,
    line.customerDocument ?? "-",
    line.productCode ? `${line.productCode} - ${line.productDescription}` : line.productDescription,
    line.plate,
    line.carrierName,
    line.driverName,
    num(line.netWeightKg),
    unitPriceLabel(line),
    formatBRL(line.productTotalCents),
    formatBRL(line.freightTotalCents),
    formatBRL(line.totalCents),
    line.operationTypeLabel,
    line.situationLabel,
    line.invoiceNumber ?? "-",
    omieReference(line),
    line.closingDate ? formatDayLabel(line.closingDate) : "Fora do fechamento",
    line.dueDate ? formatDayLabel(line.dueDate) : "-"
  ];
}

/**
 * Numero pelo qual a pesagem e procurada no OMIE — o elo entre os dois sistemas. O numero
 * VISIVEL do documento acompanha o codigo da integracao quando ja e conhecido; e ele que
 * serve na busca do OMIE.
 */
function omieReference(line: InvoiceClosingLine): string {
  const visible = line.omieOrderNumber ? ` (nº ${line.omieOrderNumber})` : "";
  if (line.omieSalesOrderId) return `Pedido ${line.omieSalesOrderId}${visible}`;
  if (line.omieServiceOrderId) return `OS ${line.omieServiceOrderId}${visible}`;
  return "-";
}

/** Rodape alinhado com `DETAIL_HEADERS`: so as colunas somaveis levam numero. */
function detailFooterCells(report: InvoiceClosingReport): string[] | null {
  if (report.rows.length === 0) return null;
  // O total DA LISTA (o periodo inteiro), nao o das faturas: somar aqui o total a faturar
  // daria um rodape que nao fecha com as linhas logo acima dele.
  const totals = report.rowTotals;
  return [
    "TOTAL DO PERIODO",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    num(totals.netWeightKg),
    "",
    formatBRL(totals.productCents),
    formatBRL(totals.freightCents),
    formatBRL(totals.totalCents),
    "",
    "",
    "",
    "",
    "",
    ""
  ];
}

/**
 * O preco unitario com a unidade em que ele foi aplicado. Sem o "/t" ou "/kg" o numero
 * sozinho nao da para conferir: R$ 42,00 por tonelada e por quilo sao contas mil vezes
 * diferentes.
 */
function unitPriceLabel(line: InvoiceClosingLine): string {
  if (line.unitPriceCents === null) return "-";
  return `${formatBRL(line.unitPriceCents)}/${line.priceUnit === "kg" ? "kg" : "t"}`;
}

/**
 * Titulo do bloco da fatura. Traz cliente, ciclo, fechamento, vencimento e valor na mesma
 * linha porque no arquivo e ele que separa uma fatura da outra: quem rola a planilha ate o
 * meio precisa saber de quem e a lista sem voltar ao topo.
 */
function invoiceTitle(invoice: InvoiceClosingInvoice): string {
  return (
    `${invoice.customerName}${invoice.plate ? ` — ${invoice.plate}` : ""} — ${invoice.cycleLabel}` +
    ` — fecha ${formatDayLabel(invoice.closingDate)}` +
    ` — vence ${formatDayLabel(invoice.dueDate)} — ${formatBRL(invoice.totals.totalCents)}`
  );
}

function invoiceCells(invoice: InvoiceClosingInvoice, byPlate: boolean): string[] {
  return [
    invoice.customerName,
    invoice.customerDocument ?? "-",
    ...(byPlate ? [invoice.plate ?? "-"] : []),
    invoice.cycleLabel,
    formatDayLabel(invoice.closingDate),
    formatDayLabel(invoice.dueDate),
    num(invoice.totals.operations),
    num(invoice.totals.netWeightKg),
    formatBRL(invoice.totals.totalCents),
    invoice.operationsWithoutInvoice === 0 ? "-" : num(invoice.operationsWithoutInvoice)
  ];
}

function invoiceFooterCells(report: InvoiceClosingReport): string[] {
  const { totals } = report;
  return [
    "TOTAL",
    "",
    "",
    "",
    "",
    ...(splitByPlate(report) ? [""] : []),
    num(totals.operations),
    num(totals.netWeightKg),
    formatBRL(totals.totalCents),
    report.withoutInvoice.operations === 0 ? "-" : num(report.withoutInvoice.operations)
  ];
}

function lineCells(line: InvoiceClosingLine): string[] {
  return [
    formatDayLabel(line.date),
    formatCouponNumber(line.couponNumber),
    line.invoiceNumber ?? "-",
    line.omieOrderNumber ?? "-",
    line.plate,
    line.carrierName,
    line.driverName,
    line.productDescription,
    num(line.netWeightKg),
    formatBRL(line.productTotalCents),
    formatBRL(line.freightTotalCents),
    formatBRL(line.totalCents),
    line.situationLabel
  ];
}

/** Rodape alinhado com `LINE_HEADERS`: so as colunas somaveis levam numero. */
function lineFooterCells(invoice: InvoiceClosingInvoice): string[] | null {
  if (invoice.lines.length === 0) return null;
  const { totals } = invoice;
  return [
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    num(totals.netWeightKg),
    formatBRL(totals.productCents),
    formatBRL(totals.freightCents),
    formatBRL(totals.totalCents),
    ""
  ];
}

/**
 * Transportador e, logo abaixo, cada placa dele. A indentacao da placa e o que permite ler
 * a tabela inteira de cima a baixo sem perder de vista de quem e o caminhao.
 */
function carrierCells(carriers: readonly InvoiceClosingCarrierRow[]): string[][] {
  const rows: string[][] = [];
  for (const carrier of carriers) {
    rows.push([
      carrier.carrierName,
      num(carrier.trips),
      num(carrier.netWeightKg),
      formatBRL(carrier.freightCents),
      formatBRL(carrier.totalCents)
    ]);
    for (const plate of carrier.plates) {
      rows.push([
        `   ${plate.plate}`,
        num(plate.trips),
        num(plate.netWeightKg),
        formatBRL(plate.freightCents),
        formatBRL(plate.totalCents)
      ]);
    }
  }
  return rows;
}

function scopeText(report: InvoiceClosingReport): string {
  const parts: string[] = [
    report.filters.basis === "period"
      ? `Fechamento do periodo${
          report.filters.periodCycle
            ? ` (${INVOICE_CLOSING_CYCLE_LABEL[report.filters.periodCycle]})`
            : ""
        }`
      : report.filters.cycles.length > 0
        ? report.filters.cycles.map((cycle) => INVOICE_CLOSING_CYCLE_LABEL[cycle]).join(", ")
        : "Todos os ciclos"
  ];
  if (report.filters.customerId) {
    parts.push(report.invoices[0]?.customerName ?? "Cliente selecionado");
  }
  if (report.filters.plates.length > 0) {
    parts.push(`placas ${report.filters.plates.join(", ")}`);
  }
  if (report.filters.search) parts.push(`busca "${report.filters.search}"`);
  return parts.join(" - ");
}

function periodText(report: InvoiceClosingReport): string {
  const range = `${formatDayLabel(report.startDate)} a ${formatDayLabel(report.endDate)}`;
  return report.periodLabel ? `${report.periodLabel} - ${range}` : range;
}
