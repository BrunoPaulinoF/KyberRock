import { rankByText, searchTerms } from "@kyberrock/shared";

import type { WeighingOperationSummary } from "../services/weighing-operations";

/**
 * Busca da tela de Operacoes concluidas. O operador procura pelo que tem em maos: o
 * nome do cliente, o CNPJ/CPF do cupom (digitado com ou sem pontuacao) ou o produto.
 * Placa e motorista entram junto porque estao na mesma linha da tabela e o operador
 * naturalmente cola a placa no campo de busca.
 */

/** Os campos que a busca varre, na ordem em que aparecem na linha da tabela. */
type SearchableOperation = Pick<
  WeighingOperationSummary,
  "customerName" | "customerDocument" | "productDescription" | "plate" | "driverName"
>;

/** O texto pesquisavel de uma linha — o mesmo para casar e para pontuar. */
function searchTextOf(operation: SearchableOperation): string {
  return [
    operation.customerName,
    operation.customerDocument ?? "",
    operation.productDescription,
    operation.plate,
    operation.driverName
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * True quando a operacao casa com o termo. Termos com varias palavras casam por
 * conjuncao ("joao brita" acha o cliente Joao com o produto Brita), e um termo so de
 * digitos tambem e comparado com o CNPJ/CPF sem pontuacao.
 */
export function matchesClosedOperationSearch(
  operation: SearchableOperation,
  search: string
): boolean {
  if (searchTerms(search).length === 0) return true;
  return rankByText([operation], searchTextOf, search).length === 1;
}

/**
 * Filtra e ORDENA as operacoes concluidas pela proximidade com o que foi digitado.
 *
 * A ordem importa porque a tela lista o historico inteiro: procurar "levisa" trazia as
 * cargas da Levisa espalhadas na ordem cronologica, junto com as da "Transportadora Levisa
 * Norte", e o operador tinha de ler linha a linha. Empate mantem a ordem que veio — que e
 * a cronologica da consulta.
 */
export function filterClosedOperationsBySearch<T extends SearchableOperation>(
  operations: T[],
  search: string
): T[] {
  if (!search.trim()) return operations;
  return rankByText(operations, searchTextOf, search);
}
