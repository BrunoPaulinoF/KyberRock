/**
 * Filtro da aba "Operacoes concluidas" do site, feito NO BANCO: sem data escolhida a lista mostra
 * todas as pesagens concluidas da unidade, da mais nova para a mais antiga, 50 por vez ("Ver
 * mais") — trazer o historico inteiro para filtrar na tela seria o que deixa a tela pesada.
 */

import { sanitizeSearchTerm } from "./customer-search";
import { periodToIso } from "./format";

/**
 * O periodo escolhido em instantes (fuso da pedreira). Cada ponta e opcional: so "De" vai ate
 * hoje, so "Ate" vem desde o comeco, nenhuma traz tudo. Datas invertidas sao trocadas — quem
 * escolheu 30/09 a 01/09 quer o mes, nao uma lista vazia.
 */
export function closedPeriodBounds(
  startDay: string,
  endDay: string
): { startIso: string | null; endIso: string | null } {
  const [from, to] =
    startDay && endDay && startDay > endDay ? [endDay, startDay] : [startDay, endDay];
  return {
    startIso: from ? periodToIso(from, from).startIso : null,
    endIso: to ? periodToIso(to, to).endIso : null
  };
}

/**
 * O recorte pela data de FECHAMENTO (a da venda, a que sobe ao OMIE), com a pesagem antiga sem
 * `closed_at` entrando pela criacao — a mesma regra de `q.closedOperations`. `null` sem periodo.
 */
export function closedPeriodFilter(bounds: {
  startIso: string | null;
  endIso: string | null;
}): string | null {
  if (!bounds.startIso && !bounds.endIso) return null;
  const range = (column: string) =>
    [
      bounds.startIso ? `${column}.gte."${bounds.startIso}"` : null,
      bounds.endIso ? `${column}.lt."${bounds.endIso}"` : null
    ]
      .filter(Boolean)
      .join(",");
  return [`and(${range("closed_at")})`, `and(closed_at.is.null,${range("created_at")})`].join(",");
}

/**
 * Busca por cliente, produto ou placa (a placa sem hifen nem espaco, como e gravada) e, quando o
 * texto e um numero ("4521", "NF 4521", "NF-e 004521"), pela nota fiscal — que a conferencia
 * grava sem os zeros da esquerda.
 */
export function closedSearchFilter(search: string): string | null {
  const term = sanitizeSearchTerm(search);
  if (!term.replace(/\*/g, "").trim()) return null;
  const like = `*${term}*`;
  const parts = [`customer_name.ilike.${like}`, `product_description.ilike.${like}`];
  const plate = term.replace(/[\s-]/g, "");
  if (plate.replace(/\*/g, "")) parts.push(`plate.ilike.*${plate}*`);
  const invoice = /^(?:nf-?e?\s*)?0*(\d+)$/i.exec(term.trim());
  if (invoice) parts.push(`omie_invoice_number.eq.${invoice[1]}`);
  return parts.join(",");
}
