/**
 * Drenagem periodica da fila OMIE (pedidos/OS dos fechamentos).
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
 */

/** Ritmo do tick. Menor que o menor backoff (60 s) para nao atrasar a re-tentativa. */
export const OMIE_QUEUE_DRAIN_INTERVAL_MS = 30_000;

export interface StartOmieQueueDrainSchedulerOptions {
  /** Consulta local e barata: ha job OMIE com `next_attempt_at` ja vencido? */
  hasRunnableJobs: () => boolean;
  /** Executa a fila OMIE (a trava contra concorrencia vive no runtime). */
  drain: () => Promise<void>;
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

  const tick = (): void => {
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

  // Sem tick imediato de proposito: no startup o app ainda esta montando identidade,
  // Supabase e agendadores. A fila pendente da sessao anterior sai no primeiro tick.
  const intervalId = setIntervalFn(tick, intervalMs);

  return {
    stop: () => clearIntervalFn(intervalId)
  };
}
