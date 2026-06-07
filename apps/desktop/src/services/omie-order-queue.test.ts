import { describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite.js";
import { OmieOrderQueueService } from "./omie-order-queue";

describe("OmieOrderQueueService", () => {
  function createMockDb(): DesktopDatabase {
    const runs: Array<{ changes: number; lastInsertRowid: number }> = [];
    const gets: unknown[] = [];

    return {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockImplementation(() => {
          const result = { changes: 1, lastInsertRowid: 1 };
          runs.push(result);
          return result;
        }),
        get: vi.fn().mockImplementation((...args: unknown[]) => {
          const result = args[0] === "pending"
            ? {
                id: "queue-1",
                entity_id: "op-123",
                idempotency_key: "kr:unit-1:op-123:sales_order",
                payload_json: JSON.stringify({ operationType: "invoice" }),
                attempt_count: 0
              }
            : null;
          gets.push(result);
          return result;
        }),
        all: vi.fn().mockReturnValue([])
      })
    } as unknown as DesktopDatabase;
  }

  it("enqueues a sales order for OMIE", () => {
    const db = createMockDb();
    const service = new OmieOrderQueueService(db);

    service.enqueue({
      operationId: "op-123",
      idempotencyKey: "kr:unit-1:op-123:sales_order",
      operationType: "invoice",
      payload: { customerOmieId: 123, productOmieId: 456 }
    });

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO sync_queue"));
  });

  it("dequeues pending items", () => {
    const db = createMockDb();
    const service = new OmieOrderQueueService(db);

    const items = service.getPending();

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT id, entity_id"));
    expect(items).toBeDefined();
  });

  it("marks item as done on success", () => {
    const db = createMockDb();
    const service = new OmieOrderQueueService(db);

    service.markDone("queue-1", { omieOrderId: 9876 });

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE sync_queue"));
  });

  it("marks item as failed with error", () => {
    const db = createMockDb();
    const service = new OmieOrderQueueService(db);

    service.markFailed("queue-1", "API timeout");

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE sync_queue"));
  });

  it("calculates next attempt with exponential backoff", () => {
    const db = createMockDb();
    const service = new OmieOrderQueueService(db);

    const nextAttempt = service.calculateNextAttempt(3);
    const now = new Date();
    const diff = nextAttempt.getTime() - now.getTime();

    // 3 attempts = 8 minutes (2^3 = 8)
    expect(diff).toBeGreaterThanOrEqual(8 * 60 * 1000 - 1000);
    expect(diff).toBeLessThanOrEqual(8 * 60 * 1000 + 1000);
  });

  it("limits backoff to 60 minutes", () => {
    const db = createMockDb();
    const service = new OmieOrderQueueService(db);

    const nextAttempt = service.calculateNextAttempt(10);
    const now = new Date();
    const diff = nextAttempt.getTime() - now.getTime();

    // 10 attempts should cap at 60 minutes
    expect(diff).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });
});
