import { describe, expect, it } from "vitest";

import { sha256Hex } from "../_shared/crypto";
import { handleBillingRequests, type BillingRequestRow, type BillingRequestStore } from "./handler";

const NOW = new Date("2026-09-22T15:00:00.000Z");
const TOKEN = "token-da-balanca";

class MemoryStore implements BillingRequestStore {
  rows: Array<
    BillingRequestRow & { unit_id: string; claimed_by?: string | null; message?: string }
  > = [];
  tokenHash = "";

  async getDevice(deviceId: string) {
    if (deviceId !== "dev-1")
      return { data: null, error: { message: "not found", code: "PGRST116" } };
    return {
      data: {
        id: "dev-1",
        company_id: "c-1",
        unit_id: "u-1",
        token_hash: this.tokenHash,
        is_active: true
      },
      error: null
    };
  }
  async listPending(unitId: string, limit: number) {
    return this.rows.filter((r) => r.unit_id === unitId && r.status === "pending").slice(0, limit);
  }
  async listProcessing(unitId: string) {
    return this.rows.filter((r) => r.unit_id === unitId && r.status === "processing");
  }
  async claim(ids: string[], deviceId: string, nowIso: string) {
    const claimed: BillingRequestRow[] = [];
    for (const row of this.rows) {
      if (ids.includes(row.id) && row.status === "pending") {
        row.status = "processing";
        row.claimed_by = deviceId;
        row.claimed_at = nowIso;
        claimed.push(row);
      }
    }
    return claimed;
  }
  async release(ids: string[]) {
    for (const row of this.rows) {
      if (ids.includes(row.id) && row.status === "processing") {
        row.status = "pending";
        row.claimed_by = null;
        row.claimed_at = null;
      }
    }
  }
  async report(
    id: string,
    deviceId: string,
    outcome: { status: "done" | "failed"; message: string }
  ) {
    const row = this.rows.find((r) => r.id === id && r.claimed_by === deviceId);
    if (!row) return;
    row.status = outcome.status;
    row.message = outcome.message;
  }
}

async function call(store: MemoryStore, body: Record<string, unknown>) {
  const response = await handleBillingRequests(
    new Request("https://x/functions/v1/desktop-billing-requests", {
      method: "POST",
      body: JSON.stringify({ deviceId: "dev-1", deviceToken: TOKEN, ...body })
    }),
    { store, now: () => NOW }
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function storeWith(rows: MemoryStore["rows"]): Promise<MemoryStore> {
  const store = new MemoryStore();
  store.tokenHash = await sha256Hex(TOKEN);
  store.rows = rows;
  return store;
}

describe("desktop-billing-requests", () => {
  it("recusa token errado", async () => {
    const store = await storeWith([]);
    const response = await handleBillingRequests(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ deviceId: "dev-1", deviceToken: "outro", action: "claim" })
      }),
      { store, now: () => NOW }
    );
    expect(response.status).toBe(401);
  });

  it("claim pega so os pendentes da unidade e marca processing com o dispositivo", async () => {
    const store = await storeWith([
      { id: "r-1", operation_id: "op-1", status: "pending", unit_id: "u-1" },
      { id: "r-2", operation_id: "op-2", status: "pending", unit_id: "u-9" },
      { id: "r-3", operation_id: "op-3", status: "done", unit_id: "u-1" }
    ]);
    const result = await call(store, { action: "claim" });
    expect(result.status).toBe(200);
    expect(result.body.requests).toEqual([{ id: "r-1", operationId: "op-1" }]);
    expect(store.rows[0]).toMatchObject({ status: "processing", claimed_by: "dev-1" });
    expect(store.rows[1].status).toBe("pending");
  });

  it("pedido abandonado (processing ha mais de 15 min) volta para a fila e e pego de novo", async () => {
    const store = await storeWith([
      {
        id: "r-1",
        operation_id: "op-1",
        status: "processing",
        unit_id: "u-1",
        claimed_by: "dev-antiga",
        claimed_at: "2026-09-22T14:00:00.000Z"
      },
      {
        id: "r-2",
        operation_id: "op-2",
        status: "processing",
        unit_id: "u-1",
        claimed_by: "dev-2",
        claimed_at: "2026-09-22T14:58:00.000Z"
      }
    ]);
    const result = await call(store, { action: "claim" });
    expect((result.body.requests as unknown[]).length).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "processing", claimed_by: "dev-1" });
    // O recente continua com quem pegou.
    expect(store.rows[1].claimed_by).toBe("dev-2");
  });

  it("report grava o resultado so do que este dispositivo pegou", async () => {
    const store = await storeWith([
      {
        id: "r-1",
        operation_id: "op-1",
        status: "processing",
        unit_id: "u-1",
        claimed_by: "dev-1"
      },
      { id: "r-2", operation_id: "op-2", status: "processing", unit_id: "u-1", claimed_by: "dev-2" }
    ]);
    const result = await call(store, {
      action: "report",
      results: [
        { id: "r-1", status: "done", message: "NF-e 123" },
        { id: "r-2", status: "failed", message: "nao e meu" },
        { id: "r-1", status: "invalido" }
      ]
    });
    expect(result.body).toEqual({ ok: true, reported: 2 });
    expect(store.rows[0]).toMatchObject({ status: "done", message: "NF-e 123" });
    expect(store.rows[1].status).toBe("processing");
  });
});
