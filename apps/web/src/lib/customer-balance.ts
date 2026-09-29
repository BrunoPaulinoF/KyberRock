/**
 * Saldo do cliente no cadastro do site (cartao Info e ficha Comercial e credito):
 *   - **Credito no KyberRock**: o extrato de credito (fiado / pre-pago), que ja mora na nuvem —
 *     adiantamento espelhado do OMIE entra, venda no credito sai. Mesma soma do `getBalance` da
 *     balanca (`services/credit.ts`).
 *   - **Em aberto no OMIE**: os titulos a receber do cliente, perguntados NA HORA ao OMIE pela
 *     `web-api` (acao `customer_balance`). O numero nao e gravado em lugar nenhum de proposito:
 *     `customers.open_receivables_cents` desce para as balancas e entra na conta do limite de
 *     credito, e um valor do site ali mudaria o bloqueio de venda sem ninguem pedir.
 */

import { callWebApi } from "./api";
import { supabase, type Tables } from "./supabase";

type CreditMovement = Pick<Tables<"customer_credit_movements">, "movement_type" | "amount_cents">;

/** Venda no credito tira do saldo; adiantamento, estorno e acerto poem. */
export function signedCreditCents(movement: CreditMovement): number {
  const amount = movement.amount_cents ?? 0;
  return movement.movement_type === "debit_product" || movement.movement_type === "debit_freight"
    ? -amount
    : amount;
}

export interface CreditBalance {
  balanceCents: number;
  movements: number;
}

export function creditBalance(movements: readonly CreditMovement[]): CreditBalance {
  return {
    balanceCents: movements.reduce((sum, movement) => sum + signedCreditCents(movement), 0),
    movements: movements.length
  };
}

/** O saldo do extrato de credito do cliente (todas as balancas, pela nuvem). */
export async function loadCreditBalance(
  companyId: string,
  customerId: string
): Promise<CreditBalance> {
  const rows: CreditMovement[] = [];
  const PAGE = 1000;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from("customer_credit_movements")
      .select("movement_type, amount_cents")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .order("created_at")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return creditBalance(rows);
}

/** O saldo de UMA nota fiscal; `invoiceNumber` nulo = os titulos sem nota. */
export interface OmieInvoiceBalance {
  invoiceNumber: string | null;
  /** Emissao da nota (aaaa-mm-dd). */
  issueDate: string | null;
  openCents: number;
  openTitles: number;
  overdueCents: number;
  overdueTitles: number;
  nextDueDate: string | null;
}

/** O que o OMIE respondeu sobre os titulos a receber do cliente. */
export type OmieBalance =
  | {
      status: "ok";
      /** Tudo o que falta receber (vencido ou nao). */
      openCents: number;
      openTitles: number;
      /** A parte vencida. */
      overdueCents: number;
      overdueTitles: number;
      /** Proximo vencimento em aberto a partir de hoje (aaaa-mm-dd). */
      nextDueDate: string | null;
      /**
       * O mesmo saldo separado por nota fiscal — "emitimos uma nota de um milhao e duas de
       * quinhentos, e estava tudo junto". Maior saldo primeiro; os sem nota no fim.
       */
      byInvoice: OmieInvoiceBalance[];
      /** Cliente com mais titulos do que a consulta le: o total e parcial. */
      truncated: boolean;
      checkedAt: string;
    }
  /** Cliente sem codigo no OMIE: nao ha onde perguntar. */
  | { status: "not_linked" }
  | { status: "unavailable"; message: string };

function whole(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function invoiceBalances(value: unknown): OmieInvoiceBalance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): OmieInvoiceBalance[] => {
    if (!raw || typeof raw !== "object") return [];
    const group = raw as Record<string, unknown>;
    return [
      {
        invoiceNumber: text(group.invoiceNumber),
        issueDate: text(group.issueDate),
        openCents: whole(group.openCents),
        openTitles: whole(group.openTitles),
        overdueCents: whole(group.overdueCents),
        overdueTitles: whole(group.overdueTitles),
        nextDueDate: text(group.nextDueDate)
      }
    ];
  });
}

/** A resposta da `web-api`, conferida campo a campo (a tela nao confia no formato). */
export function parseOmieBalance(result: Record<string, unknown>): OmieBalance {
  const status = result.status;
  if (status === "not_linked") return { status };
  if (status === "ok") {
    return {
      status,
      openCents: whole(result.openCents),
      openTitles: whole(result.openTitles),
      overdueCents: whole(result.overdueCents),
      overdueTitles: whole(result.overdueTitles),
      nextDueDate: typeof result.nextDueDate === "string" ? result.nextDueDate : null,
      byInvoice: invoiceBalances(result.byInvoice),
      truncated: result.truncated === true,
      checkedAt: typeof result.checkedAt === "string" ? result.checkedAt : new Date().toISOString()
    };
  }
  return {
    status: "unavailable",
    message:
      typeof result.message === "string" && result.message
        ? result.message
        : "O OMIE nao respondeu agora."
  };
}

/**
 * Quanto tempo a resposta do OMIE vale no navegador. Abrir o cartao Info e depois a ficha do
 * mesmo cliente perguntaria duas vezes a mesma coisa — e o OMIE recusa a pergunta repetida
 * ("Consumo redundante") e, se ela insiste, bloqueia a chave da pedreira inteira por meia hora,
 * parando o envio de pedidos das balancas. O botao "Atualizar" passa por cima.
 */
const OMIE_BALANCE_TTL_MS = 2 * 60_000;
const omieBalanceCache = new Map<string, { at: number; value: Promise<OmieBalance> }>();

async function askOmieBalance(customerId: string): Promise<OmieBalance> {
  try {
    return parseOmieBalance(await callWebApi("customer_balance", { customerId }));
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "O OMIE nao respondeu agora."
    };
  }
}

export function loadOmieBalance(
  customerId: string,
  options: { force?: boolean; now?: number } = {}
): Promise<OmieBalance> {
  const now = options.now ?? Date.now();
  const cached = omieBalanceCache.get(customerId);
  if (!options.force && cached && now - cached.at < OMIE_BALANCE_TTL_MS) return cached.value;
  const value = askOmieBalance(customerId).then((balance) => {
    // Falha nao fica guardada: a proxima abertura pergunta de novo.
    if (balance.status === "unavailable") omieBalanceCache.delete(customerId);
    return balance;
  });
  omieBalanceCache.set(customerId, { at: now, value });
  return value;
}
