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
import { WEIGHING_BILLING_SITUATION_LABEL } from "./weighing-billing-situation.js";
import type {
  WeighingBillingReport,
  WeighingBillingRow,
  WeighingBillingSituationRow
} from "./weighing-billing-report.js";

/**
 * Documentos da conferencia de faturamento, nos dois formatos ja usados pelos demais
 * relatorios: A4 paisagem (vira PDF pelo `renderHtmlToPdf` do main) e HTML de tabelas
 * gravado como `.xls`.
 *
 * A lista sai em paisagem por decisao: sao onze colunas, e espremer a descricao do
 * produto num A4 retrato so para caber tornaria o relatorio ilegivel justamente na
 * coluna que identifica a pesagem.
 *
 * A planilha existe porque a conferencia costuma terminar num filtro do Excel lado a
 * lado com o relatorio do OMIE — e para isso o PDF nao serve.
 */

/**
 * Nota fixa nos dois formatos. A distincao importa: o KyberRock manda o pedido, quem
 * emite a nota e o OMIE. Sem isto, "No OMIE, falta faturar" seria lido como erro do
 * aplicativo — e o operador iria procurar defeito onde nao ha.
 */
export const BILLING_CONFERENCE_NOTE =
  "O KyberRock envia ao OMIE o pedido de venda (ou a ordem de servico, na venda interna); " +
  'a nota fiscal e emitida no proprio OMIE, na etapa "Faturar". Por isso uma pesagem em ' +
  '"No OMIE, falta faturar" ja saiu daqui certa: o que falta e a emissao la. Valores e pesos ' +
  "sao os fechados na balanca, nao os do documento fiscal.";

const ROW_HEADERS = [
  "Operacao",
  "Data",
  "Cliente",
  "Produto",
  "Placa",
  "Peso (kg)",
  "Preco unit.",
  "Produto (R$)",
  "Frete (R$)",
  "Total (R$)",
  "Tipo",
  "Situacao",
  // A nota vem antes do pedido: e o numero que sai desta pedreira e chega ao cliente.
  "Nota fiscal",
  "Pedido/OS OMIE"
];

const SITUATION_HEADERS = ["Situacao", "Pesagens", "Peso (kg)", "Total (R$)"];

export function weighingBillingReportFileBaseName(report: WeighingBillingReport): string {
  const scope = report.filters.customerId
    ? slug(report.rows[0]?.customerName ?? "cliente", "cliente")
    : "geral";
  return `conferencia-faturamento-${scope}-${report.startDate}-a-${report.endDate}`;
}

export function renderWeighingBillingReportHtml(
  report: WeighingBillingReport,
  generatedAt: Date = new Date()
): string {
  const { totals, unbilled } = report;

  const kpis: Array<[string, string]> = [
    ["Pesagens", num(totals.operations)],
    ["Tonelagem", formatTons(totals.netWeightKg)],
    ["Frete", formatBRL(totals.freightCents)],
    ["Total fechado", formatBRL(totals.totalCents)],
    ["Pesagens faturadas", num(totals.operations - unbilled.operations)],
    ["Pesagens sem faturar", num(unbilled.operations)],
    ["Valor sem faturar", formatBRL(unbilled.totalCents)],
    ["Tonelagem sem faturar", formatTons(unbilled.netWeightKg)]
  ];

  const sections = [
    section(
      "Situacao do faturamento",
      `${table(
        SITUATION_HEADERS,
        report.bySituation.map((row) => situationCells(row)),
        report.bySituation.length > 0
          ? ["TOTAL", num(totals.operations), num(totals.netWeightKg), formatBRL(totals.totalCents)]
          : null,
        "Sem pesagens no periodo."
      )}<p class="note">${escapeHtml(BILLING_CONFERENCE_NOTE)}</p>`
    ),
    section(
      "Pesagem a pesagem",
      table(
        ROW_HEADERS,
        report.rows.map((row) => rowCells(row)),
        report.rows.length > 0 ? footerCells(report) : null,
        "Sem pesagens no periodo.",
        "detail"
      )
    )
  ];

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    "Conferencia de faturamento"
  )}</title><style>${documentStyle("landscape")}
</style></head><body>
<div class="header"><div><h1>Conferencia de faturamento</h1><p class="customer">${escapeHtml(
    scopeText(report)
  )}</p><p class="period">${escapeHtml(periodText(report))}</p><span class="badge">${escapeHtml(
    "Pesagem a pesagem"
  )}</span></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
${kpiCards(kpis)}
${sections.join("\n")}
${renderTotalBar([
  { label: "Pesagens", value: num(totals.operations) },
  { label: "Tonelagem", value: formatTons(totals.netWeightKg) },
  { label: "Produto", value: formatBRL(totals.productCents) },
  { label: "Frete", value: formatBRL(totals.freightCents) },
  { label: "Sem faturar", value: formatBRL(unbilled.totalCents) },
  { label: "Total fechado", value: formatBRL(totals.totalCents), emphasis: true }
])}
</body></html>`;
}

export function renderWeighingBillingReportSpreadsheet(
  report: WeighingBillingReport,
  generatedAt: Date = new Date()
): string {
  const { totals } = report;

  const blocks = [
    sheetTable(
      "Situacao do faturamento",
      SITUATION_HEADERS,
      report.bySituation.map((row) => situationCells(row)),
      report.bySituation.length > 0
        ? ["TOTAL", num(totals.operations), num(totals.netWeightKg), formatBRL(totals.totalCents)]
        : null
    ),
    sheetTable(
      "Pesagem a pesagem",
      ROW_HEADERS,
      report.rows.map((row) => rowCells(row)),
      report.rows.length > 0 ? footerCells(report) : null
    )
  ];

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>Conferencia de faturamento</h1>
<p class="sub">${escapeHtml(
    `${scopeText(report)} - ${periodText(report)} - gerado em ${generatedAt.toLocaleString("pt-BR")}`
  )}</p>
${blocks.join("\n")}
<p class="note">${escapeHtml(BILLING_CONFERENCE_NOTE)}</p>
</body></html>`;
}

function rowCells(row: WeighingBillingRow): string[] {
  return [
    row.operationCode === null ? "-" : String(row.operationCode),
    formatDayLabel(row.date),
    row.customerName,
    row.productCode ? `${row.productCode} - ${row.productDescription}` : row.productDescription,
    row.plate,
    num(row.netWeightKg),
    row.unitPriceCents === null
      ? "-"
      : `${formatBRL(row.unitPriceCents)}/${row.priceUnit === "kg" ? "kg" : "t"}`,
    formatBRL(row.productTotalCents),
    formatBRL(row.freightTotalCents),
    formatBRL(row.totalCents),
    row.operationTypeLabel,
    row.situationLabel,
    row.omieInvoiceNumber ?? "-",
    omieReference(row)
  ];
}

/**
 * Numero pelo qual a pesagem e procurada no OMIE — e o elo entre os dois sistemas. O
 * numero visivel do documento acompanha o codigo da integracao quando ja e conhecido; e
 * ele que serve na busca do OMIE.
 */
function omieReference(row: WeighingBillingRow): string {
  const visible = row.omieOrderNumber ? ` (nº ${row.omieOrderNumber})` : "";
  if (row.omieSalesOrderId) return `Pedido ${row.omieSalesOrderId}${visible}`;
  if (row.omieServiceOrderId) return `OS ${row.omieServiceOrderId}${visible}`;
  return "-";
}

function situationCells(row: WeighingBillingSituationRow): string[] {
  return [
    WEIGHING_BILLING_SITUATION_LABEL[row.situation],
    num(row.operations),
    num(row.netWeightKg),
    formatBRL(row.totalCents)
  ];
}

/** Rodape alinhado com `ROW_HEADERS`: so as colunas somaveis levam numero. */
/**
 * O rodape TOTAL da lista pesagem a pesagem.
 *
 * Uma celula por coluna de `ROW_HEADERS`, sempre: tinha treze para catorze colunas, e o
 * navegador (e o Excel) encurtavam a linha do total — na pratica a coluna "Pedido/OS OMIE"
 * ficava fora da linha e o alinhamento do rodape saia deslocado em relacao a tabela.
 */
function footerCells(report: WeighingBillingReport): string[] {
  const { totals } = report;
  const cells = [
    "TOTAL",
    "", // Data
    "", // Cliente
    "", // Produto
    "", // Placa
    num(totals.netWeightKg),
    "", // Preco unit.
    formatBRL(totals.productCents),
    formatBRL(totals.freightCents),
    formatBRL(totals.totalCents),
    "", // Tipo
    "", // Situacao
    "", // Nota fiscal
    "" // Pedido/OS OMIE
  ];
  // Uma coluna nova nos cabecalhos tem de aparecer aqui tambem — e nada avisa quando nao
  // aparece: a linha so sai curta, sem erro nenhum.
  while (cells.length < ROW_HEADERS.length) cells.push("");
  return cells.slice(0, ROW_HEADERS.length);
}

function scopeText(report: WeighingBillingReport): string {
  const parts: string[] = [
    report.filters.customerId
      ? (report.rows[0]?.customerName ?? "Cliente selecionado")
      : "Todos os clientes"
  ];
  if (report.filters.situations.length > 0) {
    parts.push(
      report.filters.situations
        .map((situation) => WEIGHING_BILLING_SITUATION_LABEL[situation])
        .join(", ")
    );
  }
  if (report.filters.search) parts.push(`busca "${report.filters.search}"`);
  return parts.join(" - ");
}

function periodText(report: WeighingBillingReport): string {
  const range = `${formatDayLabel(report.startDate)} a ${formatDayLabel(report.endDate)}`;
  return report.periodLabel ? `${report.periodLabel} - ${range}` : range;
}
