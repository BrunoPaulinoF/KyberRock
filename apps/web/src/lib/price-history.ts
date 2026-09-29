/**
 * Historico das alteracoes de preco especial (`price_change_log`, migracao `202609280005`).
 *
 * Mexer em preco especial na balanca pede a senha rotativa que o comercial ve no site; aqui o
 * comercial ve o que foi feito com ela — e tambem o que o proprio site alterou. Cada linha e
 * gravada por quem fez a alteracao (a balanca no salvamento, a `web-api` no site) e nunca muda.
 */

import { sanitizeSearchTerm } from "./customer-search";
import { supabase, type Tables } from "./supabase";
import type { Page } from "./use-paged";

export type PriceChange = Tables<"price_change_log">;

/** Tabela que o aviso de cadastro cita quando entra alteracao nova (`useOnCadastroChange`). */
export const PRICE_HISTORY_TABLES = ["price_change_log"] as const;

export type PriceHistorySource = "todas" | "balanca" | "site";

export interface PriceHistoryFilter {
  search: string;
  source: PriceHistorySource;
}

const ACTION_LABELS: Record<string, string> = {
  adicionado: "Adicionado",
  alterado: "Alterado",
  removido: "Excluído"
};

export function priceChangeActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export type PriceChangeTone = "success" | "warning" | "danger" | "info";

/** Tom da etiqueta (`Pill`): entrou, saiu, baixou ou subiu. */
export function priceChangeTone(
  change: Pick<PriceChange, "action" | "old_price_cents" | "new_price_cents">
): PriceChangeTone {
  if (change.action === "adicionado") return "success";
  if (change.action === "removido") return "danger";
  const before = change.old_price_cents;
  const after = change.new_price_cents;
  if (before !== null && after !== null && after < before) return "warning";
  return "info";
}

/** "+7,69%" / "-5,00%" — a variacao do preco, so quando houve troca de valor. */
export function priceChangePercent(
  change: Pick<PriceChange, "old_price_cents" | "new_price_cents">
): string | null {
  const before = change.old_price_cents;
  const after = change.new_price_cents;
  if (before === null || after === null || before === 0) return null;
  const percent = ((after - before) / before) * 100;
  const text = Math.abs(percent).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${percent >= 0 ? "+" : "-"}${text}%`;
}

export function priceChangeSourceLabel(source: string): string {
  return source === "site" ? "KyberRock Web" : "Balança";
}

/** O filtro `or` do PostgREST para a busca (cliente, produto ou quem fez), ou `null`. */
export function priceHistorySearchFilter(search: string): string | null {
  const term = sanitizeSearchTerm(search);
  if (!term.replace(/\*/g, "").trim()) return null;
  return ["customer_name", "product_description", "author_name"]
    .map((column) => `${column}.ilike.*${term}*`)
    .join(",");
}

/** Uma pagina do historico, do mais novo para o mais antigo. */
export async function priceHistoryPage(
  companyId: string,
  filter: PriceHistoryFilter,
  from: number,
  to: number
): Promise<Page<PriceChange>> {
  let query = supabase
    .from("price_change_log")
    .select("*", { count: "exact" })
    .eq("company_id", companyId);
  if (filter.source !== "todas") query = query.eq("source", filter.source);
  const search = priceHistorySearchFilter(filter.search);
  if (search) query = query.or(search);
  const { data, error, count } = await query
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? data?.length ?? 0 };
}
