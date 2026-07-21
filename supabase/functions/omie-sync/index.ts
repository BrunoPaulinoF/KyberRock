import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  OmieQueueManager,
  buildCustomerPayload,
  extractExistingCustomerId,
  pushCarrierToOmie as pushCarrierToOmieCore,
  toCustomerUpdateBody,
  toOmieIntegrationCode,
  type OmieCredentials,
  type OmieRequester
} from "./omie-sync-core.ts";

const PAGE_SIZE = 100;
const PUSH_PAGE_SIZE = 25;
const defaultOmieQueue = new OmieQueueManager();
let activeOmieQueue: OmieRequester = defaultOmieQueue;

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
  | "sync"
  | "pull_reference_data"
  | "list_document_types"
  | "create_order"
  | "create_and_bill_order"
  | "cancel_order"
  | "push_customer"
  | "push_carrier";

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
  code: string | null;
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
  localOperationId?: string;
  operationType: "invoice" | "internal";
  customerOmieId: number;
  productOmieId?: number;
  serviceDescription?: string;
  /** Quantidade em toneladas (mesma unidade do preco unitario). */
  quantity: number;
  /** Preco unitario em reais (ja convertido de centavos no desktop). */
  unitPrice: number;
  /** Frete total em centavos (convertido para reais no edge, ver buildOmieFreight). */
  freightTotalCents?: number;
  /**
   * Codigo "modalidade" do frete no pedido de venda do OMIE (modFrete da NF-e):
   * "0" CIF, "1" FOB, "2" terceiros, "3"/"4" transporte proprio, "9" sem frete.
   * Ausente -> fallback: "0" quando ha valor de frete, senao "9".
   */
  freightModalidade?: string;
  /**
   * Dados de transporte da operacao: placa/transportadora/pesos vao no bloco
   * `frete` do pedido; o motorista vai em dados_adicionais_nf (a NF-e nao tem
   * campo proprio para motorista no pedido de venda).
   */
  transport?: {
    plate?: string | null;
    driverName?: string | null;
    /** Codigo OMIE (codigo_cliente_omie) da transportadora vinculada ao veiculo. */
    carrierOmieId?: number | null;
    /** Peso liquido da carga em kg (granel: peso_bruto = peso_liquido). */
    cargoWeightKg?: number | null;
    /** Transporte proprio (modFrete 3/4) -> veiculo_proprio "S", sem transportadora. */
    ownVehicle?: boolean;
  } | null;
  issueDate: string;
  createdAt?: string;
  /**
   * Codigo de parcela do OMIE (codigo_parcela/cCodParc). String, preserva zeros a
   * esquerda (ex: "000", "030"). Ausente -> a condicao e resolvida/criada no
   * cadastro de parcelas do OMIE a partir de installmentDays/installmentCount
   * (ensureOmieParcelaCode); em ultimo caso "000" (a vista).
   */
  paymentTermOmieCode?: string;
  /** Numero de parcelas da OS (nQtdeParc). Ausente/invalido -> 1. */
  installmentCount?: number;
  /**
   * Dias de vencimento das parcelas da condicao escolhida no desktop (ex: [7,14,21]).
   * Usados para localizar/criar a parcela no cadastro do OMIE quando nao ha codigo.
   */
  installmentDays?: number[];
  /**
   * Codigo NFe/OMIE do meio de pagamento selecionado no desktop ("01" dinheiro,
   * "17" PIX...). Transportado no payload; como o pedido/OS referencia a condicao
   * pelo codigo do cadastro de parcelas, o meio (tPag da NF-e) ainda nao entra no
   * corpo do pedido — exigiria parcelamento informado (codigo_parcela "999" +
   * lista_parcelas), a validar com credenciais reais.
   */
  paymentMethodOmieCode?: string;
  /**
   * nCodCC da conta corrente vinculada ao meio selecionado no desktop. Quando
   * presente e valido, vai em codigo_conta_corrente (pedido) / nCodCC (OS) no
   * lugar da resolucao automatica da primeira conta do tenant.
   */
  accountOmieCode?: string | number;
  /**
   * Nome da conta vinculada ao meio de pagamento (ex.: "OMIE Cash", "Caixinha").
   * Usado para resolver o nCodCC pelo nome canonico direto no OMIE quando o desktop
   * nao mandou accountOmieCode (o omie_code local ainda esta nulo/desatualizado).
   * Garante que o meio de pagamento sempre caia na conta vinculada a ele em vez de
   * cair silenciosamente na primeira conta corrente do tenant (a caixinha).
   */
  accountName?: string | null;
  /**
   * Cadastro do cliente para criar/localizar no OMIE na hora do envio quando ele ainda
   * nao tem codigo OMIE (customerOmieId ausente/0). O edge faz find-or-create por CNPJ/CPF
   * (pushCustomerToOmie) e usa o codigo resultante no pedido, devolvendo omieCustomerId
   * para o desktop vincular o cliente localmente.
   */
  customer?: PushCustomerPayload;
  idempotencyKey: string;
};

type CreateAndBillOrderResult = {
  orderId: number;
  omieCustomerId: number;
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
  /** Bloqueia/libera o faturamento do cliente no OMIE (bloquear_faturamento S/N). */
  billingBlocked?: boolean;
  tags?: string[];
};

type PushCarrierPayload = Omit<PushCustomerPayload, "razaoSocial" | "nomeFantasia"> & {
  name: string;
  razaoSocial?: string;
  nomeFantasia?: string;
};

type SyncPayload = {
  customers?: PushCustomerPayload[];
  carriers?: PushCarrierPayload[];
  orders?: CreateOrderPayload[];
};

type SupabaseQueryLike = {
  select(columns: string): SupabaseQueryLike;
  update(values: Record<string, unknown>): SupabaseQueryLike;
  eq(column: string, value: string): SupabaseQueryLike;
  single(): Promise<{ data: unknown; error: unknown }>;
};

type SupabaseClientLike = {
  from(table: string): SupabaseQueryLike;
};

type CreateSupabaseClient = (url: string, serviceRoleKey: string) => SupabaseClientLike;

export type OmieSyncHandlerDependencies = {
  createClient?: CreateSupabaseClient;
  omieQueue?: OmieRequester;
};

type PushItemSuccess = {
  localId: string;
  omieId: number;
};

type PushItemFailure = {
  localId: string;
  error: string;
};

type PushQueuePageResult = {
  customers: PushItemSuccess[];
  carriers: PushItemSuccess[];
  orders: PushItemSuccess[];
  failures: PushItemFailure[];
  processed: number;
  failed: number;
  pageSize: number;
  pagination: {
    customersAccepted: number;
    customersReceived: number;
    customersHasMore: boolean;
    carriersAccepted: number;
    carriersReceived: number;
    carriersHasMore: boolean;
    ordersAccepted: number;
    ordersReceived: number;
    ordersHasMore: boolean;
  };
};

export async function handleOmieSyncRequest(
  req: Request,
  dependencies: OmieSyncHandlerDependencies = {}
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const createClient = dependencies.createClient ?? createSupabaseClient;
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

  const deviceRow = device as Partial<DeviceRow> | null;
  if (deviceError || !deviceRow?.is_active) {
    return jsonResponse({ error: "Dispositivo nao autorizado" }, 401);
  }

  const typedDevice = deviceRow as DeviceRow;
  const tokenHash = await sha256Hex(deviceToken);
  if (!safeEqual(tokenHash, typedDevice.token_hash)) {
    return jsonResponse({ error: "Token de dispositivo invalido" }, 401);
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, is_active, omie_app_key, omie_app_secret")
    .eq("id", typedDevice.company_id)
    .single();

  const companyRow = company as Partial<CompanyRow> | null;
  if (companyError || !companyRow?.is_active) {
    return jsonResponse({ error: "Empresa bloqueada ou inexistente" }, 403);
  }

  const typedCompany = companyRow as CompanyRow;
  if (!typedCompany.omie_app_key || !typedCompany.omie_app_secret) {
    return jsonResponse({ error: "OMIE nao configurado para esta empresa" }, 400);
  }

  const credentials = {
    appKey: typedCompany.omie_app_key,
    appSecret: typedCompany.omie_app_secret
  };

  const previousOmieQueue = activeOmieQueue;
  if (dependencies.omieQueue) activeOmieQueue = dependencies.omieQueue;

  try {
    if (action === "sync") {
      const pull = await pullReferenceDataPage(credentials, resume);
      const push = await pushLocalQueuePage(credentials, body.payload as SyncPayload);
      const checkedAt = new Date().toISOString();
      await supabase
        .from("device_registrations")
        .update({ last_seen_at: checkedAt, updated_at: checkedAt })
        .eq("id", typedDevice.id);

      return jsonResponse({
        ok: true,
        companyId: typedDevice.company_id,
        unitId: typedDevice.unit_id,
        checkedAt,
        pull,
        push
      });
    }

    if (action === "pull_reference_data") {
      const pull = await pullReferenceDataPage(credentials, resume);
      const checkedAt = new Date().toISOString();
      await supabase
        .from("device_registrations")
        .update({ last_seen_at: checkedAt, updated_at: checkedAt })
        .eq("id", typedDevice.id);

      return jsonResponse({
        ok: true,
        companyId: typedDevice.company_id,
        unitId: typedDevice.unit_id,
        customers: pull.customers,
        products: pull.products,
        paymentTerms: pull.paymentTerms,
        suppliers: pull.suppliers,
        checkedAt,
        pageSize: pull.pageSize,
        pagination: pull.pagination
      });
    }

    if (action === "list_document_types") {
      const documentTypes = await listDocumentTypes(credentials);
      return jsonResponse({ ok: true, documentTypes });
    }

    if (action === "create_order") {
      const payload = body.payload as CreateOrderPayload;
      const { orderId, omieCustomerId } = await createOmieOrder(credentials, payload);
      return jsonResponse({ ok: true, orderId, omieCustomerId });
    }

    if (action === "create_and_bill_order") {
      const payload = body.payload as CreateOrderPayload;
      const result = await createAndBillOmieOrder(credentials, payload);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === "cancel_order") {
      const payload = body.payload as CancelOrderPayload;
      // Retorna 200 mesmo para "blocked" para o desktop marcar o job como done (sem retry
      // infinito) e manter o cancelamento local com o erro visivel.
      const result = await cancelOmieOrder(credentials, payload);
      return jsonResponse(result);
    }

    if (action === "push_customer") {
      const payload = body.payload as PushCustomerPayload;
      const omieCustomerId = await pushCustomerToOmie(credentials, payload);
      return jsonResponse({ ok: true, omieCustomerId });
    }

    if (action === "push_carrier") {
      const payload = body.payload as PushCarrierPayload;
      const omieCustomerId = await pushCarrierToOmie(credentials, payload);
      return jsonResponse({ ok: true, omieCustomerId });
    }

    return jsonResponse({ error: "Acao OMIE desconhecida" }, 400);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro OMIE inesperado" },
      400
    );
  } finally {
    activeOmieQueue = previousOmieQueue;
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleOmieSyncRequest(req));
}

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

async function pullReferenceDataPage(
  credentials: OmieCredentials,
  resume: PullResume
): Promise<{
  customers: OmieCustomer[];
  products: OmieProduct[];
  paymentTerms: OmiePaymentTerm[];
  suppliers: OmieSupplier[];
  pageSize: number;
  pagination: Record<string, number | boolean | null>;
}> {
  const customersPage = resume.customersPage ?? 1;
  const productsPage = resume.productsPage ?? 1;
  const paymentTermsPage = resume.paymentTermsPage ?? 1;
  const customersResult = resume.customersFinished
    ? emptyCustomerPage(customersPage)
    : await listCustomersPage(credentials, customersPage);
  const productsResult = resume.productsFinished
    ? emptyPage<OmieProduct>(productsPage)
    : await listProductsPage(credentials, productsPage);
  const paymentTermsResult = resume.paymentTermsFinished
    ? emptyPage<OmiePaymentTerm>(paymentTermsPage)
    : await listOptionalPaymentTermsPage(credentials, paymentTermsPage);

  return {
    customers: customersResult.items,
    products: productsResult.items,
    paymentTerms: paymentTermsResult.items,
    suppliers: customersResult.carriers,
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
  };
}

async function pushLocalQueuePage(
  credentials: OmieCredentials,
  payload: SyncPayload
): Promise<PushQueuePageResult> {
  const customers = takePushPage(payload.customers);
  const carriers = takePushPage(payload.carriers);
  const orders = takePushPage(payload.orders).sort(comparePushOrdersChronologically);
  const result: PushQueuePageResult = {
    customers: [],
    carriers: [],
    orders: [],
    failures: [],
    processed: 0,
    failed: 0,
    pageSize: PUSH_PAGE_SIZE,
    pagination: {
      customersAccepted: customers.length,
      customersReceived: payload.customers?.length ?? 0,
      customersHasMore: (payload.customers?.length ?? 0) > customers.length,
      carriersAccepted: carriers.length,
      carriersReceived: payload.carriers?.length ?? 0,
      carriersHasMore: (payload.carriers?.length ?? 0) > carriers.length,
      ordersAccepted: orders.length,
      ordersReceived: payload.orders?.length ?? 0,
      ordersHasMore: (payload.orders?.length ?? 0) > orders.length
    }
  };

  for (const customer of customers) {
    try {
      const omieId = await pushCustomerToOmie(credentials, customer);
      result.customers.push({ localId: customer.localCustomerId, omieId });
      result.processed++;
    } catch (error) {
      result.failures.push({ localId: customer.localCustomerId, error: getErrorMessage(error) });
      result.failed++;
    }
  }

  for (const carrier of carriers) {
    try {
      const omieId = await pushCarrierToOmie(credentials, carrier);
      result.carriers.push({ localId: carrier.localCustomerId, omieId });
      result.processed++;
    } catch (error) {
      result.failures.push({ localId: carrier.localCustomerId, error: getErrorMessage(error) });
      result.failed++;
    }
  }

  for (const order of orders) {
    try {
      const omieId =
        order.operationType === "invoice"
          ? (await createAndBillOmieOrder(credentials, order)).orderId
          : (await createOmieOrder(credentials, order)).orderId;
      result.orders.push({ localId: order.localOperationId ?? order.idempotencyKey, omieId });
      result.processed++;
    } catch (error) {
      result.failures.push({
        localId: order.localOperationId ?? order.idempotencyKey,
        error: getErrorMessage(error)
      });
      result.failed++;
    }
  }

  return result;
}

function takePushPage<T>(items: T[] | undefined): T[] {
  return (items ?? []).slice(0, PUSH_PAGE_SIZE);
}

function comparePushOrdersChronologically(a: CreateOrderPayload, b: CreateOrderPayload): number {
  return getOrderTimestamp(a).localeCompare(getOrderTimestamp(b));
}

function getOrderTimestamp(order: CreateOrderPayload): string {
  return order.createdAt ?? order.issueDate ?? "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro OMIE inesperado";
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

function hasOmieTag(
  tagsJson: Record<string, unknown> | unknown[] | null,
  expected: string
): boolean {
  const tagValues = getOmieTagValues(tagsJson);
  const normalizedExpected = normalizeTag(expected);
  return tagValues.some((tag) => normalizeTag(tag) === normalizedExpected);
}

function getOmieTagValues(tagsJson: Record<string, unknown> | unknown[] | null): string[] {
  if (!tagsJson) return [];
  const tagValues: string[] = [];
  if (Array.isArray(tagsJson)) {
    tagValues.push(...tagsJson.map(readTagValue));
  } else {
    const tags = tagsJson.tags;
    if (Array.isArray(tags)) tagValues.push(...tags.map(readTagValue));
  }
  return tagValues;
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
      cadastros?: OmiePaymentTermRaw[];
      parcela_cadastro?: OmiePaymentTermRaw[];
      condicoesPagamentoCadastro?: OmiePaymentTermRaw[];
      condicoes_pagamento_cadastro?: OmiePaymentTermRaw[];
      listaCondicoesPagamento?: OmiePaymentTermRaw[];
    }
  >(credentials, "/geral/parcelas/", "ListarParcelas", {
    pagina: page,
    registros_por_pagina: PAGE_SIZE,
    apenas_importado_api: "N"
  });

  const rawItems =
    response.cadastros ??
    response.parcela_cadastro ??
    response.condicoesPagamentoCadastro ??
    response.condicoes_pagamento_cadastro ??
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

async function listOptionalPaymentTermsPage(
  credentials: OmieCredentials,
  page: number
): Promise<PageResult<OmiePaymentTerm>> {
  try {
    return await listPaymentTermsPage(credentials, page);
  } catch (error) {
    if (isPaymentTermsUnavailableError(error)) {
      return emptyPage<OmiePaymentTerm>(page);
    }
    throw error;
  }
}

function isPaymentTermsUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /OMIE HTTP 404:.*ListarParcelas|\/geral\/parcelas\//i.test(error.message);
}

type OmiePaymentTermRaw = {
  // Campos do endpoint atual /geral/parcelas/ (ListarParcelas)
  nCodigo?: number | string;
  nParcelas?: number | string;
  // Campos legados / variacoes mantidos por resiliencia
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
    item.nCodigo,
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

  // Preserva o codigo original da parcela (ex.: "000"), mantendo zeros a esquerda
  // exigidos no codigo_parcela do pedido e perdidos na conversao para numero.
  const code = pickFirst(item.nCodigo, item.codigo, item.codigoParcela);

  return {
    id,
    code,
    integrationCode: pickFirst(
      item.codigoCondicaoPagamentoIntegracao,
      item.codigo_condicao_pagamento_integracao
    ),
    description,
    firstInstallmentDays: toNumber(
      pickFirst(item.nDiasPrimeiraParcela, item.dias_primeira_parcela)
    ),
    installmentIntervalDays: toNumber(pickFirst(item.nIntervaloParcelas, item.intervalo_parcelas)),
    installmentCount: toNumber(pickFirst(item.nParcelas, item.nNumeroParcelas, item.numero_parcelas)),
    installmentType: pickFirst(item.cTipoParcelas, item.tipo_parcelas),
    installmentDaysJson: days && days.length > 0 ? days : null,
    isActive: !isYesFlag(pickFirst(item.cInativo, item.inativo)),
    visible: !isNoFlag(pickFirst(item.cVisualizar, item.visualizar))
  };
}

interface OmieDocumentTypeRaw {
  cCodigo?: string;
  codigo?: string;
  cDescricao?: string;
  descricao?: string;
}

interface OmieDocumentType {
  code: string;
  description: string;
}

// Formas de pagamento no OMIE = "tipos de documento" (ListarTiposDocumento).
// Cada um traz um codigo (cCodigo) e uma descricao (cDescricao), que alimentam
// o campo "Codigo OMIE" das formas de pagamento locais.
async function listDocumentTypes(credentials: OmieCredentials): Promise<OmieDocumentType[]> {
  const response = await callOmie<
    Record<string, never>,
    {
      tipo_documento_cadastro?: OmieDocumentTypeRaw[];
      tipoDocumentoCadastro?: OmieDocumentTypeRaw[];
      cadastros?: OmieDocumentTypeRaw[];
    }
  >(credentials, "/geral/tiposdoc/", "ListarTiposDocumento", {});

  const raw =
    response.tipo_documento_cadastro ?? response.tipoDocumentoCadastro ?? response.cadastros ?? [];

  const types: OmieDocumentType[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const code = pickFirst(item.cCodigo, item.codigo);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const description = pickFirst(item.cDescricao, item.descricao);
    types.push({ code, description: description ?? code });
  }
  return types;
}

async function pushCustomerToOmie(
  credentials: OmieCredentials,
  payload: PushCustomerPayload
): Promise<number> {
  const body = buildCustomerPayload(payload);

  if (payload.omieCustomerId) {
    await callOmie<unknown, unknown>(
      credentials,
      "/geral/clientes/",
      "AlterarCliente",
      toCustomerUpdateBody(body, payload.omieCustomerId)
    );
    return payload.omieCustomerId;
  }

  if (payload.cnpjCpf) {
    const existing = await findCustomerByDocument(credentials, payload.cnpjCpf);
    if (existing) {
      await callOmie<unknown, unknown>(
        credentials,
        "/geral/clientes/",
        "AlterarCliente",
        toCustomerUpdateBody(body, existing)
      );
      return existing;
    }
  }

  let response: { codigo_cliente_omie?: number; codigoClienteOmie?: number };
  try {
    response = await callOmie<
      unknown,
      {
        codigo_cliente_omie?: number;
        codigoClienteOmie?: number;
      }
    >(credentials, "/geral/clientes/", "IncluirCliente", body);
  } catch (error) {
    const existingId = extractExistingCustomerId(error);
    if (existingId === null) throw error;
    await callOmie<unknown, unknown>(
      credentials,
      "/geral/clientes/",
      "AlterarCliente",
      toCustomerUpdateBody(body, existingId)
    );
    return existingId;
  }

  const omieCustomerId = response.codigo_cliente_omie ?? response.codigoClienteOmie;
  if (!omieCustomerId) {
    throw new Error("OMIE nao retornou codigoClienteOmie");
  }
  return omieCustomerId;
}

async function pushCarrierToOmie(
  credentials: OmieCredentials,
  payload: PushCarrierPayload
): Promise<number> {
  return pushCarrierToOmieCore(activeOmieQueue, credentials, payload);
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
      .map((row) =>
        toNumber(
          pickFirst(
            row.codigo_cliente_omie as string | number | null | undefined,
            row.codigoClienteOmie as string | number | null | undefined
          )
        )
      )
      .find((value) => value !== null);
    return id ?? null;
  } catch {
    return null;
  }
}

// O codigo de parcela do OMIE e uma string com zeros a esquerda significativos ("000",
// "030"). Nunca converter para numero. Retorna null quando vazio/invalido para o chamador
// cair no padrao "000".
function normalizeParcelaCode(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  return /^[0-9A-Za-z]+$/.test(text) ? text : null;
}

// Codigos de parcela criados/descobertos no cadastro do OMIE, por app_key + condicao.
const omieParcelaCodeCache = new Map<string, string>();

/** Dias de vencimento de uma parcela do cadastro OMIE (json explicito ou 1o dia + intervalo). */
function paymentTermDueDays(term: OmiePaymentTerm): number[] | null {
  if (term.installmentDaysJson && term.installmentDaysJson.length > 0) {
    return term.installmentDaysJson;
  }
  const count = term.installmentCount;
  const first = term.firstInstallmentDays;
  if (!count || count < 1 || first === null || first < 0) return null;
  const interval = term.installmentIntervalDays ?? 0;
  return Array.from({ length: count }, (_, index) => first + index * interval);
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Garante que a condicao de pagamento da operacao exista no cadastro de parcelas do
 * OMIE (/geral/parcelas/) e retorna o codigo dela. Fluxo: procura por dias de
 * vencimento iguais em ListarParcelas; se nao existir, cria via IncluirParcela no
 * formato aceito pelo OMIE ("7/14/21", "93 dias" ou "5") e usa o cCodParcela
 * retornado. Qualquer falha retorna null e o chamador cai no comportamento
 * historico ("000"/codigo vinculado) — a criacao do pedido/OS nunca trava aqui.
 */
async function ensureOmieParcelaCode(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<string | null> {
  const days = (payload.installmentDays ?? [])
    .map((value) => toNumber(value))
    .filter((value): value is number => value !== null && value >= 0);
  const count =
    typeof payload.installmentCount === "number" && payload.installmentCount > 0
      ? Math.floor(payload.installmentCount)
      : days.length;

  // A vista (sem parcelamento util): mantem o padrao "000" do chamador.
  const isAVista = days.length === 0 ? count <= 1 : days.length === 1 && days[0] === 0;
  if (isAVista) return null;

  const conditionText =
    days.length > 1
      ? days.join("/")
      : days.length === 1
        ? `${days[0]} dias`
        : String(count);

  const cacheKey = `${credentials.appKey}:${conditionText}`;
  const cached = omieParcelaCodeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    // 1. Procura no cadastro por dias de vencimento equivalentes.
    const desiredDays = days.length > 0 ? days : null;
    let page = 1;
    let finished = false;
    while (!finished) {
      const result = await listPaymentTermsPage(credentials, page);
      for (const term of result.items) {
        if (!term.code || !term.isActive) continue;
        const termDays = paymentTermDueDays(term);
        if (desiredDays !== null) {
          if (termDays !== null && sameDays(termDays, desiredDays)) {
            omieParcelaCodeCache.set(cacheKey, term.code);
            return term.code;
          }
        } else if (termDays === null && term.installmentCount === count) {
          // Sem dias dos dois lados: casa pela quantidade de parcelas.
          omieParcelaCodeCache.set(cacheKey, term.code);
          return term.code;
        }
      }
      finished = result.finished || result.items.length === 0;
      page++;
    }

    // 2. Nao existe: cria no cadastro do OMIE. O nome do campo de descricao varia na
    // documentacao publica; tenta os dois aliases conhecidos (sem risco de duplicar:
    // uma tentativa rejeitada por tag invalida nao cria nada).
    let response: Record<string, unknown> | null = null;
    try {
      response = await callOmie<unknown, Record<string, unknown>>(
        credentials,
        "/geral/parcelas/",
        "IncluirParcela",
        { cDescricao: conditionText }
      );
    } catch {
      response = await callOmie<unknown, Record<string, unknown>>(
        credentials,
        "/geral/parcelas/",
        "IncluirParcela",
        { descricao: conditionText }
      );
    }

    const createdCode = normalizeParcelaCode(
      findStringByKey(response, "cCodParcela") ??
        findStringByKey(response, "nCodigo") ??
        findStringByKey(response, "codigo") ??
        undefined
    );
    if (createdCode) {
      omieParcelaCodeCache.set(cacheKey, createdCode);
      return createdCode;
    }
    return null;
  } catch {
    // Falhas de consulta/criacao nao sao cacheadas para permitir nova tentativa.
    return null;
  }
}

/** Dias de vencimento das parcelas do pedido (explicitos, ou mensal por quantidade). */
function orderDueDays(payload: CreateOrderPayload): number[] {
  const days = (payload.installmentDays ?? [])
    .map((value) => toNumber(value))
    .filter((value): value is number => value !== null && value >= 0);
  if (days.length > 0) return days;
  const count =
    typeof payload.installmentCount === "number" && payload.installmentCount > 0
      ? Math.floor(payload.installmentCount)
      : 1;
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => 30 * (index + 1));
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const base = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

type OrderParcelamento = {
  /** Campos do cabecalho (codigo_parcela + qtde_parcelas quando "999"). */
  cabecalho: Record<string, unknown>;
  /** lista_parcelas quando o parcelamento e informado (999); null para "000"/vinculado. */
  listaParcelas: Record<string, unknown> | null;
};

/**
 * Monta o parcelamento do pedido de venda. Quando ha meio de pagamento OU parcelas
 * com vencimento (ou mais de uma), usa o parcelamento informado do OMIE:
 * codigo_parcela "999" + lista_parcelas com data_vencimento, percentual e
 * meio_pagamento (tPag da NF-e) por parcela. Sem meio e a vista, usa o codigo
 * vinculado (ou "000").
 */
function buildOrderParcelamento(payload: CreateOrderPayload): OrderParcelamento {
  const meio = (payload.paymentMethodOmieCode ?? "").trim();
  const dueDays = orderDueDays(payload);
  const useLista = meio.length > 0 || dueDays.length > 1 || dueDays[0] > 0;

  if (!useLista) {
    const code = normalizeParcelaCode(payload.paymentTermOmieCode) ?? "000";
    return { cabecalho: { codigo_parcela: code }, listaParcelas: null };
  }

  const count = dueDays.length;
  const basePercent = Math.floor(10000 / count) / 100;
  // Total do pedido (itens + frete) em centavos. O OMIE exige a tag `valor` em CADA
  // parcela do parcelamento informado (codigo_parcela "999"); sem ela rejeita o pedido
  // com "O preenchimento da tag [valor] e obrigatorio!". O ultimo parcela absorve o
  // arredondamento para as parcelas somarem exatamente o total.
  const itemsTotalCents = Math.round(payload.quantity * payload.unitPrice * 100);
  const freightCents =
    typeof payload.freightTotalCents === "number" && payload.freightTotalCents > 0
      ? Math.round(payload.freightTotalCents)
      : 0;
  const orderTotalCents = itemsTotalCents + freightCents;
  let allocatedCents = 0;
  const parcela = dueDays.map((dueInDays, index) => {
    const isLast = index === count - 1;
    const percentual = isLast
      ? Math.round((100 - basePercent * (count - 1)) * 100) / 100
      : basePercent;
    const valorCents = isLast
      ? orderTotalCents - allocatedCents
      : Math.round((orderTotalCents * percentual) / 100);
    allocatedCents += valorCents;
    return {
      numero_parcela: index + 1,
      data_vencimento: toOmieDate(addDaysToIsoDate(payload.issueDate, dueInDays)),
      percentual,
      valor: valorCents / 100,
      ...(meio ? { meio_pagamento: meio } : {})
    };
  });

  return {
    // OMIE: o campo do cabecalho e "qtde_parcelas" — "quantidade_parcelas" e rejeitado
    // ("Tag [QUANTIDADE_PARCELAS] nao faz parte da estrutura do tipo complexo [cabecalho]").
    cabecalho: { codigo_parcela: "999", qtde_parcelas: count },
    listaParcelas: { parcela }
  };
}

/**
 * Codigo OMIE do cliente do pedido. Ja vinculado -> usa direto. Sem codigo mas com
 * cadastro no payload -> cria/localiza o cliente no OMIE na hora (find-or-create por
 * CNPJ/CPF) e devolve o codigo. Sem codigo e sem cadastro -> erro claro.
 */
async function resolveOrderCustomerOmieId(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<number> {
  if (typeof payload.customerOmieId === "number" && payload.customerOmieId > 0) {
    return payload.customerOmieId;
  }
  if (payload.customer) {
    return await pushCustomerToOmie(credentials, payload.customer);
  }
  throw new Error("Cliente sem codigo OMIE e sem dados de cadastro para criar no OMIE.");
}

async function createOmieOrder(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<{ orderId: number; omieCustomerId: number }> {
  const integrationCode = toOmieIntegrationCode(payload.idempotencyKey);
  // Garante o cliente no OMIE (cadastra na hora quando ainda nao existe) antes do pedido.
  const customerOmieId = await resolveOrderCustomerOmieId(credentials, payload);
  // Conta corrente escolhida na operacao (meio de pagamento -> conta vinculada).
  // Prioridade: (1) nCodCC vindo do desktop; (2) resolucao pelo nome da conta
  // vinculada direto no OMIE (cobre o caso do omie_code local nulo/desatualizado,
  // garantindo que o meio de pagamento sempre use a conta a ele vinculada); (3) conta
  // padrao do meio de pagamento (dinheiro -> Caixinha, PIX/boleto -> OMIE Cash,
  // cartoes -> GetNet) resolvida pelo nome no OMIE — cobre desktops antigos que ainda
  // nao mandam accountName; (4) por ultimo, o fallback historico da primeira conta
  // corrente do tenant — usado so quando nem o meio de pagamento e conhecido.
  const selectedAccountCode = toNumber(payload.accountOmieCode ?? null);
  const accountCode =
    selectedAccountCode !== null && selectedAccountCode > 0
      ? selectedAccountCode
      : ((await resolveOmieAccountCodeByName(credentials, payload.accountName)) ??
        (await resolveOmieAccountCodeByName(
          credentials,
          defaultAccountNameForMethod(payload.paymentMethodOmieCode)
        )) ??
        (await resolveOmieAccountCode(credentials)));
  const installmentCount =
    typeof payload.installmentCount === "number" && payload.installmentCount > 0
      ? Math.floor(payload.installmentCount)
      : 1;

  if (payload.operationType === "invoice") {
    if (!payload.productOmieId) {
      throw new Error("productOmieId obrigatorio para pedido de venda");
    }
    const parcelamento = buildOrderParcelamento(payload);
    const response = await callOmie<unknown, unknown>(
      credentials,
      "/produtos/pedido/",
      "IncluirPedido",
      {
        cabecalho: {
          codigo_pedido_integracao: integrationCode,
          codigo_cliente: customerOmieId,
          data_previsao: toOmieDate(payload.issueDate),
          // Etapa "50" = coluna "Faturar" do kanban de Vendas do OMIE: o pedido chega
          // pronto para faturar, e a emissao da NF-e e feita DENTRO do OMIE.
          etapa: "50",
          ...parcelamento.cabecalho,
          quantidade_itens: 1
        },
        det: [
          {
            ide: { codigo_item_integracao: toOmieIntegrationCode(`${payload.idempotencyKey}:1`) },
            produto: {
              codigo_produto: payload.productOmieId,
              quantidade: payload.quantity,
              valor_unitario: payload.unitPrice,
              tipo_desconto: "P",
              percentual_desconto: 0
            }
          }
        ],
        frete: buildOmieFreight(
          payload.freightTotalCents,
          payload.freightModalidade,
          payload.transport
        ),
        informacoes_adicionais: {
          codigo_categoria: "1.01.01",
          ...(accountCode !== null ? { codigo_conta_corrente: accountCode } : {}),
          ...(buildTransportAdditionalData(payload.transport) !== null
            ? { dados_adicionais_nf: buildTransportAdditionalData(payload.transport) }
            : {})
        },
        // Parcelamento informado (codigo_parcela "999"): leva os vencimentos e o
        // meio de pagamento (tPag da NF-e) por parcela.
        ...(parcelamento.listaParcelas !== null
          ? { lista_parcelas: parcelamento.listaParcelas }
          : {})
      }
    ).catch(async (error) => {
      // So aceita a consulta como fallback se ela realmente devolver o pedido;
      // caso contrario propaga o erro original do IncluirPedido (antes, uma
      // resposta vazia da consulta mascarava a causa real com
      // "OMIE nao retornou codigoPedido").
      const existing = await consultSalesOrderByIntegrationCode(
        credentials,
        integrationCode
      ).catch(() => null);
      if (existing && extractSalesOrderId(existing) !== null) return existing;
      throw error;
    });

    const orderId = extractSalesOrderId(response);
    if (!orderId) {
      throw new Error("OMIE nao retornou codigoPedido");
    }
    return { orderId, omieCustomerId: customerOmieId };
  }

  const serviceCodes = await resolveOmieServiceCodes(credentials);
  // OS (operacao interna): usa o codigo de parcela vinculado, senao localiza/cria
  // no cadastro; em ultimo caso "000" (a vista).
  const osParcelaCode =
    normalizeParcelaCode(payload.paymentTermOmieCode) ??
    (await ensureOmieParcelaCode(credentials, payload)) ??
    "000";
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
      cCodIntOS: integrationCode,
      nCodCli: customerOmieId,
      dDtPrevisao: toOmieDate(payload.issueDate),
      // Etapa "50" = "Faturar": a OS tambem e faturada dentro do OMIE.
      cEtapa: "50",
      cCodParc: osParcelaCode,
      nQtdeParc: installmentCount
    },
    ServicosPrestados: [
      {
        cDescServ: payload.serviceDescription || "Servico",
        // Obrigatorio no IncluirOS: "01" = tributado no municipio (padrao).
        cTribServ: "01",
        // Obrigatorio no IncluirOS: "N" = ISS nao retido (padrao para a operacao interna).
        cRetemISS: "N",
        ...(serviceCodes.municipal !== null ? { cCodServMun: serviceCodes.municipal } : {}),
        ...(serviceCodes.lc116 !== null ? { cCodServLC116: serviceCodes.lc116 } : {}),
        nQtde: payload.quantity,
        nValUnit: payload.unitPrice
      }
    ],
    InformacoesAdicionais: {
      cCodCateg: "1.01.01",
      ...(accountCode !== null ? { nCodCC: accountCode } : {})
    }
  }).catch(async (error) => {
    // Idempotencia: se a OS ja existe (reenvio apos erro desconhecido), consulta por
    // cCodIntOS e reaproveita o nCodOS; caso contrario propaga o erro original.
    const existing = await consultServiceOrderByIntegrationCode(credentials, integrationCode).catch(
      () => null
    );
    const existingId = extractServiceOrderId(existing);
    if (existingId !== null) return { nCodOS: existingId } as { nCodOS?: number; codigoOS?: number };
    throw error;
  });
  const orderId = response.nCodOS ?? response.codigoOS;
  if (!orderId) {
    throw new Error("OMIE nao retornou codigoOS");
  }
  return { orderId, omieCustomerId: customerOmieId };
}

async function consultServiceOrderByIntegrationCode(
  credentials: OmieCredentials,
  integrationCode: string
): Promise<unknown> {
  return callOmie<unknown, unknown>(credentials, "/servicos/os/", "ConsultarOS", {
    cCodIntOS: integrationCode
  });
}

function extractServiceOrderId(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const direct = toNumber(
    pickFirst(
      record.nCodOS as string | number | null | undefined,
      record.codigoOS as string | number | null | undefined
    )
  );
  if (direct !== null) return direct;
  // ConsultarOS pode aninhar a OS em Cabecalho/cabecalho.
  const header =
    (record.Cabecalho as Record<string, unknown> | undefined) ??
    (record.cabecalho as Record<string, unknown> | undefined);
  if (header) {
    const fromHeader = toNumber(
      pickFirst(
        header.nCodOS as string | number | null | undefined,
        header.codigoOS as string | number | null | undefined
      )
    );
    if (fromHeader !== null) return fromHeader;
  }
  return null;
}

// O OMIE exige uma conta corrente valida em informacoes_adicionais (enviar 0 gera
// "ERROR: - tag: [codigo_conta_corrente]"). Como a conta varia por tenant, resolvemos a
// primeira conta corrente cadastrada via ListarContasCorrentes e cacheamos por app_key.
// Falhas de consulta nao sao cacheadas para permitir nova tentativa no proximo job.
const omieAccountCodeCache = new Map<string, number>();

async function resolveOmieAccountCode(credentials: OmieCredentials): Promise<number | null> {
  const cached = omieAccountCodeCache.get(credentials.appKey);
  if (cached !== undefined) return cached;

  try {
    const response = await callOmie<unknown, Record<string, unknown>>(
      credentials,
      "/geral/contacorrente/",
      "ListarContasCorrentes",
      { pagina: 1, registros_por_pagina: 50 }
    );
    const accountCode = extractFirstAccountCode(response);
    if (accountCode !== null) {
      omieAccountCodeCache.set(credentials.appKey, accountCode);
    }
    return accountCode;
  } catch {
    return null;
  }
}

function extractAccountRows(
  response: Record<string, unknown> | null
): Record<string, unknown>[] {
  if (!response || typeof response !== "object") return [];
  const knownKeys = ["ListarContasCorrentes", "conta_corrente_lista", "contaCorrenteLista"];
  const lists = [
    ...knownKeys.map((key) => response[key]),
    ...Object.values(response).filter((value) => Array.isArray(value))
  ];
  const rows: Record<string, unknown>[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (entry && typeof entry === "object") rows.push(entry as Record<string, unknown>);
    }
  }
  return rows;
}

function accountRowCode(row: Record<string, unknown>): number | null {
  return toNumber(
    pickFirst(
      row.nCodCC as string | number | null | undefined,
      row.codigo_conta_corrente as string | number | null | undefined,
      row.codigoContaCorrente as string | number | null | undefined
    )
  );
}

function extractFirstAccountCode(response: Record<string, unknown> | null): number | null {
  for (const row of extractAccountRows(response)) {
    const code = accountRowCode(row);
    if (code !== null && code > 0) return code;
  }
  return null;
}

// "Achata" o nome da conta (sem acentos, espacos ou pontuacao) para casar variacoes de
// grafia entre a conta do KyberRock e a conta corrente do OMIE ("OMIE Cash" <-> "OMIECASH",
// "GetNet" <-> "Get Net"). Mesma regra usada no sync de contas correntes do desktop.
function canonicalizeAccountName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Cache das contas correntes por app_key: nome canonico -> nCodCC. Evita repetir o
// ListarContasCorrentes a cada pedido. Falhas nao sao cacheadas (permite nova tentativa).
const omieAccountsByCanonicalNameCache = new Map<string, Map<string, number>>();

async function loadOmieAccountsByCanonicalName(
  credentials: OmieCredentials
): Promise<Map<string, number>> {
  const cached = omieAccountsByCanonicalNameCache.get(credentials.appKey);
  if (cached !== undefined) return cached;

  const byName = new Map<string, number>();
  try {
    // Pagina o cadastro de contas correntes do OMIE ate um teto seguro.
    const pageSize = 50;
    for (let page = 1; page <= 20; page++) {
      const response = await callOmie<unknown, Record<string, unknown>>(
        credentials,
        "/geral/contacorrente/",
        "ListarContasCorrentes",
        { pagina: page, registros_por_pagina: pageSize }
      );
      const rows = extractAccountRows(response);
      if (rows.length === 0) break;
      for (const row of rows) {
        const code = accountRowCode(row);
        const rawName = row.descricao;
        const name = typeof rawName === "string" ? rawName.trim() : "";
        if (code === null || code <= 0 || !name) continue;
        const canonical = canonicalizeAccountName(name);
        // Primeira ocorrencia vence: mantem a conta correspondente estavel entre paginas.
        if (canonical && !byName.has(canonical)) byName.set(canonical, code);
      }
      if (rows.length < pageSize) break;
    }
  } catch {
    return byName;
  }
  if (byName.size > 0) omieAccountsByCanonicalNameCache.set(credentials.appKey, byName);
  return byName;
}

// Resolve o nCodCC da conta corrente do OMIE cujo nome canonico bate com o nome da conta
// vinculada ao meio de pagamento. Alem do casamento exato, aceita a UNICA conta cujo nome
// canonico contem o procurado (ex.: "Conta OMIE Cash" para "OMIE Cash"); com mais de uma
// candidata a correspondencia e ambigua e devolve null. Retorna null tambem quando nao ha
// nome ou correspondencia, caindo entao nos fallbacks seguintes.
async function resolveOmieAccountCodeByName(
  credentials: OmieCredentials,
  accountName: string | null | undefined
): Promise<number | null> {
  if (!accountName) return null;
  const canonical = canonicalizeAccountName(accountName);
  if (!canonical) return null;
  const byName = await loadOmieAccountsByCanonicalName(credentials);
  const exact = byName.get(canonical);
  if (exact !== undefined) return exact;
  const partial = [...byName.entries()].filter(([name]) => name.includes(canonical));
  return partial.length === 1 ? partial[0][1] : null;
}

/**
 * Vinculos padrao do KyberRock entre o meio de pagamento (codigo NFe/OMIE) e a conta
 * padrao que o recebe — os mesmos do seed do desktop (payment_methods -> accounts):
 * dinheiro -> Caixinha; PIX e boleto -> OMIE Cash; cartoes -> GetNet.
 *
 * Usado como fallback quando o payload nao trouxe nem o nCodCC nem o nome da conta
 * (desktop antigo, ou meio de pagamento local sem conta vinculada): resolve a conta
 * padrao pelo nome direto no OMIE em vez de cair na primeira conta corrente do tenant.
 * Quando o desktop manda a conta explicitamente (accountOmieCode/accountName), ela tem
 * prioridade — vinculos personalizados continuam respeitados.
 */
const DEFAULT_ACCOUNT_NAME_BY_METHOD_CODE = new Map<string, string>([
  ["01", "caixinha"], // dinheiro
  ["03", "getnet"], // cartao de credito
  ["04", "getnet"], // cartao de debito
  ["15", "omiecash"], // boleto
  ["17", "omiecash"] // pix
]);

function defaultAccountNameForMethod(methodCode: string | null | undefined): string | null {
  if (!methodCode) return null;
  return DEFAULT_ACCOUNT_NAME_BY_METHOD_CODE.get(methodCode.trim()) ?? null;
}

// O IncluirOS tambem exige o Codigo do Servico Municipal (cCodServMun) e o Codigo
// do Servico LC116 (cCodServLC116), ambos especificos do tenant (cadastro de
// servicos do OMIE). Buscamos o primeiro servico cadastrado via ListarCadastroServico
// e cacheamos por app_key; falhas nao sao cacheadas para permitir nova tentativa.
type OmieServiceCodes = { municipal: string | null; lc116: string | null };

const omieServiceCodesCache = new Map<string, OmieServiceCodes>();

async function resolveOmieServiceCodes(credentials: OmieCredentials): Promise<OmieServiceCodes> {
  const cached = omieServiceCodesCache.get(credentials.appKey);
  if (cached !== undefined) return cached;

  try {
    const response = await callOmie<unknown, unknown>(
      credentials,
      "/servicos/servico/",
      "ListarCadastroServico",
      { nPagina: 1, nRegPorPagina: 50 }
    );
    const codes: OmieServiceCodes = {
      municipal: findStringByKey(response, "cCodServMun"),
      lc116: findStringByKey(response, "cCodLC116") ?? findStringByKey(response, "cCodServLC116")
    };
    if (codes.municipal !== null || codes.lc116 !== null) {
      omieServiceCodesCache.set(credentials.appKey, codes);
    }
    return codes;
  } catch {
    return { municipal: null, lc116: null };
  }
}

function findStringByKey(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, key);
      if (found !== null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = findStringByKey(nested, key);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Codigos "modalidade" (modFrete) validos no frete do pedido de venda do OMIE. */
const OMIE_FREIGHT_MODALIDADES = new Set(["0", "1", "2", "3", "4", "9"]);

function normalizeFreightModalidade(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return OMIE_FREIGHT_MODALIDADES.has(trimmed) ? trimmed : null;
}

function buildOmieFreight(
  freightTotalCents: number | null | undefined,
  freightModalidade?: string | null,
  transport?: CreateOrderPayload["transport"]
): Record<string, unknown> {
  const hasValue = typeof freightTotalCents === "number" && freightTotalCents > 0;
  // Modalidade escolhida na operacao (CIF/FOB/terceiros/proprio/sem frete). Sem valor
  // valido, mantem o comportamento legado: "0" (CIF) quando ha valor, senao "9".
  const modalidade = normalizeFreightModalidade(freightModalidade) ?? (hasValue ? "0" : "9");

  // Dados de transporte da pesagem: placa, transportadora (codigo OMIE) e pesos da
  // carga. Granel sem embalagem: peso_bruto = peso_liquido = peso liquido pesado.
  const plate = transport?.plate?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  const carrierOmieId =
    typeof transport?.carrierOmieId === "number" && transport.carrierOmieId > 0
      ? transport.carrierOmieId
      : null;
  const cargoWeightKg =
    typeof transport?.cargoWeightKg === "number" && transport.cargoWeightKg > 0
      ? transport.cargoWeightKg
      : null;
  const ownVehicle = transport?.ownVehicle === true;

  // O OMIE exige a tag valor_frete sempre que o bloco frete e enviado (HTTP 500
  // "tag [valor] obrigatorio" quando ausente). Sem valor de frete, enviamos 0.
  return {
    modalidade,
    valor_frete: hasValue ? Math.round(freightTotalCents as number) / 100 : 0,
    ...(plate !== null ? { placa: plate } : {}),
    // Transporte proprio (3/4) nao leva transportadora — o emitente transporta.
    ...(carrierOmieId !== null && !ownVehicle ? { codigo_transportadora: carrierOmieId } : {}),
    ...(ownVehicle ? { veiculo_proprio: "S" } : {}),
    ...(cargoWeightKg !== null
      ? {
          peso_bruto: cargoWeightKg,
          peso_liquido: cargoWeightKg,
          quantidade_volumes: 1
        }
      : {})
  };
}

/**
 * Texto de transporte para os dados adicionais da NF-e (o motorista nao tem campo
 * proprio no pedido de venda do OMIE). Retorna null quando nao ha o que registrar.
 */
function buildTransportAdditionalData(
  transport?: CreateOrderPayload["transport"]
): string | null {
  if (!transport) return null;
  const parts: string[] = [];
  const driverName = transport.driverName?.trim();
  const plate = transport.plate?.trim().toUpperCase();
  if (driverName) parts.push(`Motorista: ${driverName}`);
  if (plate) parts.push(`Placa: ${plate}`);
  return parts.length > 0 ? parts.join(" - ") : null;
}

async function createAndBillOmieOrder(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<CreateAndBillOrderResult> {
  if (payload.operationType !== "invoice") {
    throw new Error("Faturamento automatico disponivel apenas para pedido de venda fiscal");
  }

  const { orderId, omieCustomerId } = await createOmieOrder(credentials, payload);
  const billing = await billSalesOrder(
    credentials,
    orderId,
    toOmieIntegrationCode(payload.idempotencyKey)
  );
  const consultedOrder = await consultSalesOrder(credentials, orderId).catch(() => null);
  const orderDocument = await getSalesOrderDocument(credentials, orderId).catch(() => null);
  const documentUrl =
    extractDocumentUrl(billing.raw) ??
    extractDocumentUrl(consultedOrder) ??
    extractDocumentUrl(orderDocument);

  return {
    orderId,
    omieCustomerId,
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

async function consultServiceOrder(credentials: OmieCredentials, orderId: number): Promise<unknown> {
  return callOmie<unknown, unknown>(credentials, "/servicos/os/", "ConsultarOS", {
    nCodOS: orderId
  });
}

// Faults do OMIE quando o registro ja nao existe (cancelamento idempotente).
function isOmieNotFoundFault(message: string): boolean {
  return /nao cadastrad|nao encontrad|not found|inexistente|nao existe/i.test(message);
}

// Faults que indicam que o pedido/OS nao pode ser excluido pelo estado (ja faturado,
// etapa avancada, NF emitida) — nao devem virar retry infinito.
function isOmieBlockedCancelFault(message: string): boolean {
  return /faturad|nota fiscal|nf-?e|etapa|nao pode ser excluid|cancelad[ao] no omie|ja faturado/i.test(
    message
  );
}

// Etapa >= "60" no OMIE indica pedido faturado; nesse caso nao tentamos excluir.
function isSalesOrderBilled(consult: unknown): boolean {
  const etapa = findStringByKey(consult, "etapa") ?? findStringByKey(consult, "cEtapa");
  if (etapa && /^\d+$/.test(etapa.trim())) {
    return Number(etapa.trim()) >= 60;
  }
  // Sinais de NF emitida no bloco de informacoes.
  const nfKey =
    findStringByKey(consult, "numero_nfe") ??
    findStringByKey(consult, "nNF") ??
    findStringByKey(consult, "chave_nfe");
  return nfKey !== null && nfKey.trim().length > 0;
}

type CancelOrderPayload = {
  operationId?: string;
  orderType: "sales" | "service";
  omieOrderId: number;
  reason?: string;
};

type CancelOrderResult = {
  ok: true;
  cancelled: boolean;
  alreadyCancelled?: boolean;
  blocked?: boolean;
  blockedReason?: string | null;
};

async function cancelOmieOrder(
  credentials: OmieCredentials,
  payload: CancelOrderPayload
): Promise<CancelOrderResult> {
  const isSales = payload.orderType === "sales";

  // 1) Consulta primeiro: idempotencia (ja excluido) e deteccao de faturamento.
  let consult: unknown = null;
  try {
    consult = isSales
      ? await consultSalesOrder(credentials, payload.omieOrderId)
      : await consultServiceOrder(credentials, payload.omieOrderId);
  } catch (error) {
    const message = getErrorMessage(error);
    if (isOmieNotFoundFault(message)) {
      return { ok: true, cancelled: false, alreadyCancelled: true };
    }
    throw error;
  }

  if (isSales && isSalesOrderBilled(consult)) {
    return {
      ok: true,
      cancelled: false,
      blocked: true,
      blockedReason:
        "Pedido faturado no OMIE (etapa 60 ou NF emitida); cancelamento/estorno manual necessario."
    };
  }

  // 2) Exclui o pedido/OS.
  try {
    if (isSales) {
      await callOmie<unknown, unknown>(credentials, "/produtos/pedido/", "ExcluirPedido", {
        codigo_pedido: payload.omieOrderId
      });
    } else {
      await callOmie<unknown, unknown>(credentials, "/servicos/os/", "ExcluirOS", {
        nCodOS: payload.omieOrderId
      });
    }
    return { ok: true, cancelled: true };
  } catch (error) {
    const message = getErrorMessage(error);
    if (isOmieNotFoundFault(message)) {
      return { ok: true, cancelled: false, alreadyCancelled: true };
    }
    if (isOmieBlockedCancelFault(message)) {
      return { ok: true, cancelled: false, blocked: true, blockedReason: message };
    }
    throw error;
  }
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
  const direct = toNumber(
    pickFirst(
      record.codigo_pedido as string | number | null | undefined,
      record.codigoPedido as string | number | null | undefined,
      record.nCodPed as string | number | null | undefined
    )
  );
  if (direct !== null) return direct;
  const header =
    record.cabecalho && typeof record.cabecalho === "object"
      ? (record.cabecalho as Record<string, unknown>)
      : null;
  const fromHeader = toNumber(
    pickFirst(
      header?.codigo_pedido as string | number | null | undefined,
      header?.codigoPedido as string | number | null | undefined
    )
  );
  if (fromHeader !== null) return fromHeader;
  // ConsultarPedido devolve o pedido aninhado em pedido_venda_produto.
  const nested = record.pedido_venda_produto ?? record.pedidoVendaProduto;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return extractSalesOrderId(nested);
  }
  if (Array.isArray(nested)) {
    for (const item of nested) {
      const found = extractSalesOrderId(item);
      if (found !== null) return found;
    }
  }
  return null;
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
  return activeOmieQueue.request<TParam, TResponse>({ credentials, endpoint, call, param });
}
