import type {
  CustomerReport,
  CustomerReportCarrierRow,
  CustomerReportOperation,
  CustomerReportPaymentRow,
  CustomerReportPeriodRow,
  CustomerReportPlateRow,
  CustomerReportProductRow,
  CustomerReportVariant
} from "./customer-report.js";

/**
 * Renderizacao do relatorio por cliente em dois formatos:
 *
 * - `renderCustomerReportHtml`: documento A4 para virar PDF (a mesma rota do
 *   `renderHtmlToPdf` do main, usada pelos relatorios de Insights e caminhoes).
 * - `renderCustomerReportSpreadsheet`: HTML de tabelas gravado com extensao `.xls`
 *   — o mesmo truque ja usado em `desktop:export-report-excel`, que o Excel abre
 *   nativamente sem exigir dependencia nova.
 *
 * A versao `simplified` traz os dados principais (cabecalho, KPIs, produtos, placas e
 * evolucao mensal). A `complete` acrescenta transporte, pagamentos, evolucao diaria,
 * a lista operacao a operacao e as canceladas.
 */
export const VARIANT_LABEL: Record<CustomerReportVariant, string> = {
  simplified: "Simplificado",
  complete: "Completo"
};

export function customerReportFileBaseName(
  report: CustomerReport,
  variant: CustomerReportVariant
): string {
  const name = slug(report.customer.tradeName || report.customer.legalName || "cliente");
  return `relatorio-cliente-${name}-${variant === "complete" ? "completo" : "simplificado"}-${report.startDate}-a-${report.endDate}`;
}

export function renderCustomerReportHtml(
  report: CustomerReport,
  variant: CustomerReportVariant,
  generatedAt: Date = new Date()
): string {
  const complete = variant === "complete";
  const { customer, totals } = report;

  const identityRows: Array<[string, string]> = [
    ["Razao social", customer.legalName || "-"],
    ["Nome fantasia", customer.tradeName || "-"],
    ["CNPJ / CPF", customer.document ?? "-"],
    ["Telefone", customer.phone ?? "-"]
  ];
  if (complete) {
    identityRows.push(
      ["E-mail", customer.email ?? "-"],
      ["Endereco", customer.addressLine ?? "-"],
      ["Cidade / UF", [customer.city, customer.state].filter(Boolean).join(" / ") || "-"],
      ["Condicao de pagamento padrao", customer.defaultPaymentTermName ?? "-"],
      ["Transportadora padrao", customer.defaultCarrierName ?? "-"],
      [
        "Limite de credito",
        customer.creditLimitCents === null ? "-" : formatBRL(customer.creditLimitCents)
      ],
      ["Titulos em aberto", formatBRL(customer.openReceivablesCents)],
      ["Codigo OMIE", customer.omieCustomerId === null ? "-" : String(customer.omieCustomerId)]
    );
  }

  const kpis: Array<[string, string]> = [
    ["Carregamentos", totals.operations.toLocaleString("pt-BR")],
    ["Tonelagem", formatTons(totals.netWeightKg)],
    ["Total comprado", formatBRL(totals.totalCents)],
    ["Preco medio", `${formatBRL(totals.avgPriceCentsPerTon)}/t`]
  ];
  if (complete) {
    kpis.push(
      ["Valor em produto", formatBRL(totals.productCents)],
      ["Valor em frete", formatBRL(totals.freightCents)],
      ["Ticket medio", formatBRL(totals.avgTicketCents)],
      ["Peso medio por viagem", formatKg(totals.avgNetWeightKg)]
    );
  }

  const sections: string[] = [];

  sections.push(
    section(
      "Cadastro do cliente",
      `<table class="kv"><tbody>${identityRows
        .map(
          ([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
        )
        .join("")}</tbody></table>`
    )
  );

  sections.push(
    section(
      "Produtos comprados",
      table(
        ["Produto", "Codigo", "Carregamentos", "Peso", "Valor produto", "Preco medio", "Total"],
        report.byProduct.map((row) => productCells(row)),
        report.byProduct.length > 0
          ? [
              "TOTAL",
              "",
              num(totals.operations),
              formatTons(totals.netWeightKg),
              formatBRL(totals.productCents),
              `${formatBRL(totals.avgPriceCentsPerTon)}/t`,
              formatBRL(totals.totalCents)
            ]
          : null,
        "Sem produtos no periodo."
      )
    )
  );

  sections.push(
    section(
      "Placas",
      table(
        ["Placa", "Motorista", "Transportadora", "Viagens", "Peso", "Tempo medio", "Total"],
        report.byPlate.map((row) => plateCells(row)),
        null,
        "Sem placas no periodo."
      )
    )
  );

  if (complete) {
    sections.push(
      section(
        "Transporte por transportadora",
        table(
          ["Transportadora", "CNPJ / CPF", "Viagens", "Peso", "Frete", "Placas"],
          report.byCarrier.map((row) => carrierCells(row)),
          null,
          "Sem transporte no periodo."
        )
      )
    );

    sections.push(
      section(
        "Tipos de frete",
        table(
          ["Tipo de frete", "Carregamentos", "Peso", "Total"],
          report.byFreightModality.map((row) => paymentCells(row)),
          null,
          "Sem frete no periodo."
        )
      )
    );

    sections.push(
      section(
        "Pagamentos por forma",
        table(
          ["Forma de pagamento", "Carregamentos", "Peso", "Total"],
          report.byPaymentMethod.map((row) => paymentCells(row)),
          null,
          "Sem pagamentos no periodo."
        )
      )
    );

    sections.push(
      section(
        "Pagamentos por condicao",
        table(
          ["Condicao de pagamento", "Carregamentos", "Peso", "Total"],
          report.byPaymentTerm.map((row) => paymentCells(row)),
          null,
          "Sem condicoes no periodo."
        )
      )
    );
  }

  sections.push(
    section(
      "Compras por mes",
      table(
        ["Mes", "Carregamentos", "Peso", "Produto", "Frete", "Total"],
        report.byMonth.map((row) => periodCells(row, formatMonthLabel)),
        null,
        "Sem compras no periodo."
      )
    )
  );

  if (complete) {
    sections.push(
      section(
        "Compras por dia",
        table(
          ["Dia", "Carregamentos", "Peso", "Produto", "Frete", "Total"],
          report.byDay.map((row) => periodCells(row, formatDayLabel)),
          null,
          "Sem compras no periodo."
        )
      )
    );

    sections.push(
      section(
        "Operacoes (detalhado)",
        table(
          [
            "Data",
            "Operacao",
            "Tipo",
            "Produto",
            "Placa",
            "Motorista",
            "Transportadora",
            "Frete",
            "Entrada (kg)",
            "Saida (kg)",
            "Liquido (kg)",
            "Tempo",
            "Preco/t",
            "Tabela",
            "Produto (R$)",
            "Frete (R$)",
            "Total (R$)",
            "Forma",
            "Condicao",
            "Pedido OMIE",
            "Status"
          ],
          report.operations.map((operation) => operationCells(operation)),
          null,
          "Sem operacoes no periodo.",
          "detail"
        )
      )
    );

    sections.push(
      section(
        "Operacoes canceladas",
        table(
          ["Data", "Produto", "Placa", "Motorista", "Liquido (kg)", "Motivo"],
          report.cancelledOperations.map((operation) => [
            formatDayLabel(operation.date),
            operation.productDescription,
            operation.plate,
            operation.driverName,
            num(operation.netWeightKg),
            operation.cancelReason ?? "-"
          ]),
          null,
          "Sem cancelamentos no periodo."
        )
      )
    );
  }

  const periodText = report.periodLabel
    ? `${escapeHtml(report.periodLabel)} &middot; ${escapeHtml(
        formatDayLabel(report.startDate)
      )} a ${escapeHtml(formatDayLabel(report.endDate))}`
    : `${escapeHtml(formatDayLabel(report.startDate))} a ${escapeHtml(
        formatDayLabel(report.endDate)
      )}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    `Relatorio do cliente - ${customer.tradeName || customer.legalName}`
  )}</title><style>
:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;--brand:#1d4ed8}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:var(--ink);margin:0;font-size:12px}
.header{display:flex;justify-content:space-between;align-items:flex-end;border-left:6px solid var(--brand);padding:4px 0 14px 14px;margin-bottom:8px;border-bottom:2px solid var(--line)}
.header h1{margin:0;font-size:22px;letter-spacing:.2px}
.header .customer{margin:6px 0 0;font-size:15px;font-weight:700}
.header .period{margin:4px 0 0;color:var(--muted);font-size:13px}
.header .generated{color:var(--muted);font-size:11px;text-align:right;white-space:nowrap}
.badge{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;background:var(--brand);color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0 8px}
.kpi{border:1px solid var(--line);border-top:3px solid var(--brand);border-radius:10px;padding:10px 12px;background:var(--soft)}
.kpi span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.kpi strong{display:block;margin-top:4px;font-size:18px}
section{margin-top:18px;break-inside:avoid}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px;font-weight:800}
table{width:100%;border-collapse:collapse;font-size:12px}
table.detail{font-size:9px}
table.detail th,table.detail td{padding:4px 5px}
th,td{border:1px solid var(--line);padding:7px 9px;text-align:left}
th{background:var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.03em}
table.kv th{width:220px;background:var(--soft);font-size:11px}
tbody tr:nth-child(even){background:var(--soft)}
tr{break-inside:avoid}
.num{text-align:right;white-space:nowrap}
.empty{text-align:center;color:var(--muted);font-style:italic}
tfoot td{font-weight:bold;background:#eef2ff;border-top:2px solid var(--brand)}
@page{size:A4 ${complete ? "landscape" : "portrait"};margin:12mm}
</style></head><body>
<div class="header"><div><h1>Relatorio do cliente</h1><p class="customer">${escapeHtml(
    customer.tradeName || customer.legalName
  )}${
    customer.document ? ` &middot; ${escapeHtml(customer.document)}` : ""
  }</p><p class="period">${periodText}</p><span class="badge">${escapeHtml(
    VARIANT_LABEL[variant]
  )}</span></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
<div class="kpis">${kpis
    .map(
      ([label, value]) =>
        `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    )
    .join("")}</div>
${sections.join("\n")}
</body></html>`;
}

export function renderCustomerReportSpreadsheet(
  report: CustomerReport,
  variant: CustomerReportVariant,
  generatedAt: Date = new Date()
): string {
  const complete = variant === "complete";
  const { customer, totals } = report;

  const blocks: string[] = [];

  blocks.push(
    sheetTable(
      "Cliente",
      ["Campo", "Valor"],
      [
        ["Razao social", customer.legalName || "-"],
        ["Nome fantasia", customer.tradeName || "-"],
        ["CNPJ / CPF", customer.document ?? "-"],
        ["Telefone", customer.phone ?? "-"],
        ["E-mail", customer.email ?? "-"],
        ["Endereco", customer.addressLine ?? "-"],
        ["Cidade / UF", [customer.city, customer.state].filter(Boolean).join(" / ") || "-"],
        ["Condicao de pagamento padrao", customer.defaultPaymentTermName ?? "-"],
        ["Transportadora padrao", customer.defaultCarrierName ?? "-"],
        ["Periodo", `${formatDayLabel(report.startDate)} a ${formatDayLabel(report.endDate)}`],
        ["Modelo", VARIANT_LABEL[variant]],
        ["Gerado em", generatedAt.toLocaleString("pt-BR")]
      ]
    )
  );

  blocks.push(
    sheetTable(
      "Resumo",
      ["Indicador", "Valor"],
      [
        ["Carregamentos", num(totals.operations)],
        ["Peso liquido (kg)", num(totals.netWeightKg)],
        ["Tonelagem (t)", formatTonsNumber(totals.netWeightKg)],
        ["Valor produto", formatBRL(totals.productCents)],
        ["Valor frete", formatBRL(totals.freightCents)],
        ["Total comprado", formatBRL(totals.totalCents)],
        ["Preco medio por tonelada", formatBRL(totals.avgPriceCentsPerTon)],
        ["Ticket medio", formatBRL(totals.avgTicketCents)],
        ["Peso medio por viagem (kg)", num(totals.avgNetWeightKg)],
        ["Operacoes com nota", num(totals.invoiceOperations)],
        ["Operacoes internas", num(totals.internalOperations)],
        ["Operacoes canceladas", num(totals.cancelledOperations)],
        [
          "Primeira compra",
          totals.firstOperationDate ? formatDayLabel(totals.firstOperationDate) : "-"
        ],
        ["Ultima compra", totals.lastOperationDate ? formatDayLabel(totals.lastOperationDate) : "-"]
      ]
    )
  );

  blocks.push(
    sheetTable(
      "Produtos",
      [
        "Produto",
        "Codigo",
        "Carregamentos",
        "Peso (kg)",
        "Valor produto",
        "Preco medio/t",
        "Total"
      ],
      report.byProduct.map((row) => productCells(row))
    )
  );

  blocks.push(
    sheetTable(
      "Placas",
      ["Placa", "Motorista", "Transportadora", "Viagens", "Peso (kg)", "Tempo medio", "Total"],
      report.byPlate.map((row) => plateCells(row))
    )
  );

  blocks.push(
    sheetTable(
      "Compras por mes",
      ["Mes", "Carregamentos", "Peso (kg)", "Produto", "Frete", "Total"],
      report.byMonth.map((row) => periodCells(row, formatMonthLabel))
    )
  );

  if (complete) {
    blocks.push(
      sheetTable(
        "Transporte",
        ["Transportadora", "CNPJ / CPF", "Viagens", "Peso (kg)", "Frete", "Placas"],
        report.byCarrier.map((row) => carrierCells(row))
      )
    );
    blocks.push(
      sheetTable(
        "Tipos de frete",
        ["Tipo de frete", "Carregamentos", "Peso (kg)", "Total"],
        report.byFreightModality.map((row) => paymentCells(row))
      )
    );
    blocks.push(
      sheetTable(
        "Pagamentos por forma",
        ["Forma de pagamento", "Carregamentos", "Peso (kg)", "Total"],
        report.byPaymentMethod.map((row) => paymentCells(row))
      )
    );
    blocks.push(
      sheetTable(
        "Pagamentos por condicao",
        ["Condicao de pagamento", "Carregamentos", "Peso (kg)", "Total"],
        report.byPaymentTerm.map((row) => paymentCells(row))
      )
    );
    blocks.push(
      sheetTable(
        "Compras por dia",
        ["Dia", "Carregamentos", "Peso (kg)", "Produto", "Frete", "Total"],
        report.byDay.map((row) => periodCells(row, formatDayLabel))
      )
    );
    blocks.push(
      sheetTable(
        "Operacoes",
        [
          "Data",
          "Operacao",
          "Tipo",
          "Produto",
          "Placa",
          "Motorista",
          "Transportadora",
          "Frete",
          "Entrada (kg)",
          "Saida (kg)",
          "Liquido (kg)",
          "Tempo",
          "Preco/t",
          "Tabela",
          "Produto (R$)",
          "Frete (R$)",
          "Total (R$)",
          "Forma",
          "Condicao",
          "Pedido OMIE",
          "Status"
        ],
        report.operations.map((operation) => operationCells(operation))
      )
    );
    blocks.push(
      sheetTable(
        "Canceladas",
        ["Data", "Produto", "Placa", "Motorista", "Liquido (kg)", "Motivo"],
        report.cancelledOperations.map((operation) => [
          formatDayLabel(operation.date),
          operation.productDescription,
          operation.plate,
          operation.driverName,
          num(operation.netWeightKg),
          operation.cancelReason ?? "-"
        ])
      )
    );
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    `Relatorio do cliente - ${customer.tradeName || customer.legalName}`
  )}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12px}
h2{font-size:13px;margin:18px 0 4px}
table{border-collapse:collapse}
th,td{border:1px solid #94a3b8;padding:4px 6px;text-align:left;mso-number-format:"\\@"}
th{background:#e2e8f0;font-weight:bold}
</style></head><body>
<h1>Relatorio do cliente - ${escapeHtml(customer.tradeName || customer.legalName)} (${escapeHtml(
    VARIANT_LABEL[variant]
  )})</h1>
${blocks.join("\n")}
</body></html>`;
}

function productCells(row: CustomerReportProductRow): string[] {
  return [
    row.productDescription,
    row.productCode ?? "-",
    num(row.operations),
    num(row.netWeightKg),
    formatBRL(row.productCents),
    `${formatBRL(row.avgPriceCentsPerTon)}/t`,
    formatBRL(row.totalCents)
  ];
}

function plateCells(row: CustomerReportPlateRow): string[] {
  return [
    row.plate,
    row.driverName ?? "-",
    row.carrierName ?? "-",
    num(row.operations),
    num(row.netWeightKg),
    formatMinutes(row.avgMinutes),
    formatBRL(row.totalCents)
  ];
}

function carrierCells(row: CustomerReportCarrierRow): string[] {
  return [
    row.carrierName,
    row.carrierDocument ?? "-",
    num(row.operations),
    num(row.netWeightKg),
    formatBRL(row.freightCents),
    row.plates.join(", ") || "-"
  ];
}

function paymentCells(row: CustomerReportPaymentRow): string[] {
  return [row.name, num(row.operations), num(row.netWeightKg), formatBRL(row.totalCents)];
}

function periodCells(row: CustomerReportPeriodRow, labelOf: (period: string) => string): string[] {
  return [
    labelOf(row.period),
    num(row.operations),
    num(row.netWeightKg),
    formatBRL(row.productCents),
    formatBRL(row.freightCents),
    formatBRL(row.totalCents)
  ];
}

function operationCells(operation: CustomerReportOperation): string[] {
  return [
    formatDayLabel(operation.date),
    operation.id.slice(0, 8),
    operation.operationTypeLabel,
    operation.productDescription,
    operation.plate,
    operation.driverName,
    operation.carrierName ?? "-",
    [operation.freightModalityLabel, operation.freightDestination].filter(Boolean).join(" - "),
    operation.entryWeightKg === null ? "-" : num(operation.entryWeightKg),
    operation.exitWeightKg === null ? "-" : num(operation.exitWeightKg),
    num(operation.netWeightKg),
    operation.minutesInside === null ? "-" : formatMinutes(operation.minutesInside),
    operation.unitPriceCents === null ? "-" : formatBRL(operation.unitPriceCents),
    operation.priceTableName ?? "-",
    formatBRL(operation.productTotalCents),
    formatBRL(operation.freightTotalCents),
    formatBRL(operation.totalCents),
    operation.paymentMethodName ?? "-",
    operation.paymentTermName ?? "-",
    operation.omieSalesOrderId === null ? "-" : String(operation.omieSalesOrderId),
    operation.statusLabel
  ];
}

function section(title: string, body: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

/**
 * Tabela do PDF. A primeira coluna fica alinhada a esquerda e as demais a direita
 * quando o conteudo e numerico (todas as tabelas do relatorio seguem esse formato).
 */
function table(
  headers: string[],
  rows: string[][],
  footer: string[] | null,
  emptyMessage: string,
  className?: string
): string {
  const head = headers
    .map((header, index) => `<th${index === 0 ? "" : ' class="num"'}>${escapeHtml(header)}</th>`)
    .join("");
  const body = rows.length
    ? rows
        .map(
          (cells) =>
            `<tr>${cells
              .map(
                (cell, index) => `<td${index === 0 ? "" : ' class="num"'}>${escapeHtml(cell)}</td>`
              )
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td class="empty" colspan="${headers.length}">${escapeHtml(emptyMessage)}</td></tr>`;
  const foot =
    footer && rows.length
      ? `<tfoot><tr>${footer
          .map((cell, index) => `<td${index === 0 ? "" : ' class="num"'}>${escapeHtml(cell)}</td>`)
          .join("")}</tr></tfoot>`
      : "";
  return `<table${className ? ` class="${className}"` : ""}><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

function sheetTable(title: string, headers: string[], rows: string[][]): string {
  const body = rows.length
    ? rows
        .map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")
    : `<tr><td colspan="${headers.length}">Sem dados no periodo.</td></tr>`;
  return `<h2>${escapeHtml(title)}</h2><table><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function num(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatTons(kg: number): string {
  return `${formatTonsNumber(kg)} t`;
}

function formatTonsNumber(kg: number): string {
  return (kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatKg(kg: number): string {
  return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}min`;
}

/** "2026-07-15" -> "15/07/2026"; devolve a entrada crua fora do formato ISO. */
function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** "2026-07" -> "07/2026". */
function formatMonthLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 2) return iso;
  const [year, month] = parts;
  return `${month}/${year}`;
}

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "cliente"
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
