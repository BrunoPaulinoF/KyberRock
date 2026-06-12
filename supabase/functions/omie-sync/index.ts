import { createClient } from "jsr:@supabase/supabase-js@2";

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";
const PAGE_SIZE = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-session",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

type OmieAction = "pull_reference_data" | "create_order" | "push_customer";

type PullResume = {
  customersPage?: number;
  productsPage?: number;
  paymentTermsPage?: number;
};

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
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  defaultPaymentTermId: string | null;
};

type OmieProduct = {
  id: number;
  code: string | null;
  description: string;
  unit: string | null;
  ncm: string | null;
  ean: string | null;
  unitPriceCents: number | null;
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

type PushCustomerPayload = {
  localCustomerId: string;
  omieCustomerId?: number;
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjCpf?: string;
  email?: string;
  telefone1Ddd?: string;
  telefone1Numero?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  defaultPaymentTermId?: string;
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
    payload?: unknown;
    resume?: PullResume;
  };

  const deviceId = String(body.deviceId ?? "");
  const deviceToken = String(body.deviceToken ?? "");
  const action = body.action ?? "pull_reference_data";
  const resume = body.resume ?? {};

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
      const [customers, products] = await Promise.all([
        listAllCustomers(credentials, resume.customersPage ?? 1),
        listAllProducts(credentials, resume.productsPage ?? 1)
      ]);
      let paymentTerms: OmiePaymentTerm[] = [];
      let paymentTermsWarning: string | null = null;
      try {
        paymentTerms = await listAllPaymentTerms(credentials, resume.paymentTermsPage ?? 1);
      } catch (error) {
        paymentTermsWarning = error instanceof Error ? error.message : "Falha ao listar parcelas OMIE";
      }

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
        ...(paymentTermsWarning ? { paymentTermsWarning } : {}),
        checkedAt,
        pageSize: PAGE_SIZE,
        pagination: {
          customersPage: resume.customersPage ?? 1,
          productsPage: resume.productsPage ?? 1,
          paymentTermsPage: resume.paymentTermsPage ?? 1,
          customersReturned: customers.length,
          productsReturned: products.length,
          paymentTermsReturned: paymentTerms.length
        }
      });
    }

    if (action === "create_order") {
      const payload = body.payload as CreateOrderPayload;
      const orderId = await createOmieOrder(credentials, payload);
      return jsonResponse({ ok: true, orderId });
    }

    if (action === "push_customer") {
      const payload = body.payload as PushCustomerPayload;
      const omieCustomerId = await pushCustomerToOmie(credentials, payload);
      return jsonResponse({ ok: true, omieCustomerId });
    }

    return jsonResponse({ error: "Acao OMIE desconhecida" }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Erro OMIE inesperado" }, 400);
  }
});

async function listAllCustomers(credentials: OmieCredentials, startPage = 1): Promise<OmieCustomer[]> {
  const all: OmieCustomer[] = [];
  for (let page = startPage; ; page++) {
    const response = await callOmie<{
      pagina: number;
      registros_por_pagina: number;
      apenas_importado_api: string;
    }, {
      clientes_cadastro?: Array<{
        codigo_cliente_omie?: number;
        razao_social?: string;
        nome_fantasia?: string;
        cnpj_cpf?: string;
        email?: string;
        telefone1_ddd?: string;
        telefone1_numero?: string;
        endereco?: string;
        endereco_numero?: string;
        bairro?: string;
        cidade?: string;
        estado?: string;
        cep?: string;
      }>;
      clientesCadastro?: Array<{
        codigoClienteOmie?: number;
        razaoSocial?: string;
        nomeFantasia?: string;
        cnpjCpf?: string;
        email?: string;
        telefone1Ddd?: string;
        telefone1Numero?: string;
        endereco?: string;
        enderecoNumero?: string;
        bairro?: string;
        cidade?: string;
        estado?: string;
        cep?: string;
      }>;
    }>(credentials, "/geral/clientes/", "ListarClientes", {
      pagina: page,
      registros_por_pagina: PAGE_SIZE
    });

    const items = response.clientes_cadastro ?? response.clientesCadastro ?? [];
    for (const item of items) {
      const id = "codigo_cliente_omie" in item ? item.codigo_cliente_omie : item.codigoClienteOmie;
      const name = "razao_social" in item ? item.razao_social : item.razaoSocial;
      if (!id || !name) continue;
      const tradeName = "nome_fantasia" in item ? item.nome_fantasia : item.nomeFantasia;
      const document = "cnpj_cpf" in item ? item.cnpj_cpf : item.cnpjCpf;
      const phoneDdd = "telefone1_ddd" in item ? item.telefone1_ddd : item.telefone1Ddd;
      const phoneNumber = "telefone1_numero" in item ? item.telefone1_numero : item.telefone1Numero;
      const street = "endereco" in item ? item.endereco : item.endereco;
      const number = "endereco_numero" in item ? item.endereco_numero : item.enderecoNumero;
      const neighborhood = "bairro" in item ? item.bairro : item.bairro;
      const city = "cidade" in item ? item.cidade : item.cidade;
      const state = "estado" in item ? item.estado : item.estado;
      const zipcode = "cep" in item ? item.cep : item.cep;
      all.push({
        id,
        name,
        tradeName: tradeName ?? null,
        document: document ?? null,
        email: item.email ?? null,
        phone: phoneDdd && phoneNumber
          ? `(${phoneDdd}) ${phoneNumber}`
          : null,
        addressStreet: street ?? null,
        addressNumber: number ?? null,
        neighborhood: neighborhood ?? null,
        city: city ?? null,
        state: state ?? null,
        zipcode: zipcode ?? null,
        defaultPaymentTermId: null
      });
    }

    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

async function listAllProducts(credentials: OmieCredentials, startPage = 1): Promise<OmieProduct[]> {
  const all: OmieProduct[] = [];
  for (let page = startPage; ; page++) {
    const response = await callOmie<{ pagina: number; registros_por_pagina: number; apenas_importado_api: string }, {
      produto_servico_cadastro?: Array<{
        codigo_produto?: number | string;
        codigo?: string;
        descricao?: string;
        unidade?: string;
        ncm?: string;
        ean?: string;
        valor_unitario?: number;
      }>;
      produtoCadastro?: Array<{
        codigoProdutoOmie?: number | string;
        descricao?: string;
        codigo?: string;
        unidade?: string;
        ncm?: string;
        ean?: string;
        valorUnitario?: number;
      }>;
    }>(credentials, "/geral/produtos/", "ListarProdutos", {
      pagina: page,
      registros_por_pagina: PAGE_SIZE
    });

    const items = response.produto_servico_cadastro ?? response.produtoCadastro ?? [];
    for (const item of items) {
      const id = "codigo_produto" in item ? item.codigo_produto : item.codigoProdutoOmie;
      if (!id || !item.descricao) continue;
      const productId = Number(id);
      if (!Number.isFinite(productId)) continue;
      const unitPrice = "valor_unitario" in item ? item.valor_unitario : item.valorUnitario;
      const unitPriceCents = typeof unitPrice === "number" && Number.isFinite(unitPrice)
        ? Math.round(unitPrice * 100)
        : null;
      all.push({
        id: productId,
        code: item.codigo ?? null,
        description: item.descricao,
        unit: item.unidade ?? null,
        ncm: item.ncm ?? null,
        ean: item.ean ?? null,
        unitPriceCents
      });
    }

    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

async function listAllPaymentTerms(credentials: OmieCredentials, startPage = 1): Promise<OmiePaymentTerm[]> {
  const all: OmiePaymentTerm[] = [];
  for (let page = startPage; ; page++) {
    const response = await callOmie<{ pagina: number; registros_por_pagina: number }, {
      cadastros?: Array<{
        nCodigo?: number | string;
        cDescricao?: string;
      }>;
      parcelasCadastro?: Array<{
        codigo?: number | string;
        codigoParcela?: number | string;
        descricao?: string;
        descricaoParcela?: string;
      }>;
      listaParcelas?: Array<{
        codigo?: number | string;
        codigoParcela?: number | string;
        descricao?: string;
        descricaoParcela?: string;
      }>;
    }>(credentials, "/geral/parcelas/", "ListarParcelas", {
      pagina: page,
      registros_por_pagina: PAGE_SIZE
    });

    const items = response.cadastros ?? response.parcelasCadastro ?? response.listaParcelas ?? [];
    for (const item of items) {
      const code = "nCodigo" in item ? item.nCodigo : item.codigoParcela ?? item.codigo;
      const description = "cDescricao" in item ? item.cDescricao : item.descricaoParcela ?? item.descricao;
      if (!code || !description) continue;
      const id = Number(code);
      if (!Number.isFinite(id)) continue;
      all.push({
        id,
        description
      });
    }

    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

async function pushCustomerToOmie(credentials: OmieCredentials, payload: PushCustomerPayload): Promise<number> {
  const body = {
    codigo_cliente_omie: payload.omieCustomerId,
    codigo_cliente_integracao: payload.localCustomerId,
    razao_social: payload.razaoSocial,
    nome_fantasia: payload.nomeFantasia,
    cnpj_cpf: payload.cnpjCpf,
    email: payload.email,
    telefone1_ddd: payload.telefone1Ddd,
    telefone1_numero: payload.telefone1Numero,
    endereco: payload.addressStreet,
    endereco_numero: payload.addressNumber,
    bairro: payload.neighborhood,
    cidade: payload.city,
    estado: payload.state,
    cep: payload.zipcode
  };

  if (payload.omieCustomerId) {
    await callOmie<unknown, unknown>(credentials, "/geral/clientes/", "AlterarCliente", body);
    return payload.omieCustomerId;
  }

  const response = await callOmie<unknown, {
    codigo_cliente_omie?: number;
    codigoClienteOmie?: number;
  }>(credentials, "/geral/clientes/", "IncluirCliente", body);

  const omieCustomerId = response.codigo_cliente_omie ?? response.codigoClienteOmie;
  if (!omieCustomerId) {
    throw new Error("OMIE nao retornou codigoClienteOmie");
  }
  return omieCustomerId;
}

async function createOmieOrder(credentials: OmieCredentials, payload: CreateOrderPayload): Promise<number> {
  if (payload.operationType === "invoice") {
    if (!payload.productOmieId) {
      throw new Error("productOmieId obrigatorio para pedido de venda");
    }
    const response = await callOmie<unknown, {
      codigo_pedido?: number;
      codigoPedido?: number;
      codigo_pedido_integracao?: string;
      codigoPedidoIntegracao?: string;
    }>(credentials, "/produtos/pedido/", "IncluirPedido", {
      cabecalho: {
        codigo_pedido_integracao: payload.idempotencyKey,
        codigo_cliente: payload.customerOmieId,
        data_previsao: toOmieDate(payload.issueDate),
        etapa: "10",
        codigo_parcela: "000",
        quantidade_itens: 1
      },
      det: [
        {
          ide: { codigo_item_integracao: `${payload.idempotencyKey}:1` },
          produto: {
            codigo_produto: payload.productOmieId,
            quantidade: payload.quantity,
            valor_unitario: payload.unitPrice,
            tipo_desconto: "P",
            percentual_desconto: 0
          }
        }
      ],
      frete: { modalidade: "9" },
      informacoes_adicionais: { codigo_categoria: "1.01.01", codigo_conta_corrente: 0 }
    });
    const orderId = response.codigo_pedido ?? response.codigoPedido;
    if (!orderId) {
      throw new Error("OMIE nao retornou codigoPedido");
    }
    return orderId;
  }

  const response = await callOmie<unknown, {
    nCodOS?: number;
    codigoOS?: number;
    cCodIntOS?: string;
    codigoOSIntegracao?: string;
  }>(credentials, "/servicos/os/", "IncluirOS", {
    Cabecalho: {
      cCodIntOS: payload.idempotencyKey,
      nCodCli: payload.customerOmieId,
      dDtPrevisao: toOmieDate(payload.issueDate),
      cEtapa: "10",
      cCodParc: "000",
      nQtdeParc: 1
    },
    ServicosPrestados: [
      {
        cDescServ: payload.serviceDescription || "Servico",
        nQtde: payload.quantity,
        nValUnit: payload.unitPrice
      }
    ],
    InformacoesAdicionais: { cCodCateg: "1.01.01", nCodCC: 0 }
  });
  const orderId = response.nCodOS ?? response.codigoOS;
  if (!orderId) {
    throw new Error("OMIE nao retornou codigoOS");
  }
  return orderId;
}

function toOmieDate(value: string): string {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  return value;
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
    let detail = "";
    try {
      const body = await response.json();
      if (body && typeof body === "object" && "faultstring" in body) {
        detail = String((body as { faultstring?: unknown }).faultstring ?? "");
      } else if (typeof body === "string") {
        detail = body;
      }
    } catch {
      // ignore body parse errors
    }
    const suffix = detail ? ` - ${detail}` : "";
    throw new Error(`OMIE HTTP ${response.status}: ${response.statusText} em ${call} (${endpoint})${suffix}`);
  }

  const data = await response.json();
  if (data && typeof data === "object" && "faultstring" in data) {
    const detail = String((data as { faultstring?: unknown }).faultstring ?? "Falha OMIE");
    throw new Error(`OMIE faultstring em ${call} (${endpoint}): ${detail}`);
  }

  return data as TResponse;
}
