// Logica pura (sem Deno/fetch) do relatorio financeiro OMIE: monta as tabelas
// do PDF de contas a pagar (curado — so os campos essenciais) e do extrato
// (sem tratamento — reflete os lancamentos do OMIE). Fica fora do index.ts
// para poder ser testada com vitest, igual truck-report.ts em daily-report-email.

export type AccountPayableStatus = "paid" | "partial" | "overdue" | "open";

export interface AccountPayableItem {
  id: number;
  supplierOmieCode: number | null;
  documentNumber: string | null;
  dueDate: string | null; // ISO yyyy-mm-dd
  amountCents: number;
  paidAmountCents: number;
  status: AccountPayableStatus;
}

export interface StatementEntryItem {
  accountName: string;
  date: string | null; // ISO yyyy-mm-dd
  description: string | null;
  documentNumber: string | null;
  nature: "D" | "C" | null;
  amountCents: number;
  runningBalanceCents: number | null;
}

export interface PdfTableColumn {
  header: string;
  width: number;
  align?: "left" | "right";
}

export interface PdfTableData {
  columns: PdfTableColumn[];
  rows: string[][];
}

const STATUS_LABEL: Record<AccountPayableStatus, string> = {
  paid: "Pago",
  partial: "Parcial",
  overdue: "Vencido",
  open: "Em aberto"
};

export function formatCentsBRL(cents: number): string {
  // Intl.NumberFormat("pt-BR") usa NBSP (U+00A0) entre "R$" e o valor; troca
  // por espaco comum para nao surpreender a codificacao WinAnsi das fontes do
  // pdf-lib nem exibir estranho em texto puro (WhatsApp).
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(cents / 100)
    .replace(/\u00a0/gi, " ");
}

export function formatDateBr(isoDate: string | null): string {
  if (!isoDate) return "-";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Curadoria das contas a pagar: so as colunas essenciais (fornecedor,
 * documento, vencimento, valor em aberto, status), ordenadas por vencimento.
 * O retorno bruto do OMIE traz dezenas de campos (distribuicao por categoria,
 * flags de bloqueio, etc.) que nao interessam a quem le o relatorio.
 */
export function buildAccountsPayableTable(
  items: AccountPayableItem[],
  supplierNames: Map<number, string>
): PdfTableData {
  const sorted = [...items].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const rows = sorted.map((item) => [
    (item.supplierOmieCode !== null ? supplierNames.get(item.supplierOmieCode) : null) ??
      (item.supplierOmieCode !== null ? `Fornecedor #${item.supplierOmieCode}` : "-"),
    item.documentNumber ?? "-",
    formatDateBr(item.dueDate),
    formatCentsBRL(item.amountCents - item.paidAmountCents),
    STATUS_LABEL[item.status]
  ]);
  return {
    columns: [
      { header: "Fornecedor", width: 190 },
      { header: "Documento", width: 80 },
      { header: "Vencimento", width: 70 },
      { header: "Valor em aberto", width: 90, align: "right" },
      { header: "Status", width: 93 }
    ],
    rows
  };
}

export function accountsPayableTotalsCents(items: AccountPayableItem[]): {
  openCents: number;
  overdueCents: number;
} {
  let openCents = 0;
  let overdueCents = 0;
  for (const item of items) {
    const balance = item.amountCents - item.paidAmountCents;
    if (balance <= 0) continue;
    openCents += balance;
    if (item.status === "overdue") overdueCents += balance;
  }
  return { openCents, overdueCents };
}

/**
 * Extrato sem tratamento: todas as colunas relevantes do lancamento
 * (data, historico, documento, natureza, valor, saldo), sem filtrar linhas.
 */
export function buildStatementTable(entries: StatementEntryItem[]): PdfTableData {
  const rows = entries.map((entry) => [
    formatDateBr(entry.date),
    entry.accountName,
    entry.description ?? "-",
    entry.documentNumber ?? "-",
    entry.nature === "D" ? "Debito" : entry.nature === "C" ? "Credito" : "-",
    formatCentsBRL(entry.amountCents),
    entry.runningBalanceCents !== null ? formatCentsBRL(entry.runningBalanceCents) : "-"
  ]);
  return {
    columns: [
      { header: "Data", width: 45 },
      { header: "Conta", width: 75 },
      { header: "Historico", width: 150 },
      { header: "Documento", width: 60 },
      { header: "Natureza", width: 50 },
      { header: "Valor", width: 65, align: "right" },
      { header: "Saldo", width: 68, align: "right" }
    ],
    rows
  };
}

/**
 * Corpo da chamada ListarExtrato (/financas/extrato/).
 *
 * O tipo eccListarExtratoRequest aceita apenas conta e periodo — nao tem
 * paginacao. Mandar `pagina`/`registros_por_pagina` fazia a OMIE recusar a
 * chamada inteira com "Tag [PAGINA] nao faz parte da estrutura do tipo complexo
 * [eccListarExtratoRequest]", derrubando o relatorio financeiro todo dia. As
 * datas vao no formato dd/mm/aaaa da OMIE.
 */
export function buildStatementRequestParam(input: {
  accountCode: number;
  startDateBr: string;
  endDateBr: string;
}): Record<string, unknown> {
  return {
    nCodCC: input.accountCode,
    dPeriodoInicial: input.startDateBr,
    dPeriodoFinal: input.endDateBr
  };
}

/** Nomes ja vistos para o array de movimentos do extrato; `listaMovimentos` e o documentado. */
export const STATEMENT_LIST_KEYS = [
  "listaMovimentos",
  "listaMovimento",
  "lista_movimento",
  "movimentos",
  "extrato"
];

/** Destinatario que tem por onde receber: e-mail ligado com e-mail, ou WhatsApp ligado com numero. */
export function hasActiveChannel(recipient: {
  email: string | null;
  whatsappPhone: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
}): boolean {
  return Boolean(
    (recipient.sendEmail && recipient.email) || (recipient.sendWhatsapp && recipient.whatsappPhone)
  );
}

/**
 * Motivo registrado quando nenhum envio saiu apesar de existir destinatario com
 * canal ativo: sempre o erro real acumulado (OMIE, SMTP, WhatsApp). Registrar
 * "sem canais ativos" nesse caso escondia a falha verdadeira e fazia o envio
 * quebrar todo dia sem ninguem saber por que.
 */
export function dispatchFailureReason(errors: readonly string[]): string {
  const joined = errors.filter((entry) => entry.trim().length > 0).join(" | ");
  return joined.length > 0 ? joined : "Falha ao montar o relatorio financeiro do OMIE";
}

export function buildFinancialWhatsappCaption(input: {
  companyName: string;
  periodLabel: string;
  accountsPayableCount: number;
  accountsPayableOpenCents: number;
  accountsPayableOverdueCents: number;
  statementEntriesCount: number;
}): string {
  const lines = [
    `*Relatorio financeiro (OMIE) - ${input.periodLabel}*`,
    input.companyName,
    `Contas a pagar em aberto: ${input.accountsPayableCount} (${formatCentsBRL(input.accountsPayableOpenCents)})`
  ];
  if (input.accountsPayableOverdueCents > 0) {
    lines.push(`Vencidas: ${formatCentsBRL(input.accountsPayableOverdueCents)}`);
  }
  lines.push(`Extrato: ${input.statementEntriesCount} lancamento(s) no periodo.`);
  return lines.join("\n");
}
