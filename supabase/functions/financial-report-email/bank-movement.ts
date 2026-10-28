// Movimentacao por banco: o extrato de UMA conta do OMIE (ListarExtrato) virando
// um relatorio proprio — saldo anterior, entradas, saidas, saldo final e a lista
// dos lancamentos. Cada conta escolhida no painel (`companies.financial_bank_accounts`)
// sai como um PDF separado no mesmo envio do relatorio financeiro.
//
// Puro (sem Deno/fetch) para ser testado com vitest, como financial-report.ts.
//
// O formato abaixo e o que o OMIE devolve de verdade (conferido em 28/10/2026 na
// Pedreira Ibiuna), e nao o da documentacao antiga: data em `dDataLancamento`,
// valor COM SINAL em `nValorDocumento`, natureza "P"/"R" (pagar/receber), o nome
// do cliente/fornecedor em `cDesCliente`. O extrato tambem traz linhas de saldo
// ("SALDO ANTERIOR" e "SALDO" de cada dia, valor 0) e os lancamentos so PREVISTOS,
// que nao mexem no saldo da conta.

import {
  formatCentsBRL,
  formatDateBr,
  parseOmieDate,
  toCents,
  type PdfTableData
} from "./financial-report.ts";

export interface StatementMovement {
  date: string | null; // ISO yyyy-mm-dd
  counterpart: string | null;
  category: string | null;
  notes: string | null;
  documentNumber: string | null;
  /** Com sinal: positivo entrou na conta, negativo saiu. */
  amountCents: number;
  runningBalanceCents: number | null;
  status: string | null;
  /** Linha "SALDO ANTERIOR" / "SALDO" que o OMIE intercala no extrato. */
  isBalanceLine: boolean;
  /** Lancamento so previsto (conta a pagar/receber ainda nao baixada): fora do saldo. */
  isForecast: boolean;
}

export interface BankStatement {
  accountCode: number;
  accountName: string;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  /** Lancamentos do periodo, sem as linhas de saldo. */
  movements: StatementMovement[];
}

export interface BankMovementSummary {
  inflowCents: number;
  inflowCount: number;
  /** Total que saiu, em valor positivo. */
  outflowCents: number;
  outflowCount: number;
  forecastCount: number;
  /** Soma com sinal dos previstos que nao entraram no saldo. */
  forecastCents: number;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value);
    if (found !== null) return found;
  }
  return null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

/** O OMIE devolve parte dos textos com entidades HTML ("Transf. Omie.CASH &gt;&gt; Santander"). */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function cleanText(value: unknown): string | null {
  const raw = text(value);
  return raw === null ? null : text(decodeHtmlEntities(raw).replace(/\s+/g, " "));
}

/** A observacao junta trechos com "|" ("|PIX RECEBIDO 161..."); vira uma frase so. */
function cleanNotes(value: unknown): string | null {
  const raw = cleanText(value);
  if (raw === null) return null;
  const parts = raw
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" - ") : null;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Uma linha do `listaMovimentos` do ListarExtrato. */
export function parseStatementMovement(item: Record<string, unknown>): StatementMovement {
  const natureRaw = text(item.cNatureza ?? item.natureza)?.toUpperCase() ?? null;
  // "P"/"R" e o que o extrato manda; "D"/"C" fica aceito por seguranca.
  const direction =
    natureRaw === "P" || natureRaw === "D" ? -1 : natureRaw === "R" || natureRaw === "C" ? 1 : 0;
  const rawCents = toCents(
    item.nValorDocumento ?? item.nValorMovimento ?? item.valorMovimento ?? item.nValor ?? item.valor
  );
  // O valor ja vem com sinal; a natureza so decide quando ele vier sem.
  const amountCents = direction === 0 ? rawCents : direction * Math.abs(rawCents);

  const counterpart = cleanText(firstText(item.cDesCliente, item.cRazCliente));
  const status = cleanText(item.cSituacao);
  const balanceValue = item.nSaldo ?? item.saldo;
  const isBalanceLine =
    direction === 0 &&
    amountCents === 0 &&
    (counterpart === null || /^saldo( anterior)?$/i.test(counterpart));

  return {
    date: parseOmieDate(
      firstText(item.dDataLancamento, item.dData, item.data, item.dDataMovimento)
    ),
    counterpart,
    category: cleanText(item.cDesCategoria),
    notes: cleanNotes(firstText(item.cObservacoes, item.cHistorico, item.historico)),
    documentNumber: cleanText(firstText(item.cNumero, item.cNumDocumento, item.numeroDocumento)),
    amountCents,
    runningBalanceCents:
      balanceValue === null || balanceValue === undefined || balanceValue === ""
        ? null
        : toCents(balanceValue),
    status,
    isBalanceLine,
    isForecast: status !== null && normalizeLabel(status).startsWith("previst")
  };
}

/** Linhas do extrato, venha o array com o nome documentado ou um dos ja vistos. */
export function statementRows(
  response: Record<string, unknown>,
  listKeys: readonly string[]
): Record<string, unknown>[] {
  for (const key of listKeys) {
    const value = response?.[key];
    if (Array.isArray(value)) {
      return value.filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
      );
    }
  }
  return [];
}

/**
 * O retorno inteiro do ListarExtrato de uma conta. Os saldos de abertura e de
 * fechamento vem do proprio OMIE (`nSaldoAnterior` / `nSaldoAtual`, iguais as
 * linhas "SALDO ANTERIOR" e "SALDO" do fim do periodo) — o relatorio nao recalcula.
 */
export function parseBankStatement(
  response: Record<string, unknown>,
  account: { code: number; name: string },
  listKeys: readonly string[]
): BankStatement {
  const all = statementRows(response, listKeys).map(parseStatementMovement);
  const balanceLines = all.filter((movement) => movement.isBalanceLine);

  const topLevelCents = (key: string): number | null => {
    const value = response?.[key];
    return value === null || value === undefined || value === "" ? null : toCents(value);
  };

  return {
    accountCode: account.code,
    accountName: cleanText(response?.cDescricao) ?? account.name,
    openingBalanceCents:
      topLevelCents("nSaldoAnterior") ?? balanceLines[0]?.runningBalanceCents ?? null,
    closingBalanceCents:
      topLevelCents("nSaldoAtual") ?? balanceLines.at(-1)?.runningBalanceCents ?? null,
    movements: all.filter((movement) => !movement.isBalanceLine)
  };
}

/** Entradas e saidas do que de fato passou pela conta; previsto fica a parte. */
export function summarizeBankMovement(statement: BankStatement): BankMovementSummary {
  const summary: BankMovementSummary = {
    inflowCents: 0,
    inflowCount: 0,
    outflowCents: 0,
    outflowCount: 0,
    forecastCount: 0,
    forecastCents: 0
  };
  for (const movement of statement.movements) {
    if (movement.isForecast) {
      summary.forecastCount += 1;
      summary.forecastCents += movement.amountCents;
    } else if (movement.amountCents > 0) {
      summary.inflowCount += 1;
      summary.inflowCents += movement.amountCents;
    } else if (movement.amountCents < 0) {
      summary.outflowCount += 1;
      summary.outflowCents -= movement.amountCents;
    }
  }
  return summary;
}

function balanceLabel(cents: number | null): string {
  return cents === null ? "-" : formatCentsBRL(cents);
}

/** Linhas de resumo do topo do PDF e da legenda do WhatsApp. */
export function bankMovementSummaryLines(
  statement: BankStatement,
  summary: BankMovementSummary
): string[] {
  return [
    `Saldo anterior: ${balanceLabel(statement.openingBalanceCents)}`,
    `Entradas: ${formatCentsBRL(summary.inflowCents)} (${summary.inflowCount})`,
    `Saídas: ${formatCentsBRL(summary.outflowCents)} (${summary.outflowCount})`,
    `Saldo final: ${balanceLabel(statement.closingBalanceCents)}`
  ];
}

/** Lancamentos realizados, na ordem do extrato, com o saldo de cada linha. */
export function buildBankMovementTable(statement: BankStatement): PdfTableData {
  const rows = statement.movements
    .filter((movement) => !movement.isForecast)
    .map((movement) => [
      formatDateBr(movement.date),
      movement.counterpart ?? "-",
      movement.category ?? "-",
      movement.notes ?? movement.documentNumber ?? "-",
      formatCentsBRL(movement.amountCents),
      balanceLabel(movement.runningBalanceCents)
    ]);
  return {
    columns: [
      { header: "Data", width: 52 },
      { header: "Cliente / Fornecedor", width: 124 },
      { header: "Categoria", width: 92 },
      { header: "Observação", width: 119.28 },
      { header: "Valor", width: 68, align: "right" },
      { header: "Saldo", width: 68, align: "right" }
    ],
    rows
  };
}

/** Rodape do PDF: o que o extrato trouxe so como previsto, e por isso ficou fora do saldo. */
export function bankMovementFootnote(summary: BankMovementSummary): string | undefined {
  if (summary.forecastCount === 0) return undefined;
  return `Fora do saldo: ${summary.forecastCount} lançamento(s) só previsto(s) no OMIE (${formatCentsBRL(summary.forecastCents)}).`;
}

export function bankMovementTitle(accountName: string): string {
  return `Movimentação bancária - ${accountName}`;
}

/** Nome do arquivo no WhatsApp/e-mail: so letras, numeros e hifen. */
export function bankMovementFilename(accountName: string, periodStart: string): string {
  const slug = accountName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `movimentacao-${slug || "conta"}-${periodStart}.pdf`;
}

export function buildBankMovementCaption(input: {
  companyName: string;
  periodLabel: string;
  statement: BankStatement;
  summary: BankMovementSummary;
}): string {
  return [
    `*${bankMovementTitle(input.statement.accountName)} - ${input.periodLabel}*`,
    input.companyName,
    ...bankMovementSummaryLines(input.statement, input.summary)
  ].join("\n");
}
