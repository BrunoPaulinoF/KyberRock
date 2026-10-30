import {
  NO_CHARGE_KIND_LABEL,
  RECEIVABLE_KIND_LABEL,
  type CashClosingAccount,
  type CashClosingReport
} from "./cash-closing-model.js";
import {
  documentStyle,
  escapeHtml,
  formatBRL,
  formatDayLabel,
  formatTons,
  kpiCards,
  num,
  section,
  table
} from "./report-document.js";

/**
 * PDF A4 do fechamento do caixa: o que entrou em cada conta, o conferido e a diferenca, o
 * que ficou a receber e o que saiu sem entrada de dinheiro — com espaco para as assinaturas,
 * porque a folha impressa e o comprovante da conferencia entre quem fecha o caixa e quem
 * recebe o dinheiro.
 */
export function renderCashClosingHtml(
  report: CashClosingReport,
  unitName: string,
  generatedAt: Date = new Date()
): string {
  const counted = report.saved?.countedCents ?? {};
  const countedTotal = report.accounts.reduce(
    (sum, account) => sum + (counted[account.key] ?? 0),
    0
  );
  const hasCounted = report.accounts.some((account) => account.key in counted);

  const kpis: Array<[string, string]> = [
    ["Vendas do dia", num(report.operations)],
    ["Peso vendido", formatTons(report.netWeightKg)],
    ["Vendido", formatBRL(report.soldCents)],
    ["Recebido hoje (sistema)", formatBRL(report.receivedCents)]
  ];

  const accountRows = report.accounts.map((account) => accountCells(account, counted));
  const accountFooter = [
    "TOTAL",
    "",
    formatBRL(report.receivedCents),
    hasCounted ? formatBRL(countedTotal) : "-",
    hasCounted ? signedBRL(countedTotal - report.receivedCents) : "-"
  ];

  const notes = report.saved?.notes?.trim()
    ? `<p style="white-space:pre-wrap;margin:0">${escapeHtml(report.saved.notes)}</p>`
    : '<p class="note">Sem observacoes.</p>';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(
    "Fechamento do caixa"
  )}</title><style>${documentStyle("portrait")}
.signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}
.signatures div{border-top:1px solid var(--ink);padding-top:6px;text-align:center;font-size:11px}
</style></head><body>
<div class="header"><div><h1>Fechamento do caixa</h1><p class="customer">${escapeHtml(
    unitName
  )}</p><p class="period">Dia: ${escapeHtml(formatDayLabel(report.date))}${
    report.saved
      ? ` - conferencia salva em ${escapeHtml(new Date(report.saved.savedAt).toLocaleString("pt-BR"))}`
      : " - conferencia ainda nao salva"
  }</p></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
${kpiCards(kpis)}
${section(
  "Recebido hoje, por conta",
  table(
    ["Conta", "Formas", "Sistema", "Conferido", "Diferenca"],
    accountRows,
    accountFooter,
    "Nenhum recebimento na hora neste dia."
  )
)}
${section(
  "A receber (nao entrou no caixa hoje)",
  table(
    ["Tipo", "Forma", "Vendas", "Valor"],
    report.receivables.map((line) => [
      RECEIVABLE_KIND_LABEL[line.kind],
      line.paymentMethodName,
      num(line.operations),
      formatBRL(line.totalCents)
    ]),
    ["TOTAL", "", "", formatBRL(report.receivableCents)],
    "Nada a receber das vendas deste dia."
  )
)}
${section(
  "Sem entrada de dinheiro",
  table(
    ["Motivo", "Vendas", "Valor"],
    report.noCharge.map((line) => [
      NO_CHARGE_KIND_LABEL[line.kind],
      num(line.operations),
      formatBRL(line.totalCents)
    ]),
    ["TOTAL", "", formatBRL(report.noChargeCents)],
    "Nenhuma venda sem entrada de dinheiro."
  )
)}
${section("Observacoes", notes)}
<div class="signatures"><div>Responsavel pelo caixa</div><div>Conferido por</div></div>
</body></html>`;
}

export function cashClosingFileName(report: CashClosingReport): string {
  return `fechamento-caixa-${report.date}.pdf`;
}

function accountCells(account: CashClosingAccount, counted: Record<string, number>): string[] {
  const methods = [
    ...account.sales.map((line) => `${line.paymentMethodName} ${formatBRL(line.totalCents)}`),
    ...account.walletSettlements.map(
      (line) => `Carteira (${line.paymentMethodName}) ${formatBRL(line.totalCents)}`
    )
  ].join("; ");
  const value = counted[account.key];
  return [
    account.accountName,
    methods,
    formatBRL(account.expectedCents),
    value === undefined ? "-" : formatBRL(value),
    value === undefined ? "-" : signedBRL(value - account.expectedCents)
  ];
}

/** Diferenca com sinal: sobra positiva, falta negativa, zero sem sinal. */
export function signedBRL(cents: number): string {
  if (cents === 0) return formatBRL(0);
  return `${cents > 0 ? "+" : "-"}${formatBRL(Math.abs(cents))}`;
}
