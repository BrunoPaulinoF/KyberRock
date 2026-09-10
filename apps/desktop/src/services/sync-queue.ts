import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import { isOutageFault } from "./outage-fault.js";

export const SYNC_QUEUE_STATUSES = ["pending", "running", "done", "failed", "dead_letter"] as const;
export const SYNC_TARGETS = ["cloud", "omie"] as const;

export type SyncQueueStatus = (typeof SYNC_QUEUE_STATUSES)[number];
export type SyncTarget = (typeof SYNC_TARGETS)[number];

export interface EnqueueSyncJobInput {
  id?: string;
  target: SyncTarget;
  action: string;
  entityType: string;
  entityId: string;
  idempotencyKey: string;
  payload: unknown;
  nextAttemptAt?: Date;
}

export interface SyncQueueJob {
  id: string;
  target: SyncTarget;
  action: string;
  entityType: string;
  entityId: string;
  idempotencyKey: string;
  payload: unknown;
  status: SyncQueueStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SyncQueueJobRow {
  id: string;
  target: SyncTarget;
  action: string;
  entity_type: string;
  entity_id: string;
  idempotency_key: string;
  payload_json: string;
  status: SyncQueueStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function enqueueSyncJob(
  database: DesktopDatabase,
  input: EnqueueSyncJobInput,
  now: Date = new Date()
): SyncQueueJob {
  validateEnqueueSyncJobInput(input);

  const timestamp = now.toISOString();
  const nextAttemptAt = (input.nextAttemptAt ?? now).toISOString();
  const idempotencyKey = input.idempotencyKey.trim();

  database
    .prepare(
      `INSERT OR IGNORE INTO sync_queue (
        id,
        target,
        action,
        entity_type,
        entity_id,
        idempotency_key,
        payload_json,
        status,
        attempt_count,
        next_attempt_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
    )
    .run(
      input.id?.trim() || randomUUID(),
      input.target,
      input.action.trim(),
      input.entityType.trim(),
      input.entityId.trim(),
      idempotencyKey,
      JSON.stringify(input.payload),
      nextAttemptAt,
      timestamp,
      timestamp
    );

  const job = getSyncJobByIdempotencyKey(database, idempotencyKey);

  if (!job) {
    throw new Error("Failed to enqueue sync job.");
  }

  return job;
}

export function listRunnableSyncJobs(
  database: DesktopDatabase,
  options: { now?: Date; target?: SyncTarget; entityId?: string; limit?: number } = {}
): SyncQueueJob[] {
  const nowIso = (options.now ?? new Date()).toISOString();
  const limit = options.limit ?? 50;

  const conditions = ["status IN ('pending', 'failed')", "next_attempt_at <= ?"];
  const params: unknown[] = [nowIso];
  if (options.target) {
    conditions.unshift("target = ?");
    params.unshift(options.target);
  }
  if (options.entityId) {
    conditions.push("entity_id = ?");
    params.push(options.entityId);
  }

  const rows = database
    .prepare(
      `SELECT * FROM sync_queue
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(...params, limit);

  return rows.map((row) => mapSyncQueueJobRow(row as SyncQueueJobRow));
}

/**
 * Neutraliza jobs de criacao OMIE ainda nao enviados de uma operacao cancelada localmente,
 * evitando que a fila crie/fature um pedido apos o cancelamento. Move para dead_letter (nao
 * remove) para preservar auditoria. Retorna quantos jobs foram neutralizados.
 */
export function cancelPendingOmieJobs(
  database: DesktopDatabase,
  operationId: string,
  now: Date = new Date()
): number {
  const result = database
    .prepare(
      `UPDATE sync_queue
       SET status = 'dead_letter',
           last_error = 'Operacao cancelada localmente antes do envio ao OMIE',
           updated_at = ?
       WHERE target = 'omie'
         AND action IN ('create_order', 'create_and_bill_order')
         AND entity_id = ?
         AND status IN ('pending', 'failed')`
    )
    .run(now.toISOString(), operationId);
  return result.changes;
}

/** Item da fila OMIE com os dados da operacao para exibicao (tela cloud). */
export interface OmieQueueItem {
  id: string;
  action: string;
  status: SyncQueueStatus;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  operationId: string;
  operationType: string | null;
  operationStatus: string | null;
  customerName: string | null;
  plate: string | null;
  totalCents: number | null;
  closedAt: string | null;
}

interface OmieQueueItemRow {
  id: string;
  action: string;
  status: SyncQueueStatus;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  operation_id: string;
  operation_type: string | null;
  operation_status: string | null;
  customer_name: string | null;
  plate: string | null;
  total_cents: number | null;
  closed_at: string | null;
}

/**
 * Lista os itens da fila OMIE que ainda precisam ir para o OMIE (pendentes, falhos e
 * mortos), com os dados da operacao para a tela cloud. Jobs 'done' ficam de fora.
 */
export function listOmieQueueItems(database: DesktopDatabase): OmieQueueItem[] {
  const rows = database
    .prepare(
      `SELECT q.id, q.action, q.status, q.attempt_count, q.last_error, q.next_attempt_at, q.created_at,
              q.entity_id AS operation_id,
              o.operation_type, o.status AS operation_status, o.total_cents,
              o.exit_weight_captured_at AS closed_at,
              c.trade_name AS customer_name, v.plate
       FROM sync_queue q
       LEFT JOIN weighing_operations o ON o.id = q.entity_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       WHERE q.target = 'omie'
         AND q.status IN ('pending', 'failed', 'dead_letter')
       ORDER BY q.created_at DESC`
    )
    .all() as OmieQueueItemRow[];

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    operationId: row.operation_id,
    operationType: row.operation_type,
    operationStatus: row.operation_status,
    customerName: row.customer_name,
    plate: row.plate,
    totalCents: row.total_cents,
    closedAt: row.closed_at
  }));
}

/**
 * Remove um item da fila OMIE (o fechamento NAO sera mais enviado ao OMIE). So
 * remove jobs ainda nao concluidos; liberar a chave de idempotencia permite
 * re-enfileirar depois (ex.: refaturar). Retorna se algo foi removido.
 */
export function deleteOmieQueueJob(database: DesktopDatabase, id: string): boolean {
  const result = database
    .prepare(
      `DELETE FROM sync_queue
       WHERE id = ? AND target = 'omie' AND status IN ('pending', 'failed', 'dead_letter')`
    )
    .run(id);
  return result.changes > 0;
}

/**
 * Rearma um item da fila OMIE para envio imediato: volta para 'pending', zera o
 * backoff (next_attempt_at = agora) e o contador de tentativas (um job morto volta
 * a ser re-executavel). Retorna o job rearmado ou null se nao encontrado.
 */
export function resetOmieQueueJobForRetry(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): SyncQueueJob | null {
  const nowIso = now.toISOString();
  const result = database
    .prepare(
      `UPDATE sync_queue
       SET status = 'pending', attempt_count = 0, next_attempt_at = ?, updated_at = ?
       WHERE id = ? AND target = 'omie' AND status IN ('pending', 'failed', 'dead_letter')`
    )
    .run(nowIso, nowIso, id);
  if (result.changes === 0) return null;
  return getSyncJobById(database, id);
}

export function markSyncJobDone(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  database
    .prepare(
      "UPDATE sync_queue SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?"
    )
    .run(now.toISOString(), id);
}

/**
 * Retencao dos jobs ja concluidos. 90 dias e folgado de proposito: apagar um job 'done'
 * libera a chave de idempotencia dele, e a folga garante que isso so aconteca muito
 * depois de a operacao correspondente ter fechado o ciclo (nuvem + OMIE).
 */
export const SYNC_QUEUE_DONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Remove da fila os jobs 'done' mais antigos que a retencao. A tabela nunca era limpa e
 * crescia para sempre (~3 jobs por operacao, ~100 operacoes/dia).
 *
 * Apaga SOMENTE 'done'. Pendentes, falhos e dead_letter ficam: sao a trilha de auditoria
 * e exatamente o que a tela cloud lista para o operador reprocessar.
 */
export function pruneCompletedSyncJobs(
  database: DesktopDatabase,
  options: { now?: Date; retentionMs?: number } = {}
): number {
  const now = options.now ?? new Date();
  const retentionMs = Math.max(0, options.retentionMs ?? SYNC_QUEUE_DONE_RETENTION_MS);
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();

  const result = database
    .prepare("DELETE FROM sync_queue WHERE status = 'done' AND updated_at < ?")
    .run(cutoff);

  return result.changes;
}

// Sentinela lexicograficamente maior que qualquer ISO real: o loop batch
// (listRunnableSyncJobs filtra next_attempt_at <= now) nunca repega o job, mas
// processFiscalBillingNow (que so filtra por status) ainda consegue re-executa-lo.
export const BLOCKED_NEXT_ATTEMPT_AT = "9999-12-31T23:59:59.999Z";

/**
 * Marca um job como bloqueado por falha DETERMINISTICA (ex.: cadastro incompleto para NF-e):
 * mantem status 'failed' (re-executavel manualmente), empurra next_attempt_at para o futuro
 * distante (para o retry automatico) e NAO incrementa attempt_count (para nunca cruzar o limite
 * de dead_letter e continuar re-executavel apos o operador corrigir o cadastro).
 */
export function markSyncJobBlocked(
  database: DesktopDatabase,
  id: string,
  errorMessage: string,
  now: Date = new Date()
): void {
  database
    .prepare(
      `UPDATE sync_queue
       SET status = 'failed', next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(BLOCKED_NEXT_ATTEMPT_AT, sanitizeErrorMessage(errorMessage), now.toISOString(), id);
}

/** Primeiro atraso entre tentativas da fila; tambem o piso do backoff. */
export const SYNC_RETRY_BASE_MS = 60_000;
/**
 * Teto do backoff. Sem teto, a 10a tentativa cairia a ~8h da falha e o operador veria a
 * fila "parada"; com teto de 15 min ela continua tentando num ritmo que ele reconhece.
 */
export const SYNC_RETRY_MAX_MS = 15 * 60_000;
/** Jitter aplicado ao atraso (+/- 20%), para as balancas da mesma pedreira nao repetirem juntas. */
export const SYNC_RETRY_JITTER_RATIO = 0.2;

/**
 * Atraso ate a proxima tentativa: dobra a cada tentativa ate o teto, com jitter.
 *
 * O atraso fixo de 60s anterior gastava as 10 tentativas em 10 minutos — uma queda do
 * OMIE mais longa que isso mandava para dead_letter um job que so precisava esperar, e
 * cada um deles exige um clique do operador na tela cloud para voltar. Com backoff, a
 * mesma janela de 10 tentativas cobre ~2h de indisponibilidade.
 */
export function computeSyncRetryDelayMs(
  attemptCount: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {}
): number {
  const baseMs = options.baseMs ?? SYNC_RETRY_BASE_MS;
  const maxMs = options.maxMs ?? SYNC_RETRY_MAX_MS;
  const random = options.random ?? Math.random;
  // Expoente limitado antes da potenciacao: 2 ** 1024 e Infinity, e um attemptCount
  // corrompido no banco nao pode virar um next_attempt_at invalido.
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 30);
  const delayMs = Math.min(maxMs, baseMs * 2 ** exponent);
  const jitterMs = delayMs * SYNC_RETRY_JITTER_RATIO * (random() * 2 - 1);

  return Math.max(1_000, Math.round(delayMs + jitterMs));
}

export function markSyncJobFailed(
  database: DesktopDatabase,
  id: string,
  errorMessage: string,
  options: {
    now?: Date;
    retryAfterMs?: number;
    deadLetterAfterAttempts?: number;
    random?: () => number;
    /**
     * Falha por indisponibilidade da outra ponta (nuvem ou OMIE fora do ar).
     * Quem sabe disso por sondagem passa `true`; omitido, a mensagem decide
     * (`isOutageFault`). Ver `outage-fault.ts` para o porque.
     */
    outage?: boolean;
  } = {}
): void {
  const now = options.now ?? new Date();
  const deadLetterAfterAttempts = options.deadLetterAfterAttempts ?? 10;
  const current = getSyncJobById(database, id);

  if (!current) {
    throw new Error(`Sync job ${id} was not found.`);
  }

  const attemptCount = current.attemptCount + 1;
  // Um retryAfterMs explicito continua mandando (o chamador sabe algo que a formula nao
  // sabe, ex.: o Retry-After devolvido pelo OMIE).
  const retryAfterMs =
    options.retryAfterMs ?? computeSyncRetryDelayMs(attemptCount, { random: options.random });
  // A tentativa continua contando (e o que faz o backoff crescer ate o teto de 15 min,
  // para nao martelar quem ja caiu), mas a nuvem/OMIE fora do ar NUNCA condena o job:
  // ele fica em 'failed', dentro da rotacao automatica, e sobe sozinho quando a outra
  // ponta voltar. Ver `outage-fault.ts`.
  const outage = options.outage ?? isOutageFault(errorMessage);
  const nextStatus: SyncQueueStatus =
    !outage && attemptCount >= deadLetterAfterAttempts ? "dead_letter" : "failed";
  const nextAttemptAt = new Date(now.getTime() + retryAfterMs).toISOString();

  database
    .prepare(
      `UPDATE sync_queue
       SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      nextStatus,
      attemptCount,
      nextAttemptAt,
      sanitizeErrorMessage(errorMessage),
      now.toISOString(),
      id
    );
}

/**
 * Devolve a fila os jobs que morreram por indisponibilidade, e nao pelo dado.
 *
 * Existe para as maquinas que ja tinham `dead_letter` de uma queda anterior a esta
 * versao: dali em diante `markSyncJobFailed` nao deixa mais uma queda matar job
 * nenhum. Roda no comeco da sincronizacao, quando a nuvem ja respondeu.
 *
 * Nao encosta em duas coisas de proposito:
 * - o job travado por falha DETERMINISTICA, que `markSyncJobBlocked` deixa em 'failed'
 *   com `next_attempt_at` no ano 9999 — ele espera o operador corrigir o cadastro, e
 *   re-tentar so repete a recusa;
 * - o job neutralizado por cancelamento da operacao (`cancelPendingOmieJobs`), cuja
 *   mensagem nao e de rede — ressuscita-lo criaria no OMIE um pedido cancelado aqui.
 */
/**
 * Quantos envios estao apenas esperando o backoff passar.
 *
 * Barato de proposito (nao classifica mensagem): serve so para decidir se vale gastar
 * um ping na nuvem antes de chamar `releaseOutageBackoff`, que ai sim classifica.
 */
export function countJobsWaitingOnOutage(
  database: DesktopDatabase,
  now: Date = new Date()
): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS total FROM sync_queue
       WHERE status = 'failed'
         AND next_attempt_at > ?
         AND next_attempt_at <> ?`
    )
    .get(now.toISOString(), BLOCKED_NEXT_ATTEMPT_AT) as { total: number } | undefined;
  return row?.total ?? 0;
}

/**
 * Libera o backoff dos envios que so estao esperando porque a outra ponta caiu.
 *
 * O backoff dobra ate 15 minutos, e e ele que impede a balanca de martelar quem ja
 * esta fora do ar. Mas quando a conexao VOLTA ele passa a trabalhar contra: o envio
 * fica ate um quarto de hora parado por um motivo que deixou de existir, e a pedreira
 * ve "a internet voltou e nao subiu nada". Quem chama so faz isto depois de ter prova
 * de que a nuvem responde de novo.
 *
 * A tentativa NAO e zerada de proposito: se a queda ainda nao acabou de verdade, o
 * proximo backoff continua de onde parou em vez de recomecar do zero — o alivio e para
 * o caso bom, sem virar retry rapido infinito no caso ruim.
 *
 * Nao encosta em quem espera correcao de cadastro (`BLOCKED_NEXT_ATTEMPT_AT`) nem em
 * quem falhou pelo proprio dado: para esses, esperar nao muda nada.
 */
export function releaseOutageBackoff(
  database: DesktopDatabase,
  options: { now?: Date; limit?: number } = {}
): number {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = options.limit ?? MAX_OUTAGE_REARM_SCAN;

  const candidates = database
    .prepare(
      `SELECT id, last_error FROM sync_queue
       WHERE status = 'failed'
         AND next_attempt_at > ?
         AND next_attempt_at <> ?
       ORDER BY next_attempt_at ASC
       LIMIT ?`
    )
    .all(nowIso, BLOCKED_NEXT_ATTEMPT_AT, limit) as Array<{
    id: string;
    last_error: string | null;
  }>;

  const liberar = database.prepare(
    `UPDATE sync_queue
     SET next_attempt_at = ?, updated_at = ?
     WHERE id = ? AND status = 'failed'`
  );

  let liberados = 0;
  for (const candidate of candidates) {
    if (!isOutageFault(candidate.last_error)) continue;
    liberados += liberar.run(nowIso, nowIso, candidate.id).changes;
  }
  return liberados;
}

/** Teto de linhas examinadas por passada, so como guarda contra base patologica. */
export const MAX_OUTAGE_REARM_SCAN = 5000;

export function rearmJobsDeadLetteredByOutage(
  database: DesktopDatabase,
  options: { now?: Date; target?: SyncTarget; limit?: number } = {}
): number {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = options.limit ?? MAX_OUTAGE_REARM_SCAN;

  const conditions = ["status = 'dead_letter'", "next_attempt_at <> ?", "id > ?"];
  const baseParams: unknown[] = [BLOCKED_NEXT_ATTEMPT_AT];
  const targetClause = options.target ? " AND target = ?" : "";

  // Paginado por `id`, e nao um unico `LIMIT` no topo: a classificacao de queda
  // acontece em JavaScript (a mensagem e texto livre), entao um LIMIT cru deixava
  // jobs mortos por falha do DADO — que nunca podem ser rearmados — ocuparem todas
  // as vagas da varredura e esconderem para sempre os que morreram por queda.
  const select = database.prepare(
    `SELECT id, last_error FROM sync_queue
     WHERE ${conditions.join(" AND ")}${targetClause}
     ORDER BY id ASC
     LIMIT ?`
  );
  const rearm = database.prepare(
    `UPDATE sync_queue
     SET status = 'pending', attempt_count = 0, next_attempt_at = ?, updated_at = ?
     WHERE id = ? AND status = 'dead_letter'`
  );

  const PAGE = 200;
  let cursor = "";
  let examinados = 0;
  let rearmed = 0;

  while (examinados < limit) {
    const params = options.target
      ? [...baseParams, cursor, options.target, PAGE]
      : [...baseParams, cursor, PAGE];
    const pagina = select.all(...params) as Array<{ id: string; last_error: string | null }>;
    if (pagina.length === 0) break;

    for (const candidate of pagina) {
      cursor = candidate.id;
      examinados++;
      if (!isOutageFault(candidate.last_error)) continue;
      rearmed += rearm.run(nowIso, nowIso, candidate.id).changes;
    }

    if (pagina.length < PAGE) break;
  }

  return rearmed;
}

export function getSyncJobById(database: DesktopDatabase, id: string): SyncQueueJob | null {
  const row = database.prepare("SELECT * FROM sync_queue WHERE id = ?").get(id) as
    | SyncQueueJobRow
    | undefined;

  return row ? mapSyncQueueJobRow(row) : null;
}

function getSyncJobByIdempotencyKey(
  database: DesktopDatabase,
  idempotencyKey: string
): SyncQueueJob | null {
  const row = database
    .prepare("SELECT * FROM sync_queue WHERE idempotency_key = ?")
    .get(idempotencyKey) as SyncQueueJobRow | undefined;

  return row ? mapSyncQueueJobRow(row) : null;
}

function validateEnqueueSyncJobInput(input: EnqueueSyncJobInput): void {
  const requiredFields: Array<[string, string]> = [
    ["action", input.action],
    ["entityType", input.entityType],
    ["entityId", input.entityId],
    ["idempotencyKey", input.idempotencyKey]
  ];

  for (const [fieldName, value] of requiredFields) {
    if (!value.trim()) {
      throw new Error(`${fieldName} is required to enqueue a sync job.`);
    }
  }
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}

function mapSyncQueueJobRow(row: SyncQueueJobRow): SyncQueueJob {
  return {
    id: row.id,
    target: row.target,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
