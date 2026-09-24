import { describe, expect, it } from "vitest";

import type { WebSession, WebSessionResult } from "../_shared/web-session";
import { handleWebApiRequest, type Row, type RowFilter, type WebApiStore } from "./handler";

const COMPANY = "company-1";
const NOW = "2026-09-25T15:00:00.000Z";

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
    options?: { live?: boolean }
  ): Promise<Row[]> {
    return this.rows(table).filter(
      (row) =>
        row.company_id === companyId &&
        (!options?.live || !row.deleted_at) &&
        filters.every((f) => row[f.column] === f.value)
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
    unitId: "unit-1",
    requiresPricePassword: false
  };
  store.seed("report_channel_settings", [
    {
      company_id: COMPANY,
      smtp_host: "smtp.x",
      smtp_user: "u",
      smtp_password: "segredo-smtp",
      smtp_sender: "relatorios@x",
      whatsapp_url: "https://uazapi",
      whatsapp_instance_token: "segredo-whats",
      whatsapp_status: "connected"
    }
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

describe("web-api: destinatarios do fechamento diario", () => {
  it("so o gestor mexe", async () => {
    for (const role of ["operacao", "comercial", "monitoramento"] as const) {
      expect((await harness(role).call("list_report_recipients")).status, role).toBe(403);
    }
  });

  it("cria com as regras do desktop e a lista nao entrega senha nem token", async () => {
    const h = harness();
    const created = await h.call("save_report_recipient", {
      displayName: " Joao ",
      email: "JOAO@X.COM",
      sendEmail: true,
      sendWhatsapp: true,
      whatsappPhone: "(15) 99999-1234",
      scheduleTime: "7:30",
      reportTypes: "both"
    });
    expect(created.status).toBe(200);
    expect(h.store.rows("report_recipients")[0]).toMatchObject({
      id: "id-1",
      company_id: COMPANY,
      display_name: "Joao",
      email: "joao@x.com",
      whatsapp_phone: "5515999991234",
      schedule_time: "07:00",
      schedule_frequency: "daily",
      report_types: "both",
      is_active: true
    });
    const list = await h.call("list_report_recipients");
    expect(list.body.channels).toEqual({
      emailConfigured: true,
      emailSender: "relatorios@x",
      whatsappConfigured: true,
      whatsappStatus: "connected"
    });
    expect(JSON.stringify(list.body)).not.toContain("segredo");
  });

  it("recusa sem canal, e-mail invalido e repetido", async () => {
    const h = harness();
    expect(
      (await h.call("save_report_recipient", { sendEmail: false, sendWhatsapp: false })).status
    ).toBe(400);
    expect((await h.call("save_report_recipient", { email: "nao-e-email" })).status).toBe(400);
    expect((await h.call("save_report_recipient", { email: "a@x.com" })).status).toBe(200);
    expect((await h.call("save_report_recipient", { email: "A@x.com" })).status).toBe(409);
  });

  it("edita e exclui por tombstone", async () => {
    const h = harness();
    await h.call("save_report_recipient", { email: "a@x.com" });
    expect(
      (await h.call("save_report_recipient", { id: "id-1", email: "b@x.com", isActive: false }))
        .status
    ).toBe(200);
    expect(h.store.rows("report_recipients")[0]).toMatchObject({
      email: "b@x.com",
      is_active: false
    });
    expect((await h.call("delete_report_recipient", { id: "id-1" })).status).toBe(200);
    expect(h.store.rows("report_recipients")[0]).toMatchObject({
      deleted_at: NOW,
      is_active: false
    });
    const list = await h.call("list_report_recipients");
    expect(list.body.recipients).toEqual([]);
  });
});
