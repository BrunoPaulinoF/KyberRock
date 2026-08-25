import type { KyberRockDesktopApi } from "../preload/api-types";
import type { CacheEntityType } from "../services/cache-store";

/**
 * Le do cache TODAS as linhas de um cadastro, paginando ate cobrir `total`.
 *
 * Reservado aos cadastros pequenos e fechados — formas de pagamento, condicoes, contas,
 * transportadoras — em que a tela precisa da lista inteira para decidir alguma coisa (qual
 * forma e "credito do cliente", qual condicao ja existe com aquelas parcelas) e nao apenas
 * para mostrar ao operador.
 *
 * Nao use para cliente, produto, placa ou motorista: la a lista e grande, quem procura e o
 * operador, e o caminho e a busca (`queryCache` com `search`), nao a leitura completa.
 *
 * O que isto conserta: essas leituras usavam um `limit` fixo de 200 ou 500 e um `.find()`
 * em cima do resultado. Passado esse numero, o `.find()` nao achava o que existia — e o
 * caso pior nao era so nao achar: `resolveConditionTermId` CRIAVA uma condicao de pagamento
 * nova toda vez que a existente ficava fora da pagina, enchendo o cadastro de duplicatas.
 */
const CACHE_PAGE_SIZE = 500;

/** Guarda contra `total` inconsistente: 20 paginas cobrem 10 mil linhas. */
const MAX_PAGES = 20;

export async function readAllCacheRows<T>(
  desktopApi: Pick<KyberRockDesktopApi, "queryCache">,
  entityType: CacheEntityType,
  options: { activeOnly?: boolean } = {}
): Promise<T[]> {
  const rows: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await desktopApi.queryCache({
      entityType,
      activeOnly: options.activeOnly ?? false,
      limit: CACHE_PAGE_SIZE,
      offset: page * CACHE_PAGE_SIZE
    });
    const pageRows = (result.rows as T[]) ?? [];
    rows.push(...pageRows);
    if (pageRows.length < CACHE_PAGE_SIZE) break;
    if (rows.length >= result.total) break;
  }

  return rows;
}
