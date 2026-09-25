import { describe, expect, it } from "vitest";

import type { WebSession, WebSessionResult } from "../_shared/web-session";
import { handleWebApiRequest, type Row, type RowFilter, type WebApiStore } from "./handler";

const COMPANY = "company-1";
const NOW = "2026-09-25T15:00:00.000Z";

/** Mesma leitura de filtro do `index.ts`: igualdade, `in`, `gte` e `lte`. */
function matchesFilter(row: Row, filter: RowFilter): boolean {
  const value = row[filter.column];
  if (filter.op === "in") return (filter.value as unknown[]).includes(value);
  if (filter.op === "gte") return value != null && String(value) >= String(filter.value);
  if (filter.op === "lte") return value != null && String(value) <= String(filter.value);
  return filter.value === null ? value == null : value === filter.value;
}

class MemoryStore implements WebApiStore {
  readonly tables = new Map<string, Row[]>();
  seed(table: string, rows: Row[]): void {
    this.tables.set(table, [...(this.tables.get(table) ?? []), ...rows]);
  }
  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }
  async getRow(table: string, companyId: string, id: string): Promise<Row | null> {
    return this.rows(table).find((row) => row.id === id && row.company_id === companyId) ?? null;
  }
  async listRows(
    table: string,
    companyId: string,
    _columns: string,
    filters: RowFilter[],
    options?: { live?: boolean; anyCompany?: boolean }
  ): Promise<Row[]> {
    return this.rows(table).filter(
      (row) =>
        (options?.anyCompany || row.company_id === companyId) &&
        (!options?.live || !row.deleted_at) &&
        filters.every((f) => matchesFilter(row, f))
    );
  }
  async insertRow(table: string, row: Row): Promise<void> {
    this.seed(table, [{ ...row }]);
  }
  async updateRow(table: string, _companyId: string, id: string, patch: Row): Promise<void> {
    const row = this.rows(table).find((candidate) => candidate.id === id);
    if (!row) throw new Error(`linha inexistente ${table}/${id}`);
    Object.assign(row, patch);
  }
}

function harness(
  role: WebSession["role"] = "operacao",
  options: {
    requiresPricePassword?: boolean;
    executorSeenAt?: string | null;
    executor?: boolean;
    appVersion?: string;
  } = {}
) {
  const store = new MemoryStore();
  let ids = 0;
  const session: WebSession = {
    userId: "user-1",
    email: "op@x",
    name: "Operador",
    role,
    companyId: COMPANY,
    unitId: "unit-1",
    requiresPricePassword: options.requiresPricePassword ?? false
  };
  store.seed("companies", [{ id: COMPANY, price_change_password: "4321" }]);
  if (options.executor !== false) {
    store.seed("device_registrations", [
      {
        id: "desktop-principal",
        company_id: COMPANY,
        unit_id: "unit-1",
        name: "PC PRINCIPAL",
        is_active: true,
        executes_web_operations: true,
        app_version: options.appVersion ?? "0.8.252",
        web_executor_seen_at:
          options.executorSeenAt === undefined ? "2026-09-25T14:59:40.000Z" : options.executorSeenAt
      }
    ]);
  }
  for (const [table, id] of [
    ["customers", "c1"],
    ["products", "p1"],
    ["vehicles", "v1"],
    ["drivers", "d1"],
    ["carriers", "t1"]
  ]) {
    store.seed(table, [{ id, company_id: COMPANY, is_active: true }]);
  }
  store.seed("customers", [{ id: "c-off", company_id: COMPANY, is_active: false }]);
  store.seed("weighing_operations", [
    { id: "op-open", company_id: COMPANY, unit_id: "unit-1", status: "open" },
    { id: "op-done", company_id: COMPANY, unit_id: "unit-1", status: "synced" },
    { id: "op-cancel", company_id: COMPANY, unit_id: "unit-1", status: "cancelled" }
  ]);
  return {
    store,
    async call(action: string, payload: Row = {}) {
      const response = await handleWebApiRequest(
        new Request("https://x/functions/v1/web-api", {
          method: "POST",
          headers: { Authorization: "Bearer jwt" },
          body: JSON.stringify({ action, payload })
        }),
        {
          store,
          resolveSession: async (): Promise<WebSessionResult> => ({ ok: true, session }),
          omie: { push: async () => ({ omieCustomerId: 1 }) },
          now: () => new Date(NOW),
          newId: () => `id-${++ids}`
        }
      );
      return { status: response.status, body: (await response.json()) as Row };
    }
  };
}

const ENTRY = {
  customerId: "c1",
  vehicleId: "v1",
  driverId: "d1",
  productId: "p1",
  carrierId: "t1",
  entryWeightKg: "15.420"
};

describe("web-api: pesagem pelo site", () => {
  it("entrada vira pedido pendente para a balanca, com o id da pesagem ja definido", async () => {
    const h = harness();
    const result = await h.call("request_operation", { kind: "entry", data: ENTRY });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ requestId: "id-2", operationId: "id-1", warnings: [] });
    expect(h.store.rows("operation_requests")).toEqual([
      expect.objectContaining({
        id: "id-2",
        company_id: COMPANY,
        unit_id: "unit-1",
        kind: "entry",
        operation_id: "id-1",
        status: "pending",
        requested_by: "user-1",
        requested_by_name: "Operador",
        payload: {
          customerId: "c1",
          vehicleId: "v1",
          driverId: "d1",
          productId: "p1",
          carrierId: "t1",
          operationType: "invoice",
          entryWeightKg: 15420
        }
      })
    ]);
  });

  it("Nova entrada: so operacao e administrador; o gestor fecha, altera e reimprime", async () => {
    for (const role of ["monitoramento", "comercial", "gestor"] as const) {
      const result = await harness(role).call("request_operation", { kind: "entry", data: ENTRY });
      expect(result.status, role).toBe(403);
    }
    expect(
      (await harness("administrador").call("request_operation", { kind: "entry", data: ENTRY }))
        .status
    ).toBe(200);
    const gestor = harness("gestor");
    expect(
      (await gestor.call("request_operation", { kind: "reprint", operationId: "op-done" })).status
    ).toBe(200);
    expect(gestor.store.rows("operation_requests")).toHaveLength(1);
  });

  it("recusa cadastro inativo ou de fora da empresa antes de chegar na balanca", async () => {
    const h = harness();
    const inactive = await h.call("request_operation", {
      kind: "entry",
      data: { ...ENTRY, customerId: "c-off" }
    });
    expect(inactive.status).toBe(400);
    const missing = await h.call("request_operation", {
      kind: "entry",
      data: { ...ENTRY, productId: "p-outra-empresa" }
    });
    expect(missing.status).toBe(404);
    expect(h.store.rows("operation_requests")).toHaveLength(0);
  });

  it("sem balanca executora marcada, nao aceita o pedido", async () => {
    const result = await harness("operacao", { executor: false }).call("request_operation", {
      kind: "entry",
      data: ENTRY
    });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("Acessos do sistema");
  });

  it("executora fora do ar: aceita e avisa que fica na fila", async () => {
    const result = await harness("operacao", { executorSeenAt: "2026-09-25T14:00:00.000Z" }).call(
      "request_operation",
      { kind: "entry", data: ENTRY }
    );
    expect(result.status).toBe(200);
    expect(String((result.body.warnings as string[])[0])).toContain("fora do ar");
  });

  it("fechamento so de pesagem no patio, e um de cada vez", async () => {
    const h = harness();
    expect(
      (
        await h.call("request_operation", {
          kind: "exit",
          operationId: "op-done",
          data: { exitWeightKg: 40000 }
        })
      ).status
    ).toBe(409);
    expect(
      (
        await h.call("request_operation", {
          kind: "exit",
          operationId: "op-cancel",
          data: { exitWeightKg: 40000 }
        })
      ).status
    ).toBe(409);
    const first = await h.call("request_operation", {
      kind: "exit",
      operationId: "op-open",
      data: { exitWeightKg: 40000 }
    });
    expect(first.status).toBe(200);
    const second = await h.call("request_operation", {
      kind: "cancel",
      operationId: "op-open",
      data: { reason: "engano" }
    });
    expect(second.status).toBe(409);
  });

  it("pesagem concluida: so cliente, produto e transportadora mudam", async () => {
    const h = harness();
    expect(
      (
        await h.call("request_operation", {
          kind: "update",
          operationId: "op-done",
          data: { productId: "p1" }
        })
      ).status
    ).toBe(200);
    expect(
      (
        await h.call("request_operation", {
          kind: "update",
          operationId: "op-done",
          data: { vehicleId: "v1" }
        })
      ).status
    ).toBe(409);
  });

  it("reimpressao so de pesagem concluida", async () => {
    const h = harness();
    expect(
      (await h.call("request_operation", { kind: "reprint", operationId: "op-open" })).status
    ).toBe(409);
    expect(
      (await h.call("request_operation", { kind: "reprint", operationId: "op-done" })).status
    ).toBe(200);
  });

  it("preco: quem tem a marca precisa da senha certa, e a senha nao e gravada no pedido", async () => {
    const h = harness("operacao", { requiresPricePassword: true });
    const change = { kind: "update", operationId: "op-open", data: { unitPriceCents: 6500 } };
    expect((await h.call("request_operation", change)).status).toBe(403);
    expect((await h.call("request_operation", { ...change, pricePassword: "0000" })).status).toBe(
      403
    );
    const ok = await h.call("request_operation", { ...change, pricePassword: "4321" });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(h.store.rows("operation_requests"))).not.toContain("4321");
    // Sem a marca, nao pede senha.
    const free = harness("gestor");
    expect((await free.call("request_operation", change)).status).toBe(200);
  });

  it("5 senhas erradas travam o login por 15 min, mesmo acertando depois", async () => {
    const h = harness("operacao", { requiresPricePassword: true });
    const change = { kind: "update", operationId: "op-open", data: { unitPriceCents: 6500 } };
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await h.call("request_operation", { ...change, pricePassword: "0000" })).status).toBe(
        403
      );
    }
    const locked = await h.call("request_operation", { ...change, pricePassword: "4321" });
    expect(locked.status).toBe(429);
    expect(h.store.rows("operation_requests")).toHaveLength(0);
  });

  it("fechamento duplicado barrado pelo indice do banco vira o mesmo 409", async () => {
    const h = harness();
    const insert = h.store.insertRow.bind(h.store);
    h.store.insertRow = async (table, row) => {
      if (table === "operation_requests") {
        throw new Error("operation_requests: duplicate key value (code=23505)");
      }
      return insert(table, row);
    };
    const result = await h.call("request_operation", {
      kind: "exit",
      operationId: "op-open",
      data: { exitWeightKg: 40000 }
    });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("Ja existe um fechamento");
  });

  it("frete ou condicao digitada so vai para executora que entende (versao nova)", async () => {
    const withFreight = {
      kind: "entry",
      data: {
        ...ENTRY,
        freightModality: "fob",
        freight: { calculationType: "per_ton", baseValueCents: 1500 }
      }
    };
    const old = await harness("operacao").call("request_operation", withFreight);
    expect(old.status).toBe(409);
    expect(String(old.body.error)).toContain("precisa ser atualizada");
    const oldCondition = await harness("operacao").call("request_operation", {
      kind: "entry",
      data: { ...ENTRY, conditionText: "30" }
    });
    expect(oldCondition.status).toBe(409);
    // Sem frete e sem condicao digitada, a executora antiga continua servindo.
    const plain = await harness("operacao").call("request_operation", {
      kind: "entry",
      data: { ...ENTRY, freightModality: "third_party" }
    });
    expect(plain.status).toBe(200);
    const h = harness("operacao", { appVersion: "0.8.260" });
    const ok = await h.call("request_operation", withFreight);
    expect(ok.status).toBe(200);
    expect(h.store.rows("operation_requests")[0].payload).toMatchObject({
      freightModality: "fob",
      freight: { calculationType: "per_ton", baseValueCents: 1500 }
    });
  });

  it("status da executora para a tela", async () => {
    const online = await harness().call("operation_status");
    expect(online.body).toMatchObject({
      executor: { deviceId: "desktop-principal", name: "PC PRINCIPAL", online: true },
      requiresPricePassword: false
    });
    const offline = await harness("monitoramento", { executorSeenAt: null }).call(
      "operation_status"
    );
    expect(offline.status).toBe(200);
    expect(offline.body).toMatchObject({ executor: { online: false } });
    const none = await harness("operacao", { executor: false }).call("operation_status");
    expect(none.body).toMatchObject({ executor: null });
  });

  it("status avisa quando a executora precisa ser atualizada", async () => {
    const old = await harness().call("operation_status");
    expect(old.body).toMatchObject({
      executor: { appVersion: "0.8.252", needsUpdate: true, minVersion: "0.8.253" }
    });
    const current = await harness("operacao", { appVersion: "0.8.253" }).call("operation_status");
    expect(current.body).toMatchObject({ executor: { needsUpdate: false } });
  });
});
