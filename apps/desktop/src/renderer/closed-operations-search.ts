import type { WeighingOperationSummary } from "../services/weighing-operations";

/**
 * Busca da tela de Operacoes concluidas. O operador procura pelo que tem em maos: o
 * nome do cliente, o CNPJ/CPF do cupom (digitado com ou sem pontuacao) ou o produto.
 * Placa e motorista entram junto porque estao na mesma linha da tabela e o operador
 * naturalmente cola a placa no campo de busca.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * True quando a operacao casa com o termo. Termos com varias palavras casam por
 * conjuncao ("joao brita" acha o cliente Joao com o produto Brita), e um termo so de
 * digitos tambem e comparado com o CNPJ/CPF sem pontuacao.
 */
export function matchesClosedOperationSearch(
  operation: Pick<
    WeighingOperationSummary,
    "customerName" | "customerDocument" | "productDescription" | "plate" | "driverName"
  >,
  search: string
): boolean {
  const terms = normalizeSearchText(search).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = normalizeSearchText(
    [
      operation.customerName,
      operation.customerDocument ?? "",
      operation.productDescription,
      operation.plate,
      operation.driverName
    ].join(" ")
  );
  const documentDigits = onlyDigits(operation.customerDocument ?? "");

  return terms.every((term) => {
    if (haystack.includes(term)) return true;
    const digits = onlyDigits(term);
    return digits.length > 0 && documentDigits.includes(digits);
  });
}

export function filterClosedOperationsBySearch<
  T extends Pick<
    WeighingOperationSummary,
    "customerName" | "customerDocument" | "productDescription" | "plate" | "driverName"
  >
>(operations: T[], search: string): T[] {
  if (!search.trim()) return operations;
  return operations.filter((operation) => matchesClosedOperationSearch(operation, search));
}
