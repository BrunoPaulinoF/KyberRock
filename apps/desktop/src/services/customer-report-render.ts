import {
  SPREADSHEET_STYLE,
  documentStyle,
  escapeHtml,
  formatBRL,
  formatDayLabel,
  formatKg,
  formatMonthLabel,
  formatTons,
  formatTonsNumber,
  kpiCards,
  num,
  section,
  sheetTable,
  slug,
  table
} from "./report-document.js";
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
  const name = slug(report.customer.tradeName || report.customer.legalName, "cliente");
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
