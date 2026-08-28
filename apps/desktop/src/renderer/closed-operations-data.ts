import type { KyberRockDesktopApi } from "../preload/api-types";
import type { WeighingOperationSummary } from "../services/weighing-operations";
import type { OmieDeliveryState } from "./omie-delivery-notifications";

/**
 * A carga da aba "Concluidas".
 *
 * Antes a tela pedia a lista INTEIRA de operacoes concluidas e derivava dela tudo: a
 * tabela, o alerta fiscal, o seletor de produtos, os numeros do painel e os avisos de
 * envio ao OMIE. Como o custo da consulta e proporcional as linhas devolvidas (medido com
 * 20 mil operacoes: 897 ms contra 42 ms com `LIMIT 200`), e como o SQLite do desktop e
 * SINCRONO, isso travava o processo principal do Electron -- o mesmo que le a balanca --
 * por quase um segundo, a cada 15 s, para sempre.
 *
 * Aqui cada consumidor ganha o SEU recorte, todos pequenos e todos exatos:
 *
 * - `page` / `total`: a tabela, paginada.
 * - `omieAttention`: superconjunto do alerta fiscal (ver
 *   `listClosedOperationsNeedingOmieAttention`); a tela aplica nele a mesma
 *   `getFiscalBillingStatus` de sempre.
 * - `products`: o seletor, por `SELECT DISTINCT`.
 * - `recent`: serve o painel (numeros do dia e atividade recente) e os avisos de envio ao
 *   OMIE. Inclui explicitamente as operacoes ainda PENDENTES do ciclo anterior: e o que
 *   torna o aviso exato em vez de "quase sempre certo" -- a operacao pendente precisa
 *   continuar visivel no ciclo em que ela muda de estado, mesmo que ja tenha saido da
 *   janela de tempo.
 *
 * O modulo nao conhece React: recebe a API do preload e devolve dados.
 */

/** Tamanho da primeira pagina da tabela. */
export const CLOSED_PAGE_SIZE = 100;

/**
 * Janela do recorte recente: 24 horas.
 *
 * E o que o painel precisa para os numeros "de hoje" -- hoje comecou, no maximo, 24 h
 * atras, entao a janela cobre o dia inteiro em qualquer fuso, e cobre EXATAMENTE.
 *
 * Uma janela maior seria desperdicio: nada mais depende dela. A atividade recente do
 * painel tem a propria consulta (`listRecentClosedWeighingOperations`), que continua certa
 * mesmo num dia parado; e o aviso de envio ao OMIE alcanca a operacao fechada dias atras
 * pelos ids das pendentes, nao pela janela.
 */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Quantas operacoes a atividade recente do painel busca. Folga sobre as 5 que ele mostra,
 * para o corte por `updatedAt` continuar sendo dele e nao da consulta.
 */
export const RECENT_ACTIVITY_LIMIT = 30;

export interface ClosedOperationsData {
  /** A pagina que a tabela mostra. */
  page: WeighingOperationSummary[];
  /** Quantas existem no total, com o mesmo filtro -- para "mostrando X de Y". */
  total: number;
  /** Produtos distintos, para o seletor. */
  products: string[];
  /** Superconjunto exato do alerta fiscal. */
  omieAttention: WeighingOperationSummary[];
  /** Recorte recente + pendentes: painel e avisos de envio ao OMIE. */
  recent: WeighingOperationSummary[];
}

type ClosedOperationsApi = Pick<
  KyberRockDesktopApi,
  | "listClosedWeighingOperations"
  | "countClosedWeighingOperations"
  | "listClosedOperationProductDescriptions"
  | "listClosedOperationsNeedingOmieAttention"
  | "listClosedWeighingOperationsUpdatedSince"
  | "listRecentClosedWeighingOperations"
>;

export interface LoadClosedOperationsOptions {
  /** Filtro de produto da tela. `"all"` (ou ausente) nao filtra. */
  productFilter?: string;
  /**
   * Busca digitada. Com busca, a tabela recebe o conjunto INTEIRO: a ordenacao por
   * proximidade (`rankByText`) nao tem equivalente em SQL, e paginar antes de pontuar
   * mudaria qual linha aparece primeiro. Buscar e acao deliberada e com debounce; o
   * estado permanente, que roda a cada 15 s, e o sem busca.
   */
  search?: string;
  /** Quantas linhas a tabela ja pediu (cresce com "carregar mais"). */
  pageSize?: number;
  /** Ids das operacoes que estavam PENDENTES no ciclo anterior. */
  pendingOmieIds?: readonly string[];
  now?: Date;
}

/** Os ids ainda pendentes de envio, para o proximo ciclo nao perder a transicao deles. */
export function pendingOmieIdsOf(states: Map<string, OmieDeliveryState>): string[] {
  const ids: string[] = [];
  for (const [id, state] of states) {
    if (state === "pending") ids.push(id);
  }
  return ids;
}

export async function loadClosedOperationsData(
  api: ClosedOperationsApi,
  options: LoadClosedOperationsOptions = {}
): Promise<ClosedOperationsData> {
  const productFilter = options.productFilter;
  const filters =
    productFilter && productFilter !== "all" ? { productDescription: productFilter } : {};
  const buscando = Boolean(options.search && options.search.trim());
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - RECENT_WINDOW_MS).toISOString();

  const [page, total, products, omieAttention, doDia, ultimas] = await Promise.all([
    // Com busca a tabela precisa do conjunto inteiro para pontuar; sem busca, so a pagina.
    api.listClosedWeighingOperations(
      buscando ? filters : { ...filters, limit: options.pageSize ?? CLOSED_PAGE_SIZE, offset: 0 }
    ),
    api.countClosedWeighingOperations(filters),
    api.listClosedOperationProductDescriptions(),
    api.listClosedOperationsNeedingOmieAttention(),
    api.listClosedWeighingOperationsUpdatedSince(since, [...(options.pendingOmieIds ?? [])]),
    api.listRecentClosedWeighingOperations(RECENT_ACTIVITY_LIMIT)
  ]);

  // As duas consultas se sobrepoem (a operacao de hoje e tambem uma das ultimas): a uniao
  // por id evita entregar a mesma operacao duas vezes ao painel, que somaria peso e
  // faturamento em dobro nos numeros do dia.
  const porId = new Map<string, WeighingOperationSummary>();
  for (const operacao of [...doDia, ...ultimas]) porId.set(operacao.id, operacao);
  const recent = [...porId.values()];

  return { page, total, products, omieAttention, recent };
}

/**
 * O conjunto que o painel recebe.
 *
 * O painel filtra "as de hoje" e monta a atividade recente ordenando por `updatedAt`. As
 * duas coisas saem inteiras do recorte recente, entao ele continua funcionando sem
 * nenhuma mudanca -- e sem a lista completa em memoria.
 */
export function dashboardClosedOperations(
  data: Pick<ClosedOperationsData, "recent">
): WeighingOperationSummary[] {
  return data.recent;
}
