import { renderTotalBar } from "./report-total-bar.js";
import type {
  CustomerReport,
  CustomerReportCarrierRow,
  CustomerReportInstallment,
  CustomerReportOperation,
  CustomerReportPaymentRow,
  CustomerReportPeriodRow,
  CustomerReportPlateRow,
  CustomerReportProductDayRow,
  CustomerReportProductRow,
  CustomerReportVariant,
  CustomersOverview,
  CustomersOverviewRow
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
 * A versao `simplified` traz os dados principais (cabecalho, KPIs, produtos com os dias
 * em que foram carregados, materiais por dia, placas com as viagens de cada motorista e
 * evolucao mensal). A `complete`
 * acrescenta transporte, pagamentos, evolucao diaria, a lista operacao a operacao e as
 * canceladas.
 */
export const VARIANT_LABEL: Record<CustomerReportVariant, string> = {
  simplified: "Simplificado",
  complete: "Completo"
};

export const INSTALLMENT_SITUATION_LABEL: Record<CustomerReportInstallment["situation"], string> = {
  overdue: "Vencida",
  today: "Vence hoje",
  upcoming: "A vencer"
};

/**
 * O desktop calcula os vencimentos a partir da condicao de pagamento de cada operacao
 * (mesma regra do pedido enviado ao OMIE), mas nao sabe o que ja foi pago: a baixa dos
 * titulos e do OMIE. A nota deixa isso explicito em todo documento gerado.
 */
export const INSTALLMENT_NOTE =
  "Vencimentos calculados pela condicao de pagamento de cada operacao (mesma regra do pedido " +
  "enviado ao OMIE). A baixa dos titulos e feita no OMIE: uma parcela marcada como vencida " +
  "pode ja ter sido paga.";

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

  const dues = report.installmentTotals;
  const kpis: Array<[string, string]> = [
    ["Carregamentos", totals.operations.toLocaleString("pt-BR")],
    ["Tonelagem", formatTons(totals.netWeightKg)],
    ["Total comprado", formatBRL(totals.totalCents)],
    ["Preco medio", `${formatBRL(totals.avgPriceCentsPerTon)}/t`],
    ["A vencer no periodo", formatBRL(dues.upcomingCents)],
    [
      "Proximo vencimento",
      dues.nextDueDate
        ? `${formatDayLabel(dues.nextDueDate)} - ${formatBRL(dues.nextDueCents)}`
        : "-"
    ],
    ["Vencidas no periodo", formatBRL(dues.overdueCents)],
    ["Parcelas no periodo", dues.installments.toLocaleString("pt-BR")]
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
      "Vencimentos no periodo",
      `${table(
        ["Mes", "Parcelas", "Valor"],
        report.installmentsByMonth.map((row) => [
          formatMonthLabel(row.period),
          num(row.installments),
          formatBRL(row.amountCents)
        ]),
        report.installmentsByMonth.length > 0
          ? ["TOTAL", num(dues.installments), formatBRL(dues.amountCents)]
          : null,
        "Sem parcelas com vencimento no periodo."
      )}<p class="note">${escapeHtml(INSTALLMENT_NOTE)}</p>`
    )
  );

  if (complete) {
    sections.push(
      section(
        "Parcelas a pagar (detalhado)",
        table(
          [
            "Vencimento",
            "Situacao",
            "Parcela",
            "Valor",
            "Data da compra",
            "Produto",
            "Placa",
            "Condicao",
            "Forma",
            "Pedido OMIE"
          ],
          report.installments.map((installment) => installmentCells(installment)),
          null,
          "Sem parcelas com vencimento no periodo."
        )
      )
    );
  }

  sections.push(
    section(
      "Produtos comprados",
      table(
        PRODUCT_HEADERS,
        report.byProduct.map((row) => productCells(row)),
        report.byProduct.length > 0
          ? [
              "TOTAL",
              "",
              num(totals.operations),
              formatDatesSummary(report.byDay.map((row) => row.period)),
              // As linhas somam quilos: o rodape fecha na mesma unidade da coluna.
              num(totals.netWeightKg),
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
      "Materiais por dia",
      table(
        PRODUCT_DAY_HEADERS,
        report.byProductDay.map((row) => productDayCells(row)),
        report.byProductDay.length > 0
          ? [
              "TOTAL",
              "",
              num(totals.operations),
              num(totals.netWeightKg),
              formatBRL(totals.productCents),
              `${formatBRL(totals.avgPriceCentsPerTon)}/t`,
              formatBRL(totals.totalCents)
            ]
          : null,
        "Sem carregamentos no periodo."
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

  sections.push(
    section(
      "Viagens por placa e motorista",
      table(
        TRIP_HEADERS,
        report.tripsByPlate.map((operation) => tripCells(operation)),
        null,
        "Sem viagens no periodo.",
        "detail"
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
  )}</title><style>${documentStyle(complete ? "landscape" : "portrait")}
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
${kpiCards(kpis)}
${sections.join("\n")}
${renderTotalBar([
  { label: "Carregamentos", value: num(totals.operations) },
  { label: "Tonelagem", value: formatTons(totals.netWeightKg) },
  { label: "Produto", value: formatBRL(totals.productCents) },
  { label: "Frete", value: formatBRL(totals.freightCents) },
  { label: "Total comprado", value: formatBRL(totals.totalCents), emphasis: true }
])}
</body></html>`;
}

/**
 * Estilo dos documentos A4 do relatorio por cliente — o individual e o resumo de todos
 * os clientes. Fica num lugar so para os dois sairem da mesma tela com a mesma cara.
 */
function documentStyle(orientation: "portrait" | "landscape"): string {
  return `
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
.note{margin:6px 0 0;font-size:10px;color:var(--muted);font-style:italic}
tfoot td{font-weight:bold;background:#eef2ff;border-top:2px solid var(--brand)}
@page{size:A4 ${orientation};margin:12mm}`;
}

function kpiCards(kpis: Array<[string, string]>): string {
  return `<div class="kpis">${kpis
    .map(
      ([label, value]) =>
        `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    )
    .join("")}</div>`;
}

export function renderCustomerReportSpreadsheet(
  report: CustomerReport,
  variant: CustomerReportVariant,
  generatedAt: Date = new Date()
): string {
  const complete = variant === "complete";
  const { customer, totals } = report;
  const dues = report.installmentTotals;

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
        [
          "Ultima compra",
          totals.lastOperationDate ? formatDayLabel(totals.lastOperationDate) : "-"
        ],
        ["Parcelas com vencimento no periodo", num(dues.installments)],
        ["Valor das parcelas no periodo", formatBRL(dues.amountCents)],
        ["Parcelas vencidas no periodo", num(dues.overdueInstallments)],
        ["Valor vencido no periodo", formatBRL(dues.overdueCents)],
        ["Parcelas a vencer no periodo", num(dues.upcomingInstallments)],
        ["Valor a vencer no periodo", formatBRL(dues.upcomingCents)],
        ["Proximo vencimento", dues.nextDueDate ? formatDayLabel(dues.nextDueDate) : "-"],
        ["Valor do proximo vencimento", formatBRL(dues.nextDueCents)],
        ["Observacao sobre vencimentos", INSTALLMENT_NOTE]
      ]
    )
  );

  blocks.push(
    sheetTable(
      "Vencimentos por mes",
      ["Mes", "Parcelas", "Valor"],
      report.installmentsByMonth.map((row) => [
        formatMonthLabel(row.period),
        num(row.installments),
        formatBRL(row.amountCents)
      ]),
      ["TOTAL", num(dues.installments), formatBRL(dues.amountCents)]
    )
  );

  blocks.push(
    sheetTable(
      "Parcelas a pagar",
      [
        "Vencimento",
        "Situacao",
        "Parcela",
        "Valor",
        "Data da compra",
        "Produto",
        "Placa",
        "Condicao",
        "Forma",
        "Pedido OMIE"
      ],
      report.installments.map((installment) => installmentCells(installment))
    )
  );

  // As mesmas linhas de TOTAL do PDF: quem abre a planilha nao precisa somar a mao para
  // conferir se o bloco fecha com o resumo la de cima.
  const productTotalCells = [
    "TOTAL",
    "",
    num(totals.operations),
    formatDatesSummary(report.byDay.map((row) => row.period)),
    num(totals.netWeightKg),
    formatBRL(totals.productCents),
    `${formatBRL(totals.avgPriceCentsPerTon)}/t`,
    formatBRL(totals.totalCents)
  ];

  blocks.push(
    sheetTable(
      "Produtos",
      PRODUCT_HEADERS,
      report.byProduct.map((row) => productCells(row)),
      productTotalCells
    )
  );

  blocks.push(
    sheetTable(
      "Materiais por dia",
      PRODUCT_DAY_HEADERS,
      report.byProductDay.map((row) => productDayCells(row)),
      [
        "TOTAL",
        "",
        num(totals.operations),
        num(totals.netWeightKg),
        formatBRL(totals.productCents),
        `${formatBRL(totals.avgPriceCentsPerTon)}/t`,
        formatBRL(totals.totalCents)
      ]
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
      "Viagens por placa",
      TRIP_HEADERS,
      report.tripsByPlate.map((operation) => tripCells(operation))
    )
  );

  blocks.push(
    sheetTable(
      "Compras por mes",
      ["Mes", "Carregamentos", "Peso (kg)", "Produto", "Frete", "Total"],
      report.byMonth.map((row) => periodCells(row, formatMonthLabel)),
      [
        "TOTAL",
        num(totals.operations),
        num(totals.netWeightKg),
        formatBRL(totals.productCents),
        formatBRL(totals.freightCents),
        formatBRL(totals.totalCents)
      ]
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

  const subtitle = [
    customer.document,
    `${formatDayLabel(report.startDate)} a ${formatDayLabel(report.endDate)}`,
    report.periodLabel,
    VARIANT_LABEL[variant],
    `Gerado em ${generatedAt.toLocaleString("pt-BR")}`
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    `Relatorio do cliente - ${customer.tradeName || customer.legalName}`
  )}</title><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>${escapeHtml(customer.tradeName || customer.legalName)}</h1>
<p class="sub">${escapeHtml(subtitle)}</p>
${blocks.join("\n")}
<p class="note">${escapeHtml(INSTALLMENT_NOTE)}</p>
</body></html>`;
}

function installmentCells(installment: CustomerReportInstallment): string[] {
  return [
    formatDayLabel(installment.dueDate),
    INSTALLMENT_SITUATION_LABEL[installment.situation],
    `${installment.number}/${installment.installmentCount}`,
    formatBRL(installment.amountCents),
    formatDayLabel(installment.operationDate),
    installment.productDescription,
    installment.plate,
    installment.paymentTermName ?? "-",
    installment.paymentMethodName ?? "-",
    installment.omieSalesOrderId === null ? "-" : String(installment.omieSalesOrderId)
  ];
}

/** Colunas de material, iguais no PDF e na planilha (o resumo e o detalhe por dia). */
const PRODUCT_HEADERS = [
  "Produto",
  "Codigo",
  "Carregamentos",
  "Datas",
  "Peso (kg)",
  "Valor produto",
  "Preco medio/t",
  "Total"
];

const PRODUCT_DAY_HEADERS = [
  "Produto",
  "Dia",
  "Carregamentos",
  "Peso (kg)",
  "Valor produto",
  "Preco medio/t",
  "Total"
];

function productCells(row: CustomerReportProductRow): string[] {
  return [
    row.productDescription,
    row.productCode ?? "-",
    num(row.operations),
    formatDatesSummary(row.dates),
    num(row.netWeightKg),
    formatBRL(row.productCents),
    `${formatBRL(row.avgPriceCentsPerTon)}/t`,
    formatBRL(row.totalCents)
  ];
}

function productDayCells(row: CustomerReportProductDayRow): string[] {
  return [
    row.productDescription,
    formatDayLabel(row.date),
    num(row.operations),
    num(row.netWeightKg),
    formatBRL(row.productCents),
    `${formatBRL(row.avgPriceCentsPerTon)}/t`,
    formatBRL(row.totalCents)
  ];
}

/**
 * Colunas de uma viagem na lista por placa/motorista. A placa e o motorista se repetem em
 * cada linha de proposito: a tabela continua legivel sem o cabecalho do grupo por perto e
 * a planilha pode ser filtrada por qualquer uma das duas.
 */
const TRIP_HEADERS = [
  "Placa",
  "Motorista",
  "Data",
  "Produto",
  "Peso (kg)",
  "Preco/t",
  "Produto (R$)",
  "Frete (R$)",
  "Total (R$)",
  "Tempo"
];

function tripCells(operation: CustomerReportOperation): string[] {
  return [
    operation.plate,
    operation.driverName,
    formatDayLabel(operation.date),
    operation.productDescription,
    num(operation.netWeightKg),
    operation.unitPriceCents === null ? "-" : formatBRL(operation.unitPriceCents),
    formatBRL(operation.productTotalCents),
    formatBRL(operation.freightTotalCents),
    formatBRL(operation.totalCents),
    operation.minutesInside === null ? "-" : formatMinutes(operation.minutesInside)
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

// --- Resumo de todos os clientes no periodo ----------------------------------------

/** Cabecalhos da lista comparativa, iguais no PDF e na planilha. */
const OVERVIEW_HEADERS = [
  "Cliente",
  "CNPJ / CPF",
  "Carregamentos",
  "Tonelagem",
  "Preco medio/t",
  "Total comprado",
  "A vencer",
  "Vencidas"
];

function overviewRowCells(row: CustomersOverviewRow): string[] {
  return [
    row.customer.name,
    row.customer.document ?? "-",
    num(row.totals.operations),
    formatTons(row.totals.netWeightKg),
    formatBRL(row.totals.avgPriceCentsPerTon),
    formatBRL(row.totals.totalCents),
    formatBRL(row.installmentTotals.upcomingCents),
    formatBRL(row.installmentTotals.overdueCents)
  ];
}

function overviewFooterCells(overview: CustomersOverview): string[] {
  return [
    "TOTAL",
    "",
    num(overview.totals.operations),
    formatTons(overview.totals.netWeightKg),
    formatBRL(overview.totals.avgPriceCentsPerTon),
    formatBRL(overview.totals.totalCents),
    formatBRL(overview.installmentTotals.upcomingCents),
    formatBRL(overview.installmentTotals.overdueCents)
  ];
}

/**
 * Materiais de cada cliente no resumo do periodo: o que cada um carregou de cada
 * material, quanto e em que dias. Segue a ordem da lista de clientes (quem mais faturou
 * primeiro) e, dentro do cliente, o material de maior peso primeiro.
 */
const OVERVIEW_PRODUCT_HEADERS = [
  "Cliente",
  "Produto",
  "Codigo",
  "Carregamentos",
  "Datas",
  "Peso (kg)",
  "Preco medio/t",
  "Total"
];

function overviewProductRows(overview: CustomersOverview): string[][] {
  return overview.customers.flatMap((row) =>
    row.byProduct.map((product) => [
      row.customer.name,
      product.productDescription,
      product.productCode ?? "-",
      num(product.operations),
      formatDatesSummary(product.dates),
      num(product.netWeightKg),
      `${formatBRL(product.avgPriceCentsPerTon)}/t`,
      formatBRL(product.totalCents)
    ])
  );
}

function overviewProductFooterCells(overview: CustomersOverview): string[] {
  return [
    "TOTAL",
    "",
    "",
    num(overview.totals.operations),
    "",
    num(overview.totals.netWeightKg),
    `${formatBRL(overview.totals.avgPriceCentsPerTon)}/t`,
    formatBRL(overview.totals.totalCents)
  ];
}

function overviewPeriodText(overview: CustomersOverview): string {
  const dates = `${escapeHtml(formatDayLabel(overview.startDate))} a ${escapeHtml(
    formatDayLabel(overview.endDate)
  )}`;
  return overview.periodLabel ? `${escapeHtml(overview.periodLabel)} &middot; ${dates}` : dates;
}

export function customersOverviewFileBaseName(overview: CustomersOverview): string {
  return `relatorio-clientes-${overview.startDate}-a-${overview.endDate}`;
}

/**
 * Resumo comparativo de todos os clientes do periodo em A4 paisagem: um cliente por
 * linha, do que mais faturou para o que menos faturou, com o total geral no rodape.
 */
export function renderCustomersOverviewHtml(
  overview: CustomersOverview,
  generatedAt: Date = new Date()
): string {
  const { totals } = overview;
  const kpis: Array<[string, string]> = [
    ["Clientes", num(overview.customers.length)],
    ["Carregamentos", num(totals.operations)],
    ["Tonelagem", formatTons(totals.netWeightKg)],
    ["Total comprado", formatBRL(totals.totalCents)]
  ];

  const body = table(
    OVERVIEW_HEADERS,
    overview.customers.map(overviewRowCells),
    overviewFooterCells(overview),
    "Nenhum cliente com movimento no periodo."
  );

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    "Relatorio de clientes no periodo"
  )}</title><style>${documentStyle("landscape")}
</style></head><body>
<div class="header"><div><h1>Relatorio por cliente</h1><p class="customer">Todos os clientes</p><p class="period">${overviewPeriodText(
    overview
  )}</p><span class="badge">Resumo do periodo</span></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
${kpiCards(kpis)}
${section("Clientes no periodo", body)}
${section(
  "Materiais por cliente",
  table(
    OVERVIEW_PRODUCT_HEADERS,
    overviewProductRows(overview),
    overviewProductFooterCells(overview),
    "Nenhum carregamento no periodo."
  )
)}
<p class="note">${escapeHtml(INSTALLMENT_NOTE)}</p>
${renderTotalBar([
  { label: "Clientes", value: num(overview.customers.length) },
  { label: "Carregamentos", value: num(totals.operations) },
  { label: "Tonelagem", value: formatTons(totals.netWeightKg) },
  { label: "A vencer", value: formatBRL(overview.installmentTotals.upcomingCents) },
  { label: "Total comprado", value: formatBRL(totals.totalCents), emphasis: true }
])}
</body></html>`;
}

/** Mesmo resumo em planilha (HTML de tabelas gravado como `.xls`, como os demais). */
export function renderCustomersOverviewSpreadsheet(
  overview: CustomersOverview,
  generatedAt: Date = new Date()
): string {
  const { totals } = overview;
  const productRows = overviewProductRows(overview);
  const blocks = [
    sheetTable(
      "Periodo",
      ["Campo", "Valor"],
      [
        ["Periodo", `${formatDayLabel(overview.startDate)} a ${formatDayLabel(overview.endDate)}`],
        ["Rotulo", overview.periodLabel ?? "-"],
        ["Clientes com movimento", num(overview.customers.length)],
        ["Carregamentos", num(totals.operations)],
        ["Peso liquido (kg)", num(totals.netWeightKg)],
        ["Tonelagem (t)", formatTonsNumber(totals.netWeightKg)],
        ["Total comprado", formatBRL(totals.totalCents)],
        ["Preco medio por tonelada", formatBRL(totals.avgPriceCentsPerTon)],
        ["Parcelas a vencer no periodo", formatBRL(overview.installmentTotals.upcomingCents)],
        ["Parcelas vencidas no periodo", formatBRL(overview.installmentTotals.overdueCents)],
        ["Gerado em", generatedAt.toLocaleString("pt-BR")]
      ]
    ),
    sheetTable(
      "Clientes no periodo",
      OVERVIEW_HEADERS,
      overview.customers.map(overviewRowCells),
      overviewFooterCells(overview)
    ),
    sheetTable(
      "Materiais por cliente",
      OVERVIEW_PRODUCT_HEADERS,
      productRows,
      overviewProductFooterCells(overview)
    )
  ];

  const subtitle = [
    `${formatDayLabel(overview.startDate)} a ${formatDayLabel(overview.endDate)}`,
    overview.periodLabel,
    `${num(overview.customers.length)} cliente(s) com movimento`,
    `Gerado em ${generatedAt.toLocaleString("pt-BR")}`
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    "Relatorio de clientes no periodo"
  )}</title><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>Relatorio por cliente - todos os clientes</h1>
<p class="sub">${escapeHtml(subtitle)}</p>
${blocks.join("\n")}
<p class="note">${escapeHtml(INSTALLMENT_NOTE)}</p>
</body></html>`;
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

/**
 * Estilo das planilhas. O arquivo e HTML de tabelas gravado com extensao `.xls`, entao
 * quem le este CSS e o importador do Excel: ele entende seletor de elemento e de CLASSE,
 * mas nao seletor estrutural — por isso a faixa zebrada e a linha de total vem marcadas
 * linha a linha, e nao com `:nth-child`.
 */
const SPREADSHEET_STYLE = `
body{font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#0f172a;margin:14px}
h1{font-size:16pt;margin:0;color:#1d4ed8}
p.sub{margin:2px 0 0;font-size:10pt;color:#475569}
p.note{margin:10px 0 0;font-size:9pt;color:#64748b;font-style:italic}
h2{font-size:12pt;margin:20px 0 4px;color:#1d4ed8;border-bottom:2px solid #1d4ed8;padding-bottom:2px}
table{border-collapse:collapse;margin:0 0 4px}
th{background:#1d4ed8;color:#ffffff;font-weight:bold;border:1px solid #1e40af;padding:5px 8px;text-align:left}
td{border:1px solid #cbd5e1;padding:4px 8px;mso-number-format:"\\@";vertical-align:top}
tr.alt td{background:#f1f5f9}
th.num,td.num{text-align:right}
tr.total td{font-weight:bold;background:#dbeafe;border-top:2px solid #1d4ed8}
`;

/**
 * Celulas que valem como numero para efeito de ALINHAMENTO (o conteudo continua texto,
 * senao o Excel comeria o zero a esquerda de um codigo e transformaria CNPJ em notacao
 * cientifica): valor, peso, contagem, preco por tonelada, parcela "1/3", duracao, data
 * e mes. Um texto solto na coluna ja a desqualifica — meia coluna alinhada a direita e
 * pior que uma inteira a esquerda.
 */
const NUMERIC_SHEET_CELL = /^-?(r\$\s*)?[\d.,]+(\s*(kg|t|%|\/t|min|h)|\/\d+)?$/i;
const DURATION_SHEET_CELL = /^\d+h\s*\d{1,2}min$/i;
const DAY_SHEET_CELL = /^\d{2}\/\d{2}\/\d{4}$/;
const MONTH_SHEET_CELL = /^\d{2}\/\d{4}$/;

function isNumericSheetColumn(rows: string[][], index: number): boolean {
  let hasValue = false;
  for (const row of rows) {
    const cell = (row[index] ?? "").trim();
    if (!cell || cell === "-") continue;
    if (
      !NUMERIC_SHEET_CELL.test(cell) &&
      !DURATION_SHEET_CELL.test(cell) &&
      !DAY_SHEET_CELL.test(cell) &&
      !MONTH_SHEET_CELL.test(cell)
    ) {
      return false;
    }
    hasValue = true;
  }
  return hasValue;
}

/**
 * Largura da coluna estimada pelo conteudo mais longo. O Excel nao ajusta as colunas de
 * um HTML importado sozinho: sem isto a planilha abre com "#####" nos valores e nomes
 * cortados, que e exatamente o que se quer evitar.
 */
function sheetColumnWidth(header: string, rows: string[][], index: number): number {
  let longest = header.length;
  for (const row of rows) {
    longest = Math.max(longest, (row[index] ?? "").length);
  }
  return Math.min(Math.max(longest * 8 + 22, 72), 360);
}

function sheetTable(
  title: string,
  headers: string[],
  rows: string[][],
  footer: string[] | null = null
): string {
  // A primeira coluna e sempre o rotulo da linha (mes, placa, produto, cliente) e fica a
  // esquerda mesmo quando so tem data ou numero — e por onde se le a tabela.
  const numeric = headers.map((_header, index) => index > 0 && isNumericSheetColumn(rows, index));
  const cellClass = (index: number) => (numeric[index] ? ' class="num"' : "");
  const head = headers
    .map(
      (header, index) =>
        `<th${cellClass(index)} style="width:${sheetColumnWidth(header, rows, index)}px">${escapeHtml(header)}</th>`
    )
    .join("");
  const body = rows.length
    ? rows
        .map(
          (cells, rowIndex) =>
            `<tr${rowIndex % 2 === 1 ? ' class="alt"' : ""}>${cells
              .map((cell, index) => `<td${cellClass(index)}>${escapeHtml(cell)}</td>`)
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${headers.length}">Sem dados no periodo.</td></tr>`;
  // O total fica dentro do `tbody`: `tfoot` importado do HTML nem sempre chega no fim da
  // planilha, e uma linha de total no meio da tabela seria pior que nao ter.
  const foot =
    footer && rows.length
      ? `<tr class="total">${footer
          .map((cell, index) => `<td${cellClass(index)}>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`
      : "";
  return `<h2>${escapeHtml(title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
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

/**
 * Resumo dos dias em que houve carregamento, na ordem em que vieram (mais antigo
 * primeiro): ate dois dias saem escritos ("03/08/2026, 06/08/2026"), dai em diante sai o
 * intervalo com a contagem ("03/08/2026 a 07/08/2026 (4 dias)") — escrever quinze datas
 * numa celula so nao ajudaria ninguem. O dia a dia completo fica na tabela "Materiais
 * por dia".
 *
 * Exportado porque a previa na tela mostra a mesma coluna do PDF e da planilha.
 */
export function formatDatesSummary(dates: readonly string[]): string {
  if (dates.length === 0) return "-";
  if (dates.length <= 2) return dates.map(formatDayLabel).join(", ");
  return `${formatDayLabel(dates[0])} a ${formatDayLabel(dates[dates.length - 1])} (${dates.length} dias)`;
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
