import type { WeighingOperationSummary } from "../services/weighing-operations";

/** Um produto e quantas operacoes dele estao abertas na balanca agora. */
export interface OpenOperationsProductCount {
  /** Chave estavel da lista: o id do produto, ou a descricao quando a operacao nao tem cadastro. */
  key: string;
  label: string;
  count: number;
}

/** Produto sem cadastro vinculado (operacao antiga ou projetada da nuvem). */
const UNKNOWN_PRODUCT_LABEL = "Sem produto";

/**
 * Quantas operacoes abertas existem de cada produto, para o cabecalho da fila: o
 * operador olha uma vez e sabe quantos caminhoes de cada brita estao no patio, sem
 * precisar contar linha por linha.
 *
 * Agrupa pelo `productId` quando ele existe — duas operacoes do mesmo cadastro contam
 * juntas mesmo que a descricao tenha sido editada entre uma e outra — e pela descricao
 * normalizada quando nao existe. Ordena do maior para o menor (a maior fila primeiro) e,
 * no empate, em ordem alfabetica, para a barra nao dancar a cada atualizacao.
 */
export function countOpenOperationsByProduct(
  operations: Array<Pick<WeighingOperationSummary, "productId" | "productDescription">>
): OpenOperationsProductCount[] {
  const counts = new Map<string, OpenOperationsProductCount>();

  for (const operation of operations) {
    const label = operation.productDescription?.trim() || UNKNOWN_PRODUCT_LABEL;
    const key = operation.productId ?? `descricao:${label.toLowerCase()}`;
    const current = counts.get(key);
    if (current) {
      current.count++;
    } else {
      counts.set(key, { key, label, count: 1 });
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")
  );
}
