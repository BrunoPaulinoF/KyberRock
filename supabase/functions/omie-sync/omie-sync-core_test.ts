import { assert, assertEquals } from "jsr:@std/assert";

import {
  CUSTOMER_REGISTRATION_FAULT_PREFIX,
  OMIE_EMAIL_FIELD_MAX_LENGTH,
  OmieQueueManager,
  buildCarrierPayload,
  buildCustomerCadastroPayload,
  buildCustomerPayload,
  clampOmieText,
  customerRegistrationFaultMessage,
  extractOmieRequiredFields,
  formatOmieEmailList,
  pushCustomerToOmieCore,
  toOmieIntegrationCode
} from "./omie-sync-core.ts";

const credentials = { appKey: "app_key_teste", appSecret: "app_secret_teste" };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
}

Deno.test(
  "OmieQueueManager aplica backoff em HTTP 429 e repete a mesma requisicao sem perda de payload",
  async () => {
    const sleeps: number[] = [];
    const bodies: Record<string, unknown>[] = [];
    let callCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      callCount++;

      if (callCount === 1) {
        return jsonResponse(
          { faultstring: "Limite de requisicoes OMIE" },
          { status: 429, headers: { "retry-after": "2" } }
        );
      }

      return jsonResponse({ codigo_cliente_omie: 1234 });
    };
    const queue = new OmieQueueManager({
      fetchFn,
      minDelayMs: 0,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    const omieId = await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-rate-limit",
      razaoSocial: "Cliente Rate Limit",
      nomeFantasia: "Cliente RL",
      cnpjCpf: "12345678000190"
    });

    assertEquals(omieId, 1234);
    assertEquals(callCount, 2);
    assertEquals(sleeps, [2_000]);
    assertEquals(bodies[1], bodies[0]);
    assertEquals(bodies[0]?.app_key, credentials.appKey);
    assertEquals(bodies[0]?.app_secret, credentials.appSecret);
  }
);

Deno.test(
  "OmieQueueManager aplica backoff exponencial quando a OMIE sinaliza consumo redundante",
  async () => {
    const sleeps: number[] = [];
    let callCount = 0;
    const fetchFn: typeof fetch = async () => {
      callCount++;

      if (callCount === 1) {
        return jsonResponse({ faultstring: "Consumo redundante. Aguarde 3 segundos" });
      }

      if (callCount === 2) {
        return jsonResponse({ faultstring: "Consumo redundante" });
      }

      return jsonResponse({ codigo_cliente_omie: 5678 });
    };
    const queue = new OmieQueueManager({
      fetchFn,
      minDelayMs: 0,
      baseBackoffMs: 5_000,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    await pushCustomerToOmieCore(queue, credentials, {
      localCustomerId: "cliente-backoff",
      razaoSocial: "Cliente Backoff"
    });

    assertEquals(callCount, 3);
    assertEquals(sleeps, [4_000, 10_000]);
  }
);

Deno.test(
  "buildCarrierPayload sempre inclui a tag transportadora sem remover tags existentes",
  () => {
    const payload = buildCarrierPayload({
      localCustomerId: "carrier-1",
      name: "Transportadora Teste",
      tags: ["cliente", "Transportadora"]
    });

    assertEquals(payload.razao_social, "Transportadora Teste");
    assertEquals(payload.nome_fantasia, "Transportadora Teste");
    assert(Array.isArray(payload.tags));
    assertEquals(payload.tags, [{ tag: "cliente" }, { tag: "transportadora" }]);
  }
);

Deno.test(
  "buildCustomerCadastroPayload sempre inclui a tag cliente sem remover as existentes",
  () => {
    const novo = buildCustomerCadastroPayload({
      localCustomerId: "cliente-1",
      razaoSocial: "Cliente Teste Ltda"
    });
    assertEquals(novo.tags, [{ tag: "cliente" }]);

    const jaMarcado = buildCustomerCadastroPayload({
      localCustomerId: "cliente-2",
      razaoSocial: "Cliente e Transportadora",
      tags: ["Transportadora", "Cliente"]
    });
    // A tag do papel entra normalizada, e as demais do cadastro seguem intactas.
    assertEquals(jaMarcado.tags, [{ tag: "Transportadora" }, { tag: "cliente" }]);
  }
);

Deno.test(
  "buildCustomerCadastroPayload marca o cadastro novo, mas a alteracao vai sem tags",
  () => {
    // O AlterarCliente substitui a lista inteira de tags no OMIE: mandar so "cliente"
    // apagaria "transportadora"/"fornecedor" do cadastro.
    const alteracao = buildCustomerPayload({
      localCustomerId: "cliente-3",
      razaoSocial: "Cliente Existente",
      omieCustomerId: 987
    });
    assert(!("tags" in alteracao));
  }
);

Deno.test(
  "buildCustomerPayload mapeia billingBlocked para bloquear_faturamento S/N e omite quando ausente",
  () => {
    const blocked = buildCustomerPayload({
      localCustomerId: "cliente-1",
      razaoSocial: "Cliente Bloqueado",
      billingBlocked: true
    });
    assertEquals(blocked.bloquear_faturamento, "S");

    const released = buildCustomerPayload({
      localCustomerId: "cliente-2",
      razaoSocial: "Cliente Liberado",
      billingBlocked: false
    });
    assertEquals(released.bloquear_faturamento, "N");

    // Sem o campo (ex.: push de transportadora), nao mexe no bloqueio configurado no OMIE.
    const omitted = buildCustomerPayload({
      localCustomerId: "cliente-3",
      razaoSocial: "Cliente Sem Flag"
    });
    assertEquals(omitted.bloquear_faturamento, undefined);
  }
);

Deno.test("buildCustomerPayload envia todos os e-mails do cliente no campo do OMIE", () => {
  const payload = buildCustomerPayload({
    localCustomerId: "cliente-emails",
    razaoSocial: "Cliente Multi E-mail",
    email: "Fiscal@Cliente.com; financeiro@cliente.com , fiscal@cliente.com"
  });

  // Virgula simples e o separador que o OMIE usa para mandar NF-e/boleto a todos.
  assertEquals(payload.email, "fiscal@cliente.com, financeiro@cliente.com");
});

Deno.test("formatOmieEmailList respeita o limite do campo sem cortar um e-mail ao meio", () => {
  const emails = Array.from(
    { length: 40 },
    (_unused, index) => `destinatario${index}@empresa.com.br`
  ).join(",");
  const sent = formatOmieEmailList(emails) ?? "";

  assert(sent.length <= OMIE_EMAIL_FIELD_MAX_LENGTH);
  assert(sent.split(", ").every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
  assertEquals(formatOmieEmailList("   "), undefined);
});

Deno.test("buildCustomerPayload completa o cadastro que o OMIE exige no IncluirCliente", () => {
  const pessoaFisica = buildCustomerPayload({
    localCustomerId: "cliente-cpf",
    razaoSocial: "  Joao da Silva  ",
    cnpjCpf: "123.456.789-09",
    city: "Sao Paulo",
    state: "sp"
  });

  // CPF sem pessoa_fisica "S" e recusado pelo OMIE como CNPJ invalido.
  assertEquals(pessoaFisica.pessoa_fisica, "S");
  assertEquals(pessoaFisica.cnpj_cpf, "12345678909");
  assertEquals(pessoaFisica.razao_social, "Joao da Silva");
  // O OMIE exige nome fantasia; sem valor proprio ele repete a razao social.
  assertEquals(pessoaFisica.nome_fantasia, "Joao da Silva");
  // A cidade vai no formato do OMIE ("Cidade (UF)").
  assertEquals(pessoaFisica.cidade, "Sao Paulo (SP)");
  assertEquals(pessoaFisica.estado, "SP");

  const pessoaJuridica = buildCustomerPayload({
    localCustomerId: "cliente-cnpj",
    razaoSocial: "Pedreira LTDA",
    nomeFantasia: "Pedreira",
    cnpjCpf: "12.345.678/0001-90",
    city: "Campinas (SP)",
    state: "SP",
    email: "   "
  });

  assertEquals(pessoaJuridica.pessoa_fisica, "N");
  assertEquals(pessoaJuridica.cnpj_cpf, "12345678000190");
  // Cidade ja formatada nao ganha a UF duas vezes.
  assertEquals(pessoaJuridica.cidade, "Campinas (SP)");
  // Campo em branco fica de fora: string vazia apagaria o dado no AlterarCliente.
  assert(!("email" in pessoaJuridica));
  assert(!("tags" in pessoaJuridica));
});

Deno.test("customerRegistrationFaultMessage diz qual campo do cliente falta preencher", () => {
  const fault = new Error(
    "OMIE HTTP 500 em IncluirCliente (/geral/clientes/) - ERROR: O preenchimento da tag [email] e obrigatorio!"
  );

  assertEquals(extractOmieRequiredFields(fault.message), ["E-mail"]);

  const message = customerRegistrationFaultMessage(fault, "Pedreira LTDA");
  assert(message.startsWith(CUSTOMER_REGISTRATION_FAULT_PREFIX));
  assert(message.includes("Pedreira LTDA"));
  assert(message.includes("Falta preencher: E-mail."));
  assert(message.includes("Detalhe OMIE:"));
});

// Golden test: mudar este algoritmo altera o codigo_pedido_integracao de jobs antigos
// re-enviados e DUPLICA pedidos no OMIE. Se este teste quebrar, foi mudanca proposital e
// exige migracao dos codigos de integracao ja em transito.
Deno.test("toOmieIntegrationCode e estavel para os formatos de chave do desktop", () => {
  // Chave curta alfanumerica: usada como esta.
  assertEquals(toOmieIntegrationCode("KR20250101ABCDEF"), "KR20250101ABCDEF");
  // Chave longa com ':' (kyberrock:unit:op:action): hasheada de forma deterministica.
  const hashed = toOmieIntegrationCode("kyberrock:unit-1:op-1:create_sales_order");
  assertEquals(hashed, toOmieIntegrationCode("kyberrock:unit-1:op-1:create_sales_order"));
  assert(hashed.startsWith("KR"));
  assert(hashed.length <= 20);
});

Deno.test("buildCustomerPayload encurta a razao social para o limite do OMIE", () => {
  // Razao social acima de 60: o OMIE recusa a chamada INTEIRA e o fechamento morria
  // junto ("a razao social ultrapassa 60 caracteres").
  const longa = "LOGI TRANSPORTES E LOGISTICA INTEGRADA DO BRASIL LTDA - FILIAL SAO PAULO";
  assertEquals(longa.length, 72);

  const payload = buildCustomerPayload({
    localCustomerId: "cliente-logi",
    razaoSocial: longa,
    cnpjCpf: "12.345.678/0001-90"
  });

  const razaoSocial = payload.razao_social as string;
  assert(razaoSocial.length <= 60);
  // Corta na palavra inteira e limpa a pontuacao que sobra na ponta.
  assertEquals(razaoSocial, "LOGI TRANSPORTES E LOGISTICA INTEGRADA DO BRASIL LTDA");
  // Sem fantasia proprio, o fallback herda a razao social ja encurtada.
  assertEquals(payload.nome_fantasia, razaoSocial);
  // O documento nunca e cortado: um CNPJ encurtado seria um documento errado no OMIE.
  assertEquals(payload.cnpj_cpf, "12345678000190");
});

Deno.test("clampOmieText e deterministico e preserva o que ja cabe", () => {
  assertEquals(clampOmieText("Pedreira LTDA", 60), "Pedreira LTDA");
  assertEquals(clampOmieText("  Pedreira   LTDA  ", 60), "Pedreira LTDA");
  assertEquals(clampOmieText("   ", 60), undefined);
  assertEquals(clampOmieText(undefined, 60), undefined);

  // Palavra unica maior que o limite: corte seco, sem sobrar quase nada.
  assertEquals(clampOmieText("A".repeat(80), 60), "A".repeat(60));

  // Reenvio do mesmo cadastro gera o mesmo valor (idempotencia no OMIE).
  const nome = "TRANSPORTADORA UNIAO DO NORTE E NORDESTE DISTRIBUIDORA LTDA ME";
  assertEquals(clampOmieText(nome, 60), clampOmieText(nome, 60));
  assert((clampOmieText(nome, 60) ?? "").length <= 60);
});

Deno.test("buildCustomerPayload mantem a UF da cidade dentro do limite do campo", () => {
  const payload = buildCustomerPayload({
    localCustomerId: "cliente-cidade",
    razaoSocial: "Cliente Teste",
    city: "Sao Miguel do Oeste",
    state: "sc"
  });

  // Sem o "(UF)" o OMIE responde "Cidade nao encontrada": o corte cai no nome, nunca
  // no sufixo.
  assertEquals(payload.cidade, "Sao Miguel do Oeste (SC)");

  const longa = buildCustomerPayload({
    localCustomerId: "cliente-cidade-longa",
    razaoSocial: "Cliente Teste",
    city: "A".repeat(60),
    state: "SP"
  });
  const cidade = longa.cidade as string;
  assert(cidade.length <= 40);
  assert(cidade.endsWith(" (SP)"));
});
