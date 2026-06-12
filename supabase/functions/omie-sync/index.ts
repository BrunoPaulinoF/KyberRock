import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "./_shared/cors.ts";
import { safeEqual, sha256Hex } from "./_shared/crypto.ts";

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";
const PAGE_SIZE = 500;

type OmieAction = "pull_reference_data" | "create_order";

type DeviceRow = {
  id: string;
  company_id: string;
  unit_id: string;
  token_hash: string;
  is_active: boolean;
};

type CompanyRow = {
  id: string;
  is_active: boolean;
  omie_app_key: string | null;
  omie_app_secret: string | null;
};

type OmieCredentials = {
  appKey: string;
  appSecret: string;
};

type OmieCustomer = {
  id: number;
  name: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
};

type OmieProduct = {
  id: number;
  code: string | null;
  description: string;
  unit: string | null;
};

type OmiePaymentTerm = {
  id: number;
  description: string;
};

type CreateOrderPayload = {
  operationType: "invoice" | "internal";
  customerOmieId: number;
  productOmieId?: number;
  serviceDescription?: string;
  quantity: number;
  unitPrice: number;
  issueDate: string;
  idempotencyKey: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => ({})) as {
    deviceId?: string;
    deviceToken?: string;
    action?: OmieAction;
  };

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");
  const action = body.action ?? "pull_reference_data";

  const { data: device, error: deviceError } = await supabase
    .from("device_registrations")
    .select("id, company_id, unit_id, token_hash, is_active")
    .eq("id", deviceId)
    .single();

  if (deviceError || !device?.is_active) {
    return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
  }

  const typedDevice = device as DeviceRow;
  const tokenHash = await sha256Hex(deviceToken);
  if (!safeEqual(tokenHash, typedDevice.token_hash)) {
    return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, is_active, omie_app_key, omie_app_secret")
    .eq("id", typedDevice.company_id)
    .single();

  if (companyError || !company?.is_active) {
    return jsonResponse({ error: "Empresa bloqueada ou inexistente" }, 403);
  }

  const typedCompany = company as CompanyRow;
  if (!typedCompany.omie_app_key || !typedCompany.omie_app_secret) {
    return jsonResponse({ error: "OMIE nao configurado para esta empresa" }, 400);
  }

  const credentials = {
    appKey: typedCompany.omie_app_key,
    appSecret: typedCompany.omie_app_secret
  };

  try {
    if (action === "pull_reference_data") {
      const [customers, products, paymentTerms] = await Promise.all([
        listAllCustomers(credentials),
        listAllProducts(credentials),
        listAllPaymentTerms(credentials)
      ]);

      const checkedAt = new Date().toISOString();
      await supabase
        .from("device_registrations")
        .update({ last_seen_at: checkedAt, updated_at: checkedAt })
        .eq("id", typedDevice.id);

      return jsonResponse({
        ok: true,
        companyId: typedDevice.company_id,
        unitId: typedDevice.unit_id,
        customers,
        products,
        paymentTerms,
        checkedAt
      });
    }

    if (action === "create_order") {
      const payload = body.payload as CreateOrderPayload;
      const orderId = await createOmieOrder(credentials, payload);
      return jsonResponse({ ok: true, orderId });
    }

    return jsonResponse({ error: "Acao OMIE desconhecida" }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Erro OMIE inesperado" }, 400);
  }
});

async function listAllCustomers(credentials: OmieCredentials): Promise<OmieCustomer[]> {
  const all: OmieCustomer[] = [];
  for (let page = 1; ; page++) {
    const response = await callOmie<{ pagina: number; registrosPorPagina: number }, {
      clientesCadastro?: Array<{
        codigoClienteOmie?: number;
        razaoSocial?: string;
        nomeFantasia?: string;
        cnpjCpf?: string;
        email?: string;
        telefone1Ddd?: string;
        telefone1Numero?: string;
      }>;
    }>(credentials, "/geral/clientes/", "ListarClientes", {
      pagina: page,
      registrosPorPagina: PAGE_SIZE
    });

    const items = response.clientesCadastro ?? [];
    for (const item of items) {
      if (!item.codigoClienteOmie || !item.razaoSocial) continue;
      all.push({
        id: item.codigoClienteOmie,
        name: item.razaoSocial,
        tradeName: item.nomeFantasia ?? null,
        document: item.cnpjCpf ?? null,
        email: item.email ?? null,
        phone: item.telefone1Ddd && item.telefone1Numero
          ? `(${item.telefone1Ddd}) ${item.telefone1Numero}`
          : null
      });
    }

    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

async function listAllProducts(credentials: OmieCredentials): Promise<OmieProduct[]> {
  const all: OmieProduct[] = [];
  for (let page = 1; ; page++) {
    const response = await callOmie<{ pagina: number; registrosPorPagina: number }, {
      produtoCadastro?: Array<{
        codigoProdutoOmie?: number;
        descricao?: string;
        codigo?: string;
        unidade?: string;
      }>;
    }>(credentials, "/geral/produtos/", "ListarProdutos", {
      pagina: page,
      registrosPorPagina: PAGE_SIZE
    });

    const items = response.produtoCadastro ?? [];
    for (const item of items) {
      if (!item.codigoProdutoOmie || !item.descricao) continue;
      all.push({
        id: item.codigoProdutoOmie,
        code: item.codigo ?? null,
        description: item.descricao,
        unit: item.unidade ?? null
      });
    }

    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

async function listAllPaymentTerms(credentials: OmieCredentials): Promise<OmiePaymentTerm[]> {
  const all: OmiePaymentTerm[] = [];
  for (let page = 1; ; page++) {
    const response = await callOmie<{ pagina: number; registrosPorPagina: number }, {
      condicoesPagamentoCadastro?: Array<{
        codigoCondicaoPagamentoOmie?: number;
        descricaoCondicaoPagamento?: string;
      }>;
    }>(credentials, "/geral/condicoespgto/", "ListarCondicoesPagamento", {
      pagina: page,
      registrosPorPagina: PAGE_SIZE
    });

    const items = response.condicoesPagamentoCadastro ?? [];
    for (const item of items) {
      if (!item.codigoCondicaoPagamentoOmie || !item.descricaoCondicaoPagamento) continue;
      all.push({
        id: item.codigoCondicaoPagamentoOmie,
        description: item.descricaoCondicaoPagamento
      });
    }

    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

async function createOmieOrder(credentials: OmieCredentials, payload: CreateOrderPayload): Promise<number> {
  if (payload.operationType === "invoice") {
    if (!payload.productOmieId) {
      throw new Error("productOmieId obrigatorio para pedido de venda");
    }
    const response = await callOmie<unknown, {
      codigoPedido?: number;
      codigoPedidoIntegracao?: string;
    }>(credentials, "/produtos/pedido/", "IncluirPedido", {
      codigoPedidoIntegracao: payload.idempotencyKey,
      codigoCliente: payload.customerOmieId,
      dataPrevisao: payload.issueDate,
      itens: [
        {
          codigoProduto: payload.productOmieId,
          quantidade: payload.quantity,
          valorUnitario: payload.unitPrice,
          tipoDesconto: "P",
          desconto: 0
        }
      ],
      departamentos: [{ codigo: "1.01.01", percentual: 100 }],
      informacoesAdicionais: {
        codigoCategoria: "1.01.01",
        codigoContaCorrente: 0
      }
    });
    if (!response.codigoPedido) {
      throw new Error("OMIE nao retornou codigoPedido");
    }
    return response.codigoPedido;
  }

  const total = payload.quantity * payload.unitPrice;
  const response = await callOmie<unknown, {
    codigoOS?: number;
    codigoOSIntegracao?: string;
  }>(credentials, "/servicos/os/", "IncluirOS", {
    codigoOSIntegracao: payload.idempotencyKey,
    codigoCliente: payload.customerOmieId,
    dataPrevisao: payload.issueDate,
    servicos: [
      {
        codigoServico: 1,
        descricaoServico: payload.serviceDescription || "Servico",
        quantidadeHoras: payload.quantity,
        valorTotalServico: total
      }
    ],
    departamentos: [{ codigo: "1.01.01", percentual: 100 }],
    informacoesAdicionais: {
      codigoCategoria: "1.01.01",
      codigoContaCorrente: 0
    }
  });
  if (!response.codigoOS) {
    throw new Error("OMIE nao retornou codigoOS");
  }
  return response.codigoOS;
}

async function callOmie<TParam, TResponse>(
  credentials: OmieCredentials,
  endpoint: string,
  call: string,
  param: TParam
): Promise<TResponse> {
  const response = await fetch(`${OMIE_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      param: [param],
      app_key: credentials.appKey,
      app_secret: credentials.appSecret
    })
  });

  if (!response.ok) {
    throw new Error(`OMIE HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  if (data && typeof data === "object" && "faultstring" in data) {
    throw new Error(String((data as { faultstring?: unknown }).faultstring ?? "Falha OMIE"));
  }

  return data as TResponse;
}
