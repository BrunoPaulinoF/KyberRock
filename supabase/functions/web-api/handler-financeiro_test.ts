import { describe, expect, it } from "vitest";

import type { WebSession, WebSessionResult } from "../_shared/web-session";
import { handleWebApiRequest, type Row, type RowFilter, type WebApiStore } from "./handler";

const COMPANY = "company-1";
const NOW = "2026-09-22T15:00:00.000Z";

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
        filters.every((f) => (f.value === null ? row[f.column] == null : row[f.column] === f.value))
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

function harness(role: WebSession["role"] = "gestor") {
  const store = new MemoryStore();
  let ids = 0;
  const session: WebSession = {
    userId: "user-1",
    email: "g@x",
    name: "Gestor",
    role,
    companyId: COMPANY,
    unitId: "unit-1"
  };
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

const walletSale = (id: string, extra: Row = {}): Row => ({
  id,
  company_id: COMPANY,
  unit_id: "unit-1",
  status: "synced",
  operation_type: "invoice",
  payment_method_id: "pm-carteira",
  wallet_settled_at: null,
  wallet_settlement_method_id: null,
  omie_advance_settle_cents: 0,
  ...extra
});

function seedMethods(store: MemoryStore): void {
  store.seed("payment_methods", [
    {
      id: "pm-carteira",
      company_id: COMPANY,
      name: "Em carteira",
      is_wallet: true,
      is_active: true
    },
    { id: "pm-pix", company_id: COMPANY, name: "PIX", is_wallet: false, is_active: true },
    { id: "pm-off", company_id: COMPANY, name: "Cheque", is_wallet: false, is_active: false }
  ]);
}

describe("web-api: carteira", () => {
  it("comercial nao fecha carteira", async () => {
    const h = harness("comercial");
    const result = await h.call("settle_wallet", {
      operationIds: ["op-1"],
      settlementMethodId: "pm-pix"
    });
    expect(result.status).toBe(403);
  });

  it("fecha as vendas em carteira com forma de recebimento e vencimento", async () => {
    const h = harness();
    seedMethods(h.store);
    h.store.seed("weighing_operations", [walletSale("op-1"), walletSale("op-2")]);

    const result = await h.call("settle_wallet", {
      operationIds: ["op-1", "op-2", "op-1"],
      settlementMethodId: "pm-pix",
      dueDate: "2026-10-05",
      note: "combinado por telefone"
    });

    expect(result.status).toBe(200);
    expect(result.body.settled).toBe(2);
    expect(h.store.rows("weighing_operations")[0]).toMatchObject({
      wallet_settlement_method_id: "pm-pix",
      wallet_settlement_due_date: "2026-10-05",
      wallet_settled_at: NOW,
      wallet_settlement_note: "combinado por telefone",
      updated_at: NOW
    });
  });

  it("recusa fechar com forma em carteira, forma inativa, venda que nao e carteira e cancelada", async () => {
    const h = harness();
    seedMethods(h.store);
    h.store.seed("weighing_operations", [
      walletSale("op-1"),
      walletSale("op-2", { payment_method_id: "pm-pix" }),
      walletSale("op-3", { status: "cancelled" })
    ]);

    expect(
      (await h.call("settle_wallet", { operationIds: ["op-1"], settlementMethodId: "pm-carteira" }))
        .status
    ).toBe(400);
    expect(
      (await h.call("settle_wallet", { operationIds: ["op-1"], settlementMethodId: "pm-off" }))
        .status
    ).toBe(400);
    expect(
      (await h.call("settle_wallet", { operationIds: ["op-2"], settlementMethodId: "pm-pix" }))
        .status
    ).toBe(400);
    expect(
      (await h.call("settle_wallet", { operationIds: ["op-3"], settlementMethodId: "pm-pix" }))
        .status
    ).toBe(400);
    // Nada foi gravado em nenhuma tentativa: a validacao vem antes da escrita.
    expect(h.store.rows("weighing_operations").every((row) => row.wallet_settled_at === null)).toBe(
      true
    );
  });

  it("reabre o fechamento, mas nunca a venda abatida do adiantamento", async () => {
    const h = harness();
    h.store.seed("weighing_operations", [
      walletSale("op-1", {
        wallet_settled_at: "2026-09-01",
        wallet_settlement_method_id: "pm-pix"
      }),
      walletSale("op-2", {
        wallet_settled_at: "2026-09-01",
        wallet_settlement_method_id: null,
        omie_advance_settle_cents: 5000
      })
    ]);

    const ok = await h.call("reopen_wallet", { operationIds: ["op-1"] });
    expect(ok.status).toBe(200);
    expect(ok.body.reopened).toBe(1);
    expect(h.store.rows("weighing_operations")[0]).toMatchObject({
      wallet_settled_at: null,
      wallet_settlement_method_id: null,
      updated_at: NOW
    });

    const blocked = await h.call("reopen_wallet", { operationIds: ["op-2"] });
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.error)).toContain("adiantamento");
  });
});

describe("web-api: fechamento de faturas", () => {
  it("cria um pedido por pesagem elegivel e explica as puladas", async () => {
    const h = harness();
    h.store.seed("weighing_operations", [
      walletSale("op-1"),
      walletSale("op-2", { omie_invoice_number: "28727" }),
      walletSale("op-3", { operation_type: "internal" }),
      walletSale("op-4", { unit_id: "unit-2" })
    ]);
    h.store.seed("billing_requests", [
      { id: "old", company_id: COMPANY, operation_id: "op-4", status: "processing" }
    ]);

    const result = await h.call("request_invoice_closing", {
      operationIds: ["op-1", "op-2", "op-3", "op-4"]
    });

    expect(result.status).toBe(200);
    expect(result.body.requested).toBe(1);
    expect((result.body.skipped as Row[]).map((s) => s.operationId)).toEqual([
      "op-2",
      "op-3",
      "op-4"
    ]);
    const created = h.store.rows("billing_requests").find((row) => row.id === "id-1");
    expect(created).toMatchObject({
      company_id: COMPANY,
      unit_id: "unit-1",
      operation_id: "op-1",
      requested_by: "user-1",
      status: "pending",
      requested_at: NOW
    });
  });

  it("pesagem de outra empresa e 404 e nada e pedido", async () => {
    const h = harness();
    h.store.seed("weighing_operations", [walletSale("op-9", { company_id: "outra" })]);
    const result = await h.call("request_invoice_closing", { operationIds: ["op-9"] });
    expect(result.status).toBe(404);
    expect(h.store.rows("billing_requests")).toHaveLength(0);
  });
});
