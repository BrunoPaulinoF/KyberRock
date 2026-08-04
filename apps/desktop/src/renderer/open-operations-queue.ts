import type { WeighingOperationSummary } from "../services/weighing-operations";

import { parseDbTimestamp } from "./format-datetime";

/**
 * Busca e ordenacao da fila de Operacoes em aberto.
 *
 * O operador procura o caminhao pela placa que esta vendo no patio (ou no papel na mao)
 * e digita do jeito que der: com hifen, sem hifen, minusculo, com espaco no meio. Por
 * isso a comparacao acontece com a placa reduzida a letras e numeros dos dois lados.
 */
export function normalizePlateSearch(value: string): string {
  // O NFD separa o acento da letra e o filtro seguinte descarta tudo que nao e letra
  // ou numero — inclusive o acento solto, o hifen e o espaco.
  return value
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

type OpenOperationPlate = Pick<WeighingOperationSummary, "plate">;
type OpenOperationLoaderState = Pick<WeighingOperationSummary, "loaderCompletedAt">;

/** True quando a placa da operacao contem o trecho digitado (busca parcial). */
export function matchesOpenOperationPlate(operation: OpenOperationPlate, search: string): boolean {
  const term = normalizePlateSearch(search);
  if (!term) return true;
  return normalizePlateSearch(operation.plate ?? "").includes(term);
}

export function filterOpenOperationsByPlate<T extends OpenOperationPlate>(
  operations: T[],
  search: string
): T[] {
  if (!normalizePlateSearch(search)) return operations;
  return operations.filter((operation) => matchesOpenOperationPlate(operation, search));
}

/**
 * Momento em que o carregador concluiu a carga, em milissegundos. `null` enquanto a
 * carga ainda esta em andamento. Uma data invalida conta como concluida (a luz verde
 * ja acendeu na linha), mas vai para o fim do bloco das concluidas por nao ter posicao
 * confiavel na fila.
 */
function loaderCompletedTime(operation: OpenOperationLoaderState): number | null {
  const completedAt = operation.loaderCompletedAt;
  if (!completedAt) return null;
  const time = parseDbTimestamp(completedAt).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * Sobe para o topo da fila as cargas que o carregador ja deu como carregadas: a
 * primeira concluida fica na primeira linha e as seguintes vao enfileirando logo
 * abaixo, na ordem em que foram concluidas — e essa a ordem em que os caminhoes
 * chegam na balanca para o fechamento. As que ainda estao em andamento seguem
 * depois, mantendo a ordem que ja vinha do banco (entrada mais recente primeiro).
 */
export function sortOpenOperationsByLoaderQueue<T extends OpenOperationLoaderState>(
  operations: T[]
): T[] {
  return operations
    .map((operation, index) => ({ operation, index, completedAt: loaderCompletedTime(operation) }))
    .sort((a, b) => {
      if (a.completedAt === null || b.completedAt === null) {
        if (a.completedAt !== null) return -1;
        if (b.completedAt !== null) return 1;
        return a.index - b.index;
      }
      return a.completedAt - b.completedAt || a.index - b.index;
    })
    .map((entry) => entry.operation);
}
