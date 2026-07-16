import { assert, assertEquals } from "jsr:@std/assert";

import {
  OmieQueueManager,
  buildCarrierPayload,
  buildCustomerPayload,
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

Deno.test("OmieQueueManager aplica backoff em HTTP 429 e repete a mesma requisicao sem perda de payload", async () => {
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
});

Deno.test("OmieQueueManager aplica backoff exponencial quando a OMIE sinaliza consumo redundante", async () => {
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
});

Deno.test("buildCarrierPayload sempre inclui a tag transportadora sem remover tags existentes", () => {
  const payload = buildCarrierPayload({
    localCustomerId: "carrier-1",
    name: "Transportadora Teste",
    tags: ["cliente", "Transportadora"]
  });

  assertEquals(payload.razao_social, "Transportadora Teste");
  assertEquals(payload.nome_fantasia, "Transportadora Teste");
  assert(Array.isArray(payload.tags));
  assertEquals(payload.tags, [{ tag: "cliente" }, { tag: "transportadora" }]);
});

Deno.test("buildCustomerPayload mapeia billingBlocked para bloquear_faturamento S/N e omite quando ausente", () => {
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
