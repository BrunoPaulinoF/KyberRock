import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

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
  formatOmieInvoiceEmailList,
  formatOmieOrderInvoiceEmailList,
  isOmieApiBlockedError,
  isOmieNotFoundFault,
  OmieHttpError,
  parseOmieRetryDelayMs,
  mergeOmieCustomerTags,
  OMIE_INVOICE_EMAIL_FIELD_MAX_LENGTH,
  OMIE_ORDER_INVOICE_EMAIL_FIELD_MAX_LENGTH,
  pushCustomerToOmieCore,
  syncCustomerInvoiceEmails,
  toOmieIntegrationCode,
  type OmieRequester
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
  "buildCustomerPayload nao inventa tags: na alteracao elas vem do merge com o OMIE",
  () => {
    // O AlterarCliente substitui a lista inteira de tags no OMIE, entao o corpo base nao
    // carrega tag nenhuma — quem monta a lista final e mergeOmieCustomerTags, a partir do
    // que o cadastro tem hoje la mais a tag do papel.
    const alteracao = buildCustomerPayload({
      localCustomerId: "cliente-3",
      razaoSocial: "Cliente Existente",
      omieCustomerId: 987
    });
    assert(!("tags" in alteracao));
  }
);

Deno.test(
  "mergeOmieCustomerTags soma a tag do papel as que o cadastro ja tem no OMIE",
  async () => {
    const queue = {
      request: () => Promise.resolve({ tags: [{ tag: "Fornecedor" }, { tag: "  " }] })
    } as unknown as OmieRequester;

    assertEquals(await mergeOmieCustomerTags(queue, credentials, 42, "cliente"), [
      "Fornecedor",
      "cliente"
    ]);
  }
);

Deno.test(
  "mergeOmieCustomerTags cai na tag do papel quando o OMIE nao devolve o cadastro",
  async () => {
    const queue = {
      request: () => Promise.reject(new Error("ERROR: Cliente nao cadastrado"))
    } as unknown as OmieRequester;

    assertEquals(await mergeOmieCustomerTags(queue, credentials, 42, "transportadora"), [
      "transportadora"
    ]);
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

  // O cadastro do OMIE mostra a mesma lista que o KyberRock tem, em virgula simples.
  // Quem garante a entrega a todos e o `email_fatura` (ver formatOmieInvoiceEmailList).
  assertEquals(payload.email, "fiscal@cliente.com, financeiro@cliente.com");
});

Deno.test("formatOmieInvoiceEmailList normaliza a lista da aba fiscal", () => {
  assertEquals(
    formatOmieInvoiceEmailList("Fiscal@Cliente.com; financeiro@cliente.com , fiscal@cliente.com"),
    "fiscal@cliente.com, financeiro@cliente.com"
  );
  // Aba fiscal vazia -> string vazia, que e o valor que LIMPA o campo no OMIE.
  assertEquals(formatOmieInvoiceEmailList("   "), "");
  assertEquals(formatOmieInvoiceEmailList(undefined), "");
});

Deno.test("formatOmieInvoiceEmailList respeita o limite do email_fatura sem cortar ao meio", () => {
  const emails = Array.from(
    { length: 20 },
    (_unused, index) => `destinatario${index}@empresa.com.br`
  ).join(",");
  const sent = formatOmieInvoiceEmailList(emails);

  assert(sent.length <= OMIE_INVOICE_EMAIL_FIELD_MAX_LENGTH);
  assert(sent.split(", ").every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
});

// O campo do DOCUMENTO (utilizar_emails do pedido / Email.cEnviarPara da OS) nao tem o
// limite de 200 do email_fatura do cadastro: cortar a aba Fiscal ali deixaria
// destinatarios de fora sem necessidade.
Deno.test("formatOmieOrderInvoiceEmailList leva a aba fiscal inteira para o documento", () => {
  const emails = Array.from(
    { length: 20 },
    (_unused, index) => `destinatario${index}@empresa.com.br`
  ).join(",");
  const sent = formatOmieOrderInvoiceEmailList(emails);

  assert(sent.length <= OMIE_ORDER_INVOICE_EMAIL_FIELD_MAX_LENGTH);
  assert(sent.length > OMIE_INVOICE_EMAIL_FIELD_MAX_LENGTH);
  assert(sent.split(", ").every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
  // Mesma normalizacao da aba fiscal: minusculas, virgula simples, sem repetidos.
  assertEquals(
    formatOmieOrderInvoiceEmailList("Fiscal@Cliente.com; fiscal@cliente.com , nota@cliente.com"),
    "fiscal@cliente.com, nota@cliente.com"
  );
  // Sem aba fiscal -> vazio, e o campo nem e enviado no pedido/OS.
  assertEquals(formatOmieOrderInvoiceEmailList("   "), "");
  assertEquals(formatOmieOrderInvoiceEmailList(undefined), "");
});

Deno.test(
  "syncCustomerInvoiceEmails nao consulta o OMIE quando o cadastro nao informa a aba fiscal",
  async () => {
    let calls = 0;
    const queue = new OmieQueueManager({
      fetchFn: async () => {
        calls++;
        return jsonResponse({});
      },
      minDelayMs: 0,
      sleepFn: async () => undefined
    });

    await syncCustomerInvoiceEmails(queue, credentials, 99, undefined);

    assertEquals(calls, 0);
  }
);

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

Deno.test("parseOmieRetryDelayMs le o tempo das duas recusas do OMIE, sem teto", () => {
  // Consumo redundante: "Aguarde N segundos".
  assertEquals(parseOmieRetryDelayMs("Consumo redundante. Aguarde 3 segundos"), 4_000);
  // Bloqueio por consumo indevido: "Tente novamente em N segundos". Nao era lido, e o
  // bloqueio de meia hora chegava a fila como "sem tempo informado".
  assertEquals(
    parseOmieRetryDelayMs("API bloqueada por consumo indevido. Tente novamente em 1797 segundos."),
    1_798_000
  );
  assertEquals(parseOmieRetryDelayMs("erro qualquer"), null);
});

Deno.test("isOmieApiBlockedError reconhece o 425 do OMIE pelo status e pela frase", () => {
  assert(isOmieApiBlockedError(new OmieHttpError("bloqueio", 425, null, null)));
  assert(
    isOmieApiBlockedError(
      new OmieHttpError("bloqueio", 500, "ERROR: API bloqueada por consumo indevido.", null)
    )
  );
  assert(!isOmieApiBlockedError(new OmieHttpError("outra coisa", 500, "OS nao cadastrada", null)));
});

Deno.test(
  "OmieQueueManager para de chamar o OMIE enquanto o bloqueio por consumo indevido durar",
  async () => {
    let callCount = 0;
    const fetchFn: typeof fetch = async () => {
      callCount++;
      return jsonResponse(
        {
          faultstring:
            "ERROR: API bloqueada por consumo indevido. Tente novamente em 1797 segundos."
        },
        { status: 425 }
      );
    };
    let now = 0;
    const sleeps: number[] = [];
    const queue = new OmieQueueManager({
      fetchFn,
      minDelayMs: 0,
      nowFn: () => now,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    const consult = () =>
      queue.request({
        credentials,
        endpoint: "/servicos/os/",
        call: "ConsultarOS",
        param: { nCodOS: 11495303005 }
      });

    await assertRejects(consult);
    // Espera de meia hora nao cabe na passada: uma chamada, sem repeticao e sem dormir.
    assertEquals(callCount, 1);
    assertEquals(sleeps, []);

    // As chamadas seguintes da passada nem saem — era este o volume que virava HTTP 425
    // no log e alimentava o proprio bloqueio.
    await assertRejects(consult);
    await assertRejects(consult);
    assertEquals(callCount, 1);

    // Passado o tempo que o OMIE pediu, a fila volta a perguntar.
    now = 1_798_001;
    await assertRejects(consult);
    assertEquals(callCount, 2);
  }
);

Deno.test("isOmieNotFoundFault casa com a recusa acentuada do OMIE", () => {
  assert(isOmieNotFoundFault("ERROR: OS nao cadastrada para o Codigo [11495303005] !"));
  assert(isOmieNotFoundFault("ERROR: OS n\u00e3o cadastrada para o C\u00f3digo [11495303005] !"));
  assert(!isOmieNotFoundFault("ERROR: API bloqueada por consumo indevido."));
});

/**
 * Observacoes internas do cadastro.
 *
 * O campo era so LIDO do OMIE e nunca enviado: o que a operadora digitava sumia na leitura
 * seguinte do cadastro de referencia — na propria maquina, antes mesmo de chegar as outras.
 * Enviando, ele passa a ser o mesmo em todas as balancas da pedreira.
 */
Deno.test("buildCustomerPayload envia a observacao, e a string vazia limpa o campo", () => {
  const comObservacao = buildCustomerPayload({
    localCustomerId: "cliente-obs",
    razaoSocial: "Cliente Com Observacao",
    observations: "Cliente so carrega de manha."
  });
  assertEquals(comObservacao.observacao, "Cliente so carrega de manha.");

  // String vazia LIMPA no OMIE: o dropEmptyFields descartaria, e sem isso a operadora nao
  // conseguiria apagar o que escreveu.
  const semObservacao = buildCustomerPayload({
    localCustomerId: "cliente-obs-vazia",
    razaoSocial: "Cliente Sem Observacao",
    observations: ""
  });
  assertEquals(semObservacao.observacao, "");

  // Campo ausente (push de transportadora) nao mexe na observacao configurada no OMIE.
  const omitido = buildCustomerPayload({
    localCustomerId: "cliente-obs-ausente",
    razaoSocial: "Cliente Sem Flag"
  });
  assertEquals(omitido.observacao, undefined);
});

// A observacao e um campo de VARIAS LINHAS. O clampOmieText normaliza espaco em branco, o
// que reescreveria o texto da operadora a cada ida e volta ao OMIE.
Deno.test("buildCustomerPayload preserva as quebras de linha da observacao", () => {
  const payload = buildCustomerPayload({
    localCustomerId: "cliente-obs-linhas",
    razaoSocial: "Cliente Multilinha",
    observations: "Portao dos fundos.\nFalar com o Joao.\n\nSo ate as 16h."
  });
  assertEquals(payload.observacao, "Portao dos fundos.\nFalar com o Joao.\n\nSo ate as 16h.");
});
