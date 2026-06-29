import { createClient } from "jsr:@supabase/supabase-js@2";

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";
const PAGE_SIZE = 100;
const OMIE_REQUEST_DELAY_MS = 3_000;
const OMIE_REDUNDANT_MAX_RETRIES = 2;
const OMIE_REDUNDANT_DEFAULT_WAIT_MS = 60_000;
const OMIE_REDUNDANT_MAX_WAIT_MS = 65_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session",
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

type OmieAction =
  | "pull_reference_data"
  | "create_order"
  | "create_and_bill_order"
  | "push_customer";

type PullResume = {
  customersPage?: number;
  productsPage?: number;
  paymentTermsPage?: number;
  customersFinished?: boolean;
  productsFinished?: boolean;
  paymentTermsFinished?: boolean;
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
  integrationCode: string | null;
  name: string;
  tradeName: string | null;
  document: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  isIndividual: boolean;
  email: string | null;
  homepage: string | null;
  contactName: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  ibgeCityCode: string | null;
  ibgeStateCode: string | null;
  customerType: string | null;
  isForeign: boolean;
  billingBlocked: boolean;
  isActive: boolean;
  observations: string | null;
  tagsJson: Record<string, unknown> | unknown[] | null;
  salespersonId: number | null;
  defaultPaymentTermId: string | null;
};

type OmieProduct = {
  id: number;
  code: string | null;
  integrationCode: string | null;
  description: string;
  detailedDescription: string | null;
  unit: string | null;
  ncm: string | null;
  ean: string | null;
  unitPriceCents: number | null;
  familyCode: string | null;
  familyDescription: string | null;
  brand: string | null;
  model: string | null;
  internalNotes: string | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  heightM: number | null;
  widthM: number | null;
  depthM: number | null;
  cest: string | null;
  itemType: string | null;
  icmsOrigin: string | null;
  isActive: boolean;
  blocked: boolean;
  tracksStock: boolean;
  fiscalRecommendations: Record<string, unknown> | null;
};

type OmiePaymentTerm = {
  id: number;
  integrationCode: string | null;
  description: string;
  firstInstallmentDays: number | null;
  installmentIntervalDays: number | null;
  installmentCount: number | null;
  installmentType: string | null;
  installmentDaysJson: number[] | null;
  isActive: boolean;
  visible: boolean;
};

type OmieSupplier = {
  id: number;
  integrationCode: string | null;
  name: string;
  tradeName: string | null;
  document: string | null;
  phone: string | null;
  email: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  tagsJson: Record<string, unknown> | unknown[] | null;
};

type CreateOrderPayload = {
  operationType: "invoice" | "internal";
  customerOmieId: number;
  productOmieId?: number;
  serviceDescription?: string;
  quantity: number;
  unitPrice: number;
  freightTotalCents?: number;
  issueDate: string;
  idempotencyKey: string;
};

type CreateAndBillOrderResult = {
  orderId: number;
  billed: boolean;
  billingStatusCode: string | null;
  billingStatusMessage: string | null;
  documentUrl: string | null;
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
  const body = (await req.json().catch(() => ({}))) as {
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
      const customersPage = resume.customersPage ?? 1;
      const productsPage = resume.productsPage ?? 1;
      const paymentTermsPage = resume.paymentTermsPage ?? 1;
      const customersResult = resume.customersFinished
        ? emptyCustomerPage(customersPage)
        : await listCustomersPage(credentials, customersPage);
      const productsResult = resume.productsFinished
        ? emptyPage<OmieProduct>(productsPage)
        : await listProductsPage(credentials, productsPage);
      let paymentTermsResult: PageResult<OmiePaymentTerm> = {
        items: [],
        page: paymentTermsPage,
        finished: true,
        totalPages: null,
        totalRecords: null
      };
      let paymentTermsWarning: string | null = null;
      if (!resume.paymentTermsFinished) {
        try {
          paymentTermsResult = await listPaymentTermsPage(credentials, paymentTermsPage);
        } catch (error) {
          paymentTermsWarning =
            error instanceof Error ? error.message : "Falha ao listar parcelas OMIE";
        }
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
        customers: customersResult.items,
        products: productsResult.items,
        paymentTerms: paymentTermsResult.items,
        suppliers: customersResult.carriers,
        ...(paymentTermsWarning ? { paymentTermsWarning } : {}),
        checkedAt,
        pageSize: PAGE_SIZE,
        pagination: {
          customersPage: customersResult.page,
          customersReturned: customersResult.returned,
          customersFinished: customersResult.finished,
          customersTotalPages: customersResult.totalPages,
          customersTotalRecords: customersResult.totalRecords,
          productsPage: productsResult.page,
          productsReturned: productsResult.items.length,
          productsFinished: productsResult.finished,
          productsTotalPages: productsResult.totalPages,
          productsTotalRecords: productsResult.totalRecords,
          paymentTermsPage: paymentTermsResult.page,
          paymentTermsReturned: paymentTermsResult.items.length,
          paymentTermsFinished: paymentTermsResult.finished,
          paymentTermsTotalPages: paymentTermsResult.totalPages,
          paymentTermsTotalRecords: paymentTermsResult.totalRecords,
          suppliersPage: customersResult.page,
          suppliersReturned: customersResult.returned,
          suppliersFinished: customersResult.finished,
          suppliersTotalPages: customersResult.totalPages,
          suppliersTotalRecords: customersResult.totalRecords
        }
      });
    }

    if (action === "create_order") {
      const payload = body.payload as CreateOrderPayload;
      const orderId = await createOmieOrder(credentials, payload);
      return jsonResponse({ ok: true, orderId });
    }

    if (action === "create_and_bill_order") {
      const payload = body.payload as CreateOrderPayload;
      const result = await createAndBillOmieOrder(credentials, payload);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === "push_customer") {
      const payload = body.payload as PushCustomerPayload;
      const omieCustomerId = await pushCustomerToOmie(credentials, payload);
      return jsonResponse({ ok: true, omieCustomerId });
    }

    return jsonResponse({ error: "Acao OMIE desconhecida" }, 400);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro OMIE inesperado" },
      400
    );
  }
});

type PageResult<T> = {
  items: T[];
  page: number;
  finished: boolean;
  totalPages: number | null;
  totalRecords: number | null;
};

type CustomersPageResult = PageResult<OmieCustomer> & {
  carriers: OmieSupplier[];
  returned: number;
};

function emptyPage<T>(page: number): PageResult<T> {
  return { items: [], page, finished: true, totalPages: null, totalRecords: null };
}

function emptyCustomerPage(page: number): CustomersPageResult {
  return { ...emptyPage<OmieCustomer>(page), carriers: [], returned: 0 };
}

const OMIE_PAGE_CACHE_TTL_MS = 60_000;
const omiePageCache = new Map<
  string,
  {
    data: {
      items: unknown[];
      finished: boolean;
      totalPages: number | null;
      totalRecords: number | null;
      returned: number;
    };
    expiresAt: number;
  }
>();

function getCachedPage<T>(key: string): {
  items: T[];
  finished: boolean;
  totalPages: number | null;
  totalRecords: number | null;
  returned: number;
} | null {
  const entry = omiePageCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    omiePageCache.delete(key);
    return null;
  }
  return {
    items: entry.data.items as T[],
    finished: entry.data.finished,
    totalPages: entry.data.totalPages,
    totalRecords: entry.data.totalRecords,
    returned: entry.data.returned
  };
}

function setCachedPage(
  key: string,
  items: unknown[],
  finished: boolean,
  totalPages: number | null,
  totalRecords: number | null,
  returned = items.length
): void {
  omiePageCache.set(key, {
    data: { items, finished, totalPages, totalRecords, returned },
    expiresAt: Date.now() + OMIE_PAGE_CACHE_TTL_MS
  });
}

async function listCustomersPage(
  credentials: OmieCredentials,
  page: number
): Promise<CustomersPageResult> {
  const cacheKey = `clientes:${credentials.appKey}:${page}`;
  const cached = getCachedPage<OmieCustomer>(cacheKey);
  if (cached) {
    return {
      items: cached.items.filter(hasClienteTag),
      carriers: cached.items.filter(hasTransportadoraTag).map(mapCustomerToCarrier),
      returned: cached.returned,
      page,
      finished: cached.finished,
      totalPages: cached.totalPages,
      totalRecords: cached.totalRecords
    };
  }

  const response = await callOmie<
    {
      pagina: number;
      registros_por_pagina: number;
      apenas_importado_api: string;
    },
    {
      pagina?: number;
      total_de_paginas?: number;
      registros?: number;
      total_de_registros?: number;
      clientes_cadastro?: OmieCustomerRaw[];
      clientesCadastro?: OmieCustomerRaw[];
    }
  >(credentials, "/geral/clientes/", "ListarClientes", {
    pagina: page,
    registros_por_pagina: PAGE_SIZE,
    apenas_importado_api: "N"
  });

  const rawItems = response.clientes_cadastro ?? response.clientesCadastro ?? [];
  const items: OmieCustomer[] = [];
  for (const item of rawItems) {
    const customer = mapOmieCustomerRaw(item);
    if (customer) items.push(customer);
  }

  const totalPages = toIntOrNull(response.total_de_paginas);
  const totalRecords = toIntOrNull(response.total_de_registros);
  const finished = computeFinished(page, rawItems.length, totalPages);

  setCachedPage(cacheKey, items, finished, totalPages, totalRecords, rawItems.length);
  return {
    items: items.filter(hasClienteTag),
    carriers: items.filter(hasTransportadoraTag).map(mapCustomerToCarrier),
    returned: rawItems.length,
    page,
    finished,
    totalPages,
    totalRecords
  };
}

type OmieCustomerRaw = {
  codigo_cliente_omie?: number | string;
  codigoClienteOmie?: number | string;
  codigo_cliente_integracao?: string;
  codigoClienteIntegracao?: string;
  razao_social?: string;
  razaoSocial?: string;
  nome_fantasia?: string;
  nomeFantasia?: string;
  cnpj_cpf?: string;
  cnpjCpf?: string;
  inscricao_estadual?: string;
  inscricaoEstadual?: string;
  inscricao_municipal?: string;
  inscricaoMunicipal?: string;
  pessoa_fisica?: string;
  pessoaFisica?: string;
  email?: string;
  homepage?: string;
  contato?: string;
  endereco?: string;
  endereco_numero?: string;
  enderecoNumero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  cidade_ibge?: string;
  cidadeIbge?: string;
  estado_ibge?: string;
  estadoIbge?: string;
  pais?: string;
  codigo_pais?: string;
  codigoPais?: string;
  telefone1_ddd?: string;
  telefone1Ddd?: string;
  telefone1_numero?: string;
  telefone1Numero?: string;
  telefone2_ddd?: string;
  telefone2Ddd?: string;
  telefone2_numero?: string;
  telefone2Numero?: string;
  cliente_fornecedor?: string;
  clienteFornecedor?: string;
  inativo?: string;
  bloquear_faturamento?: string;
  bloquearFaturamento?: string;
  exterior?: string;
  observacao?: string;
  observation?: string;
  tags?: Record<string, unknown> | unknown[];
  codigo_vendedor?: number | string;
  codigoVendedor?: number | string;
};

function mapOmieCustomerRaw(item: OmieCustomerRaw): OmieCustomer | null {
  const idValue = pickFirst(item.codigo_cliente_omie, item.codigoClienteOmie);
  if (!idValue) return null;
  const id = toNumber(idValue);
  if (id === null) return null;
  const name = pickFirst(item.razao_social, item.razaoSocial);
  if (!name) return null;

  const phoneDdd = pickFirst(item.telefone1_ddd, item.telefone1Ddd);
  const phoneNumber = pickFirst(item.telefone1_numero, item.telefone1Numero);
  const phone = phoneDdd && phoneNumber ? `(${phoneDdd}) ${phoneNumber}` : null;

  const phone2Ddd = pickFirst(item.telefone2_ddd, item.telefone2Ddd);
  const phone2Number = pickFirst(item.telefone2_numero, item.telefone2Numero);
  const phoneSecondary = phone2Ddd && phone2Number ? `(${phone2Ddd}) ${phone2Number}` : null;

  const salespersonId = toNumber(pickFirst(item.codigo_vendedor, item.codigoVendedor));

  return {
    id,
    integrationCode: pickFirst(item.codigo_cliente_integracao, item.codigoClienteIntegracao),
    name,
    tradeName: pickFirst(item.nome_fantasia, item.nomeFantasia),
    document: pickFirst(item.cnpj_cpf, item.cnpjCpf),
    stateRegistration: pickFirst(item.inscricao_estadual, item.inscricaoEstadual),
    municipalRegistration: pickFirst(item.inscricao_municipal, item.inscricaoMunicipal),
    isIndividual: isYesFlag(pickFirst(item.pessoa_fisica, item.pessoaFisica)),
    email: pickFirst(item.email),
    homepage: pickFirst(item.homepage),
    contactName: pickFirst(item.contato),
    phone,
    phoneSecondary,
    zipcode: pickFirst(item.cep),
    addressStreet: pickFirst(item.endereco),
    addressNumber: pickFirst(item.endereco_numero, item.enderecoNumero),
    addressComplement: pickFirst(item.complemento),
    neighborhood: pickFirst(item.bairro),
    city: pickFirst(item.cidade),
    state: pickFirst(item.estado),
    country: pickFirst(item.pais),
    countryCode: pickFirst(item.codigo_pais, item.codigoPais),
    ibgeCityCode: pickFirst(item.cidade_ibge, item.cidadeIbge),
    ibgeStateCode: pickFirst(item.estado_ibge, item.estadoIbge),
    customerType: pickFirst(item.cliente_fornecedor, item.clienteFornecedor),
    isForeign: isYesFlag(item.exterior),
    billingBlocked: isYesFlag(pickFirst(item.bloquear_faturamento, item.bloquearFaturamento)),
    isActive: !isYesFlag(item.inativo),
    observations: pickFirst(item.observacao, item.observation),
    tagsJson: item.tags ?? null,
    salespersonId,
    defaultPaymentTermId: null
  };
}

async function listProductsPage(
  credentials: OmieCredentials,
  page: number
): Promise<PageResult<OmieProduct>> {
  const cacheKey = `produtos:${credentials.appKey}:${page}`;
  const cached = getCachedPage<OmieProduct>(cacheKey);
  if (cached) {
    return {
      items: cached.items,
      page,
      finished: cached.finished,
      totalPages: cached.totalPages,
      totalRecords: cached.totalRecords
    };
  }

  const response = await callOmie<
    {
      pagina: number;
      registros_por_pagina: number;
      apenas_importado_api: string;
      filtrar_apenas_omiepdv: string;
      exibir_caracteristicas: string;
      exibir_obs: string;
    },
    {
      pagina?: number;
      total_de_paginas?: number;
      registros?: number;
      total_de_registros?: number;
      produto_servico_cadastro?: OmieProductRaw[];
      produtoCadastro?: OmieProductRaw[];
    }
  >(credentials, "/geral/produtos/", "ListarProdutos", {
    pagina: page,
    registros_por_pagina: PAGE_SIZE,
    apenas_importado_api: "N",
    filtrar_apenas_omiepdv: "N",
    exibir_caracteristicas: "N",
    exibir_obs: "S"
  });

  const rawItems = response.produto_servico_cadastro ?? response.produtoCadastro ?? [];
  const items: OmieProduct[] = [];
  for (const item of rawItems) {
    const product = mapOmieProductRaw(item);
    if (product) items.push(product);
  }

  const totalPages = toIntOrNull(response.total_de_paginas);
  const totalRecords = toIntOrNull(response.total_de_registros);
  const finished = computeFinished(page, rawItems.length, totalPages);

  setCachedPage(cacheKey, items, finished, totalPages, totalRecords);
  return { items, page, finished, totalPages, totalRecords };
}

type OmieProductRaw = {
  codigo_produto?: number | string;
  codigoProdutoOmie?: number | string;
  codigo_produto_integracao?: string;
  codigoProdutoIntegracao?: string;
  codigo?: string;
  descricao?: string;
  descr_detalhada?: string;
  descrDetalhada?: string;
  unidade?: string;
  ncm?: string;
  ean?: string;
  valor_unitario?: number | string;
  valorUnitario?: number | string;
  codigo_familia?: number | string;
  codigoFamilia?: number | string;
  descricao_familia?: string;
  descricaoFamilia?: string;
  marca?: string;
  modelo?: string;
  obs_internas?: string;
  obsInternas?: string;
  peso_bruto?: number | string;
  pesoBruto?: number | string;
  peso_liq?: number | string;
  pesoLiq?: number | string;
  altura?: number | string;
  largura?: number | string;
  profundidade?: number | string;
  cest?: string;
  tipoItem?: string;
  tipo_item?: string;
  origem_mercadoria?: string;
  origemMercadoria?: string;
  inativo?: string;
  bloqueado?: string;
  nao_movimentar_estoque?: string;
  naoMovimentarEstoque?: string;
  recomendacoes_fiscais?: Record<string, unknown>;
  recomendacoesFiscais?: Record<string, unknown>;
};

function mapOmieProductRaw(item: OmieProductRaw): OmieProduct | null {
  const id = pickFirst(item.codigo_produto, item.codigoProdutoOmie);
  if (!id || !item.descricao) return null;
  const productId = toNumber(id);
  if (productId === null) return null;

  const recommendations = (item.recomendacoes_fiscais ??
    item.recomendacoesFiscais ??
    null) as Record<string, unknown> | null;
  const icmsOrigin = pickFirst(
    item.origem_mercadoria,
    item.origemMercadoria,
    typeof recommendations?.origem_mercadoria === "string"
      ? recommendations.origem_mercadoria
      : null,
    typeof recommendations?.origemMercadoria === "string" ? recommendations.origemMercadoria : null
  );

  const unitPrice = toNumber(pickFirst(item.valor_unitario, item.valorUnitario));
  const unitPriceCents = unitPrice === null ? null : Math.round(unitPrice * 100);

  return {
    id: productId,
    code: pickFirst(item.codigo),
    integrationCode: pickFirst(item.codigo_produto_integracao, item.codigoProdutoIntegracao),
    description: item.descricao,
    detailedDescription: pickFirst(item.descr_detalhada, item.descrDetalhada),
    unit: pickFirst(item.unidade),
    ncm: pickFirst(item.ncm),
    ean: pickFirst(item.ean),
    unitPriceCents,
    familyCode: pickFirstAsString(item.codigo_familia, item.codigoFamilia),
    familyDescription: pickFirst(item.descricao_familia, item.descricaoFamilia),
    brand: pickFirst(item.marca),
    model: pickFirst(item.modelo),
    internalNotes: pickFirst(item.obs_internas, item.obsInternas),
    grossWeightKg: toNumber(pickFirst(item.peso_bruto, item.pesoBruto)),
    netWeightKg: toNumber(pickFirst(item.peso_liq, item.pesoLiq)),
    heightM: toNumber(item.altura),
    widthM: toNumber(item.largura),
    depthM: toNumber(item.profundidade),
    cest: pickFirst(item.cest),
    itemType: pickFirst(item.tipoItem, item.tipo_item),
    icmsOrigin: icmsOrigin ?? null,
    isActive: !isYesFlag(item.inativo),
    blocked: isYesFlag(item.bloqueado),
    tracksStock: !isYesFlag(pickFirst(item.nao_movimentar_estoque, item.naoMovimentarEstoque)),
    fiscalRecommendations: recommendations
  };
}

function pickFirst(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function pickFirstAsString(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      return String(value);
    }
    const text = String(value).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function isYesFlag(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "S";
}

function isNoFlag(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "N";
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function computeFinished(
  currentPage: number,
  returned: number,
  totalPages: number | null
): boolean {
  if (returned === 0) return true;
  if (totalPages !== null && totalPages > 0) {
    return currentPage >= totalPages;
  }
  return returned < PAGE_SIZE;
}

function hasClienteTag(customer: OmieCustomer): boolean {
  return hasOmieTag(customer.tagsJson, "cliente");
}

function hasTransportadoraTag(customer: OmieCustomer): boolean {
  return hasOmieTag(customer.tagsJson, "transportadora");
}

function hasOmieTag(tagsJson: Record<string, unknown> | unknown[] | null, expected: string): boolean {
  if (!tagsJson) return false;
  const tagValues: string[] = [];
  if (Array.isArray(tagsJson)) {
    tagValues.push(...tagsJson.map(readTagValue));
  } else {
    const tags = tagsJson.tags;
    if (Array.isArray(tags)) tagValues.push(...tags.map(readTagValue));
  }
  const normalizedExpected = normalizeTag(expected);
  return tagValues.some((tag) => normalizeTag(tag) === normalizedExpected);
}

function readTagValue(tag: unknown): string {
  return typeof tag === "object" && tag !== null && "tag" in tag
    ? String((tag as { tag?: unknown }).tag ?? "")
    : String(tag ?? "");
}

function normalizeTag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function mapCustomerToCarrier(customer: OmieCustomer): OmieSupplier {
  return {
    id: customer.id,
    integrationCode: customer.integrationCode,
    name: customer.name,
    tradeName: customer.tradeName,
    document: customer.document,
    phone: customer.phone,
    email: customer.email,
    zipcode: customer.zipcode,
    addressStreet: customer.addressStreet,
    addressNumber: customer.addressNumber,
    addressComplement: customer.addressComplement,
    neighborhood: customer.neighborhood,
    city: customer.city,
    state: customer.state,
    isActive: customer.isActive,
    tagsJson: customer.tagsJson
  };
}

async function listPaymentTermsPage(
  credentials: OmieCredentials,
  page: number
): Promise<PageResult<OmiePaymentTerm>> {
  const cacheKey = `parcelas:${credentials.appKey}:${page}`;
  const cached = getCachedPage<OmiePaymentTerm>(cacheKey);
  if (cached) {
    return {
      items: cached.items,
      page,
      finished: cached.finished,
      totalPages: cached.totalPages,
      totalRecords: cached.totalRecords
    };
  }

  const response = await callOmie<
    { pagina: number; registros_por_pagina: number; apenas_importado_api: string },
    {
      pagina?: number;
      total_de_paginas?: number;
      registros?: number;
      total_de_registros?: number;
      condicoesPagamentoCadastro?: OmiePaymentTermRaw[];
      condicoes_pagamento_cadastro?: OmiePaymentTermRaw[];
      cadastros?: OmiePaymentTermRaw[];
      listaCondicoesPagamento?: OmiePaymentTermRaw[];
    }
  >(credentials, "/geral/condicoespgto/", "ListarCondicoesPagamento", {
    pagina: page,
    registros_por_pagina: PAGE_SIZE,
    apenas_importado_api: "N"
  });

  const rawItems =
    response.condicoesPagamentoCadastro ??
    response.condicoes_pagamento_cadastro ??
    response.cadastros ??
    response.listaCondicoesPagamento ??
    [];
  const items: OmiePaymentTerm[] = [];
  for (const item of rawItems) {
    const term = mapOmiePaymentTermRaw(item);
    if (term) items.push(term);
  }

  const totalPages = toIntOrNull(response.total_de_paginas);
  const totalRecords = toIntOrNull(response.total_de_registros);
  const finished = computeFinished(page, rawItems.length, totalPages);

  setCachedPage(cacheKey, items, finished, totalPages, totalRecords);
  return { items, page, finished, totalPages, totalRecords };
}

type OmiePaymentTermRaw = {
  codigoCondicaoPagamentoOmie?: number | string;
  codigo_condicao_pagamento_omie?: number | string;
  codigoCondicaoPagamentoIntegracao?: string;
  codigo_condicao_pagamento_integracao?: string;
  nCodCondicao?: number | string;
  codigo?: number | string;
  codigoParcela?: number | string;
  descricaoCondicaoPagamento?: string;
  descricao_condicao_pagamento?: string;
  cDescricao?: string;
  descricao?: string;
  descricaoParcela?: string;
  nDiasPrimeiraParcela?: number | string;
  dias_primeira_parcela?: number | string;
  nIntervaloParcelas?: number | string;
  intervalo_parcelas?: number | string;
  nNumeroParcelas?: number | string;
  numero_parcelas?: number | string;
  cTipoParcelas?: string;
  tipo_parcelas?: string;
  aparcela_dias?: number[] | string[];
  cInativo?: string;
  inativo?: string;
  cVisualizar?: string;
  visualizar?: string;
};

function mapOmiePaymentTermRaw(item: OmiePaymentTermRaw): OmiePaymentTerm | null {
  const idValue = pickFirst(
    item.codigoCondicaoPagamentoOmie,
    item.codigo_condicao_pagamento_omie,
    item.nCodCondicao,
    item.codigo,
    item.codigoParcela
  );
  if (!idValue) return null;
  const id = toNumber(idValue);
  if (id === null) return null;

  const description = pickFirst(
    item.descricaoCondicaoPagamento,
    item.descricao_condicao_pagamento,
    item.cDescricao,
    item.descricao,
    item.descricaoParcela
  );
  if (!description) return null;

  const days = Array.isArray(item.aparcela_dias)
    ? item.aparcela_dias
        .map((value) => toNumber(value))
        .filter((value): value is number => value !== null)
    : null;

  return {
    id,
    integrationCode: pickFirst(
      item.codigoCondicaoPagamentoIntegracao,
      item.codigo_condicao_pagamento_integracao
    ),
    description,
    firstInstallmentDays: toNumber(
      pickFirst(item.nDiasPrimeiraParcela, item.dias_primeira_parcela)
    ),
    installmentIntervalDays: toNumber(pickFirst(item.nIntervaloParcelas, item.intervalo_parcelas)),
    installmentCount: toNumber(pickFirst(item.nNumeroParcelas, item.numero_parcelas)),
    installmentType: pickFirst(item.cTipoParcelas, item.tipo_parcelas),
    installmentDaysJson: days && days.length > 0 ? days : null,
    isActive: !isYesFlag(pickFirst(item.cInativo, item.inativo)),
    visible: !isNoFlag(pickFirst(item.cVisualizar, item.visualizar))
  };
}

async function pushCustomerToOmie(
  credentials: OmieCredentials,
  payload: PushCustomerPayload
): Promise<number> {
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

  if (payload.cnpjCpf) {
    const existing = await findCustomerByDocument(credentials, payload.cnpjCpf);
    if (existing) {
      await callOmie<unknown, unknown>(credentials, "/geral/clientes/", "AlterarCliente", {
        ...body,
        codigo_cliente_omie: existing
      });
      return existing;
    }
  }

  const response = await callOmie<
    unknown,
    {
      codigo_cliente_omie?: number;
      codigoClienteOmie?: number;
    }
  >(credentials, "/geral/clientes/", "IncluirCliente", body);

  const omieCustomerId = response.codigo_cliente_omie ?? response.codigoClienteOmie;
  if (!omieCustomerId) {
    throw new Error("OMIE nao retornou codigoClienteOmie");
  }
  return omieCustomerId;
}

async function findCustomerByDocument(
  credentials: OmieCredentials,
  document: string
): Promise<number | null> {
  try {
    const response = await callOmie<unknown, { clientes?: Array<Record<string, unknown>> }>(
      credentials,
      "/geral/clientes/",
      "ListarClientesResumido",
      {
        pagina: 1,
        registros_por_pagina: 200,
        filtro: { cnpj_cpf: document }
      }
    );
    const customers = (response.clientes ?? []) as Array<Record<string, unknown>>;
    const id = customers
      .map((row) => toNumber(pickFirst(row.codigo_cliente_omie, row.codigoClienteOmie)))
      .find((value) => value !== null);
    return id ?? null;
  } catch {
    return null;
  }
}

async function createOmieOrder(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<number> {
  if (payload.operationType === "invoice") {
    if (!payload.productOmieId) {
      throw new Error("productOmieId obrigatorio para pedido de venda");
    }
    const response = await callOmie<unknown, unknown>(
      credentials,
      "/produtos/pedido/",
      "IncluirPedido",
      {
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
        frete: buildOmieFreight(payload.freightTotalCents),
        informacoes_adicionais: { codigo_categoria: "1.01.01", codigo_conta_corrente: 0 }
      }
    ).catch(async (error) => {
      const existing = await consultSalesOrderByIntegrationCode(
        credentials,
        payload.idempotencyKey
      ).catch(() => null);
      if (existing) return existing;
      throw error;
    });

    const orderId = extractSalesOrderId(response);
    if (!orderId) {
      throw new Error("OMIE nao retornou codigoPedido");
    }
    return orderId;
  }

  const response = await callOmie<
    unknown,
    {
      nCodOS?: number;
      codigoOS?: number;
      cCodIntOS?: string;
      codigoOSIntegracao?: string;
    }
  >(credentials, "/servicos/os/", "IncluirOS", {
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

function buildOmieFreight(freightTotalCents: number | null | undefined): Record<string, unknown> {
  if (!freightTotalCents || freightTotalCents <= 0) {
    return { modalidade: "9" };
  }
  return {
    modalidade: "0",
    valor_frete: Math.round(freightTotalCents) / 100
  };
}

async function createAndBillOmieOrder(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<CreateAndBillOrderResult> {
  if (payload.operationType !== "invoice") {
    throw new Error("Faturamento automatico disponivel apenas para pedido de venda fiscal");
  }

  const orderId = await createOmieOrder(credentials, payload);
  const billing = await billSalesOrder(credentials, orderId, payload.idempotencyKey);
  const consultedOrder = await consultSalesOrder(credentials, orderId).catch(() => null);
  const orderDocument = await getSalesOrderDocument(credentials, orderId).catch(() => null);
  const documentUrl =
    extractDocumentUrl(billing.raw) ??
    extractDocumentUrl(consultedOrder) ??
    extractDocumentUrl(orderDocument);

  return {
    orderId,
    billed: true,
    billingStatusCode: billing.statusCode,
    billingStatusMessage: billing.statusMessage,
    documentUrl
  };
}

async function billSalesOrder(
  credentials: OmieCredentials,
  orderId: number,
  integrationCode: string
): Promise<{ statusCode: string | null; statusMessage: string | null; raw: unknown }> {
  const response = await callOmie<
    unknown,
    {
      cCodIntPed?: string;
      nCodPed?: number;
      cCodStatus?: string;
      cDescStatus?: string;
    }
  >(credentials, "/produtos/pedidovendafat/", "FaturarPedidoVenda", {
    cCodIntPed: integrationCode,
    nCodPed: orderId
  });

  const statusCode = response.cCodStatus ?? null;
  const statusMessage = response.cDescStatus ?? null;
  if (statusCode && statusCode !== "0") {
    throw new Error(statusMessage || `OMIE retornou status ${statusCode} ao faturar pedido`);
  }

  return { statusCode, statusMessage, raw: response };
}

async function consultSalesOrder(credentials: OmieCredentials, orderId: number): Promise<unknown> {
  return callOmie<unknown, unknown>(credentials, "/produtos/pedido/", "ConsultarPedido", {
    codigo_pedido: orderId
  });
}

async function consultSalesOrderByIntegrationCode(
  credentials: OmieCredentials,
  integrationCode: string
): Promise<unknown> {
  return callOmie<unknown, unknown>(credentials, "/produtos/pedido/", "ConsultarPedido", {
    codigo_pedido_integracao: integrationCode
  });
}

function extractSalesOrderId(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const direct = toNumber(pickFirst(record.codigo_pedido, record.codigoPedido, record.nCodPed));
  if (direct !== null) return direct;
  const header =
    record.cabecalho && typeof record.cabecalho === "object"
      ? (record.cabecalho as Record<string, unknown>)
      : null;
  return toNumber(pickFirst(header?.codigo_pedido, header?.codigoPedido));
}

async function getSalesOrderDocument(
  credentials: OmieCredentials,
  orderId: number
): Promise<unknown> {
  return callOmie<unknown, unknown>(credentials, "/produtos/dfedocs/", "ObterPedVenda", {
    nIdPed: orderId
  });
}

function extractDocumentUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && /^https?:\/\//i.test(raw)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("danfe") || normalizedKey.includes("pdf")) {
        return raw;
      }
    }
    if (raw && typeof raw === "object") {
      const nested = Array.isArray(raw)
        ? (raw.map((item) => extractDocumentUrl(item)).find(Boolean) ?? null)
        : extractDocumentUrl(raw);
      if (nested) return nested;
    }
  }
  return null;
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
  for (let attempt = 0; attempt <= OMIE_REDUNDANT_MAX_RETRIES; attempt++) {
    const release = await acquireOmieRequestSlot();
    let response: Response | null = null;
    let data: unknown;
    try {
      response = await fetch(`${OMIE_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call,
          param: [param],
          app_key: credentials.appKey,
          app_secret: credentials.appSecret
        })
      });
      data = await readOmieResponseBody(response);
    } finally {
      release();
    }
    if (!response) throw new Error(`Falha de transporte OMIE em ${call} (${endpoint})`);
    const detail = getOmieFaultString(data);

    if (!response.ok) {
      if (detail && isRedundantOmieError(detail) && attempt < OMIE_REDUNDANT_MAX_RETRIES) {
        await sleep(parseRedundantWaitMs(detail));
        continue;
      }
      const suffix = detail ? ` - ${detail}` : "";
      throw new Error(
        `OMIE HTTP ${response.status}: ${response.statusText} em ${call} (${endpoint})${suffix}`
      );
    }

    if (detail) {
      if (isRedundantOmieError(detail) && attempt < OMIE_REDUNDANT_MAX_RETRIES) {
        await sleep(parseRedundantWaitMs(detail));
        continue;
      }
      throw new Error(`OMIE faultstring em ${call} (${endpoint}): ${detail}`);
    }

    return data as TResponse;
  }

  throw new Error(`OMIE redundant retry exhausted em ${call} (${endpoint})`);
}

let omieRequestGate: Promise<void> = Promise.resolve();
let lastOmieRequestFinishedAt = 0;

async function acquireOmieRequestSlot(): Promise<() => void> {
  let releaseSlot: () => void = () => undefined;
  const nextSlot = new Promise<void>((resolve) => {
    releaseSlot = resolve;
  });
  const previousSlot = omieRequestGate;
  omieRequestGate = previousSlot.then(() => nextSlot);
  await previousSlot;

  const elapsedMs = Date.now() - lastOmieRequestFinishedAt;
  if (lastOmieRequestFinishedAt > 0 && elapsedMs >= 0 && elapsedMs < OMIE_REQUEST_DELAY_MS) {
    await sleep(OMIE_REQUEST_DELAY_MS - elapsedMs);
  }

  return () => {
    lastOmieRequestFinishedAt = Date.now();
    releaseSlot();
  };
}

async function readOmieResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getOmieFaultString(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("faultstring" in data)) return null;
  return String((data as { faultstring?: unknown }).faultstring ?? "Falha OMIE");
}

function isRedundantOmieError(message: string): boolean {
  return /REDUNDANT|Consumo redundante/i.test(message);
}

function parseRedundantWaitMs(message: string): number {
  const match = /Aguarde\s+(\d+)\s+segundos?/i.exec(message);
  const seconds = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return OMIE_REDUNDANT_DEFAULT_WAIT_MS;
  return Math.min(seconds * 1000 + 1000, OMIE_REDUNDANT_MAX_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
