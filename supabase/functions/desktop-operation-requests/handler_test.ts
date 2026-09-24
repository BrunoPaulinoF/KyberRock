import { describe, expect, it } from "vitest";

import { sha256Hex } from "../_shared/crypto";
import {
  handleOperationRequests,
  type DeviceRow,
  type OperationRequestOutcome,
  type OperationRequestRow,
  type OperationRequestStore
} from "./handler";

const NOW = new Date("2026-09-25T15:00:00.000Z");
const TOKEN = "token-da-balanca";

type StoredRow = OperationRequestRow & {
  unit_id: string;
  claimed_by?: string | null;
  outcome?: OperationRequestOutcome;
};

class MemoryStore implements OperationRequestStore {
  rows: StoredRow[] = [];
  touches: string[] = [];
  device: DeviceRow = {
    id: "dev-1",
    company_id: "c-1",
    unit_id: "u-1",
    token_hash: "",
    is_active: true,
    executes_web_operations: true,
    web_executor_seen_at: null
  };

  async getDevice(deviceId: string) {
    if (deviceId !== this.device.id) {
      return { data: null, error: { message: "not found", code: "PGRST116" } };
    }
    return { data: this.device, error: null };
  }
  async touchExecutor(_deviceId: string, nowIso: string) {
    this.touches.push(nowIso);
  }
  async listPending(unitId: string, limit: number) {
    return this.rows.filter((r) => r.unit_id === unitId && r.status === "pending").slice(0, limit);
  }
  async listProcessing(unitId: string) {
    return this.rows.filter((r) => r.unit_id === unitId && r.status === "processing");
  }
  async claim(ids: string[], deviceId: string, nowIso: string) {
    const claimed: OperationRequestRow[] = [];
    // De tras para frente de proposito: o handler tem que devolver na ordem de chegada.
    for (const row of [...this.rows].reverse()) {
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
  async report(id: string, deviceId: string, outcome: OperationRequestOutcome) {
    const row = this.rows.find((r) => r.id === id && r.claimed_by === deviceId);
    if (!row) return;
    row.status = outcome.status;
    row.outcome = outcome;
  }
}

async function setup() {
  const store = new MemoryStore();
  store.device.token_hash = await sha256Hex(TOKEN);
  return store;
}

async function call(store: MemoryStore, body: Record<string, unknown>) {
  const response = await handleOperationRequests(
    new Request("https://x/functions/v1/desktop-operation-requests", {
      method: "POST",
      body: JSON.stringify({ deviceId: "dev-1", deviceToken: TOKEN, ...body })
    }),
    { store, now: () => NOW }
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function request(id: string, extra: Partial<StoredRow> = {}): StoredRow {
  return {
    id,
    unit_id: "u-1",
    kind: "entry",
    operation_id: `op-${id}`,
    payload: { entryWeightKg: 15000 },
    requested_by_name: "Operador",
    status: "pending",
    ...extra
  };
}

describe("desktop-operation-requests", () => {
  it("token errado e 401", async () => {
    const store = await setup();
    const response = await handleOperationRequests(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ deviceId: "dev-1", deviceToken: "outro", action: "claim" })
      }),
      { store, now: () => NOW }
    );
    expect(response.status).toBe(401);
  });

  it("so a executora pega pedido; as outras nem carimbam presenca", async () => {
    const store = await setup();
    store.device.executes_web_operations = false;
    store.rows.push(request("r1"));
    const result = await call(store, { action: "claim" });
    expect(result.body).toEqual({ ok: true, executor: false, requests: [] });
    expect(store.rows[0].status).toBe("pending");
    expect(store.touches).toEqual([]);
  });

  it("pega os pendentes da unidade na ordem de chegada e carimba presenca", async () => {
    const store = await setup();
    store.rows.push(
      request("r1"),
      request("r2", { kind: "exit", operation_id: "op-r1", payload: { exitWeightKg: 40000 } }),
      request("r3", { unit_id: "u-outra" })
    );
    const result = await call(store, { action: "claim" });
    expect(result.body.requests).toEqual([
      {
        id: "r1",
        kind: "entry",
        operationId: "op-r1",
        payload: { entryWeightKg: 15000 },
        requestedByName: "Operador"
      },
      {
        id: "r2",
        kind: "exit",
        operationId: "op-r1",
        payload: { exitWeightKg: 40000 },
        requestedByName: "Operador"
      }
    ]);
    expect(store.rows.map((r) => r.status)).toEqual(["processing", "processing", "pending"]);
    expect(store.touches).toEqual([NOW.toISOString()]);
  });

  it("presenca recente nao e regravada a cada pergunta", async () => {
    const store = await setup();
    store.device.web_executor_seen_at = "2026-09-25T14:59:55.000Z";
    await call(store, { action: "claim" });
    expect(store.touches).toEqual([]);
  });

  it("pedido abandonado ha mais de 5 min volta e e pego de novo", async () => {
    const store = await setup();
    store.rows.push(
      request("r1", { status: "processing", claimed_at: "2026-09-25T14:50:00.000Z" }),
      request("r2", { status: "processing", claimed_at: "2026-09-25T14:58:00.000Z" })
    );
    const result = await call(store, { action: "claim" });
    expect((result.body.requests as Array<{ id: string }>).map((r) => r.id)).toEqual(["r1"]);
    expect(store.rows[1].status).toBe("processing");
  });

  it("report grava resultado, cupom e resumo so dos pedidos deste dispositivo", async () => {
    const store = await setup();
    store.rows.push(
      request("r1", { status: "processing", claimed_by: "dev-1" }),
      request("r2", { status: "processing", claimed_by: "dev-outro" })
    );
    const result = await call(store, {
      action: "report",
      results: [
        {
          id: "r1",
          status: "done",
          message: "Pesagem 123 fechada.",
          result: { operationCode: 123, netWeightKg: 25000 },
          printStatus: "failed",
          printMessage: "Impressora sem papel"
        },
        { id: "r2", status: "done", message: "x" },
        { id: "r3", status: "talvez" }
      ]
    });
    expect(result.body).toEqual({ ok: true, reported: 2 });
    expect(store.rows[0].outcome).toEqual({
      status: "done",
      message: "Pesagem 123 fechada.",
      result: { operationCode: 123, netWeightKg: 25000 },
      printStatus: "failed",
      printMessage: "Impressora sem papel"
    });
    expect(store.rows[1].status).toBe("processing");
  });
});
