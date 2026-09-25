import { describe, expect, it } from "vitest";

import type { WebSession, WebSessionResult } from "../_shared/web-session";
import {
  actionDenial,
  CUSTOMER_ACTIONS,
  FLEET_ACTIONS,
  GESTOR_ONLY_ACTIONS,
  handleWebApiRequest,
  OPERATION_ACTIONS,
  PRICE_ACTIONS,
  READ_ACTIONS,
  SUPPORT_ACTIONS,
  WEB_API_ACTIONS,
  type ListRowsOptions,
  type OmieBridge,
  type Row,
  type RowFilter,
  type WebApiStore
} from "./handler";

const COMPANY = "company-1";
const OTHER_COMPANY = "company-2";
const NOW = "2026-09-22T15:00:00.000Z";

/** Banco em memoria: um mapa de tabela -> linhas, com as quatro operacoes do store. */
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
    options?: ListRowsOptions
  ): Promise<Row[]> {
    const rows = this.rows(table).filter((row) => {
      if (!options?.anyCompany && row.company_id !== companyId) return false;
      if (options?.live && row.deleted_at) return false;
      return filters.every((filter) => {
        const value = row[filter.column];
        if (filter.op === "in") return (filter.value as unknown[]).includes(value);
        if (filter.op === "gte") return value != null && String(value) >= String(filter.value);
        if (filter.op === "lte") return value != null && String(value) <= String(filter.value);
        return filter.value === null ? value == null : value === filter.value;
      });
    });
    const order = options?.orderBy;
    const sorted = order
      ? [...rows].sort((a, b) => {
          const diff = String(a[order.column] ?? "").localeCompare(String(b[order.column] ?? ""));
          return order.ascending ? diff : -diff;
        })
      : rows;
    return options?.limit ? sorted.slice(0, options.limit) : sorted;
  }

  async insertRow(table: string, row: Row): Promise<void> {
    this.seed(table, [{ ...row }]);
  }

  async updateRow(table: string, companyId: string, id: string, patch: Row): Promise<void> {
    const row = this.rows(table).find((candidate) => candidate.id === id);
    if (!row) throw new Error(`update em linha inexistente: ${table}/${id}`);
    if (row.company_id !== undefined && row.company_id !== null && row.company_id !== companyId) {
      throw new Error(`update fora da empresa: ${table}/${id}`);
    }
    Object.assign(row, patch);
  }
}

function session(role: WebSession["role"], requiresPricePassword = false): WebSession {
  return {
    userId: "user-1",
    email: "rafaela@pedreira.com",
    name: "Rafaela",
    role,
    companyId: COMPANY,
    unitId: "unit-1",
    requiresPricePassword
  };
}

interface Harness {
  store: MemoryStore;
  pushes: Array<{ action: string; payload: Row }>;
  call(action: string, payload?: Row): Promise<{ status: number; body: Row }>;
}

function harness(
  input: {
    role?: WebSession["role"];
    requiresPricePassword?: boolean;
    sessionResult?: WebSessionResult;
    omie?: Partial<OmieBridge>;
  } = {}
): Harness {
  const store = new MemoryStore();
  const pushes: Array<{ action: string; payload: Row }> = [];
  let ids = 0;
  const omie: OmieBridge = {
    push: async (action, payload) => {
      pushes.push({ action, payload });
      return { omieCustomerId: 777 };
    },
    ...input.omie
  };
  const resolveSession = async (): Promise<WebSessionResult> =>
    input.sessionResult ?? {
      ok: true,
      session: session(input.role ?? "gestor", input.requiresPricePassword)
    };

  return {
    store,
    pushes,
    async call(action, payload = {}) {
      const response = await handleWebApiRequest(
        new Request("https://example.supabase.co/functions/v1/web-api", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
          body: JSON.stringify({ action, payload })
        }),
        {
          store,
          resolveSession,
          omie,
          now: () => new Date(NOW),
          newId: () => `id-${++ids}`
        }
      );
      return { status: response.status, body: (await response.json()) as Row };
    }
  };
}

describe("web-api: sessao e permissoes", () => {
  it("preflight CORS passa sem sessao", async () => {
    const response = await handleWebApiRequest(
      new Request("https://x/functions/v1/web-api", { method: "OPTIONS" }),
      {
        store: new MemoryStore(),
        resolveSession: async () => ({ ok: false, status: 401, error: "x" }),
        omie: { push: async () => ({ omieCustomerId: 1 }) }
      }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("sem sessao valida devolve o status de quem resolveu a sessao", async () => {
    const h = harness({ sessionResult: { ok: false, status: 401, error: "Faca login." } });
    const result = await h.call("me");
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Faca login." });
  });

  it("acao desconhecida lista as que existem", async () => {
    const result = await harness().call("apagar_tudo");
    expect(result.status).toBe(400);
    expect(result.body.actions).toContain("upsert_customer");
  });

  it("monitoramento so consulta: nenhuma escrita passa", async () => {
    const h = harness({ role: "monitoramento" });
    for (const action of [
      "upsert_customer",
      "upsert_vehicle",
      "upsert_driver",
      "upsert_carrier",
      "set_product_default_price",
      "set_customer_commercial",
      "settle_wallet",
      "request_invoice_closing",
      "save_report_recipient"
    ]) {
      const result = await h.call(action, { name: "X", plate: "ABC1D23", id: "x" });
      expect(result.status, action).toBe(403);
      expect(result.body.error, action).toContain("so consulta");
    }
    expect(h.store.rows("customers")).toHaveLength(0);
    expect(h.store.rows("vehicles")).toHaveLength(0);
    expect((await h.call("me")).status).toBe(200);
  });

  it("comercial cadastra tudo e muda preco sem senha, mas nao pesa nem fecha", async () => {
    const h = harness({ role: "comercial", requiresPricePassword: false });
    h.store.seed("products", [{ id: "p-1", company_id: COMPANY }]);
    expect((await h.call("upsert_vehicle", { plate: "ABC1D23" })).status).toBe(200);
    const customer = await h.call("upsert_customer", { legalName: "X", document: "52998224725" });
    expect(customer.status).toBe(200);
    expect(
      (await h.call("set_customer_commercial", { id: customer.body.id, nfRequired: true })).status
    ).toBe(200);
    expect(
      (await h.call("set_product_default_price", { productId: "p-1", unitPriceCents: 6500 })).status
    ).toBe(200);
    for (const action of [
      "request_operation",
      "settle_wallet",
      "request_invoice_closing",
      "save_report_recipient"
    ]) {
      expect((await h.call(action, { id: "x" })).status, action).toBe(403);
    }
  });

  it("operacao e administrador cadastram cliente e frota", async () => {
    for (const role of ["operacao", "administrador"] as const) {
      const h = harness({ role });
      expect((await h.call("upsert_vehicle", { plate: "ABC1D23" })).status, role).toBe(200);
      const customer = await h.call("upsert_customer", {
        legalName: "X",
        document: "52998224725"
      });
      expect(customer.status, role).toBe(200);
    }
  });

  it("toda acao tem dono: nenhuma nasce liberada para quem so consulta", () => {
    for (const action of WEB_API_ACTIONS) {
      const groups = [
        READ_ACTIONS.has(action),
        SUPPORT_ACTIONS.has(action),
        OPERATION_ACTIONS.has(action),
        GESTOR_ONLY_ACTIONS.has(action),
        PRICE_ACTIONS.has(action),
        CUSTOMER_ACTIONS.has(action),
        FLEET_ACTIONS.has(action)
      ].filter(Boolean);
      expect(groups, action).toHaveLength(1);
      expect(actionDenial("administrador", action), action).toBeNull();
      if (!SUPPORT_ACTIONS.has(action)) {
        expect(actionDenial("gestor", action), action).toBeNull();
        expect(actionDenial("operacao", action), action).toBeNull();
      }
      if (!READ_ACTIONS.has(action)) {
        expect(actionDenial("monitoramento", action), action).not.toBeNull();
      }
      const cadastro =
        CUSTOMER_ACTIONS.has(action) || FLEET_ACTIONS.has(action) || PRICE_ACTIONS.has(action);
      expect(actionDenial("comercial", action) === null, action).toBe(
        cadastro || READ_ACTIONS.has(action)
      );
    }
  });

  it("me devolve o perfil e as unidades da empresa", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("units", [
      {
        id: "unit-1",
        company_id: COMPANY,
        name: "Matriz",
        timezone: "America/Sao_Paulo",
        is_active: true
      },
      { id: "unit-9", company_id: OTHER_COMPANY, name: "Outra", timezone: "x", is_active: true }
    ]);
    const result = await h.call("me");
    expect(result.status).toBe(200);
    expect(result.body.user).toMatchObject({
      role: "gestor",
      canManagePrices: true,
      canEditPrices: true,
      canEditCustomers: true,
      canEditFleet: true,
      canOperate: true,
      canCreateEntry: false,
      canSeeSupport: false
    });
    expect((result.body.units as Row[]).map((unit) => unit.id)).toEqual(["unit-1"]);
  });
});

describe("web-api: cliente", () => {
  it("cria o cliente na empresa da sessao e manda para o OMIE", async () => {
    const h = harness();
    const result = await h.call("upsert_customer", {
      legalName: "Polymix Ltda",
      document: "11.222.333/0001-81",
      phone: "(15) 3333-4444",
      state: "sp"
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, id: "id-1", omieCustomerId: 777, warnings: [] });
    const row = h.store.rows("customers")[0];
    expect(row).toMatchObject({
      id: "id-1",
      company_id: COMPANY,
      legal_name: "Polymix Ltda",
      trade_name: "Polymix Ltda",
      document: "11222333000181",
      is_individual: false,
      state: "SP",
      credit_mode: "normal",
      is_active: true,
      omie_customer_id: 777,
      created_at: NOW,
      updated_at: NOW
    });
    expect(h.pushes).toEqual([
      {
        action: "push_customer",
        payload: expect.objectContaining({
          localCustomerId: "id-1",
          razaoSocial: "Polymix Ltda",
          cnpjCpf: "11222333000181",
          telefone1Ddd: "15"
        })
      }
    ]);
  });

  it("documento repetido na empresa e recusado com o nome de quem ja tem", async () => {
    const h = harness();
    h.store.seed("customers", [
      {
        id: "c-1",
        company_id: COMPANY,
        legal_name: "Polymix Ltda",
        trade_name: "Polymix",
        document: "11222333000181",
        is_active: false
      }
    ]);
    const result = await h.call("upsert_customer", {
      legalName: "Polymix de novo",
      document: "11222333000181"
    });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("Polymix");
    expect(String(result.body.error)).toContain("inativo");
    expect(h.store.rows("customers")).toHaveLength(1);
    expect(h.pushes).toHaveLength(0);
  });

  it("o mesmo documento em OUTRA empresa nao atrapalha", async () => {
    const h = harness();
    h.store.seed("customers", [
      { id: "c-9", company_id: OTHER_COMPANY, legal_name: "X", document: "11222333000181" }
    ]);
    const result = await h.call("upsert_customer", { legalName: "Y", document: "11222333000181" });
    expect(result.status).toBe(200);
  });

  it("sem documento o cliente e salvo, mas nao vai ao OMIE — e a resposta avisa", async () => {
    const h = harness();
    const result = await h.call("upsert_customer", { legalName: "Cliente de balcao" });
    expect(result.status).toBe(200);
    expect(result.body.omieCustomerId).toBeNull();
    expect(result.body.warnings).toHaveLength(1);
    expect(String((result.body.warnings as string[])[0])).toContain("CPF/CNPJ");
    expect(h.pushes).toHaveLength(0);
  });

  /** O cadastro nunca e desfeito por causa do OMIE: fica gravado e a proxima edicao tenta. */
  it("OMIE fora do ar nao desfaz o cadastro", async () => {
    const h = harness({
      omie: {
        push: async () => {
          throw new Error("OMIE indisponivel");
        }
      }
    });
    const result = await h.call("upsert_customer", {
      legalName: "Polymix Ltda",
      document: "11222333000181"
    });
    expect(result.status).toBe(200);
    expect(h.store.rows("customers")).toHaveLength(1);
    expect(h.store.rows("customers")[0].omie_customer_id).toBeUndefined();
    expect(String((result.body.warnings as string[])[0])).toContain("OMIE indisponivel");
  });

  it("edita so os campos enviados e nunca uma linha de outra empresa", async () => {
    const h = harness();
    h.store.seed("customers", [
      {
        id: "c-1",
        company_id: COMPANY,
        legal_name: "Polymix Ltda",
        trade_name: "Polymix",
        document: "11222333000181",
        phone: "(15) 1111-1111",
        city: "Ibiuna",
        omie_customer_id: 777
      },
      { id: "c-2", company_id: OTHER_COMPANY, legal_name: "Alheia", document: null }
    ]);

    const edited = await h.call("upsert_customer", { id: "c-1", phone: null, email: "a@b.com" });
    expect(edited.status).toBe(200);
    expect(h.store.rows("customers")[0]).toMatchObject({
      phone: null,
      email: "a@b.com",
      city: "Ibiuna",
      legal_name: "Polymix Ltda",
      updated_at: NOW
    });
    // Ja tinha codigo OMIE: o push vai como alteracao (omieCustomerId no payload).
    expect(h.pushes[0].payload.omieCustomerId).toBe(777);

    const foreign = await h.call("upsert_customer", { id: "c-2", email: "x@y.com" });
    expect(foreign.status).toBe(404);
    expect(h.store.rows("customers")[1].email).toBeUndefined();
  });

  it("inativar nao exclui: is_active vira false e o historico continua la", async () => {
    const h = harness();
    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY, is_active: true }]);
    const result = await h.call("set_customer_active", { id: "c-1", isActive: false });
    expect(result.status).toBe(200);
    expect(h.store.rows("customers")[0]).toMatchObject({ is_active: false });
    expect(h.store.rows("customers")[0].deleted_at).toBeUndefined();
  });

  it("gestor grava o bloco comercial com a marca de publicado", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY }]);
    h.store.seed("carriers", [{ id: "car-1", company_id: COMPANY, name: "Trans X" }]);

    const result = await h.call("set_customer_commercial", {
      id: "c-1",
      defaultCarrierId: "car-1",
      nfRequired: true,
      creditAccountEnabled: true,
      creditPeriodicity: "monthly",
      creditClosingDay: 30
    });

    expect(result.status).toBe(200);
    expect(h.store.rows("customers")[0]).toMatchObject({
      default_carrier_id: "car-1",
      nf_required: true,
      credit_account_enabled: true,
      credit_periodicity: "monthly",
      credit_closing_day: 30,
      commercial_published_at: NOW,
      updated_at: NOW
    });
  });

  it("transportadora padrao de outra empresa nao entra no bloco comercial", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY }]);
    h.store.seed("carriers", [{ id: "car-9", company_id: OTHER_COMPANY, name: "Alheia" }]);
    const result = await h.call("set_customer_commercial", {
      id: "c-1",
      defaultCarrierId: "car-9"
    });
    expect(result.status).toBe(404);
    expect(h.store.rows("customers")[0].commercial_published_at).toBeUndefined();
  });
});

describe("web-api: transportadora, motorista, veiculo e vinculos", () => {
  it("transportadora nasce com source local e vai ao OMIE com o prefixo carrier:", async () => {
    const h = harness();
    const result = await h.call("upsert_carrier", {
      name: "Trans X",
      document: "11.222.333/0001-81"
    });
    expect(result.status).toBe(200);
    expect(h.store.rows("carriers")[0]).toMatchObject({
      company_id: COMPANY,
      source: "local",
      document: "11222333000181",
      omie_customer_id: 777
    });
    expect(h.pushes[0]).toMatchObject({
      action: "push_carrier",
      payload: { localCustomerId: "carrier:id-1", name: "Trans X" }
    });
  });

  it("placa repetida na empresa e recusada", async () => {
    const h = harness();
    h.store.seed("vehicles", [{ id: "v-1", company_id: COMPANY, plate: "ABC1D23" }]);
    const result = await h.call("upsert_vehicle", { plate: "abc-1d23" });
    expect(result.status).toBe(409);
    expect(h.store.rows("vehicles")).toHaveLength(1);
  });

  it("motorista e criado e editado na empresa da sessao", async () => {
    const h = harness();
    const created = await h.call("upsert_driver", { name: "Joao", isIndependent: true });
    expect(created.status).toBe(200);
    expect(h.store.rows("drivers")[0]).toMatchObject({ name: "Joao", is_independent: true });
    const edited = await h.call("upsert_driver", { id: "id-1", phone: "(11) 9" });
    expect(edited.status).toBe(200);
    expect(h.store.rows("drivers")[0]).toMatchObject({ name: "Joao", phone: "(11) 9" });
  });

  it("vinculo cliente-transportadora reaproveita a linha que ja existe (mesmo com company_id nulo)", async () => {
    const h = harness();
    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY }]);
    h.store.seed("carriers", [{ id: "car-1", company_id: COMPANY }]);
    h.store.seed("customer_carriers", [
      {
        id: "link-old",
        company_id: null,
        customer_id: "c-1",
        carrier_id: "car-1",
        is_active: false
      }
    ]);

    const result = await h.call("set_customer_carrier", {
      customerId: "c-1",
      carrierId: "car-1",
      isActive: true
    });

    expect(result.status).toBe(200);
    expect(result.body.id).toBe("link-old");
    expect(h.store.rows("customer_carriers")).toHaveLength(1);
    expect(h.store.rows("customer_carriers")[0]).toMatchObject({
      is_active: true,
      company_id: COMPANY,
      updated_at: NOW
    });
  });

  it("vinculo novo nasce com a empresa da sessao; ponta de outra empresa e recusada", async () => {
    const h = harness();
    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY }]);
    h.store.seed("vehicles", [
      { id: "v-1", company_id: COMPANY },
      { id: "v-9", company_id: OTHER_COMPANY }
    ]);

    const ok = await h.call("set_customer_vehicle", {
      customerId: "c-1",
      vehicleId: "v-1",
      isActive: true
    });
    expect(ok.status).toBe(200);
    expect(h.store.rows("customer_vehicles")[0]).toMatchObject({
      company_id: COMPANY,
      customer_id: "c-1",
      vehicle_id: "v-1",
      is_active: true
    });

    const foreign = await h.call("set_customer_vehicle", {
      customerId: "c-1",
      vehicleId: "v-9",
      isActive: true
    });
    expect(foreign.status).toBe(404);
    expect(h.store.rows("customer_vehicles")).toHaveLength(1);
  });
});

describe("web-api: preco (gestor)", () => {
  it("preco padrao atualiza a linha viva do produto em vez de criar um segundo id", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("products", [{ id: "p-1", company_id: COMPANY }]);
    h.store.seed("product_default_prices", [
      {
        id: "pdp-old",
        company_id: COMPANY,
        product_id: "p-1",
        unit_price_cents: 5000,
        is_active: true
      }
    ]);

    const result = await h.call("set_product_default_price", {
      productId: "p-1",
      unitPriceCents: 6500
    });

    expect(result.status).toBe(200);
    expect(result.body.id).toBe("pdp-old");
    expect(h.store.rows("product_default_prices")).toHaveLength(1);
    expect(h.store.rows("product_default_prices")[0]).toMatchObject({
      unit_price_cents: 6500,
      unit: "ton",
      updated_at: NOW
    });
  });

  it("sem linha viva, o preco especial nasce com a chave natural do par", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY }]);
    h.store.seed("products", [{ id: "p-1", company_id: COMPANY }]);
    h.store.seed("customer_special_prices", [
      // Linha excluida nao ocupa a chave.
      {
        id: "old",
        company_id: COMPANY,
        customer_id: "c-1",
        product_id: "p-1",
        deleted_at: "2026-01-01"
      }
    ]);

    const result = await h.call("set_customer_special_price", {
      customerId: "c-1",
      productId: "p-1",
      unitPriceCents: 7000,
      validFrom: "2026-10-01"
    });

    expect(result.status).toBe(200);
    expect(result.body.id).toBe("id-1");
    expect(h.store.rows("customer_special_prices")[1]).toMatchObject({
      company_id: COMPANY,
      customer_id: "c-1",
      product_id: "p-1",
      unit_price_cents: 7000,
      valid_from: "2026-10-01",
      valid_to: null,
      is_active: true
    });
  });

  it("remover preco especial e exclusao logica (tombstone para as balancas)", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("customer_special_prices", [
      { id: "sp-1", company_id: COMPANY, customer_id: "c-1", product_id: "p-1", is_active: true }
    ]);
    const result = await h.call("remove_customer_special_price", {
      customerId: "c-1",
      productId: "p-1"
    });
    expect(result.status).toBe(200);
    expect(result.body.removed).toBe(1);
    expect(h.store.rows("customer_special_prices")[0]).toMatchObject({
      deleted_at: NOW,
      is_active: false
    });
  });

  it("preco em reais com virgula e recusado antes de tocar o banco", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("products", [{ id: "p-1", company_id: COMPANY }]);
    const result = await h.call("set_product_default_price", {
      productId: "p-1",
      unitPriceCents: "65,00"
    });
    expect(result.status).toBe(400);
    expect(h.store.rows("product_default_prices")).toHaveLength(0);
  });

  it("cliente tem uma tabela de preco viva por vez; null desvincula", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY }]);
    h.store.seed("price_tables", [
      { id: "t-1", company_id: COMPANY, name: "Atacado" },
      { id: "t-2", company_id: COMPANY, name: "Varejo" }
    ]);
    h.store.seed("customer_price_tables", [
      {
        id: "cpt-1",
        company_id: COMPANY,
        customer_id: "c-1",
        price_table_id: "t-1",
        is_active: true
      }
    ]);

    const swapped = await h.call("set_customer_price_table", {
      customerId: "c-1",
      priceTableId: "t-2"
    });
    expect(swapped.status).toBe(200);
    const rows = h.store.rows("customer_price_tables");
    expect(rows.find((row) => row.id === "cpt-1")).toMatchObject({
      deleted_at: NOW,
      is_active: false
    });
    const linked = rows.find((row) => row.price_table_id === "t-2");
    expect(linked).toMatchObject({ is_active: true });
    expect(linked?.deleted_at).toBeUndefined();

    const cleared = await h.call("set_customer_price_table", {
      customerId: "c-1",
      priceTableId: null
    });
    expect(cleared.status).toBe(200);
    expect(rows.filter((row) => !row.deleted_at)).toHaveLength(0);
  });

  it("tabela de preco: cria, edita e item por produto", async () => {
    const h = harness({ role: "gestor" });
    h.store.seed("products", [{ id: "p-1", company_id: COMPANY }]);

    const created = await h.call("upsert_price_table", {
      name: "Atacado",
      validFrom: "2026-10-01"
    });
    expect(created.status).toBe(200);
    expect(h.store.rows("price_tables")[0]).toMatchObject({
      name: "Atacado",
      valid_from: "2026-10-01",
      is_active: true
    });

    const item = await h.call("set_price_table_item", {
      priceTableId: "id-1",
      productId: "p-1",
      unitPriceCents: 4200
    });
    expect(item.status).toBe(200);
    expect(h.store.rows("price_table_items")[0]).toMatchObject({
      price_table_id: "id-1",
      product_id: "p-1",
      unit_price_cents: 4200
    });

    const badDate = await h.call("upsert_price_table", { id: "id-1", validTo: "31/12/2026" });
    expect(badDate.status).toBe(400);
  });
});

describe("web-api: senha de preco no cadastro", () => {
  function priced(requiresPricePassword: boolean, password: string | null = "4321") {
    const h = harness({ role: "operacao", requiresPricePassword });
    h.store.seed("companies", [{ id: COMPANY, price_change_password: password }]);
    h.store.seed("products", [{ id: "p-1", company_id: COMPANY }]);
    return h;
  }

  it("quem precisa da senha so publica preco com a senha certa", async () => {
    const h = priced(true);
    const change = { productId: "p-1", unitPriceCents: 6500 };
    expect((await h.call("set_product_default_price", change)).status).toBe(403);
    expect(
      (await h.call("set_product_default_price", { ...change, pricePassword: "0000" })).status
    ).toBe(403);
    expect(h.store.rows("product_default_prices")).toHaveLength(0);
    const ok = await h.call("set_product_default_price", { ...change, pricePassword: "4321" });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(h.store.rows("product_default_prices"))).not.toContain("4321");
    expect(h.store.rows("price_password_failures")).toHaveLength(1);
  });

  it("tirar preco especial tambem pede a senha", async () => {
    const h = priced(true);
    const result = await h.call("remove_customer_special_price", {
      customerId: "c-1",
      productId: "p-1"
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toContain("senha");
  });

  it("sem a marca (administrador) publica direto", async () => {
    const h = priced(false);
    expect(
      (await h.call("set_product_default_price", { productId: "p-1", unitPriceCents: 6500 })).status
    ).toBe(200);
  });

  it("pedreira sem senha definida: avisa e nao conta tentativa errada", async () => {
    const h = priced(true, null);
    const result = await h.call("set_product_default_price", {
      productId: "p-1",
      unitPriceCents: 6500,
      pricePassword: "1234"
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toContain("nao tem senha");
    expect(h.store.rows("price_password_failures")).toHaveLength(0);
  });
});

describe("web-api: logs de suporte", () => {
  function seeded(role: WebSession["role"] = "administrador") {
    const h = harness({ role });
    h.store.seed("units", [{ id: "unit-1", company_id: COMPANY, name: "Matriz" }]);
    h.store.seed("device_registrations", [
      {
        id: "d-1",
        company_id: COMPANY,
        unit_id: "unit-1",
        name: "PC PRINCIPAL",
        is_active: true,
        app_version: "0.8.254",
        last_seen_at: "2026-09-22T14:58:00.000Z",
        health_queue_blocked: 2
      },
      {
        id: "d-2",
        company_id: COMPANY,
        unit_id: "unit-1",
        name: "fernanda",
        is_active: true,
        app_version: "0.8.244",
        last_seen_at: "2026-09-21T10:00:00.000Z"
      },
      {
        id: `web-${COMPANY}`,
        company_id: COMPANY,
        unit_id: "unit-1",
        name: "Site",
        is_active: true
      },
      { id: "d-9", company_id: OTHER_COMPANY, unit_id: "unit-9", name: "Outra", is_active: true }
    ]);
    h.store.seed("operation_requests", [
      {
        id: "r-new",
        company_id: COMPANY,
        kind: "exit",
        status: "failed",
        requested_at: "2026-09-22T14:00:00.000Z",
        result_message: "Balanca sem peso"
      },
      {
        id: "r-old",
        company_id: COMPANY,
        kind: "entry",
        status: "done",
        requested_at: "2026-09-01T14:00:00.000Z"
      }
    ]);
    h.store.seed("weighing_operations", [
      // Erro de envio E faturamento falho: aparece uma vez so.
      {
        id: "op-1",
        company_id: COMPANY,
        status: "sync_error",
        omie_billing_status: "failed",
        created_at: "2026-09-20T10:00:00.000Z"
      },
      {
        id: "op-stuck",
        company_id: COMPANY,
        status: "pending_omie",
        created_at: "2026-09-22T08:00:00.000Z",
        closed_at: "2026-09-22T09:00:00.000Z"
      },
      // Fechou ha pouco: ainda nao e "parada".
      {
        id: "op-fresh",
        company_id: COMPANY,
        status: "pending_omie",
        created_at: "2026-09-22T14:30:00.000Z",
        closed_at: "2026-09-22T14:40:00.000Z"
      },
      { id: "op-ok", company_id: COMPANY, status: "synced", created_at: "2026-09-22T10:00:00.000Z" }
    ]);
    h.store.seed("user_profiles", [
      {
        id: "user-1",
        company_id: COMPANY,
        name: "Rafaela",
        email: "r@x.com",
        role: "operacao",
        is_active: true
      }
    ]);
    h.store.seed("price_password_failures", [
      {
        id: "f-1",
        company_id: COMPANY,
        user_id: "user-1",
        attempted_at: "2026-09-22T12:00:00.000Z"
      }
    ]);
    return h;
  }

  it("so o administrador ve", async () => {
    for (const role of ["gestor", "operacao", "comercial", "monitoramento"] as const) {
      expect((await seeded(role).call("support_overview")).status, role).toBe(403);
    }
  });

  it("junta saude das balancas, pedidos, envios parados e senhas erradas da empresa", async () => {
    const result = await seeded().call("support_overview");
    expect(result.status).toBe(200);
    const body = result.body;
    expect((body.devices as Row[]).map((device) => device.id)).toEqual(["d-2", "d-1"]);
    expect(body.latestAppVersion).toBe("0.8.254");
    expect((body.devices as Row[]).find((device) => device.id === "d-1")).toMatchObject({
      online: true,
      health: { queueBlocked: 2 }
    });
    expect((body.operationRequests as Row[]).map((request) => request.id)).toEqual(["r-new"]);
    expect((body.omieProblems as Row[]).map((operation) => operation.id)).toEqual([
      "op-stuck",
      "op-1"
    ]);
    expect(body.pricePasswordFailures).toEqual([
      { userId: "user-1", userName: "Rafaela", attemptedAt: "2026-09-22T12:00:00.000Z" }
    ]);
    expect(body.webUsers).toEqual([
      expect.objectContaining({ id: "user-1", role: "operacao", isActive: true })
    ]);
  });
});

describe("web-api: condicao de pagamento digitada no cliente", () => {
  it("cria a condicao a partir do texto e a usa como padrao do cliente", async () => {
    const h = harness({ role: "comercial" });
    const result = await h.call("upsert_customer", {
      legalName: "Polymix Ltda",
      defaultPaymentCondition: "7 14 21"
    });
    expect(result.status).toBe(200);
    const [term] = h.store.rows("payment_terms");
    expect(term).toMatchObject({
      company_id: COMPANY,
      omie_code: null,
      is_active: true,
      rules_json: { raw: "7/14/21", installmentCount: 3 }
    });
    expect(h.store.rows("customers")[0].default_payment_term_id).toBe(term.id);
  });

  it("reusa a condicao que ja existe com a mesma regra", async () => {
    const h = harness();
    h.store.seed("payment_terms", [
      {
        id: "pt-30",
        company_id: COMPANY,
        name: "30 dias",
        rules_json: { raw: "30", installments: [{ number: 1, dueDays: 30 }] }
      }
    ]);
    await h.call("upsert_customer", { legalName: "X", defaultPaymentCondition: "30" });
    expect(h.store.rows("payment_terms")).toHaveLength(1);
    expect(h.store.rows("customers")[0].default_payment_term_id).toBe("pt-30");
  });

  it("texto invalido e 400 e nada e gravado; vazio limpa o padrao", async () => {
    const h = harness();
    const bad = await h.call("upsert_customer", {
      legalName: "X",
      defaultPaymentCondition: "quando der"
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("invalida");
    expect(h.store.rows("customers")).toHaveLength(0);

    h.store.seed("customers", [{ id: "c-1", company_id: COMPANY, default_payment_term_id: "x" }]);
    const cleared = await h.call("upsert_customer", { id: "c-1", defaultPaymentCondition: "" });
    expect(cleared.body).toMatchObject({ ok: true });
    expect(h.store.rows("customers")[0].default_payment_term_id).toBeNull();
  });
});

describe("web-api: buscar CNPJ", () => {
  it("devolve os dados da Receita para quem cadastra cliente", async () => {
    const response = await handleWebApiRequest(
      new Request("https://example.supabase.co/functions/v1/web-api", {
        method: "POST",
        body: JSON.stringify({ action: "lookup_cnpj", payload: { cnpj: "11222333000181" } })
      }),
      {
        store: new MemoryStore(),
        resolveSession: async () => ({ ok: true, session: session("comercial") }),
        omie: { push: async () => ({ omieCustomerId: 1 }) },
        cnpjLookup: async (cnpj) => ({
          found: true,
          cnpj,
          legalName: "POLYMIX LTDA",
          tradeName: null,
          email: null,
          phone: null,
          zipcode: null,
          addressStreet: null,
          addressNumber: null,
          addressComplement: null,
          neighborhood: null,
          city: "IBIUNA",
          state: "SP",
          status: "ATIVA"
        })
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ found: true, legalName: "POLYMIX LTDA" });
  });

  it("monitoramento nao usa", async () => {
    const result = await harness({ role: "monitoramento" }).call("lookup_cnpj", { cnpj: "x" });
    expect(result.status).toBe(403);
  });
});
