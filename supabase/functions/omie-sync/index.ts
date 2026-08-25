import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  CUSTOMER_REGISTRATION_FAULT_PREFIX,
  OMIE_CUSTOMER_TAG,
  OmieHttpError,
  OmieQueueManager,
  buildCustomerCadastroPayload,
  buildCustomerPayload,
  buildCustomerUpdateBody,
  customerRegistrationFaultMessage,
  formatOmieOrderInvoiceEmailList,
  pushCarrierToOmie as pushCarrierToOmieCore,
  resolveDuplicateCustomerId,
  syncCustomerInvoiceEmails as syncCustomerInvoiceEmailsCore,
  toOmieIntegrationCode,
  type OmieCredentials,
  type OmieCustomerRecommendations,
  type OmieRequester
} from "./omie-sync-core.ts";
import { classifyOmieCustomer } from "../_shared/omie-customer-classification.ts";
import {
  formatOmieDate,
  isAdvanceAccountName,
  mapAdvancesFromReceivables,
  planAdvanceSettlement,
  selectAdvanceCategoryCodes,
  selectOrderReceivables,
  type OmieCustomerAdvance,
  type OmieReceivableRaw
} from "../_shared/omie-customer-advances.ts";

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
  | "pull_customer_advances"
  | "settle_advance"
  | "list_document_types"
  | "create_order"
  | "create_and_bill_order"
  | "check_order_billing"
  | "cancel_order"
  | "push_customer"
  | "push_carrier";

type PullResume = {
  customersPage?: number;
  productsPage?: number;
  paymentTermsPage?: number;
  categoriesPage?: number;
  customersFinished?: boolean;
  productsFinished?: boolean;
  paymentTermsFinished?: boolean;
  categoriesFinished?: boolean;
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
  /** `recomendacoes.email_fatura`: quem recebe a NF-e e o boleto (aba Fiscal). */
  fiscalEmails: string | null;
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

/**
 * Categoria do plano gerencial do OMIE: e o `codigo_categoria` de
 * `informacoes_adicionais` no pedido de venda, que classifica a receita no DRE.
 * Espelhada no desktop (omie_categories) para cada produto apontar a sua.
 */
type OmieCategory = {
  code: string;
  description: string;
  categoryType: string | null;
  parentCode: string | null;
  isActive: boolean;
};

type CreateOrderPayload = {
  localOperationId?: string;
  /**
   * Codigo sequencial da pesagem no KyberRock (o mesmo 000123 impresso no cupom). E o
   * elo que o OMIE enxerga: vai no campo de dados adicionais do pedido de venda e da OS
   * para quem abrir o registro la saber de qual pesagem ele nasceu. O `localOperationId`
   * (UUID) continua indo na OS por ser o identificador global, mas nao serve para achar
   * nada de olho — o codigo serve.
   */
  operationCode?: number | null;
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
    /**
     * UF de emplacamento do veiculo (`placa_estado` do bloco frete). A NF-e pede placa E UF
     * no transporte; vem do cadastro de veiculos do desktop, sincronizado do OMIE.
     */
    plateState?: string | null;
    driverName?: string | null;
    /** Codigo OMIE (codigo_cliente_omie) da transportadora vinculada ao veiculo. */
    carrierOmieId?: number | null;
    /**
     * Nome da transportadora. A OS nao tem bloco `frete` para referenciar o cadastro
     * pelo codigo, entao na operacao interna ela entra pelo nome em cDadosAdicNF.
     */
    carrierName?: string | null;
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
   * "17" PIX, "15" boleto...). Vai como `meio_pagamento` (tPag da NF-e) em cada parcela
   * do parcelamento informado do pedido e define o "gerar boleto" da parcela no pedido
   * e na OS (ver boletoGenerationFlag).
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
   * Categoria do plano gerencial (codigo_categoria) em que a venda entra no OMIE,
   * resolvida no desktop a partir do produto (senao padrao da unidade). Ausente ->
   * OMIE_DEFAULT_CATEGORY_CODE, o comportamento historico.
   */
  omieCategoryCode?: string | null;
  /**
   * Cadastro do cliente para criar/localizar no OMIE na hora do envio quando ele ainda
   * nao tem codigo OMIE (customerOmieId ausente/0). O edge faz find-or-create por CNPJ/CPF
   * (pushCustomerToOmie) e usa o codigo resultante no pedido, devolvendo omieCustomerId
   * para o desktop vincular o cliente localmente.
   */
  customer?: PushCustomerPayload;
  /**
   * Cadastro da transportadora para criar/localizar no OMIE ANTES de montar o pedido,
   * quando ela ainda nao tem codigo la (transport.carrierOmieId ausente). O codigo
   * resultante vai em `codigo_transportadora` do bloco frete e volta como omieCarrierId
   * para o desktop vincular a transportadora localmente. Falhar aqui NAO derruba o
   * pedido: ele segue sem transportadora, como antes.
   */
  carrier?: PushCarrierPayload;
  /**
   * Destinatarios da NF DESTE documento: os e-mails da aba Fiscal do cadastro do cliente,
   * enviados pelo desktop junto do pedido. Vao para "Enderecos de e-mail que recebem a NF"
   * do pedido de venda (`informacoes_adicionais.utilizar_emails`) e da OS
   * (`Email.cEnviarPara`).
   *
   * Ausente (desktop antigo) -> cai no `customer.fiscalEmails` do cadastro que sobe junto.
   * Vazio nos dois -> o campo nao e enviado e o OMIE usa o cadastro do cliente, como antes.
   */
  invoiceEmails?: string;
  /**
   * Numero da NF-e de VENDA PARA ENTREGA FUTURA que esta carga esta entregando, resolvida
   * pelo desktop no par (cliente, produto) da pesagem.
   *
   * A pedreira emite uma NF-e de simples faturamento (CFOP 5.922/6.922) e o cliente vai
   * retirando a carga aos poucos; cada retirada e uma remessa de entrega futura (CFOP
   * 5.116/5.117) que precisa REFERENCIAR aquele faturamento. O `IncluirPedido` nao expoe
   * o grupo `NFref` da NF-e, entao a referencia vai por extenso nos dados adicionais
   * (`informacoes_adicionais.dados_adicionais_nf`), que e o que alimenta o `infCpl`.
   *
   * Ausente/vazio (o caso comum, e todo desktop antigo) -> o texto sai como sempre saiu.
   */
  futureBillingNfeNumber?: string;
  idempotencyKey: string;
};

type CreateAndBillOrderResult = {
  orderId: number;
  /** Numero visivel do pedido no OMIE (numero_pedido); null quando o OMIE nao devolveu. */
  orderNumber: string | null;
  omieCustomerId: number;
  omieCarrierId: number | null;
  billed: boolean;
  billingStatusCode: string | null;
  billingStatusMessage: string | null;
  /**
   * Numero da NOTA FISCAL emitida agora. Vem da consulta pos-faturamento, a mesma que a
   * conferencia usa — e e a unica chance de captura-lo por aqui: a reconciliacao so
   * pergunta pelos documentos que AINDA nao constam faturados, e este ja nasce faturado.
   */
  invoiceNumber: string | null;
  documentUrl: string | null;
};

type PushCustomerPayload = {
  localCustomerId: string;
  omieCustomerId?: number;
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjCpf?: string;
  /** E-mail de CONTATO do cliente (campo `email` do cadastro do OMIE). */
  email?: string;
  /**
   * Destinatarios da NF-e e do boleto (aba Fiscal do cadastro do KyberRock -> tag
   * `email_fatura` do OMIE). String vazia limpa o campo la; `undefined` (chamador que
   * nao gerencia o campo, como o push de transportadora) nao mexe nele.
   */
  fiscalEmails?: string;
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

type SupabaseQueryResult = { data: unknown; error: { message: string } | null };

/**
 * Client aceito pelo espelho de adiantamentos: apenas o encadeamento realmente
 * usado (`select().eq().in()` e `upsert()`), sem `single()`. Declarar so isso
 * mantem o client real do supabase-js compativel — o builder do postgrest-js e
 * "thenable", mas nao e um `Promise` completo, entao exigir mais do que o
 * necessario quebraria a tipagem.
 */
type AdvanceProjectionClient = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): { in(column: string, values: Array<string | number>): PromiseLike<SupabaseQueryResult> };
    };
    upsert(
      values: Array<Record<string, unknown>>,
      options?: { onConflict?: string; ignoreDuplicates?: boolean }
    ): PromiseLike<SupabaseQueryResult>;
  };
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
        categories: pull.categories,
        checkedAt,
        pageSize: pull.pageSize,
        pagination: pull.pagination
      });
    }

    if (action === "pull_customer_advances") {
      const page = await pullCustomerAdvancesPage(
        credentials,
        body.payload as PullCustomerAdvancesPayload | undefined
      );
      const projection = await projectCustomerAdvances(
        // O tipo minimo do client no handler (`select().eq().single()`) nao cobre
        // o encadeamento do espelho; alargar aquele tipo faz o supabase-js real
        // estourar a profundidade de instanciacao do TS. Os dois clients (real e
        // stub dos testes) atendem AdvanceProjectionClient em tempo de execucao.
        supabase as unknown as AdvanceProjectionClient,
        typedDevice.company_id,
        page.advances
      );
      return jsonResponse({
        ok: true,
        companyId: typedDevice.company_id,
        unitId: typedDevice.unit_id,
        categoryCodes: page.categoryCodes,
        page: page.page,
        finished: page.finished,
        totalPages: page.totalPages,
        totalRecords: page.totalRecords,
        returned: page.returned,
        advances: page.advances.length,
        ...projection
      });
    }

    if (action === "settle_advance") {
      const result = await settleOrderWithAdvance(
        credentials,
        body.payload as SettleAdvancePayload
      );
      return jsonResponse({ ok: true, ...result });
    }

    if (action === "list_document_types") {
      const documentTypes = await listDocumentTypes(credentials);
      return jsonResponse({ ok: true, documentTypes });
    }

    if (action === "create_order") {
      const payload = body.payload as CreateOrderPayload;
      const { orderId, orderNumber, omieCustomerId, omieCarrierId } = await createOmieOrder(
        credentials,
        payload
      );
      return jsonResponse({ ok: true, orderId, orderNumber, omieCustomerId, omieCarrierId });
    }

    if (action === "create_and_bill_order") {
      const payload = body.payload as CreateOrderPayload;
      const result = await createAndBillOmieOrder(credentials, payload);
      return jsonResponse({ ok: true, ...result });
    }

    // Volta do OMIE: quais pedidos/OS ja foram faturados la. E o unico jeito de o
    // KyberRock saber de um faturamento feito a mao dentro do OMIE.
    if (action === "check_order_billing") {
      const results = await checkOmieOrdersBilling(
        credentials,
        body.payload as CheckOrderBillingPayload | undefined
      );
      return jsonResponse({ ok: true, results });
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
  /** Cadastros que o OMIE devolveu sem codigo ou sem razao social. */
  invalid: number;
  /** Cadastros validos que ficaram de fora por serem fornecedor puro. */
  supplierOnly: number;
};

function emptyPage<T>(page: number): PageResult<T> {
  return { items: [], page, finished: true, totalPages: null, totalRecords: null };
}

function emptyCustomerPage(page: number): CustomersPageResult {
  return {
    ...emptyPage<OmieCustomer>(page),
    carriers: [],
    returned: 0,
    invalid: 0,
    supplierOnly: 0
  };
}

async function pullReferenceDataPage(
  credentials: OmieCredentials,
  resume: PullResume
): Promise<{
  customers: OmieCustomer[];
  products: OmieProduct[];
  paymentTerms: OmiePaymentTerm[];
  suppliers: OmieSupplier[];
  categories: OmieCategory[];
  pageSize: number;
  pagination: Record<string, number | boolean | null>;
}> {
  const customersPage = resume.customersPage ?? 1;
  const productsPage = resume.productsPage ?? 1;
  const paymentTermsPage = resume.paymentTermsPage ?? 1;
  const categoriesPage = resume.categoriesPage ?? 1;
  const customersResult = resume.customersFinished
    ? emptyCustomerPage(customersPage)
    : await listCustomersPage(credentials, customersPage);
  const productsResult = resume.productsFinished
    ? emptyPage<OmieProduct>(productsPage)
    : await listProductsPage(credentials, productsPage);
  const paymentTermsResult = resume.paymentTermsFinished
    ? emptyPage<OmiePaymentTerm>(paymentTermsPage)
    : await listOptionalPaymentTermsPage(credentials, paymentTermsPage);
  const categoriesResult = resume.categoriesFinished
    ? emptyPage<OmieCategory>(categoriesPage)
    : await listOptionalCategoriesPage(credentials, categoriesPage);

  return {
    customers: customersResult.items,
    products: productsResult.items,
    paymentTerms: paymentTermsResult.items,
    suppliers: customersResult.carriers,
    categories: categoriesResult.items,
    pageSize: PAGE_SIZE,
    pagination: {
      categoriesPage: categoriesResult.page,
      categoriesReturned: categoriesResult.items.length,
      categoriesFinished: categoriesResult.finished,
      categoriesTotalPages: categoriesResult.totalPages,
      categoriesTotalRecords: categoriesResult.totalRecords,
      customersPage: customersResult.page,
      customersReturned: customersResult.returned,
      customersInvalid: customersResult.invalid,
      customersSupplierOnly: customersResult.supplierOnly,
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

/**
 * Chave do cache de paginas por conta OMIE. Precisa incluir o segredo: a app_key
 * identifica a aplicacao, nao a empresa, entao duas pedreiras com contas OMIE
 * diferentes na mesma app_key compartilhariam pagina cacheada — cada uma leria o
 * cadastro da outra.
 */
function omieTenantKey(credentials: OmieCredentials): string {
  return `${credentials.appKey}:${credentials.appSecret}`;
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
  const cacheKey = `clientes:${omieTenantKey(credentials)}:${page}`;
  const cached = getCachedPage<OmieCustomer>(cacheKey);
  if (cached) {
    return {
      items: cached.items.filter(isOmieCustomer),
      carriers: cached.items.filter(isOmieCarrier).map(mapCustomerToCarrier),
      returned: cached.returned,
      invalid: cached.returned - cached.items.length,
      supplierOnly: cached.items.filter(isOmieSupplierOnly).length,
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
    items: items.filter(isOmieCustomer),
    carriers: items.filter(isOmieCarrier).map(mapCustomerToCarrier),
    returned: rawItems.length,
    invalid: rawItems.length - items.length,
    supplierOnly: items.filter(isOmieSupplierOnly).length,
    page,
    finished,
    totalPages,
    totalRecords
  };
}

type OmieCustomerRaw = {
  recomendacoes?: OmieCustomerRecommendations;
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
    // O que estiver configurado a mao no OMIE aparece na aba Fiscal do cadastro, em vez
    // de ser sobrescrito as cegas no proximo push (ver syncCustomerInvoiceEmails).
    fiscalEmails:
      typeof item.recomendacoes?.email_fatura === "string"
        ? pickFirst(item.recomendacoes.email_fatura)
        : null,
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
  const cacheKey = `produtos:${omieTenantKey(credentials)}:${page}`;
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

function isOmieCustomer(customer: OmieCustomer): boolean {
  return classifyOmieCustomer(customer.tagsJson, customer.customerType).isCustomer;
}

function isOmieCarrier(customer: OmieCustomer): boolean {
  return classifyOmieCustomer(customer.tagsJson, customer.customerType).isCarrier;
}

/** Cadastro que nao entra nem como cliente nem como transportadora (fornecedor puro). */
function isOmieSupplierOnly(customer: OmieCustomer): boolean {
  const { isCustomer, isCarrier } = classifyOmieCustomer(customer.tagsJson, customer.customerType);
  return !isCustomer && !isCarrier;
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
  const cacheKey = `parcelas:${omieTenantKey(credentials)}:${page}`;
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

type OmieCategoryRaw = {
  codigo?: string | number;
  codigo_categoria?: string | number;
  descricao?: string;
  descricao_padrao?: string;
  tipo_categoria?: string;
  categoria_superior?: string;
  conta_inativa?: string;
  nao_exibir?: string;
};

/**
 * Uma pagina do plano gerencial (ListarCategorias). Sem esta etapa o espelho
 * omie_categories do desktop ficava vazio pelo caminho da nuvem — que e o unico
 * que a pedreira usa — e todo pedido caia na categoria fixa "1.01.01".
 */
async function listCategoriesPage(
  credentials: OmieCredentials,
  page: number
): Promise<PageResult<OmieCategory>> {
  const cacheKey = `categorias:${omieTenantKey(credentials)}:${page}`;
  const cached = getCachedPage<OmieCategory>(cacheKey);
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
    { pagina: number; registros_por_pagina: number },
    {
      pagina?: number;
      total_de_paginas?: number;
      total_de_registros?: number;
      categoria_cadastro?: OmieCategoryRaw[];
      categoriaCadastro?: OmieCategoryRaw[];
    } | null
  >(credentials, "/geral/categorias/", "ListarCategorias", {
    pagina: page,
    registros_por_pagina: PAGE_SIZE
  });

  const rawItems = response?.categoria_cadastro ?? response?.categoriaCadastro ?? [];
  const items: OmieCategory[] = [];
  for (const item of rawItems) {
    const category = mapOmieCategoryRaw(item);
    if (category) items.push(category);
  }

  const totalPages = toIntOrNull(response?.total_de_paginas);
  const totalRecords = toIntOrNull(response?.total_de_registros);
  const finished = computeFinished(page, rawItems.length, totalPages);

  setCachedPage(cacheKey, items, finished, totalPages, totalRecords, rawItems.length);
  return { items, page, finished, totalPages, totalRecords };
}

/**
 * Categoria e um extra do pull: se o endpoint nao existir para o tenant, o
 * cadastro de clientes/produtos (o que a balanca precisa para operar) nao pode
 * cair junto.
 */
async function listOptionalCategoriesPage(
  credentials: OmieCredentials,
  page: number
): Promise<PageResult<OmieCategory>> {
  try {
    return await listCategoriesPage(credentials, page);
  } catch (error) {
    if (isCategoriesUnavailableError(error)) return emptyPage<OmieCategory>(page);
    throw error;
  }
}

function isCategoriesUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /OMIE HTTP 404:.*ListarCategorias|\/geral\/categorias\//i.test(error.message);
}

function mapOmieCategoryRaw(item: OmieCategoryRaw): OmieCategory | null {
  if (!item || typeof item !== "object") return null;
  const code = pickFirstAsString(item.codigo, item.codigo_categoria);
  const description = pickFirst(item.descricao, item.descricao_padrao);
  if (!code || !description) return null;
  // `nao_exibir` marca categorias totalizadoras (estruturais): o OMIE recusa o
  // pedido quando o codigo nao e lancavel, entao elas entram como inativas para
  // ficarem fora da escolha do produto.
  const hidden = (item.nao_exibir ?? "").trim().toUpperCase() === "S";
  const inactive = (item.conta_inativa ?? "").trim().toUpperCase() === "S";
  return {
    code,
    description,
    categoryType: item.tipo_categoria?.trim() || null,
    parentCode: item.categoria_superior?.trim() || null,
    isActive: !hidden && !inactive
  };
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
    installmentCount: toNumber(
      pickFirst(item.nParcelas, item.nNumeroParcelas, item.numero_parcelas)
    ),
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

type PullCustomerAdvancesPayload = {
  /** Pagina de ListarContasReceber (1-based). */
  page?: number;
  /** Inicio da janela de inclusao/alteracao (ISO yyyy-mm-dd). */
  startDate?: string;
  /** Fim da janela de inclusao/alteracao (ISO yyyy-mm-dd). */
  endDate?: string;
  /** Categorias de adiantamento ja resolvidas num ciclo anterior do desktop. */
  categoryCodes?: string[];
  /** Restringe a um cliente (codigo OMIE), para conferencia pontual. */
  customerOmieCode?: number;
};

type CustomerAdvancesPageResult = {
  advances: OmieCustomerAdvance[];
  categoryCodes: string[];
  page: number;
  finished: boolean;
  totalPages: number | null;
  totalRecords: number | null;
  /** Titulos que o OMIE devolveu na pagina (adiantamentos ou nao). */
  returned: number;
};

/** Teto de paginas do plano de contas ao procurar as categorias de adiantamento. */
const ADVANCE_CATEGORY_SCAN_MAX_PAGES = 20;

/**
 * Adiantamentos de clientes: os titulos a receber classificados numa categoria
 * de adiantamento e ja recebidos. O financeiro e feito no OMIE, entao o desktop
 * so espelha esses valores no extrato de credito para abater as compras.
 *
 * A janela filtra por inclusao/alteracao (nao por vencimento) porque o que muda
 * o saldo e a baixa ou o cancelamento do titulo, feitos depois da criacao.
 */
async function pullCustomerAdvancesPage(
  credentials: OmieCredentials,
  payload: PullCustomerAdvancesPayload = {}
): Promise<CustomerAdvancesPageResult> {
  const page = Math.max(1, Math.trunc(payload?.page ?? 1));
  const categoryCodes = payload?.categoryCodes?.length
    ? [...new Set(payload.categoryCodes)]
    : await resolveAdvanceCategoryCodes(credentials);

  // Sem categoria de adiantamento no plano de contas nao ha o que espelhar —
  // e nao adianta varrer o contas a receber inteiro atras de nada.
  if (categoryCodes.length === 0) {
    return {
      advances: [],
      categoryCodes,
      page,
      finished: true,
      totalPages: null,
      totalRecords: null,
      returned: 0
    };
  }

  let response: {
    total_de_paginas?: number;
    total_de_registros?: number;
    conta_receber_cadastro?: OmieReceivableRaw[];
    contaReceberCadastro?: OmieReceivableRaw[];
  } | null;
  try {
    response = await callOmie<
      Record<string, unknown>,
      {
        total_de_paginas?: number;
        total_de_registros?: number;
        conta_receber_cadastro?: OmieReceivableRaw[];
        contaReceberCadastro?: OmieReceivableRaw[];
      } | null
    >(credentials, "/financas/contareceber/", "ListarContasReceber", {
      pagina: page,
      registros_por_pagina: PAGE_SIZE,
      apenas_importado_api: "N",
      filtrar_apenas_titulos_em_aberto: "N",
      ...(payload?.startDate ? { filtrar_por_data_de: formatOmieDate(payload.startDate) } : {}),
      ...(payload?.endDate ? { filtrar_por_data_ate: formatOmieDate(payload.endDate) } : {}),
      ...(payload?.customerOmieCode ? { filtrar_cliente: payload.customerOmieCode } : {})
    });
  } catch (error) {
    // Tenant sem contas a receber no periodo: o OMIE responde com faultstring em
    // vez de lista vazia. Isso encerra a pagina, nao o ciclo de sincronizacao.
    if (!isEmptyReceivablesError(error)) throw error;
    response = null;
  }

  const rawItems = response?.conta_receber_cadastro ?? response?.contaReceberCadastro ?? [];
  const advances = mapAdvancesFromReceivables(rawItems, new Set(categoryCodes));
  const totalPages = toIntOrNull(response?.total_de_paginas);
  const totalRecords = toIntOrNull(response?.total_de_registros);

  return {
    advances,
    categoryCodes,
    page,
    finished: computeFinished(page, rawItems.length, totalPages),
    totalPages,
    totalRecords,
    returned: rawItems.length
  };
}

/** Linha do extrato de credito espelhada do OMIE, no formato do desktop-pull. */
type CreditMovementRow = {
  id: string;
  company_id: string;
  customer_id: string;
  operation_id: string | null;
  movement_type: "credit" | "manual_adjustment";
  amount_cents: number;
  balance_after_cents: number;
  reason: string | null;
  source: string;
  omie_title_id: number;
  created_at: string;
  updated_at: string;
};

type ProjectAdvancesResult = {
  /** Lancamentos criados neste ciclo, para o desktop aplicar sem esperar o pull. */
  movements: CreditMovementRow[];
  /** Adiantamentos novos espelhados. */
  imported: number;
  /** Adiantamentos que mudaram no OMIE (baixa parcial, cancelamento) e foram acertados. */
  adjusted: number;
  /** Adiantamentos ja espelhados e sem diferenca. */
  unchanged: number;
  /** Titulos de clientes que ainda nao existem na nuvem desta pedreira. */
  unknownCustomers: number;
};

/**
 * Espelha os adiantamentos do OMIE no extrato de credito da nuvem.
 *
 * Quem escreve e a Edge Function, nunca o desktop: o titulo do OMIE e a chave de
 * idempotencia e um unico escritor impede que duas balancas sincronizando ao
 * mesmo tempo somem o mesmo adiantamento duas vezes. O desktop recebe as linhas
 * criadas na resposta (e, nos ciclos seguintes, pelo desktop-pull) e recalcula o
 * saldo pelo log, como faz com qualquer movimento vindo de outra maquina.
 *
 * A diferenca e sempre lancada como delta contra o que ja foi espelhado daquele
 * titulo, entao reprocessar a mesma pagina nao muda o saldo, e uma baixa parcial
 * ou um cancelamento no OMIE viram um acerto no extrato.
 */
async function projectCustomerAdvances(
  supabase: AdvanceProjectionClient,
  companyId: string,
  advances: OmieCustomerAdvance[]
): Promise<ProjectAdvancesResult> {
  const empty: ProjectAdvancesResult = {
    movements: [],
    imported: 0,
    adjusted: 0,
    unchanged: 0,
    unknownCustomers: 0
  };
  if (advances.length === 0) return empty;

  const omieCodes = [...new Set(advances.map((advance) => advance.customerOmieCode))];
  const customerResult = await supabase
    .from("customers")
    .select("id, omie_customer_id")
    .eq("company_id", companyId)
    .in("omie_customer_id", omieCodes);
  if (customerResult.error) {
    throw new Error(`Falha ao localizar clientes do adiantamento: ${customerResult.error.message}`);
  }

  const customerRows =
    (customerResult.data as Array<{ id: string; omie_customer_id: number | null }> | null) ?? [];
  const customerIdByOmieCode = new Map<number, string>();
  for (const row of customerRows) {
    if (row.omie_customer_id !== null) customerIdByOmieCode.set(row.omie_customer_id, row.id);
  }

  const customerIds = [...new Set([...customerIdByOmieCode.values()])];
  if (customerIds.length === 0) {
    return { ...empty, unknownCustomers: advances.length };
  }

  const movementResult = await supabase
    .from("customer_credit_movements")
    .select("customer_id, movement_type, amount_cents, omie_title_id")
    .eq("company_id", companyId)
    .in("customer_id", customerIds);
  if (movementResult.error) {
    throw new Error(`Falha ao ler o extrato de credito: ${movementResult.error.message}`);
  }

  const balanceByCustomer = new Map<string, number>();
  const mirroredByTitle = new Map<number, number>();
  const movementsByTitle = new Map<number, number>();
  const movementRows =
    (movementResult.data as Array<{
      customer_id: string;
      movement_type: string;
      amount_cents: number | null;
      omie_title_id: number | null;
    }> | null) ?? [];
  for (const row of movementRows) {
    const signed = signedMovementCents(row.movement_type, row.amount_cents ?? 0);
    balanceByCustomer.set(row.customer_id, (balanceByCustomer.get(row.customer_id) ?? 0) + signed);
    if (row.omie_title_id !== null) {
      mirroredByTitle.set(
        row.omie_title_id,
        (mirroredByTitle.get(row.omie_title_id) ?? 0) + signed
      );
      movementsByTitle.set(row.omie_title_id, (movementsByTitle.get(row.omie_title_id) ?? 0) + 1);
    }
  }

  const now = new Date().toISOString();
  const result: ProjectAdvancesResult = { ...empty, movements: [] };
  const advanceCentsByCustomer = new Map<string, number>();
  const titlesByCustomer = new Map<string, number[]>();

  for (const advance of advances) {
    const customerId = customerIdByOmieCode.get(advance.customerOmieCode);
    if (!customerId) {
      result.unknownCustomers++;
      continue;
    }

    const mirrored = mirroredByTitle.get(advance.titleId) ?? 0;
    advanceCentsByCustomer.set(
      customerId,
      (advanceCentsByCustomer.get(customerId) ?? 0) + advance.amountCents
    );
    titlesByCustomer.set(customerId, [
      ...(titlesByCustomer.get(customerId) ?? []),
      advance.titleId
    ]);

    const delta = advance.amountCents - mirrored;
    if (delta === 0) {
      result.unchanged++;
      continue;
    }

    const sequence = movementsByTitle.get(advance.titleId) ?? 0;
    const balanceAfter = (balanceByCustomer.get(customerId) ?? 0) + delta;
    balanceByCustomer.set(customerId, balanceAfter);
    mirroredByTitle.set(advance.titleId, mirrored + delta);
    movementsByTitle.set(advance.titleId, sequence + 1);
    if (mirrored === 0 && delta > 0) result.imported++;
    else result.adjusted++;

    result.movements.push({
      id: `omie-adv-${companyId}-${advance.titleId}-${sequence}`,
      company_id: companyId,
      customer_id: customerId,
      operation_id: null,
      // Delta positivo entra como credito; negativo (estorno/baixa parcial
      // desfeita no OMIE) entra como acerto assinado, que o saldo soma igual.
      movement_type: delta > 0 ? "credit" : "manual_adjustment",
      amount_cents: delta,
      balance_after_cents: balanceAfter,
      reason: advanceReason(advance, delta),
      source: "omie",
      omie_title_id: advance.titleId,
      created_at: now,
      updated_at: now
    });
  }

  if (result.movements.length > 0) {
    const { error } = await supabase
      .from("customer_credit_movements")
      .upsert(result.movements, { onConflict: "id", ignoreDuplicates: true });
    // Conflito de id significa que outra balanca ja espelhou o mesmo titulo: o
    // ciclo seguinte recalcula o delta e converge. Erro real interrompe o pull.
    if (error) throw new Error(`Falha ao espelhar adiantamentos: ${error.message}`);
  }

  const balanceRows = [...advanceCentsByCustomer.keys()].map((customerId) => ({
    customer_id: customerId,
    company_id: companyId,
    balance_cents: balanceByCustomer.get(customerId) ?? 0,
    omie_source_json: {
      advanceCents: advanceCentsByCustomer.get(customerId) ?? 0,
      titleIds: titlesByCustomer.get(customerId) ?? [],
      syncedAt: now
    },
    last_synced_at: now,
    updated_at: now
  }));
  if (balanceRows.length > 0) {
    await supabase
      .from("customer_credit_balances")
      .upsert(balanceRows, { onConflict: "customer_id" });
  }

  return result;
}

function signedMovementCents(movementType: string, amountCents: number): number {
  return movementType === "debit_product" || movementType === "debit_freight"
    ? -amountCents
    : amountCents;
}

function advanceReason(advance: OmieCustomerAdvance, delta: number): string {
  const document = advance.documentNumber ? ` doc ${advance.documentNumber}` : "";
  if (advance.cancelled) return `Adiantamento OMIE #${advance.titleId} cancelado${document}`;
  if (delta < 0) return `Acerto do adiantamento OMIE #${advance.titleId}${document}`;
  const received = advance.receivedDate ? ` em ${advance.receivedDate}` : "";
  return `Adiantamento OMIE #${advance.titleId}${document}${received}`;
}

type SettleAdvancePayload = {
  /** Operacao local que consumiu o adiantamento (rastreio nos dois lados). */
  localOperationId: string;
  /** Codigo OMIE do cliente dono do adiantamento. */
  customerOmieId: number;
  /** nCodPed do pedido de venda (ou nCodOS da ordem de servico). */
  omieOrderId: number;
  /** Valor a amortizar do adiantamento, em centavos. */
  amountCents: number;
  /** Data de emissao do pedido (ISO), usada para achar os titulos gerados. */
  issueDate?: string;
  /** Conta corrente de adiantamentos (nCodCC), quando ja configurada. */
  advanceAccountCode?: number;
  /** Base da chave idempotente da baixa. */
  idempotencyKey: string;
};

type SettleAdvanceResult = {
  /** Valor efetivamente baixado nesta chamada, em centavos. */
  settledCents: number;
  /** Titulos baixados (id + valor). */
  titles: Array<{ titleId: number; amountCents: number }>;
  /** Conta corrente de adiantamento usada (devolvida para o desktop guardar). */
  advanceAccountCode: number | null;
  /** True quando o pedido ainda nao gerou titulo a receber (tentar de novo). */
  pendingReceivable: boolean;
  message: string | null;
};

/** Dias antes da emissao do pedido na busca dos titulos gerados por ele. */
const SETTLE_LOOKBACK_DAYS = 3;
/** Paginas de contas a receber varridas atras dos titulos do pedido. */
const SETTLE_RECEIVABLE_MAX_PAGES = 5;
/** Teto de paginas de contas correntes ao procurar a conta de adiantamento. */
const ADVANCE_ACCOUNT_SCAN_MAX_PAGES = 10;

/**
 * Amortiza no OMIE o adiantamento que a compra consumiu no KyberRock.
 *
 * O dinheiro do cliente esta na conta corrente de adiantamentos do OMIE; quando
 * a venda e faturada, o titulo a receber correspondente e baixado contra essa
 * conta — e assim o saldo de adiantamento cai la como caiu aqui. Sem isso, o
 * KyberRock debitava o saldo e o OMIE continuava mostrando o adiantamento
 * inteiro, exigindo conferencia manual do financeiro.
 *
 * Idempotente pelo `codigo_baixa_integracao` (derivado da chave da operacao +
 * titulo): reexecutar o job nao baixa o mesmo titulo duas vezes.
 */
async function settleOrderWithAdvance(
  credentials: OmieCredentials,
  payload: SettleAdvancePayload
): Promise<SettleAdvanceResult> {
  const amountCents = Math.trunc(payload?.amountCents ?? 0);
  if (!payload?.omieOrderId || amountCents <= 0) {
    return {
      settledCents: 0,
      titles: [],
      advanceAccountCode: payload?.advanceAccountCode ?? null,
      pendingReceivable: false,
      message: "Nada a amortizar."
    };
  }

  const advanceAccountCode =
    payload.advanceAccountCode ?? (await resolveAdvanceAccountCode(credentials));
  if (!advanceAccountCode) {
    throw new Error(
      "Conta corrente de adiantamento nao encontrada no OMIE. " +
        "Cadastre a conta 'Adiantamento de Clientes' ou informe a conta nas configuracoes."
    );
  }

  const receivables = await findOrderReceivables(credentials, payload);
  if (receivables.length === 0) {
    // Titulo ainda nao gerado (faturamento recem-enviado): o job volta para a
    // fila e tenta de novo, em vez de dar a operacao como amortizada.
    return {
      settledCents: 0,
      titles: [],
      advanceAccountCode,
      pendingReceivable: true,
      message: "Pedido ainda sem titulo a receber no OMIE."
    };
  }

  const steps = planAdvanceSettlement(receivables, amountCents);
  const settled: Array<{ titleId: number; amountCents: number }> = [];
  for (const step of steps) {
    await settleReceivableWithAdvance(credentials, {
      titleId: step.titleId,
      amountCents: step.amountCents,
      advanceAccountCode,
      integrationCode: toOmieIntegrationCode(`${payload.idempotencyKey}:adv:${step.titleId}`),
      observation: `Adiantamento do cliente - operacao ${payload.localOperationId}`
    });
    settled.push(step);
  }

  const settledCents = settled.reduce((total, step) => total + step.amountCents, 0);
  return {
    settledCents,
    titles: settled,
    advanceAccountCode,
    pendingReceivable: false,
    message:
      settledCents < amountCents
        ? `Titulos do pedido cobriram apenas R$ ${(settledCents / 100).toFixed(2)} do adiantamento.`
        : null
  };
}

/** Titulos a receber gerados pelo pedido/OS, com saldo em aberto. */
async function findOrderReceivables(
  credentials: OmieCredentials,
  payload: SettleAdvancePayload
): Promise<ReturnType<typeof selectOrderReceivables>> {
  const endIso = new Date().toISOString().slice(0, 10);
  const startIso = payload.issueDate
    ? addDaysToIsoDate(payload.issueDate, -SETTLE_LOOKBACK_DAYS)
    : addDaysToIsoDate(endIso, -SETTLE_LOOKBACK_DAYS);

  const found: ReturnType<typeof selectOrderReceivables> = [];
  for (let page = 1; page <= SETTLE_RECEIVABLE_MAX_PAGES; page++) {
    let response: {
      total_de_paginas?: number;
      conta_receber_cadastro?: OmieReceivableRaw[];
      contaReceberCadastro?: OmieReceivableRaw[];
    } | null;
    try {
      response = await callOmie<
        Record<string, unknown>,
        {
          total_de_paginas?: number;
          conta_receber_cadastro?: OmieReceivableRaw[];
          contaReceberCadastro?: OmieReceivableRaw[];
        } | null
      >(credentials, "/financas/contareceber/", "ListarContasReceber", {
        pagina: page,
        registros_por_pagina: PAGE_SIZE,
        apenas_importado_api: "N",
        filtrar_cliente: payload.customerOmieId,
        filtrar_por_data_de: formatOmieDate(startIso),
        filtrar_por_data_ate: formatOmieDate(endIso)
      });
    } catch (error) {
      if (!isEmptyReceivablesError(error)) throw error;
      break;
    }

    const rawItems = response?.conta_receber_cadastro ?? response?.contaReceberCadastro ?? [];
    found.push(...selectOrderReceivables(rawItems, payload.omieOrderId));
    if (computeFinished(page, rawItems.length, toIntOrNull(response?.total_de_paginas))) break;
  }
  return found;
}

/** Lanca a baixa de um titulo contra a conta corrente de adiantamentos. */
async function settleReceivableWithAdvance(
  credentials: OmieCredentials,
  input: {
    titleId: number;
    amountCents: number;
    advanceAccountCode: number;
    integrationCode: string;
    observation: string;
  }
): Promise<void> {
  try {
    await callOmie<Record<string, unknown>, unknown>(
      credentials,
      "/financas/contareceber/",
      "LancarRecebimento",
      {
        codigo_lancamento: input.titleId,
        codigo_baixa_integracao: input.integrationCode,
        codigo_conta_corrente: input.advanceAccountCode,
        valor: input.amountCents / 100,
        data: formatOmieDate(new Date().toISOString().slice(0, 10)),
        observacao: input.observation
      }
    );
  } catch (error) {
    // Baixa ja lancada num retry anterior: o OMIE recusa a repeticao da chave,
    // e isso e exatamente o resultado esperado (idempotencia).
    if (isAlreadySettledFault(error)) return;
    throw error;
  }
}

function isAlreadySettledFault(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /ja (foi|esta) (baixad|recebid)|baixa ja|duplicad|ja cadastrad|ja existe/i.test(
    error.message
  );
}

/**
 * Conta corrente de adiantamentos do tenant (nCodCC), descoberta pelo nome
 * ("Adiantamento de Clientes"). Devolvida ao desktop para os proximos jobs
 * irem direto, sem revarrer as contas.
 */
async function resolveAdvanceAccountCode(credentials: OmieCredentials): Promise<number | null> {
  for (let page = 1; page <= ADVANCE_ACCOUNT_SCAN_MAX_PAGES; page++) {
    const response = await callOmie<
      { pagina: number; registros_por_pagina: number },
      Record<string, unknown> | null
    >(credentials, "/geral/contacorrente/", "ListarContasCorrentes", {
      pagina: page,
      registros_por_pagina: PAGE_SIZE
    });

    const rows = extractAccountRows(response);
    for (const row of rows) {
      const name = pickFirst(
        row.descricao as string | undefined,
        row.cDescricao as string | undefined
      );
      if (!isAdvanceAccountName(name)) continue;
      const code = accountRowCode(row);
      if (code !== null) return code;
    }

    if (rows.length < PAGE_SIZE) break;
  }
  return null;
}

/**
 * Codigos das categorias de adiantamento de cliente no plano de contas do
 * tenant. Descoberto pela descricao ("Adiantamento de Clientes", o padrao do
 * OMIE) e devolvido ao desktop, que reenvia nos proximos ciclos para nao
 * revarrer o plano de contas a cada pagina.
 */
async function resolveAdvanceCategoryCodes(credentials: OmieCredentials): Promise<string[]> {
  const codes = new Set<string>();
  for (let page = 1; page <= ADVANCE_CATEGORY_SCAN_MAX_PAGES; page++) {
    const result = await listOptionalCategoriesPage(credentials, page);
    for (const code of selectAdvanceCategoryCodes(result.items)) codes.add(code);
    if (result.finished || result.items.length === 0) break;
  }
  return [...codes];
}

function isEmptyReceivablesError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /nao (foram encontrados|existem) registros|nenhum registro|SOAP-ENV.*ListarContasReceber/i.test(
    error.message
  );
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
  // Cliente NOVO nasce no OMIE ja com a tag "cliente" (o mesmo que o carrier faz com
  // "transportadora"): e ela que faz o cadastro voltar como cliente na sincronizacao.
  // Na ALTERACAO as tags sao remontadas a partir das que o cadastro tem hoje no OMIE
  // (mergeOmieCustomerTags): o AlterarCliente substitui a lista inteira, entao mandar so
  // "cliente" apagaria os outros papeis e nao mandar nada deixaria sem marcacao todo
  // cadastro reaproveitado por CNPJ/CPF.
  const createBody = buildCustomerCadastroPayload(payload);
  const updateBody = buildCustomerPayload(payload);
  const toUpdateBody = (omieCustomerId: number): Promise<Record<string, unknown>> =>
    buildCustomerUpdateBody(activeOmieQueue, credentials, {
      body: updateBody,
      omieCustomerId,
      requiredTag: OMIE_CUSTOMER_TAG
    });

  if (payload.omieCustomerId) {
    await callOmie<unknown, unknown>(
      credentials,
      "/geral/clientes/",
      "AlterarCliente",
      await toUpdateBody(payload.omieCustomerId)
    );
    await syncCustomerInvoiceEmailsCore(
      activeOmieQueue,
      credentials,
      payload.omieCustomerId,
      payload.fiscalEmails
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
        await toUpdateBody(existing)
      );
      await syncCustomerInvoiceEmailsCore(
        activeOmieQueue,
        credentials,
        existing,
        payload.fiscalEmails
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
    >(credentials, "/geral/clientes/", "IncluirCliente", createBody);
  } catch (error) {
    // O cadastro ja existe la (por documento ou pelo nosso codigo de integracao, quando um
    // envio anterior entrou e a resposta se perdeu): vira update em vez de recusa.
    const existingId = await resolveDuplicateCustomerId(
      activeOmieQueue,
      credentials,
      createBody,
      error
    );
    if (existingId === null) throw error;
    await callOmie<unknown, unknown>(
      credentials,
      "/geral/clientes/",
      "AlterarCliente",
      await toUpdateBody(existingId)
    );
    await syncCustomerInvoiceEmailsCore(
      activeOmieQueue,
      credentials,
      existingId,
      payload.fiscalEmails
    );
    return existingId;
  }

  const omieCustomerId = response.codigo_cliente_omie ?? response.codigoClienteOmie;
  if (!omieCustomerId) {
    throw new Error("OMIE nao retornou codigoClienteOmie");
  }
  await syncCustomerInvoiceEmailsCore(
    activeOmieQueue,
    credentials,
    omieCustomerId,
    payload.fiscalEmails
  );
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
        // A tag do filtro e `clientesFiltro`; com `filtro` o OMIE recusa a estrutura e
        // a busca nunca achava ninguem (todo cliente ja existente caia no IncluirCliente).
        clientesFiltro: { cnpj_cpf: document.replace(/\D/g, "") }
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
    days.length > 1 ? days.join("/") : days.length === 1 ? `${days[0]} dias` : String(count);

  const cacheKey = `${omieTenantKey(credentials)}:${conditionText}`;
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

type InstallmentPlanItem = {
  /** Numero da parcela (1-based). */
  number: number;
  /** Dias entre a emissao e o vencimento (0 = a vista). */
  dueInDays: number;
  /** Vencimento em ISO (yyyy-mm-dd). */
  dueDate: string;
  /** Percentual do total nesta parcela (a ultima absorve o arredondamento). */
  percent: number;
  /** Valor da parcela em centavos (as parcelas somam exatamente o total). */
  valueCents: number;
};

/**
 * Parcelas da operacao: os dias de vencimento digitados no desktop mais o rateio do
 * total (itens + frete) entre elas. Fonte unica do pedido de venda e da OS, para as
 * duas saidas cairem no OMIE com exatamente o mesmo parcelamento.
 */
function buildInstallmentPlan(payload: CreateOrderPayload): InstallmentPlanItem[] {
  const dueDays = orderDueDays(payload);
  const count = dueDays.length;
  const basePercent = Math.floor(10000 / count) / 100;
  // Total da operacao (itens + frete) em centavos. O OMIE exige o valor em CADA parcela
  // do parcelamento informado; sem ele rejeita o pedido com "O preenchimento da tag
  // [valor] e obrigatorio!". A ultima parcela absorve o arredondamento para as parcelas
  // somarem exatamente o total.
  const itemsTotalCents = Math.round(payload.quantity * payload.unitPrice * 100);
  const freightCents =
    typeof payload.freightTotalCents === "number" && payload.freightTotalCents > 0
      ? Math.round(payload.freightTotalCents)
      : 0;
  const totalCents = itemsTotalCents + freightCents;
  let allocatedCents = 0;
  return dueDays.map((dueInDays, index) => {
    const isLast = index === count - 1;
    const percent = isLast
      ? Math.round((100 - basePercent * (count - 1)) * 100) / 100
      : basePercent;
    const valueCents = isLast
      ? totalCents - allocatedCents
      : Math.round((totalCents * percent) / 100);
    allocatedCents += valueCents;
    return {
      number: index + 1,
      dueInDays,
      dueDate: addDaysToIsoDate(payload.issueDate, dueInDays),
      percent,
      valueCents
    };
  });
}

/**
 * Codigo do meio de pagamento "boleto bancario" no OMIE/NF-e (tPag "15"). E por ele que
 * o pedido/OS reconhece a venda em boleto — o codigo local da forma ("boleto") nao viaja
 * no payload, so o codigo OMIE vinculado a ela.
 */
const OMIE_BOLETO_PAYMENT_METHOD_CODE = "15";

/**
 * Tipo de documento da parcela paga em boleto (aba "Parcelas" do OMIE). Sem ele o OMIE
 * tipa a conta a receber gerada no faturamento como "Nota Fiscal Eletronica" e o titulo
 * nao nasce como boleto.
 */
const OMIE_BOLETO_DOCUMENT_TYPE = "BOL";

/** A operacao foi paga em boleto (meio de pagamento "15" do OMIE/NF-e). */
function isBoletoPaymentMethod(paymentMethodOmieCode: string | undefined): boolean {
  return (paymentMethodOmieCode ?? "").trim() === OMIE_BOLETO_PAYMENT_METHOD_CODE;
}

/**
 * Valor do `nao_gerar_boleto` do OMIE para o meio de pagamento escolhido na operacao.
 *
 * ATENCAO ao que este campo faz e ao que ele NAO faz. Ele e ASSIMETRICO: so sabe
 * SUPRIMIR. A documentacao do OMIE e literal — "Informe 'S' para nao gerar o boleto. O
 * padrao e 'N'." O "N" nao significa "gera boleto": significa "sem supressao explicita",
 * e ai o OMIE cai na recomendacao do CADASTRO DO CLIENTE (aba "Recomendacoes" ->
 * `recomendacoes.gerar_boletos`). Com ela desmarcada a parcela nasce "Gerar Boleto: Nao"
 * por mais que o pedido mande "N".
 *
 * Quem liga o boleto e o cadastro do cliente — ver `ensureCustomerGeneratesBoleto`, que
 * roda antes do pedido quando a operacao e em boleto. O papel deste campo e o inverso:
 * desligar por operacao nos demais meios, e isso ele faz:
 *
 * - boleto ("15") -> "N": nao suprime; quem emite a cobranca e a recomendacao do cliente;
 * - qualquer outro meio conhecido -> "S": venda em dinheiro/PIX/cartao nao emite boleto,
 *   mesmo com a recomendacao ligada no cadastro. E este "S" que faz o boleto seguir a
 *   forma escolhida operacao a operacao. A venda em carteira ("99 - outros") entra aqui
 *   de proposito: a nota sai, mas a cobranca so nasce quando o fechamento da carteira
 *   definir a forma de recebimento;
 * - meio desconhecido (credito do cliente, desktop antigo sem o codigo) -> null: nada e
 *   enviado e vale o padrao do OMIE, como antes.
 */
function boletoGenerationFlag(paymentMethodOmieCode: string | undefined): string | null {
  const meio = (paymentMethodOmieCode ?? "").trim();
  if (!meio) return null;
  return meio === OMIE_BOLETO_PAYMENT_METHOD_CODE ? "N" : "S";
}

/**
 * Campos de boleto de uma parcela. O pedido de venda (`lista_parcelas`) e a OS
 * (`Parcelas`) usam os MESMOS nomes de tag, entao as duas saidas levam o mesmo
 * "gerar boleto" a partir da mesma forma de pagamento.
 */
function buildBoletoParcelaFields(
  paymentMethodOmieCode: string | undefined
): Record<string, unknown> {
  const naoGerarBoleto = boletoGenerationFlag(paymentMethodOmieCode);
  if (naoGerarBoleto === null) return {};
  return {
    nao_gerar_boleto: naoGerarBoleto,
    ...(isBoletoPaymentMethod(paymentMethodOmieCode)
      ? { tipo_documento: OMIE_BOLETO_DOCUMENT_TYPE }
      : {})
  };
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
 *
 * O "gerar boleto" acompanha o meio: em boleto ("15") as parcelas vao com
 * nao_gerar_boleto "N" (ativo) e tipo_documento "BOL"; nos demais meios conhecidos vao
 * com "S". O cabecalho leva o mesmo flag como padrao das parcelas.
 */
function buildOrderParcelamento(payload: CreateOrderPayload): OrderParcelamento {
  const meio = (payload.paymentMethodOmieCode ?? "").trim();
  const plan = buildInstallmentPlan(payload);
  const useLista = meio.length > 0 || plan.length > 1 || plan[0].dueInDays > 0;
  const naoGerarBoleto = boletoGenerationFlag(meio);
  const cabecalhoBoleto = naoGerarBoleto !== null ? { nao_gerar_boleto: naoGerarBoleto } : {};

  if (!useLista) {
    const code = normalizeParcelaCode(payload.paymentTermOmieCode) ?? "000";
    return { cabecalho: { codigo_parcela: code, ...cabecalhoBoleto }, listaParcelas: null };
  }

  const count = plan.length;
  const boletoFields = buildBoletoParcelaFields(meio);
  const parcela = plan.map((item) => ({
    numero_parcela: item.number,
    data_vencimento: toOmieDate(item.dueDate),
    percentual: item.percent,
    valor: item.valueCents / 100,
    ...(meio ? { meio_pagamento: meio } : {}),
    ...boletoFields
  }));

  return {
    // OMIE: o campo do cabecalho e "qtde_parcelas" — "quantidade_parcelas" e rejeitado
    // ("Tag [QUANTIDADE_PARCELAS] nao faz parte da estrutura do tipo complexo [cabecalho]").
    cabecalho: { codigo_parcela: "999", qtde_parcelas: count, ...cabecalhoBoleto },
    listaParcelas: { parcela }
  };
}

/**
 * Parcelas informadas da OS (bloco `Parcelas` do IncluirOS). Espelha o parcelamento
 * informado do pedido de venda: a OS sai com EXATAMENTE os vencimentos digitados na
 * operacao, em vez de depender de a condicao existir no cadastro de parcelas do OMIE.
 *
 * Retorna null so quando a operacao e mesmo a vista (uma parcela no dia da emissao) —
 * ai o codigo "000"/vinculado do cabecalho ja representa a condicao. Em boleto o bloco
 * vai mesmo a vista: o cabecalho da OS nao tem o campo de boleto, entao a parcela e o
 * unico lugar que carrega o "gerar boleto" ate o OMIE.
 *
 * A parcela da OS leva o `meio_pagamento` junto (mesma tag do `lista_parcelas` do
 * pedido). Sem ele a parcela chegava ao OMIE sem meio nenhum: a venda sem nota em boleto
 * nascia com a aba "Parcelas" da OS sem o meio "15 - Boleto Bancario", e o faturamento
 * nao tinha do que tirar a cobranca — mesmo com o `nao_gerar_boleto` "N".
 */
function buildServiceOrderParcelas(
  payload: CreateOrderPayload
): Array<Record<string, unknown>> | null {
  const plan = buildInstallmentPlan(payload);
  const meio = (payload.paymentMethodOmieCode ?? "").trim();
  const isBoleto = isBoletoPaymentMethod(payload.paymentMethodOmieCode);
  if (plan.length === 1 && plan[0].dueInDays === 0 && !isBoleto) return null;
  const boletoFields = buildBoletoParcelaFields(payload.paymentMethodOmieCode);
  return plan.map((item) => ({
    nParcela: item.number,
    nDias: item.dueInDays,
    dDtVenc: toOmieDate(item.dueDate),
    nPercentual: item.percent,
    nValor: item.valueCents / 100,
    ...(meio ? { meio_pagamento: meio } : {}),
    ...boletoFields
  }));
}

/**
 * Recusa do OMIE ao FORMATO do corpo enviado — tag desconhecida ("Tag [PARCELAS] nao
 * faz parte da estrutura do tipo complexo [...]") ou campo obrigatorio faltando dentro
 * dela. Usado para reenviar a OS pelo caminho historico (codigo do cadastro de
 * parcelas) em vez de deixar a operacao sem OS nenhuma.
 */
function isOmieStructureRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /n[aã]o faz parte da estrutura|tipo complexo|tag\s*\[[^\]]+\]/i.test(message);
}

/**
 * Codigo OMIE do cliente do pedido. Ja vinculado -> usa direto. Sem codigo mas com
 * cadastro no payload -> cria/localiza o cliente no OMIE na hora (find-or-create por
 * CNPJ/CPF) e devolve o codigo. Sem codigo e sem cadastro -> erro claro.
 *
 * A recusa do CADASTRO sai com mensagem propria (CUSTOMER_REGISTRATION_FAULT_PREFIX):
 * ela e deterministica — re-tentar sem corrigir o cadastro so repete o erro — e o
 * desktop usa esse prefixo para bloquear o job e mostrar o que falta preencher, em vez
 * de exibir a mensagem crua do OMIE ("O preenchimento da tag [email] e obrigatorio!").
 */
/**
 * Liga o "Por padrao: Gerar Boletos ao Emitir NF-e" no cadastro do cliente antes de subir
 * uma operacao em boleto.
 *
 * Por que no cliente e nao no pedido: o `nao_gerar_boleto` do pedido/OS so SUPRIME (ver
 * `boletoGenerationFlag`). Nao existe campo no pedido que LIGUE o boleto — quem decide e
 * a recomendacao do cadastro. Com ela desmarcada, a parcela nascia "Gerar Boleto: Nao"
 * mesmo com o pedido mandando "N", que era o padrao de qualquer jeito.
 *
 * So roda quando a operacao e em boleto: ligar a recomendacao em todo cliente mudaria a
 * cobranca de quem nunca usa boleto. Combinado com o "S" que os demais meios ja mandam no
 * pedido, o boleto passa a seguir a forma escolhida operacao a operacao.
 *
 * O bloco `recomendacoes` volta INTEIRO no AlterarCliente (numero de parcelas, vendedor e
 * transportadora padrao): nao esta documentado se o OMIE faz merge parcial do complexo, e
 * reenviar o que o ConsultarCliente devolveu garante que nada configurado a mao se perca.
 *
 * Nunca lanca. O boleto e um detalhe da cobranca, nao um requisito do pedido: se a
 * consulta ou a alteracao falhar, o fechamento segue e o pior caso e o comportamento
 * anterior (boleto conforme o cadastro), nunca uma operacao sem pedido.
 */
async function ensureCustomerGeneratesBoleto(
  credentials: OmieCredentials,
  omieCustomerId: number
): Promise<void> {
  try {
    const customer = await callOmie<
      { codigo_cliente_omie: number },
      { recomendacoes?: OmieCustomerRecommendations } | null
    >(credentials, "/geral/clientes/", "ConsultarCliente", {
      codigo_cliente_omie: omieCustomerId
    });

    const recomendacoes: OmieCustomerRecommendations = customer?.recomendacoes ?? {};
    // Ja ligado (na mao no OMIE ou por um fechamento anterior): nao gasta um
    // AlterarCliente — o OMIE cobra rate limit por chamada, e o fechamento e o
    // caminho quente.
    if (isYesFlag(recomendacoes.gerar_boletos)) return;

    await callOmie<Record<string, unknown>, unknown>(
      credentials,
      "/geral/clientes/",
      "AlterarCliente",
      {
        codigo_cliente_omie: omieCustomerId,
        recomendacoes: { ...recomendacoes, gerar_boletos: "S" }
      }
    );
  } catch (error) {
    console.error(
      "[omie] falha ao ligar o 'Gerar Boletos' no cadastro do cliente; " +
        "o pedido segue e o boleto fica conforme o cadastro atual",
      error
    );
  }
}

async function resolveOrderCustomerOmieId(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<number> {
  if (typeof payload.customerOmieId === "number" && payload.customerOmieId > 0) {
    return payload.customerOmieId;
  }
  if (payload.customer) {
    try {
      return await pushCustomerToOmie(credentials, payload.customer);
    } catch (error) {
      throw new Error(customerRegistrationFaultMessage(error, payload.customer.razaoSocial));
    }
  }
  throw new Error(
    `${CUSTOMER_REGISTRATION_FAULT_PREFIX}. Cliente sem codigo OMIE e sem dados de cadastro ` +
      "para criar no OMIE: informe o CNPJ/CPF do cliente e reenvie."
  );
}

/**
 * Codigo OMIE da transportadora do pedido. Ja vinculada -> usa direto. Sem codigo mas
 * com cadastro no payload -> cadastra no OMIE na hora (find-or-create por CNPJ/CPF, com
 * a tag "transportadora") e devolve o codigo.
 *
 * Nunca lanca: a transportadora e um dado de transporte, nao um requisito do pedido.
 * Se o cadastro falhar (documento recusado, indisponibilidade), o pedido segue sem ela
 * — exatamente o comportamento anterior — em vez de o fechamento inteiro falhar.
 */
async function resolveOrderCarrierOmieId(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<number | null> {
  const linked = payload.transport?.carrierOmieId;
  if (typeof linked === "number" && linked > 0) return linked;
  if (!payload.carrier) return null;
  try {
    const carrierOmieId = await pushCarrierToOmie(
      credentials,
      toOrderCarrierPushPayload(payload.carrier)
    );
    return carrierOmieId > 0 ? carrierOmieId : null;
  } catch (error) {
    console.error("Falha ao cadastrar a transportadora no OMIE; pedido segue sem ela", error);
    return null;
  }
}

/**
 * O cadastro da transportadora que viaja no pedido identifica o registro local em
 * `localCarrierId` (e a transportadora do desktop, nao um cliente), enquanto o push de
 * cadastros usa `localCustomerId`. Sem esta traducao o codigo de integracao saia vazio e
 * o cadastro da transportadora estourava — silenciosamente, porque o chamador engole a
 * falha e manda o pedido sem transportadora.
 */
function toOrderCarrierPushPayload(
  carrier: PushCarrierPayload & { localCarrierId?: string }
): PushCarrierPayload {
  return {
    ...carrier,
    localCustomerId: carrier.localCustomerId ?? carrier.localCarrierId ?? "",
    // O codigo local nunca vale como codigo OMIE: quem manda e o `transport.carrierOmieId`
    // (ja tratado acima) ou o find-or-create por CNPJ/CPF.
    omieCustomerId: undefined
  };
}

/**
 * Recusa do OMIE quando o codigo enviado aponta para um cadastro que nao existe (mais)
 * na conta: "Cliente nao cadastrado para o Codigo [11455924790] ! - tag: [codigo_cliente]".
 *
 * O codigo vem do cadastro LOCAL (customers.omie_customer_id / carriers.omie_customer_id),
 * entao ele fica obsoleto sem ninguem perceber quando o registro e excluido no OMIE, quando
 * a base passa a apontar para outra conta OMIE ou quando uma importacao antiga gravou um
 * codigo que nao existe mais. Do lado do operador o cadastro parece completo: sem
 * tratamento o fechamento re-tenta com o MESMO codigo invalido ate morrer na fila.
 */
const OMIE_UNKNOWN_RECORD_PATTERN = /cliente\s+n[aã]o\s+cadastrad/i;

function omieFaultText(error: unknown): string {
  if (error instanceof OmieHttpError) return `${error.message} ${error.detail ?? ""}`;
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * A transportadora tambem e um "cliente" no OMIE, entao a recusa do `codigo_transportadora`
 * do bloco frete usa a MESMA frase da recusa do `codigo_cliente` do cabecalho. So a tag
 * separa as duas — e cada uma tem um conserto diferente (recadastrar o cliente x seguir
 * sem a transportadora).
 */
function isUnknownOmieCarrierFault(error: unknown): boolean {
  const text = omieFaultText(error);
  return OMIE_UNKNOWN_RECORD_PATTERN.test(text) && /codigo_transportadora/i.test(text);
}

function isUnknownOmieCustomerFault(error: unknown): boolean {
  const text = omieFaultText(error);
  if (!OMIE_UNKNOWN_RECORD_PATTERN.test(text)) return false;
  return !/codigo_transportadora/i.test(text);
}

/**
 * Marca da recusa por codigo de cliente obsoleto que o edge NAO conseguiu consertar
 * sozinho (fechamento antigo, sem o cadastro do cliente no payload, ou o OMIE recusou o
 * recadastro). O desktop reconhece este prefixo para limpar o codigo local invalido e
 * refazer o vinculo antes de reenviar — ver isOmieStaleCustomerCodeFault no desktop.
 */
export const STALE_CUSTOMER_CODE_FAULT_PREFIX = "Codigo do cliente no OMIE nao existe mais";

function staleCustomerCodeFaultMessage(
  staleOmieCustomerId: number,
  customerName: string | undefined,
  error: unknown
): string {
  const who = customerName?.trim() ? ` (${customerName.trim()})` : "";
  return (
    `${STALE_CUSTOMER_CODE_FAULT_PREFIX}${who}. O codigo ${staleOmieCustomerId} gravado no ` +
    "cadastro local nao existe nesta conta do OMIE (cliente excluido la ou codigo de outra " +
    "conta). O vinculo sera refeito e o fechamento reenviado sozinho. " +
    `Detalhe OMIE: ${omieFaultText(error)}`
  );
}

/**
 * Recadastra/relocaliza no OMIE o cliente cujo codigo o pedido acabou de rejeitar. Ignora
 * de proposito o codigo local (ele e justamente o invalido) e refaz o find-or-create por
 * CNPJ/CPF a partir do cadastro que viaja no payload, devolvendo o codigo bom para o
 * pedido ser reenviado na hora — e para o desktop regravar o vinculo.
 */
async function recoverUnknownCustomerOmieId(
  credentials: OmieCredentials,
  payload: CreateOrderPayload,
  staleOmieCustomerId: number,
  error: unknown
): Promise<number> {
  const cadastro = payload.customer;
  if (!cadastro) {
    throw new Error(staleCustomerCodeFaultMessage(staleOmieCustomerId, undefined, error));
  }
  let recovered: number;
  try {
    recovered = await pushCustomerToOmie(credentials, {
      ...cadastro,
      omieCustomerId: undefined
    });
  } catch (registrationError) {
    throw new Error(
      staleCustomerCodeFaultMessage(staleOmieCustomerId, cadastro.razaoSocial, registrationError)
    );
  }
  // Mesmo codigo de novo (o OMIE devolveu o invalido): reenviar so repetiria a recusa.
  if (!(recovered > 0) || recovered === staleOmieCustomerId) {
    throw new Error(
      staleCustomerCodeFaultMessage(staleOmieCustomerId, cadastro.razaoSocial, error)
    );
  }
  return recovered;
}

/**
 * Mesma ideia para a transportadora cujo codigo o pedido rejeitou: refaz o find-or-create
 * por CNPJ/CPF a partir do cadastro do payload. Devolve `null` quando nao da para
 * recuperar — ai o pedido segue sem transportadora, que e o comportamento historico
 * quando o cadastro dela falha (nunca derruba o fechamento).
 */
async function recoverUnknownCarrierOmieId(
  credentials: OmieCredentials,
  payload: CreateOrderPayload,
  staleOmieCarrierId: number
): Promise<number | null> {
  if (!payload.carrier) return null;
  try {
    const recovered = await pushCarrierToOmie(
      credentials,
      toOrderCarrierPushPayload(payload.carrier)
    );
    return recovered > 0 && recovered !== staleOmieCarrierId ? recovered : null;
  } catch (error) {
    console.error("Falha ao refazer o vinculo da transportadora no OMIE", error);
    return null;
  }
}

/** Resposta do IncluirOS/ConsultarOS (o OMIE varia entre nCodOS e codigoOS). */
type OmieServiceOrderResponse = {
  nCodOS?: number;
  codigoOS?: number;
  cCodIntOS?: string;
  codigoOSIntegracao?: string;
  /** Numero da OS como o operador a ve na tela do OMIE — distinto do nCodOS interno. */
  cNumOS?: string;
};

/**
 * Cria o pedido de venda (ou a OS) da operacao no OMIE.
 *
 * Resolve cliente e transportadora e, se o OMIE recusar o pedido porque um desses codigos
 * nao existe la, CONSERTA e reenvia na hora em vez de devolver a falha para a fila:
 *
 * - cliente com codigo obsoleto -> recadastra/relocaliza por CNPJ/CPF e reenvia com o
 *   codigo bom (que volta ao desktop em `omieCustomerId` para regravar o vinculo);
 * - transportadora com codigo obsoleto -> refaz o vinculo pelo CNPJ/CPF e, se nem isso
 *   der, reenvia SEM ela (como ja acontece quando o cadastro dela falha): transporte e
 *   dado acessorio, nunca motivo para o fechamento ficar preso na fila.
 *
 * Cada conserto acontece no maximo uma vez por envio, entao um erro persistente continua
 * subindo (com a mensagem do OMIE) em vez de virar loop.
 */
/**
 * Retorno do envio do fechamento ao OMIE.
 *
 * `orderId` e o codigo interno (nCodPed/nCodOS) — o numero pelo qual a API referencia o
 * registro e o que o KyberRock ja guardava. `orderNumber` e o numero que o OPERADOR ve na
 * tela do OMIE (numero_pedido/cNumOS): sao coisas diferentes, e era so o primeiro que
 * aparecia na conferencia de faturamento — quem procurava "11489137846" no OMIE nao
 * achava nada. Null quando o OMIE nao devolveu o numero na inclusao; nesse caso a
 * reconciliacao (check_order_billing) preenche depois.
 */
type CreatedOmieOrder = {
  orderId: number;
  orderNumber: string | null;
  omieCustomerId: number;
  omieCarrierId: number | null;
};

async function createOmieOrder(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<CreatedOmieOrder> {
  // Garante o cliente no OMIE (cadastra na hora quando ainda nao existe) antes do pedido.
  let customerOmieId = await resolveOrderCustomerOmieId(credentials, payload);
  // Boleto: quem LIGA a cobranca e a recomendacao do cadastro do cliente, nao o pedido.
  // Vale para os dois caminhos daqui pra frente (pedido de venda e OS).
  if (isBoletoPaymentMethod(payload.paymentMethodOmieCode)) {
    await ensureCustomerGeneratesBoleto(credentials, customerOmieId);
  }
  // Mesma ideia para a transportadora: sobe o cadastro antes de montar o pedido para o
  // primeiro fechamento com uma transportadora nova ja sair com ela preenchida.
  let carrierOmieId = await resolveOrderCarrierOmieId(credentials, payload);
  let customerRecovered = false;
  let carrierFixed = false;

  for (;;) {
    try {
      return await submitOmieOrder(credentials, payload, customerOmieId, carrierOmieId);
    } catch (error) {
      if (!carrierFixed && carrierOmieId !== null && isUnknownOmieCarrierFault(error)) {
        const recovered = await recoverUnknownCarrierOmieId(credentials, payload, carrierOmieId);
        console.error(
          `[omie] codigo ${carrierOmieId} da transportadora nao existe no OMIE; ` +
            (recovered !== null
              ? `reenviando o pedido com o codigo ${recovered}`
              : "reenviando o pedido SEM transportadora"),
          error
        );
        carrierOmieId = recovered;
        carrierFixed = true;
        continue;
      }
      if (!customerRecovered && isUnknownOmieCustomerFault(error)) {
        const recovered = await recoverUnknownCustomerOmieId(
          credentials,
          payload,
          customerOmieId,
          error
        );
        console.error(
          `[omie] codigo ${customerOmieId} do cliente nao existe no OMIE; ` +
            `reenviando o pedido com o codigo ${recovered}`,
          error
        );
        customerOmieId = recovered;
        customerRecovered = true;
        // O "gerar boletos" foi ligado no cadastro errado (ou nem existia): refaz no novo.
        if (isBoletoPaymentMethod(payload.paymentMethodOmieCode)) {
          await ensureCustomerGeneratesBoleto(credentials, customerOmieId);
        }
        continue;
      }
      throw error;
    }
  }
}

async function submitOmieOrder(
  credentials: OmieCredentials,
  payload: CreateOrderPayload,
  customerOmieId: number,
  carrierOmieId: number | null
): Promise<CreatedOmieOrder> {
  const integrationCode = toOmieIntegrationCode(payload.idempotencyKey);
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
    const salesOrderAdditionalData = buildSalesOrderAdditionalData(payload);
    const buildSalesOrderBody = (invoiceEmails: string) => ({
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
      frete: buildOmieFreight(payload.freightTotalCents, payload.freightModalidade, {
        ...(payload.transport ?? {}),
        carrierOmieId
      }),
      informacoes_adicionais: {
        codigo_categoria: resolveCategoryCode(payload.omieCategoryCode),
        ...(accountCode !== null ? { codigo_conta_corrente: accountCode } : {}),
        // Dados adicionais da NF: a referencia da pesagem que originou o pedido vem
        // primeiro, seguida do motorista/placa. Sem ela o pedido de venda chegava ao
        // OMIE sem nenhuma pista de qual carregamento ele era — o vinculo so existia no
        // sentido OMIE -> KyberRock (o numero do pedido guardado na operacao).
        ...(salesOrderAdditionalData !== null
          ? { dados_adicionais_nf: salesOrderAdditionalData }
          : {}),
        // "Enderecos de e-mail que recebem a NF" do pedido: todos os e-mails da aba
        // Fiscal do cadastro do cliente. Sem lista o campo nem vai, e o OMIE usa o
        // cadastro do cliente.
        ...(invoiceEmails.length > 0 ? { utilizar_emails: invoiceEmails } : {})
      },
      // Parcelamento informado (codigo_parcela "999"): leva os vencimentos e o
      // meio de pagamento (tPag da NF-e) por parcela.
      ...(parcelamento.listaParcelas !== null ? { lista_parcelas: parcelamento.listaParcelas } : {})
    });

    const invoiceEmails = resolveOrderInvoiceEmails(payload);
    const consultExistingSalesOrder = async (): Promise<unknown | null> => {
      // So aceita a consulta como fallback se ela realmente devolver o pedido;
      // caso contrario propaga o erro original do IncluirPedido (antes, uma
      // resposta vazia da consulta mascarava a causa real com
      // "OMIE nao retornou codigoPedido").
      const existing = await consultSalesOrderByIntegrationCode(credentials, integrationCode).catch(
        () => null
      );
      return existing && extractSalesOrderId(existing) !== null ? existing : null;
    };

    const response = await callOmie<unknown, unknown>(
      credentials,
      "/produtos/pedido/",
      "IncluirPedido",
      buildSalesOrderBody(invoiceEmails)
    ).catch(async (error) => {
      const existing = await consultExistingSalesOrder();
      if (existing) return existing;

      // O OMIE recusou o campo de destinatarios: reenvia sem ele para o fechamento nao
      // ficar sem pedido. Os e-mails continuam no cadastro do cliente (email_fatura).
      if (invoiceEmails.length > 0 && isOmieInvoiceEmailStructureRejection(error)) {
        console.error(
          "[omie] IncluirPedido recusou utilizar_emails; reenviando o pedido SEM os " +
            "destinatarios da NF — eles seguem so no cadastro do cliente",
          error
        );
        return await callOmie<unknown, unknown>(
          credentials,
          "/produtos/pedido/",
          "IncluirPedido",
          buildSalesOrderBody("")
        ).catch(async (retryError) => {
          const retryExisting = await consultExistingSalesOrder();
          if (retryExisting) return retryExisting;
          throw retryError;
        });
      }

      throw error;
    });

    const orderId = extractSalesOrderId(response);
    if (!orderId) {
      throw new Error("OMIE nao retornou codigoPedido");
    }
    return {
      orderId,
      orderNumber: extractOrderNumber(response, "numero_pedido"),
      omieCustomerId: customerOmieId,
      omieCarrierId: carrierOmieId
    };
  }

  const serviceCodes = await resolveOmieServiceCodes(credentials);
  // Impostos da OS iguais para todas as linhas: "01" = tributado no municipio,
  // "N" = ISS nao retido. Ambos sao obrigatorios no IncluirOS.
  const serviceTaxFields = {
    cTribServ: "01",
    cRetemISS: "N",
    ...(serviceCodes.municipal !== null ? { cCodServMun: serviceCodes.municipal } : {}),
    ...(serviceCodes.lc116 !== null ? { cCodServLC116: serviceCodes.lc116 } : {})
  };
  const freightValue = toOmieFreightValue(payload.freightTotalCents);
  const serviceItemData = buildServiceItemAdditionalData(payload);
  // Condicao ja vinculada a um codigo do cadastro do OMIE: usa o codigo, porque a
  // condicao existe la com esses mesmos vencimentos. Sem vinculo, a OS leva o
  // parcelamento INFORMADO (bloco `Parcelas`) com os vencimentos digitados na operacao,
  // como o pedido de venda ja faz com lista_parcelas. Antes esse caso dependia de achar
  // ou criar a condicao no cadastro do OMIE e, quando nao dava, caia em "000" — a OS
  // nascia A VISTA mesmo com "9/18/27" digitado na operacao.
  //
  // Em boleto o parcelamento informado e obrigatorio mesmo com codigo vinculado: o
  // "gerar boleto" so existe na parcela da OS, e os vencimentos informados sao os
  // mesmos da condicao vinculada (vem da mesma condicao escolhida na operacao).
  const linkedParcelaCode = normalizeParcelaCode(payload.paymentTermOmieCode);
  const osParcelas =
    linkedParcelaCode === null || isBoletoPaymentMethod(payload.paymentMethodOmieCode)
      ? buildServiceOrderParcelas(payload)
      : null;
  const serviceOrderInvoiceEmails = resolveOrderInvoiceEmails(payload);
  const buildServiceOrderBody = (
    parcelaCode: string,
    parcelas: Array<Record<string, unknown>> | null,
    invoiceEmails: string
  ) => ({
    Cabecalho: {
      cCodIntOS: integrationCode,
      nCodCli: customerOmieId,
      dDtPrevisao: toOmieDate(payload.issueDate),
      // Etapa "50" = "Faturar": a OS tambem e faturada dentro do OMIE.
      cEtapa: "50",
      cCodParc: parcelaCode,
      nQtdeParc: parcelas !== null ? parcelas.length : installmentCount
    },
    ServicosPrestados: [
      {
        cDescServ: payload.serviceDescription || "Servico",
        ...serviceTaxFields,
        nQtde: payload.quantity,
        nValUnit: payload.unitPrice,
        ...(serviceItemData !== null ? { cDadosAdicItem: serviceItemData } : {})
      },
      // A OS nao tem bloco `frete` como o pedido de venda, entao o frete da operacao
      // interna entra como uma segunda linha de servico — sem isso o valor do frete
      // simplesmente nao chegava ao OMIE (a OS saia so com o valor do produto).
      ...(freightValue > 0
        ? [
            {
              cDescServ: buildFreightServiceDescription(payload),
              ...serviceTaxFields,
              nQtde: 1,
              nValUnit: freightValue
            }
          ]
        : [])
    ],
    // "999" no cabecalho = parcelamento informado; os vencimentos vao aqui.
    ...(parcelas !== null ? { Parcelas: parcelas } : {}),
    InformacoesAdicionais: {
      // Mesma categoria do plano gerencial usada no pedido de venda (a do produto,
      // senao a padrao da unidade). Antes era um codigo fixo: toda operacao interna
      // caia na mesma categoria, independentemente do material vendido.
      cCodCateg: resolveCategoryCode(payload.omieCategoryCode),
      ...(accountCode !== null ? { nCodCC: accountCode } : {}),
      cDadosAdicNF: buildServiceOrderAdditionalData(payload)
    },
    // "Utilizar os seguintes enderecos de e-mail" da OS — o equivalente ao
    // `utilizar_emails` do pedido de venda. Leva todos os e-mails da aba Fiscal do
    // cadastro do cliente; sem lista o bloco nem vai, e o OMIE usa o cadastro.
    ...(invoiceEmails.length > 0 ? { Email: { cEnviarPara: invoiceEmails } } : {})
  });

  const consultExistingServiceOrder = async (): Promise<OmieServiceOrderResponse | null> => {
    const existing = await consultServiceOrderByIntegrationCode(credentials, integrationCode).catch(
      () => null
    );
    const existingId = extractServiceOrderId(existing);
    if (existingId === null) return null;
    const existingNumber = extractOrderNumber(existing, "cNumOS");
    return existingNumber !== null
      ? { nCodOS: existingId, cNumOS: existingNumber }
      : { nCodOS: existingId };
  };

  const response = await callOmie<unknown, OmieServiceOrderResponse>(
    credentials,
    "/servicos/os/",
    "IncluirOS",
    // "999" = parcelamento informado; sem ele vale o codigo vinculado (ou "000", a vista).
    buildServiceOrderBody(
      osParcelas !== null ? "999" : (linkedParcelaCode ?? "000"),
      osParcelas,
      serviceOrderInvoiceEmails
    )
  ).catch(async (error) => {
    // Idempotencia: se a OS ja existe (reenvio apos erro desconhecido), consulta por
    // cCodIntOS e reaproveita o nCodOS.
    const existing = await consultExistingServiceOrder();
    if (existing) return existing;

    // O OMIE recusou o bloco de destinatarios: reenvia sem ele para a operacao nao ficar
    // sem OS. Os e-mails continuam no cadastro do cliente (email_fatura).
    if (serviceOrderInvoiceEmails.length > 0 && isOmieInvoiceEmailStructureRejection(error)) {
      console.error(
        "[omie] IncluirOS recusou o bloco Email; reenviando a OS SEM os destinatarios da " +
          "NF — eles seguem so no cadastro do cliente",
        error
      );
      return await callOmie<unknown, OmieServiceOrderResponse>(
        credentials,
        "/servicos/os/",
        "IncluirOS",
        buildServiceOrderBody(
          osParcelas !== null ? "999" : (linkedParcelaCode ?? "000"),
          osParcelas,
          ""
        )
      ).catch(async (retryError) => {
        const retryExisting = await consultExistingServiceOrder();
        if (retryExisting) return retryExisting;
        throw retryError;
      });
    }

    // O OMIE recusou o FORMATO do parcelamento informado: reenvia pelo cadastro de
    // parcelas (caminho historico) para a operacao nao ficar sem OS. O pior caso volta
    // a ser o comportamento anterior, nunca uma OS a menos.
    if (osParcelas !== null && isOmieStructureRejection(error)) {
      console.error(
        isBoletoPaymentMethod(payload.paymentMethodOmieCode)
          ? "[omie] IncluirOS recusou o parcelamento informado de uma operacao EM BOLETO; " +
              "reenviando pelo cadastro de parcelas — a OS nasce SEM o 'gerar boleto' da " +
              "parcela e a cobranca vai depender so da recomendacao do cadastro do cliente"
          : "[omie] IncluirOS recusou o parcelamento informado; reenviando pelo cadastro de parcelas",
        error
      );
      // O codigo ja vinculado a condicao manda no reenvio (o boleto pode ter escolhido o
      // parcelamento informado mesmo com vinculo); so sem ele a condicao e resolvida/criada.
      const fallbackCode =
        linkedParcelaCode ?? (await ensureOmieParcelaCode(credentials, payload)) ?? "000";
      return await callOmie<unknown, OmieServiceOrderResponse>(
        credentials,
        "/servicos/os/",
        "IncluirOS",
        buildServiceOrderBody(fallbackCode, null, serviceOrderInvoiceEmails)
      ).catch(async (retryError) => {
        const retryExisting = await consultExistingServiceOrder();
        if (retryExisting) return retryExisting;
        throw retryError;
      });
    }

    throw error;
  });
  const orderId = response.nCodOS ?? response.codigoOS;
  if (!orderId) {
    throw new Error("OMIE nao retornou codigoOS");
  }
  return {
    orderId,
    orderNumber: extractOrderNumber(response, "cNumOS"),
    omieCustomerId: customerOmieId,
    omieCarrierId: carrierOmieId
  };
}

/**
 * Numero VISIVEL do pedido/OS na resposta do OMIE (`numero_pedido` / `cNumOS`), quando ela
 * o traz. Nem toda inclusao devolve — o IncluirPedido costuma responder so com o codigo
 * interno —, e por isso o valor e opcional: a reconciliacao de faturamento consulta o
 * registro depois e preenche o que faltou.
 */
function extractOrderNumber(value: unknown, key: string): string | null {
  const found = findStringByKey(value, key);
  if (found === null) return null;
  const trimmed = found.trim();
  // "0" e o vazio do OMIE em campo numerico: guardar isso na operacao so poluiria a tela.
  return trimmed.length > 0 && trimmed !== "0" ? trimmed : null;
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

function extractAccountRows(response: Record<string, unknown> | null): Record<string, unknown>[] {
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
 * dinheiro -> Caixinha; PIX, boleto e em carteira -> OMIE Cash; cartoes -> GetNet.
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
  ["17", "omiecash"], // pix
  // "99 - outros" e a venda em carteira do KyberRock: o titulo fica na OMIE Cash ate o
  // fechamento definir como o cliente paga.
  ["99", "omiecash"]
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
    // Os dois codigos precisam sair do MESMO servico cadastrado: varrendo a resposta
    // inteira, o cCodServMun podia vir de um servico e o cCodServLC116 de outro, e o
    // OMIE recusa a combinacao (a OS da operacao interna nunca era criada). Por isso
    // localizamos o cadastro que tem o codigo municipal e lemos o LC116 dele.
    const service = findFirstObjectWithKey(response, "cCodServMun") ?? response;
    const codes: OmieServiceCodes = {
      municipal: findStringByKey(service, "cCodServMun"),
      lc116: findStringByKey(service, "cCodLC116") ?? findStringByKey(service, "cCodServLC116")
    };
    if (codes.municipal !== null || codes.lc116 !== null) {
      omieServiceCodesCache.set(credentials.appKey, codes);
    }
    return codes;
  } catch {
    return { municipal: null, lc116: null };
  }
}

/**
 * Menor objeto da resposta que contem a chave informada (o cadastro do servico dentro
 * da lista), para ler os campos irmaos sem misturar registros diferentes.
 */
function findFirstObjectWithKey(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstObjectWithKey(item, key);
      if (found !== null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  // Objeto aninhado tem precedencia: o pai (a resposta inteira) tambem "contem" a chave.
  for (const nested of Object.values(record)) {
    const found = findFirstObjectWithKey(nested, key);
    if (found !== null) return found;
  }
  const direct = record[key];
  return typeof direct === "string" && direct.trim().length > 0 ? record : null;
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

/**
 * Categoria usada quando o desktop nao informa uma (versao antiga, ou produto e
 * unidade sem categoria configurada). Era o valor fixo de todo pedido ate agora.
 */
const OMIE_DEFAULT_CATEGORY_CODE = "1.01.01";

function resolveCategoryCode(code: string | null | undefined): string {
  return typeof code === "string" && code.trim() ? code.trim() : OMIE_DEFAULT_CATEGORY_CODE;
}

/**
 * Lista para "Enderecos de e-mail que recebem a NF" do documento: os e-mails da aba Fiscal
 * do cadastro do cliente.
 *
 * Espelhar a aba Fiscal no `recomendacoes.email_fatura` do cadastro (ver
 * `syncCustomerInvoiceEmails`) nao chegava ao pedido: o documento guarda a PROPRIA lista de
 * destinatarios e nascia com ela vazia, entao a tela de e-mails da operacao ficava em branco
 * mesmo com a aba Fiscal preenchida. Agora todos os e-mails da aba Fiscal vao junto do
 * pedido/OS.
 *
 * `invoiceEmails` e o campo dedicado do desktop; o `customer.fiscalEmails` cobre desktops
 * antigos, que ainda mandam a aba Fiscal so dentro do cadastro do cliente. Vazio nos dois ->
 * string vazia, e o campo nao e enviado (o OMIE cai no cadastro do cliente).
 */
function resolveOrderInvoiceEmails(payload: CreateOrderPayload): string {
  const fromOrder = formatOmieOrderInvoiceEmailList(payload.invoiceEmails);
  if (fromOrder.length > 0) return fromOrder;
  return formatOmieOrderInvoiceEmailList(payload.customer?.fiscalEmails);
}

/**
 * Recusa do OMIE por causa do campo de e-mails do documento (`utilizar_emails` do pedido,
 * bloco `Email`/`cEnviarPara` da OS). O documento e reenviado SEM os destinatarios: eles
 * sao um detalhe do faturamento (o cadastro do cliente ja os tem), e um pedido a menos
 * travaria o fechamento da operacao.
 */
function isOmieInvoiceEmailStructureRejection(error: unknown): boolean {
  if (!isOmieStructureRejection(error)) return false;
  return /utilizar_emails|cenviarpara|\bemail\b/i.test(omieFaultText(error));
}

/** Codigos "modalidade" (modFrete) validos no frete do pedido de venda do OMIE. */
const OMIE_FREIGHT_MODALIDADES = new Set(["0", "1", "2", "3", "4", "9"]);

/** UF valida (2 letras) ou null — o `placa_estado` da NF-e nao aceita qualquer texto. */
function normalizePlateState(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : null;
}

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
  const plate =
    transport?.plate
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") || null;
  // UF da placa: a NF-e pede placa E UF do veiculo no transporte. A tag do bloco `frete`
  // do pedido de venda e `placa_estado` (nao `uf_placa`, que o OMIE recusa com
  // "Tag [UF_PLACA] nao faz parte da estrutura do tipo complexo [frete]"). So vai quando
  // e uma UF valida (2 letras) — campo fiscal nao aceita lixo, e sem ela o pedido segue
  // so com a placa.
  const plateState = normalizePlateState(transport?.plateState);
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
    ...(plate !== null && plateState !== null ? { placa_estado: plateState } : {}),
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
function buildTransportAdditionalData(transport?: CreateOrderPayload["transport"]): string | null {
  if (!transport) return null;
  const parts: string[] = [];
  const driverName = transport.driverName?.trim();
  const plate = transport.plate?.trim().toUpperCase();
  // A OS nao tem bloco `frete` para levar a UF da placa, entao na operacao interna ela
  // acompanha a placa no texto.
  const plateState = normalizePlateState(transport.plateState);
  if (driverName) parts.push(`Motorista: ${driverName}`);
  if (plate) parts.push(`Placa: ${plate}${plateState !== null ? `/${plateState}` : ""}`);
  return parts.length > 0 ? parts.join(" - ") : null;
}

/** Valor do frete em reais (o payload viaja em centavos). 0 quando nao ha frete. */
function toOmieFreightValue(freightTotalCents: number | null | undefined): number {
  if (typeof freightTotalCents !== "number" || freightTotalCents <= 0) return 0;
  return Math.round(freightTotalCents) / 100;
}

/** Rotulos das modalidades de frete (modFrete da NF-e) para os textos da OS. */
const OMIE_FREIGHT_MODALIDADE_LABELS: Record<string, string> = {
  "0": "CIF",
  "1": "FOB",
  "2": "terceiros",
  "3": "transporte proprio",
  "4": "transporte proprio",
  "9": "sem frete"
};

/**
 * Descricao da linha de frete da OS. A modalidade entra no texto porque a OS nao tem
 * campo `modalidade` como o bloco `frete` do pedido de venda.
 */
function buildFreightServiceDescription(payload: CreateOrderPayload): string {
  const modalidade = normalizeFreightModalidade(payload.freightModalidade);
  const label = modalidade !== null ? OMIE_FREIGHT_MODALIDADE_LABELS[modalidade] : undefined;
  return label && modalidade !== "9" ? `FRETE (${label})` : "FRETE";
}

/**
 * Dados da carga na propria linha de servico da OS (peso pesado e placa). A OS de granel
 * nao tem os campos de peso do bloco `frete` do pedido, entao o peso liquido viaja aqui.
 */
function buildServiceItemAdditionalData(payload: CreateOrderPayload): string | null {
  const parts: string[] = [];
  const cargoWeightKg = payload.transport?.cargoWeightKg;
  if (typeof cargoWeightKg === "number" && cargoWeightKg > 0) {
    parts.push(`Peso liquido: ${cargoWeightKg} kg`);
  }
  const plate = payload.transport?.plate?.trim().toUpperCase();
  if (plate) parts.push(`Placa: ${plate}`);
  return parts.length > 0 ? truncateOmieText(parts.join(" - "), 200) : null;
}

/**
 * Dados adicionais da OS da operacao interna. Concentra tudo o que o pedido de venda
 * espalha entre `frete`, `informacoes_adicionais` e o cadastro da transportadora — a OS
 * nao tem esses blocos, e sem este texto a venda sem nota chegava ao OMIE sem placa,
 * motorista, transportadora, peso nem referencia a pesagem que a originou.
 */
function buildServiceOrderAdditionalData(payload: CreateOrderPayload): string {
  const parts: string[] = ["VENDA SEM VALOR FISCAL - OPERACAO INTERNA KYBERROCK"];
  const reference = buildWeighingReference(payload);
  if (reference !== null) parts.push(reference);
  if (payload.localOperationId) {
    parts.push(`Operacao: ${payload.localOperationId}`);
  }
  const transportData = buildTransportAdditionalData(payload.transport);
  if (transportData) parts.push(transportData);
  const carrierName = payload.transport?.carrierName?.trim() || payload.carrier?.name?.trim();
  if (payload.transport?.ownVehicle) {
    parts.push("Transporte proprio");
  } else if (carrierName) {
    parts.push(`Transportadora: ${carrierName}`);
  }
  const cargoWeightKg = payload.transport?.cargoWeightKg;
  if (typeof cargoWeightKg === "number" && cargoWeightKg > 0) {
    parts.push(`Peso liquido: ${cargoWeightKg} kg`);
  }
  const freightValue = toOmieFreightValue(payload.freightTotalCents);
  if (freightValue > 0) {
    parts.push(`${buildFreightServiceDescription(payload)}: R$ ${freightValue.toFixed(2)}`);
  }
  return truncateOmieText(parts.join(" | "), 500);
}

/**
 * Como a pesagem se apresenta dentro do OMIE: "Pesagem KyberRock 000123". E o codigo
 * sequencial que o operador ve na balanca e no cupom, o unico numero que serve para achar
 * a operacao de olho — o UUID nao serve, e o numero do pedido e do OMIE, nao nosso.
 *
 * Null quando a operacao nao tem codigo (base antiga, antes da migracao 46, ou desktop
 * desatualizado que ainda nao manda o campo): nesse caso o texto sai como sempre saiu.
 */
function buildWeighingReference(payload: CreateOrderPayload): string | null {
  const code = payload.operationCode;
  if (typeof code !== "number" || !Number.isFinite(code) || code <= 0) return null;
  return `Pesagem KyberRock ${String(Math.floor(code)).padStart(6, "0")}`;
}

/**
 * Dados adicionais da NF do pedido de venda: referencia da pesagem + motorista/placa.
 *
 * A referencia vem primeiro de proposito — e o que fecha o vinculo no sentido
 * KyberRock -> OMIE. O outro sentido ja existia (a operacao guarda o codigo do pedido),
 * mas quem abria o pedido no OMIE nao tinha como voltar ate o carregamento.
 */
function buildSalesOrderAdditionalData(payload: CreateOrderPayload): string | null {
  const parts: string[] = [];
  // Vem ANTES da referencia da pesagem: `truncateOmieText` corta o fim, e esta e a unica
  // linha do texto que tem efeito fiscal — a remessa de entrega futura precisa apontar
  // para a nota de faturamento que a originou.
  const futureBilling = buildFutureBillingReference(payload);
  if (futureBilling !== null) parts.push(futureBilling);
  const reference = buildWeighingReference(payload);
  if (reference !== null) parts.push(reference);
  const transportData = buildTransportAdditionalData(payload.transport);
  if (transportData !== null) parts.push(transportData);
  return parts.length > 0 ? truncateOmieText(parts.join(" - "), 500) : null;
}

/**
 * Referencia a NF-e de faturamento futuro nos dados adicionais da nota.
 *
 * O texto e por extenso (e nao so o numero) porque e ele que o cliente le no DANFE para
 * amarrar a carga que chegou a nota que ele ja pagou. Null quando o cliente nao tem
 * entrega futura em aberto para o produto desta pesagem.
 */
function buildFutureBillingReference(payload: CreateOrderPayload): string | null {
  const number = payload.futureBillingNfeNumber?.trim().slice(0, 20);
  if (!number) return null;
  return `Remessa referente a NF-e de faturamento futuro n. ${number} (venda para entrega futura)`;
}

/** Corta textos livres antes de enviar ao OMIE, que rejeita campos acima do limite. */
function truncateOmieText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

async function createAndBillOmieOrder(
  credentials: OmieCredentials,
  payload: CreateOrderPayload
): Promise<CreateAndBillOrderResult> {
  if (payload.operationType !== "invoice") {
    throw new Error("Faturamento automatico disponivel apenas para pedido de venda fiscal");
  }

  const { orderId, orderNumber, omieCustomerId, omieCarrierId } = await createOmieOrder(
    credentials,
    payload
  );
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
    // A consulta pos-faturamento e a chance mais confiavel de pegar o numero visivel:
    // o IncluirPedido costuma responder so com o codigo interno.
    orderNumber: orderNumber ?? extractOrderNumber(consultedOrder, "numero_pedido"),
    omieCustomerId,
    omieCarrierId,
    billed: true,
    billingStatusCode: billing.statusCode,
    billingStatusMessage: billing.statusMessage,
    invoiceNumber:
      extractOmieInvoiceNumber(consultedOrder) ??
      extractOmieInvoiceNumber(orderDocument) ??
      extractOmieInvoiceNumber(billing.raw),
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

async function consultServiceOrder(
  credentials: OmieCredentials,
  orderId: number
): Promise<unknown> {
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

/**
 * O registro ja foi FATURADO no OMIE?
 *
 * Duas evidencias, e a NOTA vem primeiro: documento fiscal emitido e faturamento, ponto —
 * nao existe NF-e de venda que nao saiu. Depois vem a etapa do kanban (o KyberRock cria
 * tudo na "50 - Faturar"; faturar empurra para 60 ou alem).
 *
 * A ordem era a inversa, e a etapa mandava sozinha: uma venda com nota emitida cuja etapa
 * nao tivesse sido movida (ou que o OMIE devolvesse como numero abaixo de 60) voltava como
 * NAO faturada — e o `markChecked` do desktop jogava fora o numero que tinha vindo junto.
 * A pesagem continuava em "No OMIE, falta faturar" com a nota ja na mao do cliente.
 *
 * Vale para o pedido de venda (NF-e) e para a ordem de servico (NFS-e), que usam nomes de
 * campo diferentes para a mesma coisa. Serve a dois usos: barrar o cancelamento do que ja
 * virou nota e virar a situacao da pesagem para "Faturada" quando quem faturou foi uma
 * pessoa dentro do OMIE.
 */
function isOmieOrderBilled(consult: unknown): boolean {
  if (extractOmieInvoiceNumber(consult) !== null) return true;
  const etapa = findStringByKey(consult, "etapa") ?? findStringByKey(consult, "cEtapa");
  if (etapa && /^\d+$/.test(etapa.trim())) {
    return Number(etapa.trim()) >= 60;
  }
  return false;
}

/**
 * Nomes que o OMIE usa para o NUMERO da nota, em ordem de preferencia.
 *
 * A mesma informacao tem nome diferente em cada modulo — e ate dentro do mesmo modulo,
 * conforme a estrutura consultada (pedido, documento fiscal, ordem de servico). Quem
 * listava so meia duzia deles deixava a coluna "Nota fiscal" vazia em cadastro que tinha
 * a nota ali, com o numero num campo de nome vizinho. A busca e por chave, em profundidade
 * (`findStringByKey`), entao ampliar a lista nao custa chamada nenhuma: custa so tentar
 * mais um nome no objeto que ja esta na memoria.
 *
 * A NFS-e vem primeiro porque a venda interna vira ordem de servico, e a consulta da OS
 * tambem carrega dados do pedido de origem: procurar a NF-e antes acharia o numero errado.
 *
 * Todos aqui carregam "nfe"/"nfse"/"nf" no proprio nome — e o que permite procura-los em
 * QUALQUER profundidade da resposta sem risco de pegar outro numero pelo caminho.
 */
const OMIE_INVOICE_NUMBER_KEYS = [
  // NFS-e (ordem de servico / venda interna)
  "numero_nfse",
  "cNumNFSe",
  "nNumNFSe",
  "nNumeroNFSe",
  "numero_nfs",
  // NF-e (pedido de venda)
  "numero_nfe",
  "nNumeroNFe",
  "nf_numero",
  "numero_nf",
  "nNF"
];

/**
 * Nomes GENERICOS de numero — so valem dentro de um bloco de documento fiscal.
 *
 * `cNumero` e `nNumero` sao os nomes que os documentos fiscais do pedido
 * (`/produtos/dfedocs/`) usam para o numero da nota, mas o OMIE tambem os usa para numero
 * de endereco, de parcela e de item. Procura-los solto na resposta inteira gravaria um
 * numero qualquer na coluna "Nota fiscal" — e, pior, faria `isOmieOrderBilled` dar por
 * faturada uma venda que nao saiu. Por isso eles so sao procurados DENTRO de um bloco cujo
 * nome ja diz que ali mora documento fiscal.
 */
const OMIE_INVOICE_NUMBER_SCOPED_KEYS = [
  "cNumero",
  "nNumero",
  "numero",
  "cNumeroDocumento",
  "numero_documento"
];

/** Nomes de bloco que so guardam documento fiscal. */
const OMIE_FISCAL_CONTAINER_PATTERN = /(documento|dfe|danfe|nfe|nfse|nota_fiscal|notafiscal)/i;

/** Nomes da CHAVE de acesso da NF-e (44 digitos), de onde o numero pode ser derivado. */
const OMIE_INVOICE_KEY_KEYS = ["chave_nfe", "cChaveNFe", "chave_acesso", "cChaveAcesso"];

/** Um valor de campo do OMIE que serve como numero de nota (nem vazio, nem so zeros). */
function usableInvoiceNumber(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  // "0" e o vazio do OMIE em campo numerico.
  if (trimmed.length === 0 || /^0+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Procura os nomes genericos apenas dentro dos blocos de documento fiscal da resposta.
 *
 * Desce a arvore inteira atras de um bloco cujo NOME case com
 * `OMIE_FISCAL_CONTAINER_PATTERN` e, dentro dele, aceita os nomes genericos de numero.
 */
function findInvoiceNumberInFiscalBlock(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInvoiceNumberInFiscalBlock(item);
      if (found !== null) return found;
    }
    return null;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (!nested || typeof nested !== "object") continue;
    if (OMIE_FISCAL_CONTAINER_PATTERN.test(key)) {
      for (const numberKey of OMIE_INVOICE_NUMBER_SCOPED_KEYS) {
        const found = usableInvoiceNumber(findStringByKey(nested, numberKey));
        if (found !== null) return found;
      }
    }
    const deeper = findInvoiceNumberInFiscalBlock(nested);
    if (deeper !== null) return deeper;
  }

  return null;
}

/**
 * O numero da NF-e escondido dentro da chave de acesso.
 *
 * A chave tem 44 digitos com posicoes fixas: cUF(2) + AAMM(4) + CNPJ(14) + modelo(2) +
 * serie(3) + **numero(9)** + tpEmis(1) + codigo(8) + DV(1). Quando o OMIE devolve so a
 * chave — acontece em documento consultado por um caminho e nao por outro —, guardar a
 * chave inteira na coluna "Nota fiscal" nao serve para ninguem: o cliente e o contador
 * dele pedem o numero, e e ele que esta impresso na DANFE. Daqui sai esse numero.
 */
function invoiceNumberFromAccessKey(key: string): string | null {
  const digits = key.replace(/\D/g, "");
  if (digits.length !== 44) return null;
  const number = digits.slice(25, 34).replace(/^0+/, "");
  return number.length > 0 ? number : null;
}

/**
 * Numero do documento fiscal emitido no faturamento, quando ha. NF-e no pedido de venda,
 * NFS-e na ordem de servico — o OMIE nomeia o campo de um jeito em cada modulo. Alimenta
 * tanto a deteccao do faturamento quanto a mensagem que a conferencia mostra na linha.
 *
 * Tres passadas, da mais segura para a mais ampla: nomes que ja dizem "nota fiscal" em
 * qualquer profundidade; nomes genericos, so dentro de bloco de documento fiscal; e, por
 * fim, a chave de acesso, de onde o numero sai por posicao.
 */
function extractOmieInvoiceNumber(consult: unknown): string | null {
  for (const key of OMIE_INVOICE_NUMBER_KEYS) {
    const found = usableInvoiceNumber(findStringByKey(consult, key));
    if (found !== null) return found;
  }

  const scoped = findInvoiceNumberInFiscalBlock(consult);
  if (scoped !== null) return scoped;

  for (const key of OMIE_INVOICE_KEY_KEYS) {
    const found = findStringByKey(consult, key);
    if (found === null) continue;
    const fromKey = invoiceNumberFromAccessKey(found);
    if (fromKey !== null) return fromKey;
  }

  return null;
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

  if (isSales && isOmieOrderBilled(consult)) {
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

type CheckOrderBillingPayload = {
  orders?: Array<{
    operationId: string;
    orderType: "sales" | "service";
    omieOrderId: number;
  }>;
  /**
   * Quantas consultas dirigidas esta passada pode gastar atras do NUMERO da nota.
   *
   * O rodizio de fundo usa o padrao baixo: ele roda a cada tres minutos e divide a fila
   * com o envio dos fechamentos. Quando quem pediu foi a TELA (o relatorio aberto, o botao
   * "Conferir notas no OMIE"), o desktop pede um teto maior — ali existe alguem esperando
   * o numero, e a passada seguinte so vem quando esta terminar.
   */
  invoiceNumberBudget?: number;
};

/**
 * Situacao de UM pedido/OS conferida no OMIE. `found: false` = o registro nao existe mais
 * la (excluido por alguem); o desktop nao mexe na operacao nesse caso, so registra.
 */
type OrderBillingState = {
  operationId: string;
  orderType: "sales" | "service";
  omieOrderId: number;
  found: boolean;
  billed: boolean;
  /** Numero visivel do pedido/OS no OMIE, para a conferencia mostrar o que se procura la. */
  orderNumber: string | null;
  /** Numero da NF-e/NFS-e emitida no faturamento, quando o OMIE ja o devolve. */
  invoiceNumber: string | null;
  documentUrl: string | null;
  error: string | null;
};

/**
 * Quantos registros uma passada confere.
 *
 * Era 40 porque cada registro custava UMA chamada ao OMIE, a 3 segundos por chamada
 * (`OMIE_REQUEST_DELAY_MS`, fila serializada e compartilhada com o envio dos fechamentos):
 * conferir 40 pesagens travava a fila por dois minutos. Com a LISTAGEM, uma chamada traz
 * 100 registros, e o teto pode subir para cobrir o movimento de um dia inteiro numa
 * passada — que e o que faz a tela de conferencia acompanhar o dia em vez de correr atras.
 */
const CHECK_ORDER_BILLING_MAX = 300;

/** Registros por pagina na listagem de pedidos/OS (o maximo que o OMIE aceita). */
const ORDER_LISTING_PAGE_SIZE = 100;

/**
 * Teto de paginas por tipo de documento numa passada. 10 paginas = 1000 registros = ~30s
 * de fila. Na pratica quase nunca se chega perto: a listagem vem do codigo maior para o
 * menor e para assim que passa do documento mais antigo procurado.
 */
const ORDER_LISTING_MAX_PAGES = 10;

/**
 * A partir de quantos documentos a listagem compensa. Abaixo disso a consulta individual
 * sai mais barata: 3 consultas custam 3 chamadas, e uma pagina de listagem custa 1 — mas
 * so cobre os documentos recentes, e ainda pode precisar de mais paginas.
 */
const ORDER_LISTING_MIN_BATCH = 4;

/**
 * Teto de consultas individuais numa passada (o caminho de recuperacao). Existe para o
 * pior caso: se a listagem nao servir para nada, conferir 300 pesagens uma a uma seriam 15
 * minutos de fila com o envio dos fechamentos parado atras. O que nao couber mantem o
 * `omie_billing_checked_at` antigo no desktop e volta na frente da fila na proxima passada.
 */
const CONSULT_FALLBACK_MAX = 25;

/**
 * Teto de chamadas numa passada para ir buscar o NUMERO DA NOTA do que ja consta faturado.
 *
 * A listagem reconhece o faturamento pela etapa do kanban, mas nao carrega a NF-e: o numero
 * mora nos documentos fiscais do pedido (`/produtos/dfedocs/`), fora da listagem e fora do
 * proprio pedido. Sem esta busca dirigida a pesagem virava "Faturada" com a coluna "Nota
 * fiscal" vazia — e como ela saia da fila de conferencia ao virar faturada, ficava assim
 * para sempre, inclusive no relatorio que vai para o cliente.
 *
 * Dez chamadas = ~30s da fila serializada, ao lado das 25 do caminho de recuperacao. O que
 * nao couber volta na proxima passada: o desktop mantem na fila quem esta faturado sem
 * numero, entao o acervo e drenado em passadas sucessivas em vez de tudo numa so.
 */
const INVOICE_NUMBER_CHASE_MAX = 10;

/**
 * Teto do teto: o maximo que uma passada pedida pela TELA pode gastar atras do numero.
 *
 * Cada consulta e uma chamada de ~3s na fila serializada (`OMIE_REQUEST_DELAY_MS`), entao
 * 20 sao ~60s — junto com a listagem, cabe folgado no tempo de vida da funcao e devolve a
 * fila para o faturamento logo em seguida. O que nao couber nao se perde: o desktop pede a
 * proxima leva assim que esta volta, e a tela vai se preenchendo enquanto o operador
 * trabalha, em vez de parar nos dez primeiros para sempre.
 */
const INVOICE_NUMBER_CHASE_CEILING = 20;

/** O teto desta passada: o pedido da tela, limitado; sem pedido, o do rodizio de fundo. */
function resolveInvoiceNumberBudget(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return INVOICE_NUMBER_CHASE_MAX;
  }
  return Math.min(Math.floor(requested), INVOICE_NUMBER_CHASE_CEILING);
}

/** O que a listagem sabe dizer sobre um documento, sem a consulta individual. */
type ListedBillingState = {
  billed: boolean;
  orderNumber: string | null;
  invoiceNumber: string | null;
  documentUrl: string | null;
};

/**
 * Confere no OMIE quais pedidos/OS ja foram faturados.
 *
 * Quem fatura e uma PESSOA, dentro do OMIE, na coluna "Faturar" — o KyberRock nunca fica
 * sabendo por conta propria, e por isso a pesagem ficava para sempre em "No OMIE, falta
 * faturar" mesmo depois da nota sair. Esta consulta e o caminho de volta: o desktop manda
 * os pedidos/OS que ainda nao constam faturados aqui, e cada um volta com a situacao real
 * la, o numero visivel e o documento emitido.
 *
 * Uma falha isolada nao derruba a passada: o registro volta com `error` preenchido e a
 * proxima sincronizacao tenta de novo.
 */
async function checkOmieOrdersBilling(
  credentials: OmieCredentials,
  payload: CheckOrderBillingPayload | undefined
): Promise<OrderBillingState[]> {
  const orders = (payload?.orders ?? []).slice(0, CHECK_ORDER_BILLING_MAX);
  if (orders.length === 0) return [];

  const results: OrderBillingState[] = [];
  /**
   * Quem ja passou pela consulta individual do proprio documento.
   *
   * Nesses, o `ConsultarPedido` ja foi feito e o numero da nota ja foi procurado na
   * resposta: repetir a chamada no fallback nao traria nada novo — so gastaria uma
   * chamada de ~3s da fila, por pesagem, exatamente no caminho que ja e o caro.
   */
  const alreadyConsulted = new Set<string>();
  let consultBudget = CONSULT_FALLBACK_MAX;

  for (const orderType of ["sales", "service"] as const) {
    const group = orders.filter((order) => order.orderType === orderType);
    if (group.length === 0) continue;

    // Listagem primeiro: uma chamada resolve ate 100 documentos. So vale a pena a partir
    // de um punhado deles — abaixo disso a consulta individual custa menos chamadas.
    const listed =
      group.length >= ORDER_LISTING_MIN_BATCH
        ? await listOmieOrderBillingStates(
            credentials,
            orderType,
            group.map((order) => order.omieOrderId)
          )
        : new Map<number, ListedBillingState>();

    for (const order of group) {
      const base = {
        operationId: order.operationId,
        orderType: order.orderType,
        omieOrderId: order.omieOrderId
      };

      const fromListing = listed.get(order.omieOrderId);
      if (fromListing) {
        results.push({ ...base, found: true, ...fromListing, error: null });
        continue;
      }

      // Nao apareceu na listagem. Pode ser documento antigo demais (a listagem para
      // quando passa do procurado), pode ser excluido no OMIE — a consulta individual
      // separa os dois. Sem orcamento, fica para a proxima passada: o desktop nao recebe
      // resultado para ele e nao mexe no rodizio dele.
      if (consultBudget <= 0) continue;
      consultBudget--;
      alreadyConsulted.add(order.operationId);
      results.push(await consultOmieOrderBilling(credentials, order));
    }
  }

  return await fillMissingInvoiceNumbers(
    credentials,
    results,
    resolveInvoiceNumberBudget(payload?.invoiceNumberBudget),
    alreadyConsulted
  );
}

/**
 * Vai buscar o numero da nota do que voltou faturado SEM numero.
 *
 * E o caso normal, nao a excecao: quem fatura e uma pessoa dentro do OMIE, e a conferencia
 * barata (a listagem) so enxerga a etapa do kanban. O numero da NF-e sai dos documentos
 * fiscais do pedido — o mesmo `ObterPedVenda` que o faturamento pelo proprio app ja
 * consultava — e o da NFS-e sai da consulta da ordem de servico.
 *
 * Uma chamada por pesagem, com teto por passada: o que nao couber continua na fila do
 * desktop e volta na proxima. Falha aqui nao invalida a conferencia — a pesagem ja consta
 * faturada, so segue sem o numero ate a proxima tentativa.
 */
async function fillMissingInvoiceNumbers(
  credentials: OmieCredentials,
  results: OrderBillingState[],
  maxChases: number = INVOICE_NUMBER_CHASE_MAX,
  /** Ids que ja passaram pela consulta individual — ver `alreadyConsulted`. */
  alreadyConsulted: ReadonlySet<string> = new Set()
): Promise<OrderBillingState[]> {
  let budget = maxChases;

  for (const result of results) {
    if (budget <= 0) break;
    if (!result.found || !result.billed || result.invoiceNumber !== null) continue;
    if (result.omieOrderId <= 0) continue;
    budget--;

    try {
      const document =
        result.orderType === "sales"
          ? await getSalesOrderDocument(credentials, result.omieOrderId)
          : await consultServiceOrder(credentials, result.omieOrderId);
      result.invoiceNumber = extractOmieInvoiceNumber(document);
      result.documentUrl = result.documentUrl ?? extractDocumentUrl(document);
    } catch (error) {
      console.error(
        `[omie] nao foi possivel obter o numero da nota do ${
          result.orderType === "sales" ? "pedido" : "OS"
        } ${result.omieOrderId}`,
        error
      );
    }

    // Segunda tentativa da venda com nota: o PROPRIO pedido.
    //
    // O numero da NF-e aparece em dois lugares do OMIE, e nem sempre nos dois ao mesmo
    // tempo: nos documentos fiscais do pedido (`/produtos/dfedocs/`) e nas informacoes
    // adicionais do pedido (`ConsultarPedido`) — este ultimo e o campo que o proprio
    // faturamento pelo app ja lia. Parar na primeira consulta deixava a coluna "Nota
    // fiscal" vazia justamente na venda faturada por uma pessoa dentro do OMIE, que e o
    // caso normal. Custa uma chamada a mais, e so para quem voltou faturado SEM numero.
    if (
      result.invoiceNumber === null &&
      result.orderType === "sales" &&
      budget > 0 &&
      // Quem ja veio da consulta individual nao repete: aquela resposta e a MESMA que este
      // fallback pediria, e ela ja foi vasculhada atras do numero.
      !alreadyConsulted.has(result.operationId)
    ) {
      budget--;
      try {
        const order = await consultSalesOrder(credentials, result.omieOrderId);
        result.invoiceNumber = extractOmieInvoiceNumber(order);
        result.documentUrl = result.documentUrl ?? extractDocumentUrl(order);
      } catch (error) {
        console.error(
          `[omie] nao foi possivel obter o numero da nota pelo pedido ${result.omieOrderId}`,
          error
        );
      }
    }
  }

  return results;
}

/** Confere UM documento pela consulta direta — o caminho preciso, de uma chamada cada. */
async function consultOmieOrderBilling(
  credentials: OmieCredentials,
  order: { operationId: string; orderType: "sales" | "service"; omieOrderId: number }
): Promise<OrderBillingState> {
  const isSales = order.orderType === "sales";
  const base = {
    operationId: order.operationId,
    orderType: order.orderType,
    omieOrderId: order.omieOrderId
  };
  try {
    const consult = isSales
      ? await consultSalesOrder(credentials, order.omieOrderId)
      : await consultServiceOrder(credentials, order.omieOrderId);
    return {
      ...base,
      found: true,
      billed: isOmieOrderBilled(consult),
      orderNumber: extractOrderNumber(consult, isSales ? "numero_pedido" : "cNumOS"),
      invoiceNumber: extractOmieInvoiceNumber(consult),
      documentUrl: extractDocumentUrl(consult),
      error: null
    };
  } catch (error) {
    const message = getErrorMessage(error);
    // Excluido no OMIE: nao e erro de rede nem falha a re-tentar — e um fato sobre o
    // registro, e o desktop precisa distinguir os dois para nao insistir para sempre.
    const missing = isOmieNotFoundFault(message);
    return {
      ...base,
      found: !missing,
      billed: false,
      orderNumber: null,
      invoiceNumber: null,
      documentUrl: null,
      error: missing ? null : message
    };
  }
}

/**
 * Varre a listagem de pedidos (ou de OS) do OMIE atras dos documentos procurados.
 *
 * A varredura sai do documento mais novo e caminha para o mais velho — e isso que a torna
 * barata: os fechamentos de hoje estao logo na primeira pagina lida. Ela para em tres
 * situacoes: achou todos, a pagina ja passou do documento mais antigo que se procura (dali
 * para tras so tem coisa mais velha), ou bateu no teto de paginas.
 *
 * Qual pagina e a "mais nova" depende da ordem que o OMIE devolver, e ela nao e garantida:
 * o pedido de ordem decrescente esta marcado como DEPRECATED no modulo de Vendas. Por isso
 * a ordem e conferida na primeira pagina, e nao presumida.
 *
 * Mapa vazio nao e erro: significa "a listagem nao resolveu", e quem chama cai na consulta
 * individual. E o que mantem a conferencia correta mesmo se o OMIE mudar a listagem.
 */
async function listOmieOrderBillingStates(
  credentials: OmieCredentials,
  orderType: "sales" | "service",
  wantedIds: number[]
): Promise<Map<number, ListedBillingState>> {
  const wanted = new Set(wantedIds);
  const smallestWanted = Math.min(...wantedIds);
  const found = new Map<number, ListedBillingState>();

  // A varredura anda SEMPRE do documento mais novo para o mais velho — e so isso a torna
  // barata. Com a listagem decrescente esse caminho e a pagina 1 em diante; quando o OMIE
  // devolve crescente, e a ultima pagina para tras (ver a virada logo abaixo).
  let nextPage = 1;
  let step = 1;

  for (let visited = 0; visited < ORDER_LISTING_MAX_PAGES; visited++) {
    const pageNumber = nextPage;
    let page: OrderListingPage;
    try {
      page = await listOmieOrdersPage(credentials, orderType, pageNumber);
    } catch (error) {
      // Listagem indisponivel (campo recusado, instabilidade): nao derruba a conferencia,
      // so a devolve para o caminho da consulta individual.
      console.error(
        `[omie] listagem de ${orderType === "sales" ? "pedidos" : "OS"} falhou na pagina ${pageNumber}; ` +
          "conferindo o faturamento por consulta individual",
        error
      );
      break;
    }
    if (page.records.length === 0) break;

    let pageSmallestId = Number.POSITIVE_INFINITY;
    for (const record of page.records) {
      const id =
        orderType === "sales" ? extractSalesOrderId(record) : extractServiceOrderId(record);
      if (id === null) continue;
      if (id < pageSmallestId) pageSmallestId = id;
      if (!wanted.has(id)) continue;
      found.set(id, {
        billed: isOmieOrderBilled(record),
        orderNumber: extractOrderNumber(record, orderType === "sales" ? "numero_pedido" : "cNumOS"),
        invoiceNumber: extractOmieInvoiceNumber(record),
        documentUrl: extractDocumentUrl(record)
      });
      if (found.size === wanted.size) return found;
    }

    // A virada: a primeira pagina revela em que ordem o OMIE de fato respondeu. O campo de
    // ordem decrescente de Vendas esta marcado como DEPRECATED, entao ele pode ser aceito e
    // ignorado — e ai a pagina 1 traz os documentos mais VELHOS do cadastro, longe do
    // movimento de hoje. Quando isso acontece a varredura segue pela outra ponta: da ultima
    // pagina para tras, que e onde a ordem crescente guarda os fechamentos recentes.
    if (visited === 0 && isOrderListingAscending(page.records, orderType)) {
      // Sem `total_de_paginas` nao da para achar essa ponta: a listagem nao serve, e a
      // conferencia cai na consulta individual — exata, so mais cara por documento.
      if (page.totalPages === null || page.totalPages <= 1) break;
      nextPage = page.totalPages;
      step = -1;
      continue;
    }

    // Passou do mais antigo procurado: continuar so gastaria chamada com documento velho.
    if (pageSmallestId <= smallestWanted) break;

    nextPage = pageNumber + step;
    // Andando para tras, a pagina 1 ja foi lida na virada.
    if (nextPage < (step === -1 ? 2 : 1)) break;
  }

  return found;
}

/**
 * O campo que pede a ordem decrescente — o nome MUDA entre os dois modulos do OMIE.
 *
 * Vendas (`pvpListarRequest`, de ListarPedidos) so conhece `ordem_descrescente`, com o
 * "s" a mais; o erro de digitacao e do proprio OMIE e esta assim na documentacao dele.
 * Servicos (`osListarRequest`, de ListarOS) conhece `ordem_decrescente`, escrito certo.
 * Mandar o nome do outro modulo nao e ignorado: derruba a chamada INTEIRA com
 * "Tag [...] nao faz parte da estrutura do tipo complexo", que foi o que manteve a
 * conferencia de faturamento de pedidos no caminho caro por mais de um dia.
 */
function orderListingSortParam(isSales: boolean): Record<string, string> {
  return isSales ? { ordem_descrescente: "S" } : { ordem_decrescente: "S" };
}

/** Uma pagina da listagem, com o que o envelope diz sobre o tamanho dela. */
type OrderListingPage = {
  records: unknown[];
  /** `total_de_paginas` do envelope — a ponta nova da listagem quando ela vem crescente. */
  totalPages: number | null;
};

/**
 * Uma pagina da listagem.
 *
 * Pede a ordem decrescente, mas nao toma a resposta como garantida: no modulo de Vendas o
 * campo esta marcado como DEPRECATED na documentacao do OMIE, entao ele pode ser aceito e
 * ignorado. Quem chama confere a ordem que de fato veio (ver `listOmieOrderBillingStates`).
 * Se o OMIE recusar a chamada, o erro sobe e a conferencia cai na consulta individual.
 */
async function listOmieOrdersPage(
  credentials: OmieCredentials,
  orderType: "sales" | "service",
  page: number
): Promise<OrderListingPage> {
  const isSales = orderType === "sales";
  const response = await callOmie<unknown, unknown>(
    credentials,
    isSales ? "/produtos/pedido/" : "/servicos/os/",
    isSales ? "ListarPedidos" : "ListarOS",
    {
      pagina: page,
      registros_por_pagina: ORDER_LISTING_PAGE_SIZE,
      apenas_importado_api: "N",
      ordenar_por: "CODIGO",
      ...orderListingSortParam(isSales)
    }
  );
  return {
    records: extractOrderListRecords(response),
    totalPages: extractOrderListTotalPages(response)
  };
}

/** `total_de_paginas` do envelope da listagem, quando o OMIE o devolve. */
function extractOrderListTotalPages(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  return toIntOrNull((response as Record<string, unknown>).total_de_paginas);
}

/**
 * A pagina veio do codigo MENOR para o maior?
 *
 * So responde "sim" com prova: precisa de um par em ordem crescente e de nenhum par
 * decrescente. Pagina de um registro so — ou de registros cujo codigo nao se le — nao
 * prova nada, e ai a varredura segue reto, como sempre seguiu.
 */
function isOrderListingAscending(records: unknown[], orderType: "sales" | "service"): boolean {
  let previous: number | null = null;
  let sawIncrease = false;
  for (const record of records) {
    const id = orderType === "sales" ? extractSalesOrderId(record) : extractServiceOrderId(record);
    if (id === null) continue;
    if (previous !== null) {
      if (id < previous) return false;
      if (id > previous) sawIncrease = true;
    }
    previous = id;
  }
  return sawIncrease;
}

/**
 * Os documentos de uma resposta de listagem. O nome do array muda entre os modulos do OMIE
 * (`pedido_venda_produto` em Vendas, `osCadastro` em Servicos) e ja variou entre versoes,
 * entao depois dos nomes conhecidos vale o primeiro array de objetos da resposta — os
 * outros campos do envelope (pagina, total_de_paginas) sao numeros.
 */
function extractOrderListRecords(response: unknown): unknown[] {
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  for (const key of [
    "pedido_venda_produto",
    "pedidoVendaProduto",
    "pedidos_venda_produto",
    "osCadastro",
    "os_cadastro",
    "osCadastros"
  ]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) {
      return value;
    }
  }
  return [];
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
