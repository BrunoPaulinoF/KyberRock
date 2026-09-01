import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isOmieCustomerCadastro } from "@kyberrock/omie-client";
import { documentKind, normalizeDocument } from "@kyberrock/shared";

import {
  getDefaultSupabasePublishableKey,
  getDefaultSupabaseUrl,
  isSupabaseConfigured,
  resetSupabaseConfigCache,
  setSupabaseConfigCache,
  supabaseConfig
} from "../config/supabase-config.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";
import { readLocalSetting, readStringLocalSetting, writeLocalSetting } from "./local-settings.js";
import { readOmieAdvanceConfig, rememberDetectedAdvanceConfig } from "./omie-advance-config.js";
import { ReportService } from "./reports.js";
import {
  ensureReportRecipientsTable,
  markRecipientSynced,
  markRecipientSyncError,
  type ReportRecipientRow
} from "./report-recipients.js";
import { getFreightModalityInfo } from "./freight.js";
import { mergeFollowerFreightRuleJson } from "./customer-freight-rules.js";
import {
  normalizeCreditMode,
  normalizeCreditPeriodicity,
  shouldApplyCloudCommercialBlock
} from "./customer-commercial-master.js";
import {
  clearCustomerCommercialRepublishPending,
  clearPriceMasterRepublishPending,
  clearPriceMasterResyncPending,
  cloudRowWins,
  isCustomerCommercialRepublishPending,
  isPriceMasterRepublishPending,
  isPriceMasterResyncPending,
  isPriceMasteredCadastroKey,
  priceConflictPolicy,
  readPriceAuthority,
  MASTERED_CUSTOMER_PAYLOAD_COLUMNS,
  PRICE_MASTERED_CADASTRO_KEYS,
  type PriceConflictPolicy
} from "./price-authority.js";
import { isSellableProduct } from "./product-classification.js";
import { readReportChannelSettings, toCloudChannelSettingsRow } from "./report-channels.js";
import {
  parseWhatsappConnectionLink,
  type WhatsappConnectionLink
} from "./whatsapp-connection-link.js";
import {
  enqueueSyncJob,
  getSyncJobById,
  listRunnableSyncJobs,
  markSyncJobBlocked,
  markSyncJobDone,
  markSyncJobFailed
} from "./sync-queue.js";
import {
  buildOmieBillingJob,
  enqueueOmieBillingJob,
  validateOperationFiscalReadiness
} from "./weighing-operations.js";
import { DOCUMENT_KEY_SQL, documentKey } from "./customer-identity.js";
import {
  isCadastroIncompleteFault,
  isOmieCustomerRegistrationFault,
  isOmieMissingDocumentFault,
  isOmieProtectedRecordFault,
  isOmieStaleCustomerCodeFault,
  isOmieAlreadyBilledFault
} from "./omie-fault-classifier.js";
import { provisionPaymentTermsFromOmieMirror } from "./payment-terms.js";
import { pruneMissingUnitDevices, upsertUnitDevices } from "./unit-devices.js";

let client: SupabaseClient | null = null;
let clientConfigKey: string | null = null;

// Carimbos de tempo gravados por SQL usam strftime ISO ('...T...Z') em vez de
// strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ("2026-07-29 17:00:48", UTC mas sem indicador de fuso). Com
// duas balancas na mesma pedreira os dois formatos se misturavam na mesma
// coluna, e tanto a comparacao lexical no SQL quanto Date.parse (que le o
// segundo formato como hora local) davam a versao errada como a mais nova.

export const CLOUD_SUPABASE_URL_KEY = "cloud_supabase_url";
export const CLOUD_PUBLISHABLE_KEY_KEY = "cloud_publishable_key";
const OMIE_BATCH_DELAY_MS = 3_000;
const OMIE_PUSH_CUSTOMER_BATCH_LIMIT = 10;
const OMIE_QUEUE_BATCH_LIMIT = 10;

export function readStoredSupabaseConfig(database: DesktopDatabase): {
  url: string;
  publishableKey: string;
} {
  const url = readStringLocalSetting(database, CLOUD_SUPABASE_URL_KEY) ?? "";
  const publishableKey = readStringLocalSetting(database, CLOUD_PUBLISHABLE_KEY_KEY) ?? "";
  return { url, publishableKey };
}

export function writeStoredSupabaseConfig(
  database: DesktopDatabase,
  values: { url?: string | null; publishableKey?: string | null },
  updatedAt: string = new Date().toISOString()
): void {
  if (values.url !== undefined) {
    const trimmed = values.url?.trim() ?? "";
    writeLocalSetting(
      database,
      CLOUD_SUPABASE_URL_KEY,
      trimmed.length > 0 ? trimmed : null,
      updatedAt
    );
  }
  if (values.publishableKey !== undefined) {
    const trimmed = values.publishableKey?.trim() ?? "";
    writeLocalSetting(
      database,
      CLOUD_PUBLISHABLE_KEY_KEY,
      trimmed.length > 0 ? trimmed : null,
      updatedAt
    );
  }
  resetSupabaseConfigCache();
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

export interface CloudBootstrapResult extends SyncResult {
  mode: "cloud" | "local_emergency";
  pulled: {
    customers: number;
    products: number;
    operations: number;
    loadingRequests: number;
    printReceipts: number;
    /** Cadastro compartilhado da pedreira (transportadoras, motoristas, veiculos, vinculos, precos, destinatarios). */
    cadastro: number;
    /** Avisos por tabela vindos do desktop-pull (ex.: tabela ausente na nuvem). */
    warnings: string[];
  };
}

interface DesktopPullResponse {
  customers?: Array<Record<string, unknown>>;
  products?: Array<Record<string, unknown>>;
  operations?: Array<Record<string, unknown>>;
  loadingRequests?: Array<Record<string, unknown>>;
  printReceipts?: Array<Record<string, unknown>>;
  devices?: Array<Record<string, unknown>>;
  carriers?: Array<Record<string, unknown>>;
  drivers?: Array<Record<string, unknown>>;
  vehicles?: Array<Record<string, unknown>>;
  customerCarriers?: Array<Record<string, unknown>>;
  customerVehicles?: Array<Record<string, unknown>>;
  driverCarriers?: Array<Record<string, unknown>>;
  vehicleCarriers?: Array<Record<string, unknown>>;
  productDefaultPrices?: Array<Record<string, unknown>>;
  customerSpecialPrices?: Array<Record<string, unknown>>;
  priceTables?: Array<Record<string, unknown>>;
  priceTableItems?: Array<Record<string, unknown>>;
  customerPriceTables?: Array<Record<string, unknown>>;
  customerFreightRules?: Array<Record<string, unknown>>;
  customerFutureBillingInvoices?: Array<Record<string, unknown>>;
  paymentTerms?: Array<Record<string, unknown>>;
  paymentMethods?: Array<Record<string, unknown>>;
  accounts?: Array<Record<string, unknown>>;
  customerCreditMovements?: Array<Record<string, unknown>>;
  reportRecipients?: Array<Record<string, unknown>>;
  warnings?: string[];
  /** Relogio do servidor no momento do pull, usado como marca do proximo incremento. */
  serverTime?: string;
}

export interface OmieCloudSyncResult {
  customersPulled: number;
  customersPushed: number;
  productsSynced: number;
  paymentTermsSynced: number;
  suppliersSynced: number;
  /** Categorias do plano gerencial espelhadas nesta pagina (omie_categories). */
  categoriesSynced: number;
  errors: string[];
  /**
   * O que o OMIE respondeu nesta pagina de clientes. Sem isto, um pull que traz
   * menos do que existe no OMIE fica indistinguivel de um pull completo: a tela
   * so mostra o total baixado, e nao da para saber se a varredura parou cedo
   * (paginas) ou se o cadastro foi descartado na classificacao (tags).
   */
  customersPage?: OmieCustomersPageInfo;
}

export interface OmieCustomersPageInfo {
  /** Pagina pedida ao OMIE. */
  page: number;
  /** Registros crus que o OMIE devolveu nesta pagina (antes da classificacao). */
  returned: number;
  /** Quantos viraram cliente e quantos viraram transportadora. */
  classifiedCustomers: number;
  classifiedCarriers: number;
  /** Sem codigo ou sem razao social no OMIE. */
  invalid: number;
  /** Fornecedor puro: nao compra da pedreira. */
  supplierOnly: number;
  finished: boolean;
  /** Totais declarados pelo proprio OMIE. */
  totalPages: number | null;
  totalRecords: number | null;
}

export interface FiscalBillingResult {
  orderId: number | null;
  billed: boolean;
  /** true quando o faturamento foi bloqueado por pendencia de cadastro (nao é erro/retry). */
  blocked?: boolean;
  /** Mensagem acionavel da pendencia (ex.: preencher Numero do Endereco + E-mail). */
  blockReason?: string | null;
  /**
   * O OMIE recusou o faturamento dizendo que o pedido JA estava faturado la, e a situacao
   * local foi reconciliada a partir disso. Vem junto de `billed: true`: nao ha o que
   * refazer, a nota daquela carga existe.
   */
  alreadyBilledInOmie?: boolean;
  billingStatusCode: string | null;
  billingStatusMessage: string | null;
  documentUrl: string | null;
  documentPrinted: boolean;
  documentPrintError: string | null;
}

interface OmieReferenceCustomer {
  id: number;
  integrationCode?: string | null;
  name: string;
  tradeName: string | null;
  document: string | null;
  stateRegistration?: string | null;
  municipalRegistration?: string | null;
  isIndividual?: boolean;
  email: string | null;
  /** `recomendacoes.email_fatura` do OMIE: os destinatarios da NF-e/boleto. */
  fiscalEmails?: string | null;
  homepage?: string | null;
  contactName?: string | null;
  phone: string | null;
  phoneSecondary?: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement?: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country?: string | null;
  countryCode?: string | null;
  ibgeCityCode?: string | null;
  ibgeStateCode?: string | null;
  customerType?: string | null;
  isForeign?: boolean;
  billingBlocked?: boolean;
  isActive?: boolean;
  observations?: string | null;
  tagsJson?: Record<string, unknown> | unknown[] | null;
  salespersonId?: number | null;
  defaultPaymentTermId: string | null;
}

interface OmieReferenceProduct {
  id: number;
  code: string | null;
  integrationCode?: string | null;
  description: string;
  detailedDescription?: string | null;
  unit: string | null;
  ncm: string | null;
  ean: string | null;
  unitPriceCents: number | null;
  familyCode?: string | null;
  familyDescription?: string | null;
  brand?: string | null;
  model?: string | null;
  internalNotes?: string | null;
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
  heightM?: number | null;
  widthM?: number | null;
  depthM?: number | null;
  cest?: string | null;
  itemType?: string | null;
  icmsOrigin?: string | null;
  isActive?: boolean;
  blocked?: boolean;
  tracksStock?: boolean;
  fiscalRecommendations?: Record<string, unknown> | null;
}

export interface OmieReferencePaymentTerm {
  id: number;
  code?: string | null;
  integrationCode?: string | null;
  description: string;
  firstInstallmentDays?: number | null;
  installmentIntervalDays?: number | null;
  installmentCount?: number | null;
  installmentType?: string | null;
  installmentDaysJson?: number[] | null;
  isActive?: boolean;
  visible?: boolean;
}

interface OmieReferenceSupplier {
  id: number;
  integrationCode?: string | null;
  name: string;
  tradeName?: string | null;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  zipcode?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  isActive?: boolean;
  tagsJson?: Record<string, unknown> | unknown[] | null;
}

/** Categoria do plano gerencial do OMIE, como o edge devolve no pull. */
export interface OmieReferenceCategory {
  code: string;
  description: string;
  categoryType?: string | null;
  parentCode?: string | null;
  isActive?: boolean;
}

interface OmieReferenceDataResponse {
  customers?: OmieReferenceCustomer[];
  products?: OmieReferenceProduct[];
  paymentTerms?: OmieReferencePaymentTerm[];
  suppliers?: OmieReferenceSupplier[];
  categories?: OmieReferenceCategory[];
  pageSize?: number;
  pagination?: {
    customersPage: number;
    productsPage: number;
    paymentTermsPage: number;
    suppliersPage?: number;
    /** Ausente quando o edge ainda nao envia categorias (versao antiga). */
    categoriesPage?: number;
    customersReturned: number;
    customersInvalid?: number;
    customersSupplierOnly?: number;
    productsReturned: number;
    paymentTermsReturned: number;
    suppliersReturned?: number;
    categoriesReturned?: number;
    customersFinished?: boolean;
    productsFinished?: boolean;
    paymentTermsFinished?: boolean;
    suppliersFinished?: boolean;
    categoriesFinished?: boolean;
    customersTotalPages?: number | null;
    customersTotalRecords?: number | null;
    productsTotalPages?: number | null;
    productsTotalRecords?: number | null;
    paymentTermsTotalPages?: number | null;
    paymentTermsTotalRecords?: number | null;
    suppliersTotalPages?: number | null;
    suppliersTotalRecords?: number | null;
    categoriesTotalPages?: number | null;
    categoriesTotalRecords?: number | null;
  };
}

interface OmiePullState {
  customersPage: number;
  productsPage: number;
  paymentTermsPage: number;
  suppliersPage: number;
  categoriesPage: number;
  customersFinished: boolean;
  productsFinished: boolean;
  paymentTermsFinished: boolean;
  suppliersFinished: boolean;
  categoriesFinished: boolean;
  inProgress: boolean;
  lastUpdatedAt: string | null;
}

const OMIE_PULL_STATE_KEY = "omie_pull_state";

export function readOmiePullState(database: DesktopDatabase): OmiePullState {
  const stored = readLocalSetting<OmiePullState>(database, OMIE_PULL_STATE_KEY);
  return {
    customersPage: 1,
    productsPage: 1,
    paymentTermsPage: 1,
    suppliersPage: 1,
    categoriesPage: 1,
    customersFinished: false,
    productsFinished: false,
    paymentTermsFinished: false,
    suppliersFinished: false,
    categoriesFinished: false,
    inProgress: false,
    lastUpdatedAt: null,
    ...(stored ?? {})
  };
}

export function writeOmiePullState(
  database: DesktopDatabase,
  patch: Partial<OmiePullState> & {
    markDone?: "customers" | "products" | "paymentTerms" | "categories";
  }
): OmiePullState {
  const current = readOmiePullState(database);
  const next: OmiePullState = {
    ...current,
    ...patch,
    lastUpdatedAt: new Date().toISOString()
  };
  if (patch.markDone === "customers") {
    next.customersPage = 1;
    next.suppliersPage = 1;
    next.customersFinished = true;
    next.suppliersFinished = true;
  }
  if (patch.markDone === "products") {
    next.productsPage = 1;
    next.productsFinished = true;
  }
  if (patch.markDone === "paymentTerms") {
    next.paymentTermsPage = 1;
    next.paymentTermsFinished = true;
  }
  if (patch.markDone === "categories") {
    next.categoriesPage = 1;
    next.categoriesFinished = true;
  }
  if (
    next.customersFinished &&
    next.productsFinished &&
    next.paymentTermsFinished &&
    next.categoriesFinished
  ) {
    next.inProgress = false;
  }
  writeLocalSetting(database, OMIE_PULL_STATE_KEY, next);
  return next;
}

interface CloudSettings {
  companyId: string;
  unitId: string;
  deviceId: string;
  deviceToken: string;
}

export function initializeSupabase(): void {
  if (!client && isSupabaseConfigured()) {
    const configKey = `${supabaseConfig.url}|${supabaseConfig.publishableKey}`;
    client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    clientConfigKey = configKey;
  }
}

export function initializeSupabaseFromSettings(
  database: DesktopDatabase,
  options: { reset?: boolean } = {}
): void {
  const stored = readStoredSupabaseConfig(database);
  if (options.reset) {
    setSupabaseConfigCache(null, null);
    if (client) {
      client = null;
      clientConfigKey = null;
    }
    return;
  }
  setSupabaseConfigCache(stored.url || null, stored.publishableKey || null);
  const configKey = `${supabaseConfig.url}|${supabaseConfig.publishableKey}`;
  if (client && clientConfigKey !== configKey) {
    client = null;
    clientConfigKey = null;
  }
  if (!client && isSupabaseConfigured()) {
    client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    clientConfigKey = configKey;
  }
}

export function isSupabaseInitialized(): boolean {
  return client !== null;
}

export function ensureSupabaseInitialized(): SupabaseClient | null {
  initializeSupabase();
  return client;
}

export async function pingSupabase(timeoutMs = 4_000): Promise<boolean> {
  const instance = ensureSupabaseInitialized();
  if (!instance) {
    return false;
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { error } = await instance
      .from("weighing_operations")
      .select("synced_at", { count: "exact", head: true })
      .abortSignal(controller.signal);
    if (error) {
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function getSupabaseClient(): SupabaseClient {
  initializeSupabase();
  if (!client) {
    throw new Error(
      "Supabase nao configurado. Defina SUPABASE_PUBLISHABLE_KEY na pedreira no admin (loader-web) e reative o desktop."
    );
  }
  return client;
}

export function getSupabaseActivationClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim() || getDefaultSupabaseUrl();
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || getDefaultSupabasePublishableKey();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function syncOperationToSupabase(
  database: DesktopDatabase,
  operationId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const operation = getOperationPayload(database, operationId, settings);
  const dependencies = collectCloudSyncDependencies(database, operation);
  await invokeDesktopSync(settings, { operations: [operation], ...dependencies });
  // Confirma o envio na propria operacao. E o que permite a reconciliacao
  // (listOperationsPendingCloudPush) reenviar fechamentos e cancelamentos cujo
  // job da fila morreu depois das tentativas — sem isso a outra balanca nunca
  // ficava sabendo do fechamento.
  markOperationCloudSynced(database, operationId, stringValue(operation.synced_at));
  return true;
}

function markOperationCloudSynced(
  database: DesktopDatabase,
  operationId: string,
  syncedAt: string
): void {
  database
    .prepare("UPDATE weighing_operations SET cloud_synced_at = ? WHERE id = ?")
    .run(syncedAt || new Date().toISOString(), operationId);
}

/** Janela da reconciliacao: operacao mexida ha mais de 30 dias nao volta a fila. */
const CLOUD_RECONCILE_WINDOW_DAYS = 30;
const CLOUD_RECONCILE_LIMIT = 200;

/**
 * Operacoes com alteracao local ainda nao confirmada na nuvem — inclusive as
 * fechadas e canceladas, que a fila de jobs sozinha podia perder de vez ao
 * marcar o job como `dead_letter` depois de 10 falhas (uma queda de internet de
 * uma hora bastava). Enquanto `cloud_synced_at` estiver atras de `updated_at` a
 * operacao volta a ser enviada a cada sincronizacao.
 */
export function listOperationsPendingCloudPush(
  database: DesktopDatabase,
  now: Date = new Date()
): Array<{ id: string; loadingRequestId: string | null }> {
  const windowStart = new Date(
    now.getTime() - CLOUD_RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const rows = database
    .prepare(
      `SELECT o.id AS id, lr.id AS loading_request_id
       FROM weighing_operations o
       LEFT JOIN loading_requests lr ON lr.operation_id = o.id
       WHERE o.deleted_at IS NULL
         AND REPLACE(o.updated_at, ' ', 'T') >= ?
         AND (
           o.cloud_synced_at IS NULL
           OR REPLACE(o.cloud_synced_at, ' ', 'T') < REPLACE(o.updated_at, ' ', 'T')
         )
       ORDER BY o.updated_at ASC
       LIMIT ?`
    )
    .all(windowStart, CLOUD_RECONCILE_LIMIT) as Array<{
    id: string;
    loading_request_id: string | null;
  }>;
  return rows.map((row) => ({ id: row.id, loadingRequestId: row.loading_request_id }));
}

// Media (30 dias) de tempo dentro da pedreira, projetada na unidade para o
// alerta do carregador. Best-effort: nunca deve quebrar o sync.
function computeAvgQuarryMinutes(database: DesktopDatabase, unitId: string): number | undefined {
  try {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const avg = new ReportService(database).getAverageQuarryMinutes(
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
      unitId
    );
    return avg > 0 ? avg : undefined;
  } catch {
    return undefined;
  }
}

export async function syncLoadingRequestToSupabase(
  database: DesktopDatabase,
  requestId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const {
    customer_id: customerId,
    product_id: productId,
    ...request
  } = getLoadingRequestPayload(database, requestId, settings);
  const dependencies = collectCloudSyncDependencies(database, {
    customer_id: customerId,
    product_id: productId
  });
  const avgQuarryMinutes = computeAvgQuarryMinutes(database, identity.unitId);
  await invokeDesktopSync(settings, {
    loadingRequests: [request],
    ...dependencies,
    ...(avgQuarryMinutes !== undefined ? { avgQuarryMinutes } : {})
  });
  return true;
}

export async function syncPrintReceiptToSupabase(
  database: DesktopDatabase,
  receiptId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const settings = getCloudSettings(database, identity);
  const receipt = getPrintReceiptPayload(database, receiptId, settings);
  const operation = getOperationForReceipt(database, receiptId);
  const dependencies = operation
    ? collectCloudSyncDependencies(database, operation)
    : collectCloudSyncDependencies(database, {
        customer_id: null,
        product_id: null
      });
  await invokeDesktopSync(settings, { printReceipts: [receipt], ...dependencies });
  return true;
}

export async function processCloudSyncQueue(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const jobs = listRunnableSyncJobs(database, { target: "cloud", limit: 100 });
  const orderedJobs = orderCloudSyncJobsTopologically(jobs);
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const job of orderedJobs) {
    try {
      if (job.action === "upsert_operation") {
        await syncOperationToSupabase(
          database,
          getPayloadId(job.payload, "operationId", job.entityId),
          identity
        );
      } else if (job.action === "upsert_loading_request") {
        await syncLoadingRequestToSupabase(database, job.entityId, identity);
      } else if (job.action === "upsert_print_receipt") {
        await syncPrintReceiptToSupabase(database, job.entityId, identity);
      } else {
        throw new Error(`Acao cloud desconhecida: ${job.action}`);
      }
      markSyncJobDone(database, job.id);
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro cloud";
      markSyncJobFailed(database, job.id, message);
      failed++;
      errors.push(`Job ${job.id}: ${message}`);
    }
  }

  return { processed, failed, errors };
}

/** Empresa provisoria usada antes da ativacao do dispositivo (ver runtime.ensureIdentity). */
export const SETUP_COMPANY_ID = "setup-company";

export const CADASTRO_LAST_PULL_KEY = "cloud_cadastro_last_pull_at";
/** Janela de sobreposicao do pull incremental, para absorver diferenca de relogio. */
const CADASTRO_INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000;
/**
 * Nome da tabela de dispositivos NA NUVEM. Aqui ele so serve para reconhecer o
 * aviso que o `desktop-pull` emite (`device_registrations: ...`) quando a
 * consulta dos dispositivos falha: e o sinal de que a lista veio incompleta.
 */
const CLOUD_DEVICES_TABLE = "device_registrations";

/**
 * Traz da nuvem o que as outras maquinas da pedreira registraram.
 *
 * `incremental` pede so o cadastro alterado desde o ultimo pull — e o modo dos
 * pulls frequentes (a cada minuto). A sincronizacao completa e o bootstrap
 * pedem o cadastro inteiro, o que tambem recupera qualquer registro que uma
 * passada incremental tenha deixado de gravar.
 */
export async function pullDesktopDataFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { incremental?: boolean } = {}
): Promise<CloudBootstrapResult["pulled"]> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const lastPullAt = readStringLocalSetting(database, CADASTRO_LAST_PULL_KEY);
  const authority = readPriceAuthority(database, settings.deviceId);
  // Esta maquina acabou de virar secundaria de preco: o pull tem de vir INTEIRO. O delta
  // diz o que a principal mudou, nunca o que ela nao tem — e e justamente o cadastro de
  // preco que so existe aqui que precisa sair de cena.
  const priceResyncPending = authority.mode === "follower" && isPriceMasterResyncPending(database);
  const since =
    options.incremental && lastPullAt && !priceResyncPending
      ? new Date(new Date(lastPullAt).getTime() - CADASTRO_INCREMENTAL_OVERLAP_MS).toISOString()
      : undefined;
  const { data, error } = await supabase.functions.invoke<DesktopPullResponse>("desktop-pull", {
    body: {
      deviceId: settings.deviceId,
      deviceToken: settings.deviceToken,
      // Cadastro e historico usam a mesma marca: no pull frequente a resposta
      // traz so o que mudou, o que deixa o ciclo curto o bastante para as duas
      // balancas enxergarem uma a outra em segundos.
      ...(since ? { cadastroSince: since, historySince: since } : {})
    }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));

  const payload = data ?? {};
  // Avisos locais (linha que nao pode ser gravada) somam aos avisos por tabela
  // que vieram do desktop-pull.
  const warnings = [...(payload.warnings ?? [])];
  // A lista de dispositivos vem SEMPRE inteira (o `desktop-pull` nao aplica o
  // `cadastroSince` nela), e e isso que autoriza tirar da legenda quem sumiu.
  // Se a nuvem avisou que essa consulta falhou, o que chegou e um pedaco: nesse
  // ciclo o espelho so soma, como antes.
  const devicesComplete = !warnings.some((warning) =>
    warning.startsWith(`${CLOUD_DEVICES_TABLE}:`)
  );
  const apply = database.transaction(() => {
    // Dispositivos primeiro: operacoes criadas em outras maquinas referenciam
    // o device delas (FK weighing_operations.device_id) e a legenda usa nome/cor.
    applySection(warnings, "devices", () => {
      const devices = payload.devices ?? [];
      const mirrored = upsertUnitDevices(
        database,
        { companyId: settings.companyId, unitId: settings.unitId },
        devices
      );
      // Espelho de ida e volta: sem isto a balanca apagada no painel ficava na
      // legenda desta maquina para sempre.
      if (devicesComplete) pruneMissingUnitDevices(database, settings, devices);
      return mirrored;
    });
    // Transportadoras e formas de pagamento antes dos clientes: e delas que o bloco
    // comercial do cliente depende para traduzir os padroes (ver a funcao).
    const customerReferences = upsertCloudCustomerReferences(
      database,
      settings.companyId,
      payload,
      warnings
    );
    const customers = applySection(warnings, "customers", () =>
      upsertCloudCustomers(
        database,
        settings.companyId,
        payload.customers ?? [],
        priceConflictPolicy(authority.mode)
      )
    );
    const products = applySection(warnings, "products", () =>
      upsertCloudProducts(database, settings.companyId, payload.products ?? [])
    );
    // Cadastro compartilhado antes das operacoes: veiculo/transportadora/motorista
    // sao referenciados pelas operacoes vindas das outras maquinas da pedreira.
    const cadastro =
      customerReferences +
      upsertCloudCadastro(
        database,
        settings.companyId,
        payload,
        warnings,
        priceConflictPolicy(authority.mode)
      );
    // A passada completa pedida pela eleicao da principal ja aconteceu: o cadastro de
    // preco desta maquina esta alinhado com o que a nuvem tem. Nada e apagado aqui — quem
    // resolve o par disputado e o `desktop-sync`, que derruba a linha concorrente quando a
    // PRINCIPAL publica a dela, e o tombstone chega neste mesmo pull.
    if (priceResyncPending && !since) {
      clearPriceMasterResyncPending(database);
    }
    const operations = applySection(warnings, "weighing_operations", () =>
      upsertCloudOperations(database, settings, payload.operations ?? [], warnings)
    );
    const loadingRequests = applySection(warnings, "loading_requests", () =>
      upsertCloudLoadingRequests(database, settings, payload.loadingRequests ?? [], warnings)
    );
    const printReceipts = applySection(warnings, "print_receipts", () =>
      upsertCloudPrintReceipts(database, payload.printReceipts ?? [])
    );
    writeLocalSetting(database, "cloud_bootstrap_last_pull_at", new Date().toISOString());
    // Marca do relogio do servidor para o proximo pull incremental. Se alguma
    // tabela veio com aviso do servidor, nao avanca a marca: o proximo pull
    // tenta de novo o mesmo intervalo em vez de deixar um buraco no espelho.
    // Falha de linha local nao segura a marca (senao a janela cresceria sem
    // fim); a varredura completa, que pede tudo, recupera o que ficou de fora.
    if ((payload.warnings ?? []).length === 0) {
      writeLocalSetting(
        database,
        CADASTRO_LAST_PULL_KEY,
        payload.serverTime ?? new Date().toISOString()
      );
    }
    return {
      customers,
      products,
      operations,
      loadingRequests,
      printReceipts,
      cadastro,
      warnings
    };
  });

  return apply();
}

/**
 * Grava um bloco do pull isolando a falha: uma tabela que nao pode ser escrita
 * (migracao local pendente, linha invalida) vira aviso em vez de derrubar a
 * transacao inteira — sem isso um unico registro problematico deixava a maquina
 * permanentemente cega para tudo que as outras balancas registram.
 */
function applySection(warnings: string[], table: string, run: () => number): number {
  try {
    return run();
  } catch (error) {
    warnings.push(`${table}: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/**
 * O cadastro que os CLIENTES apontam, gravado antes deles.
 *
 * O bloco comercial do cliente traz dois ids: a transportadora padrao e a forma de
 * pagamento padrao. Os dois precisam existir aqui no momento em que o cliente e gravado —
 * a forma de pagamento, mais que existir, precisa ter a EQUIVALENCIA registrada, porque o
 * id da principal nunca chega a ser gravado nesta maquina (UNIQUE por `code`, ids
 * sorteados em cada balanca).
 *
 * Enquanto tudo isto rodava depois dos clientes, o padrao chegava sem tradutor: o cliente
 * era gravado sem forma de pagamento e sem transportadora, e o pull seguinte — incremental
 * — nao trazia a linha de novo para corrigir. O padrao ficava vazio para sempre.
 */
function upsertCloudCustomerReferences(
  database: DesktopDatabase,
  companyId: string,
  payload: DesktopPullResponse,
  warnings: string[]
): number {
  return (
    applySection(warnings, "carriers", () =>
      upsertCloudCarriers(database, companyId, payload.carriers ?? [])
    ) +
    applySection(warnings, "payment_methods", () =>
      upsertCloudPaymentMethods(database, companyId, payload.paymentMethods ?? [])
    )
  );
}

/**
 * Projeta no SQLite o cadastro compartilhado da pedreira que veio do desktop-pull:
 * transportadoras, motoristas, veiculos, os vinculos entre eles e os precos.
 * E o que faz um computador recem-instalado enxergar exatamente o mesmo cadastro
 * das demais maquinas da mesma pedreira, sem depender de refazer o pull do OMIE.
 */
function upsertCloudCadastro(
  database: DesktopDatabase,
  companyId: string,
  payload: DesktopPullResponse,
  warnings: string[] = [],
  /**
   * Quem vence quando a linha da nuvem disputa a mesma chave natural de uma linha local
   * (ver `cloudRowWins`): a nuvem sempre, na secundaria; a mais recente, na principal —
   * que agora pode ter outra principal do outro lado; a local, na pedreira sem principal,
   * que e o comportamento anterior a este campo.
   */
  pricePolicy: PriceConflictPolicy = "local"
): number {
  const sections: Array<[string, () => number]> = [
    // `carriers` e `payment_methods` NAO estao aqui: eles rodam antes dos clientes, em
    // `upsertCloudCustomerReferences`.
    ["drivers", () => upsertCloudDrivers(database, companyId, payload.drivers ?? [])],
    ["vehicles", () => upsertCloudVehicles(database, companyId, payload.vehicles ?? [])],
    [
      "customer_carriers",
      () =>
        upsertCloudJunction(
          database,
          "customer_carriers",
          "customer_id",
          payload.customerCarriers ?? []
        )
    ],
    [
      // Placas do cliente (aba Transporte). Depois de `vehicles`, que ela referencia.
      "customer_vehicles",
      () => upsertCloudCustomerVehicles(database, payload.customerVehicles ?? [])
    ],
    [
      "driver_carriers",
      () =>
        upsertCloudJunction(database, "driver_carriers", "driver_id", payload.driverCarriers ?? [])
    ],
    [
      "vehicle_carriers",
      () =>
        upsertCloudJunction(
          database,
          "vehicle_carriers",
          "vehicle_id",
          payload.vehicleCarriers ?? []
        )
    ],
    [
      "product_default_prices",
      () =>
        upsertCloudProductDefaultPrices(
          database,
          companyId,
          payload.productDefaultPrices ?? [],
          pricePolicy
        )
    ],
    [
      "customer_special_prices",
      () =>
        upsertCloudCustomerSpecialPrices(
          database,
          companyId,
          payload.customerSpecialPrices ?? [],
          pricePolicy
        )
    ],
    ["price_tables", () => upsertCloudPriceTables(database, companyId, payload.priceTables ?? [])],
    [
      "price_table_items",
      () => upsertCloudPriceTableItems(database, payload.priceTableItems ?? [])
    ],
    [
      "customer_price_tables",
      () => upsertCloudCustomerPriceTables(database, payload.customerPriceTables ?? [])
    ],
    [
      "customer_freight_rules",
      () =>
        upsertCloudCustomerFreightRules(database, payload.customerFreightRules ?? [], pricePolicy)
    ],
    [
      "customer_future_billing_invoices",
      () =>
        upsertCloudCustomerFutureBillingInvoices(
          database,
          payload.customerFutureBillingInvoices ?? []
        )
    ],
    [
      "payment_terms",
      () => upsertCloudPaymentTerms(database, companyId, payload.paymentTerms ?? [])
    ],
    ["accounts", () => upsertCloudAccounts(database, companyId, payload.accounts ?? [])],
    [
      "customer_credit_movements",
      () => upsertCloudCreditMovements(database, companyId, payload.customerCreditMovements ?? [])
    ],
    [
      "report_recipients",
      () => upsertCloudReportRecipients(database, companyId, payload.reportRecipients ?? [])
    ]
  ];

  let count = 0;
  for (const [table, run] of sections) {
    count += applySection(warnings, table, run);
  }
  return count;
}

function upsertCloudPriceTables(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO price_tables (
      id, company_id, name, is_active, valid_from, valid_to, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      is_active = excluded.is_active,
      valid_from = excluded.valid_from,
      valid_to = excluded.valid_to,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const name = stringValue(row.name);
    if (!id || !name) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      name,
      booleanToSql(row.is_active, true),
      nullableStringValue(row.valid_from),
      nullableStringValue(row.valid_to),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      isoStringValue(row.deleted_at)
    );
    count++;
  }
  return count;
}

function upsertCloudPriceTableItems(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO price_table_items (
      id, price_table_id, product_id, unit_price_cents, unit, valid_from, valid_to,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      price_table_id = excluded.price_table_id,
      product_id = excluded.product_id,
      unit_price_cents = excluded.unit_price_cents,
      unit = excluded.unit,
      valid_from = excluded.valid_from,
      valid_to = excluded.valid_to,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const priceTableId = existingId(database, "price_tables", row.price_table_id);
    const productId = existingId(database, "products", row.product_id);
    const price = integerValue(row.unit_price_cents);
    if (!id || !priceTableId || !productId || price === null) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      priceTableId,
      productId,
      price,
      stringValue(row.unit) || "ton",
      nullableStringValue(row.valid_from),
      nullableStringValue(row.valid_to),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      isoStringValue(row.deleted_at)
    );
    count++;
  }
  return count;
}

function upsertCloudCustomerPriceTables(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO customer_price_tables (
      id, customer_id, price_table_id, valid_from, valid_to, is_active,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      price_table_id = excluded.price_table_id,
      valid_from = excluded.valid_from,
      valid_to = excluded.valid_to,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const customerId = existingId(database, "customers", row.customer_id);
    const priceTableId = existingId(database, "price_tables", row.price_table_id);
    if (!id || !customerId || !priceTableId) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      customerId,
      priceTableId,
      nullableStringValue(row.valid_from),
      nullableStringValue(row.valid_to),
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      isoStringValue(row.deleted_at)
    );
    count++;
  }
  return count;
}

/**
 * Linha local que ja ocupa a chave natural disputada. `updated_at` entra na leitura porque
 * entre duas principais o desempate e a hora da edicao — sem ela, a comparacao cairia
 * sempre no id e o preco mais recente poderia perder para o mais antigo.
 */
interface PriceConflictRow {
  id: string;
  updated_at?: string | null;
}

function toPriceConflictRow(row: PriceConflictRow): { id: string; updatedAt: string | null } {
  return { id: row.id, updatedAt: isoStringValue(row.updated_at) || null };
}

function upsertCloudCustomerFreightRules(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>,
  policy: PriceConflictPolicy = "local"
): number {
  // Indice unico local por (cliente, produto) e por regra padrao do cliente:
  // mantem a local quando a da nuvem chega com outro id para o mesmo par.
  const findConflictForProduct = database.prepare(
    `SELECT id, updated_at FROM customer_freight_rules
     WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL LIMIT 1`
  );
  const findConflictForDefault = database.prepare(
    `SELECT id, updated_at FROM customer_freight_rules
     WHERE customer_id = ? AND product_id IS NULL AND deleted_at IS NULL LIMIT 1`
  );
  // A linha que perde a chave natural cede (exclusao logica) em vez de bloquear a outra.
  const yieldToMaster = database.prepare(
    `UPDATE customer_freight_rules SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ?`
  );
  const readRuleJson = database.prepare(
    "SELECT rule_json FROM customer_freight_rules WHERE id = ? AND deleted_at IS NULL"
  );
  const upsert = database.prepare(`
    INSERT INTO customer_freight_rules (
      id, customer_id, product_id, rule_json, is_active, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      product_id = excluded.product_id,
      rule_json = excluded.rule_json,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const customerId = existingId(database, "customers", row.customer_id);
    if (!id || !customerId) continue;
    const productId = row.product_id ? existingId(database, "products", row.product_id) : null;
    if (row.product_id && !productId) continue;
    const deletedAt = isoStringValue(row.deleted_at);
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    // A memoria da ultima venda desta maquina mora na MESMA linha do valor do cadastro
    // (ver `mergeFollowerFreightRuleJson`), entao ela e lida antes de a linha ceder.
    let localRuleJson: string | null = null;
    if (!deletedAt) {
      const conflict = (
        productId
          ? findConflictForProduct.get(customerId, productId)
          : findConflictForDefault.get(customerId)
      ) as PriceConflictRow | undefined;
      if (conflict && conflict.id !== id) {
        if (!cloudRowWins(policy, { id, updatedAt }, toPriceConflictRow(conflict))) continue;
        localRuleJson = readLocalFreightRuleJson(readRuleJson, conflict.id);
        yieldToMaster.run(updatedAt, updatedAt, conflict.id);
      }
    }
    const cloudRuleJson = jsonStringValue(row.rule_json) ?? "{}";
    // A memoria da ultima venda desta maquina (`source: "last_used"`) mora na mesma linha
    // do valor combinado com o cliente. Espelhar a linha inteira apagaria a memoria a cada
    // pull; a fusao mantem o cadastro de quem publicou e a memoria de quem esta aqui.
    const ruleJson =
      policy === "local"
        ? cloudRuleJson
        : mergeFollowerFreightRuleJson(
            readLocalFreightRuleJson(readRuleJson, id) ?? localRuleJson,
            cloudRuleJson
          );
    upsert.run(
      id,
      customerId,
      productId,
      ruleJson,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    count++;
  }
  return count;
}

function readLocalFreightRuleJson(
  statement: ReturnType<DesktopDatabase["prepare"]>,
  id: string
): string | null {
  const row = statement.get(id) as { rule_json: string | null } | undefined;
  return row?.rule_json ?? null;
}

function upsertCloudCustomerFutureBillingInvoices(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>
): number {
  // Mesma protecao dos indices unicos parciais da migracao 54: o mesmo NUMERO nao entra
  // duas vezes no mesmo par (cliente, produto). Varias notas por par sao esperadas — e
  // assim que a nota seguinte assume quando a anterior esgota —, entao o conflito aqui e so
  // a mesma nota chegando com outro id; nesse caso a local vence, porque regravar
  // derrubaria o indice e porque e a ela que as pesagens desta maquina ja apontam.
  const findConflictForProduct = database.prepare(
    `SELECT id FROM customer_future_billing_invoices
     WHERE customer_id = ? AND product_id = ? AND nfe_number = ? AND deleted_at IS NULL LIMIT 1`
  );
  const findConflictForDefault = database.prepare(
    `SELECT id FROM customer_future_billing_invoices
     WHERE customer_id = ? AND product_id IS NULL AND nfe_number = ? AND deleted_at IS NULL LIMIT 1`
  );
  const upsert = database.prepare(`
    INSERT INTO customer_future_billing_invoices (
      id, customer_id, product_id, nfe_number, total_weight_kg, is_active, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      product_id = excluded.product_id,
      nfe_number = excluded.nfe_number,
      total_weight_kg = excluded.total_weight_kg,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const customerId = existingId(database, "customers", row.customer_id);
    if (!id || !customerId) continue;
    const nfeNumber = stringValue(row.nfe_number);
    if (!nfeNumber) continue;
    const productId = row.product_id ? existingId(database, "products", row.product_id) : null;
    if (row.product_id && !productId) continue;
    const deletedAt = isoStringValue(row.deleted_at);
    if (!deletedAt) {
      const conflict = (
        productId
          ? findConflictForProduct.get(customerId, productId, nfeNumber)
          : findConflictForDefault.get(customerId, nfeNumber)
      ) as { id: string } | undefined;
      if (conflict && conflict.id !== id) continue;
    }
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      customerId,
      productId,
      nfeNumber,
      numberValue(row.total_weight_kg),
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    count++;
  }
  return count;
}

/** Prazos ("installments[].dueDays") gravados no rules_json da condicao. */
function dueDaysFromRulesJson(rulesJson: string): number[] | null {
  try {
    const rules = JSON.parse(rulesJson) as { installments?: Array<{ dueDays?: unknown }> };
    if (!Array.isArray(rules.installments) || rules.installments.length === 0) return null;
    const days = rules.installments.map((installment) => Number(installment?.dueDays));
    return days.every((value) => Number.isInteger(value) && value >= 0) ? days : null;
  } catch {
    return null;
  }
}

function upsertCloudPaymentTerms(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  // A nuvem so guarda o rules_json da condicao. As colunas de prazo ficavam vazias no
  // desktop que recebia a condicao pela nuvem, e o fechamento saia sem prazo nenhum — o
  // OMIE entao colocava o vencimento na propria data de emissao. Derivamos as colunas do
  // rules_json aqui, na entrada.
  const upsert = database.prepare(`
    INSERT INTO payment_terms (
      id, company_id, omie_code, name, rules_json, is_active, created_at, updated_at, deleted_at,
      installment_days_json, first_installment_days, installment_interval_days, installment_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_code = excluded.omie_code,
      name = excluded.name,
      rules_json = excluded.rules_json,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      installment_days_json = COALESCE(excluded.installment_days_json, payment_terms.installment_days_json),
      first_installment_days = COALESCE(excluded.first_installment_days, payment_terms.first_installment_days),
      installment_interval_days = COALESCE(excluded.installment_interval_days, payment_terms.installment_interval_days),
      installment_count = COALESCE(excluded.installment_count, payment_terms.installment_count)
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const name = stringValue(row.name);
    if (!id || !name) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    const rulesJson = jsonStringValue(row.rules_json) ?? "{}";
    const dueDays = dueDaysFromRulesJson(rulesJson);
    upsert.run(
      id,
      companyId,
      nullableStringValue(row.omie_code),
      name,
      rulesJson,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      isoStringValue(row.deleted_at),
      dueDays ? JSON.stringify(dueDays) : null,
      dueDays ? dueDays[0] : null,
      dueDays && dueDays.length > 1 ? dueDays[1] - dueDays[0] : null,
      dueDays ? dueDays.length : null
    );
    count++;
  }
  return count;
}

function upsertCloudPaymentMethods(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  // UNIQUE(company_id, code) entre os nao excluidos: a forma padrao do sistema
  // ja existe nas duas maquinas com ids diferentes, entao a local prevalece.
  const findConflict = database.prepare(
    `SELECT id FROM payment_methods
     WHERE company_id = ? AND code = ? AND deleted_at IS NULL LIMIT 1`
  );
  const upsert = database.prepare(`
    INSERT INTO payment_methods (
      id, company_id, code, name, alias, omie_code, is_system, is_customer_credit, is_wallet,
      sort_order, is_active, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      -- Apelido: uma nuvem ainda sem a coluna chega nulo e nao pode apagar o que esta
      -- maquina ja tem (o valor volta a viajar no proximo push).
      alias = COALESCE(excluded.alias, payment_methods.alias),
      omie_code = excluded.omie_code,
      is_customer_credit = excluded.is_customer_credit,
      is_wallet = excluded.is_wallet,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const code = stringValue(row.code);
    const name = stringValue(row.name);
    if (!id || !code || !name) continue;
    const deletedAt = isoStringValue(row.deleted_at);
    if (!deletedAt) {
      const conflict = findConflict.get(companyId, code) as { id: string } | undefined;
      if (conflict && conflict.id !== id) {
        // A gemea da outra maquina nao entra (UNIQUE(company_id, code)), mas a
        // equivalencia fica registrada: sem ela a operacao que chega de la aponta
        // para um id inexistente aqui e perde a forma de pagamento — foi o que
        // sumia com a venda em carteira da outra balanca na tela Carteira.
        rememberPaymentMethodAlias(database, companyId, id, conflict.id);
        continue;
      }
    }
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      code,
      name,
      nullableStringValue(row.alias),
      nullableStringValue(row.omie_code),
      booleanToSql(row.is_system, false),
      booleanToSql(row.is_customer_credit, false),
      booleanToSql(row.is_wallet, false),
      integerValue(row.sort_order) ?? 0,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    count++;
  }
  return count;
}

function upsertCloudAccounts(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  // UNIQUE(company_id, code) entre as nao excluidas (code e opcional).
  const findConflict = database.prepare(
    `SELECT id FROM accounts
     WHERE company_id = ? AND code = ? AND deleted_at IS NULL LIMIT 1`
  );
  const upsert = database.prepare(`
    INSERT INTO accounts (
      id, company_id, code, name, omie_code, is_system, sort_order, is_active,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      omie_code = excluded.omie_code,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const name = stringValue(row.name);
    if (!id || !name) continue;
    const code = nullableStringValue(row.code);
    const deletedAt = isoStringValue(row.deleted_at);
    if (!deletedAt && code) {
      const conflict = findConflict.get(companyId, code) as { id: string } | undefined;
      if (conflict && conflict.id !== id) continue;
    }
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      code,
      name,
      nullableStringValue(row.omie_code),
      booleanToSql(row.is_system, false),
      integerValue(row.sort_order) ?? 0,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    count++;
  }
  return count;
}

/**
 * Projeta o log de credito (fiado) vindo das outras maquinas e recalcula o saldo
 * de cada cliente afetado a partir do log inteiro. O saldo nunca e copiado da
 * nuvem: soma-se o que as duas maquinas lancaram, entao um debito feito na outra
 * balanca nunca some por sobrescrita.
 */
export function upsertCloudCreditMovements(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  // Movimento e imutavel: id ja conhecido nao e reescrito.
  const insert = database.prepare(`
    INSERT INTO customer_credit_movements (
      id, company_id, customer_id, operation_id, movement_type, amount_cents,
      balance_after_cents, reason, source, omie_title_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  const touchedCustomers = new Set<string>();
  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const customerId = existingId(database, "customers", row.customer_id);
    const movementType = stringValue(row.movement_type);
    if (!id || !customerId || !CREDIT_MOVEMENT_TYPES.has(movementType)) continue;
    // A operacao de origem pode nao estar nesta maquina (historico limitado):
    // o vinculo vira nulo, mas o valor do movimento continua valendo.
    const operationId = existingId(database, "weighing_operations", row.operation_id);
    const result = insert.run(
      id,
      companyId,
      customerId,
      operationId,
      movementType,
      integerValue(row.amount_cents) ?? 0,
      integerValue(row.balance_after_cents) ?? 0,
      nullableStringValue(row.reason),
      // Adiantamento espelhado do OMIE chega marcado: o extrato distingue o que
      // veio do financeiro do que foi lancado na balanca.
      nullableStringValue(row.source) ?? "local",
      integerValue(row.omie_title_id),
      isoStringValue(row.created_at) || new Date().toISOString()
    );
    if (result.changes > 0) {
      touchedCustomers.add(customerId);
      count++;
    }
  }

  if (touchedCustomers.size > 0) {
    recalculateCreditBalances(database, [...touchedCustomers]);
  }
  return count;
}

const CREDIT_MOVEMENT_TYPES: ReadonlySet<string> = new Set([
  "credit",
  "debit_product",
  "debit_freight",
  "refund_product",
  "refund_freight",
  "manual_adjustment"
]);

/** Saldo = soma do log (debitos negativos), recalculado por cliente. */
function recalculateCreditBalances(database: DesktopDatabase, customerIds: string[]): void {
  const balanceOf = database.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN movement_type IN ('debit_product', 'debit_freight') THEN -amount_cents
        ELSE amount_cents
      END
    ), 0) AS balance
    FROM customer_credit_movements
    WHERE customer_id = ?
  `);
  const upsert = database.prepare(`
    INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      balance_cents = excluded.balance_cents,
      updated_at = excluded.updated_at
  `);

  const timestamp = new Date().toISOString();
  for (const customerId of customerIds) {
    const row = balanceOf.get(customerId) as { balance: number } | undefined;
    upsert.run(customerId, row?.balance ?? 0, timestamp);
  }
}

/**
 * Cadastro local (nao apagado) que ja usa este CNPJ/CPF sob OUTRO id.
 *
 * O upsert da nuvem casa apenas por id e limpa `deleted_at`, entao uma linha da
 * nuvem com id diferente reintroduzia — ou ressuscitava — o gemeo de um cadastro
 * que ja existe aqui. Quando o documento ja esta em uso localmente, a linha da
 * nuvem e ignorada: o cadastro local e o dono do documento.
 */
function findLocalCadastroWithDocument(
  database: DesktopDatabase,
  table: "customers" | "carriers",
  companyId: string,
  document: string | null,
  cloudId: string
): { id: string; omie_customer_id: number | null } | null {
  const key = documentKey(document);
  if (!key) return null;
  const row = database
    .prepare(
      `SELECT id, omie_customer_id FROM ${table}
       WHERE company_id = ?
         AND id <> ?
         AND deleted_at IS NULL
         AND ${DOCUMENT_KEY_SQL} = ?
       LIMIT 1`
    )
    .get(companyId, cloudId, key) as { id: string; omie_customer_id: number | null } | undefined;
  return row ?? null;
}

/**
 * O gemeo do OMIE trouxe o codigo que o cadastro local ainda nao tem: adota o codigo
 * aqui antes de descartar a linha da nuvem.
 *
 * Sem isso, um cliente cadastrado no KyberRock ficava para sempre sem `omie_customer_id`
 * mesmo depois de existir no OMIE — e todo fechamento dele repetia um `IncluirCliente` de
 * um cadastro que ja estava la, que o OMIE recusa com "Cliente ja cadastrado". Era assim
 * que a operacao ficava parada sem subir.
 */
function adoptOmieCodeFromCloudTwin(
  database: DesktopDatabase,
  table: "customers" | "carriers",
  local: { id: string; omie_customer_id: number | null },
  cloudOmieCustomerId: number | null
): void {
  if (!cloudOmieCustomerId || cloudOmieCustomerId <= 0) return;
  if (local.omie_customer_id && local.omie_customer_id > 0) return;
  database
    .prepare(
      `UPDATE ${table}
       SET omie_customer_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND (omie_customer_id IS NULL OR omie_customer_id = 0)`
    )
    .run(cloudOmieCustomerId, local.id);
}

function upsertCloudCarriers(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO carriers (
      id, company_id, omie_customer_id, name, document, source, is_active,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_customer_id = COALESCE(excluded.omie_customer_id, carriers.omie_customer_id),
      name = CASE WHEN carriers.needs_push = 0 THEN excluded.name ELSE carriers.name END,
      document = CASE WHEN carriers.needs_push = 0 THEN excluded.document ELSE carriers.document END,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const name = stringValue(row.name);
    if (!id || !name) continue;
    const document = nullableStringValue(row.document);
    const localTwin = findLocalCadastroWithDocument(database, "carriers", companyId, document, id);
    if (localTwin) {
      adoptOmieCodeFromCloudTwin(
        database,
        "carriers",
        localTwin,
        integerValue(row.omie_customer_id)
      );
      continue;
    }
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      integerValue(row.omie_customer_id),
      name,
      document,
      stringValue(row.source) === "omie" ? "omie" : "local",
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

function upsertCloudDrivers(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO drivers (
      id, company_id, name, document, phone, is_independent, is_active,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      document = excluded.document,
      phone = excluded.phone,
      is_independent = excluded.is_independent,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const name = stringValue(row.name);
    if (!id || !name) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      name,
      nullableStringValue(row.document),
      nullableStringValue(row.phone),
      booleanToSql(row.is_independent, false),
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

function upsertCloudVehicles(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO vehicles (
      id, company_id, plate, plate_normalized, description, carrier_id, is_active,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      plate = excluded.plate,
      plate_normalized = excluded.plate_normalized,
      description = excluded.description,
      carrier_id = excluded.carrier_id,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const plate = stringValue(row.plate);
    if (!id || !plate) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    // Veiculo com transportadora que ainda nao chegou: grava sem o vinculo em vez
    // de estourar a FK e derrubar o pull inteiro.
    const carrierId = existingId(database, "carriers", row.carrier_id);
    upsert.run(
      id,
      companyId,
      plate,
      plate.replace(/\s/g, "").toUpperCase(),
      nullableStringValue(row.description),
      carrierId,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

const JUNCTION_PARENT_TABLE: Record<string, string> = {
  customer_id: "customers",
  driver_id: "drivers",
  vehicle_id: "vehicles"
};

function upsertCloudJunction(
  database: DesktopDatabase,
  table: "customer_carriers" | "driver_carriers" | "vehicle_carriers",
  parentColumn: "customer_id" | "driver_id" | "vehicle_id",
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO ${table} (id, ${parentColumn}, carrier_id, is_active, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      ${parentColumn} = excluded.${parentColumn},
      carrier_id = excluded.carrier_id,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    // Vinculo cuja ponta ainda nao existe localmente e ignorado nesta passada;
    // o proximo pull (ja com o cadastro pai) grava o vinculo.
    const parentId = existingId(database, JUNCTION_PARENT_TABLE[parentColumn], row[parentColumn]);
    const carrierId = existingId(database, "carriers", row.carrier_id);
    if (!parentId || !carrierId) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      parentId,
      carrierId,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

/**
 * Placas do cliente. Junta cliente e veiculo, e por isso nao cabe em `upsertCloudJunction`,
 * que amarra sempre em `carrier_id`.
 *
 * O indice unico local e por (cliente, placa) entre os nao excluidos: o mesmo par vindo com
 * outro id (as duas balancas vincularam a mesma placa antes do primeiro sync) mantem a
 * linha local e ignora a copia — gravar as duas derrubaria o pull inteiro. Vinculo nao tem
 * valor a disputar, entao qual das duas fica e indiferente.
 */
function upsertCloudCustomerVehicles(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO customer_vehicles (
      id, customer_id, vehicle_id, is_active, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      vehicle_id = excluded.vehicle_id,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);
  const findConflict = database.prepare(
    `SELECT id FROM customer_vehicles
     WHERE customer_id = ? AND vehicle_id = ? AND deleted_at IS NULL LIMIT 1`
  );

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    // Ponta que ainda nao existe localmente: o proximo pull, ja com o cadastro pai, grava.
    const customerId = existingId(database, "customers", row.customer_id);
    const vehicleId = existingId(database, "vehicles", row.vehicle_id);
    if (!id || !customerId || !vehicleId) continue;
    const deletedAt = isoStringValue(row.deleted_at);
    if (!deletedAt) {
      const conflict = findConflict.get(customerId, vehicleId) as { id: string } | undefined;
      if (conflict && conflict.id !== id) continue;
    }
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      customerId,
      vehicleId,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    count++;
  }
  return count;
}

function upsertCloudProductDefaultPrices(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>,
  policy: PriceConflictPolicy = "local"
): number {
  const upsert = database.prepare(`
    INSERT INTO product_default_prices (
      id, company_id, product_id, unit_price_cents, unit, valid_from, valid_to,
      is_active, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      product_id = excluded.product_id,
      unit_price_cents = excluded.unit_price_cents,
      unit = excluded.unit,
      valid_from = excluded.valid_from,
      valid_to = excluded.valid_to,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  // Indice unico local (product_id, is_active) entre os nao excluidos: se a mesma
  // tabela de preco ja existe localmente com outro id, gravar as duas violaria o indice e
  // derrubaria o pull. Quem cede depende da politica (ver `cloudRowWins`).
  const findConflict = database.prepare(
    `SELECT id, updated_at FROM product_default_prices
     WHERE product_id = ? AND is_active = ? AND deleted_at IS NULL LIMIT 1`
  );
  const yieldToMaster = database.prepare(
    `UPDATE product_default_prices SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ?`
  );

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const productId = existingId(database, "products", row.product_id);
    const price = integerValue(row.unit_price_cents);
    if (!id || !productId || price === null) continue;
    const isActive = booleanToSql(row.is_active, true);
    const deletedAt = isoStringValue(row.deleted_at);
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    if (!deletedAt) {
      const conflict = findConflict.get(productId, isActive) as PriceConflictRow | undefined;
      if (conflict && conflict.id !== id) {
        if (!cloudRowWins(policy, { id, updatedAt }, toPriceConflictRow(conflict))) continue;
        yieldToMaster.run(updatedAt, updatedAt, conflict.id);
      }
    }
    upsert.run(
      id,
      companyId,
      productId,
      price,
      stringValue(row.unit) || "ton",
      nullableStringValue(row.valid_from),
      nullableStringValue(row.valid_to),
      isActive,
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    count++;
  }
  return count;
}

function upsertCloudCustomerSpecialPrices(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>,
  policy: PriceConflictPolicy = "local"
): number {
  const upsert = database.prepare(`
    INSERT INTO customer_special_prices (
      id, company_id, customer_id, product_id, unit_price_cents, unit,
      is_active, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      customer_id = excluded.customer_id,
      product_id = excluded.product_id,
      unit_price_cents = excluded.unit_price_cents,
      unit = excluded.unit,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  // Indice unico local (customer_id, product_id) entre os nao excluidos.
  const findConflict = database.prepare(
    `SELECT id, updated_at FROM customer_special_prices
     WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL LIMIT 1`
  );
  // Era exatamente aqui que o preco especial parava de sincronizar: as duas balancas
  // cadastraram o mesmo par com ids diferentes e cada uma descartava a linha da outra.
  // Com principal definida, a linha que perde cede em vez de ser ignorada.
  const yieldToMaster = database.prepare(
    `UPDATE customer_special_prices SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ?`
  );

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const customerId = existingId(database, "customers", row.customer_id);
    const productId = existingId(database, "products", row.product_id);
    const price = integerValue(row.unit_price_cents);
    if (!id || !customerId || !productId || price === null) continue;
    const deletedAt = isoStringValue(row.deleted_at);
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    if (!deletedAt) {
      const conflict = findConflict.get(customerId, productId) as PriceConflictRow | undefined;
      if (conflict && conflict.id !== id) {
        if (!cloudRowWins(policy, { id, updatedAt }, toPriceConflictRow(conflict))) continue;
        yieldToMaster.run(updatedAt, updatedAt, conflict.id);
      }
    }
    upsert.run(
      id,
      companyId,
      customerId,
      productId,
      price,
      stringValue(row.unit) || "ton",
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    count++;
  }
  return count;
}

function upsertCloudReportRecipients(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  ensureReportRecipientsTable(database);
  // needs_push = 1 significa alteracao local ainda nao enviada: a versao da
  // nuvem nao pode sobrescreve-la (senao a edicao feita offline se perde).
  const upsert = database.prepare(`
    INSERT INTO report_recipients (
      id, company_id, email, whatsapp_phone, send_email, send_whatsapp,
      schedule_frequency, schedule_time, report_types, send_financial,
      financial_schedule_time, display_name, is_active, needs_push, sync_status,
      last_synced_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = CASE WHEN report_recipients.needs_push = 0 THEN excluded.email ELSE report_recipients.email END,
      whatsapp_phone = CASE WHEN report_recipients.needs_push = 0 THEN excluded.whatsapp_phone ELSE report_recipients.whatsapp_phone END,
      send_email = CASE WHEN report_recipients.needs_push = 0 THEN excluded.send_email ELSE report_recipients.send_email END,
      send_whatsapp = CASE WHEN report_recipients.needs_push = 0 THEN excluded.send_whatsapp ELSE report_recipients.send_whatsapp END,
      schedule_frequency = CASE WHEN report_recipients.needs_push = 0 THEN excluded.schedule_frequency ELSE report_recipients.schedule_frequency END,
      schedule_time = CASE WHEN report_recipients.needs_push = 0 THEN excluded.schedule_time ELSE report_recipients.schedule_time END,
      report_types = CASE WHEN report_recipients.needs_push = 0 THEN excluded.report_types ELSE report_recipients.report_types END,
      send_financial = CASE WHEN report_recipients.needs_push = 0 THEN excluded.send_financial ELSE report_recipients.send_financial END,
      financial_schedule_time = CASE WHEN report_recipients.needs_push = 0 THEN excluded.financial_schedule_time ELSE report_recipients.financial_schedule_time END,
      display_name = CASE WHEN report_recipients.needs_push = 0 THEN excluded.display_name ELSE report_recipients.display_name END,
      is_active = CASE WHEN report_recipients.needs_push = 0 THEN excluded.is_active ELSE report_recipients.is_active END,
      updated_at = excluded.updated_at,
      -- A exclusao viaja como tombstone (deleted_at preenchido), entao a nuvem e
      -- espelhada como esta. Zerar a coluna aqui era o que fazia o destinatario
      -- excluido VOLTAR: o proprio push marcava a linha como sincronizada e o
      -- pull seguinte, ja com needs_push = 0, limpava o deleted_at recem-gravado.
      deleted_at = CASE WHEN report_recipients.needs_push = 0 THEN excluded.deleted_at ELSE report_recipients.deleted_at END
  `);

  // UNIQUE(company_id, email) e o indice unico de whatsapp: o mesmo destinatario
  // cadastrado em duas maquinas antes do primeiro sync tem ids diferentes; mantem
  // o local e ignora a copia para nao violar o indice.
  const findConflict = database.prepare(
    `SELECT id, deleted_at, needs_push FROM report_recipients
     WHERE company_id = ?
       AND ((? IS NOT NULL AND email = ?) OR (? IS NOT NULL AND whatsapp_phone = ?))
     LIMIT 1`
  );
  // Os indices unicos contam tambem a linha apagada: o tombstone local segurava
  // para sempre o e-mail/WhatsApp e um destinatario recadastrado em outra maquina
  // (id novo) nunca chegava aqui. Tombstone ja sincronizado sai para a linha viva entrar.
  const dropSyncedTombstone = database.prepare("DELETE FROM report_recipients WHERE id = ?");
  const findLocal = database.prepare("SELECT deleted_at FROM report_recipients WHERE id = ?");
  // A nuvem ainda nao sabe da exclusao: reenvia o tombstone no proximo push em
  // vez de deixar a linha viva la para sempre, disputando com este apagado.
  const resendTombstone = database.prepare(
    `UPDATE report_recipients SET needs_push = 1, sync_status = 'pending'
     WHERE id = ? AND deleted_at IS NOT NULL`
  );

  const frequencies = new Set(["daily", "weekly", "monthly"]);
  const reportTypes = new Set(["sales", "trucks", "both"]);
  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const email = nullableStringValue(row.email);
    const whatsapp = nullableStringValue(row.whatsapp_phone);
    if (!email && !whatsapp) continue;
    const localDeletedAt =
      (findLocal.get(id) as { deleted_at: string | null } | undefined)?.deleted_at ?? null;
    const cloudDeletedAt = "deleted_at" in row ? isoStringValue(row.deleted_at) : null;
    // Exclusao local so e desfeita quando a nuvem devolve o destinatario vivo E
    // ativo — o unico sinal que separa "recadastrado em outra balanca" de "a nuvem
    // nunca soube da exclusao". Nao saber acontece com quem foi excluido antes
    // desta versao (a projecao so recebia is_active = false) e enquanto a migracao
    // que criou deleted_at na nuvem nao e aplicada; nos dois casos aceitar a linha
    // de la ressuscitaria o que o operador apagou.
    const keepLocalTombstone =
      Boolean(localDeletedAt) && !cloudDeletedAt && booleanToSql(row.is_active, true) === 0;
    const deletedAt = keepLocalTombstone ? localDeletedAt : cloudDeletedAt;
    const conflict = findConflict.get(companyId, email, email, whatsapp, whatsapp) as
      | { id: string; deleted_at: string | null; needs_push: number }
      | undefined;
    if (conflict && conflict.id !== id) {
      const blockedBySyncedTombstone =
        Boolean(conflict.deleted_at) && conflict.needs_push === 0 && !deletedAt;
      if (!blockedBySyncedTombstone) continue;
      dropSyncedTombstone.run(conflict.id);
    }
    const frequency = stringValue(row.schedule_frequency);
    const type = stringValue(row.report_types);
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      email,
      whatsapp,
      booleanToSql(row.send_email, Boolean(email)),
      booleanToSql(row.send_whatsapp, Boolean(whatsapp)),
      frequencies.has(frequency) ? frequency : "daily",
      stringValue(row.schedule_time) || "20:00",
      reportTypes.has(type) ? type : "sales",
      booleanToSql(row.send_financial, false),
      nullableStringValue(row.financial_schedule_time),
      nullableStringValue(row.display_name),
      booleanToSql(row.is_active, true),
      updatedAt,
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      deletedAt
    );
    if (keepLocalTombstone) resendTombstone.run(id);
    count++;
  }
  return count;
}

export interface CnpjLookupResult {
  found: boolean;
  cnpj: string;
  legalName: string | null;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
}

/**
 * Consulta os dados cadastrais de um CNPJ pela edge cnpj-lookup (BrasilAPI/Receita).
 * O e-mail quase nunca vem na base publica — os demais campos (endereco, razao
 * social, telefone) vem normalmente. Lanca em CNPJ invalido / consulta indisponivel.
 */
export async function lookupCnpjFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  cnpj: string
): Promise<CnpjLookupResult> {
  const value = normalizeDocument(String(cnpj ?? ""));
  if (documentKind(value) !== "cnpj") {
    throw new Error("CNPJ invalido. Informe as 14 posicoes.");
  }
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<CnpjLookupResult & { message?: string }>(
    "cnpj-lookup",
    { body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken, cnpj: value } }
  );
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!data) throw new Error("Consulta de CNPJ nao retornou dados.");
  return data;
}

/** As colunas do bloco comercial como elas estao HOJE nesta maquina. */
interface LocalCommercialRow {
  needs_push: number;
  updated_at: string | null;
  default_payment_method_id: string | null;
  default_carrier_id: string | null;
  nf_required: number;
  credit_mode: string;
  credit_account_enabled: number;
  credit_periodicity: string;
  credit_closing_day: number | null;
  credit_second_closing_day: number | null;
  credit_boleto_days: number | null;
  credit_second_boleto_days: number | null;
  credit_closing_weekday: number | null;
}

function upsertCloudCustomers(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>,
  /**
   * Quem vence no bloco comercial/credito do cadastro (ver
   * `shouldApplyCloudCommercialBlock`) — a mesma politica que decide o preco. O padrao e o
   * comportamento de sempre da pedreira que nao elegeu principal.
   */
  commercialPolicy: PriceConflictPolicy = "local"
): number {
  const readLocalCommercial = database.prepare(
    `SELECT needs_push, updated_at, default_payment_method_id, default_carrier_id, nf_required, credit_mode,
            credit_account_enabled, credit_periodicity, credit_closing_day,
            credit_second_closing_day, credit_boleto_days, credit_second_boleto_days,
            credit_closing_weekday
       FROM customers WHERE id = ?`
  );
  const upsert = database.prepare(`
    INSERT INTO customers (
      id, company_id, omie_customer_id, source, legal_name, trade_name, document, phone, email,
      credit_limit_cents, open_receivables_cents, default_freight_modality,
      default_payment_method_id, default_carrier_id, nf_required, credit_mode,
      credit_account_enabled, credit_periodicity, credit_closing_day, credit_second_closing_day,
      credit_boleto_days, credit_second_boleto_days, credit_closing_weekday,
      sync_status, is_active,
      created_at, updated_at, deleted_at, last_synced_at, needs_push
    ) VALUES (?, ?, ?, 'hybrid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, NULL, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      -- Nunca apagar o codigo do OMIE que ja temos: sem ele o proximo push tenta um
      -- IncluirCliente de um cadastro que ja existe la e cai em "Cliente ja cadastrado".
      omie_customer_id = COALESCE(excluded.omie_customer_id, customers.omie_customer_id),
      source = CASE WHEN customers.source = 'local' THEN 'hybrid' ELSE customers.source END,
      -- needs_push = 1 significa cadastro editado aqui e ainda NAO enviado ao OMIE. A
      -- versao da nuvem e mais velha que essa edicao: sobrescrever apagava da tela o
      -- CPF/CNPJ (e telefone, e-mail, razao social...) que o operador acabou de digitar
      -- e ainda zerava o needs_push, cancelando de vez o envio ao OMIE. Mesma protecao
      -- que carriers/report_recipients ja tinham.
      legal_name = CASE WHEN customers.needs_push = 0 THEN excluded.legal_name ELSE customers.legal_name END,
      trade_name = CASE WHEN customers.needs_push = 0 THEN excluded.trade_name ELSE customers.trade_name END,
      document = CASE WHEN customers.needs_push = 0 THEN excluded.document ELSE customers.document END,
      phone = CASE WHEN customers.needs_push = 0 THEN excluded.phone ELSE customers.phone END,
      email = CASE WHEN customers.needs_push = 0 THEN excluded.email ELSE customers.email END,
      credit_limit_cents = CASE WHEN customers.needs_push = 0 THEN excluded.credit_limit_cents ELSE customers.credit_limit_cents END,
      -- Saldo em aberto e projecao da nuvem (nunca editado aqui): sempre o valor de la.
      open_receivables_cents = excluded.open_receivables_cents,
      -- Tipo de frete padrao da aba Transporte. Segue a mesma guarda dos demais campos do
      -- cadastro: edicao local ainda nao enviada ao OMIE nunca e sobrescrita pela nuvem.
      default_freight_modality = CASE WHEN customers.needs_push = 0 THEN excluded.default_freight_modality ELSE customers.default_freight_modality END,
      -- Bloco comercial/credito: sem CASE aqui de proposito. Quem decide entre a nuvem e a
      -- copia local e shouldApplyCloudCommercialBlock, la em cima, porque a regra tem tres
      -- desfechos (principal nunca aceita, secundaria sempre aceita, sem principal segue o
      -- needs_push) e depende de uma coluna que o SQL daqui nao ve. O que chega em excluded
      -- ja e o valor final: quando o bloco nao se aplica, ele e a propria copia local.
      default_payment_method_id = excluded.default_payment_method_id,
      default_carrier_id = excluded.default_carrier_id,
      nf_required = excluded.nf_required,
      credit_mode = excluded.credit_mode,
      credit_account_enabled = excluded.credit_account_enabled,
      credit_periodicity = excluded.credit_periodicity,
      credit_closing_day = excluded.credit_closing_day,
      credit_second_closing_day = excluded.credit_second_closing_day,
      credit_boleto_days = excluded.credit_boleto_days,
      credit_second_boleto_days = excluded.credit_second_boleto_days,
      credit_closing_weekday = excluded.credit_closing_weekday,
      sync_status = CASE WHEN customers.needs_push = 0 THEN 'synced' ELSE customers.sync_status END,
      is_active = CASE WHEN customers.needs_push = 0 THEN excluded.is_active ELSE customers.is_active END,
      updated_at = CASE WHEN customers.needs_push = 0 THEN excluded.updated_at ELSE customers.updated_at END,
      -- Exclusao local pendente nao pode ser ressuscitada pelo espelho da nuvem.
      deleted_at = CASE WHEN customers.needs_push = 0 THEN NULL ELSE customers.deleted_at END,
      last_synced_at = excluded.last_synced_at,
      needs_push = customers.needs_push
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const document = nullableStringValue(row.document);
    const localTwin = findLocalCadastroWithDocument(database, "customers", companyId, document, id);
    if (localTwin) {
      adoptOmieCodeFromCloudTwin(
        database,
        "customers",
        localTwin,
        integerValue(row.omie_customer_id)
      );
      continue;
    }
    const legalName = stringValue(row.legal_name) || stringValue(row.trade_name) || "Cliente";
    const tradeName = stringValue(row.trade_name) || legalName;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    const local = readLocalCommercial.get(id) as LocalCommercialRow | undefined;
    const commercial = resolveCommercialBlock(
      database,
      row,
      local,
      commercialPolicy,
      id,
      updatedAt
    );
    upsert.run(
      id,
      companyId,
      integerValue(row.omie_customer_id),
      legalName,
      tradeName,
      document,
      nullableStringValue(row.phone),
      nullableStringValue(row.email),
      integerValue(row.credit_limit_cents),
      integerValue(row.open_receivables_cents) ?? 0,
      nullableStringValue(row.default_freight_modality),
      commercial.defaultPaymentMethodId,
      commercial.defaultCarrierId,
      commercial.nfRequired,
      commercial.creditMode,
      commercial.creditAccountEnabled,
      commercial.creditPeriodicity,
      commercial.creditClosingDay,
      commercial.creditSecondClosingDay,
      commercial.creditBoletoDays,
      commercial.creditSecondBoletoDays,
      commercial.creditClosingWeekday,
      booleanToSql(row.is_active, true),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

/**
 * O bloco comercial/credito que vai ser gravado nesta linha: o da nuvem quando ele se
 * aplica, senao a propria copia local.
 *
 * Os dois ids passam por tradutor em vez de irem direto. A forma de pagamento padrao do
 * sistema nasce com id SORTEADO em cada balanca (ver a migracao `local_payment_methods...`),
 * entao o id que a principal publicou nao existe aqui — `resolvePaymentMethodId` acha a
 * gemea pelo `code`. A transportadora tem id unico, mas pode nao ter sido espelhada ainda
 * neste mesmo pull; `resolveMirroredId` mantem o vinculo anterior em vez de apaga-lo por
 * causa de um cadastro atrasado. Nos dois casos, id vazio continua sendo id vazio: e assim
 * que a principal limpa o padrao nas demais maquinas.
 */
function resolveCommercialBlock(
  database: DesktopDatabase,
  row: Record<string, unknown>,
  local: LocalCommercialRow | undefined,
  policy: PriceConflictPolicy,
  customerId: string,
  cloudUpdatedAt: string
): {
  defaultPaymentMethodId: string | null;
  defaultCarrierId: string | null;
  nfRequired: number;
  creditMode: string;
  creditAccountEnabled: number;
  creditPeriodicity: string;
  creditClosingDay: number | null;
  creditSecondClosingDay: number | null;
  creditBoletoDays: number | null;
  creditSecondBoletoDays: number | null;
  creditClosingWeekday: number | null;
} {
  // Os defaults sao os do CREATE TABLE: linha nova (INSERT) nao tem copia local para herdar.
  const localNfRequired = local ? local.nf_required : 1;
  const localCreditMode = normalizeCreditMode(local?.credit_mode, "normal");
  const localCreditAccountEnabled = local ? local.credit_account_enabled : 0;
  const localCreditPeriodicity = normalizeCreditPeriodicity(local?.credit_periodicity, "monthly");

  if (
    !shouldApplyCloudCommercialBlock({
      policy,
      cloudRow: row,
      localNeedsPush: Number(local?.needs_push ?? 0) === 1,
      customerId,
      cloudUpdatedAt,
      localUpdatedAt: isoStringValue(local?.updated_at) || null
    })
  ) {
    return {
      defaultPaymentMethodId: local?.default_payment_method_id ?? null,
      defaultCarrierId: local?.default_carrier_id ?? null,
      nfRequired: localNfRequired,
      creditMode: localCreditMode,
      creditAccountEnabled: localCreditAccountEnabled,
      creditPeriodicity: localCreditPeriodicity,
      creditClosingDay: local?.credit_closing_day ?? null,
      creditSecondClosingDay: local?.credit_second_closing_day ?? null,
      creditBoletoDays: local?.credit_boleto_days ?? null,
      creditSecondBoletoDays: local?.credit_second_boleto_days ?? null,
      creditClosingWeekday: local?.credit_closing_weekday ?? null
    };
  }

  return {
    defaultPaymentMethodId: resolvePaymentMethodId(
      database,
      row.default_payment_method_id,
      local?.default_payment_method_id
    ),
    defaultCarrierId: resolveMirroredId(
      database,
      "carriers",
      row.default_carrier_id,
      local?.default_carrier_id
    ),
    nfRequired: booleanToSql(row.nf_required, localNfRequired === 1),
    creditMode: normalizeCreditMode(row.credit_mode, localCreditMode),
    creditAccountEnabled: booleanToSql(row.credit_account_enabled, localCreditAccountEnabled === 1),
    creditPeriodicity: normalizeCreditPeriodicity(row.credit_periodicity, localCreditPeriodicity),
    creditClosingDay: integerValue(row.credit_closing_day),
    creditSecondClosingDay: integerValue(row.credit_second_closing_day),
    creditBoletoDays: integerValue(row.credit_boleto_days),
    creditSecondBoletoDays: integerValue(row.credit_second_boleto_days),
    creditClosingWeekday: integerValue(row.credit_closing_weekday)
  };
}

function upsertCloudProducts(
  database: DesktopDatabase,
  companyId: string,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO products (
      id, company_id, omie_product_id, code, description, unit, is_active, updated_from_omie_at,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      omie_product_id = excluded.omie_product_id,
      code = excluded.code,
      description = excluded.description,
      unit = excluded.unit,
      is_active = excluded.is_active,
      updated_from_omie_at = excluded.updated_from_omie_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const description = stringValue(row.description) || "Produto";
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      companyId,
      integerValue(row.omie_product_id),
      stringValue(row.code) || id,
      description,
      stringValue(row.unit) || "KG",
      booleanToSql(row.is_active, true),
      updatedAt,
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

/** Copia local usada para decidir o que a projecao da nuvem pode sobrescrever. */
type LocalOperationSnapshot = {
  status: string;
  updated_at: string;
  customer_id: string | null;
  product_id: string | null;
  carrier_id: string | null;
  freight_json: string | null;
  payment_method_id: string | null;
  wallet_settlement_method_id: string | null;
  wallet_settlement_due_date: string | null;
  wallet_settled_at: string | null;
  wallet_settlement_note: string | null;
  settle_from_advance: number | null;
  omie_advance_settle_cents: number | null;
};

/**
 * A projecao da nuvem carrega esta coluna. Uma nuvem ainda sem a migracao responde a
 * operacao SEM a chave (o `select *` do desktop-pull so devolve o que existe), e ai o
 * valor local e o unico que existe — sobrescrever com nulo apagaria, por exemplo, o
 * fechamento de carteira que esta maquina acabou de lancar. Com a coluna ja na nuvem a
 * chave vem sempre, inclusive nula, e o nulo passa a ser uma informacao legitima
 * (a venda foi reaberta na outra balanca).
 */
function isProjectedColumn(row: Record<string, unknown>, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, column);
}

/**
 * Valor de uma coluna projetada, decidido entre o que a nuvem mandou e a copia local.
 *
 * Tres desfechos, e o do meio e o que faz a carteira da pedreira aparecer inteira:
 * - a nuvem ainda nao tem a coluna (migracao pendente) ⇒ o valor local e o unico que
 *   existe e continua valendo;
 * - a projecao e mais nova ⇒ ela manda, inclusive o nulo (e assim que a reabertura
 *   lancada na outra balanca chega ate aqui);
 * - `updated_at` empatado ⇒ a projecao so PREENCHE o que esta vazio aqui. O empate
 *   quer dizer que esta linha nasceu da propria nuvem: ou e o eco do nosso push, ou e
 *   uma linha que esta maquina espelhou ANTES de conhecer a coluna — o caso da venda
 *   em carteira feita na outra balanca, gravada aqui sem a forma de pagamento e por
 *   isso invisivel na tela Carteira. Preencher recupera a venda; sobrescrever com
 *   nulo apagaria o fechamento que esta maquina acabou de lancar.
 */
function mergeProjectedValue(
  row: Record<string, unknown>,
  column: string,
  cloudIsNewer: boolean,
  readProjected: () => string | null,
  localValue: string | null | undefined
): string | null {
  if (!isProjectedColumn(row, column)) return localValue ?? null;
  const projected = readProjected();
  if (cloudIsNewer) return projected;
  return projected ?? localValue ?? null;
}

/**
 * Mesma decisao de `mergeProjectedValue` para uma coluna numerica (o abatimento do
 * adiantamento e a marca que o gerou). Zero e valor legitimo, entao o criterio de
 * "vazio" e o nulo/ausente — nunca o falsy.
 */
function mergeProjectedNumber(
  row: Record<string, unknown>,
  column: string,
  cloudIsNewer: boolean,
  projected: number | null,
  localValue: number | null | undefined
): number {
  if (!isProjectedColumn(row, column)) return localValue ?? 0;
  if (cloudIsNewer) return projected ?? 0;
  return projected ?? localValue ?? 0;
}

/**
 * Id de cadastro vindo da nuvem traduzido para o espelho local.
 *
 * Tres casos, e cada um precisa de um desfecho diferente:
 * - a nuvem mandou vazio ⇒ vazio (ex.: transportadora removida porque o cliente
 *   passou a usar transporte proprio). Precisa limpar o vinculo local.
 * - a nuvem mandou um id que existe aqui ⇒ e o valor novo.
 * - a nuvem mandou um id que esta maquina ainda nao espelhou (cadastro chega no
 *   mesmo pull, mas pode ter falhado) ⇒ mantem o que ja estava, em vez de apagar
 *   o vinculo por causa de um cadastro atrasado.
 */
function resolveMirroredId(
  database: DesktopDatabase,
  table: string,
  value: unknown,
  localValue: string | null | undefined
): string | null {
  const incoming = nullableStringValue(value);
  if (!incoming) return null;
  return existingId(database, table, incoming) ?? localValue ?? null;
}

/**
 * Registra que a forma de pagamento `remoteId` (o id que a outra balanca da pedreira
 * usa) e a mesma forma que a `localId` daqui — as duas nasceram do mesmo padrao do
 * sistema, com o mesmo `code` e ids diferentes. Ver a migracao local
 * `payment_method_cloud_aliases`.
 */
function rememberPaymentMethodAlias(
  database: DesktopDatabase,
  companyId: string,
  remoteId: string,
  localId: string
): void {
  if (!remoteId || !localId || remoteId === localId) return;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO payment_method_aliases (remote_id, company_id, local_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(remote_id) DO UPDATE SET
         company_id = excluded.company_id,
         local_id = excluded.local_id,
         updated_at = excluded.updated_at`
    )
    .run(remoteId, companyId, localId, now, now);
}

/**
 * Forma de pagamento da projecao traduzida para o espelho local.
 *
 * Diferente das outras FKs, esta nao pode se contentar com `existingId`: a forma que a
 * outra balanca usou tem id proprio e nunca chega a ser gravada aqui (UNIQUE por
 * `code`). Sem consultar a equivalencia, a operacao vinda da outra maquina perdia a
 * forma de pagamento — e uma venda sem forma nao e classificada como "em carteira",
 * entao sumia da tela Carteira desta maquina.
 */
function resolvePaymentMethodId(
  database: DesktopDatabase,
  value: unknown,
  localValue: string | null | undefined
): string | null {
  const incoming = nullableStringValue(value);
  if (!incoming) return null;
  const direct = existingId(database, "payment_methods", incoming);
  if (direct) return direct;
  const twin = database
    .prepare(
      `SELECT alias.local_id AS id
       FROM payment_method_aliases alias
       JOIN payment_methods pm ON pm.id = alias.local_id AND pm.deleted_at IS NULL
       WHERE alias.remote_id = ?`
    )
    .get(incoming) as { id: string } | undefined;
  // Ainda sem equivalencia (o cadastro chega no mesmo pull, mas pode ter falhado):
  // mantem o que esta maquina ja tinha em vez de apagar o vinculo.
  return twin?.id ?? localValue ?? null;
}

function upsertCloudOperations(
  database: DesktopDatabase,
  settings: CloudSettings,
  rows: Array<Record<string, unknown>>,
  warnings: string[] = []
): number {
  const upsert = database.prepare(`
    INSERT INTO weighing_operations (
      id, company_id, unit_id, device_id, operation_code, status, operation_type, customer_id, vehicle_id, driver_id,
      carrier_id,
      product_id, payment_term_id, entry_weight_kg, entry_weight_captured_at, exit_weight_kg,
      exit_weight_captured_at, net_weight_kg, unit_price_cents, product_total_cents,
      freight_total_cents, total_cents, freight_json, freight_type, omie_sales_order_id,
      omie_service_order_id, cloud_synced_at, cancel_reason, created_at, updated_at,
      base_unit_price_cents, applied_price_table_id, applied_price_table_name,
      applied_price_table_item_id, price_unit,
      price_savings_percent, deduct_freight_from_credit, product_credit_debit_cents,
      freight_credit_debit_cents, quotation_id,
      remote_plate, remote_driver_name, remote_customer_name, remote_product_description,
      payment_method_id, wallet_settlement_method_id, wallet_settlement_due_date,
      wallet_settled_at, wallet_settlement_note, settle_from_advance, omie_advance_settle_cents,
      future_billing_nfe_number, future_billing_invoice_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id = excluded.company_id,
      unit_id = excluded.unit_id,
      device_id = excluded.device_id,
      -- Codigo da operacao nasce com ela e nunca muda; um projecao sem o campo (nuvem
      -- ainda sem a coluna) nao pode apagar o que esta maquina ja imprimiu no cupom.
      operation_code = COALESCE(excluded.operation_code, weighing_operations.operation_code),
      status = excluded.status,
      operation_type = excluded.operation_type,
      customer_id = excluded.customer_id,
      -- Vinculo com o cadastro local: preenche quando a projecao conseguiu casar
      -- placa/motorista, mas nunca apaga o vinculo que esta maquina ja tinha.
      vehicle_id = COALESCE(excluded.vehicle_id, weighing_operations.vehicle_id),
      driver_id = COALESCE(excluded.driver_id, weighing_operations.driver_id),
      -- carrier_id chega resolvido de resolveMirroredId: quando a nuvem manda um
      -- id que esta maquina ainda nao espelhou, o valor local e mantido; quando a
      -- nuvem manda vazio (transporte proprio do cliente), o vinculo e limpo — ali o
      -- vazio E informacao.
      carrier_id = excluded.carrier_id,
      -- Cliente e produto NAO seguem essa regra: nao existe pesagem sem cliente nem sem
      -- produto, entao um vazio vindo da projecao nunca e "o operador tirou" — e a nuvem
      -- que ainda nao sabe. Sem o COALESCE, um eco vazio APAGAVA o cliente de uma carga ja
      -- concluida: ela virava "Cliente nao informado", sumia de qualquer busca pelo nome e
      -- o fechamento passava a recusa-la com "operacao fiscal sem cliente vinculado" — ou
      -- seja, carga pesada, entregue, e sem ninguem para cobrar.
      customer_id = COALESCE(excluded.customer_id, weighing_operations.customer_id),
      product_id = COALESCE(excluded.product_id, weighing_operations.product_id),
      payment_term_id = excluded.payment_term_id,
      entry_weight_kg = excluded.entry_weight_kg,
      entry_weight_captured_at = excluded.entry_weight_captured_at,
      exit_weight_kg = excluded.exit_weight_kg,
      exit_weight_captured_at = excluded.exit_weight_captured_at,
      net_weight_kg = excluded.net_weight_kg,
      unit_price_cents = excluded.unit_price_cents,
      product_total_cents = excluded.product_total_cents,
      freight_total_cents = excluded.freight_total_cents,
      total_cents = excluded.total_cents,
      freight_json = excluded.freight_json,
      freight_type = excluded.freight_type,
      omie_sales_order_id = excluded.omie_sales_order_id,
      omie_service_order_id = excluded.omie_service_order_id,
      cloud_synced_at = excluded.cloud_synced_at,
      cancel_reason = excluded.cancel_reason,
      updated_at = excluded.updated_at,
      base_unit_price_cents = excluded.base_unit_price_cents,
      applied_price_table_id = excluded.applied_price_table_id,
      applied_price_table_name = excluded.applied_price_table_name,
      applied_price_table_item_id = excluded.applied_price_table_item_id,
      price_unit = excluded.price_unit,
      price_savings_percent = excluded.price_savings_percent,
      deduct_freight_from_credit = excluded.deduct_freight_from_credit,
      product_credit_debit_cents = excluded.product_credit_debit_cents,
      freight_credit_debit_cents = excluded.freight_credit_debit_cents,
      quotation_id = excluded.quotation_id,
      remote_plate = COALESCE(excluded.remote_plate, weighing_operations.remote_plate),
      remote_driver_name = COALESCE(excluded.remote_driver_name, weighing_operations.remote_driver_name),
      remote_customer_name = COALESCE(excluded.remote_customer_name, weighing_operations.remote_customer_name),
      remote_product_description = COALESCE(excluded.remote_product_description, weighing_operations.remote_product_description),
      -- Nota de entrega futura da carga: congelada no fechamento e nunca reescrita por um
      -- pull. COALESCE porque uma balanca em versao antiga projeta a operacao sem a coluna
      -- e um nulo dela nao pode apagar o numero que esta maquina ja imprimiu no cupom.
      future_billing_nfe_number = COALESCE(excluded.future_billing_nfe_number, weighing_operations.future_billing_nfe_number),
      -- Qual nota a carga baixou: chega junto com o numero e pelo mesmo COALESCE. E o que
      -- faz o saldo da nota bater nas duas balancas — a retirada que a outra maquina fechou
      -- so entra na conta desta quando este vinculo chega.
      future_billing_invoice_id = COALESCE(excluded.future_billing_invoice_id, weighing_operations.future_billing_invoice_id),
      -- Carteira: os valores ja chegam resolvidos de isProjectedColumn (nuvem sem as
      -- colunas devolve o que esta maquina tem), entao aqui a projecao manda — inclusive
      -- o nulo, que e como a reabertura feita na outra balanca chega ate aqui.
      payment_method_id = excluded.payment_method_id,
      wallet_settlement_method_id = excluded.wallet_settlement_method_id,
      wallet_settlement_due_date = excluded.wallet_settlement_due_date,
      wallet_settled_at = excluded.wallet_settled_at,
      wallet_settlement_note = excluded.wallet_settlement_note,
      -- Abatimento do adiantamento: a marca "abater" e o valor abatido no fechamento.
      -- Passam pelo mesmo criterio das colunas da carteira (ver mergeProjectedNumber), e
      -- por isso chegam aqui ja decididos entre a projecao e a copia local. Sem eles a
      -- outra balanca da pedreira mostraria a venda inteira a receber na Carteira e
      -- reservaria de novo um adiantamento que ja foi consumido.
      settle_from_advance = excluded.settle_from_advance,
      omie_advance_settle_cents = excluded.omie_advance_settle_cents
  `);

  const readLocal = database.prepare(
    `SELECT status, updated_at, customer_id, product_id, carrier_id, freight_json,
       payment_method_id,
       wallet_settlement_method_id, wallet_settlement_due_date, wallet_settled_at,
       wallet_settlement_note, settle_from_advance, omie_advance_settle_cents
     FROM weighing_operations WHERE id = ?`
  );

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    // Multi-desktop: a projecao da nuvem pode estar atras da copia local (esta
    // maquina fechou/alterou e ainda nao terminou o push). Nunca sobrescreve
    // uma versao local mais nova nem regride status terminal para aberto.
    const local = readLocal.get(id) as LocalOperationSnapshot | undefined;
    // A projecao so pode APAGAR um campo desta operacao quando e mais nova que a
    // copia local. No empate ela e o eco do nosso proprio push — e um eco vazio
    // (a nuvem gravou a linha antes de ganhar a coluna, ou quem enviou foi uma
    // balanca de versao antiga) nao pode limpar o que esta maquina gravou.
    let cloudIsNewer = true;
    if (local) {
      const localTs = parseTimestamp(local.updated_at);
      const cloudTs = parseTimestamp(updatedAt);
      if (localTs !== null && cloudTs !== null) {
        if (cloudTs < localTs) {
          continue;
        }
        cloudIsNewer = cloudTs > localTs;
      }
      const incomingStatus = mapCloudOperationStatus(row.status);
      if (
        TERMINAL_LOCAL_OPERATION_STATUSES.has(local.status) &&
        !TERMINAL_LOCAL_OPERATION_STATUSES.has(incomingStatus)
      ) {
        continue;
      }
    }
    const closedAt = isoStringValue(row.closed_at);
    const customerId = resolveMirroredId(
      database,
      "customers",
      row.customer_id,
      local?.customer_id
    );
    const productId = resolveMirroredId(database, "products", row.product_id, local?.product_id);
    const carrierId = resolveMirroredId(database, "carriers", row.carrier_id, local?.carrier_id);
    // A nuvem guarda placa/motorista so como texto. Casa com o cadastro local
    // (que ja veio no mesmo pull) para a operacao da outra balanca aparecer
    // completa; o texto fica gravado como fallback de exibicao.
    const remotePlate = nullableStringValue(row.plate);
    const remoteDriverName = nullableStringValue(row.driver_name);
    const vehicleId = findVehicleIdByPlate(database, settings.companyId, remotePlate);
    const driverId = findDriverIdByName(database, settings.companyId, remoteDriverName);
    // Carteira da pedreira: a forma de pagamento diz se a venda e "em carteira" e as
    // colunas `wallet_*` sao o fechamento lancado em qualquer uma das balancas. Cada
    // uma passa por `mergeProjectedValue`: a projecao mais nova manda (a outra balanca
    // trocou a forma ou reabriu a venda), o empate so preenche o que esta vazio aqui
    // (venda espelhada antes desta maquina conhecer a coluna) e a nuvem sem a coluna
    // nao apaga nada. E a FK e resolvida como as demais: uma forma ainda nao espelhada
    // aqui mantem o vinculo local em vez de apaga-lo.
    const paymentMethodId = mergeProjectedValue(
      row,
      "payment_method_id",
      cloudIsNewer,
      () => resolvePaymentMethodId(database, row.payment_method_id, local?.payment_method_id),
      local?.payment_method_id
    );
    const walletSettlementMethodId = mergeProjectedValue(
      row,
      "wallet_settlement_method_id",
      cloudIsNewer,
      () =>
        resolvePaymentMethodId(
          database,
          row.wallet_settlement_method_id,
          local?.wallet_settlement_method_id
        ),
      local?.wallet_settlement_method_id
    );
    const walletSettlementDueDate = mergeProjectedValue(
      row,
      "wallet_settlement_due_date",
      cloudIsNewer,
      () => nullableStringValue(row.wallet_settlement_due_date),
      local?.wallet_settlement_due_date
    );
    const walletSettledAt = mergeProjectedValue(
      row,
      "wallet_settled_at",
      cloudIsNewer,
      () => isoStringValue(row.wallet_settled_at),
      local?.wallet_settled_at
    );
    const walletSettlementNote = mergeProjectedValue(
      row,
      "wallet_settlement_note",
      cloudIsNewer,
      () => nullableStringValue(row.wallet_settlement_note),
      local?.wallet_settlement_note
    );
    // Abatimento do adiantamento do cliente: a marca escolhida na entrada e quanto o
    // fechamento consumiu. A saida pode ser pesada em outra balanca, entao a marca
    // precisa viajar antes do fechamento; o valor abatido viaja depois dele, para a
    // Carteira das duas maquinas mostrar o mesmo "a receber".
    const settleFromAdvance = mergeProjectedNumber(
      row,
      "settle_from_advance",
      cloudIsNewer,
      nullableBooleanToSql(row.settle_from_advance),
      local?.settle_from_advance
    );
    const advanceSettleCents = mergeProjectedNumber(
      row,
      "omie_advance_settle_cents",
      cloudIsNewer,
      integerValue(row.omie_advance_settle_cents),
      local?.omie_advance_settle_cents
    );
    // Regra de frete: passa pelo mesmo criterio das colunas da carteira, e nao
    // direto do payload. Uma nuvem sem a coluna (migracao pendente, ou o eco do push
    // de uma balanca de versao antiga) devolve a operacao SEM `freight_json` — e
    // sobrescrever com nulo apagava a regra da operacao ainda aberta. Sem regra, o
    // fechamento calculava frete zero: o cupom saia sem a linha FRETE e o pedido do
    // OMIE sem `valor_frete`. Projecao mais nova continua mandando, inclusive o nulo
    // (e assim que "tirei o frete desta operacao", feito na outra balanca, chega aqui).
    const freightJson = mergeProjectedValue(
      row,
      "freight_json",
      cloudIsNewer,
      () => jsonStringValue(row.freight_json),
      local?.freight_json
    );
    try {
      upsert.run(
        id,
        settings.companyId,
        settings.unitId,
        existingId(database, "devices", row.device_id) ?? settings.deviceId,
        integerValue(row.operation_code),
        mapCloudOperationStatus(row.status),
        mapCloudOperationType(row.operation_type),
        customerId,
        vehicleId,
        driverId,
        carrierId,
        productId,
        // FK payment_terms: uma condicao ainda nao espelhada nesta maquina
        // derrubaria a gravacao inteira da operacao.
        existingId(database, "payment_terms", row.payment_term_id),
        numberValue(row.entry_weight_kg),
        isoStringValue(row.created_at) || updatedAt,
        numberValue(row.exit_weight_kg),
        closedAt,
        numberValue(row.net_weight_kg),
        integerValue(row.unit_price_cents),
        integerValue(row.product_total_cents),
        integerValue(row.freight_total_cents) ?? 0,
        integerValue(row.total_cents),
        freightJson,
        // Projecoes antigas (antes da coluna na nuvem) chegam sem modalidade: cai em 'none'.
        getFreightModalityInfo(stringValue(row.freight_type)).key,
        integerValue(row.omie_sales_order_id),
        integerValue(row.omie_service_order_id),
        isoStringValue(row.synced_at) || updatedAt,
        nullableStringValue(row.cancel_reason),
        isoStringValue(row.created_at) || updatedAt,
        updatedAt,
        integerValue(row.base_unit_price_cents),
        nullableStringValue(row.applied_price_table_id),
        nullableStringValue(row.applied_price_table_name),
        nullableStringValue(row.applied_price_table_item_id),
        stringValue(row.price_unit) || "ton",
        numberValue(row.price_savings_percent),
        booleanToSql(row.deduct_freight_from_credit, false),
        integerValue(row.product_credit_debit_cents) ?? 0,
        integerValue(row.freight_credit_debit_cents) ?? 0,
        existingId(database, "quotations", row.quotation_id),
        remotePlate,
        remoteDriverName,
        nullableStringValue(row.customer_name),
        nullableStringValue(row.product_description),
        paymentMethodId,
        walletSettlementMethodId,
        walletSettlementDueDate,
        walletSettledAt,
        walletSettlementNote,
        settleFromAdvance,
        advanceSettleCents,
        nullableStringValue(row.future_billing_nfe_number),
        // A nota tem de existir AQUI antes de a pesagem apontar para ela (chave estrangeira).
        // No caso normal ja existe: o cadastro compartilhado e gravado logo acima, no mesmo
        // pull. Quando a janela incremental nao trouxe a nota, a pesagem entra so com o
        // numero e o COALESCE acima guarda o vinculo para o pull seguinte — enquanto isso o
        // saldo sai pelo numero congelado, como nas pesagens anteriores a esta versao.
        existingId(database, "customer_future_billing_invoices", row.future_billing_invoice_id)
      );
      count++;
    } catch (error) {
      // Uma operacao problematica nao pode cegar a maquina para todas as demais:
      // registra o aviso e segue com o resto do lote.
      warnings.push(
        `weighing_operations ${id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return count;
}

/** Veiculo local com a mesma placa (normalizada) da projecao da nuvem. */
function findVehicleIdByPlate(
  database: DesktopDatabase,
  companyId: string,
  plate: string | null
): string | null {
  if (!plate) return null;
  const normalized = plate.replace(/\s/g, "").toUpperCase();
  const row = database
    .prepare(
      `SELECT id FROM vehicles
       WHERE company_id = ? AND UPPER(REPLACE(COALESCE(plate_normalized, plate), ' ', '')) = ?
         AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(companyId, normalized) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Motorista local com o mesmo nome da projecao da nuvem. */
function findDriverIdByName(
  database: DesktopDatabase,
  companyId: string,
  name: string | null
): string | null {
  if (!name) return null;
  const row = database
    .prepare(
      `SELECT id FROM drivers
       WHERE company_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?)) AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(companyId, name) as { id: string } | undefined;
  return row?.id ?? null;
}

function upsertCloudLoadingRequests(
  database: DesktopDatabase,
  settings: CloudSettings,
  rows: Array<Record<string, unknown>>,
  warnings: string[] = []
): number {
  const upsert = database.prepare(`
    INSERT INTO loading_requests (
      id, operation_id, company_id, unit_id, status, plate, customer_name, driver_name,
      product_description, created_at, updated_at, closed_at, loader_completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation_id = excluded.operation_id,
      company_id = excluded.company_id,
      unit_id = excluded.unit_id,
      status = excluded.status,
      plate = excluded.plate,
      customer_name = excluded.customer_name,
      driver_name = excluded.driver_name,
      product_description = excluded.product_description,
      updated_at = excluded.updated_at,
      closed_at = excluded.closed_at,
      loader_completed_at = excluded.loader_completed_at
  `);

  const readLocal = database.prepare(
    "SELECT status, updated_at FROM loading_requests WHERE id = ?"
  );

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const operationId = existingId(database, "weighing_operations", row.operation_id);
    if (!id || !operationId) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    // Mesmo criterio das operacoes: a projecao da nuvem nao sobrescreve uma
    // versao local mais nova nem reabre uma solicitacao ja fechada localmente.
    const local = readLocal.get(id) as { status: string; updated_at: string } | undefined;
    if (local) {
      const localTs = parseTimestamp(local.updated_at);
      const cloudTs = parseTimestamp(updatedAt);
      if (localTs !== null && cloudTs !== null && cloudTs < localTs) {
        continue;
      }
      if (local.status !== "open" && mapLoadingRequestStatus(row.status) === "open") {
        continue;
      }
    }
    try {
      upsert.run(
        id,
        operationId,
        settings.companyId,
        settings.unitId,
        mapLoadingRequestStatus(row.status),
        stringValue(row.plate) || "SEMPLACA",
        stringValue(row.customer_name) || "Cliente",
        stringValue(row.driver_name) || "Motorista",
        stringValue(row.product_description) || "Produto",
        isoStringValue(row.created_at) || updatedAt,
        updatedAt,
        isoStringValue(row.closed_at),
        isoStringValue(row.loader_completed_at)
      );
      count++;
    } catch (error) {
      warnings.push(
        `loading_requests ${id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return count;
}

function upsertCloudPrintReceipts(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>
): number {
  const upsert = database.prepare(`
    INSERT INTO print_receipts (
      id, operation_id, unit_id, receipt_number, device_number, copy_number,
      content_snapshot_json, printed_at, printer_name, status, error_message,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation_id = excluded.operation_id,
      unit_id = excluded.unit_id,
      receipt_number = excluded.receipt_number,
      device_number = excluded.device_number,
      copy_number = excluded.copy_number,
      content_snapshot_json = excluded.content_snapshot_json,
      printed_at = excluded.printed_at,
      printer_name = excluded.printer_name,
      status = excluded.status,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    const operationId = existingId(database, "weighing_operations", row.operation_id);
    const unitId = stringValue(row.unit_id);
    if (!id || !operationId || !unitId) continue;
    const updatedAt = isoStringValue(row.updated_at) || new Date().toISOString();
    upsert.run(
      id,
      operationId,
      unitId,
      integerValue(row.receipt_number) ?? 0,
      integerValue(row.device_number),
      integerValue(row.copy_number) ?? 1,
      jsonStringValue(row.content_snapshot_json) ?? "{}",
      isoStringValue(row.printed_at) || updatedAt,
      stringValue(row.printer_name) || "",
      stringValue(row.status) === "failed" ? "failed" : "printed",
      nullableStringValue(row.error_message),
      isoStringValue(row.created_at) || updatedAt,
      updatedAt
    );
    count++;
  }
  return count;
}

// Status local que nao pode ser regredido por uma projecao atrasada da nuvem.
const TERMINAL_LOCAL_OPERATION_STATUSES = new Set([
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error",
  "cancelled"
]);

function mapCloudOperationStatus(value: unknown): string {
  const status = stringValue(value);
  if (status === "open") return "awaiting_exit";
  if (
    [
      "draft",
      "entry_registered",
      "loading_requested",
      "awaiting_exit",
      "closed_local",
      "pending_cloud",
      "pending_omie",
      "synced",
      "sync_error",
      "cancelled"
    ].includes(status)
  ) {
    return status;
  }
  return "awaiting_exit";
}

function mapCloudOperationType(value: unknown): "invoice" | "internal" {
  return stringValue(value) === "internal" ? "internal" : "invoice";
}

function mapLoadingRequestStatus(value: unknown): string {
  const status = stringValue(value);
  return status || "open";
}

/**
 * Instante de um carimbo de tempo, aceitando os dois formatos que convivem no
 * SQLite local: ISO com fuso (`new Date().toISOString()`) e o formato do
 * `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` do SQLite ("2026-07-29 17:00:48"), que e UTC mas sem o
 * indicador de fuso — `Date.parse` o leria como hora local e jogaria a
 * comparacao com a nuvem horas para frente.
 */
function parseTimestamp(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function existingId(database: DesktopDatabase, table: string, value: unknown): string | null {
  const id = nullableStringValue(value);
  if (!id) return null;
  const row = database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStringValue(value: unknown): string | null {
  const text = stringValue(value);
  return text || null;
}

function isoStringValue(value: unknown): string | null {
  const text = nullableStringValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function booleanToSql(value: unknown, fallback: boolean): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value === 0 ? 0 : 1;
  return fallback ? 1 : 0;
}

/**
 * Booleano da projecao em 0/1, preservando o "a nuvem nao sabe" como null. Usado nas
 * colunas que passam por `mergeProjectedNumber`: la o nulo e o que faz o valor local
 * prevalecer numa linha antiga (gravada antes da coluna existir), enquanto um `false`
 * assumido apagaria a marca que esta maquina acabou de gravar.
 */
function nullableBooleanToSql(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return booleanToSql(value, false);
}

function jsonStringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

const CLOUD_SYNC_JOB_ORDER: Record<string, number> = {
  upsert_customer: 0,
  upsert_product: 1,
  upsert_operation: 2,
  upsert_loading_request: 3,
  upsert_print_receipt: 4
};

function orderCloudSyncJobsTopologically<
  T extends { action: string; createdAt: string; id: string }
>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const orderDiff =
      (CLOUD_SYNC_JOB_ORDER[a.action] ?? 99) - (CLOUD_SYNC_JOB_ORDER[b.action] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function syncCustomerToSupabase(
  database: DesktopDatabase,
  customerId: string
): Promise<boolean> {
  const settings = getCloudSettings(database);
  const customer = database.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
    | Record<string, unknown>
    | undefined;
  if (!customer) throw new Error(`Customer ${customerId} not found`);
  await invokeDesktopSync(settings, {
    customers: [
      {
        id: String(customer.id),
        company_id: settings.companyId,
        omie_customer_id: customer.omie_customer_id,
        legal_name: customer.legal_name,
        trade_name: customer.trade_name,
        document: customer.document,
        phone: customer.phone,
        email: customer.email,
        credit_limit_cents: customer.credit_limit_cents,
        open_receivables_cents: customer.open_receivables_cents,
        is_active: Boolean(customer.is_active ?? true),
        updated_at: new Date().toISOString()
      }
    ]
  });
  return true;
}

export async function syncProductToSupabase(
  database: DesktopDatabase,
  productId: string
): Promise<boolean> {
  const settings = getCloudSettings(database);
  const product = database.prepare("SELECT * FROM products WHERE id = ?").get(productId) as
    | Record<string, unknown>
    | undefined;
  if (!product) throw new Error(`Product ${productId} not found`);
  await invokeDesktopSync(settings, {
    products: [
      {
        id: String(product.id),
        company_id: settings.companyId,
        omie_product_id: product.omie_product_id,
        code: product.code,
        description: product.description,
        unit: product.unit,
        is_active: Boolean(product.is_active ?? true),
        updated_at: new Date().toISOString()
      }
    ]
  });
  return true;
}

export async function getSupabaseSyncStatus(
  companyId: string
): Promise<{ totalOperations: number; lastSync: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error, count } = await supabase
    .from("weighing_operations")
    .select("synced_at", { count: "exact" })
    .eq("company_id", companyId)
    .order("synced_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return { totalOperations: count ?? 0, lastSync: data?.[0]?.synced_at ?? null };
}

const OMIE_SYNC_REDUNDANT_MAX_RETRIES = 2;
const OMIE_SYNC_REDUNDANT_DEFAULT_WAIT_MS = 60_000;
const OMIE_SYNC_REDUNDANT_MAX_WAIT_MS = 65_000;

function isOmieSyncRedundantError(message: string): boolean {
  return /REDUNDANT|Consumo redundante/i.test(message);
}

function parseOmieSyncRedundantWaitMs(message: string): number {
  const match = /Aguarde\s+(\d+)\s+segundos?/i.exec(message);
  const seconds = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return OMIE_SYNC_REDUNDANT_DEFAULT_WAIT_MS;
  return Math.min(seconds * 1000 + 1000, OMIE_SYNC_REDUNDANT_MAX_WAIT_MS);
}

export async function syncOmieReferenceDataFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { reset?: boolean } = {}
): Promise<OmieCloudSyncResult> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  if (options.reset) {
    writeOmiePullState(database, {
      customersPage: 1,
      productsPage: 1,
      paymentTermsPage: 1,
      suppliersPage: 1,
      categoriesPage: 1,
      customersFinished: false,
      productsFinished: false,
      paymentTermsFinished: false,
      suppliersFinished: false,
      categoriesFinished: false,
      inProgress: false
    });
  }
  const state = readOmiePullState(database);
  const body = {
    deviceId: settings.deviceId,
    deviceToken: settings.deviceToken,
    action: "pull_reference_data",
    resume: {
      customersPage: state.customersPage,
      productsPage: state.productsPage,
      paymentTermsPage: state.paymentTermsPage,
      categoriesPage: state.categoriesPage,
      customersFinished: state.customersFinished,
      productsFinished: state.productsFinished,
      paymentTermsFinished: state.paymentTermsFinished,
      categoriesFinished: state.categoriesFinished
    }
  };

  for (let attempt = 0; attempt <= OMIE_SYNC_REDUNDANT_MAX_RETRIES; attempt++) {
    const { data, error } = await supabase.functions.invoke<OmieReferenceDataResponse>(
      "omie-sync",
      { body }
    );

    if (error) {
      const message = await getFunctionErrorMessage(error);
      if (isOmieSyncRedundantError(message) && attempt < OMIE_SYNC_REDUNDANT_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, parseOmieSyncRedundantWaitMs(message)));
        continue;
      }
      throw new Error(message);
    }

    if (!data) throw new Error("Resposta OMIE vazia.");

    // Persistir com o MESMO company_id que as telas de cadastro consultam
    // (identidade local ativa). Usar o id da nuvem aqui deixaria os registros
    // invisiveis na UI caso as duas chaves divirjam.
    return applyOmieReferenceData(database, identity.companyId, data);
  }

  throw new Error("OMIE sync redundant retry exhausted.");
}

/** Estado do espelhamento dos adiantamentos, guardado entre ciclos. */
interface OmieAdvancesState {
  /** Categorias de adiantamento ja descobertas (evita revarrer o plano de contas). */
  categoryCodes?: string[];
  /** Fim da ultima janela sincronizada com sucesso (ISO yyyy-mm-dd). */
  lastSyncedDate?: string;
  lastSyncedAt?: string;
  /** Pagina em que o ciclo anterior parou (varredura ainda incompleta). */
  pendingPage?: number;
  /** Janela do ciclo interrompido, para retomar exatamente onde parou. */
  pendingStartDate?: string | null;
  pendingEndDate?: string | null;
}

/** Cursor da varredura de adiantamentos (janela ja sincronizada e pagina pendente). */
export const OMIE_ADVANCES_STATE_KEY = "omie_advances_state";
/** Paginas de contas a receber por ciclo: teto para nao prender a sincronizacao. */
const OMIE_ADVANCES_MAX_PAGES = 20;
/**
 * Reprocessa alguns dias ja sincronizados a cada ciclo. A janela filtra por
 * inclusao/alteracao no OMIE, e uma baixa lancada com data retroativa (ou um
 * ciclo que caiu no meio) apareceria fora da janela seguinte.
 */
const OMIE_ADVANCES_OVERLAP_DAYS = 7;

export interface CustomerAdvancesSyncResult {
  /** Adiantamentos vistos no OMIE (todas as paginas do ciclo). */
  advances: number;
  /** Adiantamentos novos espelhados no extrato. */
  imported: number;
  /** Adiantamentos que mudaram no OMIE e foram acertados. */
  adjusted: number;
  unchanged: number;
  /** Titulos de clientes que nao existem nesta pedreira. */
  unknownCustomers: number;
  /** Lancamentos aplicados no extrato local. */
  movementsApplied: number;
  pages: number;
  finished: boolean;
  categoryCodes: string[];
}

/**
 * Espelha os adiantamentos do cliente (dinheiro depositado, registrado no
 * financeiro do OMIE) no extrato de credito local, para que as compras da
 * balanca sejam abatidas desse saldo.
 *
 * Quem le o OMIE e grava o lancamento e a Edge Function (credencial e escritor
 * unico ficam na nuvem); aqui so aplicamos as linhas que voltam, pelo mesmo
 * caminho de qualquer movimento vindo de outra maquina — entao o saldo continua
 * sendo recalculado pelo log e o que foi lancado offline nao se perde.
 *
 * `customerOmieCode` faz a consulta MIRAR UM CLIENTE, sem janela de data e sem
 * mexer no cursor do ciclo completo: e a conferencia que a balanca dispara na
 * pesagem de uma venda em carteira abatida do adiantamento. Fosse pelo cursor,
 * essa conferencia diria ao proximo ciclo que tudo ate hoje ja foi varrido e os
 * adiantamentos ANTIGOS dos DEMAIS clientes ficariam fora da janela seguinte.
 */
export async function syncCustomerAdvancesFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { fullRescan?: boolean; customerOmieCode?: number } = {}
): Promise<CustomerAdvancesSyncResult> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const targeted = typeof options.customerOmieCode === "number" && options.customerOmieCode > 0;
  const state =
    options.fullRescan || targeted
      ? {}
      : (readLocalSetting<OmieAdvancesState>(database, OMIE_ADVANCES_STATE_KEY) ?? {});
  // Categoria fixada na configuracao vence a deteccao por nome: pedreira que
  // renomeou a categoria de adiantamento continua sincronizando.
  const configuredCategoryCodes = readOmieAdvanceConfig(database).categoryCodes;
  const today = toIsoDate(new Date());
  // Ciclo anterior parou no meio (tenant grande, queda de rede): retoma a mesma
  // janela na pagina seguinte, senao a varredura recomecaria do zero e nunca
  // passaria do teto de paginas.
  const resuming = typeof state.pendingPage === "number" && state.pendingPage > 1;
  // Sem sincronizacao anterior (ou varredura completa pedida): sem janela, para
  // trazer todo o historico de adiantamentos que ainda tem saldo.
  const startDate = resuming
    ? (state.pendingStartDate ?? undefined)
    : state.lastSyncedDate
      ? addDaysToIsoDateString(state.lastSyncedDate, -OMIE_ADVANCES_OVERLAP_DAYS)
      : undefined;
  const endDate = resuming ? (state.pendingEndDate ?? undefined) : startDate ? today : undefined;
  const firstPage = resuming ? (state.pendingPage as number) : 1;
  let lastCompletedPage = firstPage - 1;

  const result: CustomerAdvancesSyncResult = {
    advances: 0,
    imported: 0,
    adjusted: 0,
    unchanged: 0,
    unknownCustomers: 0,
    movementsApplied: 0,
    pages: 0,
    finished: false,
    categoryCodes:
      configuredCategoryCodes.length > 0 ? configuredCategoryCodes : (state.categoryCodes ?? [])
  };

  try {
    for (let index = 0; index < OMIE_ADVANCES_MAX_PAGES; index++) {
      const page = firstPage + index;
      const body = {
        deviceId: settings.deviceId,
        deviceToken: settings.deviceToken,
        action: "pull_customer_advances",
        payload: {
          page,
          startDate,
          endDate,
          categoryCodes: result.categoryCodes.length > 0 ? result.categoryCodes : undefined,
          customerOmieCode: options.customerOmieCode
        }
      };

      const data = await invokeCustomerAdvancesPage(supabase, body);
      lastCompletedPage = page;
      result.pages++;
      result.advances += data.advances ?? 0;
      result.imported += data.imported ?? 0;
      result.adjusted += data.adjusted ?? 0;
      result.unchanged += data.unchanged ?? 0;
      result.unknownCustomers += data.unknownCustomers ?? 0;
      if (data.categoryCodes?.length && configuredCategoryCodes.length === 0) {
        result.categoryCodes = data.categoryCodes;
        rememberDetectedAdvanceConfig(database, { categoryCodes: data.categoryCodes });
      }

      const movements = data.movements ?? [];
      if (movements.length > 0) {
        result.movementsApplied += upsertCloudCreditMovements(
          database,
          identity.companyId,
          movements
        );
      }

      if (data.finished !== false) {
        result.finished = true;
        break;
      }
    }
  } finally {
    // Guarda o progresso ate no erro: uma queda na pagina 15 nao pode obrigar o
    // proximo ciclo a varrer as 14 anteriores de novo. As paginas ja aplicadas
    // sao idempotentes (movimento com id conhecido nao entra duas vezes).
    // A conferencia de um cliente so nao grava nada: ela nao varreu o tenant
    // inteiro e nao pode adiantar o cursor de quem varre.
    if (!targeted)
      writeLocalSetting(database, OMIE_ADVANCES_STATE_KEY, {
        categoryCodes: result.categoryCodes,
        // A janela so avanca quando o ciclo varreu ate a ultima pagina; senao o
        // proximo ciclo retoma na pagina seguinte e nada fica para tras.
        lastSyncedDate: result.finished ? (endDate ?? today) : state.lastSyncedDate,
        lastSyncedAt: new Date().toISOString(),
        pendingPage: result.finished ? undefined : lastCompletedPage + 1,
        pendingStartDate: result.finished ? undefined : (startDate ?? null),
        pendingEndDate: result.finished ? undefined : (endDate ?? null)
      } satisfies OmieAdvancesState);
  }

  return result;
}

interface CustomerAdvancesPageResponse {
  advances?: number;
  imported?: number;
  adjusted?: number;
  unchanged?: number;
  unknownCustomers?: number;
  categoryCodes?: string[];
  finished?: boolean;
  movements?: Array<Record<string, unknown>>;
}

async function invokeCustomerAdvancesPage(
  supabase: ReturnType<typeof getSupabaseClient>,
  body: Record<string, unknown>
): Promise<CustomerAdvancesPageResponse> {
  for (let attempt = 0; attempt <= OMIE_SYNC_REDUNDANT_MAX_RETRIES; attempt++) {
    const { data, error } = await supabase.functions.invoke<CustomerAdvancesPageResponse>(
      "omie-sync",
      { body }
    );

    if (error) {
      const message = await getFunctionErrorMessage(error);
      if (isOmieSyncRedundantError(message) && attempt < OMIE_SYNC_REDUNDANT_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, parseOmieSyncRedundantWaitMs(message)));
        continue;
      }
      throw new Error(message);
    }

    if (!data) throw new Error("Resposta OMIE vazia.");
    return data;
  }

  throw new Error("OMIE sync redundant retry exhausted.");
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysToIsoDateString(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export interface OmieDocumentTypeOption {
  code: string;
  description: string;
}

// Busca as formas de pagamento (tipos de documento) do OMIE sob demanda, para
// o seletor de "Codigo OMIE" das formas de pagamento locais. Nao persiste nada:
// o codigo escolhido e gravado na propria forma de pagamento.
export async function listOmieDocumentTypesFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<OmieDocumentTypeOption[]> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const body = {
    deviceId: settings.deviceId,
    deviceToken: settings.deviceToken,
    action: "list_document_types"
  };

  for (let attempt = 0; attempt <= OMIE_SYNC_REDUNDANT_MAX_RETRIES; attempt++) {
    const { data, error } = await supabase.functions.invoke<{
      documentTypes?: OmieDocumentTypeOption[];
    }>("omie-sync", { body });

    if (error) {
      const message = await getFunctionErrorMessage(error);
      if (isOmieSyncRedundantError(message) && attempt < OMIE_SYNC_REDUNDANT_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, parseOmieSyncRedundantWaitMs(message)));
        continue;
      }
      throw new Error(message);
    }

    if (!data) throw new Error("Resposta OMIE vazia.");
    return data.documentTypes ?? [];
  }

  throw new Error("OMIE sync redundant retry exhausted.");
}

export function applyOmieReferenceData(
  database: DesktopDatabase,
  companyId: string,
  data: OmieReferenceDataResponse
): OmieCloudSyncResult {
  const customers = data.customers ?? [];
  const products = data.products ?? [];
  const suppliers = data.suppliers ?? [];
  const paymentTerms = data.paymentTerms ?? [];
  const categories = data.categories ?? [];
  const pagination = data.pagination;

  // Contadores refletem linhas realmente gravadas no SQLite (nao o tamanho do payload),
  // para o log de sync nao reportar sucesso quando nada ficou visivel nas telas.
  let customersPersisted = 0;
  let productsSynced = 0;
  // As condicoes locais (payment_terms) continuam sendo cadastradas manualmente; aqui
  // apenas espelhamos os codigos de parcela do OMIE (omie_payment_terms) para vinculo.
  let paymentTermsPersisted = 0;
  let suppliersPersisted = 0;
  let categoriesPersisted = 0;
  // Uma transacao por bloco, e nao uma para a pagina inteira: uma linha
  // problematica numa tabela nao pode desfazer o que as outras gravaram. Era o
  // que acontecia com o espelho de parcelas — a pagina inteira voltava atras e a
  // pedreira ficava com zero cliente, sem nenhuma pista de que o problema estava
  // nas condicoes de pagamento.
  const errors: string[] = [];
  const applyBlock = (label: string, run: () => number): number => {
    try {
      return database.transaction(run)();
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  };

  customersPersisted = applyBlock("clientes", () =>
    upsertOmieCustomers(database, companyId, customers)
  );
  productsSynced = applyBlock("produtos", () => upsertOmieProducts(database, companyId, products));
  suppliersPersisted = applyBlock("transportadoras", () =>
    upsertOmieSuppliers(database, companyId, suppliers)
  );
  paymentTermsPersisted = applyBlock("condicoes de pagamento", () => {
    const persisted = upsertOmiePaymentTerms(database, companyId, paymentTerms);
    // Materializa parcelas novas do espelho como condicoes locais selecionaveis
    // (aparecem na Nova Entrada e no cadastro do cliente).
    provisionPaymentTermsFromOmieMirror(database, companyId);
    return persisted;
  });
  categoriesPersisted = applyBlock("categorias", () =>
    upsertOmieCategories(database, companyId, categories)
  );

  if (pagination) {
    const pageSize = data.pageSize ?? 100;
    const isFinished = (
      page: number,
      returned: number,
      flag: boolean | undefined,
      totalPages: number | null | undefined
    ): boolean => {
      if (typeof flag === "boolean") return flag;
      if (returned === 0) return true;
      if (typeof totalPages === "number" && totalPages > 0) return page >= totalPages;
      return returned < pageSize;
    };
    const finished = {
      customers: isFinished(
        pagination.customersPage,
        pagination.customersReturned,
        pagination.customersFinished,
        pagination.customersTotalPages
      ),
      products: isFinished(
        pagination.productsPage,
        pagination.productsReturned,
        pagination.productsFinished,
        pagination.productsTotalPages
      ),
      paymentTerms: isFinished(
        pagination.paymentTermsPage,
        pagination.paymentTermsReturned,
        pagination.paymentTermsFinished,
        pagination.paymentTermsTotalPages
      ),
      suppliers: isFinished(
        pagination.suppliersPage ?? pagination.customersPage,
        pagination.suppliersReturned ?? 0,
        pagination.suppliersFinished,
        pagination.suppliersTotalPages ?? pagination.customersTotalPages
      ),
      // Edge antigo (sem a etapa de categorias) nao manda nada aqui: tratar como
      // concluido evita um pull que nunca termina esperando uma pagina que nao vem.
      categories:
        pagination.categoriesPage === undefined
          ? true
          : isFinished(
              pagination.categoriesPage,
              pagination.categoriesReturned ?? 0,
              pagination.categoriesFinished,
              pagination.categoriesTotalPages
            )
    };
    const current = readOmiePullState(database);
    writeOmiePullState(database, {
      inProgress:
        !finished.customers || !finished.products || !finished.paymentTerms || !finished.categories,
      customersPage: !finished.customers
        ? Math.max(pagination.customersPage + 1, current.customersPage)
        : 1,
      productsPage: !finished.products
        ? Math.max(pagination.productsPage + 1, current.productsPage)
        : 1,
      paymentTermsPage: !finished.paymentTerms
        ? Math.max(pagination.paymentTermsPage + 1, current.paymentTermsPage)
        : 1,
      suppliersPage: !finished.customers
        ? Math.max(pagination.customersPage + 1, current.suppliersPage)
        : 1,
      categoriesPage:
        !finished.categories && pagination.categoriesPage !== undefined
          ? Math.max(pagination.categoriesPage + 1, current.categoriesPage)
          : 1,
      customersFinished: finished.customers,
      productsFinished: finished.products,
      paymentTermsFinished: finished.paymentTerms,
      suppliersFinished: finished.customers,
      categoriesFinished: finished.categories
    });
  } else {
    writeOmiePullState(database, {
      customersPage: 1,
      productsPage: 1,
      paymentTermsPage: 1,
      suppliersPage: 1,
      categoriesPage: 1,
      customersFinished: true,
      productsFinished: true,
      paymentTermsFinished: true,
      suppliersFinished: true,
      categoriesFinished: true,
      inProgress: false
    });
  }

  return {
    customersPulled: customersPersisted,
    customersPushed: 0,
    productsSynced,
    paymentTermsSynced: paymentTermsPersisted,
    suppliersSynced: suppliersPersisted,
    categoriesSynced: categoriesPersisted,
    errors,
    ...(pagination
      ? {
          customersPage: {
            page: pagination.customersPage,
            returned: pagination.customersReturned,
            classifiedCustomers: customers.length,
            classifiedCarriers: suppliers.length,
            invalid: pagination.customersInvalid ?? 0,
            supplierOnly: pagination.customersSupplierOnly ?? 0,
            finished: pagination.customersFinished ?? false,
            totalPages: pagination.customersTotalPages ?? null,
            totalRecords: pagination.customersTotalRecords ?? null
          }
        }
      : {})
  };
}

function getCloudSettings(
  database: DesktopDatabase,
  identity?: LocalDesktopIdentity
): CloudSettings {
  const settings = database
    .prepare(
      "SELECT key, value_json FROM local_settings WHERE key IN ('cloud_company_id', 'cloud_unit_id', 'cloud_device_id', 'cloud_device_token')"
    )
    .all() as Array<{ key: string; value_json: string }>;
  const map = new Map(settings.map((row) => [row.key, JSON.parse(row.value_json) as string]));
  const companyId = map.get("cloud_company_id") || identity?.companyId || "";
  const unitId = map.get("cloud_unit_id") || identity?.unitId || "";
  const deviceId = map.get("cloud_device_id") || identity?.deviceId || "";
  const deviceToken = map.get("cloud_device_token") || "";
  if (!companyId || !unitId || !deviceId || !deviceToken) {
    throw new Error(
      "Supabase cloud nao configurado. Configure company/unit/device/token do dispositivo."
    );
  }
  return { companyId, unitId, deviceId, deviceToken };
}

function getOperationPayload(
  database: DesktopDatabase,
  operationId: string,
  settings: CloudSettings
): Record<string, unknown> {
  const operation = database
    .prepare(
      `SELECT
    o.*, c.trade_name AS customer_name, v.plate, d.name AS driver_name, p.description AS product_description,
    ca.name AS carrier_name
    FROM weighing_operations o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id
    LEFT JOIN drivers d ON d.id = o.driver_id
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN carriers ca ON ca.id = o.carrier_id
    WHERE o.id = ?`
    )
    .get(operationId) as Record<string, unknown> | undefined;
  if (!operation) throw new Error(`Operation ${operationId} not found`);
  return {
    id: operation.id,
    company_id: settings.companyId,
    unit_id: settings.unitId,
    device_id: resolveCreatorDeviceId(database, operation.device_id, settings),
    status:
      operation.status === "loading_requested" || operation.status === "awaiting_exit"
        ? "open"
        : operation.status,
    operation_type: operation.operation_type,
    // Codigo sequencial da operacao (o que sai no topo do cupom). Vai para a nuvem para a
    // outra balanca da pedreira continuar a sequencia de onde ela parou.
    operation_code: operation.operation_code,
    customer_id: operation.customer_id,
    product_id: operation.product_id,
    // Transportadora: as tres trocas permitidas numa operacao aberta sao
    // produto, cliente e transportadora — sem estas duas colunas a terceira
    // nunca chegava na outra balanca da pedreira.
    carrier_id: operation.carrier_id,
    carrier_name: operation.carrier_name,
    payment_term_id: operation.payment_term_id,
    // Forma de pagamento e o fechamento da carteira: a tela Carteira e da pedreira
    // inteira, entao a venda em carteira feita numa balanca e o fechamento lancado nela
    // precisam chegar as outras. Sem `payment_method_id` na projecao a outra maquina nem
    // sabe que a venda foi em carteira (a classificacao vem de payment_methods.is_wallet).
    payment_method_id: operation.payment_method_id,
    wallet_settlement_method_id: operation.wallet_settlement_method_id,
    wallet_settlement_due_date: operation.wallet_settlement_due_date,
    wallet_settled_at: operation.wallet_settled_at,
    wallet_settlement_note: operation.wallet_settlement_note,
    // Abatimento do adiantamento do cliente: a marca escolhida na entrada (a saida pode
    // ser pesada na outra balanca) e quanto o fechamento consumiu do adiantamento — e o
    // que a Carteira desconta do "a receber" e o que o proximo fechamento nao pode
    // reservar de novo.
    settle_from_advance: Number(operation.settle_from_advance ?? 0) === 1,
    omie_advance_settle_cents: operation.omie_advance_settle_cents ?? 0,
    plate: operation.plate,
    customer_name: operation.customer_name,
    driver_name: operation.driver_name,
    product_description: operation.product_description,
    entry_weight_kg: operation.entry_weight_kg,
    exit_weight_kg: operation.exit_weight_kg,
    net_weight_kg: operation.net_weight_kg,
    unit_price_cents: operation.unit_price_cents,
    base_unit_price_cents: operation.base_unit_price_cents,
    applied_price_table_id: operation.applied_price_table_id,
    applied_price_table_name: operation.applied_price_table_name,
    applied_price_table_item_id: operation.applied_price_table_item_id,
    price_unit: operation.price_unit,
    price_savings_percent: operation.price_savings_percent,
    product_total_cents: operation.product_total_cents,
    freight_total_cents: operation.freight_total_cents,
    // Regra de calculo do frete (tipo, valor base, fixo, minimo, distancia, destino). Vai
    // para a nuvem porque e ela que o FECHAMENTO usa para transformar o peso liquido em
    // valor de frete: sem projeta-la, o pull devolvia a operacao sem regra, apagava a
    // copia local da balanca que registrou a entrada e a saida fechava com frete zero —
    // sem linha FRETE no cupom e sem `valor_frete` no pedido do OMIE. Projetada, a saida
    // tambem pode ser pesada em outra balanca da pedreira sem perder o frete.
    freight_json: operation.freight_json,
    // Modalidade do frete (CIF/FOB/…): o relatorio de vendas do comercial filtra por ela.
    freight_type: getFreightModalityInfo(stringValue(operation.freight_type)).key,
    // Nota de entrega futura que ESTA carga entregou, congelada no fechamento. Projetada
    // para a 2a via poder sair em OUTRA balanca da pedreira citando a mesma nota: sem ela,
    // a segunda maquina reimprimiria o cupom sem a referencia que a NF-e ja carrega.
    future_billing_nfe_number: nullableStringValue(operation.future_billing_nfe_number),
    // QUAL nota essa carga baixou. E o vinculo que o saldo do cadastro soma: sem ele a outra
    // balanca receberia a pesagem e nao saberia de qual das notas do cliente tirar o peso.
    future_billing_invoice_id: nullableStringValue(operation.future_billing_invoice_id),
    total_cents: operation.total_cents,
    omie_sales_order_id: operation.omie_sales_order_id,
    omie_service_order_id: operation.omie_service_order_id,
    cancel_reason: operation.cancel_reason,
    created_at: operation.created_at,
    updated_at: operation.updated_at,
    closed_at: operation.exit_weight_captured_at,
    synced_at: new Date().toISOString()
  };
}

/**
 * Preserva o computador criador da operacao no payload da nuvem. So envia ids
 * que a nuvem conhece: o proprio dispositivo ou um espelho remoto recebido de
 * desktop-status/pull (installation_id 'remote-…'). Ids puramente locais (ex.:
 * "setup-device" do modo emergencia) caem para o dispositivo atual, como antes.
 */
function resolveCreatorDeviceId(
  database: DesktopDatabase,
  value: unknown,
  settings: CloudSettings
): string {
  const raw = stringValue(value);
  if (!raw || raw === settings.deviceId) return settings.deviceId;
  const remote = database
    .prepare("SELECT id FROM devices WHERE id = ? AND installation_id LIKE 'remote-%'")
    .get(raw) as { id: string } | undefined;
  return remote ? remote.id : settings.deviceId;
}

function getLoadingRequestPayload(
  database: DesktopDatabase,
  requestId: string,
  settings: CloudSettings
): Record<string, unknown> & { customer_id: string | null; product_id: string | null } {
  const request = database
    .prepare(
      `SELECT
    lr.*,
    o.entry_weight_kg,
    o.customer_id AS operation_customer_id,
    o.product_id AS operation_product_id
    FROM loading_requests lr
    LEFT JOIN weighing_operations o ON o.id = lr.operation_id
    WHERE lr.id = ?`
    )
    .get(requestId) as
    | (Record<string, unknown> & {
        operation_customer_id: string | null;
        operation_product_id: string | null;
      })
    | undefined;
  if (!request) throw new Error(`Loading request ${requestId} not found`);
  return {
    id: request.id,
    operation_id: request.operation_id,
    company_id: settings.companyId,
    unit_id: settings.unitId,
    status: request.status,
    plate: request.plate,
    customer_name: request.customer_name,
    driver_name: request.driver_name,
    product_description: request.product_description,
    customer_id: request.operation_customer_id ?? null,
    product_id: request.operation_product_id ?? null,
    entry_weight_kg: request.entry_weight_kg,
    created_at: request.created_at,
    updated_at: request.updated_at,
    closed_at: request.closed_at
  };
}

export async function pushOmieCustomersToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { limit?: number; delayMs?: number } = {}
): Promise<{ pushed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const limit = options.limit ?? OMIE_PUSH_CUSTOMER_BATCH_LIMIT;
  const delayMs = options.delayMs ?? OMIE_BATCH_DELAY_MS;

  const pending = database
    .prepare(
      `SELECT id, omie_customer_id, omie_integration_code, legal_name, trade_name, document, phone, email,
              fiscal_emails, zipcode, address_street, address_number, address_complement, neighborhood, city, state,
              default_payment_term_id, omie_billing_blocked, observations
       FROM customers
       WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1 AND source IN ('local', 'hybrid')
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .all(identity.companyId, limit) as Array<{
    id: string;
    omie_customer_id: number | null;
    omie_integration_code: string | null;
    legal_name: string;
    trade_name: string;
    document: string | null;
    phone: string | null;
    email: string | null;
    fiscal_emails: string | null;
    zipcode: string | null;
    address_street: string | null;
    address_number: string | null;
    address_complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    default_payment_term_id: string | null;
    omie_billing_blocked: number;
    observations: string | null;
  }>;

  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];
  const setOmieId = database.prepare(`
    UPDATE customers
    SET omie_customer_id = ?, needs_push = 0, last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), sync_status = 'synced', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  const markSynced = database.prepare(`
    UPDATE customers
    SET needs_push = 0, last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), sync_status = 'synced', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  const markError = database.prepare(`
    UPDATE customers
    SET sync_status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  // Falha deterministica: para de re-tentar (needs_push=0) ate o operador editar o
  // cadastro (o update re-arma needs_push=1).
  const markBlocked = database.prepare(`
    UPDATE customers
    SET sync_status = 'error', needs_push = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);

  for (const [index, customer] of pending.entries()) {
    // O "Cliente Consumidor" e um registro protegido do OMIE: AlterarCliente e sempre
    // rejeitado ("Nao e possivel alterar esse codigo de integracao"). Edicoes locais
    // (ex: e-mail padrao de NF-e) ficam apenas locais — nada a enviar.
    if (isOmieConsumidorIntegrationCode(customer.omie_integration_code)) {
      markSynced.run(customer.id);
      continue;
    }

    // OMIE exige CPF/CNPJ no IncluirCliente. Sem documento valido, nao adianta chamar:
    // bloqueia com mensagem clara ate o operador preencher o documento.
    if (!customer.omie_customer_id && !hasValidCnpjCpf(customer.document)) {
      markBlocked.run(customer.id);
      failed++;
      errors.push(
        `Cliente ${customer.trade_name || customer.legal_name}: sem CPF/CNPJ — o OMIE exige o documento para criar o cadastro. Preencha o documento do cliente para reenviar.`
      );
      continue;
    }

    try {
      const phoneMatch = customer.phone?.match(/\(?(\d{2})\)?\s*(\d+)/);
      const { data, error } = await supabase.functions.invoke<{ omieCustomerId?: number }>(
        "omie-sync",
        {
          body: {
            deviceId: settings.deviceId,
            deviceToken: settings.deviceToken,
            action: "push_customer",
            payload: {
              localCustomerId: customer.id,
              omieCustomerId: customer.omie_customer_id ?? undefined,
              razaoSocial: customer.legal_name,
              nomeFantasia: customer.trade_name || customer.legal_name,
              cnpjCpf: customer.document ?? undefined,
              email: customer.email ?? undefined,
              // String vazia = "sem destinatario de NF-e aqui", e limpa o campo no OMIE;
              // o cadastro local e quem manda nesse campo (ver syncCustomerInvoiceEmails).
              fiscalEmails: customer.fiscal_emails ?? "",
              telefone1Ddd: phoneMatch?.[1] ?? undefined,
              telefone1Numero: phoneMatch?.[2] ?? undefined,
              zipcode: customer.zipcode ?? undefined,
              addressStreet: customer.address_street ?? undefined,
              addressNumber: customer.address_number ?? undefined,
              neighborhood: customer.neighborhood ?? undefined,
              city: customer.city ?? undefined,
              state: customer.state ?? undefined,
              defaultPaymentTermId: customer.default_payment_term_id ?? undefined,
              // Observacoes internas: o KyberRock e quem manda neste campo, entao string
              // vazia LIMPA a observacao no OMIE. Sem enviar, o que a operadora digitava
              // aqui era sobrescrito pela observacao do OMIE na leitura seguinte do
              // cadastro de referencia — sumia ate na propria maquina que digitou.
              observations: customer.observations ?? "",
              billingBlocked: customer.omie_billing_blocked === 1
            }
          }
        }
      );

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }
      if (!data?.omieCustomerId) {
        throw new Error("OMIE nao retornou omieCustomerId");
      }

      if (customer.omie_customer_id) {
        markSynced.run(customer.id);
      } else {
        setOmieId.run(data.omieCustomerId, customer.id);
      }
      // Cliente agora existe no OMIE: os fechamentos que estavam parados por causa dele
      // voltam para a fila e saem nesta mesma passada (a fila roda depois deste push).
      rearmOmieBillingForCustomer(database, customer.id);
      pushed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro OMIE";
      if (isOmieProtectedRecordFault(message)) {
        // Registro que o OMIE nao permite alterar (ex: Cliente Consumidor): mantem o dado
        // local e para de re-tentar — o erro nao aparece mais a cada sincronizacao.
        markSynced.run(customer.id);
      } else if (isOmieMissingDocumentFault(message)) {
        markBlocked.run(customer.id);
        failed++;
        errors.push(
          `Cliente ${customer.trade_name || customer.legal_name}: o OMIE exige CPF/CNPJ. Preencha o documento do cliente para reenviar. Detalhe: ${message}`
        );
      } else {
        markError.run(customer.id);
        failed++;
        errors.push(`Cliente ${customer.id}: ${message}`);
      }
    }

    if (index < pending.length - 1) {
      await sleep(delayMs);
    }
  }

  return { pushed, failed, errors };
}

/**
 * Devolve para a fila OMIE os fechamentos de um cliente que ficaram parados porque ele
 * ainda nao existia no OMIE (ou o cadastro dele foi recusado la). Roda logo depois do
 * cliente entrar no OMIE — pelo cadastro ou pelo proprio envio de outro fechamento — e:
 *
 * - reconstroi o payload do job com `buildOmieBillingJob` (agora com o codigo OMIE do
 *   cliente, e nao mais so o cadastro embutido);
 * - devolve o job para 'pending' com o backoff zerado, mantendo a MESMA chave de
 *   idempotencia (o OMIE reaproveita o pedido/OS, nunca duplica);
 * - enfileira o job de operacoes que fecharam sem job nenhum (cliente sem CNPJ/CPF no
 *   fechamento: naquele momento nao havia o que enviar);
 * - limpa o 'cadastro_incompleto' da operacao para ela sair do estado de pendencia.
 *
 * Como `pushOmieCustomersToCloud` roda ANTES de `processOmieSyncQueue` no ciclo do OMIE,
 * o fechamento sai sozinho na mesma passada — sem o operador ter que clicar em
 * "Refaturar"/"Reenviar". Retorna quantas operacoes foram rearmadas.
 */
export function rearmOmieBillingForCustomer(
  database: DesktopDatabase,
  customerId: string,
  now: Date = new Date()
): number {
  if (!customerId) return 0;

  const operations = database
    .prepare(
      `SELECT o.id
         FROM weighing_operations o
        WHERE o.customer_id = ?
          AND o.status NOT IN ('cancelled', 'synced')
          AND o.exit_weight_captured_at IS NOT NULL
          AND o.omie_sales_order_id IS NULL
          AND o.omie_service_order_id IS NULL`
    )
    .all(customerId) as Array<{ id: string }>;

  const nowIso = now.toISOString();
  let rearmed = 0;

  for (const operation of operations) {
    const built = buildOmieBillingJob(database, operation.id);
    // Ainda sem o que enviar (cliente sem codigo OMIE e sem documento): segue pendente.
    if (!built) continue;

    enqueueOmieBillingJob(database, operation.id, built, now);
    const updated = database
      .prepare(
        `UPDATE sync_queue
            SET status = 'pending',
                attempt_count = 0,
                payload_json = ?,
                next_attempt_at = ?,
                updated_at = ?
          WHERE target = 'omie'
            AND idempotency_key = ?
            AND status IN ('pending', 'failed', 'dead_letter')`
      )
      .run(JSON.stringify(built.payload), nowIso, nowIso, built.idempotencyKey);
    if (updated.changes === 0) continue;

    database
      .prepare(
        `UPDATE weighing_operations
            SET omie_billing_status = NULL,
                omie_billing_message = ?,
                updated_at = ?
          WHERE id = ? AND omie_billing_status = 'cadastro_incompleto'`
      )
      .run(
        "Cliente cadastrado no OMIE. O fechamento sera reenviado na sincronizacao.",
        nowIso,
        operation.id
      );
    rearmed++;
  }

  return rearmed;
}

// Codigo de integracao do consumidor final padrao do OMIE (registro protegido).
function isOmieConsumidorIntegrationCode(code: string | null): boolean {
  return (code ?? "").trim().toUpperCase() === "CONSUMIDOR";
}

// OMIE exige CPF (11 digitos) ou CNPJ (14 posicoes, numerico ou alfanumerico) para
// incluir cliente/transportadora.
function hasValidCnpjCpf(document: string | null): boolean {
  return documentKind(document ?? "") !== null;
}

export async function pushOmieCarriersToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { limit?: number; delayMs?: number } = {}
): Promise<{ pushed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const limit = options.limit ?? OMIE_PUSH_CUSTOMER_BATCH_LIMIT;
  const delayMs = options.delayMs ?? OMIE_BATCH_DELAY_MS;

  const pending = database
    .prepare(
      `SELECT id, omie_customer_id, name, document, phone, email,
              zipcode, address_street, address_number, address_complement, neighborhood, city, state
       FROM carriers
       WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1 AND source = 'local'
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .all(identity.companyId, limit) as Array<{
    id: string;
    omie_customer_id: number | null;
    name: string;
    document: string | null;
    phone: string | null;
    email: string | null;
    zipcode: string | null;
    address_street: string | null;
    address_number: string | null;
    address_complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
  }>;

  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];
  const setOmieId = database.prepare(`
    UPDATE carriers
    SET omie_customer_id = ?, needs_push = 0, last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), sync_status = 'synced', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  const markSynced = database.prepare(`
    UPDATE carriers
    SET needs_push = 0, last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), sync_status = 'synced', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  const markError = database.prepare(`
    UPDATE carriers
    SET sync_status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  // Falha deterministica: para de re-tentar (needs_push=0) ate o operador editar a
  // transportadora (o update re-arma needs_push=1).
  const markBlocked = database.prepare(`
    UPDATE carriers
    SET sync_status = 'error', needs_push = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);

  for (const [index, carrier] of pending.entries()) {
    // OMIE exige CPF/CNPJ no IncluirCliente. Sem documento valido, nao adianta chamar:
    // bloqueia com mensagem clara ate o operador preencher o documento.
    if (!carrier.omie_customer_id && !hasValidCnpjCpf(carrier.document)) {
      markBlocked.run(carrier.id);
      failed++;
      errors.push(
        `Transportadora ${carrier.name}: sem CPF/CNPJ — o OMIE exige o documento para criar o cadastro. Preencha o documento da transportadora para reenviar.`
      );
      continue;
    }

    try {
      const phoneMatch = carrier.phone?.match(/\(?(\d{2})\)?\s*(\d+)/);
      const { data, error } = await supabase.functions.invoke<{ omieCustomerId?: number }>(
        "omie-sync",
        {
          body: {
            deviceId: settings.deviceId,
            deviceToken: settings.deviceToken,
            // Transportadora vai pela acao propria: o `push_customer` monta o cadastro com
            // a tag "cliente" (e o que ele faz por definicao), entao a transportadora
            // enviada por ele nascia marcada tambem como cliente no OMIE e voltava na
            // sincronizacao seguinte para a lista de clientes da balanca. O `push_carrier`
            // grava so a tag "transportadora".
            action: "push_carrier",
            payload: {
              localCustomerId: `carrier:${carrier.id}`,
              omieCustomerId: carrier.omie_customer_id ?? undefined,
              name: carrier.name,
              cnpjCpf: carrier.document ?? undefined,
              email: carrier.email ?? undefined,
              telefone1Ddd: phoneMatch?.[1] ?? undefined,
              telefone1Numero: phoneMatch?.[2] ?? undefined,
              zipcode: carrier.zipcode ?? undefined,
              addressStreet: carrier.address_street ?? undefined,
              addressNumber: carrier.address_number ?? undefined,
              neighborhood: carrier.neighborhood ?? undefined,
              city: carrier.city ?? undefined,
              state: carrier.state ?? undefined
            }
          }
        }
      );

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }
      if (!data?.omieCustomerId) {
        throw new Error("OMIE nao retornou omieCustomerId");
      }

      if (carrier.omie_customer_id) {
        markSynced.run(carrier.id);
      } else {
        setOmieId.run(data.omieCustomerId, carrier.id);
      }
      pushed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro OMIE";
      if (isOmieProtectedRecordFault(message)) {
        // Registro que o OMIE nao permite alterar: mantem o dado local e para de re-tentar.
        markSynced.run(carrier.id);
      } else if (isOmieMissingDocumentFault(message)) {
        markBlocked.run(carrier.id);
        failed++;
        errors.push(
          `Transportadora ${carrier.name}: o OMIE exige CPF/CNPJ. Preencha o documento da transportadora para reenviar. Detalhe: ${message}`
        );
      } else {
        markError.run(carrier.id);
        failed++;
        errors.push(`Transportadora ${carrier.id}: ${message}`);
      }
    }

    if (index < pending.length - 1) {
      await sleep(delayMs);
    }
  }

  return { pushed, failed, errors };
}

function getPrintReceiptPayload(
  database: DesktopDatabase,
  receiptId: string,
  settings: CloudSettings
): Record<string, unknown> {
  const receipt = database.prepare("SELECT * FROM print_receipts WHERE id = ?").get(receiptId) as
    | Record<string, unknown>
    | undefined;
  if (!receipt) throw new Error(`Print receipt ${receiptId} not found`);
  return {
    id: receipt.id,
    operation_id: receipt.operation_id,
    unit_id: settings.unitId,
    receipt_number: receipt.receipt_number,
    device_number: integerValue(receipt.device_number),
    copy_number: receipt.copy_number,
    content_snapshot_json: parseJsonValue(receipt.content_snapshot_json),
    printed_at: receipt.printed_at,
    printer_name: receipt.printer_name,
    status: receipt.status,
    error_message: receipt.error_message,
    created_at: receipt.created_at,
    updated_at: receipt.updated_at
  };
}

function getOperationForReceipt(
  database: DesktopDatabase,
  receiptId: string
): { customer_id: string | null; product_id: string | null } | null {
  const row = database
    .prepare(
      `SELECT o.customer_id, o.product_id
       FROM print_receipts pr
       JOIN weighing_operations o ON o.id = pr.operation_id
       WHERE pr.id = ?`
    )
    .get(receiptId) as { customer_id: string | null; product_id: string | null } | undefined;
  return row ?? null;
}

function getCustomerPayload(
  database: DesktopDatabase,
  customerId: string,
  companyId: string
): Record<string, unknown> | null {
  const customer = database.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
    | Record<string, unknown>
    | undefined;
  if (!customer) return null;
  return {
    id: String(customer.id),
    company_id: companyId,
    omie_customer_id: customer.omie_customer_id ?? null,
    omie_integration_code: customer.omie_integration_code ?? null,
    legal_name: customer.legal_name,
    trade_name: customer.trade_name,
    document: customer.document ?? null,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    credit_limit_cents: customer.credit_limit_cents ?? null,
    open_receivables_cents: customer.open_receivables_cents ?? 0,
    is_active: Boolean(customer.is_active ?? true),
    default_payment_term_id: customer.default_payment_term_id ?? null,
    updated_at: new Date().toISOString()
  };
}

function getProductPayload(
  database: DesktopDatabase,
  productId: string,
  companyId: string
): Record<string, unknown> | null {
  const product = database.prepare("SELECT * FROM products WHERE id = ?").get(productId) as
    | Record<string, unknown>
    | undefined;
  if (!product) return null;
  return {
    id: String(product.id),
    company_id: companyId,
    omie_product_id: product.omie_product_id ?? null,
    code: product.code,
    description: product.description,
    unit: product.unit,
    is_active: Boolean(product.is_active ?? true),
    updated_at: new Date().toISOString()
  };
}

function collectCloudSyncDependencies(
  database: DesktopDatabase,
  references: { customer_id?: string | null; product_id?: string | null }
): { customers: Record<string, unknown>[]; products: Record<string, unknown>[] } {
  const companyId = readLocalSetting<string>(database, "cloud_company_id");
  const customers: Record<string, unknown>[] = [];
  const products: Record<string, unknown>[] = [];

  if (!companyId) {
    return { customers, products };
  }

  if (references.customer_id) {
    const customer = getCustomerPayload(database, references.customer_id, companyId);
    if (customer) customers.push(customer);
  }
  if (references.product_id) {
    const product = getProductPayload(database, references.product_id, companyId);
    if (product) products.push(product);
  }

  return { customers, products };
}

function getPayloadId(payload: unknown, key: string, fallback: string): string {
  if (payload && typeof payload === "object" && key in payload) {
    return String((payload as Record<string, unknown>)[key] ?? fallback);
  }
  return fallback;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function reconcileCancelledAfterCreate(
  database: DesktopDatabase,
  operationId: string,
  orderId: number,
  operationType: "invoice" | "internal"
): void {
  const row = database
    .prepare("SELECT status, cancel_reason FROM weighing_operations WHERE id = ?")
    .get(operationId) as { status: string; cancel_reason: string | null } | undefined;
  if (!row || row.status !== "cancelled") return;

  // O update de sucesso do create sobrescreveu o status; devolve para 'cancelled'.
  database
    .prepare(
      "UPDATE weighing_operations SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    )
    .run(operationId);

  enqueueSyncJob(database, {
    target: "omie",
    action: "cancel_order",
    entityType: "weighing_operation",
    entityId: operationId,
    idempotencyKey: `omie:cancel:${operationId}`,
    payload: {
      operationId,
      orderType: operationType === "invoice" ? "sales" : "service",
      omieOrderId: orderId,
      reason: row.cancel_reason ?? "Operacao cancelada localmente."
    }
  });
}

/**
 * Enfileira a baixa do adiantamento no OMIE para a operacao, quando ela consumiu
 * dinheiro que o cliente ja tinha depositado la. Idempotente: a chave e a propria
 * operacao, entao um segundo envio do pedido nao cria uma segunda baixa.
 */
function enqueueAdvanceSettlementJob(
  database: DesktopDatabase,
  input: {
    operationId: string;
    customerOmieId?: number | null;
    omieOrderId: number;
    issueDate?: string;
  }
): void {
  const row = database
    .prepare(
      `SELECT omie_advance_settle_cents, omie_advance_settled_cents, status
       FROM weighing_operations WHERE id = ?`
    )
    .get(input.operationId) as
    | {
        omie_advance_settle_cents: number | null;
        omie_advance_settled_cents: number | null;
        status: string;
      }
    | undefined;
  if (!row || row.status === "cancelled") return;

  const pendingCents = (row.omie_advance_settle_cents ?? 0) - (row.omie_advance_settled_cents ?? 0);
  if (pendingCents <= 0) return;
  if (!input.customerOmieId || input.customerOmieId <= 0) return;

  const advanceConfig = readOmieAdvanceConfig(database);
  enqueueSyncJob(database, {
    target: "omie",
    action: "settle_advance",
    entityType: "weighing_operation",
    entityId: input.operationId,
    idempotencyKey: `omie:settle_advance:${input.operationId}`,
    payload: {
      operationId: input.operationId,
      customerOmieId: input.customerOmieId,
      omieOrderId: input.omieOrderId,
      amountCents: pendingCents,
      issueDate: input.issueDate,
      advanceAccountCode: advanceConfig.accountCode ?? undefined
    }
  });
}

/**
 * Baixa no OMIE o adiantamento consumido pela operacao. O titulo do pedido pode
 * demorar a existir (faturamento recem-enviado): nesse caso o job volta para a
 * fila em vez de dar a operacao como amortizada.
 */
async function processOmieAdvanceSettlementJob(
  database: DesktopDatabase,
  supabase: SupabaseClient,
  settings: CloudSettings,
  job: { id: string; idempotencyKey: string; payload: unknown }
): Promise<{ status: "processed" | "failed"; error?: string }> {
  const payload = job.payload as {
    operationId: string;
    customerOmieId: number;
    omieOrderId: number;
    amountCents: number;
    issueDate?: string;
    advanceAccountCode?: number;
  };

  try {
    const { data, error } = await supabase.functions.invoke<{
      settledCents?: number;
      titles?: Array<{ titleId: number; amountCents: number }>;
      advanceAccountCode?: number | null;
      pendingReceivable?: boolean;
      message?: string | null;
    }>("omie-sync", {
      body: {
        deviceId: settings.deviceId,
        deviceToken: settings.deviceToken,
        action: "settle_advance",
        payload: {
          localOperationId: payload.operationId,
          customerOmieId: payload.customerOmieId,
          omieOrderId: payload.omieOrderId,
          amountCents: payload.amountCents,
          issueDate: payload.issueDate,
          advanceAccountCode: payload.advanceAccountCode,
          idempotencyKey: job.idempotencyKey
        }
      }
    });

    if (error) throw new Error(await getFunctionErrorMessage(error));
    if (!data) throw new Error("Resposta OMIE vazia.");

    if (data.advanceAccountCode) {
      rememberDetectedAdvanceConfig(database, { accountCode: data.advanceAccountCode });
    }

    if (data.pendingReceivable) {
      const message = data.message ?? "Pedido ainda sem titulo a receber no OMIE.";
      updateOperationAdvanceSettlement(database, payload.operationId, {
        settledCents: 0,
        status: "pending",
        message
      });
      markSyncJobFailed(database, job.id, message);
      return { status: "failed", error: message };
    }

    const settledCents = data.settledCents ?? 0;
    const totalSettled = updateOperationAdvanceSettlement(database, payload.operationId, {
      settledCents,
      status: "settled",
      message: data.message ?? null
    });
    markSyncJobDone(database, job.id);
    // Baixa parcial (os titulos do pedido nao cobriram tudo): o restante fica
    // registrado na operacao para o financeiro ver, sem novo job em loop.
    if (totalSettled.pendingCents > 0) {
      updateOperationAdvanceSettlement(database, payload.operationId, {
        settledCents: 0,
        status: "partial",
        message:
          data.message ??
          `Faltou baixar R$ ${(totalSettled.pendingCents / 100).toFixed(2)} do adiantamento no OMIE.`
      });
    }
    return { status: "processed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro OMIE";
    updateOperationAdvanceSettlement(database, payload.operationId, {
      settledCents: 0,
      status: "error",
      message
    });
    markSyncJobFailed(database, job.id, message);
    return { status: "failed", error: message };
  }
}

/** Soma o baixado na operacao e devolve o que ainda falta amortizar. */
function updateOperationAdvanceSettlement(
  database: DesktopDatabase,
  operationId: string,
  input: { settledCents: number; status: string; message: string | null }
): { pendingCents: number } {
  database
    .prepare(
      `UPDATE weighing_operations
         SET omie_advance_settled_cents = omie_advance_settled_cents + ?,
             omie_advance_status = ?,
             omie_advance_message = ?,
             omie_advance_settled_at = CASE WHEN ? > 0
               THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE omie_advance_settled_at END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(input.settledCents, input.status, input.message, input.settledCents, operationId);

  const row = database
    .prepare(
      `SELECT omie_advance_settle_cents, omie_advance_settled_cents
       FROM weighing_operations WHERE id = ?`
    )
    .get(operationId) as
    | { omie_advance_settle_cents: number | null; omie_advance_settled_cents: number | null }
    | undefined;
  return {
    pendingCents: Math.max(
      0,
      (row?.omie_advance_settle_cents ?? 0) - (row?.omie_advance_settled_cents ?? 0)
    )
  };
}

async function processOmieCancelJob(
  database: DesktopDatabase,
  supabase: SupabaseClient,
  settings: CloudSettings,
  job: { id: string; payload: unknown }
): Promise<"processed" | "failed"> {
  const payload = job.payload as {
    operationId: string;
    orderType: "sales" | "service";
    omieOrderId: number;
    reason?: string;
  };

  try {
    const { data, error } = await supabase.functions.invoke<{
      cancelled?: boolean;
      alreadyCancelled?: boolean;
      blocked?: boolean;
      blockedReason?: string | null;
    }>("omie-sync", {
      body: {
        deviceId: settings.deviceId,
        deviceToken: settings.deviceToken,
        action: "cancel_order",
        payload: {
          operationId: payload.operationId,
          orderType: payload.orderType,
          omieOrderId: payload.omieOrderId,
          reason: payload.reason
        }
      }
    });

    if (error) {
      throw new Error(await getFunctionErrorMessage(error));
    }

    if (data?.blocked) {
      // Pedido faturado ou em estado que impede exclusao: mantem operacao cancelada
      // localmente com o erro visivel, sem retry (docs/phase-1/sync-strategy.md).
      database
        .prepare(
          `UPDATE weighing_operations
           SET omie_billing_status = 'cancel_blocked',
               omie_billing_message = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`
        )
        .run(data.blockedReason ?? "Cancelamento negado pelo OMIE.", payload.operationId);
      markSyncJobDone(database, job.id);
      return "processed";
    }

    // cancelled ou alreadyCancelled: registra o cancelamento no OMIE.
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'cancelled_in_omie',
             omie_billing_message = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(
        data?.alreadyCancelled ? "Pedido ja nao existia no OMIE." : "Pedido cancelado no OMIE.",
        payload.operationId
      );
    markSyncJobDone(database, job.id);
    return "processed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro OMIE";
    markSyncJobFailed(database, job.id, message);
    return "failed";
  }
}

export async function processOmieSyncQueue(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { limit?: number; delayMs?: number; entityId?: string } = {}
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const limit = options.limit ?? OMIE_QUEUE_BATCH_LIMIT;
  const delayMs = options.delayMs ?? OMIE_BATCH_DELAY_MS;
  // entityId: processa apenas os jobs de uma operacao especifica — usado pelo envio
  // imediato pos-fechamento, sem esperar (nem concorrer com) a varredura completa.
  const jobs = listRunnableSyncJobs(database, {
    target: "omie",
    entityId: options.entityId,
    limit
  });
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const [index, job] of jobs.entries()) {
    if (job.action === "cancel_order") {
      const outcome = await processOmieCancelJob(database, supabase, settings, job);
      if (outcome === "processed") processed++;
      else {
        failed++;
        errors.push(`Job ${job.id}: falha ao cancelar pedido OMIE`);
      }
      if (index < jobs.length - 1) {
        await sleep(delayMs);
      }
      continue;
    }

    if (job.action === "settle_advance") {
      const outcome = await processOmieAdvanceSettlementJob(database, supabase, settings, job);
      if (outcome.status === "processed") processed++;
      else {
        failed++;
        errors.push(`Job ${job.id}: ${outcome.error}`);
      }
      if (index < jobs.length - 1) {
        await sleep(delayMs);
      }
      continue;
    }

    const payload = job.payload as {
      operationId: string;
      operationCode?: number | null;
      operationType: "invoice" | "internal";
      customerOmieId: number;
      localCustomerId?: string | null;
      customer?: Record<string, unknown> | null;
      productOmieId?: number | null;
      serviceDescription?: string | null;
      quantity: number;
      unitPrice: number;
      freightTotalCents?: number;
      freightModalidade?: string | null;
      issueDate: string;
      paymentTermOmieCode?: string | null;
      paymentTermInstallmentCount?: number | null;
      paymentTermInstallmentDays?: number[] | null;
      paymentMethodOmieCode?: string | null;
      accountOmieCode?: string | null;
      accountName?: string | null;
      omieCategoryCode?: string | null;
      transport?: {
        plate?: string | null;
        /** UF de emplacamento (`placa_estado` do bloco frete da NF-e). */
        plateState?: string | null;
        driverName?: string | null;
        carrierOmieId?: number | null;
        carrierName?: string | null;
        cargoWeightKg?: number | null;
        ownVehicle?: boolean;
      } | null;
      localCarrierId?: string | null;
      carrier?: Record<string, unknown> | null;
      invoiceEmails?: string;
      futureBillingNfeNumber?: string;
    };

    try {
      const bridgeAction =
        job.action === "create_and_bill_order" ? "create_and_bill_order" : "create_order";
      const { data, error } = await supabase.functions.invoke<{
        orderId?: number;
        orderNumber?: string | null;
        omieCustomerId?: number;
        omieCarrierId?: number;
        billed?: boolean;
        billingStatusCode?: string | null;
        billingStatusMessage?: string | null;
        /**
         * Numero da NOTA, quando o faturamento pela propria fila ja o devolve.
         *
         * Nao estava declarado aqui e por isso era descartado: a pesagem faturada por ESTE
         * caminho nascia "Faturada" com a coluna "Nota fiscal" vazia, e so ganhava o numero
         * quando a conferencia de fundo chegasse a vez dela — dias depois, ou nunca, quando
         * a janela de 120 dias passava antes.
         */
        invoiceNumber?: string | null;
        documentUrl?: string | null;
      }>("omie-sync", {
        body: {
          deviceId: settings.deviceId,
          deviceToken: settings.deviceToken,
          action: bridgeAction,
          payload: {
            // Id da operacao local: vai nos dados adicionais do pedido/OS para
            // reconciliar o registro do OMIE com a pesagem que o originou.
            localOperationId: payload.operationId,
            // Codigo sequencial da pesagem (000123): e a referencia LEGIVEL nos dados
            // adicionais do pedido/OS — o UUID acima nao serve para ninguem procurar.
            operationCode: payload.operationCode ?? undefined,
            operationType: payload.operationType,
            customerOmieId: payload.customerOmieId,
            customer: payload.customer ?? undefined,
            productOmieId: payload.productOmieId ?? undefined,
            serviceDescription: payload.serviceDescription ?? undefined,
            quantity: payload.quantity,
            unitPrice: payload.unitPrice,
            freightTotalCents: payload.freightTotalCents,
            freightModalidade: payload.freightModalidade ?? undefined,
            issueDate: payload.issueDate,
            paymentTermOmieCode: payload.paymentTermOmieCode ?? undefined,
            installmentCount: payload.paymentTermInstallmentCount ?? undefined,
            installmentDays: payload.paymentTermInstallmentDays ?? undefined,
            paymentMethodOmieCode: payload.paymentMethodOmieCode ?? undefined,
            accountOmieCode: payload.accountOmieCode ?? undefined,
            accountName: payload.accountName ?? undefined,
            omieCategoryCode: payload.omieCategoryCode ?? undefined,
            transport: payload.transport ?? undefined,
            carrier: payload.carrier ?? undefined,
            // Destinatarios da NF DESTE documento (aba Fiscal do cliente). O fechamento
            // sempre montou o campo, mas ele nunca era copiado para ca: o edge so recebia
            // a aba Fiscal por dentro do bloco `customer`, que ele ignora quando o cliente
            // ja tem codigo OMIE — ou seja, no cliente ja sincronizado a lista de e-mails
            // do pedido nascia vazia mesmo com a aba Fiscal preenchida.
            invoiceEmails: payload.invoiceEmails || undefined,
            // Nota de entrega futura que esta carga esta entregando: o edge a coloca na
            // frente dos dados adicionais da NF. Vazio = sem entrega futura em aberto.
            futureBillingNfeNumber: payload.futureBillingNfeNumber || undefined,
            idempotencyKey: job.idempotencyKey
          }
        }
      });

      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }
      if (!data?.orderId) {
        throw new Error("OMIE nao retornou orderId");
      }

      // Cliente cadastrado no OMIE na hora do envio: grava o codigo devolvido no cadastro
      // local para os proximos pedidos ja irem vinculados (e nao recriarem o cliente).
      // Tambem vale quando o envio CORRIGIU um codigo obsoleto (o OMIE recusou o codigo
      // que mandamos e o edge refez o vinculo): sem regravar, o proximo fechamento do
      // mesmo cliente repetiria a recusa com o mesmo codigo invalido.
      if (
        data.omieCustomerId &&
        payload.localCustomerId &&
        data.omieCustomerId !== payload.customerOmieId
      ) {
        database
          .prepare(
            `UPDATE customers
             SET omie_customer_id = ?, needs_push = 0, sync_status = 'synced', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ? AND (omie_customer_id IS NULL OR omie_customer_id = 0 OR omie_customer_id = ?)`
          )
          .run(data.omieCustomerId, payload.localCustomerId, payload.customerOmieId ?? 0);
      }

      // Transportadora cadastrada no OMIE na hora do envio: grava o codigo devolvido para
      // os proximos pedidos ja irem vinculados (e nao recriarem a transportadora) — e,
      // como no cliente, corrige o codigo local quando ele nao existia mais no OMIE.
      if (
        data.omieCarrierId &&
        payload.localCarrierId &&
        data.omieCarrierId !== payload.transport?.carrierOmieId
      ) {
        database
          .prepare(
            `UPDATE carriers
             SET omie_customer_id = ?, needs_push = 0, sync_status = 'synced', last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ? AND (omie_customer_id IS NULL OR omie_customer_id = 0 OR omie_customer_id = ?)`
          )
          .run(data.omieCarrierId, payload.localCarrierId, payload.transport?.carrierOmieId ?? 0);
      }

      // Numero visivel do documento no OMIE, quando a inclusao ja o devolveu (a OS
      // devolve; o pedido de venda quase nunca). COALESCE porque um reenvio que volte
      // sem o numero nao pode apagar o que a reconciliacao ja tinha descoberto.
      const orderNumber = (data.orderNumber ?? "").trim() || null;
      const updateSql =
        payload.operationType === "invoice"
          ? `UPDATE weighing_operations
           SET omie_sales_order_id = ?,
               omie_order_number = COALESCE(?, omie_order_number),
               omie_billing_status = CASE WHEN ? THEN 'billed' ELSE omie_billing_status END,
               omie_billing_message = CASE WHEN ? THEN ? ELSE omie_billing_message END,
               omie_billed_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE omie_billed_at END,
               omie_invoice_number = COALESCE(?, omie_invoice_number),
               omie_document_url = COALESCE(?, omie_document_url),
               status = 'synced',
               omie_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`
          : // Operacao interna: guarda o nCodOS e registra o estado do envio, para a OS
            // aparecer na tela de concluidas como o pedido aparece na venda com nota.
            `UPDATE weighing_operations
             SET omie_service_order_id = ?,
                 omie_order_number = COALESCE(?, omie_order_number),
                 omie_billing_status = 'service_order_created',
                 omie_billing_message = ?,
                 status = 'synced',
                 omie_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?`;

      if (payload.operationType === "invoice") {
        const billed = data.billed === true;
        database
          .prepare(updateSql)
          .run(
            data.orderId,
            orderNumber,
            billed ? 1 : 0,
            billed ? 1 : 0,
            data.billingStatusMessage ?? "Pedido faturado no OMIE.",
            billed ? 1 : 0,
            (data.invoiceNumber ?? "").trim() || null,
            data.documentUrl ?? null,
            payload.operationId
          );
      } else {
        database
          .prepare(updateSql)
          .run(
            data.orderId,
            orderNumber,
            `Ordem de servico ${data.orderId} criada no OMIE na etapa "Faturar".`,
            payload.operationId
          );
      }
      // Pedido/OS criado depois de uma recusa: o marcador da falha anterior ficaria
      // gravado na operacao (o UPDATE acima so mexe em status/mensagem quando o OMIE
      // fatura). Limita-se aos estados de falha — 'billed' e os de cancelamento nao
      // sao tocados.
      database
        .prepare(
          `UPDATE weighing_operations
             SET omie_billing_status = NULL, omie_billing_message = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?
             AND omie_billing_status IN ('failed', 'cadastro_incompleto', 'service_order_failed',
                                         '${OMIE_BILLING_STATUS_MISSING}')`
        )
        .run(payload.operationId);
      markSyncJobDone(database, job.id);
      // Cliente criado no OMIE agora (customerOmieId devolvido pelo envio): os OUTROS
      // fechamentos dele que pararam por isso voltam para a fila. Depois do markSyncJobDone
      // de proposito, para nunca reabrir o job que acabou de ser concluido.
      if (data.omieCustomerId && payload.localCustomerId) {
        rearmOmieBillingForCustomer(database, payload.localCustomerId);
      }
      // Compra paga com adiantamento: agora que o pedido existe (e, na venda com
      // nota, ja foi faturado), o titulo gerado no OMIE pode ser baixado contra a
      // conta de adiantamentos — e o saldo cai la como caiu aqui.
      enqueueAdvanceSettlementJob(database, {
        operationId: payload.operationId,
        customerOmieId: data.omieCustomerId ?? payload.customerOmieId,
        omieOrderId: data.orderId,
        issueDate: payload.issueDate
      });
      // Corrida create x cancel: se a operacao foi cancelada localmente enquanto o pedido
      // era criado, o update acima marcou 'synced' por engano. Restaura o cancelamento e
      // solicita o cancelamento do pedido recem-criado no OMIE.
      reconcileCancelledAfterCreate(
        database,
        payload.operationId,
        data.orderId,
        payload.operationType
      );
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro OMIE";
      // "Cliente nao cadastrado para o Codigo [...]": o codigo OMIE gravado no cadastro
      // local nao existe (mais) la — cliente excluido no OMIE, codigo de outra conta,
      // importacao antiga. Re-tentar so repete a recusa com o mesmo codigo invalido (era
      // exatamente isso que enchia a fila de fechamentos mortos). Limpa o vinculo podre e
      // devolve o cliente para a fila de cadastro: no proximo ciclo ele entra no OMIE com
      // um codigo valido e rearmOmieBillingForCustomer reenvia o fechamento sozinho.
      if (isOmieStaleCustomerCodeFault(message)) {
        markSyncJobBlocked(database, job.id, message);
        database
          .prepare(
            `UPDATE weighing_operations
             SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?`
          )
          .run(message, payload.operationId);
        if (payload.localCustomerId) {
          database
            .prepare(
              `UPDATE customers
               SET omie_customer_id = NULL, needs_push = 1, sync_status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ? AND omie_customer_id = ?`
            )
            .run(payload.localCustomerId, payload.customerOmieId ?? 0);
        }
        failed++;
        errors.push(`Job ${job.id}: ${message}`);
        if (index < jobs.length - 1) {
          await sleep(delayMs);
        }
        continue;
      }
      // O OMIE recusou o CADASTRO do cliente (ele ainda nao existe la e o IncluirCliente
      // foi rejeitado — campo obrigatorio faltando, documento invalido...). Deterministico:
      // bloqueia o job (sem retry storm) e mostra na operacao o que falta preencher. Vale
      // para os dois tipos de operacao. Quando o cliente entrar no OMIE, o job volta
      // sozinho para a fila (rearmOmieBillingForCustomer) e o fechamento sai automatico.
      if (isOmieCustomerRegistrationFault(message)) {
        markSyncJobBlocked(database, job.id, message);
        database
          .prepare(
            `UPDATE weighing_operations
             SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?`
          )
          .run(message, payload.operationId);
        // Re-arma o envio do cadastro: assim que o cliente for aceito pelo OMIE (aqui ou
        // depois de o operador completar o cadastro), o fechamento e reenviado sozinho.
        if (payload.localCustomerId) {
          database
            .prepare(
              `UPDATE customers
               SET needs_push = 1, sync_status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ? AND (omie_customer_id IS NULL OR omie_customer_id = 0)`
            )
            .run(payload.localCustomerId);
        }
        failed++;
        errors.push(`Job ${job.id}: ${message}`);
        if (index < jobs.length - 1) {
          await sleep(delayMs);
        }
        continue;
      }
      // Falha deterministica de cadastro/NF-e no faturamento: bloqueia (para o retry storm de
      // ~10x/min) e marca a pendencia na operacao. Continua re-executavel via processFiscalBillingNow.
      if (job.action === "create_and_bill_order" && isCadastroIncompleteFault(message)) {
        markSyncJobBlocked(database, job.id, message);
        const blockedOperationId = (job.payload as { operationId?: string })?.operationId;
        if (blockedOperationId) {
          database
            .prepare(
              `UPDATE weighing_operations
               SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?`
            )
            .run(message, blockedOperationId);
        }
        failed++;
        // Pendencia de cadastro, nao erro de sincronizacao: orienta a correcao e avisa
        // que nao havera novas tentativas automaticas (o job fica bloqueado).
        errors.push(
          `Job ${job.id}: faturamento pausado por cadastro incompleto do cliente ` +
            `(corrija no cadastro/portal OMIE e refature pela operacao). Detalhe OMIE: ${message}`
        );
        if (index < jobs.length - 1) {
          await sleep(delayMs);
        }
        continue;
      }
      markSyncJobFailed(database, job.id, message);
      // A operacao interna nao tem tela de faturamento para explicar a falha: sem isto,
      // uma OS recusada pelo OMIE sumia (a operacao continuava "fechada" e nada indicava
      // que ela nunca chegou la). Registra o erro na propria operacao.
      if (payload.operationType !== "invoice") {
        database
          .prepare(
            `UPDATE weighing_operations
             SET omie_billing_status = 'service_order_failed', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?`
          )
          .run(message, payload.operationId);
      } else {
        // A venda com nota ficava MUDA numa recusa que a classificacao nao reconhece
        // (erro de rede, 5xx, campo que o edge nao prefixou): o motivo ia so para o job
        // do sync_queue, e a tela de Concluidas le a operacao — entao o fechamento
        // seguia exibindo "sera enviado na proxima sincronizacao" ate morrer em
        // dead_letter sem ninguem ficar sabendo. Grava o motivo real na operacao.
        //
        // O status 'failed' (vermelho + aviso sonoro + botao de reenvio) so entra quando
        // as tentativas automaticas ACABARAM: e o unico momento em que o envio parou de
        // andar sozinho e precisa do operador. Enquanto ha tentativa sobrando, a operacao
        // continua neutra — so ganha o motivo da ultima recusa.
        const exhausted = getSyncJobById(database, job.id)?.status === "dead_letter";
        database
          .prepare(
            `UPDATE weighing_operations
             SET omie_billing_status = CASE WHEN ? THEN 'failed' ELSE omie_billing_status END,
                 omie_billing_message = ?,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?`
          )
          .run(exhausted ? 1 : 0, message, payload.operationId);
      }
      failed++;
      errors.push(`Job ${job.id}: ${message}`);
    }

    if (index < jobs.length - 1) {
      await sleep(delayMs);
    }
  }

  return { processed, failed, errors };
}

/**
 * Quantas pesagens uma passada confere no OMIE.
 *
 * Era 40, quando cada pesagem custava uma consulta e cada consulta custava 3 segundos de
 * fila (a MESMA fila do envio dos fechamentos). O edge agora confere pela LISTAGEM — 100
 * documentos por chamada —, entao o lote cobre o movimento de um dia inteiro de uma vez:
 * o dia fecha conferido em vez de ir sendo alcancado aos poucos.
 */
const OMIE_BILLING_CHECK_BATCH = 300;

/**
 * Ate quantos dias para tras a reconciliacao olha. Pedido que passou meses sem ser
 * faturado nao vai ser faturado agora, e cada consulta desperdicada e uma que faltou para
 * o movimento do mes.
 */
const OMIE_BILLING_CHECK_WINDOW_DAYS = 120;

/**
 * A janela "quente": o que entra na frente da fila em toda passada.
 *
 * Sem ela, o rodizio por `omie_billing_checked_at` trata a pesagem de hoje como trata a de
 * tres meses atras — e num acervo grande as de hoje esperavam a vez atras de centenas de
 * pesagens velhas que nunca serao faturadas. Dois dias, e nao um, para o movimento da
 * virada de meia-noite e o do fim do expediente nao cairem para tras do acervo.
 */
const OMIE_BILLING_CHECK_HOT_WINDOW_DAYS = 2;

/**
 * Intervalo minimo entre duas conferencias. `syncCloudNow` nao roda so no agendador: ele e
 * disparado em segundo plano a cada fechamento e a cada alteracao de operacao, e sem freio
 * uma pedreira movimentada gastaria a fila do OMIE perguntando de novo pelas mesmas
 * pesagens — e a fila e a MESMA do envio dos pedidos.
 *
 * Eram 10 minutos quando a passada custava ~40 chamadas. Pela listagem uma passada tipica
 * custa 1 ou 2, entao o freio pode cair para 3 minutos: o dia acompanha praticamente em
 * tempo real e o envio dos fechamentos nem sente.
 */
const OMIE_BILLING_CHECK_MIN_INTERVAL_MS = 3 * 60 * 1000;

/**
 * De quanto em quanto tempo o ACERVO (tudo o que passou da janela quente) entra na
 * conferencia. O documento de dois meses atras nao muda de estado a cada tres minutos, e
 * incluir o acervo custa caro: os codigos dele sao baixos, e a listagem do OMIE — que vem
 * do codigo maior para o menor — precisa varrer ate la para alcanca-los.
 */
const OMIE_BILLING_CHECK_FULL_INTERVAL_MS = 60 * 60 * 1000;

/** Ultima passada da conferencia, para o freio acima. */
const OMIE_BILLING_CHECK_LAST_RUN_KEY = "omie_billing_check_last_run_at";

/** Ultima passada que incluiu o acervo. */
const OMIE_BILLING_CHECK_FULL_LAST_RUN_KEY = "omie_billing_check_full_last_run_at";

export interface OmieBillingReconcileResult {
  /** Pesagens conferidas no OMIE nesta passada. */
  checked: number;
  /** Quantas passaram a constar como faturadas. */
  billed: number;
  /**
   * Quantas GANHARAM o numero da nota nesta passada.
   *
   * Separado de `billed` porque as duas coisas quase nunca acontecem juntas: a pesagem
   * passa a constar faturada quando alguem move o pedido no OMIE, e o numero da nota so
   * aparece depois, na consulta dirigida ao documento. Quem chama em leva — a tela que se
   * preenche sozinha e o botao "Conferir notas no OMIE" — precisa deste numero para saber
   * se vale pedir a proxima leva ou se a fila secou.
   */
  invoiceNumbers: number;
  /** Quantas continuam faturadas SEM numero depois desta passada. */
  stillWithoutInvoiceNumber: number;
  /** true quando a passada foi pulada pelo intervalo minimo (nao e erro). */
  skipped?: boolean;
  errors: string[];
}

interface PendingOmieBillingRow {
  id: string;
  operation_type: "invoice" | "internal";
  omie_sales_order_id: number | null;
  omie_service_order_id: number | null;
  /**
   * O que a operacao ja sabia antes da passada.
   *
   * `omie_billing_status` separa a pesagem que passou a constar faturada AGORA da que ja
   * constava (a contagem devolvida a tela e "quantas viraram nota", nao "quantas foram
   * conferidas"); `omie_invoice_number` e o que decide se ela ainda precisa ser perguntada.
   */
  omie_billing_status: string | null;
  omie_invoice_number: string | null;
  /**
   * O numero visivel do pedido/OS, que a tela ja mostra em "Pedido/OS OMIE".
   *
   * Vai junto na pergunta porque e a segunda chave pela qual a nota e reencontrada no
   * OMIE: a listagem de notas casa pelo codigo interno do pedido, mas devolve tambem o
   * numero impresso — e ha registro que so traz esse. Mandar o que a balanca ja sabe nao
   * custa chamada nenhuma.
   */
  omie_order_number: string | null;
  /** Data da carga. E dela que sai a janela de emissao mandada ao OMIE. */
  created_at: string | null;
}

interface OmieOrderBillingState {
  operationId: string;
  orderType: "sales" | "service";
  omieOrderId: number;
  found: boolean;
  billed: boolean;
  orderNumber: string | null;
  invoiceNumber: string | null;
  documentUrl: string | null;
  error: string | null;
}

/**
 * Pergunta ao OMIE quais pedidos/OS ja foram faturados e vira a situacao das pesagens
 * correspondentes para "Faturada".
 *
 * O KyberRock cria o pedido na etapa "Faturar" e para por ali: quem emite a nota e uma
 * pessoa, dentro do OMIE, e nada avisava a balanca. O resultado era a conferencia de
 * faturamento mostrando "No OMIE, falta faturar" para sempre, inclusive em venda que ja
 * tinha nota emitida ha semanas — o numero de "nao faturado" do relatorio nao servia para
 * cobrar ninguem porque ninguem sabia o que dele ja tinha sido resolvido.
 *
 * Roda junto da sincronizacao cloud, em lote e por rodizio (`omie_billing_checked_at`), e
 * NAO mexe em `updated_at`: as colunas de faturamento sao locais — cada balanca aprende do
 * proprio OMIE —, e bumpar a versao republicaria a operacao inteira na nuvem a toa (na
 * primeira passada, o acervo inteiro de uma vez).
 */
/**
 * Quais pesagens ainda tem o que perguntar ao OMIE.
 *
 * Cancelada no OMIE nao volta: e estado final do documento la. Faturada tambem sairia da
 * fila — mas so depois que o NUMERO DA NOTA chegar. A conferencia barata (pela listagem de
 * pedidos) reconhece o faturamento pela etapa do kanban e nao traz o numero da NF-e junto;
 * quando a pesagem saia da fila ao virar "faturada", o numero nunca mais era perguntado e a
 * coluna "Nota fiscal" ficava com "-" para sempre — inclusive no relatorio que vai para o
 * cliente, e inclusive depois de a atendente apertar "Conferir notas no OMIE", que usa esta
 * mesma consulta.
 *
 * Enquanto o numero falta, a pesagem continua no rodizio (por `omie_billing_checked_at`,
 * dentro da janela de data), e o edge gasta uma consulta dirigida por passada para busca-lo.
 */
const PENDING_OMIE_BILLING_SQL = `(
  omie_billing_status IS NULL
  OR omie_billing_status NOT IN ('billed', 'cancelled_in_omie', 'missing_in_omie')
  OR (omie_billing_status = 'billed'
      AND (omie_invoice_number IS NULL OR trim(omie_invoice_number) = ''))
)`;

/**
 * O documento nao existe mais no OMIE — e a conferencia PARA de perguntar por ele.
 *
 * A resposta "OS nao cadastrada para o Codigo [...]" e definitiva: o codigo interno do
 * OMIE nao e reaproveitado, entao o que foi excluido la nao volta com o mesmo numero.
 * Ainda assim a pesagem so ganhava a FRASE (`omie_billing_message`) e continuava sem
 * `omie_billing_status`, o que a mantinha dentro do predicado acima — e o rodizio, que
 * ordena por `omie_billing_checked_at ASC`, devolvia a mesma pesagem para o comeco da fila
 * a cada passada. Vinte e quatro documentos excluidos rendiam ~3.100 consultas recusadas
 * por dia, e foi esse volume que fez o OMIE bloquear a integracao inteira por consumo
 * indevido.
 *
 * Nao e um beco sem saida: reenviar o fechamento cria um documento novo, e a criacao
 * limpa este marcador (ver o UPDATE depois de `markSyncJobDone`) devolvendo a pesagem a
 * fila. A situacao na tela continua sendo "falta faturar" — porque e verdade — com a
 * frase explicando que o documento sumiu de la.
 */
const OMIE_BILLING_STATUS_MISSING = "missing_in_omie";

/**
 * Folga para tras na janela de emissao das notas.
 *
 * A nota sai no dia da carga ou depois, nunca antes — mas `created_at` e gravado em UTC e
 * a nota e datada no fuso da pedreira, entao a carga da madrugada cai no dia anterior la.
 * Tres dias cobrem isso com sobra sem alargar a busca a ponto de ela deixar de ser estreita.
 */
const INVOICE_SEARCH_SLACK_DAYS = 3;

/** `2026-08-25` mais (ou menos) N dias, ainda em ISO. */
function shiftIsoDay(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `2026-08-25` no formato que o OMIE aceita. */
function toOmieDate(isoDay: string): string {
  const [year, month, day] = isoDay.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * O periodo em que as notas DESTAS cargas podem ter sido emitidas.
 *
 * Existe por dois motivos. Estreitar a busca e o obvio: procurar a nota de uma quinzena no
 * periodo dela, em vez de varrer o cadastro inteiro do mais novo para tras.
 *
 * O outro e o que fazia a coluna continuar vazia. O OMIE recusa a MESMA pergunta repetida
 * ("Consumo redundante detectado. Aguarde N segundos"), e a listagem de notas saia
 * identica em toda passada — mesma pagina, mesmo tamanho, mesma ordem. Da segunda leva em
 * diante ela voltava recusada, e nada no caminho parecia quebrado. Com a janela, cada leva
 * pergunta pelo periodo que e o dela.
 *
 * Sem data legivel na leva a janela nao vai: melhor varrer do mais novo para tras do que
 * mandar um periodo errado e a nota ficar de fora dele.
 */
function invoiceSearchWindow(
  rows: readonly PendingOmieBillingRow[]
): { invoiceSearchFrom: string; invoiceSearchTo: string } | null {
  const days = rows
    .map((row) => (row.created_at ?? "").slice(0, 10))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  if (days.length === 0) return null;

  const oldest = days.reduce((left, right) => (left < right ? left : right));
  return {
    invoiceSearchFrom: toOmieDate(shiftIsoDay(oldest, -INVOICE_SEARCH_SLACK_DAYS)),
    // Ate amanha: a nota de hoje pode estar datada adiante pelo fuso, e a ponta de cima
    // nao custa nada — quem estreita a busca e a de baixo.
    invoiceSearchTo: toOmieDate(shiftIsoDay(new Date().toISOString().slice(0, 10), 1))
  };
}

export async function reconcileOmieBillingFromOmie(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: {
    limit?: number;
    windowDays?: number;
    hotWindowDays?: number;
    includeBacklog?: boolean;
    force?: boolean;
    /**
     * Conferir ESTAS pesagens, em vez do rodizio por janela de data.
     *
     * E o que o "Fazer fechamento" usa antes de faturar: ele precisa saber o estado no OMIE
     * das cargas que estao na tela AGORA, e nao das que calharam de estar na vez do
     * rodizio. Ignora o freio de janela pelo mesmo motivo — a pergunta e do operador, nao
     * da rotina de fundo.
     */
    operationIds?: readonly string[];
    /**
     * Quantas consultas dirigidas ao numero da nota esta passada pode pedir ao edge.
     *
     * O rodizio de fundo nao passa nada e fica com o teto baixo de la. Quem passa e a TELA
     * — o relatorio que se preenche sozinho e o botao "Conferir notas no OMIE" —, porque
     * ali existe alguem esperando o numero e a leva seguinte so sai quando esta voltar.
     */
    invoiceNumberBudget?: number;
  } = {}
): Promise<OmieBillingReconcileResult> {
  const settings = getCloudSettings(database, identity);
  const limit = options.limit ?? OMIE_BILLING_CHECK_BATCH;
  const windowDays = options.windowDays ?? OMIE_BILLING_CHECK_WINDOW_DAYS;
  const hotWindowDays = options.hotWindowDays ?? OMIE_BILLING_CHECK_HOT_WINDOW_DAYS;

  const targeted = options.operationIds ?? null;
  if (targeted !== null && targeted.length === 0) {
    return { checked: 0, billed: 0, invoiceNumbers: 0, stillWithoutInvoiceNumber: 0, errors: [] };
  }

  if (
    targeted === null &&
    options.force !== true &&
    !hasWindowElapsed(database, OMIE_BILLING_CHECK_LAST_RUN_KEY)
  ) {
    return {
      checked: 0,
      billed: 0,
      invoiceNumbers: 0,
      stillWithoutInvoiceNumber: 0,
      skipped: true,
      errors: []
    };
  }

  // Duas cadencias. A passada CURTA (a cada 3 min) olha so o movimento recente: sao
  // poucos documentos, todos com codigo alto, e a listagem do OMIE os acha na primeira
  // pagina. A passada COMPLETA (de hora em hora) inclui o acervo — cujos codigos sao
  // baixos e obrigam a varrer fundo. Misturar os dois em toda passada faria a varredura
  // ir ate o fim toda vez, e o acervo de meses nao muda de estado a cada tres minutos.
  const includeBacklog =
    options.includeBacklog ??
    hasWindowElapsed(
      database,
      OMIE_BILLING_CHECK_FULL_LAST_RUN_KEY,
      OMIE_BILLING_CHECK_FULL_INTERVAL_MS
    );

  const pending = targeted
    ? (database
        .prepare(
          `SELECT id, operation_type, omie_sales_order_id, omie_service_order_id,
                  omie_billing_status, omie_invoice_number, omie_order_number, created_at
             FROM weighing_operations
            WHERE unit_id = ?
              AND id IN (${targeted.map(() => "?").join(", ")})
              AND deleted_at IS NULL
              AND status <> 'cancelled'
              AND (omie_sales_order_id IS NOT NULL OR omie_service_order_id IS NOT NULL)
              AND ${PENDING_OMIE_BILLING_SQL}`
        )
        .all(settings.unitId, ...targeted) as PendingOmieBillingRow[])
    : (database
        .prepare(
          `SELECT id, operation_type, omie_sales_order_id, omie_service_order_id,
                  omie_billing_status, omie_invoice_number, omie_order_number, created_at
         FROM weighing_operations
        WHERE unit_id = ?
          AND deleted_at IS NULL
          AND status <> 'cancelled'
          AND (omie_sales_order_id IS NOT NULL OR omie_service_order_id IS NOT NULL)
          AND ${PENDING_OMIE_BILLING_SQL}
          AND date(created_at) >= date('now', ?)
        -- O movimento recente vem na frente do acervo, sempre. Depois disso vale o
        -- rodizio (quem nunca foi conferido, depois o conferido ha mais tempo), e o
        -- desempate pela pesagem mais nova: se o lote acabar, quem fica de fora e o
        -- registro velho, nunca o de hoje.
        ORDER BY
          CASE WHEN date(created_at) >= date('now', ?) THEN 0 ELSE 1 END,
          omie_billing_checked_at ASC,
          created_at DESC
        LIMIT ?`
        )
        .all(
          settings.unitId,
          `-${includeBacklog ? windowDays : hotWindowDays} days`,
          `-${hotWindowDays} days`,
          limit
        ) as PendingOmieBillingRow[]);

  if (pending.length === 0)
    return { checked: 0, billed: 0, invoiceNumbers: 0, stillWithoutInvoiceNumber: 0, errors: [] };

  const orders = pending
    .map((row) => {
      // A interna vira ordem de servico; a com nota, pedido de venda. Quando as duas
      // existem (reenvio que mudou o tipo), o tipo da operacao decide.
      const orderNumber = (row.omie_order_number ?? "").trim() || null;
      const preferred =
        row.operation_type === "invoice"
          ? { orderType: "sales" as const, omieOrderId: row.omie_sales_order_id ?? 0 }
          : { orderType: "service" as const, omieOrderId: row.omie_service_order_id ?? 0 };
      if (preferred.omieOrderId > 0) return { operationId: row.id, orderNumber, ...preferred };

      // O tipo da operacao nao bate com o documento que ela TEM no OMIE — acontece quando
      // a operacao foi convertida (interna virou com nota, ou o contrario) depois de o
      // documento ja existir la. Perguntar pelo documento que existe e sempre melhor que
      // nao perguntar: descartada aqui, a pesagem ficava com `omie_billing_checked_at`
      // parado no tempo e voltava na FRENTE do rodizio em toda passada, ocupando uma vaga
      // do lote sem nunca ser conferida — e segurando a fila de quem vinha atras.
      const fallback =
        row.operation_type === "invoice"
          ? { orderType: "service" as const, omieOrderId: row.omie_service_order_id ?? 0 }
          : { orderType: "sales" as const, omieOrderId: row.omie_sales_order_id ?? 0 };
      return { operationId: row.id, orderNumber, ...fallback };
    })
    .filter((order) => order.omieOrderId > 0);

  if (orders.length === 0)
    return { checked: 0, billed: 0, invoiceNumbers: 0, stillWithoutInvoiceNumber: 0, errors: [] };

  // Marca a passada ANTES de chamar o OMIE: mesmo que a chamada falhe, o freio vale — uma
  // instabilidade do OMIE nao pode virar uma tentativa por fechamento.
  // So o rodizio carimba o freio: a conferencia pedida pelo operador nao pode consumir a
  // vez da rotina de fundo (nem ser barrada por ela).
  if (targeted === null) {
    const startedAt = new Date().toISOString();
    writeLocalSetting(database, OMIE_BILLING_CHECK_LAST_RUN_KEY, startedAt);
    if (includeBacklog) {
      writeLocalSetting(database, OMIE_BILLING_CHECK_FULL_LAST_RUN_KEY, startedAt);
    }
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<{ results?: OmieOrderBillingState[] }>(
    "omie-sync",
    {
      body: {
        deviceId: settings.deviceId,
        deviceToken: settings.deviceToken,
        action: "check_order_billing",
        payload: {
          orders,
          ...(options.invoiceNumberBudget === undefined
            ? {}
            : { invoiceNumberBudget: options.invoiceNumberBudget }),
          ...(invoiceSearchWindow(pending) ?? {})
        }
      }
    }
  );

  if (error) {
    return {
      checked: 0,
      billed: 0,
      invoiceNumbers: 0,
      stillWithoutInvoiceNumber: 0,
      errors: [await getFunctionErrorMessage(error)]
    };
  }

  const results = data?.results ?? [];
  const errors: string[] = [];
  let billed = 0;

  // Sem a guarda de "ainda nao faturada" que existia aqui: era ela que impedia a passada
  // seguinte de gravar o NUMERO DA NOTA numa pesagem ja marcada como faturada — o numero
  // chega DEPOIS do faturamento, pela consulta dirigida, e a linha nunca era atualizada.
  // A contagem de "quantas viraram nota nesta passada" nao depende mais do UPDATE: ela sai
  // do estado que a pesagem tinha ANTES da passada (`alreadyBilled`, abaixo).
  const markBilled = database.prepare(
    `UPDATE weighing_operations
        SET omie_billing_status = 'billed',
            omie_billed_at = COALESCE(omie_billed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            omie_billing_message = ?,
            omie_order_number = COALESCE(?, omie_order_number),
            omie_invoice_number = COALESCE(?, omie_invoice_number),
            omie_document_url = COALESCE(?, omie_document_url),
            omie_billing_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  );

  /** As que ja constavam faturadas antes desta passada — nao contam como novidade. */
  const alreadyBilled = new Set(
    pending.filter((row) => row.omie_billing_status === "billed").map((row) => row.id)
  );
  /**
   * As que entraram nesta passada SEM o numero da nota.
   *
   * E por elas que se mede o proveito da consulta dirigida: quem ja tinha numero nao ganha
   * nada aqui, e contar a passada pelo total conferido faria a tela achar que avancou
   * quando so releu o que ja sabia.
   */
  const withoutNumberBefore = new Set(
    pending.filter((row) => !(row.omie_invoice_number ?? "").trim()).map((row) => row.id)
  );
  let invoiceNumbers = 0;
  let stillWithoutInvoiceNumber = 0;
  // Guarda o numero da nota mesmo quando o OMIE nao deu o documento por faturado. Um
  // numero que veio junto e prova de que a nota existe, e jogar fora o unico dado que a
  // tela precisa por causa da etapa do kanban nao ajuda ninguem — a situacao continua
  // sendo decidida pelo OMIE, so o numero e aproveitado.
  const markChecked = database.prepare(
    `UPDATE weighing_operations
        SET omie_order_number = COALESCE(?, omie_order_number),
            omie_invoice_number = COALESCE(?, omie_invoice_number),
            omie_billing_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  );
  const markMissing = database.prepare(
    `UPDATE weighing_operations
        SET omie_billing_status = '${OMIE_BILLING_STATUS_MISSING}',
            omie_billing_message = ?,
            omie_billing_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  );

  for (const result of results) {
    if (result.error) {
      errors.push(`Faturamento OMIE ${result.omieOrderId}: ${result.error}`);
      markChecked.run(null, null, result.operationId);
      continue;
    }

    if (!result.found) {
      // O documento sumiu do OMIE (excluido por alguem la). A situacao continua sendo
      // "falta faturar" de proposito — a pesagem REALMENTE nao foi faturada, e agora nem
      // pedido tem. O texto explica isso na linha da conferencia.
      markMissing.run(
        `${result.orderType === "sales" ? "Pedido" : "Ordem de servico"} ${result.omieOrderId} nao existe mais no OMIE.`,
        result.operationId
      );
      continue;
    }

    if (!result.billed) {
      markChecked.run(result.orderNumber, result.invoiceNumber, result.operationId);
      if (withoutNumberBefore.has(result.operationId) && result.invoiceNumber) invoiceNumbers++;
      continue;
    }

    markBilled.run(
      buildBilledMessage(result),
      result.orderNumber,
      result.invoiceNumber,
      result.documentUrl,
      result.operationId
    );
    if (!alreadyBilled.has(result.operationId)) billed++;
    if (withoutNumberBefore.has(result.operationId)) {
      if (result.invoiceNumber) invoiceNumbers++;
      else stillWithoutInvoiceNumber++;
    }
  }

  return { checked: results.length, billed, invoiceNumbers, stillWithoutInvoiceNumber, errors };
}

/**
 * Ja passou tempo suficiente desde a ultima passada marcada nesta chave? Sem registro (ou
 * com marca ilegivel) a resposta e sim — na duvida, conferir e melhor que nao conferir.
 */
function hasWindowElapsed(
  database: DesktopDatabase,
  key: string,
  intervalMs: number = OMIE_BILLING_CHECK_MIN_INTERVAL_MS
): boolean {
  const lastRunAt = readStringLocalSetting(database, key);
  if (!lastRunAt) return true;
  const lastRun = Date.parse(lastRunAt);
  if (Number.isNaN(lastRun)) return true;
  return Date.now() - lastRun >= intervalMs;
}

/** O texto da linha faturada: cita a nota quando o OMIE ja devolveu o numero dela. */
function buildBilledMessage(result: OmieOrderBillingState): string {
  const document = result.orderType === "sales" ? "NF-e" : "NFS-e";
  return result.invoiceNumber
    ? `Faturado no OMIE — ${document} ${result.invoiceNumber}.`
    : "Faturado no OMIE.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInternalOperation(database: DesktopDatabase, operationId: string): boolean {
  const row = database
    .prepare("SELECT operation_type FROM weighing_operations WHERE id = ?")
    .get(operationId) as { operation_type: string } | undefined;
  return row?.operation_type === "internal";
}

/**
 * (Re)envia a ordem de servico de uma operacao interna: reconstroi o job com a MESMA chave
 * de idempotencia (o OMIE reaproveita a OS ja criada, nunca duplica), rearma um job que
 * tenha falhado e processa a fila so dessa operacao. Devolve `blocked` com o motivo quando
 * ainda nao ha o que enviar (cliente sem codigo OMIE e sem CNPJ/CPF).
 */
async function resendInternalServiceOrder(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  operationId: string
): Promise<FiscalBillingResult> {
  const row = database
    .prepare("SELECT status, omie_service_order_id FROM weighing_operations WHERE id = ?")
    .get(operationId) as { status: string; omie_service_order_id: number | null } | undefined;

  // Operacao cancelada: os jobs OMIE dela foram neutralizados de proposito
  // (cancelPendingOmieJobs). Reenviar aqui ressuscitaria a OS de uma venda cancelada.
  if (row?.status === "cancelled") {
    const reason = "Operacao cancelada: a ordem de servico nao e reenviada ao OMIE.";
    return { ...internalServiceOrderResult(null, reason), blocked: true, blockReason: reason };
  }

  const existingOrderId = row?.omie_service_order_id ?? null;
  if (existingOrderId) {
    return internalServiceOrderResult(existingOrderId, `Ordem de servico OMIE ${existingOrderId}.`);
  }

  const built = buildOmieBillingJob(database, operationId);
  if (!built) {
    const reason =
      "Cliente sem CNPJ/CPF: informe o documento do cliente para cadastra-lo no OMIE e enviar a ordem de servico.";
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(reason, operationId);
    return { ...internalServiceOrderResult(null, reason), blocked: true, blockReason: reason };
  }

  enqueueOmieBillingJob(database, operationId, built);
  // Job ja existente que falhou/morreu: volta para 'pending' com o payload atualizado
  // (o cadastro do cliente pode ter sido corrigido depois da primeira tentativa).
  database
    .prepare(
      `UPDATE sync_queue
       SET status = 'pending', attempt_count = 0, payload_json = ?,
           next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE target = 'omie' AND idempotency_key = ? AND status IN ('pending', 'failed', 'dead_letter')`
    )
    .run(JSON.stringify(built.payload), built.idempotencyKey);

  const outcome = await processOmieSyncQueue(database, identity, { entityId: operationId });
  const orderId = database
    .prepare("SELECT omie_service_order_id FROM weighing_operations WHERE id = ?")
    .pluck()
    .get(operationId) as number | null | undefined;

  if (orderId) {
    return internalServiceOrderResult(orderId, `Ordem de servico OMIE ${orderId} criada.`);
  }

  const reason =
    outcome.errors[0] ?? "OMIE nao confirmou a ordem de servico. Tente novamente em instantes.";
  return { ...internalServiceOrderResult(null, reason), blocked: true, blockReason: reason };
}

function internalServiceOrderResult(orderId: number | null, message: string): FiscalBillingResult {
  return {
    orderId,
    // A OS nasce na etapa "Faturar" e a NFS-e e emitida no OMIE: o app nunca fatura aqui.
    billed: false,
    billingStatusCode: null,
    billingStatusMessage: message,
    documentUrl: null,
    documentPrinted: false,
    documentPrintError: null
  };
}

export async function processFiscalBillingNow(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  operationId: string,
  printDocument: (
    documentUrl: string
  ) => Promise<{ printed: boolean; error: string | null }> = async () => ({
    printed: false,
    error: null
  })
): Promise<FiscalBillingResult> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();

  // Operacao interna: nao ha NF-e a faturar, mas ha ordem de servico a (re)enviar. Depois
  // de completar o CNPJ/CPF do cliente, este e o caminho para tirar a operacao do estado
  // "cadastro incompleto" — sem ele a venda sem nota ficava presa sem nenhuma acao.
  if (isInternalOperation(database, operationId)) {
    return resendInternalServiceOrder(database, identity, operationId);
  }

  // Gate autoritativo: cadastro do cliente precisa estar completo para NF-e. Se nao estiver,
  // registra a pendencia e retorna bloqueado (sem chamar o OMIE, sem enfileirar job condenado).
  const readiness = validateOperationFiscalReadiness(database, operationId);
  if (!readiness.ready) {
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(readiness.message, operationId);
    return {
      orderId: null,
      billed: false,
      blocked: true,
      blockReason: readiness.message,
      billingStatusCode: null,
      billingStatusMessage: readiness.message,
      documentUrl: null,
      documentPrinted: false,
      documentPrintError: null
    };
  }

  const findBillingJob = () =>
    database
      .prepare(
        `SELECT * FROM sync_queue
         WHERE target = 'omie'
           AND action = 'create_and_bill_order'
           AND entity_id = ?
           AND status IN ('pending', 'failed')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(operationId) as
      | { id: string; idempotency_key: string; payload_json: string }
      | undefined;

  let job = findBillingJob();

  // O fechamento so CRIA o pedido no OMIE (create_order) — o faturamento e feito no
  // OMIE. Este caminho manual promove o job de criacao (MESMA chave de idempotencia)
  // para create_and_bill_order em vez de inserir outra linha com a chave ja usada
  // (INSERT OR IGNORE seria descartado); a edge reusa o pedido ja criado.
  if (!job) {
    const built = buildOmieBillingJob(database, operationId);
    if (built && built.payload.operationType === "invoice") {
      const nowIso = new Date().toISOString();
      const promoted = database
        .prepare(
          `UPDATE sync_queue
           SET action = 'create_and_bill_order', status = 'pending', payload_json = ?,
               next_attempt_at = ?, updated_at = ?
           WHERE target = 'omie' AND action = 'create_order' AND idempotency_key = ?`
        )
        .run(JSON.stringify(built.payload), nowIso, nowIso, built.idempotencyKey);
      if (promoted.changes === 0) {
        enqueueOmieBillingJob(database, operationId, {
          ...built,
          action: "create_and_bill_order"
        });
      }
      job = findBillingJob();
    }
  }

  if (!job) {
    const reason =
      "Nao ha faturamento OMIE pendente para esta operacao fiscal (verifique se o cliente tem codigo OMIE).";
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(reason, operationId);
    return {
      orderId: null,
      billed: false,
      blocked: true,
      blockReason: reason,
      billingStatusCode: null,
      billingStatusMessage: reason,
      documentUrl: null,
      documentPrinted: false,
      documentPrintError: null
    };
  }

  const payload = parseJsonValue(job.payload_json) as {
    operationId: string;
    operationCode?: number | null;
    operationType: "invoice" | "internal";
    customerOmieId: number;
    localCustomerId?: string | null;
    customer?: Record<string, unknown> | null;
    productOmieId?: number | null;
    serviceDescription?: string | null;
    quantity: number;
    unitPrice: number;
    freightTotalCents?: number;
    freightModalidade?: string | null;
    issueDate: string;
    paymentTermOmieCode?: string | null;
    paymentTermInstallmentCount?: number | null;
    paymentTermInstallmentDays?: number[] | null;
    paymentMethodOmieCode?: string | null;
    accountOmieCode?: string | null;
    accountName?: string | null;
    transport?: {
      plate?: string | null;
      /** UF de emplacamento (`placa_estado` do bloco frete da NF-e). */
      plateState?: string | null;
      driverName?: string | null;
      carrierOmieId?: number | null;
      cargoWeightKg?: number | null;
      ownVehicle?: boolean;
    } | null;
    invoiceEmails?: string;
    futureBillingNfeNumber?: string;
  };

  if (payload.operationType !== "invoice") {
    throw new Error("Somente operacoes fiscais podem ser faturadas como pedido de venda.");
  }

  try {
    const { data, error } = await supabase.functions.invoke<{
      orderId?: number;
      orderNumber?: string | null;
      omieCustomerId?: number;
      billed?: boolean;
      billingStatusCode?: string | null;
      billingStatusMessage?: string | null;
      invoiceNumber?: string | null;
      documentUrl?: string | null;
    }>("omie-sync", {
      body: {
        deviceId: settings.deviceId,
        deviceToken: settings.deviceToken,
        action: "create_and_bill_order",
        payload: {
          localOperationId: payload.operationId,
          operationCode: payload.operationCode ?? undefined,
          operationType: payload.operationType,
          customerOmieId: payload.customerOmieId,
          customer: payload.customer ?? undefined,
          productOmieId: payload.productOmieId ?? undefined,
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
          freightTotalCents: payload.freightTotalCents,
          freightModalidade: payload.freightModalidade ?? undefined,
          issueDate: payload.issueDate,
          paymentTermOmieCode: payload.paymentTermOmieCode ?? undefined,
          installmentCount: payload.paymentTermInstallmentCount ?? undefined,
          installmentDays: payload.paymentTermInstallmentDays ?? undefined,
          paymentMethodOmieCode: payload.paymentMethodOmieCode ?? undefined,
          accountOmieCode: payload.accountOmieCode ?? undefined,
          accountName: payload.accountName ?? undefined,
          transport: payload.transport ?? undefined,
          // Mesmos destinatarios da NF do fechamento: refaturar nao pode mandar o pedido
          // com a lista de e-mails vazia depois de o operador arrumar o cadastro.
          invoiceEmails: payload.invoiceEmails || undefined,
          // Mesmo carimbo do fechamento: refaturar nao pode perder a referencia da nota
          // de entrega futura que a carga esta entregando.
          futureBillingNfeNumber: payload.futureBillingNfeNumber || undefined,
          idempotencyKey: job.idempotency_key
        }
      }
    });

    if (error) {
      throw new Error(await getFunctionErrorMessage(error));
    }
    if (!data?.orderId || data.billed !== true) {
      throw new Error("OMIE nao confirmou o faturamento do pedido de venda.");
    }

    // Cliente criado no OMIE na hora (ou codigo local obsoleto corrigido pelo edge):
    // grava o codigo devolvido no cadastro local.
    if (
      data.omieCustomerId &&
      payload.localCustomerId &&
      data.omieCustomerId !== payload.customerOmieId
    ) {
      database
        .prepare(
          `UPDATE customers
           SET omie_customer_id = ?, needs_push = 0, sync_status = 'synced', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND (omie_customer_id IS NULL OR omie_customer_id = 0 OR omie_customer_id = ?)`
        )
        .run(data.omieCustomerId, payload.localCustomerId, payload.customerOmieId ?? 0);
    }

    let documentPrinted = false;
    let documentPrintError: string | null = null;
    if (data.documentUrl) {
      const printed = await printDocument(data.documentUrl);
      documentPrinted = printed.printed;
      documentPrintError = printed.error;
    }

    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_sales_order_id = ?,
             omie_order_number = COALESCE(?, omie_order_number),
             omie_invoice_number = COALESCE(?, omie_invoice_number),
             omie_billing_status = 'billed',
             omie_billing_message = ?,
             omie_billed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             omie_document_url = COALESCE(?, omie_document_url),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(
        data.orderId,
        (data.orderNumber ?? "").trim() || null,
        (data.invoiceNumber ?? "").trim() || null,
        data.billingStatusMessage ?? "Pedido faturado no OMIE.",
        data.documentUrl ?? null,
        operationId
      );
    markSyncJobDone(database, job.id);
    // Cliente criado no OMIE neste faturamento: libera os outros fechamentos dele que
    // estavam parados por isso (depois do markSyncJobDone, para nao reabrir este job).
    if (data.omieCustomerId && payload.localCustomerId) {
      rearmOmieBillingForCustomer(database, payload.localCustomerId);
    }

    return {
      orderId: data.orderId,
      billed: true,
      billingStatusCode: data.billingStatusCode ?? null,
      billingStatusMessage: data.billingStatusMessage ?? "Pedido faturado no OMIE.",
      documentUrl: data.documentUrl ?? null,
      documentPrinted,
      documentPrintError
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao faturar pedido no OMIE.";

    // Falha deterministica de cadastro/NF-e: nao adianta re-tentar automaticamente. Bloqueia o
    // job (re-executavel manualmente apos corrigir) e retorna pendencia clara — sem throw/storm.
    // A recusa do cadastro do cliente no OMIE entra aqui pelo mesmo motivo, mas com a
    // mensagem que diz qual campo do cliente falta preencher.
    // O pedido JA estava faturado no OMIE (alguem emitiu a nota na coluna "Faturar" antes
    // de o fechamento rodar). Nao e falha: reconcilia a situacao aqui e devolve como
    // faturada. Sem isto, o fechamento de uma quinzena ja resolvida no OMIE voltava com uma
    // lista de erros vermelhos e mandava procurar problema onde nao havia.
    if (isOmieAlreadyBilledFault(message)) {
      markSyncJobDone(database, job.id);
      database
        .prepare(
          `UPDATE weighing_operations
           SET omie_billing_status = 'billed',
               omie_billed_at = COALESCE(omie_billed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
               omie_billing_message = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`
        )
        .run("Ja faturada no OMIE (o pedido la ja estava autorizado).", operationId);
      return {
        orderId: null,
        billed: true,
        alreadyBilledInOmie: true,
        billingStatusCode: null,
        billingStatusMessage: "Ja faturada no OMIE (o pedido la ja estava autorizado).",
        documentUrl: null,
        documentPrinted: false,
        documentPrintError: null
      };
    }

    if (
      isCadastroIncompleteFault(message) ||
      isOmieCustomerRegistrationFault(message) ||
      isOmieStaleCustomerCodeFault(message)
    ) {
      markSyncJobBlocked(database, job.id, message);
      database
        .prepare(
          `UPDATE weighing_operations
           SET omie_billing_status = 'cadastro_incompleto', omie_billing_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`
        )
        .run(message, operationId);
      // Codigo OMIE do cliente que nao existe mais la: limpa o vinculo podre para o
      // cliente subir de novo no proximo ciclo e o fechamento voltar sozinho para a fila.
      if (isOmieStaleCustomerCodeFault(message) && payload.localCustomerId) {
        database
          .prepare(
            `UPDATE customers
             SET omie_customer_id = NULL, needs_push = 1, sync_status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ? AND omie_customer_id = ?`
          )
          .run(payload.localCustomerId, payload.customerOmieId ?? 0);
      }
      return {
        orderId: null,
        billed: false,
        blocked: true,
        blockReason: message,
        billingStatusCode: null,
        billingStatusMessage: message,
        documentUrl: null,
        documentPrinted: false,
        documentPrintError: null
      };
    }

    markSyncJobFailed(database, job.id, message);
    database
      .prepare(
        `UPDATE weighing_operations
         SET omie_billing_status = 'failed',
             omie_billing_message = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(message, operationId);
    throw new Error(
      `Nao foi possivel faturar no OMIE. Verifique a internet conectada e a configuracao da API OMIE. Detalhe: ${message}`
    );
  }
}

// Empurra os destinatarios de relatorio pendentes (needs_push) para o Supabase,
// para o envio automatico (daily-report-email) enxergar quem recebe o que.
// Destinatario removido localmente vai como inativo E com o deleted_at preenchido:
// o inativo tira ele do envio, o tombstone e o que impede o pull seguinte (aqui e
// nas outras balancas) de trazer de volta o que foi excluido.
export async function pushPendingReportRecipients(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<number> {
  const settings = getCloudSettings(database, identity);
  // Bases criadas antes da migracao 35 so ganhavam a tabela ao abrir a tela de
  // Relatorios; sem isto a sincronizacao quebrava com "no such table".
  ensureReportRecipientsTable(database);
  const rows = database
    .prepare(
      `SELECT * FROM report_recipients WHERE company_id = ? AND needs_push = 1
       ORDER BY updated_at ASC LIMIT 100`
    )
    .all(settings.companyId) as ReportRecipientRow[];
  if (rows.length === 0) return 0;

  const recipients = rows.map((row) => ({
    id: row.id,
    company_id: settings.companyId,
    email: row.email,
    whatsapp_phone: row.whatsapp_phone,
    send_email: row.send_email === 1,
    send_whatsapp: row.send_whatsapp === 1,
    schedule_frequency: row.schedule_frequency,
    schedule_time: row.schedule_time,
    report_types: row.report_types || "sales",
    send_financial: row.send_financial === 1,
    financial_schedule_time: row.financial_schedule_time,
    display_name: row.display_name,
    is_active: row.is_active === 1 && row.deleted_at === null,
    deleted_at: row.deleted_at,
    updated_at: new Date().toISOString()
  }));

  try {
    await invokeDesktopSync(settings, { reportRecipients: recipients });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar destinatarios.";
    for (const row of rows) markRecipientSyncError(database, row.id, message);
    throw error;
  }

  for (const row of rows) markRecipientSynced(database, row.id);
  return rows.length;
}

// Empurra a configuracao dos canais de envio (SMTP/WhatsApp) da empresa para o
// cloud (tabela report_channel_settings), para o daily-report-email usar sem
// depender de envs nas Edge Functions. Chamado ao salvar/conectar na tela de
// Relatorios e no ciclo de sync enquanto houver push pendente.
export async function pushReportChannelSettings(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<void> {
  const settings = readReportChannelSettings(database);
  const cloud = getCloudSettings(database, identity);
  await invokeDesktopSync(cloud, {
    reportChannelSettings: toCloudChannelSettingsRow(cloud.companyId, settings)
  });
}

/**
 * Pede a nuvem um link temporario para parear o WhatsApp fora deste computador
 * (Edge Function `whatsapp-link`). Quem carimba o prazo e a nuvem: o desktop so
 * guarda o que ela devolveu. Exige que a configuracao do WhatsApp ja tenha
 * chegado la -- e a funcao que recusa, com o motivo, quando nao chegou.
 */
export async function createWhatsappConnectionLink(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<WhatsappConnectionLink> {
  const cloud = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<{
    id?: string;
    url?: string;
    createdAt?: string;
    expiresAt?: string;
  }>("whatsapp-link", {
    body: { deviceId: cloud.deviceId, deviceToken: cloud.deviceToken, action: "create" }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  const link = parseWhatsappConnectionLink(data);
  if (!link) throw new Error("A nuvem nao devolveu um link valido.");
  return link;
}

/** Cancela o link antes do prazo (botao "Cancelar link" da tela). */
export async function revokeWhatsappConnectionLink(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  linkId: string
): Promise<void> {
  const cloud = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("whatsapp-link", {
    body: {
      deviceId: cloud.deviceId,
      deviceToken: cloud.deviceToken,
      action: "revoke",
      linkId
    }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
}

/** Resultado por empresa devolvido pela edge function financial-report-email. */
export interface FinancialReportDispatchResult {
  companyId: string;
  date: string;
  recipients: number;
  status: "sent" | "partial" | "failed" | "skipped";
  reason?: string;
  error?: string;
}

// Dispara o relatorio financeiro do OMIE na hora, pelo botao "Enviar agora" da
// tela de Relatorios (serve para testar a configuracao sem esperar o horario).
// Quem monta e envia o relatorio e sempre a nuvem — o OMIE nunca e chamado do
// desktop; aqui so pedimos o disparo autenticando com o par deviceId/deviceToken
// do dispositivo, e a edge function restringe o envio a empresa dele.
export async function sendFinancialReportNow(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<FinancialReportDispatchResult[]> {
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<{
    results?: FinancialReportDispatchResult[];
  }>("financial-report-email", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  return data?.results ?? [];
}

async function invokeDesktopSync(
  settings: CloudSettings,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("desktop-sync", {
    body: { deviceId: settings.deviceId, deviceToken: settings.deviceToken, ...payload }
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = getErrorLikeMessage(error);
  const context =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: unknown }).context
      : null;

  if (!context || typeof context !== "object") {
    return fallback;
  }

  try {
    const clone =
      "clone" in context && typeof context.clone === "function" ? context.clone() : context;
    if (clone && typeof clone === "object" && "json" in clone && typeof clone.json === "function") {
      const body = await clone.json();
      if (body && typeof body === "object") {
        const candidate =
          (body as { error?: unknown; message?: unknown }).error ??
          (body as { error?: unknown; message?: unknown }).message;
        if (typeof candidate === "string" && candidate.trim()) {
          return withErrorDetails(candidate, (body as { details?: unknown }).details);
        }
        return JSON.stringify(body);
      }
    }
  } catch {
    // Fall through to statusText/message fallback.
  }

  const statusText =
    "statusText" in context ? (context as { statusText?: unknown }).statusText : null;
  return typeof statusText === "string" && statusText.trim() ? statusText : fallback;
}

/**
 * Junta ao resumo da edge function a causa real que veio em `details`.
 *
 * O desktop-sync responde 500 com um resumo generico ("Falha ao persistir
 * alguns payloads") e a lista por tabela em `details`. Enquanto so o resumo
 * chegava aqui, o log do operador repetia a mesma frase para qualquer motivo —
 * coluna estourada, FK ausente, coluna inexistente — e nao dava para saber
 * onde a sincronizacao travou sem abrir o painel do Supabase.
 */
function withErrorDetails(message: string, details: unknown): string {
  const parts = (Array.isArray(details) ? details : [details])
    .filter((detail) => detail !== null && detail !== undefined)
    .map((detail) => (typeof detail === "string" ? detail : JSON.stringify(detail)))
    .filter((detail) => detail.trim().length > 0);
  return parts.length > 0 ? `${message}: ${parts.join("; ")}` : message;
}

function getErrorLikeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate =
      (error as { error?: unknown; message?: unknown }).error ??
      (error as { error?: unknown; message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return "Erro desconhecido";
}

/**
 * Id local de um cadastro espelhado do OMIE, garantidamente por empresa.
 *
 * O id derivado direto do OMIE (`omie_<id>`) nao carrega empresa nenhuma, e o
 * upsert e `ON CONFLICT(id) DO UPDATE SET company_id = excluded.company_id`.
 * Com duas pedreiras na MESMA conta OMIE (ou a mesma maquina reativada em outra
 * pedreira), cada sincronizacao *mudava a linha de dono* em vez de criar a copia
 * da pedreira que sincronizou: a outra pedreira simplesmente perdia o cliente,
 * sem erro nenhum aparecer. Era o que fazia o total baixado nunca bater com o
 * que existe no OMIE — nao faltava download, sobrava roubo de linha.
 *
 * Quando o id preferido ja pertence a outra empresa, esta empresa ganha o seu
 * proprio id derivado. Ids ja existentes ficam como estao (nada e renumerado).
 *
 * Excecao: a identidade provisoria de antes da ativacao (`setup-company`) nao e
 * uma pedreira — as linhas gravadas sob ela continuam sendo adotadas pela
 * empresa real, senao a ativacao deixaria o cadastro duplicado e invisivel.
 *
 * `adoptSetupCompanyRows: false` desliga essa adocao. E obrigatorio em tabela
 * cujo upsert resolve conflito por outra chave que nao o id (o espelho de
 * parcelas casa por empresa+codigo): la, devolver um id de outro dono nao adota
 * a linha — bate na chave primaria e estoura.
 */
export function resolveOmieLocalId(
  database: DesktopDatabase,
  table: "customers" | "products" | "carriers" | "omie_payment_terms",
  companyId: string,
  preferredId: string,
  options: { adoptSetupCompanyRows?: boolean } = {}
): string {
  const owner = database
    .prepare(`SELECT company_id FROM ${table} WHERE id = ?`)
    .get(preferredId) as { company_id: string } | undefined;
  if (!owner || owner.company_id === companyId) return preferredId;
  if (options.adoptSetupCompanyRows !== false && owner.company_id === SETUP_COMPANY_ID) {
    return preferredId;
  }
  return `${preferredId}__${companyId}`;
}

/**
 * As colunas de DADOS que o upsert do cadastro OMIE grava, com a expressao que define o
 * novo valor de cada uma.
 *
 * Esta lista e a UNICA fonte: dela saem tanto a clausula `SET` quanto o teste de "mudou
 * alguma coisa?". Escrever as duas a mao era o jeito de deixar uma coluna de fora do teste
 * e, com isso, parar de propagar justamente aquela coluna. Aqui isso nao tem como
 * acontecer — as duas se derivam do mesmo array.
 *
 * `omieOwned`: o OMIE manda, sempre. `localFirst`: a edicao local ainda nao enviada ao OMIE
 * (`needs_push = 1`) tem precedencia — e a protecao que ja existia para nao apagar da tela
 * o CPF/CNPJ que o operador acabou de digitar.
 *
 * Os tres carimbos de tempo (`last_synced_at`, `omie_updated_at`, `updated_at`) NAO entram:
 * eles valem `now()` a cada passada e, se entrassem, "mudou alguma coisa?" seria sempre
 * verdadeiro e nada disto teria efeito.
 */
const omieOwned = (column: string): OmieUpsertColumn => ({
  column,
  expr: `excluded.${column}`
});
const localFirst = (column: string): OmieUpsertColumn => ({
  column,
  expr: `CASE WHEN customers.needs_push = 0 THEN excluded.${column} ELSE customers.${column} END`
});

interface OmieUpsertColumn {
  column: string;
  expr: string;
}

const OMIE_CUSTOMER_DATA_COLUMNS: readonly OmieUpsertColumn[] = [
  omieOwned("company_id"),
  omieOwned("omie_customer_id"),
  omieOwned("omie_integration_code"),
  localFirst("legal_name"),
  localFirst("trade_name"),
  localFirst("document"),
  localFirst("state_registration"),
  localFirst("municipal_registration"),
  localFirst("is_individual"),
  localFirst("email"),
  localFirst("fiscal_emails"),
  localFirst("homepage"),
  localFirst("contact_name"),
  localFirst("phone"),
  localFirst("phone_secondary"),
  localFirst("zipcode"),
  localFirst("address_street"),
  localFirst("address_number"),
  localFirst("address_complement"),
  localFirst("neighborhood"),
  localFirst("city"),
  localFirst("state"),
  localFirst("country"),
  localFirst("country_code"),
  localFirst("ibge_city_code"),
  localFirst("ibge_state_code"),
  omieOwned("customer_type"),
  omieOwned("is_foreign"),
  localFirst("omie_billing_blocked"),
  localFirst("observations"),
  omieOwned("tags_json"),
  omieOwned("salesperson_id"),
  localFirst("default_payment_term_id"),
  omieOwned("is_active"),
  // `deleted_at` nao viaja no INSERT: o valor novo e o literal NULL, e a comparacao abaixo
  // e o que faz um cliente que estava apagado localmente e voltou no OMIE contar como
  // mudanca (e portanto ser republicado para as outras balancas).
  { column: "deleted_at", expr: "NULL" },
  {
    column: "sync_status",
    expr: "CASE WHEN customers.needs_push = 0 THEN 'synced' ELSE customers.sync_status END"
  }
];

/**
 * "A passada do OMIE mexeu de verdade nesta linha?"
 *
 * `IS NOT` porque e a desigualdade que trata NULL como valor: `NULL <> NULL` daria NULL
 * (nem verdadeiro nem falso) e a coluna nula nunca contaria como mudanca — nem quando
 * deixasse de ser nula.
 *
 * Diferenca de afinidade entre o valor gravado e o vindo do OMIE cai para o lado seguro:
 * a comparacao acusa mudanca, o `updated_at` avanca e o comportamento e o de antes desta
 * otimizacao. O unico caso em que o carimbo NAO avanca e aquele em que toda coluna e
 * literalmente identica a que ja esta no banco — ou seja, quando avanca-lo nao
 * representaria alteracao nenhuma para ninguem.
 */
const OMIE_CUSTOMER_CHANGED_SQL = OMIE_CUSTOMER_DATA_COLUMNS.map(
  ({ column, expr }) => `(${expr}) IS NOT customers.${column}`
).join("\n        OR ");

const OMIE_CUSTOMER_SET_SQL = OMIE_CUSTOMER_DATA_COLUMNS.map(
  ({ column, expr }) => `      ${column} = ${expr}`
).join(",\n");

function upsertOmieCustomers(
  database: DesktopDatabase,
  companyId: string,
  customers: OmieReferenceCustomer[]
): number {
  const findLocalId = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND omie_customer_id = ? LIMIT 1"
  );
  const findByIntegrationCode = database.prepare(
    "SELECT id FROM customers WHERE company_id = ? AND omie_integration_code = ? LIMIT 1"
  );
  // Sem mascara dos dois lados: o OMIE devolve "06.020.284/0001-64" e o cadastro nascido na
  // balanca guarda "06020284000164". Comparando literal, o pull nunca reconhecia o cliente
  // que ja existia aqui e criava um `omie_<id>` do lado — e o mesmo cliente passava a ter
  // dois cadastros, com as pesagens divididas entre eles.
  const findByDocument = database.prepare(
    `SELECT id FROM customers
     WHERE company_id = ? AND ${DOCUMENT_KEY_SQL} = ? AND deleted_at IS NULL
     LIMIT 1`
  );
  const upsert = database.prepare(`
    INSERT INTO customers (
      id, company_id, omie_customer_id, omie_integration_code, source, legal_name, trade_name,
      document, state_registration, municipal_registration, is_individual,
      email, fiscal_emails, homepage, contact_name, phone, phone_secondary,
      zipcode, address_street, address_number, address_complement,
      neighborhood, city, state, country, country_code,
      ibge_city_code, ibge_state_code, customer_type, is_foreign,
      omie_billing_blocked, observations, tags_json, salesperson_id,
      default_payment_term_id, is_active, sync_status, last_synced_at,
      omie_updated_at, needs_push, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'omie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET
${OMIE_CUSTOMER_SET_SQL},
      last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      omie_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      -- O carimbo so anda quando alguma coluna de dado mudou de fato.
      --
      -- Ele nao e enfeite: o cursor do push do cadastro compartilhado e keyset em
      -- updated_at, entao carimbar a linha inteira a cada passada do OMIE fazia o
      -- cadastro INTEIRO ser republicado na nuvem toda vez -- 860 mil UPDATEs em 1.581
      -- clientes, 350 mil em 167 produtos. E, do outro lado, cada UPDATE desses movia o
      -- updated_at da nuvem, entao o pull incremental de 15 s das outras balancas
      -- rebaixava o cadastro completo em vez de nada. O sincronismo incremental existia no
      -- codigo mas nunca era incremental na pratica.
      --
      -- As demais colunas continuam sendo gravadas exatamente como antes: se o valor e o
      -- mesmo, reescreve-lo e no-op; se e diferente, a condicao abaixo e verdadeira.
      updated_at = CASE
        WHEN ${OMIE_CUSTOMER_CHANGED_SQL}
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ELSE customers.updated_at
      END
  `);

  const softDeleteNonCustomer = database.prepare(`
    UPDATE customers
    SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        is_active = 0,
        needs_push = 0,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND deleted_at IS NULL
  `);

  let persisted = 0;
  for (const customer of customers) {
    const existing = findLocalId.get(companyId, customer.id) as { id: string } | undefined;
    const byIntegrationCode = customer.integrationCode
      ? (findByIntegrationCode.get(companyId, customer.integrationCode) as
          | { id: string }
          | undefined)
      : undefined;
    const customerDocumentKey = documentKey(customer.document);
    const byDocument = customerDocumentKey
      ? (findByDocument.get(companyId, customerDocumentKey) as { id: string } | undefined)
      : undefined;
    const localId =
      existing?.id ??
      byIntegrationCode?.id ??
      byDocument?.id ??
      resolveOmieLocalId(database, "customers", companyId, `omie_${customer.id}`);
    // Fornecedor/transportadora que nao e cliente nao entra (nem volta) no cadastro de
    // clientes: a projecao da nuvem tambem e uma porta de entrada e, sem isso, o cadastro
    // limpo pela sincronizacao com o OMIE voltava sujo no proximo pull.
    if (
      !isOmieCustomerCadastro({
        tags: customer.tagsJson ?? undefined,
        customerType: customer.customerType ?? undefined
      })
    ) {
      softDeleteNonCustomer.run(localId);
      continue;
    }
    upsert.run(
      localId,
      companyId,
      customer.id,
      customer.integrationCode ?? null,
      customer.name,
      customer.tradeName || customer.name,
      customer.document,
      customer.stateRegistration ?? null,
      customer.municipalRegistration ?? null,
      customer.isIndividual ? 1 : 0,
      customer.email,
      customer.fiscalEmails ?? null,
      customer.homepage ?? null,
      customer.contactName ?? null,
      customer.phone,
      customer.phoneSecondary ?? null,
      customer.zipcode,
      customer.addressStreet,
      customer.addressNumber,
      customer.addressComplement ?? null,
      customer.neighborhood,
      customer.city,
      customer.state,
      customer.country ?? null,
      customer.countryCode ?? null,
      customer.ibgeCityCode ?? null,
      customer.ibgeStateCode ?? null,
      customer.customerType ?? null,
      customer.isForeign ? 1 : 0,
      customer.billingBlocked ? 1 : 0,
      customer.observations ?? null,
      customer.tagsJson ? JSON.stringify(customer.tagsJson) : null,
      customer.salespersonId ?? null,
      customer.defaultPaymentTermId,
      customer.isActive === false ? 0 : 1
    );
    persisted++;
  }
  return persisted;
}

/**
 * As colunas de DADOS do upsert de produtos vindo do OMIE. Mesma ideia da lista de
 * clientes acima: dela saem tanto a clausula SET quanto o teste de "mudou alguma coisa?",
 * para nao existir a possibilidade de uma coluna ficar de fora so do segundo.
 *
 * Produto era o caso mais extremo do carimbo a toa: 167 linhas com 349.787 UPDATEs na
 * nuvem, 2.094 por linha. Aqui o OMIE manda em tudo (nao ha o needs_push do cliente), entao
 * toda coluna e excluded; a excecao e deleted_at, que nao viaja no INSERT e cujo valor novo
 * e o literal NULL -- e a comparacao dele que faz um produto reativado no OMIE contar como
 * mudanca.
 *
 * updated_from_omie_at e updated_at ficam de fora pelo mesmo motivo de sempre: valem now()
 * a cada passada e tornariam a condicao sempre verdadeira.
 */
const OMIE_PRODUCT_DATA_COLUMNS: readonly OmieUpsertColumn[] = [
  omieOwned("company_id"),
  omieOwned("omie_product_id"),
  omieOwned("omie_integration_code"),
  omieOwned("code"),
  omieOwned("description"),
  omieOwned("detailed_description"),
  omieOwned("unit"),
  omieOwned("ncm"),
  omieOwned("ean"),
  omieOwned("unit_price_cents"),
  omieOwned("family_code"),
  omieOwned("family_description"),
  omieOwned("brand"),
  omieOwned("model"),
  omieOwned("internal_notes"),
  omieOwned("gross_weight_kg"),
  omieOwned("net_weight_kg"),
  omieOwned("height_m"),
  omieOwned("width_m"),
  omieOwned("depth_m"),
  omieOwned("cest"),
  omieOwned("item_type"),
  omieOwned("icms_origin"),
  omieOwned("blocked"),
  omieOwned("tracks_stock"),
  omieOwned("fiscal_recommendations_json"),
  omieOwned("is_active"),
  { column: "deleted_at", expr: "NULL" }
];

const OMIE_PRODUCT_CHANGED_SQL = OMIE_PRODUCT_DATA_COLUMNS.map(
  ({ column, expr }) => `(${expr}) IS NOT products.${column}`
).join("\n        OR ");

const OMIE_PRODUCT_SET_SQL = OMIE_PRODUCT_DATA_COLUMNS.map(
  ({ column, expr }) => `      ${column} = ${expr}`
).join(",\n");

function upsertOmieProducts(
  database: DesktopDatabase,
  companyId: string,
  products: OmieReferenceProduct[]
): number {
  const removeFromKyberRock = database.prepare(`
    UPDATE products
    SET is_active = 0,
        deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_from_omie_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE company_id = ?
      AND omie_product_id = ?
  `);
  const upsert = database.prepare(`
    INSERT INTO products (
      id, company_id, omie_product_id, omie_integration_code, code, description,
      detailed_description, unit, ncm, ean, unit_price_cents,
      family_code, family_description, brand, model, internal_notes,
      gross_weight_kg, net_weight_kg, height_m, width_m, depth_m,
      cest, item_type, icms_origin, blocked, tracks_stock, fiscal_recommendations_json,
      is_active, updated_from_omie_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET
${OMIE_PRODUCT_SET_SQL},
      updated_from_omie_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      -- So anda quando alguma coluna mudou de fato: ver a nota do upsert de clientes.
      -- Produto era o caso mais extremo -- 167 linhas, 349.787 UPDATEs na nuvem.
      updated_at = CASE
        WHEN ${OMIE_PRODUCT_CHANGED_SQL}
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ELSE products.updated_at
      END
  `);

  let synced = 0;
  for (const product of products) {
    if (
      !isSellableProduct({
        omieProductId: product.id,
        itemType: product.itemType ?? null,
        fiscalRecommendations: product.fiscalRecommendations ?? null,
        isActive: product.isActive !== false,
        blocked: product.blocked === true
      })
    ) {
      removeFromKyberRock.run(companyId, product.id);
      continue;
    }

    upsert.run(
      findProductLocalId(database, companyId, product.id) ??
        resolveOmieLocalId(database, "products", companyId, `omie_${product.id}`),
      companyId,
      product.id,
      product.integrationCode ?? null,
      product.code || `PROD_${product.id}`,
      product.description,
      product.detailedDescription ?? null,
      product.unit || "UN",
      product.ncm,
      product.ean,
      product.unitPriceCents,
      product.familyCode ?? null,
      product.familyDescription ?? null,
      product.brand ?? null,
      product.model ?? null,
      product.internalNotes ?? null,
      product.grossWeightKg ?? null,
      product.netWeightKg ?? null,
      product.heightM ?? null,
      product.widthM ?? null,
      product.depthM ?? null,
      product.cest ?? null,
      product.itemType ?? null,
      product.icmsOrigin ?? null,
      product.blocked ? 1 : 0,
      product.tracksStock === false ? 0 : 1,
      product.fiscalRecommendations ? JSON.stringify(product.fiscalRecommendations) : null,
      product.isActive === false ? 0 : 1
    );
    synced++;
  }
  return synced;
}

/** Produto ja espelhado nesta empresa, achado pelo id do OMIE. */
function findProductLocalId(
  database: DesktopDatabase,
  companyId: string,
  omieProductId: number
): string | null {
  const row = database
    .prepare("SELECT id FROM products WHERE company_id = ? AND omie_product_id = ? LIMIT 1")
    .get(companyId, omieProductId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * As colunas de DADOS do upsert de transportadoras vindas do OMIE (o cadastro de
 * fornecedores). Mesma ideia das listas de clientes e produtos acima.
 *
 * Duas colunas nao sao `excluded` e precisam entrar na deteccao pelo valor EFETIVO, nao
 * pelo literal: `sync_status` e `needs_push` dependem do estado atual da linha. Se
 * ficassem de fora, uma transportadora que acabou de ser sincronizada com o OMIE mudaria
 * de estado sem que as outras balancas ficassem sabendo.
 */
const OMIE_CARRIER_DATA_COLUMNS: readonly OmieUpsertColumn[] = [
  omieOwned("company_id"),
  omieOwned("omie_customer_id"),
  omieOwned("omie_integration_code"),
  omieOwned("name"),
  omieOwned("document"),
  omieOwned("phone"),
  omieOwned("email"),
  omieOwned("zipcode"),
  omieOwned("address_street"),
  omieOwned("address_number"),
  omieOwned("address_complement"),
  omieOwned("neighborhood"),
  omieOwned("city"),
  omieOwned("state"),
  omieOwned("is_active"),
  {
    column: "sync_status",
    expr: "CASE WHEN carriers.needs_push = 0 THEN 'synced' ELSE carriers.sync_status END"
  },
  {
    column: "needs_push",
    expr: "CASE WHEN carriers.needs_push = 0 THEN 0 ELSE carriers.needs_push END"
  },
  { column: "deleted_at", expr: "NULL" }
];

const OMIE_CARRIER_CHANGED_SQL = OMIE_CARRIER_DATA_COLUMNS.map(
  ({ column, expr }) => `(${expr}) IS NOT carriers.${column}`
).join("\n        OR ");

const OMIE_CARRIER_SET_SQL = OMIE_CARRIER_DATA_COLUMNS.map(
  ({ column, expr }) => `      ${column} = ${expr}`
).join(",\n");

function upsertOmieSuppliers(
  database: DesktopDatabase,
  companyId: string,
  suppliers: OmieReferenceSupplier[]
): number {
  const upsert = database.prepare(`
    INSERT INTO carriers (
      id, company_id, omie_customer_id, omie_integration_code, name, document,
      phone, email, zipcode, address_street, address_number, address_complement,
      neighborhood, city, state, source, sync_status, needs_push, last_synced_at,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'omie', 'synced', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET
${OMIE_CARRIER_SET_SQL},
      last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      -- So anda quando alguma coluna mudou de fato: ver a nota do upsert de clientes.
      -- Transportadora: 463 linhas, 81.889 UPDATEs na nuvem.
      updated_at = CASE
        WHEN ${OMIE_CARRIER_CHANGED_SQL}
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ELSE carriers.updated_at
      END
  `);

  let persisted = 0;
  for (const supplier of suppliers) {
    if (!Number.isFinite(supplier.id) || !supplier.name.trim()) continue;
    const localId =
      findCarrierLocalId(database, companyId, supplier) ??
      resolveOmieLocalId(database, "carriers", companyId, `omie_supplier_${supplier.id}`);
    upsert.run(
      localId,
      companyId,
      supplier.id,
      supplier.integrationCode ?? null,
      supplier.name,
      supplier.document ?? null,
      supplier.phone ?? null,
      supplier.email ?? null,
      supplier.zipcode ?? null,
      supplier.addressStreet ?? null,
      supplier.addressNumber ?? null,
      supplier.addressComplement ?? null,
      supplier.neighborhood ?? null,
      supplier.city ?? null,
      supplier.state ?? null,
      supplier.isActive === false ? 0 : 1
    );
    persisted++;
  }
  return persisted;
}

export function upsertOmiePaymentTerms(
  database: DesktopDatabase,
  companyId: string,
  paymentTerms: OmieReferencePaymentTerm[]
): number {
  const upsert = database.prepare(`
    INSERT INTO omie_payment_terms (
      id, company_id, omie_id, code, description,
      first_installment_days, installment_interval_days, installment_count,
      installment_type, installment_days_json, is_active, visible,
      updated_from_omie_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(company_id, code) DO UPDATE SET
      omie_id = excluded.omie_id,
      description = excluded.description,
      first_installment_days = excluded.first_installment_days,
      installment_interval_days = excluded.installment_interval_days,
      installment_count = excluded.installment_count,
      installment_type = excluded.installment_type,
      installment_days_json = excluded.installment_days_json,
      is_active = excluded.is_active,
      visible = excluded.visible,
      updated_from_omie_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);

  const findByCode = database.prepare(
    "SELECT id FROM omie_payment_terms WHERE company_id = ? AND code = ? LIMIT 1"
  );

  let persisted = 0;
  for (const term of paymentTerms) {
    // code e o identificador do codigo_parcela do OMIE; preserva zeros a esquerda (TEXT).
    const code = (term.code ?? "").trim();
    if (!code) continue;
    // O id derivado (`omie_parcela_<codigo>`) nao carrega empresa, mas a clausula
    // de conflito cobre so (company_id, code). Numa maquina que ja espelhou o
    // OMIE de outra pedreira o INSERT nao casava com o conflito, batia na chave
    // primaria e estourava — derrubando a pagina inteira, clientes incluidos.
    const existing = findByCode.get(companyId, code) as { id: string } | undefined;
    upsert.run(
      existing?.id ??
        resolveOmieLocalId(database, "omie_payment_terms", companyId, `omie_parcela_${code}`, {
          adoptSetupCompanyRows: false
        }),
      companyId,
      Number.isFinite(term.id) ? term.id : null,
      code,
      term.description?.trim() || code,
      term.firstInstallmentDays ?? null,
      term.installmentIntervalDays ?? null,
      term.installmentCount ?? null,
      term.installmentType ?? null,
      term.installmentDaysJson ? JSON.stringify(term.installmentDaysJson) : null,
      term.isActive === false ? 0 : 1,
      term.visible === false ? 0 : 1
    );
    persisted++;
  }
  return persisted;
}

/**
 * Espelha o plano gerencial do OMIE em omie_categories (idempotente por
 * company_id + code). E o que alimenta a escolha de categoria por produto: sem
 * esta gravacao a tela Produtos so mostrava o aviso de "nenhuma categoria
 * sincronizada" e todo pedido saia na categoria fixa "1.01.01".
 */
export function upsertOmieCategories(
  database: DesktopDatabase,
  companyId: string,
  categories: OmieReferenceCategory[]
): number {
  const findByCode = database.prepare(
    "SELECT id FROM omie_categories WHERE company_id = ? AND code = ? LIMIT 1"
  );
  const update = database.prepare(
    `UPDATE omie_categories
        SET description = ?, category_type = ?, parent_code = ?, is_active = ?,
            updated_from_omie_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  );
  const insert = database.prepare(
    `INSERT INTO omie_categories
       (id, company_id, code, description, category_type, parent_code, is_active,
        updated_from_omie_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  );

  let persisted = 0;
  for (const category of categories) {
    const code = (category.code ?? "").trim();
    const description = (category.description ?? "").trim();
    if (!code || !description) continue;
    const isActive = category.isActive === false ? 0 : 1;
    const existing = findByCode.get(companyId, code) as { id: string } | undefined;
    if (existing) {
      update.run(
        description,
        category.categoryType?.trim() || null,
        category.parentCode?.trim() || null,
        isActive,
        existing.id
      );
    } else {
      insert.run(
        randomUUID(),
        companyId,
        code,
        description,
        category.categoryType?.trim() || null,
        category.parentCode?.trim() || null,
        isActive
      );
    }
    persisted++;
  }
  return persisted;
}

function findCarrierLocalId(
  database: DesktopDatabase,
  companyId: string,
  supplier: OmieReferenceSupplier
): string | null {
  const byOmieId = database
    .prepare(`SELECT id FROM carriers WHERE company_id = ? AND omie_customer_id = ? LIMIT 1`)
    .get(companyId, supplier.id) as { id: string } | undefined;

  if (byOmieId?.id) return byOmieId.id;

  if (supplier.integrationCode) {
    const byIntegrationCode = database
      .prepare(`SELECT id FROM carriers WHERE company_id = ? AND omie_integration_code = ? LIMIT 1`)
      .get(companyId, supplier.integrationCode) as { id: string } | undefined;

    if (byIntegrationCode?.id) return byIntegrationCode.id;
  }

  // Mesma normalizacao do cliente, e pelo mesmo motivo: o documento do OMIE vem com
  // mascara e o daqui sem, e a comparacao literal duplicava a transportadora.
  const supplierDocumentKey = documentKey(supplier.document);
  if (supplierDocumentKey) {
    const byDocument = database
      .prepare(
        `SELECT id FROM carriers
         WHERE company_id = ? AND ${DOCUMENT_KEY_SQL} = ? AND deleted_at IS NULL
         LIMIT 1`
      )
      .get(companyId, supplierDocumentKey) as { id: string } | undefined;

    if (byDocument?.id) return byDocument.id;
  }

  return null;
}

export async function pullCompanyPricePasswordFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("companies")
    .select("price_change_password")
    .eq("id", identity.companyId)
    .single();

  if (error || !data) return false;

  database
    .prepare(
      `
    UPDATE companies
    SET price_change_password = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `
    )
    .run(String(data.price_change_password ?? "0000"), identity.companyId);

  return true;
}

// ---------------------------------------------------------------------------
// Cadastro compartilhado da pedreira (push)
//
// Todo desktop da mesma pedreira precisa ver o mesmo cadastro. O push envia para
// a nuvem, em lotes e por ordem de dependencia, o que esta maquina conhece;
// o desktop-pull devolve o conjunto para as demais. O avanco e controlado por um
// cursor (updated_at, id) por entidade, entao cada ciclo manda so o que mudou.
//
// O cursor normaliza o formato do updated_at ("2026-07-28 10:00:00" gravado pelo
// SQLite e "2026-07-28T10:00:00.000Z" gravado a partir da nuvem) para os dois
// ordenarem igual.
// ---------------------------------------------------------------------------

const CADASTRO_PUSH_STATE_KEY = "cloud_cadastro_push_state";
const CADASTRO_PUSH_BATCH_SIZE = 100;
const CADASTRO_PUSH_MAX_ROUNDS = 60;
/** Linhas seguidas rejeitadas, sem nenhuma aceita, que caracterizam falha sistemica. */
const CADASTRO_PUSH_SYSTEMIC_PROBE = 2;

interface CadastroCursor {
  at: string;
  id: string;
}

type CadastroPushState = Record<string, CadastroCursor | undefined>;

interface CadastroPushEntity {
  /** Chave do payload aceita pela edge function desktop-sync. */
  key: string;
  /** Nome legivel usado nas mensagens de erro. */
  label: string;
  /** SELECT com os parametros nomeados @companyId, @cursorAt, @cursorId e @limit. */
  sql: string;
  map: (row: Record<string, unknown>, companyId: string) => Record<string, unknown>;
  /**
   * Colunas do payload cujo dono e a balanca principal, quando o dono e de PARTE da linha.
   *
   * Preco e uma entidade inteira: a secundaria deixa de publicar a chave e pronto. O bloco
   * comercial do cliente nao da para resolver assim — o cliente tem de continuar sendo
   * publicado por qualquer balanca, porque nome, documento e endereco nao tem dono. Entao a
   * secundaria publica a linha SEM estas colunas, e o upsert do `desktop-sync` preserva o
   * que a nuvem ja tem nelas (coluna ausente do payload nao entra no SET).
   */
  masteredColumns?: readonly string[];
}

function cursorExpression(alias: string, column: string): string {
  return `REPLACE(SUBSTR(${alias}.${column}, 1, 19), 'T', ' ')`;
}

function buildCadastroSelect(options: {
  table: string;
  alias: string;
  columns: string;
  joins?: string;
  where: string;
  /** Coluna que ordena o cursor. O log de credito e imutavel e so tem created_at. */
  cursorColumn?: string;
}): string {
  const cursor = cursorExpression(options.alias, options.cursorColumn ?? "updated_at");
  return `
    SELECT ${options.columns}, ${cursor} AS cursor_at
    FROM ${options.table} ${options.alias}
    ${options.joins ?? ""}
    WHERE ${options.where}
      AND (
        @cursorAt IS NULL
        OR ${cursor} > @cursorAt
        OR (${cursor} = @cursorAt AND ${options.alias}.id > @cursorId)
      )
    ORDER BY cursor_at ASC, ${options.alias}.id ASC
    LIMIT @limit
  `;
}

function cloudTimestamp(value: unknown, fallback: string): string {
  const text = stringValue(value);
  if (!text) return fallback;
  const normalized = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

// is_active na nuvem embute a exclusao logica local: as tabelas espelhadas de
// cadastro nao tem deleted_at, entao um registro apagado aqui vira inativo la.
function cloudActive(row: Record<string, unknown>): boolean {
  return Number(row.is_active ?? 1) === 1 && !row.deleted_at;
}

const CADASTRO_PUSH_ENTITIES: readonly CadastroPushEntity[] = [
  {
    key: "customers",
    label: "clientes",
    sql: buildCadastroSelect({
      table: "customers",
      alias: "c",
      columns:
        "c.id, c.omie_customer_id, c.legal_name, c.trade_name, c.document, c.phone, c.email, c.credit_limit_cents, c.open_receivables_cents, c.default_freight_modality, c.default_payment_method_id, c.default_carrier_id, c.nf_required, c.credit_mode, c.credit_account_enabled, c.credit_periodicity, c.credit_closing_day, c.credit_second_closing_day, c.credit_boleto_days, c.credit_second_boleto_days, c.credit_closing_weekday, c.is_active, c.created_at, c.updated_at, c.deleted_at",
      where: "c.company_id = @companyId"
    }),
    // O bloco comercial/credito e da balanca principal. A secundaria continua publicando o
    // cliente (nome, documento, telefone, limite), so que sem estas colunas.
    masteredColumns: MASTERED_CUSTOMER_PAYLOAD_COLUMNS,
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      const legalName = stringValue(row.legal_name) || stringValue(row.trade_name) || "Cliente";
      return {
        id: stringValue(row.id),
        company_id: companyId,
        omie_customer_id: integerValue(row.omie_customer_id),
        legal_name: legalName,
        trade_name: stringValue(row.trade_name) || legalName,
        document: nullableStringValue(row.document),
        phone: nullableStringValue(row.phone),
        email: nullableStringValue(row.email),
        credit_limit_cents: integerValue(row.credit_limit_cents),
        open_receivables_cents: integerValue(row.open_receivables_cents) ?? 0,
        // Tipo de frete padrao da aba Transporte. Coluna nova na nuvem: enquanto a
        // migracao nao for aplicada o `desktop-sync` a descarta do payload e regrava o
        // resto (ver `_shared/unknown-column.ts`), entao o cadastro nao para por causa dela.
        default_freight_modality: nullableStringValue(row.default_freight_modality),
        // Bloco comercial/credito da aba Comercial. Vai inteiro, com os nulos: e assim que
        // "sem transportadora padrao" chega as demais maquinas. A marca de publicacao e o
        // que permite a secundaria distinguir esse nulo de "ninguem publicou ainda".
        default_payment_method_id: nullableStringValue(row.default_payment_method_id),
        default_carrier_id: nullableStringValue(row.default_carrier_id),
        nf_required: Number(row.nf_required ?? 1) === 1,
        credit_mode: stringValue(row.credit_mode) || "normal",
        credit_account_enabled: Number(row.credit_account_enabled ?? 0) === 1,
        credit_periodicity: stringValue(row.credit_periodicity) || "monthly",
        credit_closing_day: integerValue(row.credit_closing_day),
        credit_second_closing_day: integerValue(row.credit_second_closing_day),
        credit_boleto_days: integerValue(row.credit_boleto_days),
        credit_second_boleto_days: integerValue(row.credit_second_boleto_days),
        credit_closing_weekday: integerValue(row.credit_closing_weekday),
        commercial_published_at: updatedAt,
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "products",
    label: "produtos",
    sql: buildCadastroSelect({
      table: "products",
      alias: "p",
      columns:
        "p.id, p.omie_product_id, p.code, p.description, p.unit, p.is_active, p.created_at, p.updated_at, p.deleted_at",
      where: "p.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        omie_product_id: integerValue(row.omie_product_id),
        code: stringValue(row.code) || stringValue(row.id),
        description: stringValue(row.description) || "Produto",
        unit: stringValue(row.unit) || "KG",
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "carriers",
    label: "transportadoras",
    sql: buildCadastroSelect({
      table: "carriers",
      alias: "ca",
      columns:
        "ca.id, ca.omie_customer_id, ca.name, ca.document, ca.source, ca.is_active, ca.created_at, ca.updated_at, ca.deleted_at",
      where: "ca.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        omie_customer_id: integerValue(row.omie_customer_id),
        name: stringValue(row.name) || "Transportadora",
        document: nullableStringValue(row.document),
        source: stringValue(row.source) === "omie" ? "omie" : "local",
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "drivers",
    label: "motoristas",
    sql: buildCadastroSelect({
      table: "drivers",
      alias: "d",
      columns:
        "d.id, d.name, d.document, d.phone, d.is_independent, d.is_active, d.created_at, d.updated_at, d.deleted_at",
      where: "d.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        name: stringValue(row.name) || "Motorista",
        document: nullableStringValue(row.document),
        phone: nullableStringValue(row.phone),
        is_independent: Number(row.is_independent ?? 0) === 1,
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "vehicles",
    label: "veiculos",
    sql: buildCadastroSelect({
      table: "vehicles",
      alias: "v",
      columns:
        "v.id, v.plate, v.description, v.carrier_id, v.is_active, v.created_at, v.updated_at, v.deleted_at",
      where: "v.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        plate: stringValue(row.plate),
        description: nullableStringValue(row.description),
        carrier_id: nullableStringValue(row.carrier_id),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "customerCarriers",
    label: "vinculos cliente/transportadora",
    sql: buildCadastroSelect({
      table: "customer_carriers",
      alias: "cc",
      columns:
        "cc.id, cc.customer_id, cc.carrier_id, cc.is_active, cc.created_at, cc.updated_at, cc.deleted_at",
      joins: "JOIN customers cust ON cust.id = cc.customer_id",
      where: "cust.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        customer_id: stringValue(row.customer_id),
        carrier_id: stringValue(row.carrier_id),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "customerVehicles",
    label: "placas do cliente",
    sql: buildCadastroSelect({
      table: "customer_vehicles",
      alias: "cv",
      columns:
        "cv.id, cv.customer_id, cv.vehicle_id, cv.is_active, cv.created_at, cv.updated_at, cv.deleted_at",
      joins: "JOIN customers cvc ON cvc.id = cv.customer_id",
      where: "cvc.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        customer_id: stringValue(row.customer_id),
        vehicle_id: stringValue(row.vehicle_id),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "driverCarriers",
    label: "vinculos motorista/transportadora",
    sql: buildCadastroSelect({
      table: "driver_carriers",
      alias: "dc",
      columns:
        "dc.id, dc.driver_id, dc.carrier_id, dc.is_active, dc.created_at, dc.updated_at, dc.deleted_at",
      joins: "JOIN drivers drv ON drv.id = dc.driver_id",
      where: "drv.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        driver_id: stringValue(row.driver_id),
        carrier_id: stringValue(row.carrier_id),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "vehicleCarriers",
    label: "vinculos veiculo/transportadora",
    sql: buildCadastroSelect({
      table: "vehicle_carriers",
      alias: "vc",
      columns:
        "vc.id, vc.vehicle_id, vc.carrier_id, vc.is_active, vc.created_at, vc.updated_at, vc.deleted_at",
      joins: "JOIN vehicles veh ON veh.id = vc.vehicle_id",
      where: "veh.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        vehicle_id: stringValue(row.vehicle_id),
        carrier_id: stringValue(row.carrier_id),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt
      };
    }
  },
  {
    key: "productDefaultPrices",
    label: "precos padrao",
    sql: buildCadastroSelect({
      table: "product_default_prices",
      alias: "pp",
      columns:
        "pp.id, pp.product_id, pp.unit_price_cents, pp.unit, pp.valid_from, pp.valid_to, pp.is_active, pp.created_at, pp.updated_at, pp.deleted_at",
      where: "pp.company_id = @companyId AND pp.unit_price_cents > 0"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        product_id: stringValue(row.product_id),
        unit_price_cents: integerValue(row.unit_price_cents),
        unit: stringValue(row.unit) || "ton",
        valid_from: nullableStringValue(row.valid_from),
        valid_to: nullableStringValue(row.valid_to),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "customerSpecialPrices",
    label: "precos especiais",
    sql: buildCadastroSelect({
      table: "customer_special_prices",
      alias: "sp",
      columns:
        "sp.id, sp.customer_id, sp.product_id, sp.unit_price_cents, sp.unit, sp.is_active, sp.created_at, sp.updated_at, sp.deleted_at",
      where: "sp.company_id = @companyId AND sp.unit_price_cents > 0"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        customer_id: stringValue(row.customer_id),
        product_id: stringValue(row.product_id),
        unit_price_cents: integerValue(row.unit_price_cents),
        unit: stringValue(row.unit) || "ton",
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "priceTables",
    label: "tabelas de preco",
    sql: buildCadastroSelect({
      table: "price_tables",
      alias: "pt",
      columns:
        "pt.id, pt.name, pt.is_active, pt.valid_from, pt.valid_to, pt.created_at, pt.updated_at, pt.deleted_at",
      where: "pt.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        name: stringValue(row.name) || "Tabela de preco",
        is_active: cloudActive(row),
        valid_from: nullableStringValue(row.valid_from),
        valid_to: nullableStringValue(row.valid_to),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "priceTableItems",
    label: "itens da tabela de preco",
    sql: buildCadastroSelect({
      table: "price_table_items",
      alias: "pti",
      columns:
        "pti.id, pti.price_table_id, pti.product_id, pti.unit_price_cents, pti.unit, pti.valid_from, pti.valid_to, pti.created_at, pti.updated_at, pti.deleted_at",
      joins: "JOIN price_tables ptp ON ptp.id = pti.price_table_id",
      where: "ptp.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        price_table_id: stringValue(row.price_table_id),
        product_id: stringValue(row.product_id),
        unit_price_cents: integerValue(row.unit_price_cents),
        unit: stringValue(row.unit) || "ton",
        valid_from: nullableStringValue(row.valid_from),
        valid_to: nullableStringValue(row.valid_to),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "customerPriceTables",
    label: "tabelas de preco por cliente",
    sql: buildCadastroSelect({
      table: "customer_price_tables",
      alias: "cpt",
      columns:
        "cpt.id, cpt.customer_id, cpt.price_table_id, cpt.valid_from, cpt.valid_to, cpt.is_active, cpt.created_at, cpt.updated_at, cpt.deleted_at",
      joins: "JOIN customers cptc ON cptc.id = cpt.customer_id",
      where: "cptc.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        customer_id: stringValue(row.customer_id),
        price_table_id: stringValue(row.price_table_id),
        valid_from: nullableStringValue(row.valid_from),
        valid_to: nullableStringValue(row.valid_to),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "customerFreightRules",
    label: "regras de frete",
    sql: buildCadastroSelect({
      table: "customer_freight_rules",
      alias: "fr",
      columns:
        "fr.id, fr.customer_id, fr.product_id, fr.rule_json, fr.is_active, fr.created_at, fr.updated_at, fr.deleted_at",
      joins: "JOIN customers frc ON frc.id = fr.customer_id",
      where: "frc.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        customer_id: stringValue(row.customer_id),
        product_id: nullableStringValue(row.product_id),
        rule_json: parseJsonValue(row.rule_json) ?? {},
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "customerFutureBillingInvoices",
    label: "notas de entrega futura",
    sql: buildCadastroSelect({
      table: "customer_future_billing_invoices",
      alias: "fb",
      columns:
        "fb.id, fb.customer_id, fb.product_id, fb.nfe_number, fb.total_weight_kg, fb.is_active, fb.created_at, fb.updated_at, fb.deleted_at",
      joins: "JOIN customers fbc ON fbc.id = fb.customer_id",
      where: "fbc.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        customer_id: stringValue(row.customer_id),
        product_id: nullableStringValue(row.product_id),
        nfe_number: stringValue(row.nfe_number),
        // Total faturado na nota, em kg. Projetado porque o saldo tem de ser o MESMO nas
        // duas balancas da pedreira: as pesagens ja atravessam a nuvem, entao sem o total
        // do outro lado a segunda maquina somaria retiradas contra um teto que nao conhece.
        total_weight_kg: numberValue(row.total_weight_kg),
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "paymentTerms",
    label: "condicoes de pagamento",
    sql: buildCadastroSelect({
      table: "payment_terms",
      alias: "ptm",
      columns:
        "ptm.id, ptm.omie_code, ptm.name, ptm.rules_json, ptm.is_active, ptm.created_at, ptm.updated_at, ptm.deleted_at",
      where: "ptm.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        omie_code: nullableStringValue(row.omie_code),
        name: stringValue(row.name) || "Condicao de pagamento",
        rules_json: parseJsonValue(row.rules_json) ?? {},
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "paymentMethods",
    label: "formas de pagamento",
    sql: buildCadastroSelect({
      table: "payment_methods",
      alias: "pm",
      columns:
        "pm.id, pm.code, pm.name, pm.alias, pm.omie_code, pm.is_system, pm.is_customer_credit, pm.is_wallet, pm.sort_order, pm.is_active, pm.created_at, pm.updated_at, pm.deleted_at",
      where: "pm.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        code: stringValue(row.code) || stringValue(row.id),
        name: stringValue(row.name) || "Forma de pagamento",
        // Apelido dado pela pedreira ("Em carteira" -> "Fiado", ...). E o nome que a
        // Carteira e o seletor de pagamento exibem; sem projetar, cada computador
        // mostrava um rotulo diferente para a mesma forma.
        alias: nullableStringValue(row.alias),
        omie_code: nullableStringValue(row.omie_code),
        is_system: Number(row.is_system ?? 0) === 1,
        is_customer_credit: Number(row.is_customer_credit ?? 0) === 1,
        is_wallet: Number(row.is_wallet ?? 0) === 1,
        sort_order: integerValue(row.sort_order) ?? 0,
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    key: "accounts",
    label: "contas",
    sql: buildCadastroSelect({
      table: "accounts",
      alias: "ac",
      columns:
        "ac.id, ac.code, ac.name, ac.omie_code, ac.is_system, ac.sort_order, ac.is_active, ac.created_at, ac.updated_at, ac.deleted_at",
      where: "ac.company_id = @companyId"
    }),
    map: (row, companyId) => {
      const updatedAt = cloudTimestamp(row.updated_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        code: nullableStringValue(row.code),
        name: stringValue(row.name) || "Conta",
        omie_code: nullableStringValue(row.omie_code),
        is_system: Number(row.is_system ?? 0) === 1,
        sort_order: integerValue(row.sort_order) ?? 0,
        is_active: cloudActive(row),
        created_at: cloudTimestamp(row.created_at, updatedAt),
        updated_at: updatedAt,
        deleted_at: row.deleted_at ? cloudTimestamp(row.deleted_at, updatedAt) : null
      };
    }
  },
  {
    // Log de credito (fiado): registro imutavel, entao o cursor segue o
    // created_at e a nuvem so precisa acumular o que cada maquina lancou.
    key: "customerCreditMovements",
    label: "movimentos de credito",
    sql: buildCadastroSelect({
      table: "customer_credit_movements",
      alias: "cm",
      columns:
        "cm.id, cm.customer_id, cm.operation_id, cm.movement_type, cm.amount_cents, cm.balance_after_cents, cm.reason, cm.source, cm.omie_title_id, cm.created_at",
      where: "cm.company_id = @companyId",
      cursorColumn: "created_at"
    }),
    map: (row, companyId) => {
      const createdAt = cloudTimestamp(row.created_at, new Date().toISOString());
      return {
        id: stringValue(row.id),
        company_id: companyId,
        customer_id: stringValue(row.customer_id),
        operation_id: nullableStringValue(row.operation_id),
        movement_type: stringValue(row.movement_type),
        amount_cents: integerValue(row.amount_cents) ?? 0,
        balance_after_cents: integerValue(row.balance_after_cents) ?? 0,
        reason: nullableStringValue(row.reason),
        source: nullableStringValue(row.source) ?? "local",
        omie_title_id: integerValue(row.omie_title_id),
        created_at: createdAt,
        updated_at: createdAt
      };
    }
  }
];

function readCadastroPushState(database: DesktopDatabase): CadastroPushState {
  return readLocalSetting<CadastroPushState>(database, CADASTRO_PUSH_STATE_KEY) ?? {};
}

function writeCadastroPushCursor(
  database: DesktopDatabase,
  key: string,
  cursor: CadastroCursor
): void {
  const state = readCadastroPushState(database);
  writeLocalSetting(database, CADASTRO_PUSH_STATE_KEY, { ...state, [key]: cursor });
}

/**
 * Reinicia os cursores para o proximo push reenviar todo o cadastro da empresa.
 * Usado quando a maquina ainda nao publicou nada (primeira sincronizacao apos a
 * ativacao) ou quando o operador pede uma ressincronizacao completa.
 */
export function resetSharedCadastroPushState(database: DesktopDatabase): void {
  writeLocalSetting(database, CADASTRO_PUSH_STATE_KEY, {});
}

/**
 * Zera os cursores SO do cadastro de preco, para a balanca recem-eleita principal
 * republicar tudo o que ela ja tinha. Sem isso, o preco que ela cadastrou antes da eleicao
 * ja estaria "atras do cursor" e nunca chegaria as demais maquinas.
 */
function resetPriceCadastroPushCursors(database: DesktopDatabase): void {
  resetCadastroPushCursors(database, PRICE_MASTERED_CADASTRO_KEYS);
}

/**
 * Zera os cursores das entidades informadas, para o proximo push reenviar so o que elas
 * cobrem. O resto do cadastro continua de onde parou.
 */
function resetCadastroPushCursors(database: DesktopDatabase, keys: readonly string[]): void {
  const next = { ...readCadastroPushState(database) };
  for (const key of keys) {
    delete next[key];
  }
  writeLocalSetting(database, CADASTRO_PUSH_STATE_KEY, next);
}

/** As entidades que carregam colunas com dono — hoje so `customers`. */
const MASTERED_COLUMN_ENTITY_KEYS: readonly string[] = CADASTRO_PUSH_ENTITIES.filter(
  (entity) => entity.masteredColumns && entity.masteredColumns.length > 0
).map((entity) => entity.key);

/** As mesmas linhas sem as colunas cujo dono e a principal. */
function stripMasteredColumns(
  rows: Array<Record<string, unknown>>,
  columns: readonly string[]
): Array<Record<string, unknown>> {
  const drop = new Set(columns);
  return rows.map((row) => {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!drop.has(key)) kept[key] = value;
    }
    return kept;
  });
}

/**
 * Envia um lote de cadastro. Se o lote inteiro falhar, testa uma linha sozinha
 * para separar os dois casos: nuvem indisponivel / tabela ausente (falha
 * sistemica, nada avanca e o proximo ciclo repete) e registro invalido isolado
 * (as demais linhas seguem uma a uma e so a problematica vira erro) — assim uma
 * linha ruim nao trava o cadastro inteiro para sempre.
 */
async function sendCadastroBatch(
  settings: CloudSettings,
  entity: CadastroPushEntity,
  payload: Array<Record<string, unknown>>,
  errors: string[]
): Promise<{ pushed: number; systemicFailure: boolean }> {
  if (payload.length === 0) return { pushed: 0, systemicFailure: false };

  try {
    await invokeDesktopSync(settings, { [entity.key]: payload });
    return { pushed: payload.length, systemicFailure: false };
  } catch (error) {
    if (payload.length === 1) {
      errors.push(
        `Cadastro ${entity.label} (${String(payload[0].id)}): ${
          error instanceof Error ? error.message : "falha ao enviar"
        }`
      );
      return { pushed: 0, systemicFailure: true };
    }
  }

  let pushed = 0;
  let failed = 0;
  for (const row of payload) {
    try {
      await invokeDesktopSync(settings, { [entity.key]: [row] });
      pushed++;
    } catch (error) {
      failed++;
      errors.push(
        `Cadastro ${entity.label} (${String(row.id)}): ${
          error instanceof Error ? error.message : "falha ao enviar"
        }`
      );
      // Nada passou ate agora: e falha sistemica, nao adianta insistir linha a linha.
      if (pushed === 0 && failed >= CADASTRO_PUSH_SYSTEMIC_PROBE) {
        return { pushed, systemicFailure: true };
      }
    }
  }

  return { pushed, systemicFailure: pushed === 0 };
}

/**
 * Publica na nuvem o cadastro compartilhado desta maquina (clientes, produtos,
 * transportadoras, motoristas, veiculos, vinculos e precos) para as outras
 * maquinas da mesma pedreira receberem no proximo pull.
 */
export async function pushSharedCadastroToCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  options: { batchSize?: number; maxRounds?: number } = {}
): Promise<{ pushed: number; errors: string[] }> {
  const settings = getCloudSettings(database, identity);
  const batchSize = options.batchSize ?? CADASTRO_PUSH_BATCH_SIZE;
  const maxRounds = options.maxRounds ?? CADASTRO_PUSH_MAX_ROUNDS;
  const errors: string[] = [];
  let pushed = 0;

  const authority = readPriceAuthority(database, settings.deviceId);
  if (authority.mode === "master" && isPriceMasterRepublishPending(database)) {
    resetPriceCadastroPushCursors(database);
    clearPriceMasterRepublishPending(database);
  }
  // O bloco comercial/credito passou a viajar nesta versao (ou esta maquina acabou de virar
  // principal). O push do cadastro e incremental por cursor, entao sem zerar o cursor dos
  // clientes o bloco so chegaria na nuvem nos poucos que alguem editasse depois — e as
  // demais balancas continuariam divergentes. Vale para a principal E para a pedreira sem
  // principal eleita; quem nao publica o bloco e so a secundaria.
  if (authority.mode !== "follower" && isCustomerCommercialRepublishPending(database)) {
    resetCadastroPushCursors(database, MASTERED_COLUMN_ENTITY_KEYS);
    clearCustomerCommercialRepublishPending(database);
  }

  for (const entity of CADASTRO_PUSH_ENTITIES) {
    // Secundaria nao publica preco. Publicar seria devolver a disputa pelo outro lado: a
    // linha desta maquina venceria na nuvem e a principal deixaria de ser a principal.
    if (authority.mode === "follower" && isPriceMasteredCadastroKey(entity.key)) continue;
    // Entidade que ela CONTINUA publicando, mas sem as colunas com dono (o cliente e a
    // unica hoje): a linha vai sem o bloco comercial e a nuvem preserva o da principal.
    const stripColumns = authority.mode === "follower" ? (entity.masteredColumns ?? null) : null;

    let cursor = readCadastroPushState(database)[entity.key] ?? null;

    for (let round = 0; round < maxRounds; round++) {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = database.prepare(entity.sql).all({
          companyId: settings.companyId,
          cursorAt: cursor?.at ?? null,
          cursorId: cursor?.id ?? "",
          limit: batchSize
        }) as Array<Record<string, unknown>>;
      } catch (error) {
        errors.push(
          `Cadastro ${entity.label}: ${error instanceof Error ? error.message : "erro ao ler base local"}`
        );
        break;
      }

      if (rows.length === 0) break;

      const mapped = rows
        .map((row) => entity.map(row, settings.companyId))
        .filter((row) => Boolean(row.id));
      const payload = stripColumns ? stripMasteredColumns(mapped, stripColumns) : mapped;

      const sent = await sendCadastroBatch(settings, entity, payload, errors);
      pushed += sent.pushed;
      // Falha sistemica (nuvem fora do ar, tabela ausente): mantem o cursor onde
      // esta para o proximo ciclo tentar o mesmo lote de novo.
      if (sent.systemicFailure) break;

      const last = rows[rows.length - 1];
      cursor = { at: String(last.cursor_at ?? ""), id: String(last.id ?? "") };
      writeCadastroPushCursor(database, entity.key, cursor);

      if (rows.length < batchSize) break;
    }
  }

  return { pushed, errors };
}

export async function pullLoaderCompletionsFromCloud(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): Promise<{ pulled: number; errors: string[] }> {
  // A consulta precisa passar pelo desktop-pull (service role): a RLS de
  // loading_requests so permite SELECT ao perfil autenticado do carregador,
  // entao a leitura direta com a chave publishable voltava sempre vazia — e a
  // conclusao so aparecia na balanca depois do pull completo (reinicio do app).
  const settings = getCloudSettings(database, identity);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke<{
    loadingRequests?: Array<Record<string, unknown>>;
    warnings?: string[];
  }>("desktop-pull", {
    body: {
      deviceId: settings.deviceId,
      deviceToken: settings.deviceToken,
      loaderCompletionsOnly: true
    }
  });

  const errors: string[] = [];
  if (error) {
    errors.push(`pullLoaderCompletions: ${await getFunctionErrorMessage(error)}`);
    return { pulled: 0, errors };
  }
  errors.push(...(data?.warnings ?? []).map((warning) => `pullLoaderCompletions: ${warning}`));

  return { pulled: applyLoaderCompletionRows(database, data?.loadingRequests ?? []), errors };
}

/**
 * Projeta no SQLite o estado de conclusao do carregador vindo da nuvem —
 * inclusive o cancelamento (loader_completed_at de volta a NULL), que devolve a
 * carga para "aguardando" e apaga a luz verde no desktop. O campo e escrito
 * exclusivamente pelo loader-web, entao espelhar o valor da nuvem e sempre
 * correto; `updated_at` local so anda para frente para nao regredir o guard de
 * push/pull das balancas.
 */
export function applyLoaderCompletionRows(
  database: DesktopDatabase,
  rows: Array<Record<string, unknown>>
): number {
  const update = database.prepare(`
    UPDATE loading_requests
    SET loader_completed_at = ?,
        updated_at = CASE
          WHEN ? IS NOT NULL AND (updated_at IS NULL OR REPLACE(updated_at, ' ', 'T') < ?) THEN ?
          ELSE updated_at
        END
    WHERE id = ? AND loader_completed_at IS NOT ?
  `);

  let pulled = 0;
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const completedAt = isoStringValue(row.loader_completed_at);
    const updatedAt = isoStringValue(row.updated_at);
    const result = update.run(completedAt, updatedAt, updatedAt, updatedAt, id, completedAt);
    if (result.changes > 0) {
      pulled++;
    }
  }
  return pulled;
}
