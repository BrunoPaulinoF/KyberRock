/**
 * Regras de atualizacao ao vivo da aba "Atualizacoes do desktop".
 *
 * A tela nao manda em nada sozinha: promover dispara um run do
 * `desktop-promote.yml` e o estado da versao so muda no GitHub quando aquele
 * run termina — segundos depois, as vezes um minuto. Enquanto isso a lista
 * continua mostrando a leitura antiga, e sem recarregar a pagina a tela parecia
 * travada logo depois do clique que mais importa.
 *
 * Por isso o recarregamento aqui e RITMADO PELO QUE ESTA ACONTECENDO, e nao um
 * intervalo fixo: rapido enquanto uma promocao esta a caminho, moderado
 * enquanto um build compila, lento quando nao ha nada em movimento (cada
 * verificacao gasta duas chamadas na API do GitHub, que tem limite por hora).
 *
 * Modulo puro para ter teste: e ele que decide quando a tela desiste de esperar
 * um run — desistir cedo demais reabre os botoes de uma versao que ainda esta
 * mudando, e nao desistir nunca deixa a linha em "Aplicando…" para sempre.
 */

export type ReleaseState =
  | "producao"
  | "teste"
  | "parado"
  | "compilando"
  | "reprovada"
  | "incompleto";

/** Alvos que a tela pode disparar (os mesmos aceitos pelo `admin-api`). */
export type PromotionTarget = "beta" | "latest" | "reprovar";

export interface PendingPromotion {
  version: string;
  target: PromotionTarget;
  /** `Date.now()` do disparo — base do prazo de espera. */
  startedAt: number;
}

/** Estado em que a versao TEM que aparecer para a promocao estar concluida. */
export const PROMOTION_RESULT_STATE: Record<PromotionTarget, ReleaseState> = {
  beta: "teste",
  latest: "producao",
  reprovar: "reprovada"
};

/**
 * Quanto tempo a tela espera o run antes de parar de tratar a promocao como
 * "a caminho".
 *
 * O workflow costuma resolver em menos de um minuto; passar disso quase sempre
 * quer dizer que ele recusou o pedido (versao nunca testada, regressiva,
 * release incompleta) — e recusa nao muda estado nenhum, entao esperar mais nao
 * traria resposta. Ao vencer o prazo a tela devolve os botoes e manda o
 * administrador olhar o run, em vez de ficar girando.
 */
export const PROMOTION_TIMEOUT_MS = 3 * 60_000;

const PENDING_REFRESH_MS = 3_000;
const BUILDING_REFRESH_MS = 8_000;
const IDLE_REFRESH_MS = 30_000;

/**
 * A promocao ja apareceu na lista?
 *
 * Compara pelo ESTADO da versao, e nao por "a lista mudou": o run pode publicar
 * a release e mexer em outras linhas no caminho (liberar producao rebaixa a
 * anterior), e so a linha pedida diz que o gesto do administrador pegou.
 */
export function isPromotionApplied(
  releases: ReadonlyArray<{ version: string; state: ReleaseState }>,
  pending: PendingPromotion | null
): boolean {
  if (!pending) return false;
  const row = releases.find((release) => release.version === pending.version);
  return row?.state === PROMOTION_RESULT_STATE[pending.target];
}

/** Venceu o prazo de espera do run (ver `PROMOTION_TIMEOUT_MS`). */
export function isPromotionStale(pending: PendingPromotion | null, now: number): boolean {
  if (!pending) return false;
  return now - pending.startedAt >= PROMOTION_TIMEOUT_MS;
}

/**
 * Intervalo ate a proxima verificacao.
 *
 * `null` quer dizer "nao verifique agora": aba escondida nao tem quem olhe, e
 * continuar consultando o GitHub em segundo plano so gasta o limite por hora
 * que as promocoes de verdade vao precisar. Ao voltar para a aba a tela
 * recarrega na hora.
 */
export function nextRefreshDelayMs(options: {
  isVisible: boolean;
  hasPendingPromotion: boolean;
  isBuilding: boolean;
}): number | null {
  if (!options.isVisible) return null;
  if (options.hasPendingPromotion) return PENDING_REFRESH_MS;
  if (options.isBuilding) return BUILDING_REFRESH_MS;
  return IDLE_REFRESH_MS;
}

/** Uma versao esta compilando: os arquivos ainda estao subindo e o estado vai mudar sozinho. */
export function hasBuildInProgress(releases: ReadonlyArray<{ state: ReleaseState }>): boolean {
  return releases.some((release) => release.state === "compilando");
}
