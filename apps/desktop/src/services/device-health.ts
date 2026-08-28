import type { DesktopDatabase } from "../database/sqlite.js";
import { BLOCKED_NEXT_ATTEMPT_AT } from "./sync-queue.js";

/**
 * Saude desta balanca vista de fora: o que o suporte precisa saber sem ligar para
 * a pedreira.
 *
 * O painel enxergava da frota apenas `last_seen_at` e `app_version` — ou seja,
 * "esta ligada" e "esta em tal versao". Fila de envio parada, job esperando
 * clique do operador e o motivo da ultima recusa so existiam na tela daquele
 * computador, entao o problema chegava por telefone, depois de a pedreira ja ter
 * parado. Este resumo viaja de carona no `desktop-status`, o ping que ja roda a
 * cada 5 s, e nao acrescenta nenhuma requisicao.
 *
 * E deliberadamente um RESUMO, nao um espelho da fila: contagem, data mais
 * antiga e uma mensagem. Replicar `sync_queue` na nuvem seria um segundo lugar
 * de onde os dados da operacao vazam, e o painel nao precisa deles para dizer
 * "esta balanca parou".
 */
export interface DeviceHealthSnapshot {
  /**
   * Envios que ainda andam sozinhos (pendentes, em curso e os que estao no
   * backoff). Numero alto aqui e fila comprida, nao fila parada.
   */
  queuePending: number;
  /**
   * Envios que PARARAM e esperam gente: `dead_letter` (esgotou as tentativas) e
   * os bloqueados por falha deterministica.
   *
   * Os dois casos andam juntos de proposito. `markSyncJobBlocked` mantem o job
   * em `failed` e empurra o `next_attempt_at` para o ano 9999 — ele nao volta a
   * ser tentado ate o operador corrigir o cadastro, exatamente como o
   * `dead_letter`. Conta-lo entre os pendentes esconderia o caso mais comum de
   * balanca travada (cadastro incompleto para NF-e) dentro do numero que quer
   * dizer "esta andando".
   */
  queueBlocked: number;
  /**
   * Quando entrou na fila a coisa mais antiga que ainda nao foi entregue. E o
   * que separa "10 envios agora" de "10 envios parados desde terca".
   */
  oldestPendingAt: string | null;
  /** Motivo da recusa mais recente entre os envios nao entregues, truncado. */
  lastError: string | null;
  /** Quando este resumo foi lido do banco local. */
  collectedAt: string;
}

/**
 * Teto da mensagem de erro no ping. A mensagem completa continua na fila da
 * propria balanca: aqui ela e uma pista para o suporte, e o ping roda a cada
 * 5 s — mandar um stack trace inteiro nesse ritmo custa banda de pedreira.
 */
export const DEVICE_HEALTH_MAX_ERROR_LENGTH = 300;

/**
 * De quanto em quanto tempo o resumo e recalculado.
 *
 * O ping e de 5 s, mas a fila nao muda nesse ritmo e a leitura varre as linhas
 * nao entregues de `sync_queue`. Uma vez por minuto e mais do que suficiente
 * para o painel (a tela do administrador nem atualiza tao rapido) e deixa o
 * heartbeat com o custo que ele sempre teve.
 */
export const DEVICE_HEALTH_REFRESH_INTERVAL_MS = 60_000;

/** Estados de um envio que ainda nao chegou ao destino. */
const UNFINISHED_STATUSES = "('pending', 'running', 'failed', 'dead_letter')";

interface QueueCountsRow {
  blocked: number | null;
  pending: number | null;
  oldest: string | null;
}

/**
 * Le do SQLite local o resumo da fila de envio.
 *
 * Duas consultas, ambas sobre as linhas nao entregues — que numa balanca
 * saudavel sao poucas, porque `pruneCompletedSyncJobs` so apaga `done` e e o
 * `done` que se acumula.
 */
export function collectDeviceHealth(
  database: DesktopDatabase,
  now: Date = new Date()
): DeviceHealthSnapshot {
  const counts = database
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'dead_letter' OR next_attempt_at >= ? THEN 1 ELSE 0 END) AS blocked,
         SUM(CASE WHEN status = 'dead_letter' OR next_attempt_at >= ? THEN 0 ELSE 1 END) AS pending,
         MIN(created_at) AS oldest
       FROM sync_queue
       WHERE status IN ${UNFINISHED_STATUSES}`
    )
    .get(BLOCKED_NEXT_ATTEMPT_AT, BLOCKED_NEXT_ATTEMPT_AT) as QueueCountsRow | undefined;

  // A recusa mais recente entre o que nao foi entregue. `updated_at` e nao
  // `created_at`: o que interessa e a ultima coisa que o envio respondeu, e um
  // job antigo pode ter falhado agora.
  const lastErrorRow = database
    .prepare(
      `SELECT last_error
       FROM sync_queue
       WHERE status IN ${UNFINISHED_STATUSES}
         AND last_error IS NOT NULL
         AND last_error <> ''
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get() as { last_error: string | null } | undefined;

  return {
    queuePending: normalizeCount(counts?.pending),
    queueBlocked: normalizeCount(counts?.blocked),
    oldestPendingAt: typeof counts?.oldest === "string" ? counts.oldest : null,
    lastError: truncateError(lastErrorRow?.last_error ?? null),
    collectedAt: now.toISOString()
  };
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function truncateError(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > DEVICE_HEALTH_MAX_ERROR_LENGTH
    ? `${trimmed.slice(0, DEVICE_HEALTH_MAX_ERROR_LENGTH - 1)}…`
    : trimmed;
}

let cache: { snapshot: DeviceHealthSnapshot; collectedAtMs: number } | null = null;

/**
 * O resumo que acompanha o proximo ping, recalculado no maximo uma vez por
 * `DEVICE_HEALTH_REFRESH_INTERVAL_MS`.
 *
 * BEST-EFFORT DE PROPOSITO: qualquer falha de leitura devolve `null` e o ping
 * segue sem o campo. Este resumo e informacao para o suporte — jamais pode
 * derrubar a validacao de acesso, que e o que libera a operacao da balanca.
 */
export function readDeviceHealthForHeartbeat(
  database: DesktopDatabase,
  now: Date = new Date()
): DeviceHealthSnapshot | null {
  if (cache && now.getTime() - cache.collectedAtMs < DEVICE_HEALTH_REFRESH_INTERVAL_MS) {
    return cache.snapshot;
  }

  try {
    const snapshot = collectDeviceHealth(database, now);
    cache = { snapshot, collectedAtMs: now.getTime() };
    return snapshot;
  } catch {
    return null;
  }
}

/** Descarta o resumo memorizado. Existe para os testes e para a troca de banco. */
export function resetDeviceHealthCache(): void {
  cache = null;
}
