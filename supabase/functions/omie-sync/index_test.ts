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

type SupabaseFixtures = {
  devices: Record<string, DeviceFixture>;
  companies: Record<string, CompanyFixture>;
};

type SupabaseUpdate = {
  table: string;
  values: Record<string, unknown>;
  filters: Record<string, string>;
};

type JsonBody = Record<string, unknown>;

class SupabaseQueryStub {
  private readonly filters: Record<string, string> = {};
  private updateValues: Record<string, unknown> | null = null;

  constructor(
    private readonly table: string,
    private readonly fixtures: SupabaseFixtures,
    private readonly updates: SupabaseUpdate[]
  ) {}

  select(): SupabaseQueryStub {
    return this;
  }

  update(values: Record<string, unknown>): SupabaseQueryStub {
    this.updateValues = values;
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
}

function createSupabaseDependencies(fixtures: SupabaseFixtures): {
  createClient: NonNullable<OmieSyncHandlerDependencies["createClient"]>;
  updates: SupabaseUpdate[];
} {
  const updates: SupabaseUpdate[] = [];
  return {
    updates,
    createClient: () => ({
      from: (table: string) => new SupabaseQueryStub(table, fixtures, updates)
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
  assertEquals(omieQueue.requests.map((request) => getParam(request).pagina), [1, 2]);
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
