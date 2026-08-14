/**
 * Tique periodico do OMIE: drena a fila de pedidos/OS e confere o faturamento.
 *
 * As duas tarefas sao independentes e cada uma tem o proprio corte barato — a fila so roda
 * quando ha job vencido, a conferencia so quando o intervalo minimo dela passou.
 *
 * ── Drenagem da fila (pedidos/OS dos fechamentos) ──
 *
 * O envio de um fechamento ja e disparado no proprio fechamento
 * (`triggerBackgroundOmieOrderPush`), entao no caminho feliz o pedido sai em segundos.
 * O que faltava era quem executasse a fila nos dois casos em que esse disparo nao
 * resolve:
 *
 * 1. O disparo imediato caiu numa passada ja em andamento (a trava da fila e unica) —
 *    hoje o `runOmieQueue` re-agenda a passada, e este tick e a rede de seguranca.
 * 2. A primeira tentativa falhou (OMIE fora do ar, timeout). `markSyncJobFailed` marca
 *    `next_attempt_at` para 60 s, 2 min, 4 min... mas NINGUEM rodava a fila nesse ritmo:
 *    o unico executor recorrente era a sincronizacao cloud, de 30 em 30 minutos. Uma
 *    falha transitoria custava ate meia hora de espera com o pedido parado.
 *
 * O tick nao acelera tentativa nenhuma: ele so executa o que `next_attempt_at` ja
 * autorizou. Quando a fila nao tem job elegivel, `hasRunnableJobs` (uma consulta local
 * no SQLite) corta o tick antes de qualquer chamada de rede.
 *
 * ── Conferencia de faturamento ──
 *
 * Perguntar ao OMIE quem ja foi faturado tambem precisa de um ritmo proprio. Ela ja roda
 * dentro da sincronizacao cloud, mas essa so tem hora marcada de 30 em 30 minutos — no
 * resto do tempo depende de alguem fechar ou editar uma operacao, o que faz a tela de
 * conferencia acompanhar o dia bem enquanto a pedreira esta movimentada e travar
 * justamente quando o movimento para (fim de expediente, hora do almoco). Com o tique
 * proprio, o pior caso vira o intervalo minimo da propria conferencia.
 */

/** Ritmo do tick. Menor que o menor backoff (60 s) para nao atrasar a re-tentativa. */
export const OMIE_QUEUE_DRAIN_INTERVAL_MS = 30_000;

export interface StartOmieQueueDrainSchedulerOptions {
  /** Consulta local e barata: ha job OMIE com `next_attempt_at` ja vencido? */
  hasRunnableJobs: () => boolean;
  /** Executa a fila OMIE (a trava contra concorrencia vive no runtime). */
  drain: () => Promise<void>;
  /**
   * Confere no OMIE quem ja foi faturado. Roda em TODO tick, independente da fila ter job
   * ou nao: o proprio `reconcileOmieBillingFromOmie` desiste na hora quando o intervalo
   * minimo dele ainda nao passou (uma leitura em `local_settings`). Opcional para o tique
   * continuar sendo so o da fila em quem nao passa esta funcao.
   */
  reconcileBilling?: () => Promise<void>;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface OmieQueueDrainSchedulerHandle {
  stop: () => void;
}

export function startOmieQueueDrainScheduler(
  options: StartOmieQueueDrainSchedulerOptions
): OmieQueueDrainSchedulerHandle {
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const intervalMs = options.intervalMs ?? OMIE_QUEUE_DRAIN_INTERVAL_MS;

  let running = false;
  let reconciling = false;

  // Travas separadas de proposito: a conferencia de faturamento nao pode ficar esperando
  // uma drenagem longa (e vice-versa). Quem serializa as chamadas ao OMIE de verdade e a
  // fila do edge, nao este agendador.
  const tickReconcile = (): void => {
    if (reconciling || !options.reconcileBilling) return;
    reconciling = true;
    void options
      .reconcileBilling()
      .catch((error: unknown) => {
        options.onError?.(error);
      })
      .finally(() => {
        reconciling = false;
      });
  };

  const tickDrain = (): void => {
    if (running) return;

    // Sem job vencido nao ha o que drenar. Barra o tick ANTES de tocar em rede: o
    // caso normal (fila vazia) custa uma consulta indexada no SQLite local.
    let runnable = false;
    try {
      runnable = options.hasRunnableJobs();
    } catch (error) {
      options.onError?.(error);
      return;
    }
    if (!runnable) return;

    running = true;
    void options
      .drain()
      .catch((error: unknown) => {
        options.onError?.(error);
      })
      .finally(() => {
        running = false;
      });
  };

  const tick = (): void => {
    tickDrain();
    tickReconcile();
  };

  // Sem tick imediato de proposito: no startup o app ainda esta montando identidade,
  // Supabase e agendadores. A fila pendente da sessao anterior sai no primeiro tick.
  const intervalId = setIntervalFn(tick, intervalMs);

  return {
    stop: () => clearIntervalFn(intervalId)
  };
}
