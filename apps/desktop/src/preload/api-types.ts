import type { BackupResult } from "../services/backup";
import type {
  ConfigureReceiptPrintProfileInput,
  PrintProfileSummary,
  PrintReceiptSummary,
  WindowsPrinterSummary
} from "../services/printing";
import type { DesktopStatusSnapshot } from "../services/status";
import type { UpdateState } from "../services/update-flow";
import type { UpdateRing } from "../services/update-candidates";
import type {
  OperationFreightInput,
  OperationOmieIssue,
  OperationType,
  WeighingOperationSummary
} from "../services/weighing-operations";
import type { OmieCustomerReadiness } from "../services/omie-customer-readiness";
import type { FreightModality } from "../services/freight";
import type { CustomerFreightRule as CustomerFreightRuleView } from "../services/customer-freight-rules";
import type { CustomerFutureBillingInvoice as CustomerFutureBillingInvoiceView } from "../services/customer-future-billing";
import type {
  CloudBootstrapResult,
  CustomerAdvancesSyncResult,
  FiscalBillingResult,
  SyncResult
} from "../services/supabase-sync";
import type { PriceDetails } from "../services/pricing";
import type {
  CustomerSpecialPriceSummary,
  ProductDefaultPriceSummary
} from "../services/product-prices";
import type { CreditMovementRow, CustomerCreditSummary } from "../services/credit";
import type { OmieCategoryOption } from "../services/omie-categories";
import type { OmieAdvanceConfig } from "../services/omie-advance-config";
import type { CreateQuotationInput, QuotationRow, QuotationSummary } from "../services/quotations";
import type { ActivateDesktopInput, DesktopAccessStatus } from "../services/desktop-activation";
import type { UnitDeviceInfo } from "../services/unit-devices";
import type { CacheQueryOptions, CacheQueryResult } from "../services/cache-store";
import type {
  DailyReport,
  DailySeriesPoint,
  MonthlyReport,
  OperationMix,
  ProductReport,
  CustomerReport,
  SalesPivotFilters,
  SalesPivotGroupBy,
  SalesPivotResult,
  TruckControlReport
} from "../services/reports";
import type {
  CustomerReport as CustomerFullReport,
  CustomerReportOption,
  CustomerReportVariant,
  CustomersOverview
} from "../services/customer-report";
import type {
  WeighingBillingReport,
  WeighingBillingReportOptions
} from "../services/weighing-billing-report";
import type { InvoiceClosingOptions, InvoiceClosingReport } from "../services/invoice-closing";
import type {
  InvoiceClosingRunProgress,
  InvoiceClosingRunResult
} from "../services/invoice-closing-run";
import type { CreateCustomerInput, UpdateCustomerInput } from "../services/customers";
import type { UpdatePaymentMethodInput } from "../services/payment-methods";
import type { SettleWalletInput, WalletQuery, WalletReport } from "../services/wallet";
import type { UpdateAccountInput } from "../services/accounts";
import type {
  CreatePaymentTermInput,
  OmiePaymentTermOption,
  UpdatePaymentTermInput
} from "../services/payment-terms";
import type {
  AddPriceTableItemInput,
  CreatePriceTableInput,
  LinkCustomerToPriceTableInput,
  UpdatePriceTableItemInput
} from "../services/price-tables";
import type { CreateVehicleInput, UpdateVehicleInput } from "../services/vehicles";
import type { CreateDriverInput, UpdateDriverInput } from "../services/drivers";
import type { CreateCarrierInput, UpdateCarrierInput } from "../services/carriers";
import type { OmieQueueItem } from "../services/sync-queue";
import type { ScaleConfiguration, ScaleConfigurationInput } from "../services/scale-configs";
import type { SerialPortInfo } from "../services/scale-serial";
import type {
  ToledoTcpAdapterStatus,
  ParsedToledoReading,
  ScaleReading
} from "@kyberrock/scale-adapters";
import type {
  ReportChannelSettings as ReportChannelSettingsView,
  UazapiInstanceState as WhatsappInstanceStateView
} from "../services/report-channels";
import type { WhatsappConnectionLink as WhatsappConnectionLinkView } from "../services/whatsapp-connection-link";
import type {
  DispatchSendResult as ReportDispatchSendResultView,
  ReportDispatchSettings,
  ReportDispatchState
} from "../services/report-dispatch";
import type { FinancialReportDispatchResult as FinancialReportDispatchResultView } from "../services/supabase-sync";

export type {
  ReportChannelSettingsView,
  WhatsappInstanceStateView,
  WhatsappConnectionLinkView,
  ReportDispatchSendResultView,
  FinancialReportDispatchResultView
};

export interface ReportDispatchConfigView {
  settings: ReportDispatchSettings;
  state: ReportDispatchState;
}

export interface KyberRockDesktopApi {
  getStatus: (internetOnline?: boolean) => Promise<DesktopStatusSnapshot>;
  exportBackup: () => Promise<BackupResult | null>;
  restoreBackup: () => Promise<boolean>;
  getUpdateState: () => Promise<UpdateState>;
  getAccessStatus: () => Promise<DesktopAccessStatus>;
  validateDesktopAccess: (
    internetOnline?: boolean,
    force?: boolean
  ) => Promise<DesktopAccessStatus>;
  activateDesktop: (input: ActivateDesktopInput) => Promise<DesktopAccessStatus>;
  logoutDesktop: () => Promise<void>;
  checkForUpdates: () => Promise<UpdateState>;
  /**
   * `ring` so vale na balanca marcada como teste: e por ele que o operador diz
   * se instala a versao em avaliacao ou a de producao (ver
   * `services/update-candidates.ts`). Sem ele, instala o que a verificacao
   * mirou.
   */
  downloadAndInstallUpdate: (ring?: UpdateRing | null) => Promise<UpdateState>;
  listOpenWeighingOperations: () => Promise<WeighingOperationSummary[]>;
  /**
   * Transportadora/condicao/forma de pagamento da ultima entrada daquele cliente, para a
   * proxima entrada dele ja nascer preenchida. `null` quando ele ainda nao tem entrada.
   */
  getCustomerLastEntryPreferences: (customerId: string) => Promise<{
    carrierId: string | null;
    paymentTermId: string | null;
    paymentMethodId: string | null;
  } | null>;
  pullLoaderCompletions: () => Promise<{ pulled: number; errors: string[] }>;
  /** Computadores da unidade (nome + cor) para a legenda multi-desktop. */
  listUnitDevices: () => Promise<UnitDeviceInfo[]>;
  /** Pull leve da nuvem para enxergar operacoes dos outros computadores. */
  pullCloudNow: () => Promise<{ pulled: number; errors: string[] }>;
  listCanceledWeighingOperations: () => Promise<WeighingOperationSummary[]>;
  listClosedWeighingOperations: () => Promise<WeighingOperationSummary[]>;
  /**
   * Por que uma operacao concluida ainda nao chegou ao OMIE, com os campos do cadastro
   * do cliente que precisam ser corrigidos antes do reenvio.
   */
  operationOmieIssue: (operationId: string) => Promise<OperationOmieIssue>;
  /**
   * Cadastro do cliente conferido contra o que o OMIE exige para esse tipo de operacao.
   * A tela de entrada usa isto para avisar (e travar o botao) ANTES do caminhao entrar —
   * mesma regra que `startWeighing` aplica no backend.
   */
  customerOmieReadiness: (
    customerId: string,
    operationType?: "invoice" | "internal"
  ) => Promise<OmieCustomerReadiness>;
  clearCanceledWeighingOperations: () => Promise<number>;
  /** Limpa as concluidas em lote; `untilDate` preserva o movimento do dia. */
  clearClosedWeighingOperations: (options?: { untilDate?: string }) => Promise<number>;
  deleteClosedWeighingOperation: (operationId: string) => Promise<void>;
  startWeighing: (input: {
    operationType?: OperationType;
    customerId: string;
    vehicleId: string;
    carrierId?: string;
    driverId: string;
    productId: string;
    paymentTermId?: string;
    paymentMethodId?: string;
    manualInstallments?: number;
    manualDownPaymentCents?: number;
    freight?: OperationFreightInput | null;
    freightModality?: FreightModality | null;
    quotationId?: string;
    deductFreightFromCredit?: boolean;
    /** Venda em carteira abatida do adiantamento do cliente. */
    settleFromAdvance?: boolean;
    scaleCaptureId?: string;
  }) => Promise<WeighingOperationSummary>;
  closeWeighing: (
    operationId: string,
    operationType?: OperationType,
    scaleCaptureId?: string
  ) => Promise<WeighingOperationSummary>;
  cancelWeighing: (operationId: string, reason: string) => Promise<WeighingOperationSummary>;
  updateWeighingProduct: (
    operationId: string,
    newProductId: string
  ) => Promise<WeighingOperationSummary>;
  updateWeighingCustomer: (
    operationId: string,
    newCustomerId: string
  ) => Promise<WeighingOperationSummary>;
  updateWeighingCarrier: (
    operationId: string,
    newCarrierId: string | null
  ) => Promise<WeighingOperationSummary>;
  /**
   * Edicao completa de uma operacao em andamento. Cada campo e opcional: o que nao vier
   * fica como esta; `null` limpa transportadora, forma e condicao de pagamento.
   */
  updateWeighingOperation: (input: {
    operationId: string;
    customerId?: string;
    productId?: string;
    vehicleId?: string;
    driverId?: string;
    carrierId?: string | null;
    paymentMethodId?: string | null;
    paymentTermId?: string | null;
    operationType?: OperationType;
    unitPriceCents?: number;
    freight?: OperationFreightInput | null;
    freightModality?: FreightModality;
    deductFreightFromCredit?: boolean;
    settleFromAdvance?: boolean;
  }) => Promise<WeighingOperationSummary>;
  getCustomerFreightRules: (customerId: string) => Promise<CustomerFreightRuleView[]>;
  getCustomerFreightForProduct: (
    customerId: string,
    productId: string,
    /** Tipo de frete da operacao; resolve o valor configurado para ele. */
    modality?: FreightModality | null
  ) => Promise<CustomerFreightRuleView | null>;
  /**
   * Ultima observacao de frete ("Destino/obs.") escrita numa entrada desse cliente, seja
   * qual for o produto ou o tipo de frete. `null` quando ele nunca escreveu nenhuma.
   */
  getLastCustomerFreightNote: (customerId: string) => Promise<string | null>;
  setCustomerFreightRule: (input: {
    customerId: string;
    productId?: string | null;
    /** Quando informado, grava o valor apenas para esse tipo de frete. */
    modality?: FreightModality | null;
    rule: CustomerFreightRuleView["rule"];
  }) => Promise<unknown>;
  removeCustomerFreightRule: (ruleId: string) => Promise<void>;
  removeCustomerFreightModality: (ruleId: string, modality: FreightModality) => Promise<void>;
  /**
   * Notas de venda para ENTREGA FUTURA ja emitidas contra o cliente, com o saldo de cada
   * uma. Sao por tipo de produto (a nota de rachao nao vale para a brita) e o mesmo produto
   * aceita varias, consumidas da mais antiga para a mais nova; `productId` nulo e a que vale
   * para qualquer produto dele.
   */
  getCustomerFutureBillingInvoices: (
    customerId: string
  ) => Promise<CustomerFutureBillingInvoiceView[]>;
  setCustomerFutureBillingInvoice: (input: {
    customerId: string;
    productId?: string | null;
    nfeNumber: string;
    /** Quanto a nota faturou, em kg. Vazio = nota sem controle de saldo. */
    totalWeightKg?: number | string | null;
  }) => Promise<CustomerFutureBillingInvoiceView>;
  removeCustomerFutureBillingInvoice: (invoiceId: string) => Promise<void>;
  listWindowsPrinters: () => Promise<WindowsPrinterSummary[]>;
  configureReceiptPrintProfile: (
    input: Omit<ConfigureReceiptPrintProfileInput, "identity">
  ) => Promise<PrintProfileSummary>;
  listPrintProfiles: () => Promise<PrintProfileSummary[]>;
  /** Perfil de cupom 80 mm ativo deste computador (o que a impressao usa). */
  getActiveReceiptProfile: () => Promise<PrintProfileSummary | null>;
  listPrintReceipts: () => Promise<PrintReceiptSummary[]>;
  printReceipt: (operationId: string) => Promise<PrintReceiptSummary>;
  reprintReceipt: (receiptId: string) => Promise<PrintReceiptSummary>;
  printTestReceipt: () => Promise<PrintReceiptSummary>;
  billFiscalOperation: (operationId: string) => Promise<FiscalBillingResult>;
  bootstrapCloudData: () => Promise<CloudBootstrapResult>;
  syncToCloud: () => Promise<SyncResult>;
  getCloudStatus: () => Promise<{ totalOperations: number; lastSync: string | null }>;
  isCloudConnected: () => Promise<boolean>;
  queryCache: (options: CacheQueryOptions) => Promise<CacheQueryResult<unknown>>;
  getDailyReport: (date: string) => Promise<DailyReport>;
  getMonthlyReport: (year: number, month: number) => Promise<MonthlyReport>;
  getReportHtml: (startDate: string, endDate: string) => Promise<string>;
  exportReportPdf: (
    startDate: string,
    endDate: string,
    periodLabel?: string
  ) => Promise<{ path: string } | null>;
  /** Conferencia de faturamento: uma linha por pesagem fechada do periodo. */
  getWeighingBillingReport: (
    startDate: string,
    endDate: string,
    options?: WeighingBillingReportOptions
  ) => Promise<WeighingBillingReport>;
  exportWeighingBillingReport: (
    startDate: string,
    endDate: string,
    formats: Array<"pdf" | "excel">,
    options?: WeighingBillingReportOptions
  ) => Promise<{ files: string[] } | null>;
  /** Fechamento de faturas: as faturas do periodo dos clientes de cada ciclo. */
  getInvoiceClosing: (
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ) => Promise<InvoiceClosingReport>;
  exportInvoiceClosing: (
    startDate: string,
    endDate: string,
    formats: Array<"pdf" | "excel">,
    options?: InvoiceClosingOptions
  ) => Promise<{ files: string[] } | null>;
  /**
   * Quantas pesagens do periodo o botao "Fazer fechamento" mandaria ao OMIE. Nao emite
   * nota: e o numero que a tela mostra na confirmacao.
   */
  previewInvoiceClosingRun: (
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ) => Promise<{ billable: number; total: number }>;
  /**
   * "Fazer fechamento": fatura no OMIE as pesagens do periodo, com os mesmos filtros da
   * tela. EMITE NOTA FISCAL — so depois da confirmacao do operador.
   */
  runInvoiceClosing: (
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ) => Promise<InvoiceClosingRunResult>;
  /**
   * "Conferir notas no OMIE": pergunta AGORA quais cargas do periodo ja foram faturadas la
   * e grava o numero da nota de cada uma. So LE o OMIE — nao emite nada.
   */
  reconcileInvoiceClosingNotes: (
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ) => Promise<{ checked: number; billed: number; errors: string[] }>;
  /**
   * "Cancelar as pesagens repetidas": cancela as cargas que o fechamento identificou como a
   * MESMA carga registrada duas vezes. Nao toca na que ficou valendo, e pula a repetida que
   * ja tem nota emitida (essa so o OMIE cancela) — devolvida em `skipped`.
   */
  cancelInvoiceClosingDuplicates: (
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ) => Promise<{
    cancelled: number;
    skipped: Array<{ couponNumber: number | null; invoiceNumber: string }>;
  }>;
  /** Andamento do fechamento em curso. Devolve a funcao que cancela a escuta. */
  onInvoiceClosingProgress: (callback: (progress: InvoiceClosingRunProgress) => void) => () => void;
  /** `search` recorta o relatorio por placa ou motorista, como a busca da tela. */
  getTruckControl: (
    startDate: string,
    endDate: string,
    search?: string
  ) => Promise<TruckControlReport>;
  /** Salva o controle de caminhoes em PDF ou Excel com o recorte de `search` aplicado. */
  exportTruckControl: (
    format: "pdf" | "excel",
    startDate: string,
    endDate: string,
    search?: string
  ) => Promise<{ path: string } | null>;
  exportReportExcel: (startDate: string, endDate: string) => Promise<{ path: string } | null>;
  listCustomerReportCustomers: () => Promise<CustomerReportOption[]>;
  /** Resumo comparativo de todos os clientes com movimento no periodo. */
  getCustomersOverview: (
    startDate: string,
    endDate: string,
    periodLabel?: string
  ) => Promise<CustomersOverview>;
  exportCustomersOverview: (
    startDate: string,
    endDate: string,
    formats: Array<"pdf" | "excel">,
    periodLabel?: string
  ) => Promise<{ files: string[] } | null>;
  getCustomerReport: (
    customerId: string,
    startDate: string,
    endDate: string,
    periodLabel?: string
  ) => Promise<CustomerFullReport>;
  exportCustomerReport: (
    customerId: string,
    startDate: string,
    endDate: string,
    variants: CustomerReportVariant[],
    formats: Array<"pdf" | "excel">,
    periodLabel?: string
  ) => Promise<{ files: string[] } | null>;
  listReportRecipients: () => Promise<
    Array<{
      id: string;
      email: string | null;
      whatsappPhone: string | null;
      sendEmail: boolean;
      sendWhatsapp: boolean;
      scheduleFrequency: string;
      scheduleTime: string;
      reportTypes: "sales" | "trucks" | "both";
      sendFinancial: boolean;
      financialScheduleTime: string | null;
      displayName: string | null;
      isActive: boolean;
      syncStatus: "synced" | "pending" | "error";
      lastError: string | null;
      lastSyncedAt: string | null;
    }>
  >;
  createReportRecipient: (input: {
    email?: string | null;
    whatsappPhone?: string | null;
    sendEmail?: boolean;
    sendWhatsapp?: boolean;
    scheduleFrequency?: string;
    scheduleTime?: string;
    reportTypes?: "sales" | "trucks" | "both";
    sendFinancial?: boolean;
    financialScheduleTime?: string | null;
    displayName?: string | null;
    isActive?: boolean;
  }) => Promise<unknown>;
  updateReportRecipient: (
    id: string,
    input: {
      email?: string | null;
      whatsappPhone?: string | null;
      sendEmail?: boolean;
      sendWhatsapp?: boolean;
      scheduleFrequency?: string;
      scheduleTime?: string;
      reportTypes?: "sales" | "trucks" | "both";
      sendFinancial?: boolean;
      financialScheduleTime?: string | null;
      displayName?: string | null;
      isActive?: boolean;
    }
  ) => Promise<unknown>;
  deleteReportRecipient: (id: string) => Promise<void>;
  sendTestEmail: (to: string) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendDailyReportEmail: (
    email: string,
    date: string
  ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendRangeReportEmail: (
    email: string,
    startDate: string,
    endDate: string
  ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  verifySmtpConfig: () => Promise<{ success: boolean; messageId?: string; error?: string }>;
  getReportChannelSettings: () => Promise<ReportChannelSettingsView>;
  saveReportChannelSettings: (
    input: Partial<ReportChannelSettingsView>
  ) => Promise<ReportChannelSettingsView>;
  whatsappConnect: () => Promise<WhatsappInstanceStateView>;
  whatsappStatus: () => Promise<WhatsappInstanceStateView>;
  whatsappDisconnect: () => Promise<WhatsappInstanceStateView>;
  /** Link temporario guardado nesta maquina; null quando nao ha nenhum no prazo. */
  whatsappConnectionLink: () => Promise<WhatsappConnectionLinkView | null>;
  whatsappCreateConnectionLink: () => Promise<WhatsappConnectionLinkView>;
  whatsappRevokeConnectionLink: () => Promise<void>;
  getReportDispatchConfig: () => Promise<ReportDispatchConfigView>;
  saveReportDispatchConfig: (
    patch: Partial<ReportDispatchConfigView["settings"]>
  ) => Promise<ReportDispatchConfigView>;
  sendReportsNow: () => Promise<ReportDispatchSendResultView>;
  sendFinancialReportNow: () => Promise<FinancialReportDispatchResultView[]>;
  getReportByProduct: (
    startDate: string,
    endDate: string,
    limit?: number
  ) => Promise<ProductReport[]>;
  getReportByCustomer: (
    startDate: string,
    endDate: string,
    limit?: number
  ) => Promise<CustomerReport[]>;
  getDailySeries: (startDate: string, endDate: string) => Promise<DailySeriesPoint[]>;
  getSalesPivot: (
    startDate: string,
    endDate: string,
    groupBy: SalesPivotGroupBy,
    filters?: SalesPivotFilters
  ) => Promise<SalesPivotResult>;
  getOperationMix: (startDate: string, endDate: string) => Promise<OperationMix>;
  getPriceForCustomerProduct: (customerId: string, productId: string) => Promise<number | null>;
  getPriceDetailsForCustomerProduct: (
    customerId: string,
    productId: string
  ) => Promise<PriceDetails | null>;
  productDefaultPricesList: () => Promise<ProductDefaultPriceSummary[]>;
  productDefaultPricesUpsert: (input: {
    productId: string;
    unitPriceCents: number;
    unit?: string;
  }) => Promise<unknown>;
  productDefaultPricesRemove: (productId: string) => Promise<void>;
  customerSpecialPricesList: (customerId: string) => Promise<CustomerSpecialPriceSummary[]>;
  customerSpecialPricesSet: (input: {
    customerId: string;
    productId: string;
    unitPriceCents: number;
    unit?: string;
  }) => Promise<unknown>;
  customerSpecialPricesRemove: (customerId: string, productId: string) => Promise<void>;
  omieCategoriesList: () => Promise<OmieCategoryOption[]>;
  productOmieCategorySet: (productId: string, categoryCode: string | null) => Promise<void>;
  omieDefaultCategoryGet: () => Promise<string | null>;
  omieDefaultCategorySet: (categoryCode: string | null) => Promise<string | null>;
  customerCreditBalance: (customerId: string) => Promise<number>;
  customerCreditSummary: (customerId: string) => Promise<CustomerCreditSummary>;
  customerCreditMovements: (customerId: string, limit?: number) => Promise<CreditMovementRow[]>;
  /** Espelha os adiantamentos do OMIE no extrato de credito dos clientes. */
  customerCreditSyncAdvances: (options?: {
    fullRescan?: boolean;
  }) => Promise<CustomerAdvancesSyncResult>;
  /** Categorias/conta corrente que identificam o adiantamento no OMIE. */
  omieAdvanceConfigGet: () => Promise<OmieAdvanceConfig>;
  omieAdvanceConfigSet: (patch: {
    categoryCodes?: string[];
    accountCode?: number | null;
    accountName?: string | null;
  }) => Promise<OmieAdvanceConfig>;
  quotationsCreate: (input: Omit<CreateQuotationInput, "companyId">) => Promise<QuotationRow>;
  quotationsCancel: (id: string) => Promise<void>;
  quotationsListOpenForCustomer: (customerId: string) => Promise<QuotationSummary[]>;
  customersCreate: (input: Omit<CreateCustomerInput, "companyId">) => Promise<unknown>;
  customersUpdate: (
    id: string,
    input: UpdateCustomerInput,
    options?: { overrideOmieFields?: boolean }
  ) => Promise<unknown>;
  customersDelete: (id: string) => Promise<void>;
  getDefaultNfeEmail: () => Promise<string | null>;
  setDefaultNfeEmail: (email: string) => Promise<string | null>;
  applyDefaultNfeEmailToAll: (email: string) => Promise<number>;
  /**
   * Executa "buscar CNPJ" para todos os clientes com CNPJ valido e grava os dados
   * retornados. Retorna um resumo (total/consultados/atualizados/nao-encontrados/falhas).
   */
  enrichAllCustomersFromCnpj: () => Promise<{
    total: number;
    withCnpj: number;
    updated: number;
    notFound: number;
    failed: number;
  }>;
  /** Mesma busca automatica em lote, para todas as transportadoras com CNPJ valido. */
  enrichAllCarriersFromCnpj: () => Promise<{
    total: number;
    withCnpj: number;
    updated: number;
    notFound: number;
    failed: number;
  }>;
  // Meios de pagamento e contas vem do OMIE (sincronizacao); localmente so ha
  // atualizacao restrita (ativar/desativar, apelido, vinculo forma -> conta).
  paymentMethodsUpdate: (id: string, input: UpdatePaymentMethodInput) => Promise<unknown>;
  /** Vendas em carteira (agrupadas por cliente) e os totais em aberto / fechados. */
  walletReport: (query: WalletQuery) => Promise<WalletReport>;
  /** Fecha as vendas escolhidas definindo a forma de recebimento; devolve quantas. */
  walletSettle: (input: SettleWalletInput) => Promise<number>;
  /** Desfaz o fechamento das vendas escolhidas; devolve quantas voltaram a carteira. */
  walletReopen: (operationIds: string[]) => Promise<number>;
  accountsList: () => Promise<unknown[]>;
  accountsUpdate: (id: string, input: UpdateAccountInput) => Promise<unknown>;
  paymentTermsCreate: (input: Omit<CreatePaymentTermInput, "companyId">) => Promise<unknown>;
  paymentTermsUpdate: (id: string, input: UpdatePaymentTermInput) => Promise<unknown>;
  paymentTermsDelete: (id: string) => Promise<void>;
  paymentTermsListOmie: () => Promise<OmiePaymentTermOption[]>;
  priceTablesCreate: (input: Omit<CreatePriceTableInput, "companyId">) => Promise<unknown>;
  priceTablesUpdateName: (id: string, name: string) => Promise<unknown>;
  priceTablesDelete: (id: string) => Promise<void>;
  priceTablesAddItem: (input: AddPriceTableItemInput) => Promise<unknown>;
  priceTablesUpdateItem: (id: string, input: UpdatePriceTableItemInput) => Promise<unknown>;
  priceTablesRemoveItem: (id: string) => Promise<void>;
  priceTablesLinkCustomer: (input: LinkCustomerToPriceTableInput) => Promise<unknown>;
  priceTablesUnlinkCustomer: (linkId: string) => Promise<void>;
  priceTablesList: () => Promise<unknown[]>;
  priceTablesListItems: (priceTableId: string) => Promise<unknown[]>;
  priceTablesListCustomerLinks: (priceTableId: string) => Promise<unknown[]>;
  vehiclesCreate: (input: Omit<CreateVehicleInput, "companyId">) => Promise<unknown>;
  vehiclesUpdate: (id: string, input: UpdateVehicleInput) => Promise<unknown>;
  vehiclesDelete: (id: string) => Promise<void>;
  vehiclesFindOrCreate: (plate: string) => Promise<unknown>;
  vehiclesGetCarriers: (
    vehicleId: string
  ) => Promise<Array<{ carrierId: string; carrierName: string; carrierDocument: string | null }>>;
  vehiclesLinkCarrier: (vehicleId: string, carrierId: string) => Promise<unknown>;
  customersByCarrier: (carrierId: string) => Promise<unknown[]>;
  driversCreate: (input: Omit<CreateDriverInput, "companyId">) => Promise<unknown>;
  driversUpdate: (id: string, input: UpdateDriverInput) => Promise<unknown>;
  driversDelete: (id: string) => Promise<void>;
  driversFindOrCreate: (name: string) => Promise<unknown>;
  carriersCreate: (input: Omit<CreateCarrierInput, "companyId">) => Promise<unknown>;
  carriersUpdate: (id: string, input: UpdateCarrierInput) => Promise<unknown>;
  carriersDelete: (id: string) => Promise<void>;
  carriersList: () => Promise<unknown[]>;
  carriersGetVehicles: (
    carrierId: string
  ) => Promise<Array<{ id: string; plate: string; description: string | null }>>;
  linkCustomerCarrier: (
    customerId: string,
    carrierId: string
  ) => Promise<{ defaultCarrierId: string | null }>;
  unlinkCustomerCarrier: (
    customerId: string,
    carrierId: string
  ) => Promise<{ defaultCarrierId: string | null }>;
  listCarriersByCustomer: (
    customerId: string
  ) => Promise<Array<{ id: string; name: string; document: string | null }>>;
  listCustomersByCarrier: (
    carrierId: string
  ) => Promise<Array<{ id: string; trade_name: string; legal_name: string }>>;
  linkDriverCarrier: (driverId: string, carrierId: string) => Promise<unknown>;
  unlinkDriverCarrier: (driverId: string, carrierId: string) => Promise<void>;
  listCarriersByDriver: (
    driverId: string
  ) => Promise<Array<{ id: string; name: string; document: string | null }>>;
  listDriversByCarrier: (
    carrierId: string
  ) => Promise<
    Array<{ id: string; name: string; document: string | null; is_independent: number }>
  >;
  listIndependentDrivers: () => Promise<
    Array<{ id: string; name: string; document: string | null }>
  >;
  getOmieStatus: () => Promise<{
    configured: boolean;
    appKeyMasked: string | null;
    hasSyncedData: boolean;
    totalCustomers: number;
    totalProducts: number;
    totalPaymentTerms: number;
    pendingPushCustomers: number;
    pendingPushCarriers: number;
    pendingOmieJobs: number;
    lastSyncAt: string | null;
  }>;
  scaleConnect: () => Promise<void>;
  scaleDisconnect: () => Promise<void>;
  scaleListSerialPorts: () => Promise<SerialPortInfo[]>;
  scaleRead: () => Promise<ScaleReading>;
  scaleReadSampled: () => Promise<ScaleReading>;
  scaleCaptureStable: (options: {
    operationType: "entry" | "exit";
    timeoutMs?: number;
    /** Operacao que sera fechada com este peso (saida). A entrada ainda nao tem uma. */
    operationId?: string;
  }) => Promise<{ captureId: string; reading: ScaleReading }>;
  scaleDiscover: () => Promise<{ host: string; port: number } | null>;
  scaleGetStatus: () => Promise<ToledoTcpAdapterStatus>;
  scaleGetConfig: () => Promise<ScaleConfiguration>;
  scaleSaveConfig: (input: ScaleConfigurationInput) => Promise<ScaleConfiguration>;
  virtualScaleSetWeight: (weightKg: number) => Promise<void>;
  virtualScaleConnect: () => Promise<void>;
  verifyPriceChangePassword: (password: string) => Promise<boolean>;
  omieConfig: () => Promise<{ configured: boolean; appKeyMasked: string | null }>;
  omieSync: () => Promise<{
    customersPulled: number;
    customersPushed: number;
    /** Transportadoras vindas do cadastro do OMIE (clientes com a tag "transportadora"). */
    suppliersSynced: number;
    productsSynced: number;
    paymentTermsSynced: number;
    /** Categorias do plano gerencial espelhadas (categoria OMIE por produto). */
    categoriesSynced: number;
    ordersProcessed: number;
    ordersFailed: number;
    customersPushFailed: number;
    errors: string[];
    /** Paginas/registros que o OMIE declarou nesta varredura de clientes. */
    customersScanSummary: string | null;
  }>;
  omieQueueList: () => Promise<OmieQueueItem[]>;
  omieQueueDelete: (jobId: string) => Promise<{ deleted: boolean }>;
  omieQueueSendNow: (
    jobId: string
  ) => Promise<{ processed: number; failed: number; errors: string[] }>;
  syncOmieDirect: (
    appKey: string,
    appSecret: string
  ) => Promise<{
    customersPulled: number;
    customersPushed: number;
    productsSynced: number;
    paymentTermsSynced: number;
    suppliersSynced: number;
    /** Categorias do plano gerencial espelhadas (categoria OMIE por produto). */
    categoriesSynced: number;
    errors: string[];
  }>;
  resetOmieMaster: () => Promise<{
    customersCleared: number;
    carriersCleared: number;
    productsCleared: number;
    paymentTermsCleared: number;
    syncRunsCleared: number;
    syncQueueCleared: number;
  }>;
  syncOmieMasterData: (options?: unknown) => Promise<{
    success: boolean;
    startedAt: Date;
    finishedAt: Date;
    triggeredBy: "manual" | "automatic" | "startup";
    mode: "full" | "incremental";
    entities: Array<{
      entity: string;
      success: boolean;
      totalFetched: number;
      totalCreated: number;
      totalUpdated: number;
      totalSkipped: number;
      startedAt: Date;
      finishedAt: Date;
      errorMessage?: string;
    }>;
    runId: string;
  }>;
  getLastOmieSyncRun: () => Promise<{
    id: string;
    startedAt: string;
    finishedAt: string | null;
    success: boolean;
    mode: string;
    triggeredBy: string;
  } | null>;
  getOmieSyncEntitiesByRun: (runId: string) => Promise<
    Array<{
      entity: string;
      success: boolean;
      totalFetched: number;
      totalCreated: number;
      totalUpdated: number;
      totalSkipped: number;
      errorMessage: string | null;
    }>
  >;
  listOmieDocumentTypes: () => Promise<Array<{ code: string; description: string }>>;
  startOmieDataEntryLoop: () => Promise<{
    customersPulled: number;
    productsSynced: number;
    paymentTermsSynced: number;
    iterations: number;
    finished: boolean;
    errors: string[];
  }>;
  getOmieLoopStatus: () => Promise<{
    iteration: number;
    customersPulled: number;
    productsSynced: number;
    paymentTermsSynced: number;
    customersPage: number;
    productsPage: number;
    paymentTermsPage: number;
    inProgress: boolean;
    lastBatchCustomers: number;
    lastBatchProducts: number;
    lastBatchPaymentTerms: number;
    lastUpdatedAt?: string | null;
  } | null>;
  getOmieSchedulerStatus: () => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastPullAt: string | null;
    nextPullAt: string | null;
  }>;
  setOmieSchedulerConfig: (config: { enabled?: boolean; intervalMinutes?: number }) => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastPullAt: string | null;
    nextPullAt: string | null;
  }>;
  syncCloudNow: () => Promise<{
    success: boolean;
    synced: number;
    failed: number;
    errors: string[];
  }>;
  getCloudSyncSchedulerStatus: () => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }>;
  setCloudSyncConfig: (config: { enabled?: boolean; intervalMinutes?: number }) => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }>;
  probeConnectivity: () => Promise<{
    internetOnline: boolean;
    cloudReachable: boolean;
    omieReachable: boolean;
  }>;
  lookupCep: (cep: string) => Promise<{
    zipcode: string;
    street: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
  }>;
  lookupCnpj: (cnpj: string) => Promise<{
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
  }>;
  /**
   * Chat da documentacao. Os trechos vem do renderer (a documentacao instalada);
   * `available: false` significa "sem nuvem agora" e o chat responde com o que
   * encontrou localmente, sem exibir erro.
   */
  docsAssistantAsk: (request: {
    question: string;
    passages: Array<{ source: string; text: string }>;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<{
    available: boolean;
    answer: string;
    /** "documentacao" | "conhecimento" | "desconhecido". */
    answerSource: string;
    sources: string[];
    reason?: string;
  }>;
  onUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
  offUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
  onUpdateDownloadProgress: (callback: (event: unknown, percent: number) => void) => void;
  offUpdateDownloadProgress: (callback: (event: unknown, percent: number) => void) => void;
  onUpdateDownloaded: (callback: (event: unknown, version: string) => void) => void;
  offUpdateDownloaded: (callback: (event: unknown, version: string) => void) => void;
  onPlateScanned: (callback: (plate: string) => void) => void;
  onScaleReading: (callback: (reading: ParsedToledoReading) => void) => void;
  offScaleReading: (callback: (reading: ParsedToledoReading) => void) => void;
}
