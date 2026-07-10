import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

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

export function markSyncJobFailed(
  database: DesktopDatabase,
  id: string,
  errorMessage: string,
  options: { now?: Date; retryAfterMs?: number; deadLetterAfterAttempts?: number } = {}
): void {
  const now = options.now ?? new Date();
  const retryAfterMs = options.retryAfterMs ?? 60_000;
  const deadLetterAfterAttempts = options.deadLetterAfterAttempts ?? 10;
  const current = getSyncJobById(database, id);

  if (!current) {
    throw new Error(`Sync job ${id} was not found.`);
  }

  const attemptCount = current.attemptCount + 1;
  const nextStatus: SyncQueueStatus =
    attemptCount >= deadLetterAfterAttempts ? "dead_letter" : "failed";
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
