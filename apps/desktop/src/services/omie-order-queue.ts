import type { DesktopDatabase } from "../database/sqlite.js";

export interface QueueItem {
  id: string;
  operationId: string;
  idempotencyKey: string;
  operationType: "invoice" | "internal";
  payload: unknown;
  attemptCount: number;
  status: "pending" | "running" | "done" | "failed" | "dead_letter";
  lastError?: string;
}

export interface EnqueueInput {
  operationId: string;
  idempotencyKey: string;
  operationType: "invoice" | "internal";
  payload: Record<string, unknown>;
}

export class OmieOrderQueueService {
  constructor(private readonly db: DesktopDatabase) {}

  enqueue(input: EnqueueInput): void {
    const insert = this.db.prepare(`
      INSERT INTO sync_queue (
        id, target, action, entity_type, entity_id, idempotency_key,
        payload_json, status, attempt_count, next_attempt_at, created_at, updated_at
      ) VALUES (
        lower(hex(randomblob(16))), 'omie', 'send_order', 'weighing_operation', ?, ?,
        ?, 'pending', 0, datetime('now'), datetime('now'), datetime('now')
      )
      ON CONFLICT(idempotency_key) DO NOTHING
    `);

    insert.run(
      input.operationId,
      input.idempotencyKey,
      JSON.stringify({
        operationType: input.operationType,
        ...input.payload
      })
    );
  }

  getPending(): Array<{
    id: string;
    entity_id: string;
    idempotency_key: string;
    payload_json: string;
    attempt_count: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT id, entity_id, idempotency_key, payload_json, attempt_count
      FROM sync_queue
      WHERE target = 'omie'
        AND status = 'pending'
        AND next_attempt_at <= datetime('now')
      ORDER BY created_at ASC
      LIMIT 50
    `);

    return stmt.all() as Array<{
      id: string;
      entity_id: string;
      idempotency_key: string;
      payload_json: string;
      attempt_count: number;
    }>;
  }

  markRunning(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE sync_queue
      SET status = 'running',
          attempt_count = attempt_count + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(id);
  }

  markDone(id: string, result: { omieOrderId: number }): void {
    const stmt = this.db.prepare(`
      UPDATE sync_queue
      SET status = 'done',
          last_error = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(id);

    // Update the weighing operation with OMIE order ID
    const updateOp = this.db.prepare(`
      UPDATE weighing_operations
      SET omie_sales_order_id = ?,
          status = 'synced',
          omie_synced_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = (SELECT entity_id FROM sync_queue WHERE id = ?)
    `);
    updateOp.run(result.omieOrderId, id);
  }

  markFailed(id: string, error: string): void {
    const item = this.db.prepare(`
      SELECT attempt_count FROM sync_queue WHERE id = ?
    `).get(id) as { attempt_count: number } | undefined;

    const attempts = (item?.attempt_count ?? 0) + 1;
    const nextAttempt = this.calculateNextAttempt(attempts);

    const status = attempts >= 5 ? "dead_letter" : "pending";

    const stmt = this.db.prepare(`
      UPDATE sync_queue
      SET status = ?,
          last_error = ?,
          next_attempt_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(status, error, nextAttempt.toISOString(), id);
  }

  calculateNextAttempt(attemptCount: number): Date {
    const minutes = Math.min(Math.pow(2, attemptCount), 60);
    const nextAttempt = new Date();
    nextAttempt.setMinutes(nextAttempt.getMinutes() + minutes);
    return nextAttempt;
  }

  getFailed(): Array<{
    id: string;
    entity_id: string;
    idempotency_key: string;
    payload_json: string;
    attempt_count: number;
    last_error: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT id, entity_id, idempotency_key, payload_json, attempt_count, last_error
      FROM sync_queue
      WHERE target = 'omie'
        AND status IN ('failed', 'dead_letter')
      ORDER BY updated_at DESC
      LIMIT 100
    `);

    return stmt.all() as Array<{
      id: string;
      entity_id: string;
      idempotency_key: string;
      payload_json: string;
      attempt_count: number;
      last_error: string;
    }>;
  }
}
