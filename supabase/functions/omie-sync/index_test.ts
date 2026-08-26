import { assertEquals, assertExists, assertObjectMatch } from "jsr:@std/assert";

import {
  STALE_CUSTOMER_CODE_FAULT_PREFIX,
  handleOmieSyncRequest,
  type OmieSyncHandlerDependencies
} from "./index.ts";
import {
  OmieHttpError,
  toOmieIntegrationCode,
  type OmieRequestInput,
  type OmieRequester
} from "./omie-sync-core.ts";

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

type MissingDocumentFixture = {
  company_id: string;
  order_type: "sales" | "service";
  omie_order_id: number;
};

type SupabaseFixtures = {
  devices: Record<string, DeviceFixture>;
  companies: Record<string, CompanyFixture>;
  customers?: CustomerFixture[];
  creditMovements?: CreditMovementFixture[];
  missingDocuments?: MissingDocumentFixture[];
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
      | ((value: {
          data: unknown;
          error: { message: string } | null;
        }) => TResult1 | PromiseLike<TResult1>)
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

    if (this.table === "omie_missing_documents") {
      const ids = this.inFilters.omie_order_id ?? [];
      return (this.fixtures.missingDocuments ?? []).filter(
        (document) =>
          document.company_id === this.filters.company_id &&
          (ids.length === 0 || ids.includes(document.omie_order_id))
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

Deno.test(
  "handleOmieSyncRequest busca credenciais OMIE por companyId e isola contextos multi-tenant",
  async () => {
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
    assertEquals(
      pushRequests.map((request) => request.credentials),
      [
        { appKey: "key-company-a", appSecret: "secret-company-a" },
        { appKey: "key-company-b", appSecret: "secret-company-b" }
      ]
    );
    assertEquals(
      pushRequests.map((request) => getParam(request).codigo_cliente_integracao),
      [toOmieIntegrationCode("cliente-a"), toOmieIntegrationCode("cliente-b")]
    );
  }
);

Deno.test(
  "fluxo push envia clientes e transportadoras formatados e permite limpar needs_push apos sucesso",
  async () => {
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

    const includedCustomers = omieQueue.requests.filter(
      (request) => request.call === "IncluirCliente"
    );
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
  }
);

Deno.test(
  "fluxo pull processa paginas e mapeia clientes OMIE com tag transportadora para carriers locais",
  async () => {
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
  }
);

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

// A aba Fiscal do cadastro do cliente manda nos "Enderecos de e-mail que recebem a NF"
// da OPERACAO. Espelhar a lista so no cadastro (recomendacoes.email_fatura) nao chegava
// ao pedido: a tela de e-mails do pedido nascia vazia.
Deno.test("create_order leva os e-mails da aba fiscal para utilizar_emails do pedido", async () => {
  const deviceToken = "token-order-emails";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-emails": {
        id: "device-order-emails",
        company_id: "company-order-emails",
        unit_id: "unit-order-emails",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-emails": {
        id: "company-order-emails",
        is_active: true,
        omie_app_key: "order-emails",
        omie_app_secret: "secret-order-emails"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-emails",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-20",
        idempotencyKey: "kyberrock:unit:op-emails:create_sales_order",
        invoiceEmails: "Fiscal@Cliente.com; financeiro@cliente.com , fiscal@cliente.com"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const infos = getParam(findRequest(omieQueue, "IncluirPedido")).informacoes_adicionais as Record<
    string,
    unknown
  >;
  // Todos os enderecos da aba Fiscal, normalizados e sem repetidos.
  assertEquals(infos.utilizar_emails, "fiscal@cliente.com, financeiro@cliente.com");
});

// Desktop antigo: a aba Fiscal ainda sobe so dentro do cadastro do cliente que acompanha
// o pedido. O documento tem que sair com os destinatarios do mesmo jeito.
Deno.test(
  "create_order usa a aba fiscal do cadastro quando o pedido nao traz os e-mails",
  async () => {
    const deviceToken = "token-order-emails-cadastro";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-order-emails-cadastro": {
          id: "device-order-emails-cadastro",
          company_id: "company-order-emails-cadastro",
          unit_id: "unit-order-emails-cadastro",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-order-emails-cadastro": {
          id: "company-order-emails-cadastro",
          is_active: true,
          omie_app_key: "order-emails-cadastro",
          omie_app_secret: "secret-order-emails-cadastro"
        }
      }
    });
    const omieQueue = orderQueueStub();

    await postOmieSync(
      {
        deviceId: "device-order-emails-cadastro",
        deviceToken,
        action: "create_order",
        payload: {
          operationType: "invoice",
          customerOmieId: 100,
          productOmieId: 200,
          quantity: 10,
          unitPrice: 50,
          issueDate: "2026-07-20",
          idempotencyKey: "kyberrock:unit:op-emails-cadastro:create_sales_order",
          customer: {
            localCustomerId: "cliente-local",
            razaoSocial: "Cliente Teste",
            email: "contato@cliente.com",
            fiscalEmails: "nota@cliente.com"
          }
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const infos = getParam(findRequest(omieQueue, "IncluirPedido"))
      .informacoes_adicionais as Record<string, unknown>;
    assertEquals(infos.utilizar_emails, "nota@cliente.com");
  }
);

// Cliente sem aba Fiscal: o campo nem vai, e o OMIE cai no cadastro do cliente — o
// comportamento de antes desta mudanca.
Deno.test("create_order omite utilizar_emails quando a aba fiscal esta vazia", async () => {
  const deviceToken = "token-order-emails-vazio";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-emails-vazio": {
        id: "device-order-emails-vazio",
        company_id: "company-order-emails-vazio",
        unit_id: "unit-order-emails-vazio",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-emails-vazio": {
        id: "company-order-emails-vazio",
        is_active: true,
        omie_app_key: "order-emails-vazio",
        omie_app_secret: "secret-order-emails-vazio"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-order-emails-vazio",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-20",
        idempotencyKey: "kyberrock:unit:op-emails-vazio:create_sales_order",
        invoiceEmails: "   "
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const infos = getParam(findRequest(omieQueue, "IncluirPedido")).informacoes_adicionais as Record<
    string,
    unknown
  >;
  assertEquals("utilizar_emails" in infos, false);
});

// A OS nao tem `informacoes_adicionais.utilizar_emails`: o equivalente e o bloco `Email`,
// com o "Utilizar os seguintes enderecos de e-mail" em `cEnviarPara`.
Deno.test("create_order leva os e-mails da aba fiscal para o bloco Email da OS", async () => {
  const deviceToken = "token-os-emails";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-os-emails": {
        id: "device-os-emails",
        company_id: "company-os-emails",
        unit_id: "unit-os-emails",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-os-emails": {
        id: "company-os-emails",
        is_active: true,
        omie_app_key: "os-emails",
        omie_app_secret: "secret-os-emails"
      }
    }
  });
  const omieQueue = orderQueueStub();

  await postOmieSync(
    {
      deviceId: "device-os-emails",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Brita 1",
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-20",
        idempotencyKey: "kyberrock:unit:op-os-emails:create_service_order",
        invoiceEmails: "fiscal@cliente.com, financeiro@cliente.com"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const body = getParam(findRequest(omieQueue, "IncluirOS"));
  const email = body.Email as Record<string, unknown>;
  assertEquals(email.cEnviarPara, "fiscal@cliente.com, financeiro@cliente.com");
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
  // A tag do bloco frete e `placa_estado`; `uf_placa` faz o OMIE recusar o pedido inteiro
  // ("Tag [UF_PLACA] nao faz parte da estrutura do tipo complexo [frete]").
  assertEquals(frete.placa_estado, "MG");
  assertEquals("uf_placa" in frete, false);
  assertEquals(frete.codigo_transportadora, 987654);
  // Granel: peso bruto = liquido = peso pesado, em 1 volume.
  assertEquals(frete.peso_bruto, 15000);
  assertEquals(frete.peso_liquido, 15000);
  assertEquals(frete.quantidade_volumes, 1);
  // Nao e transporte proprio: veiculo_proprio ausente.
  assertEquals("veiculo_proprio" in frete, false);

  const infos = body.informacoes_adicionais as Record<string, unknown>;
  // A UF acompanha a placa no texto (a OS nao tem bloco frete para a UF da placa).
  assertEquals(infos.dados_adicionais_nf, "Motorista: Joao Motorista - Placa: ABC-1D23/MG");
});

Deno.test(
  "create_order com transporte proprio marca veiculo_proprio e omite transportadora",
  async () => {
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

    const frete = getParam(findRequest(omieQueue, "IncluirPedido")).frete as Record<
      string,
      unknown
    >;
    assertEquals(frete.veiculo_proprio, "S");
    assertEquals("codigo_transportadora" in frete, false);
    assertEquals(frete.placa, "XYZ4E56");
    // Veiculo sem UF no cadastro: o pedido sai so com a placa (campo fiscal nao aceita
    // valor inventado), como antes.
    assertEquals("placa_estado" in frete, false);
  }
);

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

Deno.test(
  "create_order devolve a recusa do CADASTRO do cliente dizendo o campo que falta",
  async () => {
    const deviceToken = "token-order-cadastro";
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-order-cadastro": {
          id: "device-order-cadastro",
          company_id: "company-order-cadastro",
          unit_id: "unit-order-cadastro",
          token_hash: await sha256Hex(deviceToken),
          is_active: true
        }
      },
      companies: {
        "company-order-cadastro": {
          id: "company-order-cadastro",
          is_active: true,
          omie_app_key: "order-cadastro",
          omie_app_secret: "secret-order-cadastro"
        }
      }
    });
    // O OMIE recusa o IncluirCliente por campo obrigatorio faltando.
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarClientesResumido") return { clientes: [] };
      if (input.call === "IncluirCliente") {
        throw new Error("ERROR: O preenchimento da tag [email] e obrigatorio!");
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: "device-order-cadastro",
        deviceToken,
        action: "create_order",
        payload: {
          operationType: "invoice",
          customerOmieId: 0,
          customer: {
            localCustomerId: "cust-sem-email",
            razaoSocial: "Cliente Sem Email LTDA",
            cnpjCpf: "11444777000161"
          },
          productOmieId: 200,
          quantity: 10,
          unitPrice: 50,
          issueDate: "2026-07-07",
          idempotencyKey: "kyberrock:unit:op-cadastro:create_sales_order"
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // Mensagem propria (e nao a tag crua do OMIE): o desktop reconhece o prefixo para
    // pausar o job e mostrar ao operador o campo do cadastro que precisa ser preenchido.
    const error = String((response as { error?: unknown }).error ?? "");
    assertEquals(error.startsWith("Cadastro do cliente recusado pelo OMIE"), true);
    assertEquals(error.includes("Falta preencher: E-mail."), true);
    assertEquals(error.includes("Cliente Sem Email LTDA"), true);
    // Sem cliente no OMIE nao existe pedido: o IncluirPedido nem chega a ser chamado.
    assertEquals(
      omieQueue.requests.some((request) => request.call === "IncluirPedido"),
      false
    );
  }
);

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

Deno.test(
  "create_order usa a conta corrente selecionada no desktop no pedido de venda",
  async () => {
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
    const infos = getParam(findRequest(omieQueue, "IncluirPedido"))
      .informacoes_adicionais as Record<string, unknown>;
    assertEquals(infos.codigo_conta_corrente, 4321);
    // A conta veio do desktop; nao ha resolucao automatica da primeira conta do tenant.
    assertEquals(
      omieQueue.requests.some((request) => request.call === "ListarContasCorrentes"),
      false
    );
  }
);

Deno.test(
  "create_order usa a conta corrente selecionada no desktop na ordem de servico",
  async () => {
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
  }
);

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

Deno.test(
  "create_order nao cria linha de frete na OS quando a operacao nao tem frete",
  async () => {
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
  }
);

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

Deno.test(
  "create_order resolve a conta corrente pelo nome vinculado quando falta o nCodCC",
  async () => {
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
    const infos = getParam(findRequest(omieQueue, "IncluirPedido"))
      .informacoes_adicionais as Record<string, unknown>;
    assertEquals(infos.codigo_conta_corrente, 222);
  }
);

Deno.test(
  "create_order usa a conta padrao do meio de pagamento quando o payload nao traz a conta",
  async () => {
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
    const infos = getParam(findRequest(omieQueue, "IncluirPedido"))
      .informacoes_adicionais as Record<string, unknown>;
    assertEquals(infos.codigo_conta_corrente, 222);
  }
);

function parcelaAwareOrderStub(options: {
  existingParcelas?: Array<Record<string, unknown>>;
  createdParcelaCode?: string;
  /** Bloco `recomendacoes` devolvido pelo ConsultarCliente. */
  customerRecommendations?: Record<string, unknown>;
  /** Faz o ConsultarCliente falhar, para checar que o pedido segue mesmo assim. */
  failCustomerLookup?: boolean;
}) {
  return createOmieQueueStub((input) => {
    if (input.call === "ConsultarCliente") {
      if (options.failCustomerLookup) throw new Error("OMIE HTTP 500 em ConsultarCliente");
      return { recomendacoes: options.customerRecommendations ?? {} };
    }
    if (input.call === "AlterarCliente") {
      return { codigo_cliente_omie: getParam(input).codigo_cliente_omie };
    }
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

Deno.test(
  "create_order envia parcelamento informado (999 + lista_parcelas) pelos dias",
  async () => {
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
  }
);

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

// O `nao_gerar_boleto` do pedido so SUPRIME o boleto; nao existe campo no pedido que o
// LIGUE. Quem liga e a recomendacao do cadastro do cliente ("Por padrao: Gerar Boletos ao
// Emitir NF-e"). Sem este passo a parcela nascia "Gerar Boleto: Nao" mesmo com o pedido
// mandando "N" — que era o padrao do OMIE de qualquer jeito.
async function postBoletoOrder(
  deviceToken: string,
  slug: string,
  omieQueue: ReturnType<typeof parcelaAwareOrderStub>,
  paymentMethodOmieCode = "15"
): Promise<void> {
  const fixtures = createSupabaseDependencies({
    devices: {
      [`device-${slug}`]: {
        id: `device-${slug}`,
        company_id: `company-${slug}`,
        unit_id: `unit-${slug}`,
        token_hash: await sha256Hex(deviceToken),
        is_active: true
      }
    },
    companies: {
      [`company-${slug}`]: {
        id: `company-${slug}`,
        is_active: true,
        omie_app_key: `key-${slug}`,
        omie_app_secret: `secret-${slug}`
      }
    }
  });

  await postOmieSync(
    {
      deviceId: `device-${slug}`,
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 10,
        unitPrice: 50,
        issueDate: "2026-07-07",
        idempotencyKey: `kyberrock:unit:${slug}:create_sales_order`,
        paymentMethodOmieCode,
        installmentDays: [7]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );
}

Deno.test(
  "create_order liga o gerar boletos no cadastro do cliente quando a operacao e em boleto",
  async () => {
    const omieQueue = parcelaAwareOrderStub({
      // Recomendacoes ja configuradas a mao no OMIE: precisam sobreviver a alteracao.
      customerRecommendations: {
        numero_parcelas: "3",
        codigo_vendedor: 77,
        codigo_transportadora: 88,
        gerar_boletos: "N"
      }
    });

    await postBoletoOrder("token-boleto-cadastro", "boleto-cadastro", omieQueue);

    const alter = getParam(findRequest(omieQueue, "AlterarCliente"));
    assertEquals(alter.codigo_cliente_omie, 100);
    const recomendacoes = alter.recomendacoes as Record<string, unknown>;
    assertEquals(recomendacoes.gerar_boletos, "S");
    // O bloco volta INTEIRO: mandar so o gerar_boletos poderia zerar o resto no OMIE.
    assertEquals(recomendacoes.numero_parcelas, "3");
    assertEquals(recomendacoes.codigo_vendedor, 77);
    assertEquals(recomendacoes.codigo_transportadora, 88);
    // O cadastro entra ANTES do pedido, senao o pedido nasce com a recomendacao antiga.
    const calls = omieQueue.requests.map((request) => request.call);
    assertEquals(calls.indexOf("AlterarCliente") < calls.indexOf("IncluirPedido"), true);
  }
);

Deno.test("create_order nao gasta um AlterarCliente quando o cliente ja gera boleto", async () => {
  const omieQueue = parcelaAwareOrderStub({
    customerRecommendations: { gerar_boletos: "S", numero_parcelas: "1" }
  });

  await postBoletoOrder("token-boleto-ja-ligado", "boleto-ja-ligado", omieQueue);

  assertEquals(
    omieQueue.requests.some((request) => request.call === "AlterarCliente"),
    false
  );
  assertEquals(
    omieQueue.requests.some((request) => request.call === "IncluirPedido"),
    true
  );
});

Deno.test("create_order nao mexe no cadastro do cliente quando o meio nao e boleto", async () => {
  const omieQueue = parcelaAwareOrderStub({});

  // "01" = dinheiro: a recomendacao do cliente nao e assunto desta venda.
  await postBoletoOrder("token-boleto-outro-meio", "boleto-outro-meio", omieQueue, "01");

  assertEquals(
    omieQueue.requests.some((request) => request.call === "ConsultarCliente"),
    false
  );
  assertEquals(
    omieQueue.requests.some((request) => request.call === "AlterarCliente"),
    false
  );
});

Deno.test(
  "create_order cria o pedido mesmo quando o OMIE recusa a consulta do cadastro",
  async () => {
    const omieQueue = parcelaAwareOrderStub({ failCustomerLookup: true });

    await postBoletoOrder("token-boleto-cadastro-falha", "boleto-cadastro-falha", omieQueue);

    // O boleto e um detalhe da cobranca: uma falha aqui nunca pode custar o pedido.
    assertEquals(
      omieQueue.requests.some((request) => request.call === "IncluirPedido"),
      true
    );
  }
);

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
  // Sem o meio na parcela, a aba "Parcelas" da OS chegava sem "15 - Boleto Bancario" e o
  // faturamento nao tinha do que tirar a cobranca.
  assertEquals(parcelas[0].meio_pagamento, "15");
});

// Venda EM BOLETO e SEM NOTA (operacao interna -> ordem de servico). O "gerar boleto" so
// existe na parcela da OS e depende da recomendacao do cadastro do cliente: os dois
// precisam sair juntos, e o cadastro precisa ser alterado ANTES do IncluirOS.
Deno.test("create_order marca o gerar boleto da OS na venda sem nota em boleto", async () => {
  const deviceToken = "token-os-boleto-sem-nota";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-os-boleto-sem-nota": {
        id: "device-os-boleto-sem-nota",
        company_id: "company-os-boleto-sem-nota",
        unit_id: "unit-os-boleto-sem-nota",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-os-boleto-sem-nota": {
        id: "company-os-boleto-sem-nota",
        is_active: true,
        omie_app_key: "os-boleto-sem-nota",
        omie_app_secret: "secret-os-boleto-sem-nota"
      }
    }
  });
  const omieQueue = parcelaAwareOrderStub({
    customerRecommendations: { numero_parcelas: "1", gerar_boletos: "N" }
  });

  await postOmieSync(
    {
      deviceId: "device-os-boleto-sem-nota",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        customerOmieId: 100,
        serviceDescription: "Brita 1",
        quantity: 8,
        unitPrice: 30,
        issueDate: "2026-07-07",
        idempotencyKey: "kyberrock:unit:op-sem-nota:create_service_order",
        paymentMethodOmieCode: "15",
        installmentDays: [15, 30]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const parcelas = getParam(findRequest(omieQueue, "IncluirOS")).Parcelas as Array<
    Record<string, unknown>
  >;
  assertEquals(parcelas.length, 2);
  for (const parcela of parcelas) {
    assertEquals(parcela.nao_gerar_boleto, "N");
    assertEquals(parcela.tipo_documento, "BOL");
    assertEquals(parcela.meio_pagamento, "15");
  }

  const recomendacoes = getParam(findRequest(omieQueue, "AlterarCliente")).recomendacoes as Record<
    string,
    unknown
  >;
  assertEquals(recomendacoes.gerar_boletos, "S");
  const calls = omieQueue.requests.map((request) => request.call);
  assertEquals(calls.indexOf("AlterarCliente") < calls.indexOf("IncluirOS"), true);
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
  assertEquals(parcelas[0].meio_pagamento, "17");
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

Deno.test(
  "create_order mantem a OS a vista no codigo do cadastro (sem bloco Parcelas)",
  async () => {
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
  }
);

Deno.test(
  "create_order reenvia a OS pelo cadastro quando o OMIE recusa o bloco Parcelas",
  async () => {
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
  }
);

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

Deno.test(
  "pull_customer_advances espelha o adiantamento recebido no extrato de credito",
  async () => {
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
  }
);

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

Deno.test("settle_advance baixa o titulo do pedido contra a conta de adiantamento", async () => {
  const deviceToken = "token-baixa";
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-baixa": {
        id: "device-baixa",
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
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasCorrentes") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        conta_corrente_cadastro: [
          { nCodCC: 11, descricao: "Banco do Brasil" },
          { nCodCC: 22, descricao: "Adiantamento de Clientes" }
        ]
      };
    }

    if (input.call === "ListarContasReceber") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        conta_receber_cadastro: [
          // Duas parcelas do pedido faturado: a baixa vai na primeira e sobra
          // um pedaco para a segunda.
          {
            codigo_lancamento_omie: 3001,
            nCodPedido: 888,
            codigo_cliente_fornecedor: 42,
            valor_documento: 100
          },
          {
            codigo_lancamento_omie: 3002,
            nCodPedido: 888,
            codigo_cliente_fornecedor: 42,
            valor_documento: 100
          },
          // Titulo de outro pedido: nao pode ser tocado.
          {
            codigo_lancamento_omie: 3003,
            nCodPedido: 999,
            codigo_cliente_fornecedor: 42,
            valor_documento: 500
          }
        ]
      };
    }

    if (input.call === "LancarRecebimento") return { codigo_baixa: 1 };
    return null;
  });

  const response = await postOmieSync(
    {
      deviceId: "device-baixa",
      deviceToken,
      action: "settle_advance",
      payload: {
        localOperationId: "op-1",
        customerOmieId: 42,
        omieOrderId: 888,
        amountCents: 15_000,
        issueDate: "2026-07-20",
        idempotencyKey: "kyberrock:unit:op-1:settle_advance"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, {
    ok: true,
    settledCents: 15_000,
    advanceAccountCode: 22,
    pendingReceivable: false
  });

  const baixas = omieQueue.requests.filter((request) => request.call === "LancarRecebimento");
  assertEquals(baixas.length, 2);
  assertObjectMatch(getParam(baixas[0]), {
    codigo_lancamento: 3001,
    codigo_conta_corrente: 22,
    valor: 100
  });
  assertObjectMatch(getParam(baixas[1]), {
    codigo_lancamento: 3002,
    codigo_conta_corrente: 22,
    valor: 50
  });
});

Deno.test("settle_advance devolve pendencia quando o pedido ainda nao gerou titulo", async () => {
  const deviceToken = "token-baixa-2";
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-baixa-2": {
        id: "device-baixa-2",
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
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasReceber") {
      return { pagina: 1, total_de_paginas: 1, conta_receber_cadastro: [] };
    }
    return null;
  });

  const response = await postOmieSync(
    {
      deviceId: "device-baixa-2",
      deviceToken,
      action: "settle_advance",
      payload: {
        localOperationId: "op-2",
        customerOmieId: 42,
        omieOrderId: 4242,
        amountCents: 5_000,
        // Conta ja configurada: nao varre as contas correntes.
        advanceAccountCode: 22,
        idempotencyKey: "kyberrock:unit:op-2:settle_advance"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertObjectMatch(response, { ok: true, settledCents: 0, pendingReceivable: true });
  assertEquals(
    omieQueue.requests.filter((request) => request.call === "LancarRecebimento").length,
    0
  );
});

/**
 * Fixture das recusas do OMIE quando o codigo enviado no pedido nao existe na conta.
 * A frase e a mesma para cliente e transportadora (a transportadora tambem e um
 * "cliente" no OMIE); so a tag diferencia as duas.
 */
function unknownRecordFault(code: number, tag: "codigo_cliente" | "codigo_transportadora") {
  return new OmieHttpError(
    "OMIE HTTP 500 em IncluirPedido (/produtos/pedido/)",
    500,
    `ERROR: Cliente não cadastrado para o Código [${code}] ! - tag: [${tag}]`,
    null
  );
}

Deno.test(
  "create_order refaz o vinculo do cliente quando o OMIE recusa o codigo obsoleto",
  async () => {
    const deviceToken = "token-order-stale-customer";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-order-stale-customer": {
          id: "device-order-stale-customer",
          company_id: "company-order-stale-customer",
          unit_id: "unit-order-stale-customer",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-order-stale-customer": {
          id: "company-order-stale-customer",
          is_active: true,
          omie_app_key: "order-stale-customer",
          omie_app_secret: "secret-order-stale-customer"
        }
      }
    });
    // O codigo 11455924790 do cadastro local nao existe mais no OMIE; o cliente esta la
    // com o codigo 8888, achavel pelo CNPJ/CPF.
    let orderAttempts = 0;
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
      if (input.call === "ListarClientesResumido") {
        return { clientes: [{ codigo_cliente_omie: 8888 }] };
      }
      if (input.call === "AlterarCliente") return { codigo_cliente_omie: 8888 };
      if (input.call === "IncluirPedido") {
        orderAttempts++;
        const cabecalho = getParam(input).cabecalho as Record<string, unknown>;
        if (cabecalho.codigo_cliente === 11455924790) {
          throw unknownRecordFault(11455924790, "codigo_cliente");
        }
        return { codigo_pedido: 12345 };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: "device-order-stale-customer",
        deviceToken,
        action: "create_order",
        payload: {
          operationType: "invoice",
          customerOmieId: 11455924790,
          customer: {
            localCustomerId: "cust-local-stale",
            razaoSocial: "L. A. do Nascimento",
            cnpjCpf: "11444777000161"
          },
          productOmieId: 200,
          quantity: 10,
          unitPrice: 50,
          issueDate: "2026-08-03",
          idempotencyKey: "kyberrock:unit:op-stale:create_sales_order"
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // O fechamento SAI: o edge relocaliza o cliente e reenvia o pedido com o codigo bom...
    assertObjectMatch(response, { ok: true, orderId: 12345, omieCustomerId: 8888 });
    assertEquals(orderAttempts, 2);
    // ...e o codigo devolvido e o novo, para o desktop regravar o vinculo local.
    const lastOrder = omieQueue.requests
      .filter((request) => request.call === "IncluirPedido")
      .at(-1)!;
    const cabecalho = getParam(lastOrder).cabecalho as Record<string, unknown>;
    assertEquals(cabecalho.codigo_cliente, 8888);
  }
);

Deno.test(
  "create_order sem cadastro do cliente devolve a recusa deterministica do codigo obsoleto",
  async () => {
    const deviceToken = "token-order-stale-nocadastro";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-order-stale-nocadastro": {
          id: "device-order-stale-nocadastro",
          company_id: "company-order-stale-nocadastro",
          unit_id: "unit-order-stale-nocadastro",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-order-stale-nocadastro": {
          id: "company-order-stale-nocadastro",
          is_active: true,
          omie_app_key: "order-stale-nocadastro",
          omie_app_secret: "secret-order-stale-nocadastro"
        }
      }
    });
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
      if (input.call === "IncluirPedido") throw unknownRecordFault(999, "codigo_cliente");
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: "device-order-stale-nocadastro",
        deviceToken,
        action: "create_order",
        payload: {
          operationType: "invoice",
          customerOmieId: 999,
          productOmieId: 200,
          quantity: 10,
          unitPrice: 50,
          issueDate: "2026-08-03",
          idempotencyKey: "kyberrock:unit:op-stale-nocadastro:create_sales_order"
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // Sem cadastro no payload nao ha como recadastrar: a mensagem carrega o prefixo que o
    // desktop usa para limpar o vinculo local em vez de re-tentar o mesmo codigo invalido.
    const error = String((response as { error?: unknown }).error ?? "");
    assertEquals(error.startsWith(STALE_CUSTOMER_CODE_FAULT_PREFIX), true);
    assertEquals(error.includes("999"), true);
  }
);

Deno.test(
  "create_order refaz o vinculo da transportadora quando o OMIE recusa o codigo dela",
  async () => {
    const deviceToken = "token-order-stale-carrier";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-order-stale-carrier": {
          id: "device-order-stale-carrier",
          company_id: "company-order-stale-carrier",
          unit_id: "unit-order-stale-carrier",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-order-stale-carrier": {
          id: "company-order-stale-carrier",
          is_active: true,
          omie_app_key: "order-stale-carrier",
          omie_app_secret: "secret-order-stale-carrier"
        }
      }
    });
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
      if (input.call === "IncluirCliente") return { codigo_cliente_omie: 4242 };
      if (input.call === "IncluirPedido") {
        const frete = getParam(input).frete as Record<string, unknown>;
        if (frete.codigo_transportadora === 777) {
          throw unknownRecordFault(777, "codigo_transportadora");
        }
        return { codigo_pedido: 12345 };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: "device-order-stale-carrier",
        deviceToken,
        action: "create_order",
        payload: {
          operationType: "invoice",
          customerOmieId: 100,
          productOmieId: 200,
          quantity: 10,
          unitPrice: 50,
          transport: { plate: "ABC1D23", carrierOmieId: 777, cargoWeightKg: 10000 },
          carrier: {
            localCarrierId: "carrier-local-1",
            name: "Transportadora Local LTDA",
            cnpjCpf: "22222222000182"
          },
          issueDate: "2026-08-03",
          idempotencyKey: "kyberrock:unit:op-stale-carrier:create_sales_order"
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // O pedido sai com a transportadora recadastrada, e nao sem transportadora.
    assertObjectMatch(response, { ok: true, orderId: 12345, omieCarrierId: 4242 });
    const lastOrder = omieQueue.requests
      .filter((request) => request.call === "IncluirPedido")
      .at(-1)!;
    const frete = getParam(lastOrder).frete as Record<string, unknown>;
    assertEquals(frete.codigo_transportadora, 4242);
    // O cadastro da transportadora leva o codigo de integracao do id local dela (antes o
    // campo vinha de `localCustomerId`, que o pedido nunca manda, e o push estourava).
    const incluirCliente = getParam(findRequest(omieQueue, "IncluirCliente"));
    assertEquals(
      incluirCliente.codigo_cliente_integracao,
      toOmieIntegrationCode("carrier-local-1")
    );
  }
);

// ── Vinculacao KyberRock <-> OMIE e volta do faturamento ──────────────────────────────
//
// Dois sentidos, um por vez. Da balanca para o OMIE: o pedido/OS carrega a referencia da
// pesagem num campo de descricao, para quem abrir o documento la saber de qual
// carregamento ele nasceu. Do OMIE para a balanca: `check_order_billing` responde quais
// documentos ja foram faturados por uma pessoa dentro do OMIE — sem isso a pesagem fica
// para sempre em "No OMIE, falta faturar".

Deno.test("create_order leva a referencia da pesagem nos dados adicionais do pedido", async () => {
  const deviceToken = "token-order-reference";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-reference": {
        id: "device-order-reference",
        company_id: "company-order-reference",
        unit_id: "unit-order-reference",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-reference": {
        id: "company-order-reference",
        is_active: true,
        omie_app_key: "order-reference",
        omie_app_secret: "secret-order-reference"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
    // O IncluirPedido do OMIE responde com o codigo interno E o numero visivel.
    if (input.call === "IncluirPedido")
      return { codigo_pedido: 11489137846, numero_pedido: "1234" };
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-order-reference",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        operationCode: 123,
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 15,
        unitPrice: 50,
        transport: { plate: "abc1d23", driverName: "Joao Motorista" },
        issueDate: "2026-08-13",
        idempotencyKey: "kyberrock:unit:op-reference:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const infos = getParam(findRequest(omieQueue, "IncluirPedido")).informacoes_adicionais as Record<
    string,
    unknown
  >;
  // A referencia vem primeiro; o motorista/placa continua vindo depois dela.
  assertEquals(
    infos.dados_adicionais_nf,
    "Pesagem KyberRock 000123 - Motorista: Joao Motorista - Placa: ABC1D23"
  );
  // O numero visivel volta ao desktop ao lado do codigo interno: e por ele que se procura
  // o pedido dentro do OMIE.
  assertObjectMatch(response, { ok: true, orderId: 11489137846, orderNumber: "1234" });
});

Deno.test(
  "create_order referencia a NF-e de faturamento futuro nos dados adicionais do pedido",
  async () => {
    const deviceToken = "token-future-billing";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-future-billing": {
          id: "device-future-billing",
          company_id: "company-future-billing",
          unit_id: "unit-future-billing",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-future-billing": {
          id: "company-future-billing",
          is_active: true,
          omie_app_key: "future-billing",
          omie_app_secret: "secret-future-billing"
        }
      }
    });
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
      if (input.call === "IncluirPedido")
        return { codigo_pedido: 11489137846, numero_pedido: "1234" };
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: "device-future-billing",
        deviceToken,
        action: "create_order",
        payload: {
          operationType: "invoice",
          operationCode: 123,
          customerOmieId: 100,
          productOmieId: 200,
          quantity: 15,
          unitPrice: 50,
          transport: { plate: "abc1d23", driverName: "Joao Motorista" },
          issueDate: "2026-08-13",
          futureBillingNfeNumber: "12345",
          idempotencyKey: "kyberrock:unit:op-future-billing:create_sales_order"
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const infos = getParam(findRequest(omieQueue, "IncluirPedido"))
      .informacoes_adicionais as Record<string, unknown>;
    // A referencia da nota de entrega futura vem PRIMEIRO: o texto e truncado pelo fim, e
    // e a unica parte dele com efeito fiscal. O resto do texto continua igual.
    assertEquals(
      infos.dados_adicionais_nf,
      "Remessa referente a NF-e de faturamento futuro n. 12345 (venda para entrega futura)" +
        " - Pesagem KyberRock 000123 - Motorista: Joao Motorista - Placa: ABC1D23"
    );
    assertObjectMatch(response, { ok: true, orderId: 11489137846 });
  }
);

Deno.test(
  "create_order sem faturamento futuro mantem os dados adicionais como sempre foram",
  async () => {
    const deviceToken = "token-no-future-billing";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-no-future-billing": {
          id: "device-no-future-billing",
          company_id: "company-no-future-billing",
          unit_id: "unit-no-future-billing",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-no-future-billing": {
          id: "company-no-future-billing",
          is_active: true,
          omie_app_key: "no-future-billing",
          omie_app_secret: "secret-no-future-billing"
        }
      }
    });
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
      if (input.call === "IncluirPedido")
        return { codigo_pedido: 11489137846, numero_pedido: "1234" };
      return defaultOmieListResponse(input);
    });

    await postOmieSync(
      {
        deviceId: "device-no-future-billing",
        deviceToken,
        action: "create_order",
        payload: {
          operationType: "invoice",
          operationCode: 123,
          customerOmieId: 100,
          productOmieId: 200,
          quantity: 15,
          unitPrice: 50,
          transport: { plate: "abc1d23", driverName: "Joao Motorista" },
          issueDate: "2026-08-13",
          // Campo vazio (cliente sem entrega futura) nao pode virar texto no papel.
          futureBillingNfeNumber: "   ",
          idempotencyKey: "kyberrock:unit:op-no-future-billing:create_sales_order"
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const infos = getParam(findRequest(omieQueue, "IncluirPedido"))
      .informacoes_adicionais as Record<string, unknown>;
    assertEquals(
      infos.dados_adicionais_nf,
      "Pesagem KyberRock 000123 - Motorista: Joao Motorista - Placa: ABC1D23"
    );
  }
);

Deno.test("create_order leva a referencia da pesagem na OS e devolve o cNumOS", async () => {
  const deviceToken = "token-os-reference";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-os-reference": {
        id: "device-os-reference",
        company_id: "company-os-reference",
        unit_id: "unit-os-reference",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-os-reference": {
        id: "company-os-reference",
        is_active: true,
        omie_app_key: "os-reference",
        omie_app_secret: "secret-os-reference"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarContasCorrentes") return { conta_corrente_lista: [{ nCodCC: 7 }] };
    if (input.call === "ListarCadastroServico") return { cadastros: [{ cCodServMun: "1.07" }] };
    if (input.call === "IncluirOS") return { nCodOS: 11489138183, cNumOS: "000045" };
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-os-reference",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "internal",
        operationCode: 77,
        localOperationId: "op-internal-1",
        customerOmieId: 100,
        serviceDescription: "Brita 1",
        quantity: 10,
        unitPrice: 40,
        issueDate: "2026-08-13",
        idempotencyKey: "kyberrock:unit:op-internal-1:create_service_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const infos = getParam(findRequest(omieQueue, "IncluirOS")).InformacoesAdicionais as Record<
    string,
    unknown
  >;
  const additionalData = infos.cDadosAdicNF as string;
  // O codigo legivel vem antes do UUID, que continua indo por ser o identificador global.
  assertEquals(
    additionalData.startsWith(
      "VENDA SEM VALOR FISCAL - OPERACAO INTERNA KYBERROCK | Pesagem KyberRock 000077 | Operacao: op-internal-1"
    ),
    true
  );
  assertObjectMatch(response, { ok: true, orderId: 11489138183, orderNumber: "000045" });
});

Deno.test("create_order sem codigo da pesagem mantem os dados adicionais como eram", async () => {
  const deviceToken = "token-order-nocode";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-order-nocode": {
        id: "device-order-nocode",
        company_id: "company-order-nocode",
        unit_id: "unit-order-nocode",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-order-nocode": {
        id: "company-order-nocode",
        is_active: true,
        omie_app_key: "order-nocode",
        omie_app_secret: "secret-order-nocode"
      }
    }
  });
  const omieQueue = orderQueueStub();

  const response = await postOmieSync(
    {
      deviceId: "device-order-nocode",
      deviceToken,
      action: "create_order",
      payload: {
        operationType: "invoice",
        customerOmieId: 100,
        productOmieId: 200,
        quantity: 15,
        unitPrice: 50,
        transport: { plate: "abc1d23", driverName: "Joao Motorista" },
        issueDate: "2026-08-13",
        idempotencyKey: "kyberrock:unit:op-nocode:create_sales_order"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const infos = getParam(findRequest(omieQueue, "IncluirPedido")).informacoes_adicionais as Record<
    string,
    unknown
  >;
  // Desktop antigo (nao manda operationCode): o texto sai como sempre saiu.
  assertEquals(infos.dados_adicionais_nf, "Motorista: Joao Motorista - Placa: ABC1D23");
  // E o numero visivel volta nulo quando o OMIE nao o devolveu na inclusao.
  assertObjectMatch(response, { ok: true, orderId: 12345, orderNumber: null });
});

Deno.test("check_order_billing marca faturado pela etapa e devolve o numero da NF", async () => {
  const deviceToken = "token-check-billing";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-check-billing": {
        id: "device-check-billing",
        company_id: "company-check-billing",
        unit_id: "unit-check-billing",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-check-billing": {
        id: "company-check-billing",
        is_active: true,
        omie_app_key: "check-billing",
        omie_app_secret: "secret-check-billing"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    const param = getParam(input);
    if (input.call === "ConsultarPedido") {
      // 60 = faturado no kanban de Vendas (o KyberRock cria tudo na 50).
      return {
        pedido_venda_produto: {
          cabecalho: { codigo_pedido: param.codigo_pedido, numero_pedido: "1234", etapa: "60" },
          informacoes_adicionais: { numero_nfe: "987" }
        }
      };
    }
    if (input.call === "ConsultarOS") {
      // Ainda na etapa "Faturar": nada mudou para esta pesagem.
      return { Cabecalho: { nCodOS: param.nCodOS, cNumOS: "000045", cEtapa: "50" } };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-check-billing",
      deviceToken,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-1", orderType: "sales", omieOrderId: 11489137846 },
          { operationId: "op-2", orderType: "service", omieOrderId: 11489138183 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  assertEquals(results.length, 2);
  assertObjectMatch(results[0], {
    operationId: "op-1",
    found: true,
    billed: true,
    orderNumber: "1234",
    invoiceNumber: "987",
    error: null
  });
  assertObjectMatch(results[1], {
    operationId: "op-2",
    found: true,
    billed: false,
    orderNumber: "000045",
    invoiceNumber: null,
    error: null
  });
});

Deno.test("check_order_billing distingue documento sumido de falha do OMIE", async () => {
  const deviceToken = "token-check-missing";
  const token_hash = await sha256Hex(deviceToken);
  const fixtures = createSupabaseDependencies({
    devices: {
      "device-check-missing": {
        id: "device-check-missing",
        company_id: "company-check-missing",
        unit_id: "unit-check-missing",
        token_hash,
        is_active: true
      }
    },
    companies: {
      "company-check-missing": {
        id: "company-check-missing",
        is_active: true,
        omie_app_key: "check-missing",
        omie_app_secret: "secret-check-missing"
      }
    }
  });
  const omieQueue = createOmieQueueStub((input) => {
    const param = getParam(input);
    if (input.call === "ConsultarPedido") {
      if (param.codigo_pedido === 1) throw new Error("Pedido nao cadastrado para o codigo [1]");
      throw new OmieHttpError("Limite de requisicoes OMIE", 429, null, null);
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: "device-check-missing",
      deviceToken,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-missing", orderType: "sales", omieOrderId: 1 },
          { operationId: "op-flaky", orderType: "sales", omieOrderId: 2 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  // Excluido no OMIE: fato sobre o documento, nao erro a re-tentar.
  assertObjectMatch(results[0], { operationId: "op-missing", found: false, error: null });
  // Instabilidade: `found` continua true e o erro volta para a proxima passada tentar.
  assertEquals(results[1].found, true);
  assertEquals(typeof results[1].error, "string");
});

// ── Conferencia de faturamento pela LISTAGEM ──────────────────────────────────────────
//
// Cada chamada ao OMIE custa 3 segundos de fila (a mesma fila do envio dos fechamentos),
// entao conferir pesagem por pesagem nao escala: 40 pesagens travavam a fila por dois
// minutos. A listagem traz 100 documentos por chamada e vem do codigo maior para o menor,
// que e onde estao os fechamentos de hoje.

/** Um registro de ListarPedidos, no formato do modulo de Vendas do OMIE. */
function salesListingRecord(codigo: number, etapa: string, numero: string) {
  return {
    cabecalho: { codigo_pedido: codigo, numero_pedido: numero, etapa },
    informacoes_adicionais: {}
  };
}

function billingFixtures(name: string) {
  return { deviceId: `device-${name}`, companyId: `company-${name}`, token: `token-${name}` };
}

async function billingDependencies(name: string) {
  const ids = billingFixtures(name);
  const token_hash = await sha256Hex(ids.token);
  return {
    ids,
    fixtures: createSupabaseDependencies({
      devices: {
        [ids.deviceId]: {
          id: ids.deviceId,
          company_id: ids.companyId,
          unit_id: `unit-${name}`,
          token_hash,
          is_active: true
        }
      },
      companies: {
        [ids.companyId]: {
          id: ids.companyId,
          is_active: true,
          omie_app_key: name,
          omie_app_secret: `secret-${name}`
        }
      }
    })
  };
}

Deno.test("check_order_billing resolve um lote inteiro com UMA chamada de listagem", async () => {
  const { ids, fixtures } = await billingDependencies("listagem-lote");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 3,
        pedido_venda_produto: [
          salesListingRecord(9005, "60", "1005"),
          salesListingRecord(9004, "50", "1004"),
          salesListingRecord(9003, "60", "1003"),
          salesListingRecord(9002, "50", "1002"),
          salesListingRecord(9001, "50", "1001")
        ]
      };
    }
    // O numero da nota vem pelo documento fiscal: sem isso a busca do numero cairia
    // no `ConsultarPedido`, e a contagem abaixo deixaria de medir a consulta de
    // SITUACAO — que e o que este teste vigia.
    if (input.call === "ObterPedVenda") return { nNF: "500" };
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-1", orderType: "sales", omieOrderId: 9005 },
          { operationId: "op-2", orderType: "sales", omieOrderId: 9004 },
          { operationId: "op-3", orderType: "sales", omieOrderId: 9003 },
          { operationId: "op-4", orderType: "sales", omieOrderId: 9002 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  // Uma chamada para quatro pesagens — e nenhuma consulta individual.
  assertEquals(omieQueue.requests.filter((r) => r.call === "ListarPedidos").length, 1);
  assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 0);

  const results = response.results as Array<Record<string, unknown>>;
  assertEquals(
    results.map((r) => [r.operationId, r.billed, r.orderNumber]),
    [
      ["op-1", true, "1005"],
      ["op-2", false, "1004"],
      ["op-3", true, "1003"],
      ["op-4", false, "1002"]
    ]
  );
});

Deno.test("check_order_billing para de paginar quando passa do documento mais antigo", async () => {
  const { ids, fixtures } = await billingDependencies("listagem-parada");
  const pages: Record<number, unknown[]> = {
    1: [
      salesListingRecord(9005, "60", "1005"),
      salesListingRecord(9004, "50", "1004"),
      // 9000 e mais antigo que o mais antigo procurado (9004): dali para tras so tem
      // documento mais velho ainda, entao a segunda pagina nem e pedida.
      salesListingRecord(9000, "50", "1000")
    ],
    2: [salesListingRecord(8999, "50", "999")]
  };
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      const page = Number(getParam(input).pagina);
      return { pagina: page, pedido_venda_produto: pages[page] ?? [] };
    }
    // O numero da nota vem pelo documento fiscal: sem isso a busca do numero cairia
    // no `ConsultarPedido`, e a contagem abaixo deixaria de medir a consulta de
    // SITUACAO — que e o que este teste vigia.
    if (input.call === "ObterPedVenda") return { nNF: "500" };
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-1", orderType: "sales", omieOrderId: 9005 },
          { operationId: "op-2", orderType: "sales", omieOrderId: 9004 },
          { operationId: "op-3", orderType: "sales", omieOrderId: 9006 },
          { operationId: "op-4", orderType: "sales", omieOrderId: 9007 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertEquals(omieQueue.requests.filter((r) => r.call === "ListarPedidos").length, 1);
  // 9006 e 9007 nao apareceram na listagem: caem na consulta individual, que e o que
  // distingue "documento antigo demais" de "documento excluido no OMIE".
  assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 2);
});

Deno.test("check_order_billing cai na consulta individual quando a listagem falha", async () => {
  const { ids, fixtures } = await billingDependencies("listagem-recusada");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      throw new Error("ERROR: Tag [ORDENAR_POR] nao faz parte da estrutura");
    }
    if (input.call === "ConsultarPedido") {
      const codigo = Number(getParam(input).codigo_pedido);
      return {
        pedido_venda_produto: {
          cabecalho: { codigo_pedido: codigo, numero_pedido: String(codigo), etapa: "60" }
        }
      };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-1", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-2", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-3", orderType: "sales", omieOrderId: 9003 },
          { operationId: "op-4", orderType: "sales", omieOrderId: 9004 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  // A listagem some, mas a conferencia continua correta — so mais cara.
  assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 4);
  const results = response.results as Array<Record<string, unknown>>;
  assertEquals(
    results.every((r) => r.billed === true && r.found === true),
    true
  );
});

Deno.test("check_order_billing nao lista quando ha poucos documentos", async () => {
  const { ids, fixtures } = await billingDependencies("listagem-poucos");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ConsultarPedido") {
      return { pedido_venda_produto: { cabecalho: { codigo_pedido: 9001, etapa: "50" } } };
    }
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: { orders: [{ operationId: "op-1", orderType: "sales", omieOrderId: 9001 }] }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  // Uma pesagem: listar custaria uma chamada e ainda poderia nao achar. Consulta direta.
  assertEquals(omieQueue.requests.filter((r) => r.call === "ListarPedidos").length, 0);
  assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 1);
});

Deno.test("check_order_billing lista a OS pelo modulo de servicos", async () => {
  const { ids, fixtures } = await billingDependencies("listagem-os");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarOS") {
      return {
        pagina: 1,
        osCadastro: [
          { Cabecalho: { nCodOS: 7004, cNumOS: "000044", cEtapa: "60" } },
          { Cabecalho: { nCodOS: 7003, cNumOS: "000043", cEtapa: "50" } },
          { Cabecalho: { nCodOS: 7002, cNumOS: "000042", cEtapa: "50" } },
          { Cabecalho: { nCodOS: 7001, cNumOS: "000041", cEtapa: "50" } }
        ]
      };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-1", orderType: "service", omieOrderId: 7004 },
          { operationId: "op-2", orderType: "service", omieOrderId: 7003 },
          { operationId: "op-3", orderType: "service", omieOrderId: 7002 },
          { operationId: "op-4", orderType: "service", omieOrderId: 7001 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertEquals(omieQueue.requests.filter((r) => r.call === "ListarOS").length, 1);
  // UMA consulta individual, e so pela OS que a listagem deu como faturada: a listagem
  // reconhece o faturamento pela etapa mas nao carrega o numero da NFS-e, e sem ir busca-lo
  // a pesagem ficaria "Faturada" com a coluna Nota fiscal vazia para sempre. As tres que
  // ainda nao foram faturadas nao gastam chamada nenhuma.
  const consults = omieQueue.requests.filter((r) => r.call === "ConsultarOS");
  assertEquals(consults.length, 1);
  assertEquals(getParam(consults[0]).nCodOS, 7004);
  const results = response.results as Array<Record<string, unknown>>;
  assertObjectMatch(results[0], { operationId: "op-1", billed: true, orderNumber: "000044" });
  assertObjectMatch(results[3], { operationId: "op-4", billed: false, orderNumber: "000041" });
});

// A conferencia barata (a listagem) diz QUE foi faturado, nunca QUAL nota saiu: o numero da
// NF-e mora nos documentos fiscais do pedido. Sem ir busca-lo, o relatorio do cliente saia
// com "-" na coluna Nota fiscal — e, como a pesagem saia da fila ao virar faturada, ficava
// assim para sempre.
Deno.test(
  "check_order_billing vai buscar o numero da NF-e do que a listagem deu como faturado",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-por-documento");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "1002"),
            salesListingRecord(9001, "50", "1001")
          ]
        };
      }
      if (input.call === "ObterPedVenda") {
        return { nNF: "987", cChaveNFe: "3526...", danfe_pdf: "https://omie.example/danfe.pdf" };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-faturada", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-pendente", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-outra", orderType: "sales", omieOrderId: 9000 },
            { operationId: "op-mais", orderType: "sales", omieOrderId: 8999 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // So a faturada custa a consulta dos documentos fiscais.
    const documents = omieQueue.requests.filter((r) => r.call === "ObterPedVenda");
    assertEquals(documents.length, 1);
    assertEquals(getParam(documents[0]).nIdPed, 9002);

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], {
      operationId: "op-faturada",
      billed: true,
      invoiceNumber: "987",
      documentUrl: "https://omie.example/danfe.pdf"
    });
    assertObjectMatch(results[1], {
      operationId: "op-pendente",
      billed: false,
      invoiceNumber: null
    });
  }
);

// O `/produtos/dfedocs/` nao devolve `nNF`: o numero da nota mora num bloco de documentos
// fiscais, com um nome generico (`cNumero`). Procurar esse nome solto na resposta inteira
// pegaria numero de endereco e de parcela pelo caminho — por isso ele so vale dentro do
// bloco, e e esse recorte que este teste fixa.
Deno.test(
  "check_order_billing acha o numero da nota no bloco de documentos fiscais do pedido",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-bloco-documentos");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "1002"),
            salesListingRecord(9001, "50", "1001"),
            salesListingRecord(9000, "50", "1000"),
            salesListingRecord(8999, "50", "0999")
          ]
        };
      }
      if (input.call === "ObterPedVenda") {
        return {
          nIdPed: 9002,
          // Numero de ENDERECO solto na resposta: nao pode virar numero de nota.
          endereco: { cNumero: "742", cEndereco: "Rua das Pedreiras" },
          documentos_fiscais: [
            {
              cTipoDoc: "NFE",
              cNumero: "45231",
              cSerie: "1",
              cUrlDanfe: "https://omie.example/d.pdf"
            }
          ]
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-faturada", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-b", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-c", orderType: "sales", omieOrderId: 9000 },
            { operationId: "op-d", orderType: "sales", omieOrderId: 8999 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], { operationId: "op-faturada", invoiceNumber: "45231" });
  }
);

// Quando so a chave de acesso volta, o numero sai DELA: posicoes 26 a 34 dos 44 digitos.
// Guardar a chave inteira na coluna "Nota fiscal" nao serve para ninguem — o cliente e o
// contador dele pedem o numero, que e o que esta impresso na DANFE.
Deno.test("check_order_billing tira o numero da nota da chave de acesso", async () => {
  const { ids, fixtures } = await billingDependencies("nf-pela-chave");
  // cUF(35) AAMM(2608) CNPJ(14) modelo(55) serie(001) numero(000045231) tpEmis(1)
  // codigo(12345678) DV(0)
  const chave =
    "35" + "2608" + "12345678000190" + "55" + "001" + "000045231" + "1" + "12345678" + "0";
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "1002"),
          salesListingRecord(9001, "50", "1001"),
          salesListingRecord(9000, "50", "1000"),
          salesListingRecord(8999, "50", "0999")
        ]
      };
    }
    if (input.call === "ObterPedVenda") {
      return { nIdPed: 9002, chave_nfe: chave };
    }
    return defaultOmieListResponse(input);
  });

  assertEquals(chave.length, 44);

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-faturada", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-b", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-c", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-d", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  assertObjectMatch(results[0], { operationId: "op-faturada", invoiceNumber: "45231" });
});

// O numero da NF-e aparece em DOIS lugares do OMIE, e nem sempre nos dois: nos documentos
// fiscais do pedido (`/produtos/dfedocs/`) e nas informacoes adicionais do proprio pedido.
// Parar no primeiro deixava a coluna "Nota fiscal" vazia justamente na venda faturada por
// uma pessoa dentro do OMIE — que e o caso normal.
Deno.test(
  "check_order_billing cai no proprio pedido quando o documento fiscal nao traz a nota",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-fallback-pedido");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "1002"),
            salesListingRecord(9001, "50", "1001"),
            salesListingRecord(9000, "50", "1000"),
            salesListingRecord(8999, "50", "0999")
          ]
        };
      }
      // O documento fiscal existe, mas veio sem numero nenhum.
      if (input.call === "ObterPedVenda") return { nIdPed: 9002 };
      if (input.call === "ConsultarPedido") {
        return {
          pedido_venda_produto: {
            cabecalho: { codigo_pedido: 9002, numero_pedido: "1002", etapa: "60" },
            informacoes_adicionais: { numero_nfe: "45231" }
          }
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-faturada", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-b", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-c", orderType: "sales", omieOrderId: 9000 },
            { operationId: "op-d", orderType: "sales", omieOrderId: 8999 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // A segunda consulta so acontece para a faturada que voltou sem numero.
    assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 1);

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], { operationId: "op-faturada", invoiceNumber: "45231" });
  }
);

// Nota emitida E faturamento, qualquer que seja a etapa do kanban. A etapa mandava sozinha,
// e uma venda com nota cuja etapa nao tivesse sido movida voltava como NAO faturada — com o
// desktop jogando fora o numero que tinha vindo junto.
Deno.test(
  "check_order_billing da por faturada a venda com nota, mesmo em etapa baixa",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-etapa-baixa");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ConsultarPedido") {
        return {
          pedido_venda_produto: {
            cabecalho: { codigo_pedido: 9001, numero_pedido: "1001", etapa: "50" },
            informacoes_adicionais: { numero_nfe: "778" }
          }
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: { orders: [{ operationId: "op-1", orderType: "sales", omieOrderId: 9001 }] }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], {
      operationId: "op-1",
      found: true,
      billed: true,
      invoiceNumber: "778"
    });
  }
);

// O teto de consultas dirigidas e o que decidia quantas notas chegavam por passada. Dez
// bastam para o rodizio de fundo; a TELA pede mais, porque ali existe alguem esperando o
// numero e a leva seguinte so sai quando esta terminar.
Deno.test("check_order_billing respeita o teto de consultas do numero da nota", async () => {
  const { ids, fixtures } = await billingDependencies("nf-teto");
  // Do mais novo para o mais velho, como o OMIE devolve a listagem em ordem decrescente.
  const listed = Array.from({ length: 14 }, (_, index) =>
    salesListingRecord(9113 - index, "60", `${1113 - index}`)
  );
  const orders = listed.map((_, index) => ({
    operationId: `op-${index}`,
    orderType: "sales" as const,
    omieOrderId: 9113 - index
  }));

  async function run(invoiceNumberBudget?: number) {
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") return { pagina: 1, pedido_venda_produto: listed };
      if (input.call === "ConsultarNF") return { ide: { nNF: "500" } };
      if (input.call === "ObterPedVenda") return { nNF: "500" };
      return defaultOmieListResponse(input);
    });
    await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: invoiceNumberBudget === undefined ? { orders } : { orders, invoiceNumberBudget }
      },
      { createClient: fixtures.createClient, omieQueue }
    );
    // A carga se resolve na PRIMEIRA chamada: `ConsultarNF` pergunta ao cadastro de notas,
    // que e onde a nota mora. Os caminhos que perguntam ao pedido nao chegam a ser usados.
    assertEquals(omieQueue.requests.filter((r) => r.call === "ObterPedVenda").length, 0);
    return omieQueue.requests.filter((r) => r.call === "ConsultarNF").length;
  }

  // Rodizio de fundo: dez por passada, e o resto volta na proxima.
  assertEquals(await run(), 10);
  // Pedido da tela: gasta o que foi pedido...
  assertEquals(await run(12), 12);
  // ...mas o pedido nao passa do teto do teto (20), para a fila voltar ao faturamento logo
  // em seguida: com 14 documentos faturados sem numero, sao as 14 e para por ali.
  assertEquals(await run(999), listed.length);
});

// O numero e um ganho, nao um pre-requisito: a pesagem ja consta faturada, e insistir aqui
// custaria a passada inteira por causa de um campo.
Deno.test(
  "check_order_billing segue sem o numero quando o OMIE recusa a consulta do documento",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-documento-falha");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "1002"),
            salesListingRecord(9001, "50", "1001"),
            salesListingRecord(9000, "50", "1000"),
            salesListingRecord(8999, "50", "0999")
          ]
        };
      }
      if (input.call === "ObterPedVenda") {
        throw new Error("[omie] ERROR: SOAP-ERROR: documento nao disponivel");
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-faturada", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-b", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-c", orderType: "sales", omieOrderId: 9000 },
            { operationId: "op-d", orderType: "sales", omieOrderId: 8999 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], {
      operationId: "op-faturada",
      found: true,
      billed: true,
      invoiceNumber: null,
      error: null
    });
  }
);

// O nome do campo de ordenacao MUDA entre os modulos do OMIE, e mandar o do outro derruba a
// chamada inteira ("Tag [ORDEM_DECRESCENTE] nao faz parte da estrutura do tipo complexo
// [pvpListarRequest]"). Foi assim que a conferencia de faturamento de pedidos passou mais de
// um dia no caminho caro em producao. Este teste existe para isso nao voltar calado.
Deno.test(
  "check_order_billing manda o campo de ordem que cada modulo do OMIE conhece",
  async () => {
    const { ids, fixtures } = await billingDependencies("listagem-ordem");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return { pagina: 1, pedido_venda_produto: [salesListingRecord(9004, "60", "1004")] };
      }
      if (input.call === "ListarOS") {
        return {
          pagina: 1,
          osCadastro: [{ Cabecalho: { nCodOS: 7004, cNumOS: "44", cEtapa: "60" } }]
        };
      }
      return defaultOmieListResponse(input);
    });

    await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-1", orderType: "sales", omieOrderId: 9004 },
            { operationId: "op-2", orderType: "sales", omieOrderId: 9003 },
            { operationId: "op-3", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-4", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-5", orderType: "service", omieOrderId: 7004 },
            { operationId: "op-6", orderType: "service", omieOrderId: 7003 },
            { operationId: "op-7", orderType: "service", omieOrderId: 7002 },
            { operationId: "op-8", orderType: "service", omieOrderId: 7001 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // Vendas (pvpListarRequest): so `ordem_descrescente`, com o "s" a mais do proprio OMIE.
    const salesParam = getParam(omieQueue.requests.find((r) => r.call === "ListarPedidos")!);
    assertEquals(salesParam.ordem_descrescente, "S");
    assertEquals(salesParam.ordem_decrescente, undefined);

    // Servicos (osListarRequest): so `ordem_decrescente`, escrito certo.
    const serviceParam = getParam(omieQueue.requests.find((r) => r.call === "ListarOS")!);
    assertEquals(serviceParam.ordem_decrescente, "S");
    assertEquals(serviceParam.ordem_descrescente, undefined);
  }
);

// O campo de ordem decrescente de Vendas esta marcado como DEPRECATED na documentacao do
// OMIE: ele pode ser aceito e ignorado, e ai a pagina 1 traz o cadastro mais VELHO. A
// varredura tem de achar a outra ponta sozinha, senao gastaria as 10 paginas sem chegar
// perto do movimento de hoje.
Deno.test(
  "check_order_billing vira a varredura quando o OMIE lista em ordem crescente",
  async () => {
    const { ids, fixtures } = await billingDependencies("listagem-crescente");
    const pages: Record<number, unknown[]> = {
      1: [
        salesListingRecord(1001, "50", "1"),
        salesListingRecord(1002, "50", "2"),
        salesListingRecord(1003, "50", "3")
      ],
      4: [
        salesListingRecord(9001, "50", "1001"),
        salesListingRecord(9002, "60", "1002"),
        salesListingRecord(9003, "50", "1003"),
        salesListingRecord(9004, "60", "1004")
      ]
    };
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        const page = Number(getParam(input).pagina);
        return { pagina: page, total_de_paginas: 4, pedido_venda_produto: pages[page] ?? [] };
      }
      // O numero da nota vem pelo documento fiscal: sem isso a busca do numero cairia
      // no `ConsultarPedido`, e a contagem abaixo deixaria de medir a consulta de
      // SITUACAO — que e o que este teste vigia.
      if (input.call === "ObterPedVenda") return { nNF: "500" };
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-1", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-2", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-3", orderType: "sales", omieOrderId: 9003 },
            { operationId: "op-4", orderType: "sales", omieOrderId: 9004 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // Pagina 1 (velha) e, direto, a ultima — onde a ordem crescente guarda o movimento novo.
    assertEquals(
      omieQueue.requests.filter((r) => r.call === "ListarPedidos").map((r) => getParam(r).pagina),
      [1, 4]
    );
    assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 0);
    const results = response.results as Array<Record<string, unknown>>;
    assertEquals(
      results.map((r) => [r.operationId, r.billed]),
      [
        ["op-1", false],
        ["op-2", true],
        ["op-3", false],
        ["op-4", true]
      ]
    );
  }
);

// Ordem crescente e sem `total_de_paginas`: nao da para achar a ponta nova da listagem.
// Melhor largar a listagem depois de UMA chamada do que varrer o cadastro inteiro de tras
// para frente — a consulta individual e exata, so mais cara por documento.
Deno.test(
  "check_order_billing larga a listagem crescente que nao diz o total de paginas",
  async () => {
    const { ids, fixtures } = await billingDependencies("listagem-crescente-cega");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: Number(getParam(input).pagina),
          pedido_venda_produto: [
            salesListingRecord(1001, "50", "1"),
            salesListingRecord(1002, "50", "2"),
            salesListingRecord(1003, "50", "3")
          ]
        };
      }
      if (input.call === "ConsultarPedido") {
        const codigo = Number(getParam(input).codigo_pedido);
        return {
          pedido_venda_produto: {
            cabecalho: { codigo_pedido: codigo, numero_pedido: String(codigo), etapa: "60" }
          }
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-1", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-2", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-3", orderType: "sales", omieOrderId: 9003 },
            { operationId: "op-4", orderType: "sales", omieOrderId: 9004 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    assertEquals(omieQueue.requests.filter((r) => r.call === "ListarPedidos").length, 1);
    assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 4);
    const results = response.results as Array<Record<string, unknown>>;
    assertEquals(
      results.every((r) => r.found === true && r.billed === true),
      true
    );
  }
);

// ---------------------------------------------------------------------------------------
// A listagem de NOTAS. O numero da NF-e nao mora no pedido de venda — nem o
// `ConsultarPedido` nem o `ObterPedVenda` dos documentos do pedido o carregam —, e era por
// isso que a coluna "Nota fiscal" saia "Sem nota" em carga faturada ha semanas. Ele mora no
// cadastro da propria nota, que ja volta apontando para o pedido que a gerou.
// ---------------------------------------------------------------------------------------

/** Um registro da listagem de notas, do jeito que o OMIE o devolve. */
function invoiceListingRecord(
  nIdPedido: number,
  cNumPedido: string,
  nNF: string,
  extra: Record<string, unknown> = {}
) {
  return {
    ide: { nNF, serie: "1" },
    compl: { nIdNF: nIdPedido + 500000, nIdPedido },
    pedido: { cNumPedido },
    ...extra
  };
}

Deno.test(
  "check_order_billing pega o numero da nota pelo pedido, na listagem de notas",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-listagem");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          total_de_paginas: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "452"),
            salesListingRecord(9001, "60", "451"),
            salesListingRecord(9000, "60", "450"),
            salesListingRecord(8999, "60", "449")
          ]
        };
      }
      if (input.call === "ListarNF") {
        return {
          pagina: 1,
          total_de_paginas: 1,
          nfCadastro: [
            invoiceListingRecord(9002, "452", "45231"),
            invoiceListingRecord(9001, "451", "45230"),
            invoiceListingRecord(9000, "450", "45229"),
            invoiceListingRecord(8999, "449", "45228")
          ]
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-452", orderType: "sales", omieOrderId: 9002, orderNumber: "452" },
            { operationId: "op-451", orderType: "sales", omieOrderId: 9001, orderNumber: "451" },
            { operationId: "op-450", orderType: "sales", omieOrderId: 9000, orderNumber: "450" },
            { operationId: "op-449", orderType: "sales", omieOrderId: 8999, orderNumber: "449" }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertEquals(
      results.map((row) => row.invoiceNumber),
      ["45231", "45230", "45229", "45228"]
    );

    // O ponto da mudanca: as quatro notas saem de UMA chamada, e as consultas dirigidas —
    // que custam ~3s cada na fila que tambem envia os fechamentos — nao acontecem.
    assertEquals(omieQueue.requests.filter((r) => r.call === "ListarNF").length, 1);
    assertEquals(omieQueue.requests.filter((r) => r.call === "ObterPedVenda").length, 0);
    assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 0);
  }
);

// A nota volta sem o codigo interno do pedido: sobra o numero impresso, que e o mesmo que a
// coluna "Pedido/OS OMIE" mostra na tela e que o desktop manda junto na pergunta.
Deno.test(
  "check_order_billing acha a nota pelo numero do pedido quando falta o codigo",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-por-numero");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          total_de_paginas: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "452"),
            salesListingRecord(9001, "60", "451"),
            salesListingRecord(9000, "60", "450"),
            salesListingRecord(8999, "60", "449")
          ]
        };
      }
      if (input.call === "ListarNF") {
        return {
          pagina: 1,
          total_de_paginas: 1,
          nfCadastro: [
            // Sem `compl.nIdPedido`, e com o numero preenchido com zeros a esquerda.
            { ide: { nNF: "45231" }, pedido: { cNumPedido: "0452" } },
            invoiceListingRecord(9001, "451", "45230"),
            invoiceListingRecord(9000, "450", "45229"),
            invoiceListingRecord(8999, "449", "45228")
          ]
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-452", orderType: "sales", omieOrderId: 9002, orderNumber: "452" },
            { operationId: "op-451", orderType: "sales", omieOrderId: 9001, orderNumber: "451" },
            { operationId: "op-450", orderType: "sales", omieOrderId: 9000, orderNumber: "450" },
            { operationId: "op-449", orderType: "sales", omieOrderId: 8999, orderNumber: "449" }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], { operationId: "op-452", invoiceNumber: "45231" });
  }
);

// A nota da carga mais velha esta na segunda pagina. A varredura anda do documento mais
// novo para o mais velho e so vai ate onde precisa: para assim que acha todas as que
// procura.
Deno.test("check_order_billing vira a pagina da listagem de notas ate achar todas", async () => {
  const { ids, fixtures } = await billingDependencies("nf-paginacao");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      const page = Number(getParam(input).pagina);
      if (page === 1) {
        return {
          pagina: 1,
          total_de_paginas: 3,
          nfCadastro: [
            invoiceListingRecord(9500, "700", "45300"),
            invoiceListingRecord(9002, "452", "45231"),
            invoiceListingRecord(9001, "451", "45230")
          ]
        };
      }
      if (page === 2) {
        return {
          pagina: 2,
          total_de_paginas: 3,
          nfCadastro: [
            invoiceListingRecord(9000, "450", "45229"),
            invoiceListingRecord(8999, "449", "45228")
          ]
        };
      }
      return { pagina: page, total_de_paginas: 3, nfCadastro: [] };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  assertEquals(
    results.map((row) => row.invoiceNumber),
    ["45231", "45230", "45229", "45228"]
  );
  // Duas paginas bastam: a terceira nao chega a ser pedida.
  assertEquals(omieQueue.requests.filter((r) => r.call === "ListarNF").length, 2);
});

// Listagem de notas indisponivel (modulo fiscal sem acesso, instabilidade) nao derruba a
// conferencia: ela volta para a consulta dirigida, que e o caminho que ja existia.
Deno.test(
  "check_order_billing cai na consulta dirigida quando a listagem de notas falha",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-listagem-fora");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          total_de_paginas: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "452"),
            salesListingRecord(9001, "50", "451"),
            salesListingRecord(9000, "50", "450"),
            salesListingRecord(8999, "50", "449")
          ]
        };
      }
      if (input.call === "ListarNF") {
        throw new Error("faultstring: Acesso negado ao modulo de notas fiscais");
      }
      if (input.call === "ObterPedVenda") {
        return {
          nIdPed: 9002,
          documentos_fiscais: [{ cTipoDoc: "NFE", cNumero: "45231" }]
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
            { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], { operationId: "op-452", invoiceNumber: "45231" });
  }
);

// A venda INTERNA vira ordem de servico, e quando a pedreira emite a nota de servico o
// numero volta em `nNfse` — um nome que a busca nao conhecia, e a busca e sensivel a
// maiuscula. A coluna mostrava "—" mesmo com a NFS-e emitida.
Deno.test("check_order_billing le o numero da NFS-e da ordem de servico", async () => {
  const { ids, fixtures } = await billingDependencies("nfse-os");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarOS") {
      return { pagina: 1, total_de_paginas: 1, osCadastro: [] };
    }
    if (input.call === "ConsultarOS") {
      return {
        Cabecalho: { nCodOS: 7001, cNumOS: "503", cEtapa: "60" },
        InformacoesAdicionais: {
          DetalhesNfse: {
            ListaRpsNfse: [{ nRps: "120", nNfse: "8812", cCodVerif: "ABC123" }]
          }
        }
      };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [{ operationId: "op-interna", orderType: "service", omieOrderId: 7001 }]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  assertObjectMatch(results[0], {
    operationId: "op-interna",
    billed: true,
    invoiceNumber: "8812"
  });
  // A nota de servico sai da propria `ConsultarOS`: a listagem de notas de PRODUTO nao tem
  // o que dizer sobre ela, e nao chega a ser chamada.
  assertEquals(omieQueue.requests.filter((r) => r.call === "ListarNF").length, 0);
});

// O corte prematuro. A listagem de notas vem ordenada pelo codigo da NOTA, e o pedido de
// origem NAO acompanha essa ordem: uma nota emitida hoje para um pedido antigo aparece na
// primeira pagina com o codigo de pedido la embaixo. A varredura parava ali — "esta pagina
// ja tem pedido mais velho que o procurado" — e as notas das outras cargas, que estavam na
// pagina seguinte, nunca eram lidas.
Deno.test(
  "check_order_billing nao desiste da nota por causa de um pedido antigo na pagina",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-pedido-antigo");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          total_de_paginas: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "452"),
            salesListingRecord(9001, "60", "451"),
            salesListingRecord(9000, "60", "450"),
            salesListingRecord(8999, "60", "449")
          ]
        };
      }
      if (input.call === "ListarNF") {
        const page = Number(getParam(input).pagina);
        if (page === 1) {
          return {
            pagina: 1,
            total_de_paginas: 2,
            nfCadastro: [
              invoiceListingRecord(9002, "452", "45231"),
              // Nota de hoje para um pedido MUITO mais antigo que todos os procurados.
              invoiceListingRecord(1234, "77", "45230")
            ]
          };
        }
        return {
          pagina: 2,
          total_de_paginas: 2,
          nfCadastro: [
            invoiceListingRecord(9001, "451", "45229"),
            invoiceListingRecord(9000, "450", "45228"),
            invoiceListingRecord(8999, "449", "45227")
          ]
        };
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
            { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertEquals(
      results.map((row) => row.invoiceNumber),
      ["45231", "45229", "45228", "45227"]
    );
  }
);

// A janela de emissao chega ao OMIE como dEmiInicial/dEmiFinal. E ela que faz a pergunta
// variar de uma leva para a outra — sem isso a chamada sai identica sempre e o OMIE a
// recusa com "Consumo redundante detectado".
Deno.test("check_order_billing manda a janela de emissao pedida pelo desktop", async () => {
  const { ids, fixtures } = await billingDependencies("nf-janela");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [invoiceListingRecord(9002, "452", "45231")]
      };
    }
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ],
        invoiceSearchFrom: "01/08/2026",
        invoiceSearchTo: "26/08/2026"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const listarNF = omieQueue.requests.find((request) => request.call === "ListarNF");
  assertObjectMatch(listarNF?.param as Record<string, unknown>, {
    dEmiInicial: "01/08/2026",
    dEmiFinal: "26/08/2026"
  });
});

// Data que o OMIE nao entende derruba a chamada INTEIRA. Melhor varrer sem janela do que
// mandar um parametro que faz a listagem toda voltar recusada.
Deno.test("check_order_billing ignora janela de emissao em formato invalido", async () => {
  const { ids, fixtures } = await billingDependencies("nf-janela-invalida");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [invoiceListingRecord(9002, "452", "45231")]
      };
    }
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ],
        invoiceSearchFrom: "2026-08-01",
        invoiceSearchTo: "2026-08-26"
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const listarNF = omieQueue.requests.find((request) => request.call === "ListarNF");
  const param = listarNF?.param as Record<string, unknown>;
  assertEquals(param.dEmiInicial, undefined);
  assertEquals(param.dEmiFinal, undefined);
});

// O gate que fazia a varredura nunca acontecer. Ela so rodava para quem voltasse `billed`
// desta passada — e quem decide isso e a listagem de PEDIDOS, que o OMIE recusa por
// "Consumo redundante". Sem ninguem confirmado faturado, a lista saia vazia e `ListarNF`
// nao chegava a ser chamado uma vez: o log mostrava pedido recusado e nenhuma nota.
Deno.test("check_order_billing busca a nota mesmo com a listagem de pedidos recusada", async () => {
  const { ids, fixtures } = await billingDependencies("nf-sem-listagem-pedidos");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      throw new Error(
        "HTTP 500: ERROR: Consumo redundante detectado. Aguarde 28 segundos (REDUNDANT)."
      );
    }
    if (input.call === "ConsultarPedido") {
      throw new Error(
        "HTTP 500: ERROR: Consumo redundante detectado. Aguarde 43 segundos (REDUNDANT)."
      );
    }
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [
          invoiceListingRecord(9002, "452", "45231"),
          invoiceListingRecord(9001, "451", "45230")
        ]
      };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  const byOperation = new Map(results.map((row) => [row.operationId, row]));

  // As duas que tem nota voltam com o numero E dadas por faturadas: nota emitida e prova
  // de faturamento, e sem isso a linha mostraria o numero ao lado de "falta faturar".
  assertObjectMatch(byOperation.get("op-452") as Record<string, unknown>, {
    invoiceNumber: "45231",
    billed: true,
    found: true
  });
  assertObjectMatch(byOperation.get("op-451") as Record<string, unknown>, {
    invoiceNumber: "45230",
    billed: true
  });
});

// "Consumo redundante" nao e instabilidade: e o OMIE dizendo que a pergunta e igual a
// anterior. Reenviar a MESMA pergunta e o que ele acabou de recusar — a varredura
// repergunta com a pagina de outro tamanho, que cobre os mesmos registros.
Deno.test("check_order_billing repergunta a listagem de notas recusada por repeticao", async () => {
  const { ids, fixtures } = await billingDependencies("nf-repeticao");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      const param = getParam(input);
      if (Number(param.registros_por_pagina) === 100) {
        throw new Error(
          "HTTP 500: ERROR: Consumo redundante detectado. Aguarde 24 segundos (REDUNDANT)."
        );
      }
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [invoiceListingRecord(9002, "452", "45231")]
      };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  const encontrada = results.find((row) => row.operationId === "op-452");
  assertObjectMatch(encontrada as Record<string, unknown>, { invoiceNumber: "45231" });

  const tamanhos = omieQueue.requests
    .filter((request) => request.call === "ListarNF")
    .map((request) => Number((request.param as Record<string, unknown>).registros_por_pagina));
  assertEquals(tamanhos, [100, 50]);
});

// Recusa que NAO e repeticao nao ganha a repergunta: nao ha o que reformular, e insistir
// so gastaria mais uma chamada da fila que tambem envia os fechamentos.
Deno.test("check_order_billing nao repergunta a listagem de notas por falha comum", async () => {
  const { ids, fixtures } = await billingDependencies("nf-falha-comum");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      throw new Error("HTTP 500: ERROR: Acesso negado ao modulo de notas fiscais");
    }
    if (input.call === "ObterPedVenda") return { nIdPed: 9002 };
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  assertEquals(omieQueue.requests.filter((request) => request.call === "ListarNF").length, 1);
});

// O bloco `pedido` — onde mora `cNumPedido`, a chave de reserva — so vem na resposta quando
// a listagem o pede. Sem `cDetalhesPedido`, a busca por numero visivel do pedido existia no
// codigo e nunca casava nada em producao: o campo nao estava la para ser lido.
Deno.test("check_order_billing pede o bloco do pedido e so nota valida na listagem", async () => {
  const { ids, fixtures } = await billingDependencies("nf-listagem-parametros");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [invoiceListingRecord(9002, "452", "45231")]
      };
    }
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const listarNF = omieQueue.requests.find((request) => request.call === "ListarNF");
  assertObjectMatch(listarNF?.param as Record<string, unknown>, {
    cDetalhesPedido: "S",
    filtrar_por_status: "N"
  });
});

// O caminho curto que faltava. Quando a listagem nao alcanca a nota, `ConsultarNF` a busca
// pelo CODIGO DO PEDIDO — o cadastro onde ela de fato mora. Antes disto a busca dirigida ia
// perguntar ao pedido (`ObterPedVenda`, `ConsultarPedido`), que nao guarda o numero da nota:
// duas chamadas de ~3s por carga para a coluna continuar em "Sem nota".
Deno.test("check_order_billing acha a nota pelo pedido quando a listagem nao alcanca", async () => {
  const { ids, fixtures } = await billingDependencies("nf-consultar-por-pedido");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    // A nota existe, mas nao nas paginas que a varredura le (pedido mais antigo que a
    // janela de emissao, listagem recusada, modulo fora do alcance...).
    if (input.call === "ListarNF") return { pagina: 1, total_de_paginas: 1, nfCadastro: [] };
    if (input.call === "ConsultarNF") {
      const param = input.param as Record<string, unknown>;
      if (param.nIdPedido === 9002) {
        return {
          ide: { nNF: "45231", serie: "1" },
          compl: { nIdPedido: 9002 },
          pedido: { cNumPedido: "452" }
        };
      }
      throw new Error("HTTP 500: ERROR: Nota Fiscal nao cadastrada para o pedido informado.");
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  const found = results.find((row) => row.operationId === "op-452");
  assertEquals(found?.invoiceNumber, "45231");
  // Nota emitida e prova de faturamento: guardar o numero e continuar mostrando "falta
  // faturar" na linha ao lado dele seria pior do que nao ter achado.
  assertEquals(found?.billed, true);

  // O pedido faturado se resolve em UMA chamada, sem passar pelos dois caminhos que
  // perguntam ao pedido — onde o numero da nota nunca esteve. E os outros tres, que o
  // cadastro de notas respondeu nao ter nota, tambem nao gastam chamada nenhuma la: essa
  // resposta e conclusiva.
  assertEquals(omieQueue.requests.filter((request) => request.call === "ObterPedVenda").length, 0);
  assertEquals(omieQueue.requests.filter((request) => request.call === "ConsultarNF").length, 4);
});

// Nota cancelada continua no cadastro, com numero e pedido. O numero dela na coluna "Nota
// fiscal" do fechamento e o pior erro possivel aqui: parece certo, e vai para o cliente.
Deno.test("check_order_billing nao usa o numero de uma nota cancelada", async () => {
  const { ids, fixtures } = await billingDependencies("nf-cancelada");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [
          invoiceListingRecord(9002, "452", "45231", {
            ide: { nNF: "45231", serie: "1", dCan: "20/08/2026" }
          })
        ]
      };
    }
    if (input.call === "ConsultarNF") {
      throw new Error("HTTP 500: ERROR: Nota Fiscal nao cadastrada para o pedido informado.");
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  assertEquals(results.find((row) => row.operationId === "op-452")?.invoiceNumber, null);
});

// Verificado contra a resposta real do OMIE: `ConsultarNF` de um pedido que nao gerou nota
// devolve "ERROR: NF nao cadastrada para o pedido [...]" — ACENTUADO. Os padroes de fault
// sempre foram escritos sem acento, entao nenhum casava: o fault conhecido passava por
// falha desconhecida, ia para o log como erro e ainda disparava as duas chamadas de
// recuperacao por carga, na fila que tambem envia os fechamentos.
Deno.test(
  "check_order_billing encerra a busca no fault acentuado de nota inexistente",
  async () => {
    const { ids, fixtures } = await billingDependencies("nf-fault-acentuado");
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ListarPedidos") {
        return {
          pagina: 1,
          total_de_paginas: 1,
          pedido_venda_produto: [
            salesListingRecord(9002, "60", "452"),
            salesListingRecord(9001, "60", "451"),
            salesListingRecord(9000, "60", "450"),
            salesListingRecord(8999, "60", "449")
          ]
        };
      }
      if (input.call === "ListarNF") return { pagina: 1, total_de_paginas: 1, nfCadastro: [] };
      if (input.call === "ConsultarNF") {
        // O texto exato que o OMIE devolveu na verificacao contra a API real.
        throw new Error("ERROR: NF não cadastrada para o pedido [11495336979] !] !");
      }
      return defaultOmieListResponse(input);
    });

    await postOmieSync(
      {
        deviceId: ids.deviceId,
        deviceToken: ids.token,
        action: "check_order_billing",
        payload: {
          orders: [
            { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
            { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
            { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
            { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
          ]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    // A resposta e conclusiva: nenhuma das quatro cargas gasta as chamadas que perguntam ao
    // pedido. Sem a normalizacao de acento eram oito chamadas a toa nesta unica passada.
    assertEquals(
      omieQueue.requests.filter((request) => request.call === "ObterPedVenda").length,
      0
    );
    assertEquals(
      omieQueue.requests.filter((request) => request.call === "ConsultarPedido").length,
      0
    );
  }
);

// `ide.nNF` vem preenchido a esquerda na resposta real ("00029490" para a nota 29490), e o
// mesmo documento sai sem zeros quando o numero e derivado da chave de acesso. A coluna
// "Nota fiscal" nao pode mostrar a mesma nota de dois jeitos conforme quem a encontrou.
Deno.test("check_order_billing normaliza os zeros a esquerda do numero da nota", async () => {
  const { ids, fixtures } = await billingDependencies("nf-zeros-a-esquerda");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451"),
          salesListingRecord(9000, "60", "450"),
          salesListingRecord(8999, "60", "449")
        ]
      };
    }
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        // A forma exata da resposta real: numero zero-preenchido em `ide`, pedido em
        // `compl.nIdPedido`, numero visivel do pedido em `pedido.cNumPedido`.
        nfCadastro: [
          {
            ide: { nNF: "00029490", serie: "001", dCan: "", dInut: "", cDeneg: "N" },
            compl: { nIdNF: 11495337714, nIdPedido: 9002 },
            pedido: { cNumPedido: "452", cCancelado: "N" }
          }
        ]
      };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002, orderNumber: "452" },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const results = response.results as Array<Record<string, unknown>>;
  assertEquals(results.find((row) => row.operationId === "op-452")?.invoiceNumber, "29490");
});

Deno.test(
  "check_order_billing anota o documento excluido no OMIE em vez de perguntar de novo",
  async () => {
    const deviceToken = "token-missing-doc";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-missing-doc": {
          id: "device-missing-doc",
          company_id: "company-missing-doc",
          unit_id: "unit-missing-doc",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-missing-doc": {
          id: "company-missing-doc",
          is_active: true,
          omie_app_key: "missing-doc",
          omie_app_secret: "secret-missing-doc"
        }
      }
    });
    const omieQueue = createOmieQueueStub((input) => {
      if (input.call === "ConsultarOS") {
        // A recusa real do OMIE para uma OS excluida la.
        throw new Error(
          "OMIE HTTP 500 em ConsultarOS - ERROR: OS nao cadastrada para o Codigo [11495303005] !"
        );
      }
      return defaultOmieListResponse(input);
    });

    const response = await postOmieSync(
      {
        deviceId: "device-missing-doc",
        deviceToken,
        action: "check_order_billing",
        payload: {
          orders: [{ operationId: "op-sumida", orderType: "service", omieOrderId: 11495303005 }]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertObjectMatch(results[0], { operationId: "op-sumida", found: false, error: null });

    const remembered = fixtures.upserts.find((upsert) => upsert.table === "omie_missing_documents");
    assertExists(remembered, "o documento inexistente precisa ficar anotado na nuvem");
    assertObjectMatch(remembered.rows[0], {
      company_id: "company-missing-doc",
      order_type: "service",
      omie_order_id: 11495303005,
      operation_id: "op-sumida"
    });
  }
);

Deno.test(
  "check_order_billing responde da memoria e nao gasta chamada com documento ja excluido",
  async () => {
    const deviceToken = "token-missing-known";
    const token_hash = await sha256Hex(deviceToken);
    const fixtures = createSupabaseDependencies({
      devices: {
        "device-missing-known": {
          id: "device-missing-known",
          company_id: "company-missing-known",
          unit_id: "unit-missing-known",
          token_hash,
          is_active: true
        }
      },
      companies: {
        "company-missing-known": {
          id: "company-missing-known",
          is_active: true,
          omie_app_key: "missing-known",
          omie_app_secret: "secret-missing-known"
        }
      },
      missingDocuments: [
        {
          company_id: "company-missing-known",
          order_type: "service",
          omie_order_id: 11495303005
        }
      ]
    });
    const omieQueue = createOmieQueueStub((input) => defaultOmieListResponse(input));

    const response = await postOmieSync(
      {
        deviceId: "device-missing-known",
        deviceToken,
        action: "check_order_billing",
        payload: {
          orders: [{ operationId: "op-sumida", orderType: "service", omieOrderId: 11495303005 }]
        }
      },
      { createClient: fixtures.createClient, omieQueue }
    );

    const results = response.results as Array<Record<string, unknown>>;
    assertEquals(results.length, 1);
    assertObjectMatch(results[0], { operationId: "op-sumida", found: false, error: null });
    // Era esta chamada, repetida a cada passada por 24 documentos, que bloqueava a API.
    assertEquals(omieQueue.requests.filter((request) => request.call === "ConsultarOS").length, 0);
  }
);
// O orcamento de TEMPO da passada. O gateway corta a requisicao lenta com 504 e a
// resposta — que carrega os numeros que a balanca vai gravar — morre DEPOIS de o trabalho
// todo ter sido feito: o log mostrava "52 de 53 casadas" e o desktop recebia timeout, a
// fila local nunca drenava e a coluna seguia vazia com tudo aparentemente funcionando.
// O prazo poe o teto antes do gateway: devolve o que ja esta pronto e deixa o resto para
// a passada seguinte.
Deno.test("check_order_billing devolve resultado parcial quando o tempo aperta", async () => {
  const { ids, fixtures } = await billingDependencies("nf-orcamento-tempo");
  // Cada chamada ao OMIE "gasta" 20s no relogio injetado: a varredura de notas (1a
  // chamada) cabe no orcamento de 50s; a listagem de pedidos (2a) tambem; dali em diante
  // o prazo esta vencido e nenhuma consulta individual ou cacada dirigida acontece.
  let clock = 0;
  const nowFn = () => clock;
  const omieQueue = createOmieQueueStub((input) => {
    clock += 20_000;
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [
          invoiceListingRecord(9002, "452", "45231"),
          invoiceListingRecord(9001, "451", "45230")
        ]
      };
    }
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 2,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "60", "451")
        ]
      };
    }
    return defaultOmieListResponse(input);
  });

  const response = await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          // Estes dois nao aparecem na listagem: cairiam na consulta individual, que o
          // prazo vencido pula — ficam sem resultado NESTA passada, e voltam na proxima.
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue, nowFn }
  );

  const results = response.results as Array<Record<string, unknown>>;
  const byOperation = new Map(results.map((row) => [row.operationId, row]));

  // O que coube chegou INTEIRO — inclusive os numeros, que vieram da primeira chamada.
  assertObjectMatch(byOperation.get("op-452") as Record<string, unknown>, {
    billed: true,
    invoiceNumber: "45231"
  });
  assertObjectMatch(byOperation.get("op-451") as Record<string, unknown>, {
    billed: true,
    invoiceNumber: "45230"
  });

  // O prazo vencido nao gastou nenhuma chamada cara: nada de consulta individual.
  assertEquals(omieQueue.requests.filter((r) => r.call === "ConsultarPedido").length, 0);
  assertEquals(omieQueue.requests.filter((r) => r.call === "ObterPedVenda").length, 0);
});

// A varredura de notas roda PRIMEIRO. O numero e o que a tela espera, e uma passada
// apertada corta o que vem por ultimo: quando a varredura ficava no fim, era exatamente o
// numero que morria no corte.
Deno.test("check_order_billing busca as notas antes de conferir os pedidos", async () => {
  const { ids, fixtures } = await billingDependencies("nf-notas-primeiro");
  const omieQueue = createOmieQueueStub((input) => {
    if (input.call === "ListarNF") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        nfCadastro: [invoiceListingRecord(9002, "452", "45231")]
      };
    }
    if (input.call === "ListarPedidos") {
      return {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          salesListingRecord(9002, "60", "452"),
          salesListingRecord(9001, "50", "451"),
          salesListingRecord(9000, "50", "450"),
          salesListingRecord(8999, "50", "449")
        ]
      };
    }
    return defaultOmieListResponse(input);
  });

  await postOmieSync(
    {
      deviceId: ids.deviceId,
      deviceToken: ids.token,
      action: "check_order_billing",
      payload: {
        orders: [
          { operationId: "op-452", orderType: "sales", omieOrderId: 9002 },
          { operationId: "op-451", orderType: "sales", omieOrderId: 9001 },
          { operationId: "op-450", orderType: "sales", omieOrderId: 9000 },
          { operationId: "op-449", orderType: "sales", omieOrderId: 8999 }
        ]
      }
    },
    { createClient: fixtures.createClient, omieQueue }
  );

  const calls = omieQueue.requests.map((request) => request.call);
  assertEquals(calls.indexOf("ListarNF") < calls.indexOf("ListarPedidos"), true);
});
