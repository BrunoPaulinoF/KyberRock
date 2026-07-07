import { describe, expect, it, vi } from "vitest";

import {
  OMIE_INTEGRATION_CODE_MAX_LENGTH,
  OmieQueueManager,
  buildCarrierPayload,
  pushCarrierToOmie,
  pushCustomerToOmieCore,
  toOmieIntegrationCode
} from "../../supabase/functions/omie-sync/omie-sync-core";

const credentials = { appKey: "app_key_teste", appSecret: "app_secret_teste" };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
}

function readRequestBody(fetchFn: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const request = fetchFn.mock.calls[index]?.[1] as RequestInit | undefined;
  expect(request?.body).toBeTypeOf("string");
  return JSON.parse(String(request?.body)) as Record<string, unknown>;
}

describe("omie-sync contratos de requisicao", () => {
  it("envia chamadas OMIE com credenciais, call e param no formato exigido", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ codigo_cliente_omie: 123 }));
    const queue = new OmieQueueManager({ fetchFn, sleepFn: async () => undefined });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-1",
      razaoSocial: "Cliente Teste",
      nomeFantasia: "Cliente",
      cnpjCpf: "12345678000190"
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://app.omie.com.br/api/v1/geral/clientes/");
    const body = readRequestBody(fetchFn);
    expect(body).toMatchObject({
      call: "IncluirCliente",
      app_key: "app_key_teste",
      app_secret: "app_secret_teste"
    });
    expect(body.param).toEqual([
      expect.objectContaining({
        codigo_cliente_integracao: toOmieIntegrationCode("cliente-1"),
        razao_social: "Cliente Teste",
        cnpj_cpf: "12345678000190"
      })
    ]);
  });

  it("forca a tag transportadora no payload e na requisicao de transportadora", async () => {
    expect(
      buildCarrierPayload({
        localCustomerId: "carrier:1",
        name: "Transporte Bom",
        tags: ["cliente"]
      })
    ).toMatchObject({
      razao_social: "Transporte Bom",
      nome_fantasia: "Transporte Bom",
      tags: [{ tag: "cliente" }, { tag: "transportadora" }]
    });

    const fetchFn = vi.fn(async () => jsonResponse({ codigo_cliente_omie: 456 }));
    const queue = new OmieQueueManager({ fetchFn, sleepFn: async () => undefined });
    await pushCarrierToOmie(queue, credentials, {
      localCustomerId: "carrier:1",
      name: "Transporte Bom",
      cnpjCpf: "00999888000177"
    });

    const body = readRequestBody(fetchFn);
    expect(body.param).toEqual([
      expect.objectContaining({
        codigo_cliente_integracao: toOmieIntegrationCode("carrier:1"),
        tags: [{ tag: "transportadora" }]
      })
    ]);
  });

  it("respeita retry-after HTTP 429 antes de repetir a requisicao", async () => {
    const sleeps: number[] = [];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { faultstring: "Limite de requisicoes" },
          { status: 429, headers: { "retry-after": "2" } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ codigo_cliente_omie: 789 }));
    const queue = new OmieQueueManager({
      fetchFn,
      minDelayMs: 0,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-rate-limit",
      razaoSocial: "Cliente Rate Limit"
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(2_000);
  });

  it("aplica backoff exponencial quando OMIE pede aguarde por consumo redundante", async () => {
    const sleeps: number[] = [];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ faultstring: "Consumo redundante. Aguarde 3 segundos" })
      )
      .mockResolvedValueOnce(jsonResponse({ faultstring: "Consumo redundante" }))
      .mockResolvedValueOnce(jsonResponse({ codigo_cliente_omie: 321 }));
    const queue = new OmieQueueManager({
      fetchFn,
      minDelayMs: 0,
      baseBackoffMs: 5_000,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-redundante",
      razaoSocial: "Cliente Redundante"
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([4_000, 10_000]);
  });
});

describe("cliente ja cadastrado no OMIE", () => {
  it("converte IncluirCliente em AlterarCliente quando o CPF/CNPJ ja existe", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          faultstring:
            "ERROR: Cliente já cadastrado para o CPF/CNPJ [456.487.238-90] com o Id [11474590160] e código de integração [f5f664d2-7243-4a90-936a-f285fbd7df97] ! (add)"
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    const id = await pushCarrierToOmie(queue, credentials, {
      localCustomerId: "dbaa8355-2eb2-4cff-a040-a7025dbd1d07",
      name: "Transportadora Existente",
      cnpjCpf: "45648723890"
    });

    expect(id).toBe(11474590160);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const secondBody = readRequestBody(fetchFn, 1);
    expect(secondBody.call).toBe("AlterarCliente");
    expect(secondBody.param).toEqual([
      expect.objectContaining({ codigo_cliente_omie: 11474590160 })
    ]);
    // O cadastro adotado tem outro codigo de integracao no OMIE; enviar o nosso
    // faria o AlterarCliente falhar com "Cliente nao cadastrado para o Codigo
    // de Integracao". O update deve identificar apenas pelo codigo_cliente_omie.
    const updateParam = (secondBody.param as Array<Record<string, unknown>>)[0];
    expect(updateParam).not.toHaveProperty("codigo_cliente_integracao");
  });

  it("nao envia codigo_cliente_integracao em updates de cliente com omieCustomerId", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    const id = await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-adotado",
      omieCustomerId: 777,
      razaoSocial: "Cliente Adotado"
    });

    expect(id).toBe(777);
    const body = readRequestBody(fetchFn);
    expect(body.call).toBe("AlterarCliente");
    const param = (body.param as Array<Record<string, unknown>>)[0];
    expect(param.codigo_cliente_omie).toBe(777);
    expect(param).not.toHaveProperty("codigo_cliente_integracao");
  });
});

describe("toOmieIntegrationCode", () => {
  it("mantem codigos curtos que ja sao alfanumericos", () => {
    expect(toOmieIntegrationCode("cliente1")).toBe("cliente1");
    expect(toOmieIntegrationCode("  ABC123  ")).toBe("ABC123");
  });

  it("converte UUIDs e chaves de idempotencia em codigos sem caracteres especiais", () => {
    const samples = [
      "dbaa8355-2eb2-4cff-a040-a7025dbd1d07",
      "kyberrock:unit-1:op-1:create_sales_order",
      "kyberrock:unit_1:fiado_cust_1_2026-03-15:create_sales_order"
    ];
    for (const sample of samples) {
      const code = toOmieIntegrationCode(sample);
      expect(code).toMatch(/^[A-Za-z0-9]+$/);
      expect(code.length).toBeLessThanOrEqual(OMIE_INTEGRATION_CODE_MAX_LENGTH);
    }
  });

  it("e deterministico e distingue entradas que so diferem nos separadores", () => {
    const key = "kyberrock:unit-1:op-1:create_sales_order";
    expect(toOmieIntegrationCode(key)).toBe(toOmieIntegrationCode(key));
    expect(toOmieIntegrationCode("a:b")).not.toBe(toOmieIntegrationCode("ab"));
    expect(toOmieIntegrationCode("a:b")).not.toBe(toOmieIntegrationCode("a-b"));
  });

  it("e idempotente: sanitizar um codigo ja sanitizado nao muda o valor", () => {
    const code = toOmieIntegrationCode("kyberrock:unit-1:op-1:create_sales_order");
    expect(toOmieIntegrationCode(code)).toBe(code);
  });
});
