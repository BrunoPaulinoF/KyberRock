import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

import { handleOmieSyncRequest, type OmieSyncHandlerDependencies } from "./index.ts";
import { toOmieIntegrationCode, type OmieRequestInput, type OmieRequester } from "./omie-sync-core.ts";

type DeviceFixture = {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
};

type CompanyFixture = {
  id: string;
  is_active: boolean;
  omie_app_key: string | null;
  omie_app_secret: string | null;
};

type CustomerFixture = {
  id: string;
  company_id: string;
  omie_customer_id: number | null;
};

type CreditMovementFixture = {
  company_id: string;
  customer_id: string;
  movement_type: string;
  amount_cents: number;
  omie_title_id: number | null;
};

type SupabaseFixtures = {
  devices: Record<string, DeviceFixture>;
  companies: Record<string, CompanyFixture>;
  customers?: CustomerFixture[];
  creditMovements?: CreditMovementFixture[];
};

type SupabaseUpdate = {
  table: string;
  values: Record<string, unknown>;
  filters: Record<string, string>;
};

type SupabaseUpsert = {
  table: string;
  rows: Array<Record<string, unknown>>;
};

type JsonBody = Record<string, unknown>;

class SupabaseQueryStub {
  private readonly filters: Record<string, string> = {};
  private readonly inFilters: Record<string, Array<string | number>> = {};
  private updateValues: Record<string, unknown> | null = null;

  constructor(
    private readonly table: string,
    private readonly fixtures: SupabaseFixtures,
    private readonly updates: SupabaseUpdate[],
    private readonly upserts: SupabaseUpsert[]
  ) {}

  select(): SupabaseQueryStub {
    return this;
  }

  update(values: Record<string, unknown>): SupabaseQueryStub {
    this.updateValues = values;
    return this;
  }

  upsert(rows: Array<Record<string, unknown>>): SupabaseQueryStub {
    this.upserts.push({ table: this.table, rows });
    return this;
  }

  eq(column: string, value: string): SupabaseQueryStub {
    this.filters[column] = value;

    if (this.updateValues) {
      this.updates.push({
        table: this.table,
        values: this.updateValues,
        filters: { ...this.filters }
      });
    }

    return this;
  }

  in(column: string, values: Array<string | number>): SupabaseQueryStub {
    this.inFilters[column] = values;
    return this;
  }

  /** A query e "thenable": `await from(...).select(...).in(...)` resolve a lista. */
  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows(), error: null }).then(onfulfilled, onrejected);
  }

  async single(): Promise<{ data: unknown; error: unknown }> {
    if (this.table === "device_registrations") {
      const device = this.fixtures.devices[this.filters.id ?? ""];
      return { data: device ?? null, error: device ? null : new Error("device not found") };
    }

    if (this.table === "companies") {
      const company = this.fixtures.companies[this.filters.id ?? ""];
      return { data: company ?? null, error: company ? null : new Error("company not found") };
    }

    return { data: null, error: new Error(`Tabela nao mockada: ${this.table}`) };
  }

  private rows(): unknown[] {
    if (this.table === "customers") {
      const codes = this.inFilters.omie_customer_id ?? [];
      return (this.fixtures.customers ?? []).filter(
        (customer) =>
          customer.company_id === this.filters.company_id &&
          (codes.length === 0 || codes.includes(customer.omie_customer_id ?? -1))
      );
    }

    if (this.table === "customer_credit_movements") {
      const ids = this.inFilters.customer_id ?? [];
      return (this.fixtures.creditMovements ?? []).filter(
        (movement) =>
          movement.company_id === this.filters.company_id &&
          (ids.length === 0 || ids.includes(movement.customer_id))
      );
    }

    return [];
  }
}

function createSupabaseDependencies(fixtures: SupabaseFixtures): {
  createClient: NonNullable<OmieSyncHandlerDependencies["createClient"]>;
  updates: SupabaseUpdate[];
  upserts: SupabaseUpsert[];
} {
  const updates: SupabaseUpdate[] = [];
  const upserts: SupabaseUpsert[] = [];
  return {
    updates,
    upserts,
    createClient: () => ({
      from: (table: string) => new SupabaseQueryStub(table, fixtures, updates, upserts)
    })
  };
}

function createOmieQueueStub(
  handler: (input: OmieRequestInput<unknown>) => unknown | Promise<unknown>
): OmieRequester & { requests: OmieRequestInput<unknown>[] } {
  const requests: OmieRequestInput<unknown>[] = [];
  return {
    requests,
    async request<TParam, TResponse>(input: OmieRequestInput<TParam>): Promise<TResponse> {
      const captured = input as OmieRequestInput<unknown>;
      requests.push(captured);
      return (await handler(captured)) as TResponse;
    }
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function postOmieSync(
  body: JsonBody,
  dependencies: OmieSyncHandlerDependencies
): Promise<JsonBody> {
  const response = await handleOmieSyncRequest(
    new Request("http://localhost/omie-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    dependencies
  );

  return (await response.json()) as JsonBody;
}

function getParam(input: OmieRequestInput<unknown>): Record<string, unknown> {
  return input.param as Record<string, unknown>;
}

function defaultOmieListResponse(input: OmieRequestInput<unknown>): unknown {
  const param = getParam(input);

  if (input.call === "ListarClientes") {
    return {
      pagina: param.pagina,
      total_de_paginas: 0,
      total_de_registros: 0,
      clientes_cadastro: []
    };
  }

  if (input.call === "ListarProdutos") {
    return {
      pagina: param.pagina,
      total_de_paginas: 0,
      total_de_registros: 0,
      produto_servico_cadastro: []
    };
  }

  if (input.call === "ListarCondicoesPagamento") {
    return {
      pagina: param.pagina,
      total_de_paginas: 0,
      total_de_registros: 0,
      condicoesPagamentoCadastro: []
    };
  }

  if (input.call === "ListarCategorias") {
    return {
      pagina: param.pagina,
      total_de_paginas: 0,
      total_de_registros: 0,
      categoria_cadastro: []
    };
  }

  return null;
}

Deno.test("handleOmieSyncRequest busca credenciais OMIE por companyId e isola contextos multi-tenant", async () => {
  const tokenA = "token-a";
  const tokenB = "token-b";
  const supabase = createSupabaseDependencies({
    devices: {
      "device-a": {
        id: "device-a",
        company_id: "company-a",
        unit_id: "unit-a",
        token_hash: await sha256Hex(tokenA),
        is_active: true
      },
      "device-b": {
        id: "device-b",
        company_id: "company-b",
        unit_id: "unit-b",
        token_hash: await sha256Hex(tokenB),
        is_active: true
      }
    },
    companies: {
      "company-a": {
        id: "company-a",
        is_active: true,
        omie_app_key: "key-company-a",
        omie_app_secret: "secret-company-a"
      },
      "company-b": {
        id: "company-b",
        is_active: true,
        omie_app_key: "key-company-b",
        omie_app_secret: "secret-company-b"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "IncluirCliente") return { codigo_cliente_omie: 9001 };
    return defaultOmieListResponse(input);
  });

  const bodyA = await postOmieSync(
    {
      deviceId: "device-a",
      deviceToken: tokenA,
      action: "sync",
      resume: { customersFinished: true, productsFinished: true, paymentTermsFinished: true },
      payload: { customers: [{ localCustomerId: "cliente-a", razaoSocial: "Cliente A" }] }
    },
    { createClient: supabase.createClient, omieQueue }
  );
  const bodyB = await postOmieSync(
    {
      deviceId: "device-b",
      deviceToken: tokenB,
      action: "sync",
      resume: { customersFinished: true, productsFinished: true, paymentTermsFinished: true },
      payload: { customers: [{ localCustomerId: "cliente-b", razaoSocial: "Cliente B" }] }
    },
    { createClient: supabase.createClient, omieQueue }
  );

  const pushRequests = omieQueue.requests.filter((request) => request.call === "IncluirCliente");
  assertObjectMatch(bodyA, { ok: true, companyId: "company-a", unitId: "unit-a" });
  assertObjectMatch(bodyB, { ok: true, companyId: "company-b", unitId: "unit-b" });
  assertEquals(pushRequests.map((request) => request.credentials), [
    { appKey: "key-company-a", appSecret: "secret-company-a" },
    { appKey: "key-company-b", appSecret: "secret-company-b" }
  ]);
  assertEquals(pushRequests.map((request) => getParam(request).codigo_cliente_integracao), [
    toOmieIntegrationCode("cliente-a"),
    toOmieIntegrationCode("cliente-b")
  ]);
});

Deno.test("fluxo push envia clientes e transportadoras formatados e permite limpar needs_push apos sucesso", async () => {
  const deviceToken = "token-push";
  const supabase = createSupabaseDependencies({
    devices: {
      "device-push": {
        id: "device-push",
        company_id: "company-push",
        unit_id: "unit-push",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-push": {
        id: "company-push",
        is_active: true,
        omie_app_key: "key-push",
        omie_app_secret: "secret-push"
      }
    }
  });
  const localQueue = {
    customers: [
      {
        localCustomerId: "customer-local-1",
        razaoSocial: "Cliente Local Ltda",
        nomeFantasia: "Cliente Local",
        cnpjCpf: "11111111000191",
        needs_push: 1
      }
    ],
    carriers: [
      {
        localCustomerId: "carrier-local-1",
        name: "Transportadora Local",
        cnpjCpf: "22222222000182",
        tags: ["cliente"],
        needs_push: 1
      }
    ],
    clearSynced(push: JsonBody): void {
      const pushResult = push.push as {
        customers: Array<{ localId: string }>;
        carriers: Array<{ localId: string }>;
      };
      for (const customer of pushResult.customers) {
        const row = this.customers.find((item) => item.localCustomerId === customer.localId);
        if (row) row.needs_push = 0;
      }
      for (const carrier of pushResult.carriers) {
        const row = this.carriers.find((item) => item.localCustomerId === carrier.localId);
        if (row) row.needs_push = 0;
      }
    }
  };
  let nextOmieId = 100;
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarClientesResumido") return { clientes: [] };
    if (input.call === "IncluirCliente") return { codigo_cliente_omie: nextOmieId++ };
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-push",
      deviceToken,
      action: "sync",
      resume: { customersFinished: true, productsFinished: true, paymentTermsFinished: true },
      payload: {
        customers: localQueue.customers.filter((row) => row.needs_push === 1),
        carriers: localQueue.carriers.filter((row) => row.needs_push === 1)
      }
    },
    { createClient: supabase.createClient, omieQueue }
  );
  localQueue.clearSynced(response);

  const includedCustomers = omieQueue.requests.filter((request) => request.call === "IncluirCliente");
  const customerPayload = getParam(includedCustomers[0]);
  const carrierPayload = getParam(includedCustomers[1]);
  assertObjectMatch(customerPayload, {
    codigo_cliente_integracao: toOmieIntegrationCode("customer-local-1"),
    razao_social: "Cliente Local Ltda",
    nome_fantasia: "Cliente Local",
    cnpj_cpf: "11111111000191"
  });
  assertObjectMatch(carrierPayload, {
    codigo_cliente_integracao: toOmieIntegrationCode("carrier-local-1"),
    razao_social: "Transportadora Local",
    nome_fantasia: "Transportadora Local",
    cnpj_cpf: "22222222000182"
  });
  assertEquals(carrierPayload.tags, [{ tag: "cliente" }, { tag: "transportadora" }]);
  assertEquals(localQueue.customers[0].needs_push, 0);
  assertEquals(localQueue.carriers[0].needs_push, 0);
});

Deno.test("fluxo pull processa paginas e mapeia clientes OMIE com tag transportadora para carriers locais", async () => {
  const deviceToken = "token-pull";
  const supabase = createSupabaseDependencies({
    devices: {
      "device-pull": {
        id: "device-pull",
        company_id: "company-pull",
        unit_id: "unit-pull",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-pull": {
        id: "company-pull",
        is_active: true,
        omie_app_key: "key-pull",
        omie_app_secret: "secret-pull"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call !== "ListarClientes") return defaultOmieListResponse(input);

    const page = Number(getParam(input).pagina);
    if (page === 1) {
      return {
        pagina: 1,
        total_de_paginas: 2,
        total_de_registros: 3,
        clientes_cadastro: [
          {
            codigo_cliente_omie: 11,
            codigo_cliente_integracao: "omie-cliente-11",
            razao_social: "Cliente Pagina 1",
            tags: [{ tag: "cliente" }]
          },
          {
            codigo_cliente_omie: 22,
            codigo_cliente_integracao: "omie-carrier-22",
            razao_social: "Transportadora Pagina 1",
            cnpj_cpf: "33333333000173",
            cidade: "Campinas",
            estado: "SP",
            tags: [{ tag: "transportadora" }]
          }
        ]
      };
    }

    return {
      pagina: 2,
      total_de_paginas: 2,
      total_de_registros: 3,
      clientes_cadastro: [
        {
          codigo_cliente_omie: 33,
          codigo_cliente_integracao: "omie-cliente-carrier-33",
          razao_social: "Cliente e Transportadora Pagina 2",
          tags: [{ tag: "cliente" }, { tag: "transportadora" }]
        }
      ]
    };
  });
  const localTables = {
    customers: [] as unknown[],
    carriers: [] as unknown[],
    applyPull(body: JsonBody): void {
      this.customers.push(...((body.customers as unknown[]) ?? []));
      this.carriers.push(...((body.suppliers as unknown[]) ?? []));
    }
  };

  const page1 = await postOmieSync(
    {
      deviceId: "device-pull",
      deviceToken,
      action: "pull_reference_data",
      resume: { productsFinished: true, paymentTermsFinished: true }
    },
    { createClient: supabase.createClient, omieQueue }
  );
  const page2 = await postOmieSync(
    {
      deviceId: "device-pull",
      deviceToken,
      action: "pull_reference_data",
      resume: { customersPage: 2, productsFinished: true, paymentTermsFinished: true }
    },
    { createClient: supabase.createClient, omieQueue }
  );
  localTables.applyPull(page1);
  localTables.applyPull(page2);

  assertObjectMatch(page1.pagination as Record<string, unknown>, {
    customersPage: 1,
    customersFinished: false,
    customersTotalPages: 2
  });
  assertObjectMatch(page2.pagination as Record<string, unknown>, {
    customersPage: 2,
    customersFinished: true,
    customersTotalPages: 2
  });
  // Filtra por ListarClientes: o pull da mesma chamada percorre outros cadastros
  // (categorias, por exemplo) que tambem paginam, e a paginacao de clientes e o
  // que este teste cobre.
  assertEquals(
    omieQueue.requests
      .filter((request) => request.call === "ListarClientes")
      .map((request) => getParam(request).pagina),
    [1, 2]
  );
  assertEquals(localTables.customers.length, 2);
  assertEquals(localTables.carriers.length, 2);
  assertObjectMatch(localTables.carriers[0] as Record<string, unknown>, {
    id: 22,
    integrationCode: "omie-carrier-22",
    name: "Transportadora Pagina 1",
    city: "Campinas",
    state: "SP"
  });
});

// O desktop so alcanca o OMIE por aqui: sem as categorias no pull, o espelho
// local fica vazio e todo pedido de venda cai na categoria fixa "1.01.01".
Deno.test("fluxo pull devolve as categorias do plano gerencial do OMIE", async () => {
  const deviceToken = "token-pull-categorias";
  const supabase = createSupabaseDependencies({
    devices: {
      "device-categorias": {
        id: "device-categorias",
        company_id: "company-categorias",
        unit_id: "unit-categorias",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-categorias": {
        id: "company-categorias",
        is_active: true,
        omie_app_key: "key-categorias",
        omie_app_secret: "secret-categorias"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call !== "ListarCategorias") return defaultOmieListResponse(input);
    return {
      pagina: Number(getParam(input).pagina),
      total_de_paginas: 1,
      total_de_registros: 3,
      categoria_cadastro: [
        { codigo: "1.01.01", descricao: "Venda de brita", tipo_categoria: "R" },
        {
          codigo: "1.01.02",
          descricao: "Venda de aterro",
          tipo_categoria: "R",
          categoria_superior: "1.01"
        },
        // Totalizadora: o OMIE recusa o pedido com um codigo nao lancavel.
        { codigo: "1.01", descricao: "Receitas de vendas", nao_exibir: "S" }
      ]
    };
  });

  const body = await postOmieSync(
    {
      deviceId: "device-categorias",
      deviceToken,
      action: "pull_reference_data",
      resume: { customersFinished: true, productsFinished: true, paymentTermsFinished: true }
    },
    { createClient: supabase.createClient, omieQueue }
  );

  assertEquals(body.categories, [
    {
      code: "1.01.01",
      description: "Venda de brita",
      categoryType: "R",
      parentCode: null,
      isActive: true
    },
    {
      code: "1.01.02",
      description: "Venda de aterro",
      categoryType: "R",
      parentCode: "1.01",
      isActive: true
    },
    {
      code: "1.01",
      description: "Receitas de vendas",
      categoryType: null,
      parentCode: null,
      isActive: false
    }
  ]);
  assertObjectMatch(body.pagination as Record<string, unknown>, {
    categoriesPage: 1,
    categoriesReturned: 3,
    categoriesFinished: true,
    categoriesTotalPages: 1
  });
});

// Pagina ja concluida nao pode custar uma chamada nova ao OMIE a cada iteracao
// do loop de pull (a API tem limite de consumo por minuto).
Deno.test("fluxo pull nao chama ListarCategorias quando o resume ja marcou concluido", async () => {
  const deviceToken = "token-pull-categorias-fim";
  const supabase = createSupabaseDependencies({
    devices: {
      "device-categorias-fim": {
        id: "device-categorias-fim",
        company_id: "company-categorias-fim",
        unit_id: "unit-categorias-fim",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-categorias-fim": {
        id: "company-categorias-fim",
        is_active: true,
        omie_app_key: "key-categorias-fim",
        omie_app_secret: "secret-categorias-fim"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => defaultOmieListResponse(input));

  const body = await postOmieSync(
    {
      deviceId: "device-categorias-fim",
      deviceToken,
      action: "pull_reference_data",
      resume: {
        customersFinished: true,
        productsFinished: true,
        paymentTermsFinished: true,
        categoriesFinished: true
      }
    },
    { createClient: supabase.createClient, omieQueue }
  );

  assertEquals(body.categories, []);
  assertEquals(
    omieQueue.requests.filter((request) => request.call === "ListarCategorias").length,
    0
  );
});

function orderQueueStub() {
  return createOmieQueueStub((input) => {
    if (input.call === "ListarContasCorrentes") {
      return { conta_corrente_lista: [{ nCodCC: 7 }] };
    }
    if (input.call === "ListarCadastroServico") {
      return { cadastros: [{ cCodServMun: "1.07" }] };
    }
    if (input.call === "IncluirPedido") {
      return { codigo_pedido: 12345 };
    }
    if (input.call === "IncluirOS") {
      return { nCodOS: 555 };
    }
    return defaultOmieListResponse(input);
  });
}

function findRequest(
  omieQueue: { requests: OmieRequestInput<unknown>[] },
  call: string
): OmieRequestInput<unknown> {
  const request = omieQueue.requests.find((r) => r.call === call);
  if (!request) throw new Error(`Nenhuma chamada ${call} capturada`);
  return request;
}

Deno.test("create_order envia o codigo_parcela vinculado no pedido de venda", async () => {
  const deviceToken = "token-order-invoice";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-invoice": {
        id: "device-order-invoice",
        company_id: "company-order-invoice",
        unit_id: "unit-order-invoice",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-invoice": {
        id: "company-order-invoice",
        is_active: true,
        omie_app_key: "order-invoice",
        omie_app_secret: "secret-order-invoice"
      }
    }
  });
  const omieQueue = orderQueueStub();

  const response = await postOmieSync(
    {
      deviceId: "device-order-invoice",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 30.5,
        unitPrice: 85,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op1:create_sales_order",
        paymentTermOmieCode: "030"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 12345 });
  const cabecalho = getParam(findRequest(omieQueue, "IncluirPedido")).cabecalho as Record<
    string,
    unknown
  >;
  assertEquals(cabecalho.codigo_parcela, "030");
  // Pedido nasce na etapa "Faturar" do kanban de Vendas (faturamento feito no OMIE).
  assertEquals(cabecalho.etapa, "50");
});

Deno.test("create_order envia a modalidade de frete escolhida (FOB) com o valor", async () => {
  const deviceToken = "token-order-freight";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-freight": {
        id: "device-order-freight",
        company_id: "company-order-freight",
        unit_id: "unit-order-freight",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-freight": {
        id: "company-order-freight",
        is_active: true,
        omie_app_key: "order-freight",
        omie_app_secret: "secret-order-freight"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-freight",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        freightTotalCents: 15000,
        freightModalidade: "1",
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op-freight:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const frete = getParam(findRequest(omieQueue, "IncluirPedido")).frete as Record<string, unknown>;
  assertEquals(frete.modalidade, "1");
  assertEquals(frete.valor_frete, 150);
});

Deno.test("create_order envia modalidade sem frete (9) sem valor", async () => {
  const deviceToken = "token-order-nofreight";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-nofreight": {
        id: "device-order-nofreight",
        company_id: "company-order-nofreight",
        unit_id: "unit-order-nofreight",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-nofreight": {
        id: "company-order-nofreight",
        is_active: true,
        omie_app_key: "order-nofreight",
        omie_app_secret: "secret-order-nofreight"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-nofreight",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        freightModalidade: "9",
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op-nofreight:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const frete = getParam(findRequest(omieQueue, "IncluirPedido")).frete as Record<string, unknown>;
  assertEquals(frete.modalidade, "9");
  // O OMIE exige valor_frete sempre que o bloco frete e enviado; sem frete vai 0.
  assertEquals(frete.valor_frete, 0);
});

Deno.test("create_order envia os dados de transporte no frete e o motorista na NF", async () => {
  const deviceToken = "token-order-transport";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-transport": {
        id: "device-order-transport",
        company_id: "company-order-transport",
        unit_id: "unit-order-transport",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-transport": {
        id: "company-order-transport",
        is_active: true,
        omie_app_key: "order-transport",
        omie_app_secret: "secret-order-transport"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-transport",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 15,
        unitPrice: 50,
        freightTotalCents: 20000,
        freightModalidade: "2",
        transport: {
          plate: "abc-1d23",
          plateState: "mg",
          driverName: "Joao Motorista",
          carrierOmieId: 987654,
          cargoWeightKg: 15000,
          ownVehicle: false
        },
        issueDate: "2026-07-16",
        idempotencyKey: "kyberrock:unit:op-transport:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirPedido"));
  const frete = body.frete as Record<string, unknown>;
  assertEquals(frete.modalidade, "2");
  assertEquals(frete.valor_frete, 200);
  // Placa normalizada (maiuscula, sem separadores) e transportadora pelo codigo OMIE.
  assertEquals(frete.placa, "ABC1D23");
  // A NF-e pede placa E UF do veiculo: a UF vem do cadastro de veiculos do desktop.
  assertEquals(frete.uf_placa, "MG");
  assertEquals(frete.codigo_transportadora, 987654);
  // Granel: peso bruto = liquido = peso pesado, em 1 volume.
  assertEquals(frete.peso_bruto, 15000);
  assertEquals(frete.peso_liquido, 15000);
  assertEquals(frete.quantidade_volumes, 1);
  // Nao e transporte proprio: veiculo_proprio ausente.
  assertEquals("veiculo_proprio" in frete, false);

  const infos = body.informacoes_adicionais as Record<string, unknown>;
  // A UF acompanha a placa no texto (a OS nao tem bloco frete para o uf_placa).
  assertEquals(infos.dados_adicionais_nf, "Motorista: Joao Motorista - Placa: ABC-1D23/MG");
});

Deno.test("create_order com transporte proprio marca veiculo_proprio e omite transportadora", async () => {
  const deviceToken = "token-order-ownvehicle";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-ownvehicle": {
        id: "device-order-ownvehicle",
        company_id: "company-order-ownvehicle",
        unit_id: "unit-order-ownvehicle",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-ownvehicle": {
        id: "company-order-ownvehicle",
        is_active: true,
        omie_app_key: "order-ownvehicle",
        omie_app_secret: "secret-order-ownvehicle"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-ownvehicle",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 15,
        unitPrice: 50,
        freightModalidade: "3",
        transport: {
          plate: "XYZ4E56",
          carrierOmieId: 987654,
          cargoWeightKg: 12000,
          ownVehicle: true
        },
        issueDate: "2026-07-16",
        idempotencyKey: "kyberrock:unit:op-ownvehicle:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const frete = getParam(findRequest(omieQueue, "IncluirPedido")).frete as Record<string, unknown>;
  assertEquals(frete.veiculo_proprio, "S");
  assertEquals("codigo_transportadora" in frete, false);
  assertEquals(frete.placa, "XYZ4E56");
  // Veiculo sem UF no cadastro: o pedido sai so com a placa (campo fiscal nao aceita
  // valor inventado), como antes.
  assertEquals("uf_placa" in frete, false);
});

Deno.test("create_order cadastra o cliente no OMIE na hora quando ele nao tem codigo", async () => {
  const deviceToken = "token-order-newcustomer";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-newcustomer": {
        id: "device-order-newcustomer",
        company_id: "company-order-newcustomer",
        unit_id: "unit-order-newcustomer",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-newcustomer": {
        id: "company-order-newcustomer",
        is_active: true,
        omie_app_key: "order-newcustomer",
        omie_app_secret: "secret-order-newcustomer"
      }
    }
  });
  // Cliente ainda nao existe no OMIE: ListarClientesResumido vazio, IncluirCliente cria o 7777.
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
    if (input.call === "ListarClientesResumido") return { clientes: [] };
    if (input.call === "IncluirCliente") return { codigo_cliente_omie: 7777 };
    if (input.call === "IncluirPedido") return { codigo_pedido: 12345 };
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-order-newcustomer",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 0,
        customer: {
          localCustomerId: "cust-local-1",
          razaoSocial: "Cliente Novo LTDA",
          cnpjCpf: "11444777000161"
        },
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op-newcustomer:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  // Cliente foi criado no OMIE e o pedido usou o codigo devolvido...
  assertObjectMatch(response, { ok: true, orderId: 12345, omieCustomerId: 7777 });
  const cabecalho = getParam(findRequest(omieQueue, "IncluirPedido")).cabecalho as Record<
    string,
    unknown
  >;
  assertEquals(cabecalho.codigo_cliente, 7777);
});

Deno.test("create_order usa 000 quando nao ha codigo de parcela vinculado", async () => {
  const deviceToken = "token-order-default";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-default": {
        id: "device-order-default",
        company_id: "company-order-default",
        unit_id: "unit-order-default",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-default": {
        id: "company-order-default",
        is_active: true,
        omie_app_key: "order-default",
        omie_app_secret: "secret-order-default"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-default",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op2:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const cabecalho = getParam(findRequest(omieQueue, "IncluirPedido")).cabecalho as Record<
    string,
    unknown
  >;
  assertEquals(cabecalho.codigo_parcela, "000");
});

Deno.test("create_order envia cCodParc e nQtdeParc na ordem de servico", async () => {
  const deviceToken = "token-order-os";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os": {
        id: "device-order-os",
        company_id: "company-order-os",
        unit_id: "unit-order-os",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os": {
        id: "company-order-os",
        is_active: true,
        omie_app_key: "order-os",
        omie_app_secret: "secret-order-os"
      }
    }
  });
  const omieQueue = orderQueueStub();

  const response = await postOmieSync(
    {
      deviceId: "device-order-os",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op3:create_service_order",
        paymentTermOmieCode: "030",
        installmentCount: 3
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 555 });
  const cabecalho = getParam(findRequest(omieQueue, "IncluirOS")).Cabecalho as Record<
    string,
    unknown
  >;
  assertEquals(cabecalho.cCodParc, "030");
  assertEquals(cabecalho.nQtdeParc, 3);
  // OS tambem nasce na etapa "Faturar" (faturamento feito no OMIE).
  assertEquals(cabecalho.cEtapa, "50");
});

Deno.test("create_order usa a conta corrente selecionada no desktop no pedido de venda", async () => {
  const deviceToken = "token-order-account";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-account": {
        id: "device-order-account",
        company_id: "company-order-account",
        unit_id: "unit-order-account",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-account": {
        id: "company-order-account",
        is_active: true,
        omie_app_key: "order-account",
        omie_app_secret: "secret-order-account"
      }
    }
  });
  const omieQueue = orderQueueStub();

  const response = await postOmieSync(
    {
      deviceId: "device-order-account",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 30.5,
        unitPrice: 85,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op4:create_sales_order",
        paymentMethodOmieCode: "17",
        accountOmieCode: "4321"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 12345 });
  const infos = getParam(findRequest(omieQueue, "IncluirPedido")).informacoes_adicionais as Record<
    string,
    unknown
  >;
  assertEquals(infos.codigo_conta_corrente, 4321);
  // A conta veio do desktop; nao ha resolucao automatica da primeira conta do tenant.
  assertEquals(
    omieQueue.requests.some((request) => request.call === "ListarContasCorrentes"),
    false
  );
});

Deno.test("create_order usa a conta corrente selecionada no desktop na ordem de servico", async () => {
  const deviceToken = "token-order-os-account";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-account": {
        id: "device-order-os-account",
        company_id: "company-order-os-account",
        unit_id: "unit-order-os-account",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-account": {
        id: "company-order-os-account",
        is_active: true,
        omie_app_key: "order-os-account",
        omie_app_secret: "secret-order-os-account"
      }
    }
  });
  const omieQueue = orderQueueStub();

  const response = await postOmieSync(
    {
      deviceId: "device-order-os-account",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op5:create_service_order",
        accountOmieCode: 4321
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 555 });
  const infos = getParam(findRequest(omieQueue, "IncluirOS")).InformacoesAdicionais as Record<
    string,
    unknown
  >;
  assertEquals(infos.nCodCC, 4321);
});

Deno.test("create_order leva os dados da operacao interna para a ordem de servico", async () => {
  const deviceToken = "token-order-os-data";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-data": {
        id: "device-order-os-data",
        company_id: "company-order-os-data",
        unit_id: "unit-order-os-data",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-data": {
        id: "company-order-os-data",
        is_active: true,
        omie_app_key: "order-os-data",
        omie_app_secret: "secret-order-os-data"
      }
    }
  });
  const omieQueue = orderQueueStub();

  const response = await postOmieSync(
    {
      deviceId: "device-order-os-data",
      deviceToken,
      action: "create_order",
      payload: {
        localOperationId: "operation-interna-1",
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Brita 1",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op6:create_service_order",
        omieCategoryCode: "1.02.05",
        freightTotalCents: 25_000,
        freightModalidade: "1",
        transport: {
          plate: "abc1d23",
          driverName: "Motorista Teste",
          carrierName: "Transportadora Teste",
          cargoWeightKg: 12_000
        }
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 555 });
  const param = getParam(findRequest(omieQueue, "IncluirOS"));
  const infos = param.InformacoesAdicionais as Record<string, unknown>;
  // A categoria do produto vale para a OS como vale para o pedido de venda.
  assertEquals(infos.cCodCateg, "1.02.05");

  const dadosAdicionais = infos.cDadosAdicNF as string;
  assertEquals(dadosAdicionais.includes("VENDA SEM VALOR FISCAL"), true);
  assertEquals(dadosAdicionais.includes("operation-interna-1"), true);
  assertEquals(dadosAdicionais.includes("Motorista: Motorista Teste"), true);
  assertEquals(dadosAdicionais.includes("Placa: ABC1D23"), true);
  assertEquals(dadosAdicionais.includes("Transportadora: Transportadora Teste"), true);
  assertEquals(dadosAdicionais.includes("Peso liquido: 12000 kg"), true);

  // O frete vira uma segunda linha de servico: a OS nao tem bloco `frete`.
  const servicos = param.ServicosPrestados as Record<string, unknown>[];
  assertEquals(servicos.length, 2);
  assertEquals(servicos[0].cDescServ, "Brita 1");
  assertEquals(servicos[0].nValUnit, 40);
  assertEquals(String(servicos[0].cDadosAdicItem).includes("Peso liquido: 12000 kg"), true);
  assertEquals(servicos[1].cDescServ, "FRETE (FOB)");
  assertEquals(servicos[1].nQtde, 1);
  assertEquals(servicos[1].nValUnit, 250);
  // Os impostos do servico se repetem na linha de frete (obrigatorios no IncluirOS).
  assertEquals(servicos[1].cTribServ, "01");
  assertEquals(servicos[1].cRetemISS, "N");
});

Deno.test("create_order nao cria linha de frete na OS quando a operacao nao tem frete", async () => {
  const deviceToken = "token-order-os-nofreight";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-nofreight": {
        id: "device-order-os-nofreight",
        company_id: "company-order-os-nofreight",
        unit_id: "unit-order-os-nofreight",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-nofreight": {
        id: "company-order-os-nofreight",
        is_active: true,
        omie_app_key: "order-os-nofreight",
        omie_app_secret: "secret-order-os-nofreight"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-os-nofreight",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Brita 1",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op7:create_service_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const servicos = getParam(findRequest(omieQueue, "IncluirOS")).ServicosPrestados as Record<
    string,
    unknown
  >[];
  assertEquals(servicos.length, 1);
});

Deno.test("create_order tira os dois codigos de servico do mesmo cadastro do OMIE", async () => {
  const deviceToken = "token-order-os-codes";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-codes": {
        id: "device-order-os-codes",
        company_id: "company-order-os-codes",
        unit_id: "unit-order-os-codes",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-codes": {
        id: "company-order-os-codes",
        is_active: true,
        omie_app_key: "order-os-codes",
        omie_app_secret: "secret-order-os-codes"
      }
    }
  });
  // Dois servicos cadastrados: o codigo municipal do primeiro nao pode ser combinado
  // com o LC116 do segundo — o OMIE recusa a combinacao e a OS nunca era criada.
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarCadastroServico") {
      return {
        cadastroServico: [
          { cCodServMun: "1.07", cCodLC116: "01.07" },
          { cCodServMun: "9.99", cCodLC116: "09.99" }
        ]
      };
    }
    if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
    if (input.call === "IncluirOS") return { nCodOS: 555 };
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: "device-order-os-codes",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Brita 1",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op8:create_service_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const servicos = getParam(findRequest(omieQueue, "IncluirOS")).ServicosPrestados as Record<
    string,
    unknown
  >[];
  assertEquals(servicos[0].cCodServMun, "1.07");
  assertEquals(servicos[0].cCodServLC116, "01.07");
});

Deno.test("create_order resolve a conta corrente pelo nome vinculado quando falta o nCodCC", async () => {
  const deviceToken = "token-order-account-name";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-account-name": {
        id: "device-order-account-name",
        company_id: "company-order-account-name",
        unit_id: "unit-order-account-name",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-account-name": {
        id: "company-order-account-name",
        is_active: true,
        omie_app_key: "order-account-name",
        omie_app_secret: "secret-order-account-name"
      }
    }
  });
  // Caixinha e a PRIMEIRA conta corrente (o fallback historico cairia nela); a OMIE Cash
  // aparece com a grafia "OMIECASH". Sem accountOmieCode, o nome "OMIE Cash" precisa resolver
  // o nCodCC 222 (OMIECASH) pelo nome canonico — e nao o 7 (Caixinha).
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasCorrentes") {
      return {
        conta_corrente_lista: [
          { nCodCC: 7, descricao: "Caixinha" },
          { nCodCC: 222, descricao: "OMIECASH" }
        ]
      };
    }
    if (input.call === "ListarCadastroServico") {
      return { cadastros: [{ cCodServMun: "1.07" }] };
    }
    if (input.call === "IncluirPedido") {
      return { codigo_pedido: 12345 };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-order-account-name",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 30.5,
        unitPrice: 85,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op6:create_sales_order",
        paymentMethodOmieCode: "15",
        accountName: "OMIE Cash"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 12345 });
  const infos = getParam(findRequest(omieQueue, "IncluirPedido")).informacoes_adicionais as Record<
    string,
    unknown
  >;
  assertEquals(infos.codigo_conta_corrente, 222);
});

Deno.test("create_order usa a conta padrao do meio de pagamento quando o payload nao traz a conta", async () => {
  const deviceToken = "token-order-method-default";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-method-default": {
        id: "device-order-method-default",
        company_id: "company-order-method-default",
        unit_id: "unit-order-method-default",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-method-default": {
        id: "company-order-method-default",
        is_active: true,
        omie_app_key: "order-method-default",
        omie_app_secret: "secret-order-method-default"
      }
    }
  });
  // Desktop antigo: manda so o codigo do meio ("15" = boleto), sem accountOmieCode nem
  // accountName. O vinculo padrao boleto -> OMIE Cash resolve o nCodCC 222 pelo nome no
  // OMIE em vez de cair na primeira conta (7, Caixinha).
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasCorrentes") {
      return {
        conta_corrente_lista: [
          { nCodCC: 7, descricao: "Caixinha" },
          { nCodCC: 222, descricao: "OMIECASH" }
        ]
      };
    }
    if (input.call === "ListarCadastroServico") {
      return { cadastros: [{ cCodServMun: "1.07" }] };
    }
    if (input.call === "IncluirPedido") {
      return { codigo_pedido: 12345 };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-order-method-default",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 30.5,
        unitPrice: 85,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op7:create_sales_order",
        paymentMethodOmieCode: "15"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 12345 });
  const infos = getParam(findRequest(omieQueue, "IncluirPedido")).informacoes_adicionais as Record<
    string,
    unknown
  >;
  assertEquals(infos.codigo_conta_corrente, 222);
});

function parcelaAwareOrderStub(options: {
  existingParcelas?: Array<Record<string, unknown>>;
  createdParcelaCode?: string;
}) {
  return createOmieQueueStub((input) => {
    if (input.call === "ListarParcelas") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        cadastros: options.existingParcelas ?? []
      };
    }
    if (input.call === "IncluirParcela") {
      return { cCodParcela: options.createdParcelaCode ?? "212" };
    }
    if (input.call === "ListarContasCorrentes") {
      return { conta_corrente_lista: [{ nCodCC: 7 }] };
    }
    if (input.call === "ListarCadastroServico") {
      return { cadastros: [{ cCodServMun: "1.07" }] };
    }
    if (input.call === "IncluirPedido") {
      return { codigo_pedido: 12345 };
    }
    if (input.call === "IncluirOS") {
      return { nCodOS: 555 };
    }
    return defaultOmieListResponse(input);
  });
}

Deno.test("create_order envia parcelamento informado (999 + lista_parcelas) pelos dias", async () => {
  const deviceToken = "token-order-new-parcela";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-new-parcela": {
        id: "device-order-new-parcela",
        company_id: "company-order-new-parcela",
        unit_id: "unit-order-new-parcela",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-new-parcela": {
        id: "company-order-new-parcela",
        is_active: true,
        omie_app_key: "order-new-parcela",
        omie_app_secret: "secret-order-new-parcela"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  const response = await postOmieSync(
    {
      deviceId: "device-order-new-parcela",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 30.5,
        unitPrice: 85,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op6:create_sales_order",
        installmentDays: [7, 14, 21]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 12345 });
  // Nao cria parcela no cadastro: o parcelamento vai INFORMADO no pedido.
  assertEquals(
    omieQueue.requests.some((request) => request.call === "IncluirParcela"),
    false
  );
  const body = getParam(findRequest(omieQueue, "IncluirPedido"));
  const cabecalho = body.cabecalho as Record<string, unknown>;
  assertEquals(cabecalho.codigo_parcela, "999");
  assertEquals(cabecalho.qtde_parcelas, 3);
  const parcela = (body.lista_parcelas as { parcela: Array<Record<string, unknown>> }).parcela;
  assertEquals(parcela.length, 3);
  assertEquals(parcela[0].numero_parcela, 1);
  assertEquals(parcela[0].data_vencimento, "14/07/2026");
  assertEquals(parcela[2].data_vencimento, "28/07/2026");
  // Percentuais fecham 100 (a ultima absorve o arredondamento).
  assertEquals(parcela[0].percentual, 33.33);
  assertEquals(parcela[2].percentual, 33.34);
  // O OMIE exige `valor` em cada parcela; somam exatamente o total (30,5 * 85 = 2592,50).
  assertEquals(parcela[0].valor, 864.08);
  assertEquals(parcela[1].valor, 864.08);
  assertEquals(parcela[2].valor, 864.34);
  assertEquals(
    (parcela[0].valor as number) + (parcela[1].valor as number) + (parcela[2].valor as number),
    2592.5
  );
});

Deno.test("create_order leva o meio de pagamento em cada parcela (tPag da NF-e)", async () => {
  const deviceToken = "token-order-meio";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-meio": {
        id: "device-order-meio",
        company_id: "company-order-meio",
        unit_id: "unit-order-meio",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-meio": {
        id: "company-order-meio",
        is_active: true,
        omie_app_key: "order-meio",
        omie_app_secret: "secret-order-meio"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  // A vista (sem dias) MAS com meio de pagamento -> ainda usa lista_parcelas para
  // carregar o meio na NF-e.
  await postOmieSync(
    {
      deviceId: "device-order-meio",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op7:create_sales_order",
        paymentMethodOmieCode: "17"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirPedido"));
  const cabecalho = body.cabecalho as Record<string, unknown>;
  assertEquals(cabecalho.codigo_parcela, "999");
  assertEquals(cabecalho.qtde_parcelas, 1);
  const parcela = (body.lista_parcelas as { parcela: Array<Record<string, unknown>> }).parcela;
  assertEquals(parcela.length, 1);
  assertEquals(parcela[0].meio_pagamento, "17");
  assertEquals(parcela[0].data_vencimento, "07/07/2026");
});

Deno.test("create_order ativa o gerar boleto do pedido quando o meio e boleto", async () => {
  const deviceToken = "token-order-boleto";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-boleto": {
        id: "device-order-boleto",
        company_id: "company-order-boleto",
        unit_id: "unit-order-boleto",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-boleto": {
        id: "company-order-boleto",
        is_active: true,
        omie_app_key: "order-boleto",
        omie_app_secret: "secret-order-boleto"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  await postOmieSync(
    {
      deviceId: "device-order-boleto",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op10:create_sales_order",
        paymentMethodOmieCode: "15",
        installmentDays: [7, 14]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirPedido"));
  // "N" = NAO nao gerar, ou seja, o boleto SAI no faturamento (o campo do OMIE e negativo).
  assertEquals((body.cabecalho as Record<string, unknown>).nao_gerar_boleto, "N");
  const parcela = (body.lista_parcelas as { parcela: Array<Record<string, unknown>> }).parcela;
  assertEquals(parcela.length, 2);
  for (const item of parcela) {
    assertEquals(item.meio_pagamento, "15");
    assertEquals(item.nao_gerar_boleto, "N");
    // A conta a receber nasce tipada como boleto (sem isso o OMIE grava "NF-e").
    assertEquals(item.tipo_documento, "BOL");
  }
});

Deno.test("create_order nao gera boleto no pedido quando o meio nao e boleto", async () => {
  const deviceToken = "token-order-sem-boleto";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-sem-boleto": {
        id: "device-order-sem-boleto",
        company_id: "company-order-sem-boleto",
        unit_id: "unit-order-sem-boleto",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-sem-boleto": {
        id: "company-order-sem-boleto",
        is_active: true,
        omie_app_key: "order-sem-boleto",
        omie_app_secret: "secret-order-sem-boleto"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  await postOmieSync(
    {
      deviceId: "device-order-sem-boleto",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op11:create_sales_order",
        paymentMethodOmieCode: "17"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirPedido"));
  assertEquals((body.cabecalho as Record<string, unknown>).nao_gerar_boleto, "S");
  const parcela = (body.lista_parcelas as { parcela: Array<Record<string, unknown>> }).parcela;
  assertEquals(parcela[0].nao_gerar_boleto, "S");
  // Sem boleto, a conta a receber segue com o tipo de documento padrao do OMIE.
  assertEquals(parcela[0].tipo_documento, undefined);
});

Deno.test("create_order nao decide o boleto do pedido sem meio de pagamento", async () => {
  const deviceToken = "token-order-boleto-omisso";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-boleto-omisso": {
        id: "device-order-boleto-omisso",
        company_id: "company-order-boleto-omisso",
        unit_id: "unit-order-boleto-omisso",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-boleto-omisso": {
        id: "company-order-boleto-omisso",
        is_active: true,
        omie_app_key: "order-boleto-omisso",
        omie_app_secret: "secret-order-boleto-omisso"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  // Credito do cliente (fiado) e desktops antigos sobem sem o codigo do meio: nesse caso
  // o pedido nao opina sobre o boleto e vale o padrao do cadastro do cliente no OMIE.
  await postOmieSync(
    {
      deviceId: "device-order-boleto-omisso",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op12:create_sales_order",
        installmentDays: [7, 14]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirPedido"));
  assertEquals((body.cabecalho as Record<string, unknown>).nao_gerar_boleto, undefined);
  const parcela = (body.lista_parcelas as { parcela: Array<Record<string, unknown>> }).parcela;
  assertEquals(parcela[0].nao_gerar_boleto, undefined);
  assertEquals(parcela[0].tipo_documento, undefined);
});

Deno.test("create_order leva o gerar boleto para a ordem de servico", async () => {
  const deviceToken = "token-order-os-boleto";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-boleto": {
        id: "device-order-os-boleto",
        company_id: "company-order-os-boleto",
        unit_id: "unit-order-os-boleto",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-boleto": {
        id: "company-order-os-boleto",
        is_active: true,
        omie_app_key: "order-os-boleto",
        omie_app_secret: "secret-order-os-boleto"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  // A vista E com a condicao ja vinculada a um codigo do cadastro: mesmo assim a OS vai
  // com o bloco Parcelas, porque so a parcela carrega o "gerar boleto" ate o OMIE.
  await postOmieSync(
    {
      deviceId: "device-order-os-boleto",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 5,
        unitPrice: 20,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op13:create_service_order",
        paymentTermOmieCode: "030",
        paymentMethodOmieCode: "15"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirOS"));
  assertEquals((body.Cabecalho as Record<string, unknown>).cCodParc, "999");
  const parcelas = body.Parcelas as Array<Record<string, unknown>>;
  assertEquals(parcelas.length, 1);
  assertEquals(parcelas[0].nao_gerar_boleto, "N");
  assertEquals(parcelas[0].tipo_documento, "BOL");
});

Deno.test("create_order mantem a OS sem boleto no caminho historico", async () => {
  const deviceToken = "token-order-os-sem-boleto";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-sem-boleto": {
        id: "device-order-os-sem-boleto",
        company_id: "company-order-os-sem-boleto",
        unit_id: "unit-order-os-sem-boleto",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-sem-boleto": {
        id: "company-order-os-sem-boleto",
        is_active: true,
        omie_app_key: "order-os-sem-boleto",
        omie_app_secret: "secret-order-os-sem-boleto"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  // PIX a vista com codigo vinculado: segue pelo cadastro de parcelas, sem bloco Parcelas.
  await postOmieSync(
    {
      deviceId: "device-order-os-sem-boleto",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 5,
        unitPrice: 20,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op14:create_service_order",
        paymentTermOmieCode: "030",
        paymentMethodOmieCode: "17"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirOS"));
  assertEquals((body.Cabecalho as Record<string, unknown>).cCodParc, "030");
  assertEquals(body.Parcelas, undefined);
});

Deno.test("create_order marca as parcelas da OS sem boleto nos demais meios", async () => {
  const deviceToken = "token-order-os-pix-parcelado";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-pix-parcelado": {
        id: "device-order-os-pix-parcelado",
        company_id: "company-order-os-pix-parcelado",
        unit_id: "unit-order-os-pix-parcelado",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-pix-parcelado": {
        id: "company-order-os-pix-parcelado",
        is_active: true,
        omie_app_key: "order-os-pix-parcelado",
        omie_app_secret: "secret-order-os-pix-parcelado"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  await postOmieSync(
    {
      deviceId: "device-order-os-pix-parcelado",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op15:create_service_order",
        installmentDays: [30, 60],
        paymentMethodOmieCode: "17"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const parcelas = getParam(findRequest(omieQueue, "IncluirOS")).Parcelas as Array<
    Record<string, unknown>
  >;
  assertEquals(parcelas.length, 2);
  assertEquals(parcelas[0].nao_gerar_boleto, "S");
  assertEquals(parcelas[0].tipo_documento, undefined);
});

Deno.test("create_order manda os vencimentos digitados na ordem de servico", async () => {
  const deviceToken = "token-order-os-parcela";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-parcela": {
        id: "device-order-os-parcela",
        company_id: "company-order-os-parcela",
        unit_id: "unit-order-os-parcela",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-parcela": {
        id: "company-order-os-parcela",
        is_active: true,
        omie_app_key: "order-os-parcela",
        omie_app_secret: "secret-order-os-parcela"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({ createdParcelaCode: "310" });

  const response = await postOmieSync(
    {
      deviceId: "device-order-os-parcela",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op8:create_service_order",
        installmentDays: [30, 60],
        installmentCount: 2
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, orderId: 555 });
  // Nao mexe no cadastro de parcelas do OMIE: o parcelamento vai INFORMADO na OS.
  assertEquals(
    omieQueue.requests.some((request) => request.call === "IncluirParcela"),
    false
  );
  const body = getParam(findRequest(omieQueue, "IncluirOS"));
  const cabecalho = body.Cabecalho as Record<string, unknown>;
  assertEquals(cabecalho.cCodParc, "999");
  assertEquals(cabecalho.nQtdeParc, 2);
  const parcelas = body.Parcelas as Array<Record<string, unknown>>;
  assertEquals(parcelas.length, 2);
  assertEquals(parcelas[0].nParcela, 1);
  assertEquals(parcelas[0].nDias, 30);
  assertEquals(parcelas[0].dDtVenc, "06/08/2026");
  assertEquals(parcelas[1].nDias, 60);
  assertEquals(parcelas[1].dDtVenc, "05/09/2026");
  // 12 t x R$ 40,00 = R$ 480,00, divididos igualmente entre as duas parcelas.
  assertEquals(parcelas[0].nPercentual, 50);
  assertEquals(parcelas[0].nValor, 240);
  assertEquals(parcelas[1].nValor, 240);
});

Deno.test("create_order mantem a OS a vista no codigo do cadastro (sem bloco Parcelas)", async () => {
  const deviceToken = "token-order-os-avista";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-avista": {
        id: "device-order-os-avista",
        company_id: "company-order-os-avista",
        unit_id: "unit-order-os-avista",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-avista": {
        id: "company-order-os-avista",
        is_active: true,
        omie_app_key: "order-os-avista",
        omie_app_secret: "secret-order-os-avista"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({});

  await postOmieSync(
    {
      deviceId: "device-order-os-avista",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 5,
        unitPrice: 20,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op9:create_service_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirOS"));
  assertEquals((body.Cabecalho as Record<string, unknown>).cCodParc, "000");
  assertEquals(body.Parcelas, undefined);
});

Deno.test("create_order reenvia a OS pelo cadastro quando o OMIE recusa o bloco Parcelas", async () => {
  const deviceToken = "token-order-os-fallback";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-os-fallback": {
        id: "device-order-os-fallback",
        company_id: "company-order-os-fallback",
        unit_id: "unit-order-os-fallback",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-os-fallback": {
        id: "company-order-os-fallback",
        is_active: true,
        omie_app_key: "order-os-fallback",
        omie_app_secret: "secret-order-os-fallback"
      }
    }
  });
  // O OMIE recusa a tag Parcelas na primeira tentativa; a segunda (sem o bloco) passa.
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "IncluirOS") {
      const body = getParam(input);
      if (body.Parcelas !== undefined) {
        throw new Error(
          "OMIE faultstring em IncluirOS (/servicos/os/) - ERROR: Tag [PARCELAS] nao faz parte da estrutura do tipo complexo [os_cadastro]!"
        );
      }
      return { nCodOS: 777 };
    }
    if (input.call === "ConsultarOS") return {};
    if (input.call === "ListarParcelas") {
      return { pagina: 1, total_de_paginas: 1, cadastros: [] };
    }
    if (input.call === "IncluirParcela") return { cCodParcela: "311" };
    if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
    if (input.call === "ListarCadastroServico") return { cadastros: [{ cCodServMun: "1.07" }] };
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-order-os-fallback",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Pesagem interna",
        quantity: 12,
        unitPrice: 40,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op10:create_service_order",
        installmentDays: [9, 18, 27]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  // A OS nasce mesmo assim, pelo caminho historico (codigo criado no cadastro).
  assertObjectMatch(response, { ok: true, orderId: 777 });
  const attempts = omieQueue.requests.filter((request) => request.call === "IncluirOS");
  assertEquals(attempts.length, 2);
  assertEquals((getParam(attempts[1]).Cabecalho as Record<string, unknown>).cCodParc, "311");
  assertEquals(getParam(attempts[1]).Parcelas, undefined);
});

Deno.test("cancel_order consulta e exclui um pedido de venda nao faturado", async () => {
  const deviceToken = "token-cancel-ok";
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-cancel-ok": {
        id: "device-cancel-ok",
        company_id: "company-cancel-ok",
        unit_id: "unit-cancel-ok",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-cancel-ok": {
        id: "company-cancel-ok",
        is_active: true,
        omie_app_key: "cancel-ok",
        omie_app_secret: "secret-cancel-ok"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ConsultarPedido") {
      return { pedido_venda_produto: { cabecalho: { codigo_pedido: 9876, etapa: "10" } } };
    }
    if (input.call === "ExcluirPedido") {
      return { codigo_status: "0", descricao_status: "pedido excluido" };
    }
    return null;
  });

  const response = await postOmieSync(
    {
      deviceId: "device-cancel-ok",
      deviceToken,
      action: "cancel_order",
      payload: { operationId: "op1", orderType: "sales", omieOrderId: 9876, reason: "erro" }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, cancelled: true });
  assertEquals(
    omieQueue.requests.some((r) => r.call === "ExcluirPedido"),
    true
  );
});

Deno.test("cancel_order nao exclui um pedido ja faturado (blocked)", async () => {
  const deviceToken = "token-cancel-billed";
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-cancel-billed": {
        id: "device-cancel-billed",
        company_id: "company-cancel-billed",
        unit_id: "unit-cancel-billed",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-cancel-billed": {
        id: "company-cancel-billed",
        is_active: true,
        omie_app_key: "cancel-billed",
        omie_app_secret: "secret-cancel-billed"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ConsultarPedido") {
      return { pedido_venda_produto: { cabecalho: { codigo_pedido: 9876, etapa: "60" } } };
    }
    return null;
  });

  const response = await postOmieSync(
    {
      deviceId: "device-cancel-billed",
      deviceToken,
      action: "cancel_order",
      payload: { operationId: "op1", orderType: "sales", omieOrderId: 9876, reason: "erro" }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, cancelled: false, blocked: true });
  assertEquals(
    omieQueue.requests.some((r) => r.call === "ExcluirPedido"),
    false
  );
});

Deno.test("cancel_order trata pedido inexistente como ja cancelado (idempotente)", async () => {
  const deviceToken = "token-cancel-missing";
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-cancel-missing": {
        id: "device-cancel-missing",
        company_id: "company-cancel-missing",
        unit_id: "unit-cancel-missing",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-cancel-missing": {
        id: "company-cancel-missing",
        is_active: true,
        omie_app_key: "cancel-missing",
        omie_app_secret: "secret-cancel-missing"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ConsultarPedido") {
      throw new Error("SOAP-ENV: Pedido nao cadastrado para o codigo informado");
    }
    return null;
  });

  const response = await postOmieSync(
    {
      deviceId: "device-cancel-missing",
      deviceToken,
      action: "cancel_order",
      payload: { operationId: "op1", orderType: "sales", omieOrderId: 9876, reason: "erro" }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, cancelled: false, alreadyCancelled: true });
});

Deno.test("pull_customer_advances espelha o adiantamento recebido no extrato de credito", async () => {
  const deviceToken = "token-adiantamento";
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-adv": {
        id: "device-adv",
        company_id: "company-adv",
        unit_id: "unit-adv",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-adv": {
        id: "company-adv",
        is_active: true,
        omie_app_key: "key",
        omie_app_secret: "secret"
      }
    },
    customers: [{ id: "cliente-1", company_id: "company-adv", omie_customer_id: 42 }],
    // O titulo 7001 ja foi espelhado por R$ 100,00 num ciclo anterior.
    creditMovements: [
      {
        company_id: "company-adv",
        customer_id: "cliente-1",
        movement_type: "credit",
        amount_cents: 10_000,
        omie_title_id: 7001
      }
    ]
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarCategorias") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        total_de_registros: 2,
        categoria_cadastro: [
          { codigo: "1.01.01", descricao: "Venda de Produtos" },
          { codigo: "1.01.05", descricao: "Adiantamento de Clientes" }
        ]
      };
    }

    if (input.call === "ListarContasReceber") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        total_de_registros: 3,
        conta_receber_cadastro: [
          // Ja espelhado: nao pode somar de novo.
          {
            codigo_lancamento_omie: 7001,
            codigo_cliente_fornecedor: 42,
            codigo_categoria: "1.01.05",
            valor_documento: 100,
            valor_pago: 100,
            data_pagamento: "10/07/2026"
          },
          // Adiantamento novo.
          {
            codigo_lancamento_omie: 7002,
            codigo_cliente_fornecedor: 42,
            codigo_categoria: "1.01.05",
            valor_documento: 250,
            valor_pago: 250,
            data_pagamento: "20/07/2026"
          },
          // Venda comum: fica fora do saldo de adiantamento.
          {
            codigo_lancamento_omie: 7003,
            codigo_cliente_fornecedor: 42,
            codigo_categoria: "1.01.01",
            valor_documento: 900,
            valor_pago: 900
          }
        ]
      };
    }

    return null;
  });

  const response = await postOmieSync(
    { deviceId: "device-adv", deviceToken, action: "pull_customer_advances" },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, {
    ok: true,
    advances: 2,
    imported: 1,
    unchanged: 1,
    unknownCustomers: 0,
    finished: true
  });
  assertEquals(response.categoryCodes, ["1.01.05"]);

  const movements = (response.movements ?? []) as Array<Record<string, unknown>>;
  assertEquals(movements.length, 1);
  assertObjectMatch(movements[0], {
    customer_id: "cliente-1",
    movement_type: "credit",
    amount_cents: 25_000,
    balance_after_cents: 35_000,
    source: "omie",
    omie_title_id: 7002
  });

  const movementUpsert = fixtures.upserts.find(
    (upsert) => upsert.table === "customer_credit_movements"
  );
  assertEquals(movementUpsert?.rows.length, 1);
  const balanceUpsert = fixtures.upserts.find(
    (upsert) => upsert.table === "customer_credit_balances"
  );
  assertObjectMatch(balanceUpsert?.rows[0] ?? {}, {
    customer_id: "cliente-1",
    company_id: "company-adv",
    balance_cents: 35_000
  });
});

Deno.test("pull_customer_advances estorna adiantamento cancelado no OMIE", async () => {
  const deviceToken = "token-estorno";
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-adv-2": {
        id: "device-adv-2",
        company_id: "company-adv",
        unit_id: "unit-adv",
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      "company-adv": {
        id: "company-adv",
        is_active: true,
        omie_app_key: "key",
        omie_app_secret: "secret"
      }
    },
    customers: [{ id: "cliente-1", company_id: "company-adv", omie_customer_id: 42 }],
    creditMovements: [
      {
        company_id: "company-adv",
        customer_id: "cliente-1",
        movement_type: "credit",
        amount_cents: 30_000,
        omie_title_id: 7010
      }
    ]
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasReceber") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        conta_receber_cadastro: [
          {
            codigo_lancamento_omie: 7010,
            codigo_cliente_fornecedor: 42,
            codigo_categoria: "1.01.05",
            valor_documento: 300,
            valor_pago: 300,
            status_titulo: "CANCELADO"
          }
        ]
      };
    }
    return null;
  });

  const response = await postOmieSync(
    {
      deviceId: "device-adv-2",
      deviceToken,
      action: "pull_customer_advances",
      // Categorias ja conhecidas: nao revarre o plano de contas.
      payload: { categoryCodes: ["1.01.05"] }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, adjusted: 1, imported: 0 });
  const movements = (response.movements ?? []) as Array<Record<string, unknown>>;
  assertObjectMatch(movements[0], {
    movement_type: "manual_adjustment",
    amount_cents: -30_000,
    balance_after_cents: 0,
    omie_title_id: 7010
  });
});
