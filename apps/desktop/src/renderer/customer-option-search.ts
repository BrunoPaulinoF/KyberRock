import { rankSearchMatches } from "@kyberrock/shared";

import type { CustomerReportOption } from "../services/customer-report";

/**
 * A busca de cliente das telas de relatorio (Relatorio por cliente, Fechamento,
 * Conferencia de faturamento).
 *
 * As tres carregavam o cadastro INTEIRO e pintavam um `<option>` por cliente num `<select>`
 * nativo: a lista abria com todos os clientes, e escolher era rolar milhares de linhas —
 * duas delas nem barra de pesquisa tinham. Aqui a lista passa a ser o resultado da busca,
 * ordenado por proximidade e cortado num tamanho que a tela aguenta.
 */

/** Campos pesquisaveis de um cliente da lista, com o peso de cada um. */
const CUSTOMER_OPTION_FIELDS = [
  { key: "name", weight: 1 },
  { key: "document", weight: 0.7 }
];

/**
 * Quantos clientes o seletor mostra de uma vez.
 *
 * Vale tanto para a lista em repouso quanto para o resultado da busca: cinquenta linhas
 * cabem numa rolagem curta, e quem nao acha nas cinquenta acha digitando — nao rolando.
 */
export const CUSTOMER_OPTION_LIMIT = 50;

export interface CustomerOptionPage {
  /** O que o seletor mostra, ja ordenado. */
  options: CustomerReportOption[];
  /** Quantos clientes casaram ao todo — pode ser mais do que `options`. */
  total: number;
}

/**
 * Filtra, ordena e corta a lista de clientes de um seletor.
 *
 * O cliente JA ESCOLHIDO entra sempre, mesmo que nao case com a busca e mesmo que esteja
 * fora do corte: sem isso, digitar qualquer coisa na busca depois de escolher tirava a
 * opcao selecionada do `<select>` — e o navegador, sem a opcao correspondente, mostrava o
 * campo em branco, como se ninguem tivesse sido escolhido.
 */
export function rankCustomerOptions(
  customers: readonly CustomerReportOption[],
  search: string,
  selectedId: string,
  limit: number = CUSTOMER_OPTION_LIMIT
): CustomerOptionPage {
  const matches = rankSearchMatches(customers, CUSTOMER_OPTION_FIELDS, search, {
    tieBreak: (a, b) => a.name.localeCompare(b.name, "pt-BR")
  });

  const options = matches.slice(0, limit);
  const selected = selectedId
    ? (customers.find((customer) => customer.id === selectedId) ?? null)
    : null;
  if (selected && !options.some((option) => option.id === selected.id)) {
    options.unshift(selected);
  }

  return { options, total: matches.length };
}

/** O rotulo de uma linha do seletor: nome e, quando houver, o documento que o separa. */
export function customerOptionLabel(customer: CustomerReportOption): string {
  return customer.document ? `${customer.name} - ${customer.document}` : customer.name;
}
