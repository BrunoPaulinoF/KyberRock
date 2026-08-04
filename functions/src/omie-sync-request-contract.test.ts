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

/**
 * Stub do OMIE que responde por `call`, para os fluxos que encadeiam chamadas diferentes
 * (IncluirCliente -> ConsultarCliente -> AlterarCliente). Uma `call` sem resposta
 * declarada e um erro do teste, nao um `{}` silencioso.
 */
function omieStub(responses: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { call?: string };
    const call = body.call ?? "";
    if (!(call in responses)) throw new Error(`Chamada OMIE inesperada no teste: ${call}`);
    return jsonResponse(responses[call]);
  });
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
      // ConsultarCliente que le as tags atuais antes de alterar (ver mergeOmieCustomerTags).
      .mockResolvedValueOnce(jsonResponse({ tags: [{ tag: "cliente" }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    const id = await pushCarrierToOmie(queue, credentials, {
      localCustomerId: "dbaa8355-2eb2-4cff-a040-a7025dbd1d07",
      name: "Transportadora Existente",
      cnpjCpf: "45648723890"
    });

    expect(id).toBe(11474590160);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const updateRequest = readRequestBody(fetchFn, 2);
    expect(updateRequest.call).toBe("AlterarCliente");
    expect(updateRequest.param).toEqual([
      expect.objectContaining({
        codigo_cliente_omie: 11474590160,
        // A tag do papel entra sem apagar a que o cadastro ja tinha no OMIE.
        tags: [{ tag: "cliente" }, { tag: "transportadora" }]
      })
    ]);
    // O cadastro adotado tem outro codigo de integracao no OMIE; enviar o nosso
    // faria o AlterarCliente falhar com "Cliente nao cadastrado para o Codigo
    // de Integracao". O update deve identificar apenas pelo codigo_cliente_omie.
    const updateParam = (updateRequest.param as Array<Record<string, unknown>>)[0];
    expect(updateParam).not.toHaveProperty("codigo_cliente_integracao");
  });

  // Reenvio de um cadastro que ja tinha entrado no OMIE: la a recusa vem pelo codigo de
  // integracao e o codigo existente aparece como "nCod", nao como "Id". Sem ler essa
  // grafia o fechamento travava com "Cadastro do cliente recusado pelo OMIE".
  it("converte IncluirCliente em AlterarCliente quando o codigo de integracao ja existe", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          faultstring:
            "ERROR: Cliente já cadastrado para o Código de Integração [KR3VJZ2L7RLIMCH] com o nCod [11489512176]!"
        })
      )
      .mockResolvedValueOnce(jsonResponse({ tags: [{ tag: "transportadora" }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    const id = await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-reenviado",
      razaoSocial: "MULTICOM COMERCIO DE MATERIAIS DE CONSTRUCAO LTDA",
      cnpjCpf: "12345678000190"
    });

    expect(id).toBe(11489512176);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const updateRequest = readRequestBody(fetchFn, 2);
    expect(updateRequest.call).toBe("AlterarCliente");
    expect(updateRequest.param).toEqual([
      expect.objectContaining({
        codigo_cliente_omie: 11489512176,
        // Cadastro que tambem transporta continua transportadora e ganha o papel cliente.
        tags: [{ tag: "transportadora" }, { tag: "cliente" }]
      })
    ]);
  });

  // Rede de seguranca: se o OMIE mudar de novo o texto da recusa, o codigo existente vem
  // do ConsultarCliente pelo nosso codigo de integracao — a duplicidade nunca vira uma
  // pendencia de cadastro para o operador resolver.
  it("consulta o cliente pelo codigo de integracao quando a recusa nao traz o codigo", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ faultstring: "ERROR: Cliente já cadastrado para o Código de Integração!" })
      )
      .mockResolvedValueOnce(jsonResponse({ codigo_cliente_omie: 555 }))
      .mockResolvedValueOnce(jsonResponse({ tags: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    const id = await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-sem-codigo-na-mensagem",
      razaoSocial: "Cliente Sem Codigo"
    });

    expect(id).toBe(555);
    expect(readRequestBody(fetchFn, 1)).toMatchObject({ call: "ConsultarCliente" });
    expect(readRequestBody(fetchFn, 1).param).toEqual([
      { codigo_cliente_integracao: toOmieIntegrationCode("cliente-sem-codigo-na-mensagem") }
    ]);
    const updateBody = readRequestBody(fetchFn, 3);
    expect(updateBody.call).toBe("AlterarCliente");
    expect(updateBody.param).toEqual([expect.objectContaining({ codigo_cliente_omie: 555 })]);
  });

  // Aba Fiscal do cadastro -> "Utilizar os seguintes enderecos de e-mail" do OMIE. O
  // `email` do cadastro e outra coisa: o contato do cliente, que nao decide quem recebe
  // a nota.
  it("grava os e-mails da aba fiscal no email_fatura das recomendacoes", async () => {
    const fetchFn = omieStub({
      IncluirCliente: { codigo_cliente_omie: 42 },
      ConsultarCliente: { recomendacoes: { codigo_vendedor: 9, gerar_boletos: "S" } },
      AlterarCliente: { ok: true }
    });
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    const id = await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-fiscal",
      razaoSocial: "Cliente Fiscal",
      email: "contato@cliente.com",
      fiscalEmails: "Fiscal@cliente.com; financeiro@cliente.com"
    });

    expect(id).toBe(42);
    // O contato segue no campo `email`, sem virar destinatario de nota.
    expect((readRequestBody(fetchFn, 0).param as Array<Record<string, unknown>>)[0]).toMatchObject({
      email: "contato@cliente.com"
    });
    expect(readRequestBody(fetchFn, 1)).toMatchObject({ call: "ConsultarCliente" });
    const alter = readRequestBody(fetchFn, 2);
    expect(alter.call).toBe("AlterarCliente");
    const param = (alter.param as Array<Record<string, unknown>>)[0];
    expect(param.codigo_cliente_omie).toBe(42);
    // O bloco volta inteiro: o que estava configurado no OMIE nao pode se perder.
    expect(param.recomendacoes).toEqual({
      codigo_vendedor: 9,
      gerar_boletos: "S",
      email_fatura: "fiscal@cliente.com, financeiro@cliente.com"
    });
  });

  // Chamador que nao gerencia o campo (push de transportadora, versao antiga do desktop):
  // nem consulta, nem altera — o que estiver no OMIE fica como esta.
  it("nao toca no email_fatura quando o cadastro nao informa a aba fiscal", async () => {
    const fetchFn = omieStub({ IncluirCliente: { codigo_cliente_omie: 43 } });
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-sem-fiscal",
      razaoSocial: "Cliente Sem Fiscal",
      email: "contato@cliente.com, comprador@cliente.com"
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // O operador esvaziou a aba Fiscal: quem estava la para de receber a nota.
  it("limpa o email_fatura quando a aba fiscal fica vazia", async () => {
    const fetchFn = omieStub({
      IncluirCliente: { codigo_cliente_omie: 44 },
      ConsultarCliente: {
        recomendacoes: { email_fatura: "fiscal@cliente.com, antigo@cliente.com" }
      },
      AlterarCliente: { ok: true }
    });
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-fiscal-vazio",
      razaoSocial: "Cliente Fiscal Vazio",
      fiscalEmails: ""
    });

    const param = (readRequestBody(fetchFn, 2).param as Array<Record<string, unknown>>)[0];
    expect(param.recomendacoes).toEqual({ email_fatura: "" });
  });

  it("nao gasta um AlterarCliente quando o email_fatura ja esta correto", async () => {
    const fetchFn = omieStub({
      IncluirCliente: { codigo_cliente_omie: 45 },
      ConsultarCliente: {
        recomendacoes: { email_fatura: "fiscal@cliente.com, financeiro@cliente.com" }
      }
    });
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-ja-sincronizado",
      razaoSocial: "Cliente Ja Sincronizado",
      fiscalEmails: "fiscal@cliente.com, financeiro@cliente.com"
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // Destinatario da nota e detalhe do faturamento: nao pode derrubar o cadastro (nem o
  // fechamento que depende dele).
  it("mantem o cadastro quando a gravacao do email_fatura falha", async () => {
    const fetchFn = omieStub({
      IncluirCliente: { codigo_cliente_omie: 46 },
      ConsultarCliente: { faultstring: "ERROR: OMIE indisponivel" }
    });
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    const id = await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-consulta-falha",
      razaoSocial: "Cliente Consulta Falha",
      fiscalEmails: "fiscal@cliente.com, financeiro@cliente.com"
    });

    expect(id).toBe(46);
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
    const body = readRequestBody(fetchFn, 1);
    expect(body.call).toBe("AlterarCliente");
    const param = (body.param as Array<Record<string, unknown>>)[0];
    expect(param.codigo_cliente_omie).toBe(777);
    expect(param).not.toHaveProperty("codigo_cliente_integracao");
  });
});

// O KyberRock e a origem do papel do cadastro: quem e cadastrado como cliente na balanca
// tem que chegar no OMIE marcado "cliente", e quem e cadastrado como transportadora tem
// que chegar marcado "transportadora" — nunca as duas coisas por acidente do transporte.
describe("tag do papel no cadastro enviado ao OMIE", () => {
  it("cria o cliente com a tag cliente e a transportadora com a tag transportadora", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ codigo_cliente_omie: 1 }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-novo",
      razaoSocial: "Cliente Novo",
      cnpjCpf: "12345678000190"
    });
    await pushCarrierToOmie(queue, credentials, {
      localCustomerId: "carrier:novo",
      name: "Transportadora Nova",
      cnpjCpf: "98765432000199"
    });

    const customerParam = (readRequestBody(fetchFn, 0).param as Array<Record<string, unknown>>)[0];
    expect(readRequestBody(fetchFn, 0).call).toBe("IncluirCliente");
    expect(customerParam.tags).toEqual([{ tag: "cliente" }]);

    const carrierParam = (readRequestBody(fetchFn, 1).param as Array<Record<string, unknown>>)[0];
    expect(readRequestBody(fetchFn, 1).call).toBe("IncluirCliente");
    // A transportadora nao pode sair daqui marcada tambem como cliente: no pull seguinte
    // ela voltaria para a lista de clientes da balanca.
    expect(carrierParam.tags).toEqual([{ tag: "transportadora" }]);
  });

  it("garante a tag do papel na alteracao sem apagar as tags que o cadastro ja tem", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ tags: [{ tag: "Fornecedor" }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-existente",
      omieCustomerId: 4242,
      razaoSocial: "Fornecedor Que Tambem Compra"
    });

    expect(readRequestBody(fetchFn, 0)).toMatchObject({ call: "ConsultarCliente" });
    const updateParam = (readRequestBody(fetchFn, 1).param as Array<Record<string, unknown>>)[0];
    expect(updateParam.tags).toEqual([{ tag: "Fornecedor" }, { tag: "cliente" }]);
  });

  it("nao repete a tag do papel que o cadastro ja tem no OMIE", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ tags: [{ tag: "Transportadora" }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({ fetchFn, minDelayMs: 0, sleepFn: async () => undefined });

    await pushCarrierToOmie(queue, credentials, {
      localCustomerId: "carrier:existente",
      omieCustomerId: 909,
      name: "Transportadora Existente"
    });

    const updateParam = (readRequestBody(fetchFn, 1).param as Array<Record<string, unknown>>)[0];
    // Uma so entrada: a tag do papel nao duplica por diferenca de caixa/acento.
    expect(updateParam.tags).toEqual([{ tag: "transportadora" }]);
  });

  it("alterando com o cadastro ilegivel no OMIE, envia ao menos a tag do papel", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ faultstring: "ERROR: Cliente nao encontrado" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const queue = new OmieQueueManager({
      fetchFn,
      minDelayMs: 0,
      maxRetries: 0,
      sleepFn: async () => undefined
    });

    await pushCarrierToOmie(queue, credentials, {
      localCustomerId: "carrier:ilegivel",
      omieCustomerId: 31,
      name: "Transportadora Ilegivel"
    });

    const updateParam = (readRequestBody(fetchFn, 1).param as Array<Record<string, unknown>>)[0];
    expect(updateParam.tags).toEqual([{ tag: "transportadora" }]);
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
