// Saldo do cliente no OMIE: o que ele ainda deve (titulos a receber em aberto).
//
// O site mostra esse numero no cadastro do cliente (cartao Info e ficha Comercial e credito).
// E perguntado NA HORA, pela `web-api` -> `omie-sync` (acao `customer_open_receivables`), e nao
// e gravado: `customers.open_receivables_cents` desce para as balancas e entra na conta do
// limite de credito (`financial-block.ts` do desktop), e um valor vindo do site ali mudaria o
// bloqueio de venda sem ninguem pedir.
//
// O total sozinho nao servia ao comercial: "emitimos uma nota de um milhao, outra de quinhentos
// e outra de quinhentos, e esta juntando tudo" (29/09). Por isso o saldo vem tambem SEPARADO
// POR NOTA FISCAL (`byInvoice`): cada titulo diz de que nota nasceu (`numero_documento_fiscal`,
// ou a chave de acesso), e o titulo sem nota fica num grupo proprio.
//
// Puro (sem Deno/fetch) para ser testado com vitest, como `omie-customer-advances.ts`.

import { mapOmieReceivableRaw, type OmieReceivableRaw } from "./omie-customer-advances.ts";

/** O que a nota fiscal de um titulo precisa: o numero ou a chave de acesso da NF-e. */
export type OmieReceivableInvoiceRaw = OmieReceivableRaw & {
  numero_documento_fiscal?: string | number;
  numeroDocumentoFiscal?: string | number;
  chave_nfe?: string;
  chaveNfe?: string;
};

/** O saldo de UMA nota fiscal (ou dos titulos sem nota, com `invoiceNumber` nulo). */
export interface OpenInvoiceGroup {
  /** Numero da NF-e sem os zeros a esquerda; null = titulos sem nota fiscal. */
  invoiceNumber: string | null;
  /** A emissao mais antiga dos titulos da nota (aaaa-mm-dd). */
  issueDate: string | null;
  openCents: number;
  openTitles: number;
  overdueCents: number;
  overdueTitles: number;
  /** O proximo vencimento em aberto a partir de hoje (aaaa-mm-dd). */
  nextDueDate: string | null;
}

export interface OpenReceivablesSummary {
  /** Tudo o que falta receber (vencido ou nao), em centavos. */
  openCents: number;
  openTitles: number;
  /** A parte com vencimento ANTES de hoje. */
  overdueCents: number;
  overdueTitles: number;
  /** O proximo vencimento em aberto a partir de hoje (aaaa-mm-dd); o vencido conta a parte. */
  nextDueDate: string | null;
  /** O mesmo saldo separado por nota fiscal: maior saldo primeiro, os sem nota no fim. */
  byInvoice: OpenInvoiceGroup[];
}

function digits(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\D/g, "")
    : "";
}

/**
 * O numero da nota fiscal de onde o titulo nasceu. Primeiro o campo proprio
 * (`numero_documento_fiscal`); sem ele, a chave de acesso da NF-e, que traz o numero nas
 * posicoes 26 a 34. Zeros a esquerda caem, como na coluna "Nota fiscal" das pesagens.
 */
export function receivableInvoiceNumber(raw: OmieReceivableInvoiceRaw): string | null {
  const direct = digits(raw.numero_documento_fiscal ?? raw.numeroDocumentoFiscal).replace(
    /^0+/,
    ""
  );
  if (direct) return direct;
  const key = digits(raw.chave_nfe ?? raw.chaveNfe);
  if (key.length === 44) {
    const fromKey = key.slice(25, 34).replace(/^0+/, "");
    if (fromKey) return fromKey;
  }
  return null;
}

type Totals = Omit<OpenInvoiceGroup, "invoiceNumber" | "issueDate">;

function emptyTotals(): Totals {
  return { openCents: 0, openTitles: 0, overdueCents: 0, overdueTitles: 0, nextDueDate: null };
}

function addTitle(totals: Totals, open: number, dueDate: string | null, todayIso: string): void {
  totals.openCents += open;
  totals.openTitles += 1;
  if (dueDate && dueDate < todayIso) {
    totals.overdueCents += open;
    totals.overdueTitles += 1;
  } else if (dueDate && (!totals.nextDueDate || dueDate < totals.nextDueDate)) {
    totals.nextDueDate = dueDate;
  }
}

/**
 * Soma os titulos a receber em aberto de um cliente — no total e por nota fiscal.
 *
 * O saldo de cada titulo e o valor do documento menos o que ja foi baixado (baixa parcial
 * conta); titulo cancelado ou quitado fica de fora. O mesmo titulo em duas paginas (a
 * listagem do OMIE nao e uma foto) entra uma vez so. `todayIso` e o dia de hoje no fuso da
 * pedreira: vence hoje ainda nao e vencido.
 */
export function summarizeOpenReceivables(
  rows: ReadonlyArray<OmieReceivableInvoiceRaw>,
  todayIso: string
): OpenReceivablesSummary {
  const total = emptyTotals();
  const groups = new Map<string, OpenInvoiceGroup>();
  const seen = new Set<number>();
  for (const raw of rows) {
    const title = mapOmieReceivableRaw(raw);
    if (!title || title.cancelled || seen.has(title.id)) continue;
    seen.add(title.id);
    const open = title.amountCents - title.receivedAmountCents;
    if (open <= 0) continue;
    addTitle(total, open, title.dueDate, todayIso);

    const invoiceNumber = receivableInvoiceNumber(raw);
    const key = invoiceNumber ?? "";
    const group = groups.get(key) ?? { invoiceNumber, issueDate: null, ...emptyTotals() };
    addTitle(group, open, title.dueDate, todayIso);
    if (title.issueDate && (!group.issueDate || title.issueDate < group.issueDate)) {
      group.issueDate = title.issueDate;
    }
    groups.set(key, group);
  }
  const byInvoice = [...groups.values()].sort(
    (a, b) =>
      Number(a.invoiceNumber === null) - Number(b.invoiceNumber === null) ||
      b.openCents - a.openCents ||
      (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "", "pt-BR", { numeric: true })
  );
  return { ...total, byInvoice };
}

/** O dia de hoje (aaaa-mm-dd) no fuso da pedreira — e por ele que um titulo esta vencido. */
export function quarryToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}
