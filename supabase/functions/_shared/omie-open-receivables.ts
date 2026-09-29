// Saldo do cliente no OMIE: o que ele ainda deve (titulos a receber em aberto).
//
// O site mostra esse numero no cadastro do cliente (cartao Info e ficha Comercial e credito).
// E perguntado NA HORA, pela `web-api` -> `omie-sync` (acao `customer_open_receivables`), e nao
// e gravado: `customers.open_receivables_cents` desce para as balancas e entra na conta do
// limite de credito (`financial-block.ts` do desktop), e um valor vindo do site ali mudaria o
// bloqueio de venda sem ninguem pedir.
//
// Puro (sem Deno/fetch) para ser testado com vitest, como `omie-customer-advances.ts`.

import { mapOmieReceivableRaw, type OmieReceivableRaw } from "./omie-customer-advances.ts";

export interface OpenReceivablesSummary {
  /** Tudo o que falta receber (vencido ou nao), em centavos. */
  openCents: number;
  openTitles: number;
  /** A parte com vencimento ANTES de hoje. */
  overdueCents: number;
  overdueTitles: number;
  /** O proximo vencimento em aberto a partir de hoje (aaaa-mm-dd); o vencido conta a parte. */
  nextDueDate: string | null;
}

/**
 * Soma os titulos a receber em aberto de um cliente.
 *
 * O saldo de cada titulo e o valor do documento menos o que ja foi baixado (baixa parcial
 * conta); titulo cancelado ou quitado fica de fora. O mesmo titulo em duas paginas (a
 * listagem do OMIE nao e uma foto) entra uma vez so. `todayIso` e o dia de hoje no fuso da
 * pedreira: vence hoje ainda nao e vencido.
 */
export function summarizeOpenReceivables(
  rows: ReadonlyArray<OmieReceivableRaw>,
  todayIso: string
): OpenReceivablesSummary {
  const summary: OpenReceivablesSummary = {
    openCents: 0,
    openTitles: 0,
    overdueCents: 0,
    overdueTitles: 0,
    nextDueDate: null
  };
  const seen = new Set<number>();
  for (const raw of rows) {
    const title = mapOmieReceivableRaw(raw);
    if (!title || title.cancelled || seen.has(title.id)) continue;
    seen.add(title.id);
    const open = title.amountCents - title.receivedAmountCents;
    if (open <= 0) continue;
    summary.openCents += open;
    summary.openTitles += 1;
    if (title.dueDate && title.dueDate < todayIso) {
      summary.overdueCents += open;
      summary.overdueTitles += 1;
    } else if (title.dueDate && (!summary.nextDueDate || title.dueDate < summary.nextDueDate)) {
      summary.nextDueDate = title.dueDate;
    }
  }
  return summary;
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
