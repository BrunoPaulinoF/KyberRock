import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BadgeDollarSign,
  BookOpen,
  Cloud,
  Download,
  Database,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  PlusCircle,
  Printer,
  RefreshCw,
  Scale,
  ScrollText,
  Settings,
  Sun,
  Truck,
  Upload,
  User,
  Users,
  Package,
  CreditCard,
  Building2,
  Car,
  Power,
  Search
} from "lucide-react";

import { desktopAppInfo } from "../app-info";
import type {
  PrintProfileSummary,
  PrintReceiptSummary,
  PrinterType,
  WindowsPrinterSummary
} from "../services/printing";
import {
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  type ReceiptTemplateConfig
} from "@kyberrock/print-templates";
import type { DesktopAccessStatus } from "../services/desktop-activation";
import type { DesktopStatusSnapshot } from "../services/status";
import {
  createInitialUpdateState,
  getManualUpdateButtonLabel,
  type UpdateState
} from "../services/update-flow";
import { validatePaymentMethodCondition } from "../services/payment-method-condition-guard";
import { tryParsePaymentCondition } from "../services/payment-condition-parser";
import { extractConditionRaw, resolveConditionTermId } from "./payment-condition-helpers";
import type {
  OperationFreightInput,
  OperationType,
  WeighingOperationSummary
} from "../services/weighing-operations";
import {
  FREIGHT_MODALITIES,
  getFreightModalityInfo,
  type FreightModality
} from "../services/freight";
import type { PriceDetails } from "../services/pricing";
import type { CacheEntityType } from "../services/cache-store";
import {
  isValidDocument,
  isValidEmail,
  isValidPlate,
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
  normalizePlate,
  parseMoneyInputToCents,
  resolveDeviceColor
} from "@kyberrock/shared";
import type { UnitDeviceInfo } from "../services/unit-devices";
import { ActivationGate } from "./ActivationGate";
import { formatDbDateTime, parseDbTimestamp } from "./format-datetime";
import { MountainOutline } from "./MountainOutline";
import { CrudFormModal } from "./CrudFormModal";
import {
  CellMuted,
  CellPrimary,
  CellText,
  ConfirmDialog,
  CrudFormShell,
  CrudSearchBar,
  CrudSectionHeader,
  DataTable,
  DeleteRowButton,
  EditRowButton,
  FlashBanner,
  FormSection,
  SourceBadge,
  useFlash
} from "./crud-ui";
import type { DataTableColumn, FlashKind } from "./crud-ui";
import { BlockedScreen } from "./BlockedScreen";
import { DashboardView } from "./DashboardView";
import { DocumentationView } from "./DocumentationView";
import { InsightsView } from "./InsightsView";
import { ReportsView } from "./ReportsView";
import { TruckControlView, formatMinutes } from "./TruckControlView";
import { CustomersView } from "./CustomersView";
import { HelpTooltip, Tooltip } from "./Tooltip";
import { IconActionButton, OpIcon } from "./IconActionButton";
import { PriceChangePasswordDialog } from "./PriceChangePasswordDialog";
import { TIPS } from "./tooltip-messages";
import {
  DocumentInput,
  EmailInput,
  Field,
  MoneyCentsInput,
  MoneyInput,
  NumberInput,
  PhoneInput,
  PlateInput,
  TextInput,
  getInputStyle
} from "./inputs";
import type {
  AccountCacheEntry,
  CarrierCacheEntry,
  PaymentMethodCacheEntry,
  PaymentTermCacheEntry
} from "./customers.types";
import type { KyberRockDesktopApi } from "./desktop-api";
import type { ScaleConfiguration, ScaleConfigurationInput } from "../services/scale-configs";
import type { SerialPortInfo } from "../services/scale-serial";
import type { OmieQueueItem } from "../services/sync-queue";
export interface AppProps {
  desktopApi?: KyberRockDesktopApi;
  initialStatus?: DesktopStatusSnapshot | null;
}

export interface WeighingFormState {
  operationType: OperationType;
  vehicleId: string;
  carrierId: string;
  customerId: string;
  driverId: string;
  productId: string;
  paymentMethodId: string;
  paymentMethodIsCredit: boolean;
  paymentTermId: string;
  /** Condicao digitada livre ("5", "7 14 21", "7/14/21"); quando preenchida, vence o select. */
  customConditionText: string;
  paymentMode: "registered" | "manual";
  manualInstallments: string;
  manualDownPaymentEnabled: boolean;
  manualDownPaymentCents: number | null;
  quotationId: string;
  deductFreightFromCredit: boolean;
  /** Tipo (modalidade) de frete da operacao, enviado ao OMIE. Default "none" (sem frete). */
  freightModality: FreightModality;
  /** Se a Pedreira lanca um valor de frete nesta operacao (habilita os campos de valor). */
  chargeFreight: boolean;
  freightCalculationType: "per_ton" | "per_ton_km" | "fixed_plus_ton";
  freightBaseValueCents: number | null;
  freightFixedValueCents: number | null;
  freightMinValueCents: number | null;
  freightDistanceKm: string;
  freightDestination: string;
}

type ActiveView =
  | "dashboard"
  | "new-weighing"
  | "open-operations"
  | "scale"
  | "registrations"
  | "printing"
  | "cloud"
  | "insights"
  | "truck-control"
  | "reports"
  | "documentation";

const initialWeighingForm: WeighingFormState = {
  operationType: "invoice",
  vehicleId: "",
  carrierId: "",
  customerId: "",
  driverId: "",
  productId: "",
  paymentMethodId: "",
  paymentMethodIsCredit: false,
  paymentTermId: "",
  customConditionText: "",
  paymentMode: "registered",
  manualInstallments: "",
  manualDownPaymentEnabled: false,
  manualDownPaymentCents: null,
  quotationId: "",
  deductFreightFromCredit: false,
  freightModality: "none",
  chargeFreight: false,
  freightCalculationType: "per_ton",
  freightBaseValueCents: null,
  freightFixedValueCents: null,
  freightMinValueCents: null,
  freightDistanceKm: "",
  freightDestination: ""
};

/**
 * Transporte proprio do cliente: o cliente traz o proprio caminhao, entao a
 * transportadora da Pedreira nao se aplica (modalidade own_recipient). Substitui a
 * antiga caixa "transportadora propria do cliente".
 */
export function isCustomerOwnTransport(
  form: Pick<WeighingFormState, "freightModality">
): boolean {
  return form.freightModality === "own_recipient";
}

/**
 * Regra de frete na fatura: quando a Pedreira paga o frete (modalidade CIF/proprio do
 * remetente) e a forma de pagamento e "credito do cliente" (fiado), o valor do frete
 * obrigatoriamente entra na fatura do cliente (abate do credito).
 */
function freightGoesToCustomerInvoice(form: WeighingFormState): boolean {
  const info = getFreightModalityInfo(form.freightModality);
  return form.chargeFreight && info.defaultPayer === "quarry" && form.paymentMethodIsCredit;
}

type RegistrationsTab = "customers" | "products" | "payment_terms" | "transport";

type AppPhase = "checking_access" | "locked" | "bootstrapping_cloud" | "unlocked";
export type ThemeMode = "light" | "dark";
type OperationsTab = "open" | "canceled" | "closed";
type CanceledFilter = "all" | "day" | "week" | "month";
type FiscalCloseStep = "weighing" | "billing" | "danfe" | "receipt";
type FiscalCloseProgress = {
  operationId: string;
  status: "running" | "success" | "error";
  step: FiscalCloseStep;
  title: string;
  detail: string;
};

type ReceiptTemplateBooleanKey = {
  [Key in keyof ReceiptTemplateConfig]: ReceiptTemplateConfig[Key] extends boolean ? Key : never;
}[keyof ReceiptTemplateConfig];

const receiptTemplateToggleOptions: Array<{ key: ReceiptTemplateBooleanKey; label: string }> = [
  { key: "showCompanyHeader", label: "Cabecalho da empresa" },
  { key: "showCopyInfo", label: "Numero do cupom e via" },
  { key: "showCustomerInfo", label: "Dados do cliente" },
  { key: "showProductDetail", label: "Produto e quantidade" },
  { key: "showFreight", label: "Frete" },
  { key: "showWeights", label: "Pesos" },
  { key: "showEntryExitTimes", label: "Horarios de entrada/saida" },
  { key: "showPermanence", label: "Permanencia" },
  { key: "showFinancial", label: "Financeiro" },
  { key: "showSignature", label: "Assinatura" },
  { key: "showVehicleDriver", label: "Veiculo e motorista" },
  { key: "showFooter", label: "Mensagem padrao de rodape" }
];

const THEME_MODE_STORAGE_KEY = "kyberrock.themeMode";

type ThemeModeStorage = Pick<Storage, "getItem" | "setItem">;

function getThemeModeStorage(): ThemeModeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredThemeMode(storage: Pick<Storage, "getItem"> | null = getThemeModeStorage()): ThemeMode {
  try {
    const value = storage?.getItem(THEME_MODE_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : "light";
  } catch {
    return "light";
  }
}

export function writeStoredThemeMode(
  themeMode: ThemeMode,
  storage: Pick<Storage, "setItem"> | null = getThemeModeStorage()
): void {
  try {
    storage?.setItem(THEME_MODE_STORAGE_KEY, themeMode);
  } catch {
    // Storage can be unavailable in restricted renderer contexts.
  }
}

export function App({ desktopApi = getWindowDesktopApi(), initialStatus = null }: AppProps = {}) {
  const [phase, setPhase] = useState<AppPhase>("checking_access");
  const [status, setStatus] = useState<DesktopStatusSnapshot | null>(initialStatus);
  const [updateState, setUpdateState] = useState<UpdateState>(createInitialUpdateState());
  const [openOperations, setOpenOperations] = useState<WeighingOperationSummary[]>([]);
  const [truckAverageMinutes, setTruckAverageMinutes] = useState(0);
  const [canceledOperations, setCanceledOperations] = useState<WeighingOperationSummary[]>([]);
  const [closedOperations, setClosedOperations] = useState<WeighingOperationSummary[]>([]);
  const [operationsTab, setOperationsTab] = useState<OperationsTab>("open");
  // Multi-desktop: computadores da unidade (nome + cor) para a legenda e o
  // contorno colorido das operacoes por responsavel.
  const [unitDevices, setUnitDevices] = useState<UnitDeviceInfo[]>([]);
  const [loaderCompletionNotice, setLoaderCompletionNotice] = useState<string | null>(null);
  // Estado anterior (id -> concluida?) para detectar a transicao aguardando->concluida
  // e disparar o aviso de "carga concluida pelo carregador".
  const loaderCompletedStateRef = useRef<Map<string, boolean>>(new Map());
  const loaderStateSeededRef = useRef(false);
  const loaderNoticeTimerRef = useRef<number | null>(null);
  const [canceledFilter, setCanceledFilter] = useState<CanceledFilter>("all");
  const [closedProductFilter, setClosedProductFilter] = useState<string>("all");
  const [printers, setPrinters] = useState<WindowsPrinterSummary[]>([]);
  const [printProfiles, setPrintProfiles] = useState<PrintProfileSummary[]>([]);
  const [printReceipts, setPrintReceipts] = useState<PrintReceiptSummary[]>([]);
  const [printerType, setPrinterType] = useState<PrinterType>("windows");
  const [selectedPrinterName, setSelectedPrinterName] = useState("");
  const [networkPrinterHost, setNetworkPrinterHost] = useState("");
  const [networkPrinterPort, setNetworkPrinterPort] = useState("9100");
  const [receiptLogoDataUrl, setReceiptLogoDataUrl] = useState<string | null>(null);
  const [receiptLogoWidthMm, setReceiptLogoWidthMm] = useState("24");
  const [receiptLogoHeightMm, setReceiptLogoHeightMm] = useState("16");
  const [receiptLogoFit, setReceiptLogoFit] =
    useState<PrintProfileSummary["receiptLogo"]["fit"]>("contain");
  const [receiptTemplateConfig, setReceiptTemplateConfig] = useState<ReceiptTemplateConfig>({
    ...DEFAULT_RECEIPT_TEMPLATE_CONFIG
  });
  const [form, setForm] = useState<WeighingFormState>(initialWeighingForm);
  const [creditMethodIds, setCreditMethodIds] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>("new-weighing");
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudBootstrapStatus, setCloudBootstrapStatus] = useState<{
    title: string;
    detail: string;
    mode: "running" | "cloud" | "local_emergency" | "error";
  }>({
    title: "Preparando sincronizacao",
    detail: "Validando acesso antes de carregar os dados.",
    mode: "running"
  });
  const [openingVideoDone, setOpeningVideoDone] = useState(false);
  const [openingVideoExiting, setOpeningVideoExiting] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const openingVideoFallbackRef = useRef<number | null>(null);
  const openingUnlockFallbackRef = useRef<number | null>(null);
  const [cloudStatus, setCloudStatus] = useState<{
    totalOperations: number;
    lastSync: string | null;
  } | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const updateReady =
    updateState.status === "available" || updateState.status === "downloaded";
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());
  const [errorLogs, setErrorLogs] = useState<
    Array<{ timestamp: string; level: string; source: string; message: string; details?: string }>
  >([]);
  const [accessStatus, setAccessStatus] = useState<DesktopAccessStatus | null>(null);
  const [omieStatus, setOmieStatus] = useState<{
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
  } | null>(null);
  const [registrationsTab, setRegistrationsTab] = useState<RegistrationsTab>("customers");
  const [closingOperation, setClosingOperation] = useState<WeighingOperationSummary | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    operation: WeighingOperationSummary;
    context: "open" | "completed";
  } | null>(null);
  const [changeProductOperation, setChangeProductOperation] =
    useState<WeighingOperationSummary | null>(null);
  const [changeProductOptions, setChangeProductOptions] = useState<
    Array<{ id: string; description: string }>
  >([]);
  const [changeProductLoading, setChangeProductLoading] = useState(false);
  const [changeCustomerOperation, setChangeCustomerOperation] =
    useState<WeighingOperationSummary | null>(null);
  const [changeCustomerOptions, setChangeCustomerOptions] = useState<CacheSelectOption[]>([]);
  const [changeCustomerLoading, setChangeCustomerLoading] = useState(false);
  const [changeCarrierOperation, setChangeCarrierOperation] =
    useState<WeighingOperationSummary | null>(null);
  const [changeCarrierOptions, setChangeCarrierOptions] = useState<CacheSelectOption[]>([]);
  const [changeCarrierLoading, setChangeCarrierLoading] = useState(false);
  const [fiscalCloseProgress, setFiscalCloseProgress] = useState<FiscalCloseProgress | null>(null);
  const [retryingFiscalOperationId, setRetryingFiscalOperationId] = useState<string | null>(null);
  const [reprintingOperationId, setReprintingOperationId] = useState<string | null>(null);
  const [customersInitialSearch, setCustomersInitialSearch] = useState("");
  const [deleteClosedOperationId, setDeleteClosedOperationId] = useState<string | null>(null);
  const [omieSyncing, setOmieSyncing] = useState(false);
  const [omieQueue, setOmieQueue] = useState<OmieQueueItem[]>([]);
  const [omieQueueLoading, setOmieQueueLoading] = useState(false);
  const [omieQueueBusyId, setOmieQueueBusyId] = useState<string | null>(null);
  const [omieQueueConfirmDeleteId, setOmieQueueConfirmDeleteId] = useState<string | null>(null);
  const [omieResetting, setOmieResetting] = useState(false);
  const [showOmieDirectSync, setShowOmieDirectSync] = useState(false);
  const [omieConnectionFeedback, setOmieConnectionFeedback] = useState<{
    status: "idle" | "checking" | "success" | "warning" | "error";
    message: string;
    details?: string;
  }>({ status: "idle", message: "" });
  // const [omieLoop, setOmieLoop] = useState<OmieLoopUiState | null>(null);
  const themeVars = useMemo(() => getThemeVariables(themeMode), [themeMode]);
  const filteredCanceledOperations = useMemo(
    () => filterCanceledOperations(canceledOperations, canceledFilter),
    [canceledOperations, canceledFilter]
  );
  const filteredClosedOperations = useMemo(
    () =>
      closedProductFilter === "all"
        ? closedOperations
        : closedOperations.filter((op) => op.productDescription === closedProductFilter),
    [closedOperations, closedProductFilter]
  );
  // Operacoes abertas cujo caminhao ja passou do tempo medio dentro da pedreira.
  const overtimeOpenOperations = useMemo(() => {
    if (truckAverageMinutes <= 0) return [] as WeighingOperationSummary[];
    const now = Date.now();
    return openOperations.filter(
      (op) => (now - parseDbTimestamp(op.createdAt).getTime()) / 60_000 > truckAverageMinutes
    );
  }, [openOperations, truckAverageMinutes]);
  const overtimeOpenIds = useMemo(
    () => new Set(overtimeOpenOperations.map((op) => op.id)),
    [overtimeOpenOperations]
  );
  const hasAwaitingLoader = useMemo(
    () => openOperations.some((op) => !op.loaderCompletedAt),
    [openOperations]
  );
  // Contorno colorido por computador criador: so faz sentido (e so aparece)
  // quando a pedreira tem mais de um desktop trabalhando junto.
  const showDeviceColors = unitDevices.length > 1;
  const unitDeviceById = useMemo(
    () => new Map(unitDevices.map((device) => [device.id, device])),
    [unitDevices]
  );
  const operationOutlineStyle = useCallback(
    (operation: WeighingOperationSummary): React.CSSProperties => {
      if (!showDeviceColors || !operation.deviceId) return {};
      const color =
        unitDeviceById.get(operation.deviceId)?.color ??
        resolveDeviceColor(operation.deviceId, operation.deviceColor);
      return { boxShadow: `inset 0 0 0 2px ${color}` };
    },
    [showDeviceColors, unitDeviceById]
  );

  // Detecta a transicao aguardando -> concluida (o carregador clicou em "Concluir
  // carga" no loader-web) e dispara um aviso verde temporario no desktop.
  useEffect(() => {
    const prev = loaderCompletedStateRef.current;
    const next = new Map<string, boolean>();
    const newlyCompleted: string[] = [];
    for (const op of openOperations) {
      const done = Boolean(op.loaderCompletedAt);
      next.set(op.id, done);
      if (loaderStateSeededRef.current && done && prev.get(op.id) === false) {
        newlyCompleted.push(op.plate || "SEM PLACA");
      }
    }
    loaderCompletedStateRef.current = next;
    loaderStateSeededRef.current = true;

    if (newlyCompleted.length > 0) {
      setLoaderCompletionNotice(
        newlyCompleted.length === 1
          ? `Carga da placa ${newlyCompleted[0]} concluida pelo carregador — pronta para fechar.`
          : `${newlyCompleted.length} cargas concluidas pelo carregador — prontas para fechar.`
      );
      if (loaderNoticeTimerRef.current) window.clearTimeout(loaderNoticeTimerRef.current);
      loaderNoticeTimerRef.current = window.setTimeout(
        () => setLoaderCompletionNotice(null),
        12_000
      );
    }
  }, [openOperations]);

  useEffect(
    () => () => {
      if (loaderNoticeTimerRef.current) window.clearTimeout(loaderNoticeTimerRef.current);
    },
    []
  );

  // Enquanto houver carga aguardando o carregador, busca so as conclusoes no
  // cloud com frequencia (consulta leve por unidade) para a luz virar verde
  // quase em tempo real, sem esperar a sincronizacao completa de 30 min.
  useEffect(() => {
    if (!desktopApi || phase !== "unlocked" || !hasAwaitingLoader) return;
    let cancelled = false;
    const api = desktopApi;

    async function tick(): Promise<void> {
      if (cancelled || !navigator.onLine) return;
      try {
        const result = await api.pullLoaderCompletions();
        if (cancelled || result.pulled <= 0) return;
        const nextOpen = await api.listOpenWeighingOperations();
        if (!cancelled) setOpenOperations(nextOpen);
      } catch {
        // best-effort: a luz atualiza no proximo ciclo ou na sincronizacao completa
      }
    }

    const intervalId = window.setInterval(() => void tick(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [desktopApi, phase, hasAwaitingLoader]);

  // Multi-desktop: pull leve periodico da nuvem para enxergar as operacoes
  // registradas pelos outros computadores da pedreira sem esperar a
  // sincronizacao completa agendada.
  useEffect(() => {
    if (!desktopApi || phase !== "unlocked") return;
    let cancelled = false;
    const api = desktopApi;

    async function tick(): Promise<void> {
      if (cancelled || !navigator.onLine) return;
      try {
        const result = await api.pullCloudNow();
        if (cancelled || result.pulled <= 0) return;
        const [nextOpen, nextCanceled, nextClosed, nextDevices] = await Promise.all([
          api.listOpenWeighingOperations(),
          api.listCanceledWeighingOperations(),
          api.listClosedWeighingOperations(),
          api.listUnitDevices()
        ]);
        if (cancelled) return;
        setOpenOperations(nextOpen);
        setCanceledOperations(nextCanceled);
        setClosedOperations(nextClosed);
        setUnitDevices(nextDevices);
      } catch {
        // best-effort: a proxima sincronizacao (agendada ou por evento) cobre
      }
    }

    const intervalId = window.setInterval(() => void tick(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [desktopApi, phase]);

  useEffect(() => {
    writeStoredThemeMode(themeMode);
  }, [themeMode]);

  // Carrega os ids das formas de pagamento marcadas como "credito do cliente" (fiado),
  // usadas para a regra de frete na fatura.
  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await desktopApi.queryCache({
          entityType: "payment_method",
          activeOnly: false,
          limit: 200
        });
        if (cancelled) return;
        const ids = (result.rows as Array<{ id: string; isCustomerCredit?: boolean }>)
          .filter((m) => m.isCustomerCredit)
          .map((m) => m.id);
        setCreditMethodIds(ids);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  // Mantem paymentMethodIsCredit sincronizado com a forma selecionada (inclusive quando
  // ela e puxada automaticamente do padrao do cliente).
  useEffect(() => {
    const isCredit = form.paymentMethodId ? creditMethodIds.includes(form.paymentMethodId) : false;
    setForm((prev) =>
      prev.paymentMethodIsCredit === isCredit ? prev : { ...prev, paymentMethodIsCredit: isCredit }
    );
  }, [creditMethodIds, form.paymentMethodId]);

  useEffect(() => {
    const captureLog =
      (level: string, source: string) =>
      (...args: unknown[]) => {
        const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
        setErrorLogs((prev) => [
          ...prev.slice(-99),
          {
            timestamp: new Date().toISOString(),
            level,
            source,
            message: message.slice(0, 500),
            details: args.length > 1 ? JSON.stringify(args.slice(1)).slice(0, 200) : undefined
          }
        ]);
      };
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = (...args: unknown[]) => {
      captureLog("error", "renderer")(...args);
      originalError.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      captureLog("warn", "renderer")(...args);
      originalWarn.apply(console, args);
    };
    const onWindowError = (event: ErrorEvent) => {
      captureLog("error", "window")(event.message ?? "Erro desconhecido", event.error?.stack ?? "");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      captureLog("error", "promise")(String(event.reason));
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        if (
          event.key !== "Escape" &&
          event.key !== "F1" &&
          event.key !== "F2" &&
          event.key !== "F3" &&
          event.key !== "F4" &&
          event.key !== "F5" &&
          event.key !== "F6" &&
          event.key !== "F7" &&
          event.key !== "F8" &&
          event.key !== "F9" &&
          event.key !== "F10" &&
          event.key !== "F11"
        ) {
          return;
        }
      }
      switch (event.key) {
        case "F1":
          event.preventDefault();
          setActiveView("dashboard");
          break;
        case "F2":
          event.preventDefault();
          setActiveView("new-weighing");
          break;
        case "F3":
          event.preventDefault();
          setActiveView("open-operations");
          break;
        case "F4":
          event.preventDefault();
          setActiveView("registrations");
          break;
        case "F5":
          event.preventDefault();
          setActiveView("insights");
          break;
        case "F6":
          event.preventDefault();
          setActiveView("scale");
          break;
        case "F7":
          event.preventDefault();
          setActiveView("printing");
          break;
        case "F8":
          event.preventDefault();
          setActiveView("cloud");
          break;
        case "F9":
          event.preventDefault();
          void handleSyncOmie();
          break;
        case "F10":
          event.preventDefault();
          setShowLogsModal(true);
          break;
        case "F11":
          event.preventDefault();
          setThemeMode((mode) => (mode === "light" ? "dark" : "light"));
          break;
        case "Escape":
          if (
            showUpdateModal ||
            showLogsModal ||
            showSettings ||
            closingOperation ||
            cancelTarget ||
            changeProductOperation ||
            changeCustomerOperation ||
            changeCarrierOperation
          ) {
            setShowUpdateModal(false);
            setShowLogsModal(false);
            setShowSettings(false);
            setClosingOperation(null);
            setCancelTarget(null);
            setChangeProductOperation(null);
            setChangeCustomerOperation(null);
            setChangeCarrierOperation(null);
          } else {
            setActiveView("dashboard");
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    showUpdateModal,
    showLogsModal,
    showSettings,
    closingOperation,
    cancelTarget,
    changeProductOperation,
    changeCustomerOperation,
    changeCarrierOperation
  ]);

  useEffect(() => {
    if (!desktopApi) {
      setPhase("locked");
      return;
    }

    desktopApi
      .getAccessStatus()
      .then((access) => {
        setAccessStatus(access);
        if (access.canOperate) {
          setPhase("bootstrapping_cloud");
        } else {
          setPhase("locked");
        }
      })
      .catch(() => {
        setPhase("locked");
      });
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    function handleUpdateAvailable(_event: unknown, version: string): void {
      setAvailableVersion(version);
      setShowUpdateModal(true);
    }

    desktopApi.onUpdateAvailable(handleUpdateAvailable);
    return () => {
      desktopApi.offUpdateAvailable(handleUpdateAvailable);
    };
  }, [desktopApi]);

  const handleUnlocked = useCallback(() => setPhase("bootstrapping_cloud"), []);

  const finishOpeningVideo = useCallback(() => {
    if (openingVideoFallbackRef.current !== null) {
      window.clearTimeout(openingVideoFallbackRef.current);
      openingVideoFallbackRef.current = null;
    }
    setOpeningVideoDone(true);

    if (openingUnlockFallbackRef.current === null) {
      openingUnlockFallbackRef.current = window.setTimeout(() => {
        setOpeningVideoExiting(true);
        setPhase("unlocked");
        openingUnlockFallbackRef.current = null;
      }, 4000);
    }
  }, []);

  useEffect(() => {
    if (phase !== "bootstrapping_cloud") return;
    if (openingVideoFallbackRef.current !== null) {
      window.clearTimeout(openingVideoFallbackRef.current);
      openingVideoFallbackRef.current = null;
    }
    if (openingUnlockFallbackRef.current !== null) {
      window.clearTimeout(openingUnlockFallbackRef.current);
      openingUnlockFallbackRef.current = null;
    }
    setOpeningVideoDone(false);
    setOpeningVideoExiting(false);
    setBootstrapReady(false);

    openingVideoFallbackRef.current = window.setTimeout(() => {
      setOpeningVideoDone(true);
      openingVideoFallbackRef.current = null;
    }, 10000);

    return () => {
      if (openingVideoFallbackRef.current !== null) {
        window.clearTimeout(openingVideoFallbackRef.current);
        openingVideoFallbackRef.current = null;
      }
      if (openingUnlockFallbackRef.current !== null) {
        window.clearTimeout(openingUnlockFallbackRef.current);
        openingUnlockFallbackRef.current = null;
      }
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "bootstrapping_cloud") return;

    function handleOpeningKeyDown(event: KeyboardEvent): void {
      if (event.key === "Enter") {
        event.preventDefault();
        finishOpeningVideo();
      }
    }

    window.addEventListener("keydown", handleOpeningKeyDown);
    return () => window.removeEventListener("keydown", handleOpeningKeyDown);
  }, [phase, finishOpeningVideo]);

  useEffect(() => {
    if (phase !== "bootstrapping_cloud" || !openingVideoDone || bootstrapReady) return;

    const timeout = window.setTimeout(() => setBootstrapReady(true), 2500);
    return () => window.clearTimeout(timeout);
  }, [phase, openingVideoDone, bootstrapReady]);

  useEffect(() => {
    if (
      phase !== "bootstrapping_cloud" ||
      !openingVideoDone ||
      !bootstrapReady ||
      openingVideoExiting
    ) {
      return;
    }

    setOpeningVideoExiting(true);
  }, [phase, openingVideoDone, bootstrapReady, openingVideoExiting]);

  useEffect(() => {
    if (phase !== "bootstrapping_cloud" || !openingVideoExiting) return;

    const timeout = window.setTimeout(() => {
      if (openingUnlockFallbackRef.current !== null) {
        window.clearTimeout(openingUnlockFallbackRef.current);
        openingUnlockFallbackRef.current = null;
      }
      setPhase("unlocked");
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [phase, openingVideoExiting]);

  useEffect(() => {
    if (!desktopApi || phase !== "bootstrapping_cloud") return;

    let active = true;
    async function bootstrapCloud(): Promise<void> {
      setCloudBootstrapStatus({
        title: "Conectando à nuvem",
        detail: "Verificando internet, credenciais do dispositivo e dados pendentes locais.",
        mode: "running"
      });

      try {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        if (!active || !desktopApi) return;
        setCloudBootstrapStatus({
          title: "Sincronizando dados",
          detail: "Sincronizando dados com a nuvem.",
          mode: "running"
        });
        const result = await desktopApi.bootstrapCloudData();
        if (!active) return;

        if (result.mode === "cloud") {
          const pulledTotal =
            result.pulled.customers +
            result.pulled.products +
            result.pulled.operations +
            result.pulled.loadingRequests +
            result.pulled.printReceipts;
          setCloudBootstrapStatus({
            title: "Dados atualizados",
            detail: `${pulledTotal} registro(s) baixado(s) e ${result.synced} pendencia(s) enviada(s).`,
            mode: "cloud"
          });
          setCloudConnected(true);
          setMessage("Dados carregados da nuvem.");
        } else {
          setCloudBootstrapStatus({
            title: "Modo emergencia local",
            detail: result.errors[0] ?? "Nao foi possivel baixar os dados agora.",
            mode: "local_emergency"
          });
          setCloudConnected(false);
          setMessage("Sem conexao no momento. Usando dados locais ate reconectar.");
        }

        if (active) setBootstrapReady(true);
      } catch (error) {
        if (!active) return;
        setCloudBootstrapStatus({
          title: "Modo emergencia local",
          detail: error instanceof Error ? error.message : "Falha ao carregar os dados.",
          mode: "error"
        });
        setCloudConnected(false);
        setMessage("Falha ao baixar dados. Usando dados locais.");
        if (active) setBootstrapReady(true);
      }
    }

    void bootstrapCloud();
    return () => {
      active = false;
    };
  }, [desktopApi, phase]);

  // Efeito para monitorar bloqueio em tempo real (quando unlocked)
  useEffect(() => {
    if (!desktopApi || phase !== "unlocked") {
      return;
    }

    let active = true;

    async function checkAccess(): Promise<void> {
      if (!active || !desktopApi) return;
      try {
        const access = await desktopApi.validateDesktopAccess(navigator.onLine, false);
        setAccessStatus(access);
        if (!access.canOperate) {
          setPhase("locked");
        }
      } catch (error) {
        console.error("Erro ao verificar acesso:", error);
      }
    }

    void checkAccess();
    const intervalId = window.setInterval(() => void checkAccess(), 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [desktopApi, phase]);

  useEffect(() => {
    if (!desktopApi || phase !== "unlocked") {
      return;
    }

    let active = true;

    async function refresh(): Promise<void> {
      if (!desktopApi) {
        setMessage("API do desktop indisponivel. Abra pelo Electron.");
        return;
      }

      const [
        nextStatus,
        nextUpdateState,
        nextOpenOperations,
        nextCanceledOperations,
        nextClosedOperations,
        nextUnitDevices,
        nextPrinters,
        nextProfiles,
        nextReceipts
      ] = await Promise.all([
        desktopApi.getStatus(navigator.onLine),
        desktopApi.getUpdateState(),
        desktopApi.listOpenWeighingOperations(),
        desktopApi.listCanceledWeighingOperations(),
        desktopApi.listClosedWeighingOperations(),
        desktopApi.listUnitDevices(),
        desktopApi.listWindowsPrinters(),
        desktopApi.listPrintProfiles(),
        desktopApi.listPrintReceipts()
      ]);

      if (!active) return;

      setStatus(nextStatus);
      setUpdateState(nextUpdateState);
      setOpenOperations(nextOpenOperations);
      setCanceledOperations(nextCanceledOperations);
      setClosedOperations(nextClosedOperations);
      setUnitDevices(nextUnitDevices);
      setPrinters(nextPrinters);
      setPrintProfiles(nextProfiles);
      setPrintReceipts(nextReceipts);
      applyReceiptProfileForm(nextProfiles[0]);
      setSelectedPrinterName(
        (current) =>
          current ||
          nextPrinters.find((printer) => printer.isDefault)?.name ||
          nextPrinters[0]?.name ||
          ""
      );

      try {
        const probe = await desktopApi.probeConnectivity();
        if (!active) return;
        const connected = probe.cloudReachable;
        setCloudConnected(connected);
        if (connected) {
          const nextCloudStatus = await desktopApi.getCloudStatus();
          if (active) setCloudStatus(nextCloudStatus);
        }
      } catch {
        if (active) {
          setCloudConnected(false);
        }
      }

      try {
        // Media de tempo dentro da pedreira (ultimos 30 dias) para o alerta de
        // caminhoes acima da media. Best-effort: nao bloqueia o refresh.
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 30);
        const truck = await desktopApi.getTruckControl(
          from.toISOString().slice(0, 10),
          to.toISOString().slice(0, 10)
        );
        if (active) setTruckAverageMinutes(truck.averageMinutes);
      } catch {
        // media indisponivel (ex.: sem identidade) - alerta apenas nao aparece
      }

      try {
        const omieStatusResult = await desktopApi.getOmieStatus();
        if (active) setOmieStatus(omieStatusResult);
      } catch {
        // OMIE status is optional
      }

    }

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 15_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [desktopApi, phase]);

  const autoSyncCloud = useCallback(async () => {
    if (!desktopApi) return;
    if (!navigator.onLine) return;
    setCloudSyncing(true);
    try {
      const result = await desktopApi.syncCloudNow();
      if (result.success) {
        setMessage(
          result.synced > 0
            ? `Sincronizacao cloud concluida: ${result.synced} item(ns) enviados.`
            : "Sincronizacao cloud concluida, sem itens novos."
        );
      } else {
        setMessage(
          `Sincronizacao cloud parcial: ${result.synced} enviados, ${result.failed} falharam.`
        );
      }
      const nextCloudStatus = await desktopApi.getCloudStatus();
      setCloudStatus(nextCloudStatus);
      const probe = await desktopApi.probeConnectivity();
      setCloudConnected(probe.cloudReachable);
      const refreshStatus = await desktopApi.getStatus(navigator.onLine);
      setStatus(refreshStatus);
    } catch (error) {
      setMessage(
        `Falha na sincronizacao automatica: ${error instanceof Error ? error.message : "erro desconhecido"}.`
      );
    } finally {
      setCloudSyncing(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi || phase !== "unlocked") return;
    let cancelled = false;
    const initial = window.setTimeout(() => {
      if (cancelled) return;
      void autoSyncCloud();
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
    };
  }, [desktopApi, phase, autoSyncCloud]);

  const refreshOmieQueue = useCallback(async () => {
    if (!desktopApi) return;
    setOmieQueueLoading(true);
    try {
      setOmieQueue(await desktopApi.omieQueueList());
    } catch {
      setOmieQueue([]);
    } finally {
      setOmieQueueLoading(false);
    }
  }, [desktopApi]);

  // Recarrega a fila OMIE ao abrir a tela cloud e ao terminar sincronizacoes
  // (cloudSyncing/omieSyncing viram false quando concluem).
  useEffect(() => {
    if (activeView !== "cloud" || cloudSyncing || omieSyncing) return;
    void refreshOmieQueue();
  }, [activeView, cloudSyncing, omieSyncing, refreshOmieQueue]);

  async function handleOmieQueueDelete(jobId: string): Promise<void> {
    if (!desktopApi) return;
    setOmieQueueBusyId(jobId);
    try {
      const result = await desktopApi.omieQueueDelete(jobId);
      setMessage(
        result.deleted
          ? "Item removido da fila OMIE. Este fechamento nao sera mais enviado ao OMIE."
          : "Item nao encontrado na fila OMIE."
      );
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setOmieQueueBusyId(null);
      setOmieQueueConfirmDeleteId(null);
      void refreshOmieQueue();
    }
  }

  async function handleOmieQueueSendNow(jobId: string): Promise<void> {
    if (!desktopApi) return;
    setOmieQueueBusyId(jobId);
    try {
      const result = await desktopApi.omieQueueSendNow(jobId);
      if (result.errors.length > 0) {
        setMessage(`Envio OMIE: ${result.errors[0]}`);
      } else if (result.processed > 0) {
        setMessage("Pedido enviado ao OMIE com sucesso.");
      } else {
        setMessage("Item rearmado; sera enviado na proxima sincronizacao.");
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setOmieQueueBusyId(null);
      void refreshOmieQueue();
    }
  }

  useEffect(() => {
    if (!desktopApi || phase !== "unlocked") return;
    const handleOnline = () => {
      setMessage("Internet disponivel novamente - drenando fila de sincronizacao.");
      void autoSyncCloud();
    };
    const handleOffline = () => {
      setMessage(
        "Internet indisponivel - operacao segue normalmente, dados ficarao na fila para envio."
      );
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [desktopApi, phase, autoSyncCloud]);

  async function refreshOpenOperations(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const [
      nextOpenOperations,
      nextCanceledOperations,
      nextClosedOperations,
      nextUnitDevices,
      nextStatus
    ] = await Promise.all([
      desktopApi.listOpenWeighingOperations(),
      desktopApi.listCanceledWeighingOperations(),
      desktopApi.listClosedWeighingOperations(),
      desktopApi.listUnitDevices(),
      desktopApi.getStatus(navigator.onLine)
    ]);
    setOpenOperations(nextOpenOperations);
    setCanceledOperations(nextCanceledOperations);
    setClosedOperations(nextClosedOperations);
    setUnitDevices(nextUnitDevices);
    setStatus(nextStatus);
  }

  async function refreshPrintData(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const [nextProfiles, nextReceipts] = await Promise.all([
      desktopApi.listPrintProfiles(),
      desktopApi.listPrintReceipts()
    ]);
    setPrintProfiles(nextProfiles);
    setPrintReceipts(nextReceipts);
    applyReceiptProfileForm(nextProfiles[0]);
  }

  function applyReceiptProfileForm(profile: PrintProfileSummary | undefined): void {
    if (!profile) {
      return;
    }

    setPrinterType(profile.printerType);
    setSelectedPrinterName(profile.windowsPrinterName);
    setNetworkPrinterHost(profile.networkHost ?? "");
    setNetworkPrinterPort(String(profile.networkPort ?? 9100));
    setReceiptLogoDataUrl(profile.receiptLogo.dataUrl);
    setReceiptLogoWidthMm(String(profile.receiptLogo.widthMm));
    setReceiptLogoHeightMm(String(profile.receiptLogo.heightMm));
    setReceiptLogoFit(profile.receiptLogo.fit);
    setReceiptTemplateConfig(profile.templateConfig);
  }

  async function handleExportBackup(): Promise<void> {
    const result = await desktopApi?.exportBackup();
    setMessage(
      result ? `Backup exportado: ${result.backupPath}` : "Exportacao de backup cancelada."
    );
  }

  async function handleRestoreBackup(): Promise<void> {
    const restored = await desktopApi?.restoreBackup();
    setMessage(restored ? "Backup restaurado com sucesso." : "Restauracao cancelada.");
  }

  async function handleLogout(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const confirmed = window.confirm(
      "Deseja realmente sair da conta?\n\nVocê precisará de um novo código de ativação para acessar novamente."
    );

    if (!confirmed) {
      return;
    }

    await desktopApi.logoutDesktop();
    setAccessStatus(null);
    setPhase("locked");
  }

  async function handleUpdateAction(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const nextState =
      updateState.status === "available" || updateState.status === "downloaded"
        ? await desktopApi.downloadAndInstallUpdate()
        : await desktopApi.checkForUpdates();

    setUpdateState(nextState);
    setMessage(nextState.errorMessage ?? describeUpdateState(nextState));
  }

  async function handleSyncToCloud(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    setCloudSyncing(true);
    try {
      const result = await desktopApi.syncToCloud();
      setCloudConnected(true);
      const nextCloudStatus = await desktopApi.getCloudStatus();
      setCloudStatus(nextCloudStatus);

      if (result.success) {
        setMessage(`Sincronizado com sucesso! ${result.synced} registros enviados.`);
      } else {
        setMessage(
          `Sincronizacao concluida com erros. ${result.synced} enviados, ${result.failed} falhas.`
        );
        if (result.errors.length > 0) {
          console.error("Cloud sync errors:", result.errors);
        }
      }
    } catch (error) {
      setMessage(
        `Falha na sincronizacao: ${error instanceof Error ? error.message : "Erro desconhecido"}`
      );
    } finally {
      setCloudSyncing(false);
    }
  }

  async function handleSyncOmie(): Promise<void> {
    if (!desktopApi) return;

    setOmieSyncing(true);
    setOmieConnectionFeedback({
      status: "checking",
      message: "Conectando ao OMIE pelo bridge seguro..."
    });
    setMessage("Sincronizando OMIE...");
    try {
      const result = await desktopApi.omieSync();
      const parts: string[] = [];
      if (result.customersPushed > 0) parts.push(`${result.customersPushed} clientes enviados`);
      if (result.customersPushFailed > 0)
        parts.push(`${result.customersPushFailed} clientes com falha`);
      parts.push(
        `${result.customersPulled} clientes baixados`,
        `${result.productsSynced} produtos`,
        `${result.paymentTermsSynced} condicoes`
      );
      parts.push(`pedidos: ${result.ordersProcessed} ok, ${result.ordersFailed} falhas`);
      if (result.errors.length > 0) {
        parts.push(`${result.errors.length} erro(s)`);
      }
      const omieStatusResult = await desktopApi.getOmieStatus();
      setOmieStatus(omieStatusResult);
      const summary = `OMIE: ${parts.join(" | ")}`;
      setMessage(summary);
      const hasFailures =
        result.errors.length > 0 || result.ordersFailed > 0 || result.customersPushFailed > 0;
      setOmieConnectionFeedback({
        status: hasFailures ? "warning" : "success",
        message: hasFailures
          ? "Conexao OMIE respondeu, mas houve falhas em alguns itens."
          : "Conexao OMIE OK. Dados enviados e recebidos com sucesso.",
        details: summary
      });
      if (result.errors.length > 0) {
        console.error("OMIE sync errors:", result.errors);
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setMessage(`Falha no sync OMIE: ${errorMessage}`);
      setOmieConnectionFeedback({
        status: "error",
        message: "Nao foi possivel conectar/sincronizar com o OMIE.",
        details: errorMessage
      });
    } finally {
      setOmieSyncing(false);
    }
  }

  async function handleResetOmieMaster(): Promise<void> {
    if (!desktopApi) return;

    const confirmed = window.confirm(
      "Isso vai apagar todos os clientes, transportadoras e dados de sincronizacao OMIE locais, e depois forcar uma re-sincronizacao completa. Deseja continuar?"
    );
    if (!confirmed) return;

    setOmieResetting(true);
    setOmieConnectionFeedback({
      status: "checking",
      message: "Limpando dados locais OMIE..."
    });
    setMessage("Limpando dados OMIE...");
    try {
      const resetResult = await desktopApi.resetOmieMaster();
      setMessage(
        `Dados OMIE limpos: ${resetResult.customersCleared} clientes, ${resetResult.carriersCleared} transportadoras, ${resetResult.productsCleared} produtos, ${resetResult.paymentTermsCleared} condicoes, ${resetResult.syncRunsCleared} runs, ${resetResult.syncQueueCleared} jobs.`
      );

      setOmieConnectionFeedback({
        status: "success",
        message: "Dados locais limpos. Iniciando sincronizacao completa..."
      });

      // Trigger a full sync after reset
      const syncResult = await desktopApi.omieSync();
      const parts: string[] = [];
      if (syncResult.customersPushed > 0)
        parts.push(`${syncResult.customersPushed} clientes enviados`);
      if (syncResult.customersPushFailed > 0)
        parts.push(`${syncResult.customersPushFailed} clientes com falha`);
      parts.push(
        `${syncResult.customersPulled} clientes baixados`,
        `${syncResult.productsSynced} produtos`,
        `${syncResult.paymentTermsSynced} condicoes`
      );
      parts.push(`pedidos: ${syncResult.ordersProcessed} ok, ${syncResult.ordersFailed} falhas`);
      if (syncResult.errors.length > 0) {
        parts.push(`${syncResult.errors.length} erro(s)`);
      }
      const omieStatusResult = await desktopApi.getOmieStatus();
      setOmieStatus(omieStatusResult);
      const summary = `OMIE re-sync: ${parts.join(" | ")}`;
      setMessage(summary);
      const hasFailures =
        syncResult.errors.length > 0 ||
        syncResult.ordersFailed > 0 ||
        syncResult.customersPushFailed > 0;
      setOmieConnectionFeedback({
        status: hasFailures ? "warning" : "success",
        message: hasFailures
          ? "Re-sincronizacao concluida, mas houve falhas em alguns itens."
          : "Re-sincronizacao completa concluida com sucesso.",
        details: summary
      });
      if (syncResult.errors.length > 0) {
        console.error("OMIE re-sync errors:", syncResult.errors);
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setMessage(`Falha ao limpar/re-sincronizar OMIE: ${errorMessage}`);
      setOmieConnectionFeedback({
        status: "error",
        message: "Nao foi possivel limpar ou re-sincronizar com o OMIE.",
        details: errorMessage
      });
    } finally {
      setOmieResetting(false);
    }
  }

  async function handleStartWeighing(scaleCaptureId?: string): Promise<void> {
    if (!desktopApi) return;

    const validationError = validateWeighingForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const paymentGuard = await resolvePaymentConditionGuard(desktopApi, form);
    if (!paymentGuard.allowed) {
      setFormError(
        paymentGuard.message ?? "Combinacao de forma e condicao de pagamento invalida."
      );
      return;
    }

    setFormError(null);
    setMessage("Aguardando peso estavel da balanca. Aguarde...");

    try {
      const manualInstallments =
        form.paymentMode === "manual" ? Number(form.manualInstallments.trim()) : undefined;
      // Condicao digitada livre vence o select: vira (ou reusa) um payment_term local.
      const customCondition = form.customConditionText.trim();
      const effectivePaymentTermId = customCondition
        ? await resolveConditionTermId(desktopApi, customCondition)
        : form.paymentMode === "registered"
          ? form.paymentTermId || undefined
          : undefined;
      const operation = await desktopApi.startWeighing({
        operationType: form.operationType,
        customerId: form.customerId,
        vehicleId: form.vehicleId,
        carrierId: isCustomerOwnTransport(form) ? undefined : form.carrierId || undefined,
        driverId: form.driverId,
        productId: form.productId,
        paymentTermId: effectivePaymentTermId,
        paymentMethodId: form.paymentMethodId || undefined,
        manualInstallments,
        manualDownPaymentCents:
          form.paymentMode === "manual" && form.manualDownPaymentEnabled
            ? (form.manualDownPaymentCents ?? 0)
            : undefined,
        freight: buildFreightInput(form),
        freightModality: form.freightModality,
        quotationId: form.quotationId || undefined,
        deductFreightFromCredit: form.deductFreightFromCredit || freightGoesToCustomerInvoice(form),
        scaleCaptureId
      });
      setMessage(`Entrada registrada com peso estavel capturado: ${operation.entryWeightKg} kg.`);
      setForm(initialWeighingForm);
      setActiveView("open-operations");
      await refreshOpenOperations();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  async function handleCloseOperation(
    operationId: string,
    operationType: OperationType,
    scaleCaptureId?: string
  ): Promise<void> {
    if (!desktopApi) return;

    // O faturamento (NF-e) e feito INTEIRAMENTE no OMIE: o fechamento apenas cria o
    // pedido de venda (etapa "Faturar"). Nao ha mais faturamento automatico aqui — por
    // isso nao exigimos internet no fechamento (o pedido sobe na proxima sincronizacao).
    setMessage(
      operationType === "invoice"
        ? "Fechando operacao fiscal e enviando o pedido ao OMIE."
        : "Fechando operacao interna."
    );

    try {
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId,
          status: "running",
          step: "weighing",
          title: "Fechando saida fiscal",
          detail:
            "Capturando peso de saida com os criterios configurados e calculando peso liquido."
        });
      }
      const operation = await desktopApi.closeWeighing(operationId, operationType, scaleCaptureId);
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId: operation.id,
          status: "running",
          step: "billing",
          title: "Enviando pedido ao OMIE",
          detail:
            'O pedido de venda sobe ao OMIE na etapa "Faturar". A emissao da NF-e e feita no proprio OMIE.'
        });
        setFiscalCloseProgress({
          operationId: operation.id,
          status: "running",
          step: "receipt",
          title: "Imprimindo cupom",
          detail: "Emitindo o comprovante local da pesagem."
        });
      }
      let receiptStatus = "";
      try {
        const receipt = await desktopApi.printReceipt(operation.id);
        receiptStatus =
          receipt.status === "printed"
            ? `Cupom ${receipt.receiptNumber} impresso.`
            : `Falha ao imprimir cupom: ${receipt.errorMessage}.`;
      } catch (error) {
        receiptStatus = `Cupom nao impresso: ${getErrorMessage(error)}.`;
      }
      const operationLabel =
        operationType === "invoice" ? "Operacao fiscal fechada" : "Operacao interna fechada";
      const fiscalStatus =
        operationType === "invoice"
          ? 'Pedido enviado ao OMIE para faturar (coluna "Faturar"). '
          : "";
      setMessage(
        `${operationLabel}. Peso liquido: ${operation.netWeightKg} kg. ${fiscalStatus}${receiptStatus}`
      );
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId: operation.id,
          status: "success",
          step: "receipt",
          title: "Saida fiscal concluida",
          detail: 'Pedido enviado ao OMIE. Emita a NF-e no OMIE (coluna "Faturar").'
        });
      }
      await refreshOpenOperations();
      await refreshPrintData();
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setMessage(errorMessage);
      if (operationType === "invoice") {
        setFiscalCloseProgress((current) => ({
          operationId,
          status: "error",
          step: current?.step ?? "billing",
          title: "Saida fiscal exige atencao",
          detail: errorMessage
        }));
      }
      await refreshOpenOperations();
    }
  }

  async function handleRetryFiscalBilling(operationId: string): Promise<void> {
    if (!desktopApi) return;

    if (!navigator.onLine) {
      setMessage("Retry fiscal exige internet conectada para falar com o OMIE.");
      return;
    }

    setRetryingFiscalOperationId(operationId);
    setFiscalCloseProgress({
      operationId,
      status: "running",
      step: "billing",
      title: "Retentando faturamento OMIE",
      detail: "Reprocessando o job fiscal pendente desta operacao."
    });

    try {
      const billingStatus = await desktopApi.billFiscalOperation(operationId);
      if (billingStatus.blocked) {
        // Cadastro ainda incompleto: aviso acionavel, nao erro. O job segue re-executavel.
        const reason =
          billingStatus.blockReason ??
          "Cadastro do cliente incompleto para NF-e (Numero do Endereco + E-mail).";
        setFiscalCloseProgress({
          operationId,
          status: "success",
          step: "billing",
          title: "Faturamento pendente — cadastro incompleto",
          detail: reason
        });
        setMessage(reason);
        await refreshOpenOperations();
        return;
      }
      const danfeStatus = billingStatus.documentUrl
        ? billingStatus.documentPrinted
          ? "DANFE enviado para impressora."
          : `DANFE disponivel, mas sem impressao automatica: ${billingStatus.documentPrintError ?? "sem detalhe"}.`
        : "DANFE ainda nao foi retornado pela OMIE.";
      setFiscalCloseProgress({
        operationId,
        status: "success",
        step: "danfe",
        title: "Faturamento fiscal recuperado",
        detail: `Pedido OMIE ${billingStatus.orderId} faturado. ${danfeStatus}`
      });
      setMessage(`Faturamento OMIE recuperado para a operacao. ${danfeStatus}`);
      await refreshOpenOperations();
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setFiscalCloseProgress({
        operationId,
        status: "error",
        step: "billing",
        title: "Retry fiscal falhou",
        detail: errorMessage
      });
      setMessage(errorMessage);
      await refreshOpenOperations();
    } finally {
      setRetryingFiscalOperationId(null);
    }
  }

  // "Editar cliente" de uma operacao concluida: abre a tela de Clientes ja filtrada
  // pelo cliente, para corrigir o cadastro (endereco/e-mail) e reenviar depois.
  function handleEditOperationCustomer(operation: WeighingOperationSummary): void {
    setCustomersInitialSearch(operation.customerName || "");
    setRegistrationsTab("customers");
    setActiveView("registrations");
  }

  async function handleDeleteClosedOperation(operationId: string): Promise<void> {
    if (!desktopApi) return;
    try {
      await desktopApi.deleteClosedWeighingOperation(operationId);
      setDeleteClosedOperationId(null);
      await refreshOpenOperations();
      setMessage("Operacao concluida excluida.");
    } catch (error) {
      setDeleteClosedOperationId(null);
      setMessage(getErrorMessage(error));
    }
  }

  async function handleConfigureReceiptPrinter(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const printerName = selectedPrinterName.trim();
    const networkHost = networkPrinterHost.trim();
    const networkPort = Number(networkPrinterPort || 9100);

    if (printerType === "windows" && !printerName) {
      setMessage("Selecione uma impressora do Windows antes de salvar o perfil.");
      return;
    }

    if (printerType === "network" && !networkHost) {
      setMessage("Informe o IP ou host da impressora de rede antes de salvar o perfil.");
      return;
    }

    if (
      printerType === "network" &&
      (!Number.isInteger(networkPort) || networkPort < 1 || networkPort > 65535)
    ) {
      setMessage("Informe uma porta TCP valida para a impressora de rede.");
      return;
    }

    try {
      const profile = await desktopApi.configureReceiptPrintProfile({
        printerType,
        windowsPrinterName: printerType === "windows" ? printerName : printerName || "NETWORK",
        networkHost: printerType === "network" ? networkHost : null,
        networkPort: printerType === "network" ? networkPort : null,
        paperWidthMm: 80,
        copies: 2,
        receiptLogoDataUrl: receiptLogoDataUrl,
        receiptLogoWidthMm: Number(receiptLogoWidthMm),
        receiptLogoHeightMm: Number(receiptLogoHeightMm),
        receiptLogoFit,
        templateConfig: receiptTemplateConfig
      });
      setMessage(
        profile.printerType === "network"
          ? `Impressora de rede configurada: ${profile.networkHost}:${profile.networkPort}.`
          : `Impressora de cupom configurada: ${profile.windowsPrinterName}.`
      );
      await refreshPrintData();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  function updateReceiptTemplateConfig(patch: Partial<ReceiptTemplateConfig>): void {
    setReceiptTemplateConfig((current) => ({ ...current, ...patch }));
  }

  async function handleReceiptLogoFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setMessage("Selecione um arquivo de imagem para a logo do cupom.");
      return;
    }

    try {
      setReceiptLogoDataUrl(await readFileAsDataUrl(file));
      setMessage("Logo carregada. Ajuste tamanho/formato e salve o perfil.");
    } catch (error) {
      setMessage(`Falha ao carregar logo: ${getErrorMessage(error)}.`);
    }
  }

  async function handleReprintReceipt(receiptId: string): Promise<void> {
    if (!desktopApi) {
      return;
    }

    try {
      const receipt = await desktopApi.reprintReceipt(receiptId);
      setMessage(
        receipt.status === "printed"
          ? `Segunda via impressa: cupom ${receipt.receiptNumber}, via ${receipt.copyNumber}.`
          : `Falha ao reimprimir: ${receipt.errorMessage}.`
      );
      await refreshPrintData();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  // Reimpressao de emergencia direto da tela Concluidas: emite uma nova via (2a, 3a...)
  // da nota daquela operacao, util quando faltou papel ou o cupom saiu ilegivel.
  async function handleReprintOperationReceipt(operationId: string): Promise<void> {
    if (!desktopApi) {
      return;
    }

    setReprintingOperationId(operationId);
    try {
      const receipt = await desktopApi.printReceipt(operationId);
      setMessage(
        receipt.status === "printed"
          ? `Nota reimpressa: cupom ${receipt.receiptNumber}, via ${receipt.copyNumber}.`
          : `Falha ao reimprimir nota: ${receipt.errorMessage}.`
      );
      await refreshPrintData();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setReprintingOperationId(null);
    }
  }

  async function handlePrintTest(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    try {
      const receipt = await desktopApi.printTestReceipt();
      setMessage(
        receipt.status === "printed"
          ? `Cupom de teste impresso com sucesso na ${receipt.printerName}.`
          : `Falha ao imprimir teste: ${receipt.errorMessage}.`
      );
      await refreshPrintData();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleCancelOperation(operationId: string, reason: string): Promise<void> {
    if (!desktopApi) {
      return;
    }

    try {
      const operation = await desktopApi.cancelWeighing(operationId, reason);
      setMessage(
        operation.omieSalesOrderId
          ? `Venda cancelada. Cancelamento do pedido OMIE ${operation.omieSalesOrderId} solicitado; a operacao saiu dos insights e relatorios.`
          : `Operacao cancelada: ${operation.cancelReason}.`
      );
      await refreshOpenOperations();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleClearCanceledOperations(): Promise<void> {
    if (!desktopApi) {
      return;
    }
    if (!window.confirm("Limpar todas as operacoes canceladas da lista?")) {
      return;
    }

    try {
      const count = await desktopApi.clearCanceledWeighingOperations();
      setMessage(`${count} operacao(oes) cancelada(s) removida(s) da lista.`);
      await refreshOpenOperations();
    } catch (error) {
      setMessage(getErrorMessage(error));
      await refreshOpenOperations();
    }
  }

  async function handleOpenChangeProduct(operation: WeighingOperationSummary): Promise<void> {
    if (!desktopApi) return;
    setChangeProductOperation(operation);
    setChangeProductLoading(true);
    try {
      const result = await desktopApi.queryCache({
        entityType: "product",
        activeOnly: true,
        limit: 500
      });
      setChangeProductOptions(
        (result.rows as Array<{ id: string; description: string }>)
          .filter((p) => p.id !== operation.id)
          .sort((a, b) => a.description.localeCompare(b.description))
      );
    } catch {
      setChangeProductOptions([]);
    } finally {
      setChangeProductLoading(false);
    }
  }

  async function handleConfirmChangeProduct(newProductId: string): Promise<void> {
    if (!desktopApi || !changeProductOperation) return;
    try {
      await desktopApi.updateWeighingProduct(changeProductOperation.id, newProductId);
      setMessage("Produto alterado com sucesso.");
      setChangeProductOperation(null);
      await refreshOpenOperations();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleOpenChangeCustomer(operation: WeighingOperationSummary): Promise<void> {
    if (!desktopApi) return;
    setChangeCustomerOperation(operation);
    setChangeCustomerLoading(true);
    try {
      const result = await desktopApi.queryCache({
        entityType: "customer",
        activeOnly: true,
        limit: 500
      });
      setChangeCustomerOptions(
        createCacheSelectOptions(result.rows as Array<Record<string, unknown>>).sort((a, b) =>
          a.label.localeCompare(b.label)
        )
      );
    } catch {
      setChangeCustomerOptions([]);
    } finally {
      setChangeCustomerLoading(false);
    }
  }

  async function handleConfirmChangeCustomer(newCustomerId: string): Promise<void> {
    if (!desktopApi || !changeCustomerOperation) return;
    try {
      await desktopApi.updateWeighingCustomer(changeCustomerOperation.id, newCustomerId);
      setMessage("Cliente alterado com sucesso.");
      setChangeCustomerOperation(null);
      await refreshOpenOperations();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleOpenChangeCarrier(operation: WeighingOperationSummary): Promise<void> {
    if (!desktopApi) return;
    setChangeCarrierOperation(operation);
    setChangeCarrierLoading(true);
    try {
      const result = await desktopApi.queryCache({
        entityType: "carrier",
        activeOnly: true,
        limit: 500
      });
      setChangeCarrierOptions(
        createCacheSelectOptions(result.rows as Array<Record<string, unknown>>).sort((a, b) =>
          a.label.localeCompare(b.label)
        )
      );
    } catch {
      setChangeCarrierOptions([]);
    } finally {
      setChangeCarrierLoading(false);
    }
  }

  async function handleConfirmChangeCarrier(newCarrierId: string | null): Promise<void> {
    if (!desktopApi || !changeCarrierOperation) return;
    try {
      await desktopApi.updateWeighingCarrier(changeCarrierOperation.id, newCarrierId);
      setMessage("Transportadora alterada com sucesso.");
      setChangeCarrierOperation(null);
      await refreshOpenOperations();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  if (phase === "checking_access") {
    return (
      <main style={{ ...styles.page, ...getThemeVariables("light") }}>
        <div style={{ ...styles.card, maxWidth: "480px", margin: "auto", marginTop: "40px" }}>
          <h1 style={styles.title}>KyberRock</h1>
          <p style={styles.subtitle}>Verificando acesso...</p>
        </div>
      </main>
    );
  }

  if (phase === "locked") {
    if (!desktopApi) {
      return (
        <main style={{ ...styles.page, ...getThemeVariables("light") }}>
          <div style={{ ...styles.card, maxWidth: "480px", margin: "auto", marginTop: "40px" }}>
            <h1 style={styles.title}>API do desktop indisponivel</h1>
            <p style={styles.subtitle}>Abra o aplicativo pelo Electron.</p>
          </div>
        </main>
      );
    }

    // Se o desktop ja esta ativado mas foi bloqueado (ex: empresa desativada), mostra tela de bloqueio
    // Se ainda nao esta ativado, mostra a tela de ativacao
    if (accessStatus && !accessStatus.requiresActivation) {
      return <BlockedScreen desktopApi={desktopApi} onUnlocked={handleUnlocked} />;
    }

    return <ActivationGate desktopApi={desktopApi} onUnlocked={handleUnlocked} />;
  }

  if (phase === "bootstrapping_cloud") {
    return (
      <main style={styles.openingVideoScreen}>
        <video
          src="midia/kyberrockvideo.mp4"
          autoPlay
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration) && duration > 0) {
              if (openingVideoFallbackRef.current !== null) {
                window.clearTimeout(openingVideoFallbackRef.current);
              }
              openingVideoFallbackRef.current = window.setTimeout(
                finishOpeningVideo,
                Math.ceil(duration * 1000) + 600
              );
            }
          }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget;
            if (Number.isFinite(video.duration) && video.duration > 0) {
              if (video.currentTime >= video.duration - 0.12) finishOpeningVideo();
            }
          }}
          onEnded={finishOpeningVideo}
          onError={finishOpeningVideo}
          style={{
            ...styles.openingVideo,
            opacity: openingVideoExiting ? 0 : 1,
            transform: openingVideoExiting ? "scale(1.025)" : "scale(1)"
          }}
        />
        <button
          type="button"
          onClick={finishOpeningVideo}
          style={{
            ...styles.openingSkipButton,
            opacity: openingVideoExiting ? 0 : 1
          }}
        >
          Aperte Enter para pular
        </button>
        <div
          style={{
            ...styles.openingVideoFade,
            opacity: openingVideoExiting ? 1 : 0
          }}
        />
        <span style={styles.visuallyHidden}>{cloudBootstrapStatus.title}</span>
      </main>
    );
  }

  if (!desktopApi) {
    return (
      <main style={{ ...styles.page, ...getThemeVariables("light") }}>
        <div style={{ ...styles.card, maxWidth: "480px", margin: "auto", marginTop: "40px" }}>
          <h1 style={styles.title}>API do desktop indisponivel</h1>
          <p style={styles.subtitle}>Abra o aplicativo pelo Electron.</p>
        </div>
      </main>
    );
  }

  return (
    <main data-theme={themeMode} style={{ ...styles.page, ...themeVars }}>
      <GlobalUiPolish />
      <Toast message={message} onClose={() => setMessage("")} />
      <div style={styles.shell}>
        <aside style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <img src="midia/logo.png" alt="KyberRock" style={styles.sidebarLogo} />
            <span style={styles.sidebarBrand}>{desktopAppInfo.name}</span>
          </div>
          <nav aria-label="Navegacao principal" style={styles.sidebarNav}>
            <SidebarSection title="Operacional">
              <SidebarItem
                id="dashboard"
                label="Painel"
                icon={LayoutDashboard}
                activeView={activeView}
                onSelect={setActiveView}
                tooltip={TIPS.nav.panel}
              />
              <SidebarItem
                id="new-weighing"
                label="Nova entrada"
                icon={PlusCircle}
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="open-operations"
                label="Operacoes"
                icon={ListChecks}
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="registrations"
                label="Cadastros"
                icon={Database}
                activeView={activeView}
                onSelect={setActiveView}
              />
            </SidebarSection>
            <SidebarSection title="Analise">
              <SidebarItem
                id="insights"
                label="Insights"
                icon={BarChart3}
                activeView={activeView}
                onSelect={setActiveView}
                tooltip={TIPS.nav.insights}
              />
              <SidebarItem
                id="truck-control"
                label="Controle de caminhoes"
                icon={Truck}
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="reports"
                label="Relatorios"
                icon={FileText}
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="documentation"
                label="Documentacao"
                icon={BookOpen}
                activeView={activeView}
                onSelect={setActiveView}
              />
            </SidebarSection>
          </nav>
          <div style={styles.sidebarFooter}>
            <div style={styles.topbarRight}>
              <Tooltip content={themeMode === "light" ? "Tema escuro (F11)" : "Tema claro (F11)"}>
                <button
                  type="button"
                  aria-label="Alternar tema"
                  onClick={() => setThemeMode((mode) => (mode === "light" ? "dark" : "light"))}
                  style={styles.headerBtn}
                >
                  {themeMode === "light" ? <Moon size={17} /> : <Sun size={17} />}
                </button>
              </Tooltip>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowSettings((s) => !s)}
                  style={styles.headerBtn}
                  title={
                    updateReady ? "Atualizacao disponivel" : "Configuracoes"
                  }
                >
                  <Settings size={17} />
                  {updateReady ? (
                    <span
                      style={{
                        position: "absolute",
                        top: "4px",
                        right: "4px",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: "#16a34a",
                        border: "1px solid #ffffff"
                      }}
                    />
                  ) : null}
                </button>
                {showSettings ? (
                  <div style={styles.settingsDropdownUp}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView("scale");
                        setShowSettings(false);
                      }}
                      style={styles.settingsItem}
                    >
                      <Scale size={14} />
                      Balanca
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView("printing");
                        setShowSettings(false);
                      }}
                      style={styles.settingsItem}
                    >
                      <Printer size={14} />
                      Impressao
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView("cloud");
                        setShowSettings(false);
                      }}
                      style={styles.settingsItem}
                    >
                      <Cloud size={14} />
                      Cloud
                    </button>
                    <div style={{ height: "1px", background: "#e2e8f0", margin: "4px 0" }} />
                    <button
                      type="button"
                      onClick={() => {
                        void handleUpdateAction();
                        setShowSettings(false);
                      }}
                      style={{
                        ...styles.settingsItem,
                        color: updateReady ? "#16a34a" : styles.settingsItem.color,
                        fontWeight: updateReady ? 600 : styles.settingsItem.fontWeight
                      }}
                      title="Verificar / instalar atualizacao do KyberRock Desktop"
                    >
                      <RefreshCw size={14} />
                      {getManualUpdateButtonLabel(updateState.status)}
                      {updateReady ? (
                        <span
                          style={{
                            marginLeft: "auto",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: "#16a34a"
                          }}
                        />
                      ) : null}
                    </button>
                    <div style={{ height: "1px", background: "#e2e8f0", margin: "4px 0" }} />
                    <button
                      type="button"
                      onClick={() => {
                        setShowLogsModal(true);
                        setShowSettings(false);
                      }}
                      style={{
                        ...styles.settingsItem,
                        color: errorLogs.some((l) => l.level === "error")
                          ? "#b91c1c"
                          : "var(--kr-muted)"
                      }}
                    >
                      <ScrollText size={14} />
                      Logs {errorLogs.length > 0 ? `(${errorLogs.length})` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleExportBackup();
                        setShowSettings(false);
                      }}
                      style={styles.settingsItem}
                    >
                      <Download size={14} />
                      Exportar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRestoreBackup();
                        setShowSettings(false);
                      }}
                      style={styles.settingsItem}
                    >
                      <Upload size={14} />
                      Restaurar
                    </button>
                    <div style={{ height: "1px", background: "#e2e8f0", margin: "4px 0" }} />
                    <button
                      type="button"
                      onClick={() => {
                        void handleLogout();
                        setShowSettings(false);
                      }}
                      style={{ ...styles.settingsItem, color: "#b91c1c" }}
                    >
                      <LogOut size={14} />
                      Sair
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
        <div style={styles.contentColumn}>
          <div style={styles.contentBody}>
            {showSettings ? (
              <div
                style={{ position: "fixed", inset: 0, zIndex: 99 }}
                onClick={() => setShowSettings(false)}
              />
            ) : null}

            {showUpdateModal ? (
              <div style={styles.modalOverlay}>
                <div style={styles.modal}>
                  <h2 style={styles.modalTitle}>Nova versão disponível</h2>
                  <p style={styles.modalText}>
                    A versão <strong>{availableVersion}</strong> do KyberRock Desktop está
                    disponível. Deseja atualizar agora?
                  </p>
                  <div style={styles.modalActions}>
                    <button
                      type="button"
                      onClick={() => {
                        void handleUpdateAction();
                        setShowUpdateModal(false);
                      }}
                      style={styles.primaryButton}
                    >
                      Atualizar agora
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUpdateModal(false)}
                      style={styles.secondaryButton}
                    >
                      Mais tarde
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {showLogsModal ? (
              <div style={styles.modalOverlay}>
                <div style={{ ...styles.modal, maxWidth: "720px", maxHeight: "80vh" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "12px"
                    }}
                  >
                    <h2 style={{ ...styles.modalTitle, margin: 0 }}>Logs do sistema</h2>
                    <IconActionButton
                      icon="trash"
                      label="Limpar logs"
                      tip="Limpar a lista de logs exibida (o historico em disco permanece)"
                      tone="neutral"
                      onClick={() => setErrorLogs([])}
                    />
                  </div>
                  {errorLogs.length === 0 ? (
                    <p style={styles.muted}>
                      Nenhum log capturado. Logs de erro aparecerao aqui automaticamente.
                    </p>
                  ) : (
                    <div
                      style={{
                        maxHeight: "60vh",
                        overflowY: "auto",
                        border: "1px solid var(--kr-border)",
                        borderRadius: "10px"
                      }}
                    >
                      {errorLogs
                        .slice()
                        .reverse()
                        .map((log, index) => (
                          <div
                            key={`${log.timestamp}-${index}`}
                            style={{
                              padding: "8px 12px",
                              borderBottom: "1px solid var(--kr-border)",
                              background:
                                log.level === "error"
                                  ? "#fef2f2"
                                  : log.level === "warn"
                                    ? "#fffbeb"
                                    : "var(--kr-surface)"
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: "8px",
                                alignItems: "center",
                                fontSize: "12px",
                                color: "var(--kr-muted)"
                              }}
                            >
                              <span>{formatDbDateTime(log.timestamp)}</span>
                              <span
                                style={{
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  background:
                                    log.level === "error"
                                      ? "#fee2e2"
                                      : log.level === "warn"
                                        ? "#fef3c7"
                                        : "#e2e8f0",
                                  color:
                                    log.level === "error"
                                      ? "#991b1b"
                                      : log.level === "warn"
                                        ? "#92400e"
                                        : "#475569",
                                  fontWeight: 700,
                                  fontSize: "10px"
                                }}
                              >
                                {log.level.toUpperCase()}
                              </span>
                              <span>{log.source}</span>
                            </div>
                            <div
                              style={{
                                marginTop: "4px",
                                fontSize: "13px",
                                color: "var(--kr-text-strong)",
                                wordBreak: "break-word"
                              }}
                            >
                              {log.message}
                            </div>
                            {log.details ? (
                              <div
                                style={{
                                  marginTop: "4px",
                                  fontSize: "11px",
                                  color: "var(--kr-muted)",
                                  wordBreak: "break-word"
                                }}
                              >
                                {log.details}
                              </div>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
                    <button
                      type="button"
                      onClick={() => setShowLogsModal(false)}
                      style={styles.secondaryButton}
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeView === "dashboard" ? (
              <DashboardView
                status={status}
                openOperations={openOperations}
                closedOperations={closedOperations}
                cloudConnected={cloudConnected}
                omieStatus={omieStatus}
                printProfiles={printProfiles}
                errorLogsCount={errorLogs.length}
                onNavigate={setActiveView}
                onSyncOmie={() => void handleSyncOmie()}
                onSyncCloud={() => void handleSyncToCloud()}
                onOpenLogs={() => setShowLogsModal(true)}
              />
            ) : null}

            {activeView === "new-weighing" ? (
              <WeighingForm
                desktopApi={desktopApi}
                form={form}
                setForm={setForm}
                formError={formError}
                setFormError={setFormError}
                onStart={handleStartWeighing}
                onCancel={() => {
                  setForm(initialWeighingForm);
                  setFormError(null);
                  setActiveView("dashboard");
                }}
              />
            ) : null}

            {activeView === "open-operations" ? (
              <section style={styles.operationsPanel}>
                <div style={styles.sectionTitleRow}>
                  <div>
                    <p style={styles.kicker}>Fila operacional</p>
                    <h2 style={styles.panelTitle}>Operacoes</h2>
                  </div>
                  <span style={styles.countBadge}>
                    {operationsTab === "open"
                      ? `${openOperations.length} abertas`
                      : operationsTab === "canceled"
                        ? `${filteredCanceledOperations.length} canceladas`
                        : `${filteredClosedOperations.length} concluidas`}
                  </span>
                </div>

                <div style={styles.operationsToolbar}>
                  <div style={styles.segmentedTabs}>
                    <Tooltip content="Operacoes abertas" placement="bottom">
                      <button
                        type="button"
                        aria-label="Operacoes abertas"
                        aria-pressed={operationsTab === "open"}
                        onClick={() => setOperationsTab("open")}
                        style={operationsTabStyle(operationsTab === "open")}
                      >
                        <OpIcon name="clock" />
                      </button>
                    </Tooltip>
                    <Tooltip content="Operacoes canceladas" placement="bottom">
                      <button
                        type="button"
                        aria-label="Operacoes canceladas"
                        aria-pressed={operationsTab === "canceled"}
                        onClick={() => setOperationsTab("canceled")}
                        style={operationsTabStyle(operationsTab === "canceled")}
                      >
                        <OpIcon name="ban" />
                      </button>
                    </Tooltip>
                    <Tooltip content="Operacoes concluidas" placement="bottom">
                      <button
                        type="button"
                        aria-label="Operacoes concluidas"
                        aria-pressed={operationsTab === "closed"}
                        onClick={() => setOperationsTab("closed")}
                        style={operationsTabStyle(operationsTab === "closed")}
                      >
                        <OpIcon name="check" />
                      </button>
                    </Tooltip>
                  </div>

                  {operationsTab === "canceled" ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        flexWrap: "wrap"
                      }}
                    >
                      <label
                        style={{ ...styles.fieldLabel, marginBottom: 0 }}
                        title={TIPS.operations.filterPeriod}
                      >
                        Periodo
                        <select
                          value={canceledFilter}
                          onChange={(event) =>
                            setCanceledFilter(event.target.value as CanceledFilter)
                          }
                          style={{ ...styles.input, minWidth: "150px" }}
                        >
                          <option value="all">Todas</option>
                          <option value="day">Hoje</option>
                          <option value="week">Ultimos 7 dias</option>
                          <option value="month">Este mes</option>
                        </select>
                      </label>
                      <IconActionButton
                        icon="trash"
                        label="Limpar canceladas"
                        tip={TIPS.operations.clearCanceled}
                        tone="danger"
                        placement="bottom"
                        disabled={canceledOperations.length === 0}
                        onClick={() => void handleClearCanceledOperations()}
                      />
                    </div>
                  ) : operationsTab === "closed" ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        flexWrap: "wrap"
                      }}
                    >
                      <label
                        style={{ ...styles.fieldLabel, marginBottom: 0 }}
                        title={TIPS.operations.filterProduct}
                      >
                        Produto
                        <select
                          value={closedProductFilter}
                          onChange={(event) => setClosedProductFilter(event.target.value)}
                          style={{ ...styles.input, minWidth: "180px" }}
                        >
                          <option value="all">Todos</option>
                          {Array.from(new Set(closedOperations.map((op) => op.productDescription)))
                            .filter(Boolean)
                            .map((desc) => (
                              <option key={desc} value={desc}>
                                {desc}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>

                {showDeviceColors ? <DeviceColorLegend devices={unitDevices} /> : null}

                {operationsTab === "open" ? (
                  openOperations.length === 0 ? (
                    <div style={styles.emptyState}>
                      <strong>Nenhuma operacao aberta</strong>
                      <span>
                        As entradas capturadas pela balanca aparecem aqui para fechamento.
                      </span>
                    </div>
                  ) : (
                    <div style={styles.operationsTable}>
                      {loaderCompletionNotice ? (
                        <div
                          role="status"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "10px 12px",
                            marginBottom: "8px",
                            borderRadius: "10px",
                            border: "1px solid #86efac",
                            background: "#f0fdf4",
                            color: "#15803d",
                            fontSize: "13px",
                            fontWeight: 700
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: "10px",
                              height: "10px",
                              borderRadius: "50%",
                              background: "#22c55e",
                              flexShrink: 0
                            }}
                          />
                          <span style={{ flex: 1 }}>✓ {loaderCompletionNotice}</span>
                          <button
                            type="button"
                            onClick={() => setLoaderCompletionNotice(null)}
                            aria-label="Dispensar aviso"
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "#15803d",
                              cursor: "pointer",
                              fontWeight: 900,
                              fontSize: "15px",
                              lineHeight: 1,
                              padding: "0 2px"
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ) : null}
                      {overtimeOpenOperations.length > 0 ? (
                        <div
                          role="alert"
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: "8px",
                            padding: "10px 12px",
                            marginBottom: "8px",
                            borderRadius: "10px",
                            border: "1px solid #fca5a5",
                            background: "#fef2f2",
                            color: "#b91c1c",
                            fontSize: "13px",
                            fontWeight: 700
                          }}
                        >
                          <span>⚠ Acima do tempo medio ({formatMinutes(truckAverageMinutes)}):</span>
                          {overtimeOpenOperations.map((op) => (
                            <span
                              key={op.id}
                              style={{
                                background: "#fff",
                                border: "1px solid #fca5a5",
                                borderRadius: "8px",
                                padding: "2px 8px",
                                letterSpacing: "0.06em"
                              }}
                            >
                              {op.plate || "SEM PLACA"} · {formatElapsedSince(op.createdAt)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div style={{ ...styles.operationsTableRow, ...styles.operationsTableHead }}>
                        <span>Placa / Carregador</span>
                        <span>Cliente / Produto</span>
                        <span>Entrada / Preco</span>
                        <span>Acoes</span>
                      </div>
                      {openOperations.map((operation) => {
                        const isOvertime = overtimeOpenIds.has(operation.id);
                        return (
                        <div
                          key={operation.id}
                          style={{
                            ...styles.operationsTableRow,
                            ...(isOvertime ? { background: "#fef2f2" } : {}),
                            ...operationOutlineStyle(operation)
                          }}
                        >
                          <span
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: "5px",
                              minWidth: 0
                            }}
                          >
                            <strong style={styles.plateBadge}>{operation.plate}</strong>
                            <LoaderStatusLight completedAt={operation.loaderCompletedAt} />
                          </span>
                          <span style={styles.operationCellStack}>
                            <strong>{operation.customerName}</strong>
                            <span>{operation.productDescription}</span>
                            <small>Motorista: {operation.driverName}</small>
                          </span>
                          <span style={styles.operationCellStack}>
                            <strong>{formatWeightKg(operation.entryWeightKg ?? 0)}</strong>
                            <span>{formatMoney(operation.unitPriceCents)}/ton</span>
                            <small
                              style={{
                                color: isOvertime ? "#b91c1c" : "var(--kr-muted)",
                                fontWeight: isOvertime ? 700 : undefined
                              }}
                              title={formatDbDateTime(operation.createdAt)}
                            >
                              Entrou {formatElapsedSince(operation.createdAt)}
                              {isOvertime ? " · acima da media ▲" : ""}
                            </small>
                          </span>
                          <span style={styles.rowActions}>
                            <IconActionButton
                              icon="swap"
                              label="Alterar material"
                              tip={TIPS.operations.changeProduct}
                              tone="neutral"
                              placement="left"
                              onClick={() => void handleOpenChangeProduct(operation)}
                            />
                            <IconActionButton
                              icon="edit"
                              label="Alterar cliente"
                              tip={TIPS.operations.changeCustomer}
                              tone="neutral"
                              placement="left"
                              onClick={() => void handleOpenChangeCustomer(operation)}
                            />
                            <IconActionButton
                              icon="truck"
                              label="Alterar transportadora"
                              tip={TIPS.operations.changeCarrier}
                              tone="neutral"
                              placement="left"
                              onClick={() => void handleOpenChangeCarrier(operation)}
                            />
                            <IconActionButton
                              icon="check"
                              label="Fechar operacao"
                              tip={TIPS.operations.close}
                              tone="primary"
                              placement="left"
                              onClick={() => setClosingOperation(operation)}
                            />
                            <IconActionButton
                              icon="ban"
                              label="Cancelar operacao"
                              tip={TIPS.operations.cancel}
                              tone="danger"
                              placement="left"
                              onClick={() => setCancelTarget({ operation, context: "open" })}
                            />
                          </span>
                        </div>
                        );
                      })}
                    </div>
                  )
                ) : operationsTab === "canceled" ? (
                  filteredCanceledOperations.length === 0 ? (
                    <div style={styles.emptyState}>
                      <strong>Nenhuma operacao cancelada</strong>
                      <span>Altere o periodo no filtro para consultar outros cancelamentos.</span>
                    </div>
                  ) : (
                    <div style={styles.operationsTable}>
                      <div
                        style={{
                          ...styles.canceledOperationsTableRow,
                          ...styles.operationsTableHead
                        }}
                      >
                        <span>Placa</span>
                        <span>Cliente / Produto</span>
                        <span>Cancelada em</span>
                        <span>Motivo</span>
                      </div>
                      {filteredCanceledOperations.map((operation) => (
                        <div
                          key={operation.id}
                          style={{
                            ...styles.canceledOperationsTableRow,
                            ...operationOutlineStyle(operation)
                          }}
                        >
                          <strong style={styles.plateBadge}>{operation.plate || "--"}</strong>
                          <span style={styles.operationCellStack}>
                            <strong>{operation.customerName || "Cliente nao informado"}</strong>
                            <span>{operation.productDescription || "Produto nao informado"}</span>
                          </span>
                          <span>{formatDbDateTime(operation.updatedAt)}</span>
                          <span>{operation.cancelReason || "Sem motivo registrado"}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : filteredClosedOperations.length === 0 ? (
                  <div style={styles.emptyState}>
                    <strong>Nenhuma operacao concluida</strong>
                    <span>As operacoes fechadas aparecerao aqui.</span>
                  </div>
                ) : (
                  <div style={styles.operationsTable}>
                    <div
                      style={{ ...styles.closedOperationsTableRow, ...styles.operationsTableHead }}
                    >
                      <span>Placa</span>
                      <span>Cliente / Produto</span>
                      <span>Peso liquido / Receita</span>
                      <span>Concluida em</span>
                      <span>Fiscal OMIE</span>
                      <span>Acoes</span>
                    </div>
                    {filteredClosedOperations.map((operation) => (
                      <div
                        key={operation.id}
                        style={{
                          ...styles.closedOperationsTableRow,
                          ...operationOutlineStyle(operation)
                        }}
                      >
                        <strong style={styles.plateBadge}>{operation.plate || "--"}</strong>
                        <span style={styles.operationCellStack}>
                          <strong>{operation.customerName || "Cliente nao informado"}</strong>
                          <span>{operation.productDescription || "Produto nao informado"}</span>
                          <small>Motorista: {operation.driverName}</small>
                        </span>
                        <span style={styles.operationCellStack}>
                          <strong>{formatWeightKg(operation.netWeightKg ?? 0)}</strong>
                          <span>{formatMoney(operation.totalCents)}</span>
                        </span>
                        <span>{formatDbDateTime(operation.updatedAt)}</span>
                        <FiscalBillingStatus
                          operation={operation}
                          retrying={retryingFiscalOperationId === operation.id}
                          onRetry={() => void handleRetryFiscalBilling(operation.id)}
                        />
                        <span style={styles.rowActions}>
                          <IconActionButton
                            icon="printer"
                            label="Reimprimir nota"
                            tip={
                              reprintingOperationId === operation.id
                                ? "Reimprimindo..."
                                : TIPS.printing.reprint
                            }
                            tone="neutral"
                            placement="left"
                            disabled={reprintingOperationId === operation.id}
                            onClick={() => void handleReprintOperationReceipt(operation.id)}
                          />
                          <IconActionButton
                            icon="edit"
                            label="Editar cliente"
                            tip={TIPS.operations.editCustomer}
                            tone="neutral"
                            placement="left"
                            onClick={() => handleEditOperationCustomer(operation)}
                          />
                          <IconActionButton
                            icon="ban"
                            label="Venda cancelada"
                            tip={TIPS.operations.saleCancelled}
                            tone="danger"
                            placement="left"
                            onClick={() => setCancelTarget({ operation, context: "completed" })}
                          />
                          <IconActionButton
                            icon="trash"
                            label="Excluir da lista"
                            tip={TIPS.operations.deleteClosed}
                            tone="neutral"
                            placement="left"
                            onClick={() => setDeleteClosedOperationId(operation.id)}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {closingOperation ? (
              <CloseOperationWeighingDialog
                desktopApi={desktopApi}
                operation={closingOperation}
                onConfirm={(operationType, scaleCaptureId) => {
                  const id = closingOperation.id;
                  setClosingOperation(null);
                  void handleCloseOperation(id, operationType, scaleCaptureId);
                }}
                onCancel={() => setClosingOperation(null)}
              />
            ) : null}

            {cancelTarget ? (
              <CancelOperationDialog
                operation={cancelTarget.operation}
                context={cancelTarget.context}
                onConfirm={(reason) => {
                  const id = cancelTarget.operation.id;
                  setCancelTarget(null);
                  void handleCancelOperation(id, reason);
                }}
                onCancel={() => setCancelTarget(null)}
              />
            ) : null}

            {deleteClosedOperationId ? (
              <ConfirmDialog
                title="Excluir operacao concluida"
                description="A operacao sera removida da lista de concluidas. O pedido/OS ja enviado ao OMIE nao e afetado — trate-o no proprio OMIE se necessario."
                onCancel={() => setDeleteClosedOperationId(null)}
                onConfirm={() => void handleDeleteClosedOperation(deleteClosedOperationId)}
              />
            ) : null}

            {changeProductOperation ? (
              <CrudFormModal onClose={() => setChangeProductOperation(null)} maxWidth={480}>
                <div style={{ padding: "18px" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: 700 }}>
                    Alterar material
                  </h3>
                  <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--kr-muted)" }}>
                    Operacao: {changeProductOperation.plate} — {changeProductOperation.customerName}
                    <br />
                    Produto atual: {changeProductOperation.productDescription}
                  </p>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      fontWeight: 700,
                      fontSize: "13px"
                    }}
                  >
                    Novo produto
                    <select
                      value={
                        changeProductOptions.find((p) => p.id === changeProductOperation.id)?.id ??
                        ""
                      }
                      onChange={(e) => {
                        setChangeProductOperation(null);
                        void handleConfirmChangeProduct(e.target.value);
                      }}
                      disabled={changeProductLoading}
                      style={{
                        border: "1px solid var(--kr-input-border)",
                        borderRadius: "10px",
                        padding: "8px 10px",
                        fontSize: "13px",
                        background: "var(--kr-input-bg)",
                        color: "var(--kr-text-strong)"
                      }}
                    >
                      <option value="">
                        {changeProductLoading
                          ? "Carregando produtos..."
                          : "Selecione o novo produto"}
                      </option>
                      {changeProductOptions.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.description}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                    <button
                      type="button"
                      onClick={() => setChangeProductOperation(null)}
                      style={{
                        border: "1px solid var(--kr-border)",
                        background: "var(--kr-surface)",
                        color: "var(--kr-text-strong)",
                        borderRadius: "10px",
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "12px"
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </CrudFormModal>
            ) : null}

            {changeCustomerOperation ? (
              <CrudFormModal onClose={() => setChangeCustomerOperation(null)} maxWidth={480}>
                <div style={{ padding: "18px" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: 700 }}>
                    Alterar cliente
                  </h3>
                  <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--kr-muted)" }}>
                    Operacao: {changeCustomerOperation.plate} —{" "}
                    {changeCustomerOperation.productDescription}
                    <br />
                    Cliente atual: {changeCustomerOperation.customerName}
                  </p>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      fontWeight: 700,
                      fontSize: "13px"
                    }}
                  >
                    Novo cliente
                    <select
                      value={changeCustomerOperation.customerId ?? ""}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setChangeCustomerOperation(null);
                        void handleConfirmChangeCustomer(e.target.value);
                      }}
                      disabled={changeCustomerLoading}
                      style={{
                        border: "1px solid var(--kr-input-border)",
                        borderRadius: "10px",
                        padding: "8px 10px",
                        fontSize: "13px",
                        background: "var(--kr-input-bg)",
                        color: "var(--kr-text-strong)"
                      }}
                    >
                      <option value="">
                        {changeCustomerLoading
                          ? "Carregando clientes..."
                          : "Selecione o novo cliente"}
                      </option>
                      {changeCustomerOptions.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                    <button
                      type="button"
                      onClick={() => setChangeCustomerOperation(null)}
                      style={{
                        border: "1px solid var(--kr-border)",
                        background: "var(--kr-surface)",
                        color: "var(--kr-text-strong)",
                        borderRadius: "10px",
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "12px"
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </CrudFormModal>
            ) : null}

            {changeCarrierOperation ? (
              <CrudFormModal onClose={() => setChangeCarrierOperation(null)} maxWidth={480}>
                <div style={{ padding: "18px" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: 700 }}>
                    Alterar transportadora
                  </h3>
                  <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--kr-muted)" }}>
                    Operacao: {changeCarrierOperation.plate} — {changeCarrierOperation.customerName}
                  </p>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      fontWeight: 700,
                      fontSize: "13px"
                    }}
                  >
                    Nova transportadora
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        setChangeCarrierOperation(null);
                        void handleConfirmChangeCarrier(e.target.value || null);
                      }}
                      disabled={changeCarrierLoading}
                      style={{
                        border: "1px solid var(--kr-input-border)",
                        borderRadius: "10px",
                        padding: "8px 10px",
                        fontSize: "13px",
                        background: "var(--kr-input-bg)",
                        color: "var(--kr-text-strong)"
                      }}
                    >
                      <option value="">
                        {changeCarrierLoading
                          ? "Carregando transportadoras..."
                          : "Selecione a nova transportadora"}
                      </option>
                      {changeCarrierOptions.map((carrier) => (
                        <option key={carrier.id} value={carrier.id}>
                          {carrier.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                    <button
                      type="button"
                      onClick={() => setChangeCarrierOperation(null)}
                      style={{
                        border: "1px solid var(--kr-border)",
                        background: "var(--kr-surface)",
                        color: "var(--kr-text-strong)",
                        borderRadius: "10px",
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "12px"
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </CrudFormModal>
            ) : null}

            {fiscalCloseProgress ? (
              <FiscalProgressDialog
                progress={fiscalCloseProgress}
                onClose={() => setFiscalCloseProgress(null)}
              />
            ) : null}

            {showOmieDirectSync ? (
              <OmieDirectSyncDialog
                desktopApi={desktopApi}
                onClose={() => setShowOmieDirectSync(false)}
              />
            ) : null}

            {activeView === "scale" ? <ScaleView desktopApi={desktopApi} /> : null}

            {activeView === "registrations" ? (
              <section style={styles.panel}>
                <h2 style={styles.panelTitle}>Cadastros</h2>
                <nav style={styles.subTabs}>
                  <Tooltip content="Clientes" placement="bottom">
                    <button
                      type="button"
                      aria-label="Clientes"
                      aria-pressed={registrationsTab === "customers"}
                      onClick={() => setRegistrationsTab("customers")}
                      style={subTabStyle(registrationsTab === "customers")}
                    >
                      <Users size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Produtos" placement="bottom">
                    <button
                      type="button"
                      aria-label="Produtos"
                      aria-pressed={registrationsTab === "products"}
                      onClick={() => setRegistrationsTab("products")}
                      style={subTabStyle(registrationsTab === "products")}
                    >
                      <Package size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Pagamento" placement="bottom">
                    <button
                      type="button"
                      aria-label="Pagamento"
                      aria-pressed={registrationsTab === "payment_terms"}
                      onClick={() => setRegistrationsTab("payment_terms")}
                      style={subTabStyle(registrationsTab === "payment_terms")}
                    >
                      <CreditCard size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Transporte" placement="bottom">
                    <button
                      type="button"
                      aria-label="Transporte"
                      aria-pressed={registrationsTab === "transport"}
                      onClick={() => setRegistrationsTab("transport")}
                      style={subTabStyle(registrationsTab === "transport")}
                    >
                      <Truck size={16} />
                    </button>
                  </Tooltip>
                </nav>
                <p style={styles.muted}>{TIPS.screens.registrations}</p>
                <div style={{ marginTop: "20px" }}>
                  {registrationsTab === "customers" ? (
                    <CustomersView desktopApi={desktopApi} initialSearch={customersInitialSearch} />
                  ) : null}
                  {registrationsTab === "products" ? (
                    <ProductsView desktopApi={desktopApi} />
                  ) : null}
                  {registrationsTab === "payment_terms" ? (
                    <PaymentRegistrationsView desktopApi={desktopApi} />
                  ) : null}
                  {registrationsTab === "transport" ? (
                    <TransportView desktopApi={desktopApi} />
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeView === "printing" ? (
              <section style={styles.twoColumns}>
                <article style={styles.panel}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <h2 style={styles.panelTitle}>Perfil de cupom 80 mm</h2>
                    <HelpTooltip content={TIPS.screens.printing} placement="right" />
                  </div>
                  <label style={styles.fieldLabel}>
                    Tipo de impressora
                    <select
                      value={printerType}
                      onChange={(event) => setPrinterType(event.target.value as PrinterType)}
                      style={styles.input}
                    >
                      <option value="windows">Windows instalada</option>
                      <option value="network">Rede / WiFi ESC/POS</option>
                    </select>
                  </label>
                  {printerType === "windows" ? (
                    <>
                      <label style={styles.fieldLabel} title={TIPS.printing.selectPrinter}>
                        Impressora Windows
                        <select
                          value={selectedPrinterName}
                          onChange={(event) => setSelectedPrinterName(event.target.value)}
                          style={styles.input}
                        >
                          <option value="">Selecione...</option>
                          {printers.map((printer) => (
                            <option key={printer.name} value={printer.name}>
                              {printer.name}
                              {printer.isDefault ? " (padrao)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {printers.length === 0 ? (
                        <p style={styles.errorMessage}>
                          Nenhuma impressora instalada foi encontrada.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) 120px",
                        gap: "10px"
                      }}
                    >
                      <label style={styles.fieldLabel}>
                        IP ou host da impressora
                        <input
                          type="text"
                          placeholder="192.168.0.50"
                          value={networkPrinterHost}
                          onChange={(event) => setNetworkPrinterHost(event.target.value)}
                          style={styles.input}
                        />
                      </label>
                      <label style={styles.fieldLabel}>
                        Porta
                        <input
                          type="number"
                          min="1"
                          max="65535"
                          value={networkPrinterPort}
                          onChange={(event) => setNetworkPrinterPort(event.target.value)}
                          style={styles.input}
                        />
                      </label>
                      <p style={{ ...styles.muted, gridColumn: "1 / -1", marginTop: 0 }}>
                        Use a porta 9100 para a maioria das impressoras termicas ESC/POS TCP/IP.
                      </p>
                    </div>
                  )}
                  <div style={{ display: "grid", gap: "10px", margin: "12px 0" }}>
                    <label style={styles.fieldLabel}>
                      Logo do cupom
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          void handleReceiptLogoFile(event.currentTarget.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                        style={styles.input}
                      />
                    </label>
                    {receiptLogoDataUrl ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "10px",
                          border: "1px solid var(--kr-border)",
                          borderRadius: "12px"
                        }}
                      >
                        <div
                          style={{
                            width: "96px",
                            height: "64px",
                            border: "1px dashed var(--kr-border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            background: "#fff"
                          }}
                        >
                          <img
                            src={receiptLogoDataUrl}
                            alt="Previa da logo do cupom"
                            style={{ width: "100%", height: "100%", objectFit: receiptLogoFit }}
                          />
                        </div>
                        <IconActionButton
                          icon="trash"
                          label="Remover logo"
                          tone="danger"
                          onClick={() => setReceiptLogoDataUrl(null)}
                        />
                      </div>
                    ) : (
                      <p style={styles.muted}>
                        Sem logo configurada. O cupom usara o nome da unidade no topo.
                      </p>
                    )}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: "10px"
                      }}
                    >
                      <label style={styles.fieldLabel}>
                        Largura da logo (mm)
                        <input
                          type="number"
                          min="10"
                          max="60"
                          value={receiptLogoWidthMm}
                          onChange={(event) => setReceiptLogoWidthMm(event.target.value)}
                          style={styles.input}
                        />
                      </label>
                      <label style={styles.fieldLabel}>
                        Altura da logo (mm)
                        <input
                          type="number"
                          min="8"
                          max="35"
                          value={receiptLogoHeightMm}
                          onChange={(event) => setReceiptLogoHeightMm(event.target.value)}
                          style={styles.input}
                        />
                      </label>
                      <label style={styles.fieldLabel}>
                        Formato da logo
                        <select
                          value={receiptLogoFit}
                          onChange={(event) =>
                            setReceiptLogoFit(
                              event.target.value as PrintProfileSummary["receiptLogo"]["fit"]
                            )
                          }
                          style={styles.input}
                        >
                          <option value="contain">Ajustar sem cortar</option>
                          <option value="cover">Preencher cortando</option>
                          <option value="fill">Esticar no espaco</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "10px", margin: "12px 0" }}>
                    <div style={styles.sectionHeader}>
                      <span style={styles.sectionIcon}>N</span>
                      <div>
                        <h3 style={styles.sectionTitle}>Editor visual do cupom</h3>
                        <p style={styles.sectionDescription}>
                          Mantenha o modelo padrao ou personalize os blocos impressos.
                        </p>
                      </div>
                    </div>
                    <label style={styles.fieldLabel}>
                      Modelo
                      <select
                        value={receiptTemplateConfig.mode}
                        onChange={(event) =>
                          updateReceiptTemplateConfig({
                            mode: event.target.value as ReceiptTemplateConfig["mode"]
                          })
                        }
                        style={styles.input}
                      >
                        <option value="default">Padrao KyberRock</option>
                        <option value="custom">Personalizado</option>
                      </select>
                    </label>
                    {receiptTemplateConfig.mode === "custom" ? (
                      <>
                        <label style={styles.fieldLabel}>
                          Texto extra no cabecalho
                          <textarea
                            value={receiptTemplateConfig.customHeaderText}
                            onChange={(event) =>
                              updateReceiptTemplateConfig({ customHeaderText: event.target.value })
                            }
                            rows={2}
                            style={styles.input}
                            placeholder="Ex.: CUPOM NAO FISCAL"
                          />
                        </label>
                        <div style={styles.compactInlineGrid}>
                          {receiptTemplateToggleOptions.map((option) => (
                            <label key={option.key} style={styles.compactCheckboxCard}>
                              <input
                                type="checkbox"
                                checked={receiptTemplateConfig[option.key]}
                                onChange={(event) =>
                                  updateReceiptTemplateConfig({
                                    [option.key]: event.target.checked
                                  })
                                }
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                        <label style={styles.fieldLabel}>
                          Texto extra no rodape
                          <textarea
                            value={receiptTemplateConfig.customFooterText}
                            onChange={(event) =>
                              updateReceiptTemplateConfig({ customFooterText: event.target.value })
                            }
                            rows={2}
                            style={styles.input}
                            placeholder="Ex.: Obrigado pela preferencia"
                          />
                        </label>
                      </>
                    ) : (
                      <p style={styles.muted}>
                        O modelo padrao preserva o layout atual do cupom, incluindo pesos, horarios
                        e valores.
                      </p>
                    )}
                  </div>
                  <IconActionButton
                    icon="save"
                    label="Salvar perfil 80 mm"
                    tip={TIPS.printing.saveProfile}
                    tone="primary"
                    onClick={handleConfigureReceiptPrinter}
                  />

                  <div style={{ marginTop: "12px" }}>
                    <IconActionButton
                      icon="printer"
                      label="Testar impressora (cupom exemplo)"
                      tip={TIPS.printing.testPrint}
                      tone="neutral"
                      onClick={() => void handlePrintTest()}
                    />
                  </div>
                </article>

                <article
                  style={{
                    ...styles.panel,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0
                  }}
                >
                  <h2 style={styles.panelTitle}>Cupons emitidos</h2>
                  <div
                    style={{
                      flex: "1 1 auto",
                      minHeight: 0,
                      maxHeight: "calc(100vh - 320px)",
                      overflowY: "auto",
                      marginTop: "4px"
                    }}
                  >
                    {printReceipts.length === 0 ? (
                      <p style={styles.muted}>Nenhum cupom emitido ainda.</p>
                    ) : null}
                    {printReceipts.map((receipt) => (
                      <div key={receipt.id} style={styles.receiptRow}>
                        <div>
                          <strong>
                            Cupom {receipt.receiptNumber} - via {receipt.copyNumber}
                          </strong>
                          <p style={styles.muted}>
                            {receipt.status === "printed" ? "Impresso" : "Falhou"} em{" "}
                            {receipt.printerName}
                          </p>
                          {receipt.errorMessage ? (
                            <p style={styles.errorMessage}>{receipt.errorMessage}</p>
                          ) : null}
                        </div>
                        <IconActionButton
                          icon="printer"
                          label="Reimprimir segunda via"
                          tip={TIPS.printing.reprint}
                          tone="neutral"
                          placement="left"
                          onClick={() => void handleReprintReceipt(receipt.id)}
                        />
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      paddingTop: "12px",
                      borderTop: "1px solid var(--kr-border)",
                      display: "grid",
                      gap: "8px",
                      flexShrink: 0
                    }}
                  >
                    <IconActionButton
                      icon="retry"
                      label="Restaurar modelo padrao"
                      tone="neutral"
                      onClick={() =>
                        setReceiptTemplateConfig({ ...DEFAULT_RECEIPT_TEMPLATE_CONFIG })
                      }
                    />
                    <div>
                      <h3 style={{ margin: "0 0 4px 0" }}>Perfil ativo</h3>
                      {printProfiles.length === 0 ? (
                        <p style={styles.muted}>Nenhum perfil de impressao configurado.</p>
                      ) : (
                        <p style={{ margin: 0 }}>
                          {printProfiles[0].printerType === "network"
                            ? `${printProfiles[0].networkHost}:${printProfiles[0].networkPort ?? 9100}`
                            : printProfiles[0].windowsPrinterName}{" "}
                          - {printProfiles[0].paperWidthMm} mm
                          {` - ${printProfiles[0].copies} vias`}
                          {printProfiles[0].templateConfig.mode === "custom"
                            ? " - modelo personalizado"
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              </section>
            ) : null}

            {activeView === "cloud" ? (
              <section style={styles.cloudGrid}>
                <article
                  style={{
                    ...styles.panel,
                    gridColumn: "1",
                    gridRow: "1",
                    minHeight: 0,
                    overflow: "auto"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <h2 style={styles.panelTitle}>Sincronizacao Supabase</h2>
                    <HelpTooltip content={TIPS.screens.cloud} placement="right" />
                  </div>

                  <div style={{ marginBottom: "16px" }}>
                    <p>
                      <strong>Status:</strong>{" "}
                      {cloudConnected ? "Conectado ao Supabase" : "Nao conectado"}
                    </p>
                    {cloudStatus && (
                      <>
                        <p>Operacoes sincronizadas: {cloudStatus.totalOperations}</p>
                        <p>
                          Ultima sincronizacao:{" "}
                          {cloudStatus.lastSync
                            ? formatDbDateTime(cloudStatus.lastSync)
                            : "Nunca"}
                        </p>
                      </>
                    )}
                  </div>

                  <IconActionButton
                    icon="retry"
                    label="Sincronizar agora"
                    tip={cloudSyncing ? "Sincronizando..." : TIPS.cloud.syncNow}
                    tone="primary"
                    disabled={cloudSyncing}
                    onClick={handleSyncToCloud}
                  />
                </article>

                <article
                  style={{
                    ...styles.panel,
                    gridColumn: "2",
                    gridRow: "1 / span 2",
                    minHeight: 0,
                    overflow: "auto"
                  }}
                >
                  <h2 style={styles.panelTitle}>Status OMIE</h2>
                  {omieStatus ? (
                    <>
                      <p>
                        <strong>Status:</strong>{" "}
                        {omieStatus.configured ? "Configurado" : "Nao configurado no admin"}
                      </p>
                      {omieStatus.appKeyMasked ? <p>App Key: {omieStatus.appKeyMasked}</p> : null}
                      {omieStatus.configured ? (
                        <>
                          {!omieStatus.hasSyncedData ? (
                            <p style={styles.muted}>
                              Credencial recebida. Execute a primeira sincronizacao.
                            </p>
                          ) : null}
                          <p>Clientes sincronizados: {omieStatus.totalCustomers}</p>
                          <p>Produtos sincronizados: {omieStatus.totalProducts}</p>
                          <p>Condicoes sincronizadas: {omieStatus.totalPaymentTerms}</p>
                          <p>
                            Pendentes de envio: {omieStatus.pendingPushCustomers} clientes /{" "}
                            {omieStatus.pendingPushCarriers} transportadoras
                          </p>
                          <p>Pedidos OMIE na fila: {omieStatus.pendingOmieJobs}</p>
                          <p>
                            Ultima sincronizacao:{" "}
                            {omieStatus.lastSyncAt
                              ? formatDbDateTime(omieStatus.lastSyncAt)
                              : "Nunca"}
                          </p>
                          {omieConnectionFeedback.status !== "idle" ? (
                            <div
                              style={{
                                ...styles.omieFeedback,
                                ...(omieConnectionFeedback.status === "success"
                                  ? styles.omieFeedbackSuccess
                                  : omieConnectionFeedback.status === "warning"
                                    ? styles.omieFeedbackWarning
                                    : omieConnectionFeedback.status === "checking"
                                      ? styles.omieFeedbackChecking
                                      : styles.omieFeedbackError)
                              }}
                            >
                              <strong>{omieConnectionFeedback.message}</strong>
                              {omieConnectionFeedback.details ? (
                                <p style={{ margin: "6px 0 0" }}>
                                  {omieConnectionFeedback.details}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          <div style={{ marginTop: "12px" }}>
                            <IconActionButton
                              icon="retry"
                              label="Sincronizar OMIE (atualizar dados)"
                              tip={
                                omieSyncing
                                  ? "Sincronizando..."
                                  : "Busca novos clientes e transportadoras do OMIE e atualiza os existentes sem apagar dados locais."
                              }
                              tone="primary"
                              disabled={omieSyncing || omieResetting}
                              onClick={handleSyncOmie}
                            />
                          </div>
                          <div style={{ marginTop: "12px" }}>
                            <p style={{ ...styles.muted, fontSize: "12px", marginBottom: "8px" }}>
                              Apaga todos os clientes e transportadoras locais e baixa tudo
                              novamente do OMIE.
                            </p>
                            <button
                              type="button"
                              onClick={handleResetOmieMaster}
                              disabled={omieResetting || omieSyncing}
                              style={{
                                ...styles.dangerButton,
                                opacity: omieResetting || omieSyncing ? 0.6 : 1,
                                cursor: omieResetting || omieSyncing ? "not-allowed" : "pointer"
                              }}
                            >
                              {omieResetting
                                ? "Limpando e sincronizando..."
                                : "Limpar tudo e Re-sincronizar OMIE"}
                            </button>
                            <HelpTooltip
                              content="APAGA todos os clientes e transportadoras locais e rebaixa tudo do OMIE. Use com cuidado!"
                              placement="top"
                            />
                          </div>
                        </>
                      ) : (
                        <p style={styles.muted}>
                          Cadastre o App Key e App Secret OMIE no painel administrativo e aguarde a
                          proxima validacao online do desktop.
                        </p>
                      )}
                    </>
                  ) : (
                    <p style={{ color: "#64748b" }}>Carregando status OMIE...</p>
                  )}
                </article>

                <article
                  style={{
                    ...styles.panel,
                    gridColumn: "1",
                    gridRow: "2",
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      flexShrink: 0
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <h2 style={styles.panelTitle}>Fila OMIE (fechamentos a enviar)</h2>
                      <HelpTooltip
                        content="Pedidos/OS de fechamentos que ainda serao enviados ao OMIE. Excluir um item cancela o envio daquele fechamento ao OMIE (a operacao local nao e alterada)."
                        placement="right"
                      />
                    </div>
                    <IconActionButton
                      icon="retry"
                      label="Atualizar fila"
                      tip={omieQueueLoading ? "Atualizando..." : "Atualizar a fila OMIE"}
                      tone="neutral"
                      disabled={omieQueueLoading}
                      onClick={() => void refreshOmieQueue()}
                    />
                  </div>
                  <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginTop: "8px" }}>
                  {omieQueue.length === 0 ? (
                    <p style={styles.muted}>
                      {omieQueueLoading
                        ? "Carregando fila OMIE..."
                        : "Nenhum item na fila: todos os fechamentos foram enviados ao OMIE."}
                    </p>
                  ) : (
                    omieQueue.map((item) => (
                      <div key={item.id} style={styles.receiptRow}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>
                            {item.customerName ?? "Cliente nao identificado"}
                            {item.plate ? ` - ${item.plate}` : ""}
                            {item.totalCents !== null ? ` - ${formatMoney(item.totalCents)}` : ""}
                          </strong>
                          <p style={styles.muted}>
                            {omieQueueActionLabel(item.action, item.operationType)} -{" "}
                            {omieQueueStatusLabel(item.status)}
                            {item.attemptCount > 0 ? ` (${item.attemptCount} tentativas)` : ""}
                            {" - "}
                            {formatDbDateTime(item.closedAt ?? item.createdAt)}
                          </p>
                          {item.lastError ? (
                            <p style={{ ...styles.errorMessage, wordBreak: "break-word" }}>
                              {item.lastError}
                            </p>
                          ) : null}
                        </div>
                        <IconActionButton
                          icon="send"
                          label="Enviar agora"
                          tip={
                            omieQueueBusyId === item.id
                              ? "Enviando..."
                              : "Enviar este item ao OMIE agora"
                          }
                          tone="primary"
                          placement="left"
                          disabled={omieQueueBusyId !== null}
                          onClick={() => void handleOmieQueueSendNow(item.id)}
                        />
                        {omieQueueConfirmDeleteId === item.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleOmieQueueDelete(item.id)}
                              disabled={omieQueueBusyId !== null}
                              style={{ ...styles.dangerButton, fontSize: "12px" }}
                            >
                              Confirmar exclusao
                            </button>
                            <button
                              type="button"
                              onClick={() => setOmieQueueConfirmDeleteId(null)}
                              style={{ ...styles.secondaryButton, fontSize: "12px" }}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <IconActionButton
                            icon="trash"
                            label="Excluir da fila"
                            tip="Excluir este item da fila (cancela o envio ao OMIE; a operacao local nao muda)"
                            tone="neutral"
                            placement="left"
                            disabled={omieQueueBusyId !== null}
                            onClick={() => setOmieQueueConfirmDeleteId(item.id)}
                          />
                        )}
                      </div>
                    ))
                  )}
                  </div>
                </article>
              </section>
            ) : null}
            {activeView === "insights" ? (
              <InsightsView
                desktopApi={desktopApi}
                openOperations={openOperations}
                cloudConnected={cloudConnected}
                cloudSyncing={cloudSyncing}
                omieStatus={omieStatus}
                onSyncOmie={handleSyncOmie}
                onSyncCloud={handleSyncToCloud}
              />
            ) : null}
            {activeView === "truck-control" ? (
              <TruckControlView desktopApi={desktopApi} />
            ) : null}
            {activeView === "reports" ? <ReportsView desktopApi={desktopApi} /> : null}
            {activeView === "documentation" ? <DocumentationView /> : null}
          </div>
        </div>
      </div>
      <KeyboardShortcutsLegend />
    </main>
  );
}

/**
 * Aviso flutuante (toast) que mostra o feedback transitorio (`message`): resultado
 * de sync, erros, impressao, backup, etc. Substitui a linha de mensagem que ficava
 * no header — some sozinho apos alguns segundos e pode ser dispensado.
 */
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "18px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9998,
        maxWidth: "min(560px, 90vw)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 14px",
        borderRadius: "12px",
        background: "var(--kr-surface-elevated)",
        color: "var(--kr-text-strong)",
        border: "1px solid var(--kr-border)",
        boxShadow: "var(--kr-shadow)",
        fontSize: "13px",
        fontWeight: 600
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        style={{
          border: "none",
          background: "transparent",
          color: "var(--kr-muted)",
          cursor: "pointer",
          fontWeight: 900,
          fontSize: "16px",
          lineHeight: 1,
          padding: "0 2px"
        }}
      >
        ×
      </button>
    </div>
  );
}

function KeyboardShortcutsLegend() {
  const shortcuts = [
    { key: "F1", label: "Painel" },
    { key: "F2", label: "Nova entrada" },
    { key: "F3", label: "Operacoes" },
    { key: "F4", label: "Cadastros" },
    { key: "F5", label: "Insights" },
    { key: "F6", label: "Balança" },
    { key: "F7", label: "Impressão" },
    { key: "F8", label: "Cloud" },
    { key: "F9", label: "OMIE sync" },
    { key: "F10", label: "Logs" },
    { key: "F11", label: "Tema" },
    { key: "Esc", label: "Voltar" },
    { key: "Ctrl+Enter", label: "Confirmar" }
  ];

  return (
    <div style={styles.shortcutsLegend}>
      {shortcuts.map((s) => (
        <span key={s.key} style={styles.shortcutsLegendItem}>
          <kbd style={styles.shortcutsLegendKey}>{s.key}</kbd>
          <span style={styles.shortcutsLegendLabel}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

function GlobalUiPolish() {
  return (
    <style>{`
      [data-theme] *, [data-theme] *::before, [data-theme] *::after {
        box-sizing: border-box;
      }

      [data-theme] {
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        font-variant-numeric: tabular-nums;
      }

      [data-theme] button,
      [data-theme] input,
      [data-theme] select,
      [data-theme] textarea {
        font-family: inherit;
      }

      [data-theme] button {
        transition: filter 140ms ease, background-color 140ms ease, border-color 140ms ease,
          box-shadow 140ms ease, transform 60ms ease;
      }

      [data-theme] button:not(:disabled):hover {
        filter: brightness(0.96);
      }

      [data-theme] button:not(:disabled):active {
        transform: translateY(1px);
      }

      [data-theme] input,
      [data-theme] select,
      [data-theme] textarea {
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }

      [data-theme] button:focus-visible,
      [data-theme] input:focus-visible,
      [data-theme] select:focus-visible,
      [data-theme] textarea:focus-visible,
      [data-theme] [tabindex]:focus-visible {
        outline: 2px solid var(--kr-focus-ring);
        outline-offset: 2px;
      }

      [data-theme] button:disabled,
      [data-theme] input:disabled,
      [data-theme] select:disabled,
      [data-theme] textarea:disabled {
        cursor: not-allowed;
      }

      [data-theme] ::selection {
        background: var(--kr-selection-bg);
        color: var(--kr-selection-text);
      }

      [data-theme] ::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      [data-theme] ::-webkit-scrollbar-track {
        background: var(--kr-scroll-track);
      }

      [data-theme] ::-webkit-scrollbar-thumb {
        background: var(--kr-scroll-thumb);
        border: 2px solid var(--kr-scroll-track);
        border-radius: 999px;
      }

      @keyframes krProgress {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }

      @keyframes krPulse {
        0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.55); opacity: 1; }
        70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); opacity: 0.65; }
        100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); opacity: 1; }
      }
    `}</style>
  );
}

function getWindowDesktopApi(): KyberRockDesktopApi | undefined {
  return typeof window === "undefined" ? undefined : window.kyberrockDesktop;
}

/**
 * Legenda multi-desktop: mostra a cor e o nome de cada computador da pedreira.
 * As operacoes das listas ganham um contorno na cor do computador que as criou,
 * identificando o responsavel por cada tarefa quando ha mais de um desktop.
 */
function DeviceColorLegend({ devices }: { devices: UnitDeviceInfo[] }) {
  return (
    <div
      role="note"
      aria-label="Legenda de cores por computador"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        padding: "8px 12px",
        borderRadius: "10px",
        border: "1px solid var(--kr-border)",
        background: "var(--kr-surface-soft)",
        fontSize: "12px",
        color: "var(--kr-text)"
      }}
    >
      <span style={{ fontWeight: 700, color: "var(--kr-muted)" }}>
        Responsavel (cor por computador):
      </span>
      {devices.map((device) => (
        <span
          key={device.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: 600,
            opacity: device.isActive ? 1 : 0.6
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "4px",
              background: device.color,
              flexShrink: 0
            }}
          />
          {device.name}
          {device.isSelf ? " (este computador)" : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * Luz de conclusao do carregador: vermelha (pulsando) enquanto a carga aguarda
 * o carregador marcar "Concluir carga" no loader-web; verde quando concluida.
 * O status chega ao desktop pela projecao cloud (`loader_completed_at`).
 */
function LoaderStatusLight({ completedAt }: { completedAt?: string | null }) {
  const completed = Boolean(completedAt);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 8px 2px 6px",
        borderRadius: "999px",
        fontSize: "10px",
        fontWeight: 800,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        border: `1px solid ${completed ? "#86efac" : "#fca5a5"}`,
        background: completed ? "#f0fdf4" : "#fef2f2",
        color: completed ? "#15803d" : "#b91c1c"
      }}
      title={
        completed
          ? `Carga concluida pelo carregador${completedAt ? ` em ${formatDbDateTime(completedAt)}` : ""}.`
          : "Aguardando o carregador concluir a carga no loader-web."
      }
    >
      <span
        aria-hidden="true"
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          flexShrink: 0,
          background: completed ? "#22c55e" : "#ef4444",
          animation: completed ? undefined : "krPulse 1.6s ease-out infinite"
        }}
      />
      {completed ? "Concluida" : "Aguardando"}
    </span>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Arquivo de imagem invalido."));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Falha na leitura.")));
    reader.readAsDataURL(file);
  });
}

interface SidebarItemProps {
  id: ActiveView;
  label: string;
  icon: LucideIcon;
  activeView: ActiveView;
  onSelect: (view: ActiveView) => void;
  disabled?: boolean;
  badge?: string;
  tooltip?: string;
}

function SidebarItem({
  id,
  label,
  icon: Icon,
  activeView,
  onSelect,
  disabled,
  badge,
  tooltip
}: SidebarItemProps) {
  const isActive = activeView === id;
  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: tooltip ? "8px 30px 8px 12px" : "8px 12px",
    margin: 0,
    fontSize: "13px",
    fontWeight: isActive ? 600 : 500,
    color: disabled ? "var(--kr-muted)" : isActive ? "var(--kr-primary-text)" : "var(--kr-muted)",
    background: isActive ? "var(--kr-primary-strong)" : "transparent",
    border: "none",
    borderLeft: isActive ? "3px solid var(--kr-accent)" : "3px solid transparent",
    borderRadius: "0 10px 10px 0",
    cursor: disabled ? "not-allowed" : "pointer",
    textAlign: "left"
  };

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        type="button"
        onClick={() => {
          if (!disabled) onSelect(id);
        }}
        style={baseStyle}
        disabled={disabled}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon size={16} strokeWidth={2.2} />
        <span style={{ flex: 1 }}>{label}</span>
        {badge ? (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              padding: "2px 6px",
              background: "#f1f5f9",
              color: "#475569",
              borderRadius: "999px"
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>
      {tooltip ? (
        <HelpTooltip
          content={tooltip}
          placement="right"
          size={12}
          style={{ position: "absolute", right: "10px", top: "10px" }}
        />
      ) : null}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <p
        style={{
          fontSize: "10px",
          fontWeight: 700,
          color: "var(--kr-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          margin: "12px 12px 4px 12px"
        }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function describeUpdateState(state: UpdateState): string {
  if (state.status === "available") {
    return `Versao ${state.availableVersion ?? "nova"} disponivel.`;
  }

  if (state.status === "downloaded") {
    return "Atualizacao baixada e pronta para instalar.";
  }

  if (state.status === "error") {
    return state.errorMessage ?? "Falha ao verificar atualizacao.";
  }

  return "Sem atualizacao pendente.";
}

/**
 * Resolve a forma e a condicao de pagamento selecionadas (via cache) e aplica
 * a trava de compatibilidade. Retorna `{ allowed: true }` quando nao ha forma
 * definida ou quando ela nao existe mais no cache.
 */
async function resolvePaymentConditionGuard(
  desktopApi: KyberRockDesktopApi,
  form: WeighingFormState
): Promise<{ allowed: boolean; message?: string }> {
  if (!form.paymentMethodId) return { allowed: true };
  const methodResult = await desktopApi.queryCache({ entityType: "payment_method", limit: 200 });
  const method = (methodResult.rows as PaymentMethodCacheEntry[]).find(
    (m) => m.id === form.paymentMethodId
  );
  if (!method) return { allowed: true };
  const methodLike = { code: method.code, isCustomerCredit: method.isCustomerCredit };

  if (form.paymentMode === "manual") {
    const installmentCount = Number(form.manualInstallments.trim());
    return validatePaymentMethodCondition(methodLike, {
      installmentCount: Number.isFinite(installmentCount) ? installmentCount : 0
    });
  }

  let raw = "";
  const customCondition = form.customConditionText.trim();
  if (customCondition) {
    // Condicao digitada livre vence o select; o parser normaliza (ex: "7 14 21" -> "7/14/21").
    raw = tryParsePaymentCondition(customCondition)?.raw ?? customCondition;
  } else if (form.paymentTermId) {
    const termResult = await desktopApi.queryCache({ entityType: "payment_term", limit: 200 });
    const term = (termResult.rows as PaymentTermCacheEntry[]).find(
      (t) => t.id === form.paymentTermId
    );
    if (term) raw = extractConditionRaw(term.rulesJson);
  }
  return validatePaymentMethodCondition(methodLike, { raw });
}

function validateWeighingForm(form: WeighingFormState): string | null {
  if (!form.vehicleId) return "Selecione a placa.";
  if (!form.customerId) return "Selecione o cliente.";
  if (!form.driverId) return "Selecione o motorista.";
  if (!form.productId) return "Selecione o produto.";
  if (!isCustomerOwnTransport(form) && !form.carrierId) {
    return "Selecione a transportadora.";
  }
  if (form.paymentMode === "manual") {
    const manualInstallments = Number(form.manualInstallments.trim());
    if (!Number.isInteger(manualInstallments) || manualInstallments <= 0) {
      return "Informe a quantidade de parcelas.";
    }
    if (form.manualDownPaymentEnabled && form.manualDownPaymentCents === null) {
      return "Informe o valor de entrada.";
    }
  }
  if (form.customConditionText.trim() && !tryParsePaymentCondition(form.customConditionText)) {
    return 'Condicao personalizada invalida. Use "5" (parcelas), "7 14 21" ou "7/14/21".';
  }
  if (isFreightCharged(form)) {
    if (form.freightBaseValueCents === null && form.freightFixedValueCents === null) {
      return "Informe o valor do frete.";
    }
    if (
      form.freightCalculationType === "per_ton_km" &&
      parsePositiveNumber(form.freightDistanceKm) === null
    ) {
      return "Informe a distancia do frete em km.";
    }
  }
  return null;
}

/** A operacao tem um valor de frete lancado pela Pedreira (modalidade cobravel + toggle). */
export function isFreightCharged(
  form: Pick<WeighingFormState, "freightModality" | "chargeFreight">
): boolean {
  return form.chargeFreight && getFreightModalityInfo(form.freightModality).supportsCharge;
}

export function buildFreightInput(form: WeighingFormState): OperationFreightInput | null {
  if (!isFreightCharged(form)) return null;
  const distanceKm = parsePositiveNumber(form.freightDistanceKm);
  return {
    payer: getFreightModalityInfo(form.freightModality).defaultPayer,
    destination: form.freightDestination.trim() || null,
    rule: {
      id: "operation-freight",
      name: "Frete da operacao",
      type: form.freightCalculationType,
      baseValueCents: form.freightBaseValueCents ?? 0,
      fixedValueCents: form.freightFixedValueCents ?? undefined,
      minValueCents: form.freightMinValueCents ?? undefined,
      distanceKm: distanceKm ?? undefined,
      unit: "ton"
    }
  };
}

export function shouldLinkCreatedDriverToCarrier(
  form: Pick<WeighingFormState, "carrierId" | "freightModality">
): string | null {
  if (isCustomerOwnTransport(form) || !form.carrierId) {
    return null;
  }
  return form.carrierId;
}

export function getDriverFilterIds(
  form: Pick<WeighingFormState, "freightModality">,
  availableDriverIds: string[] | undefined
): string[] | undefined {
  if (isCustomerOwnTransport(form)) return undefined;
  return availableDriverIds;
}

export function isTransportReady(
  form: Pick<WeighingFormState, "carrierId" | "freightModality">
): boolean {
  return isCustomerOwnTransport(form) || Boolean(form.carrierId);
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface CacheSelectOption {
  id: string;
  label: string;
  raw?: Record<string, unknown>;
}

export function createCacheSelectOptions(
  rows: Array<Record<string, unknown>>
): CacheSelectOption[] {
  return rows.map((item) => ({
    id: String(item.id ?? item.omieCode ?? ""),
    label: String(item.tradeName ?? item.plate ?? item.name ?? item.description ?? item.fullName ?? ""),
    raw: item
  }));
}

export function filterCacheSelectOptions(
  options: CacheSelectOption[],
  filterIds: string[] | undefined
): CacheSelectOption[] {
  return filterIds !== undefined ? options.filter((option) => filterIds.includes(option.id)) : options;
}

/**
 * Inclui otimisticamente um id recem-criado na lista de ids permitidos de um seletor
 * filtrado por vinculo (ex.: transportadoras do cliente), para o item aparecer de
 * imediato mesmo antes da releitura do vinculo no banco. `undefined` = sem filtro.
 */
export function appendAvailableId(
  ids: string[] | undefined,
  id: string
): string[] | undefined {
  if (ids === undefined) return undefined;
  return ids.includes(id) ? ids : [...ids, id];
}

/**
 * Ids a exibir no seletor de transportadora da nova entrada. Quando o cliente tem
 * transportadoras vinculadas, restringe a lista a elas. Quando nao tem nenhuma
 * vinculada (lista vazia) ou nenhum cliente foi escolhido (`undefined`), retorna
 * `undefined` para nao filtrar — assim o operador consegue selecionar qualquer
 * transportadora cadastrada em vez de ficar com a lista vazia.
 */
export function carrierSelectorFilterIds(
  availableCarrierIds: string[] | undefined
): string[] | undefined {
  return availableCarrierIds && availableCarrierIds.length > 0
    ? availableCarrierIds
    : undefined;
}

function CacheSelect({
  label,
  entityType,
  value,
  onChange,
  onCreateNew,
  desktopApi,
  disabled = false,
  refreshKey = 0,
  productFiscalType,
  filterIds
}: {
  label: string;
  entityType: CacheEntityType;
  value: string;
  onChange: (id: string, item?: Record<string, unknown>) => void;
  onCreateNew?: () => void;
  desktopApi: KyberRockDesktopApi | null;
  disabled?: boolean;
  refreshKey?: number;
  productFiscalType?: "finished_goods";
  filterIds?: string[];
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<CacheSelectOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<CacheSelectOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedLabel = useMemo(() => {
    return (
      options.find((o) => o.id === value)?.label ??
      (selectedOption?.id === value ? selectedOption.label : "")
    );
  }, [options, selectedOption, value]);

  useEffect(() => {
    if (!value) {
      setSelectedOption(null);
      return;
    }
    const option = options.find((item) => item.id === value);
    if (option) setSelectedOption(option);
  }, [options, value]);

  useEffect(() => {
    async function load() {
      if (!desktopApi) return;
      setLoading(true);
      try {
        const result = await desktopApi.queryCache({
          entityType,
          search: search.trim(),
          // Quando ha um filtro por vinculo (ex.: transportadoras do cliente),
          // buscamos mais linhas para nao perder itens vinculados fora das 20
          // primeiras antes de aplicar o filtro client-side.
          limit: filterIds !== undefined ? 200 : 20,
          productFiscalType
        });
        const allOptions = createCacheSelectOptions(result.rows as Array<Record<string, unknown>>);
        setOptions(filterCacheSelectOptions(allOptions, filterIds));
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [desktopApi, entityType, productFiscalType, search, refreshKey, filterIds]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [open, options.length]);

  function selectOption(option: CacheSelectOption): void {
    setSelectedOption(option);
    onChange(option.id, option.raw);
    setOpen(false);
    setSearch("");
  }

  function getOptionMeta(option: CacheSelectOption): string | null {
    if (entityType !== "payment_term") return null;
    const rawCount = option.raw?.installmentCount;
    return typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount > 0
      ? `${rawCount}x`
      : null;
  }

  return (
    <div style={{ position: "relative", marginBottom: "6px" }}>
      <label style={styles.fieldLabel}>
        {label}
        <input
          type="text"
          value={selectedLabel}
          onChange={() => undefined}
          onClick={() => {
            setOpen(true);
            setSearch("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
              setSearch("");
            }
          }}
          disabled={disabled}
          placeholder={`Selecionar ${label.toLowerCase()}...`}
          readOnly
          style={{ ...styles.input, cursor: disabled ? "not-allowed" : "pointer" }}
        />
      </label>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Selecionar ${label}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setOpen(false);
              setSearch("");
            }
          }}
          style={{
            ...modalOverlayStyle,
            zIndex: 900,
            padding: "16px"
          }}
        >
          <div
            style={{
              ...modalContentStyle,
              maxWidth: "760px",
              width: "min(760px, 100%)",
              padding: "0",
              overflow: "hidden"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                alignItems: "flex-start",
                padding: "16px",
                borderBottom: "1px solid var(--kr-border)"
              }}
            >
              <div>
                <h3 style={{ margin: 0, color: "var(--kr-text-strong)", fontSize: "18px" }}>
                  Selecionar {label}
                </h3>
                <p style={{ margin: "4px 0 0", color: "var(--kr-muted)", fontSize: "13px" }}>
                  Pesquise por nome e escolha um item da lista disponível.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSearch("");
                }}
                style={{
                  border: "1px solid var(--kr-border)",
                  borderRadius: "10px",
                  background: "var(--kr-surface-soft)",
                  color: "var(--kr-text)",
                  cursor: "pointer",
                  fontWeight: 800,
                  padding: "8px 10px"
                }}
              >
                Fechar
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", minHeight: "360px" }}>
              <div style={{ flex: "1 1 360px", minWidth: 0, padding: "16px" }}>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlightedIndex((index) =>
                        Math.min(Math.max(0, options.length - 1), index + 1)
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlightedIndex((index) => Math.max(0, index - 1));
                      return;
                    }
                    if (event.key === "Enter" && options[highlightedIndex]) {
                      event.preventDefault();
                      selectOption(options[highlightedIndex]);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                      setSearch("");
                    }
                  }}
                  autoFocus
                  placeholder={`Buscar ${label.toLowerCase()}...`}
                  style={{ ...styles.input, marginBottom: "12px" }}
                />

                <div
                  style={{
                    border: "1px solid var(--kr-border)",
                    borderRadius: "12px",
                    overflowY: "auto",
                    maxHeight: "300px",
                    background: "var(--kr-surface-soft)"
                  }}
                >
                  {loading ? (
                    <div style={{ padding: "14px", color: "var(--kr-muted)", fontSize: "13px" }}>
                      Carregando...
                    </div>
                  ) : options.length === 0 ? (
                    <div style={{ padding: "14px", color: "var(--kr-muted)", fontSize: "13px" }}>
                      Nenhum resultado encontrado.
                    </div>
                  ) : (
                    options.map((option, index) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => selectOption(option)}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 12px",
                          border: "none",
                          borderBottom: "1px solid var(--kr-border)",
                          background:
                            highlightedIndex === index ? "var(--kr-card-hover)" : "transparent",
                          cursor: "pointer",
                          fontSize: "13px",
                          color: "var(--kr-text-strong)"
                        }}
                      >
                        <span
                          style={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {option.label}
                        </span>
                        {getOptionMeta(option) ? (
                          <span
                            style={{
                              flexShrink: 0,
                              borderRadius: "999px",
                              background: "var(--kr-surface)",
                              color: "var(--kr-muted)",
                              fontSize: "11px",
                              fontWeight: 800,
                              padding: "2px 6px"
                            }}
                          >
                            {getOptionMeta(option)}
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {onCreateNew ? (
                <aside
                  style={{
                    borderLeft: "1px solid var(--kr-border)",
                    padding: "16px",
                    background: "var(--kr-surface-soft)",
                    display: "flex",
                    flex: "1 1 220px",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "10px"
                  }}
                >
                  <div style={{ color: "var(--kr-text-strong)", fontWeight: 900 }}>
                    Não encontrou?
                  </div>
                  <div style={{ color: "var(--kr-muted)", fontSize: "13px", lineHeight: 1.4 }}>
                    Cadastre um novo item agora e volte para selecionar na lista atualizada.
                  </div>
                  <button
                    type="button"
                    onClick={onCreateNew}
                    style={{
                      border: "none",
                      borderRadius: "12px",
                      background: "var(--kr-primary)",
                      color: "white",
                      cursor: "pointer",
                      fontWeight: 800,
                      padding: "10px 12px"
                    }}
                  >
                    + Cadastrar novo
                  </button>
                </aside>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface WeighingFormProps {
  desktopApi: KyberRockDesktopApi | null;
  form: WeighingFormState;
  setForm: React.Dispatch<React.SetStateAction<WeighingFormState>>;
  formError: string | null;
  setFormError: React.Dispatch<React.SetStateAction<string | null>>;
  onStart: (scaleCaptureId?: string) => Promise<void> | void;
  onCancel: () => void;
}

function WeighingForm({
  desktopApi,
  form,
  setForm,
  formError,
  setFormError,
  onStart,
  onCancel
}: WeighingFormProps) {
  const [liveWeight, setLiveWeight] = useState<number | null>(null);
  const [capturedWeight, setCapturedWeight] = useState<number | null>(null);
  const [scaleState, setScaleState] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [scaleStateMessage, setScaleStateMessage] = useState<string>("Balança desconectada");
  const [isVirtual, setIsVirtual] = useState(false);
  const [virtualWeightInput, setVirtualWeightInput] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [priceDetails, setPriceDetails] = useState<PriceDetails | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCarrierModal, setShowCarrierModal] = useState(false);
  const [showFreightModal, setShowFreightModal] = useState(false);
  const [vehicleRefreshKey, setVehicleRefreshKey] = useState(0);
  const [driverRefreshKey, setDriverRefreshKey] = useState(0);
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0);
  const [carrierRefreshKey, setCarrierRefreshKey] = useState(0);
  const [availableCarrierIds, setAvailableCarrierIds] = useState<string[] | undefined>(undefined);
  const [availableVehicleIds, setAvailableVehicleIds] = useState<string[] | undefined>(undefined);
  const [availableDriverIds, setAvailableDriverIds] = useState<string[] | undefined>(undefined);

  // Buscar transportadoras vinculadas ao cliente
  useEffect(() => {
    async function load() {
      if (!desktopApi || !form.customerId) {
        setAvailableCarrierIds(undefined);
        return;
      }
      try {
        const carriers = await desktopApi.listCarriersByCustomer(form.customerId);
        setAvailableCarrierIds(carriers.map((c) => c.id));
        // Se o cliente tem exatamente uma transportadora vinculada e nenhuma
        // foi definida pelo padrao, ja preenchemos para agilizar a entrada.
        if (carriers.length === 1) {
          setForm((prev) =>
            prev.carrierId || isCustomerOwnTransport(prev)
              ? prev
              : { ...prev, carrierId: carriers[0].id }
          );
        }
      } catch {
        setAvailableCarrierIds(undefined);
      }
    }
    load();
    // carrierRefreshKey: recarrega os vinculos apos criar/vincular transportadora
    // pelo modal rapido, senao a lista filtrada esconderia a recem-criada.
  }, [desktopApi, form.customerId, carrierRefreshKey]);

  useEffect(() => {
    async function load() {
      if (!desktopApi || !form.carrierId || isCustomerOwnTransport(form)) {
        setAvailableVehicleIds(undefined);
        return;
      }
      try {
        const vehicles = await desktopApi.carriersGetVehicles(form.carrierId);
        setAvailableVehicleIds(vehicles.map((vehicle) => vehicle.id));
      } catch {
        setAvailableVehicleIds(undefined);
      }
    }
    load();
  }, [desktopApi, form.carrierId, form.freightModality, vehicleRefreshKey]);

  // Buscar motoristas vinculados a transportadora selecionada
  useEffect(() => {
    async function load() {
      if (!desktopApi) {
        setAvailableDriverIds(undefined);
        return;
      }
      try {
        if (form.carrierId) {
          const linked = await desktopApi.listDriversByCarrier(form.carrierId);
          setAvailableDriverIds(linked.map((d) => d.id));
        } else {
          setAvailableDriverIds(undefined);
        }
      } catch {
        setAvailableDriverIds(undefined);
      }
    }
    load();
  }, [desktopApi, form.carrierId, driverRefreshKey]);

  // Quando motorista muda, verificar se tem 1 transportadora e preencher
  useEffect(() => {
    async function load() {
      if (!desktopApi || !form.driverId) {
        return;
      }
      try {
        const carriers = await desktopApi.listCarriersByDriver(form.driverId);
        if (carriers.length === 1) {
          // Motorista tem exatamente 1 transportadora - preencher automaticamente
          setForm((prev) => ({ ...prev, carrierId: carriers[0].id }));
        }
      } catch {
        // ignore
      }
    }
    load();
  }, [desktopApi, form.driverId]);
  useEffect(() => {
    if (!desktopApi) return;
    const handler = (reading: { weightKg: number }) => setLiveWeight(reading.weightKg);
    desktopApi.onScaleReading(handler as (reading: unknown) => void);
    return () => {
      desktopApi.offScaleReading(handler as (reading: unknown) => void);
    };
  }, [desktopApi]);

  // Verificar status da balança periodicamente
  useEffect(() => {
    if (!desktopApi) return;
    const api = desktopApi;
    let canceled = false;
    async function checkStatus() {
      try {
        const status = await api.scaleGetStatus();
        if (canceled) return;
        setScaleState(status.state);
        if (status.state === "connected") {
          setScaleStateMessage("Balança conectada");
        } else if (status.state === "connecting") {
          setScaleStateMessage("Conectando à balança...");
        } else if (status.state === "error") {
          setScaleStateMessage(status.errorMessage || "Erro na balança");
        } else {
          setScaleStateMessage("Balança desconectada");
        }
      } catch {
        if (!canceled) {
          setScaleState("error");
          setScaleStateMessage("Erro ao verificar balança");
        }
      }
    }
    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => {
      canceled = true;
      clearInterval(interval);
    };
  }, [desktopApi]);

  // Auto-conectar balança quando abrir a tela
  useEffect(() => {
    if (!desktopApi) return;
    const api = desktopApi;
    let canceled = false;
    async function autoConnect() {
      try {
        const config = await api.scaleGetConfig();
        if (canceled) return;
        setIsVirtual(config.adapterType === "virtual");
        const status = await api.scaleGetStatus();
        if (canceled) return;
        if (status.state !== "connected") {
          setScaleState("connecting");
          setScaleStateMessage("Tentando conectar à balança...");
          await api.scaleConnect();
        }
      } catch {
        // Silencioso - o checkStatus periodicamente vai atualizar
      }
    }
    autoConnect();
    return () => {
      canceled = true;
    };
  }, [desktopApi]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void handleCalculateWeight();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onStart, onCancel]);

  async function handleCalculateWeight(): Promise<void> {
    if (!desktopApi) return;
    const validationError = validateWeighingForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setIsCapturing(true);
    setFormError(null);
    try {
      const capture = await desktopApi.scaleCaptureStable({ operationType: "entry" });
      setCapturedWeight(capture.reading.weightKg);
      await onStart(capture.captureId);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Falha ao capturar peso de entrada");
    } finally {
      setIsCapturing(false);
    }
  }

  useEffect(() => {
    async function fetchPrice() {
      if (!desktopApi || !form.customerId || !form.productId) {
        setPriceDetails(null);
        return;
      }
      try {
        const details = await desktopApi.getPriceDetailsForCustomerProduct(
          form.customerId,
          form.productId
        );
        setPriceDetails(details);
      } catch {
        setPriceDetails(null);
      }
    }

    fetchPrice();
  }, [desktopApi, form.customerId, form.productId]);

  useEffect(() => {
    if (!desktopApi || !form.customerId || !form.productId) return;

    const api = desktopApi;
    let canceled = false;

    async function fetchCustomerFreight(): Promise<void> {
      try {
        const rule = await api.getCustomerFreightForProduct(form.customerId, form.productId);
        if (canceled || !rule) return;
        setForm((prev) => ({
          ...prev,
          // Regra de frete do cliente: frete por conta do cliente (FOB) com valor lancado.
          // Nao sobrescreve o transporte proprio do cliente, que nao comporta valor.
          freightModality: isCustomerOwnTransport(prev) ? prev.freightModality : "fob",
          chargeFreight: !isCustomerOwnTransport(prev),
          freightCalculationType: rule.rule.type as WeighingFormState["freightCalculationType"],
          freightBaseValueCents: rule.rule.baseValueCents,
          freightFixedValueCents: rule.rule.fixedValueCents ?? null
        }));
      } catch {
        // ignore
      }
    }

    void fetchCustomerFreight();
    return () => {
      canceled = true;
    };
  }, [desktopApi, form.customerId, form.productId]);

  const transportReady = isTransportReady(form);

  return (
    <section style={styles.entryShell}>
      <div style={styles.entryHero}>
        <MountainOutline
          opacity={0.5}
          style={{
            position: "absolute",
            right: "-8px",
            bottom: "-6px",
            width: "232px",
            height: "87px",
            pointerEvents: "none",
            zIndex: 0
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <p style={{ ...styles.kicker, color: "#fbbf24" }}>Operacao de balanca</p>
          <h2 style={{ ...styles.title, marginBottom: "4px", color: "#ffffff" }}>Nova entrada</h2>
          <p style={{ ...styles.subtitle, color: "#d6d3d1" }}>
            Use Tab para avancar e Ctrl+Enter para capturar.
          </p>
        </div>
        {/* Card unico de peso: mostra a leitura da balanca (real ou virtual) e, apos a
            captura, o peso capturado — sem o card separado de "peso ao vivo". */}
        <div style={{ display: "flex", gap: "16px", alignItems: "stretch", position: "relative", zIndex: 1 }}>
          <div
            style={{
              ...styles.liveWeightCard,
              flex: 1,
              backgroundColor: capturedWeight !== null ? "#f0fdf4" : undefined,
              borderColor: capturedWeight !== null ? "#86efac" : undefined
            }}
          >
            <div style={styles.metricHeader}>
              <img
                src="midia/peso.png"
                alt=""
                style={{ width: "22px", height: "22px", objectFit: "contain" }}
              />
              <span style={styles.metricLabel}>
                {capturedWeight !== null ? "Peso capturado" : "Peso"}
              </span>
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor:
                    scaleState === "connected"
                      ? "#22c55e"
                      : scaleState === "connecting"
                        ? "#f59e0b"
                        : "#ef4444",
                  marginLeft: "auto"
                }}
              />
            </div>
            <strong
              style={{
                ...styles.metricValue,
                color: capturedWeight !== null ? "#15803d" : undefined
              }}
            >
              {capturedWeight !== null
                ? formatWeightKg(capturedWeight)
                : liveWeight !== null
                  ? formatWeightKg(liveWeight)
                  : "-- kg"}
            </strong>
            <span style={styles.metricHint}>
              {capturedWeight !== null
                ? "Leitura estavel capturada"
                : scaleState === "connected"
                  ? "Leitura em tempo real"
                  : scaleStateMessage}
            </span>
            {scaleState !== "connected" ? (
              <button
                type="button"
                onClick={async () => {
                  if (!desktopApi) return;
                  setScaleState("connecting");
                  setScaleStateMessage("Conectando...");
                  try {
                    await desktopApi.scaleConnect();
                  } catch (err) {
                    setScaleState("error");
                    setScaleStateMessage(err instanceof Error ? err.message : "Falha ao conectar");
                  }
                }}
                style={{
                  ...styles.secondaryButton,
                  fontSize: "12px",
                  padding: "6px 12px",
                  marginTop: "8px"
                }}
              >
                Reconectar balança
              </button>
            ) : null}
          </div>
        </div>
        {isVirtual && scaleState === "connected" ? (
          <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#475569",
                  display: "block",
                  marginBottom: "4px"
                }}
              >
                Peso para simular (kg)
              </label>
              <input
                type="number"
                value={virtualWeightInput}
                onChange={(e) => setVirtualWeightInput(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!desktopApi) return;
                    const kg = parseFloat(virtualWeightInput);
                    if (!Number.isFinite(kg) || kg < 0) return;
                    try {
                      await desktopApi.virtualScaleSetWeight(kg);
                      setLiveWeight(kg);
                    } catch (err) {
                      setScaleStateMessage(
                        err instanceof Error ? err.message : "Erro ao enviar peso"
                      );
                    }
                  }
                }}
                placeholder="Ex: 15500"
                min="0"
                step="1"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: "16px",
                  fontWeight: 700,
                  border: "2px solid #86efac",
                  borderRadius: "8px",
                  background: "#f0fdf4",
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "monospace"
                }}
              />
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!desktopApi) return;
                const kg = parseFloat(virtualWeightInput);
                if (!Number.isFinite(kg) || kg < 0) {
                  setScaleStateMessage("Digite um peso valido em kg.");
                  return;
                }
                try {
                  await desktopApi.virtualScaleSetWeight(kg);
                  setLiveWeight(kg);
                } catch (err) {
                  setScaleStateMessage(err instanceof Error ? err.message : "Erro ao enviar peso");
                }
              }}
              style={{
                ...styles.primaryButton,
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              Enviar peso
            </button>
          </div>
        ) : null}
      </div>

      {formError ? <p style={styles.errorMessage}>{formError}</p> : null}

      <div style={styles.entryGrid}>
        <article style={styles.entryCard}>
          <SectionHeader
            iconSrc="midia/commerce.png"
            title="Dados comerciais"
            description="Cliente, produto e pagamento"
          />
          <CacheSelect
            label="Cliente"
            entityType="customer"
            value={form.customerId}
            onChange={(id, item) => {
              setForm((prev) => ({
                ...prev,
                customerId: id,
                // Pre-seleciona gerar (ou nao) nota fiscal conforme o cadastro do
                // cliente; o operador ainda pode trocar antes de fechar.
                operationType:
                  item?.nfRequired === false
                    ? "internal"
                    : item?.nfRequired === true
                      ? "invoice"
                      : prev.operationType,
                // Ao trocar de cliente, puxamos os vinculos padrao dele e
                // limpamos a transportadora anterior (que pode nao ser dele).
                carrierId:
                  typeof item?.defaultCarrierId === "string" && item.defaultCarrierId
                    ? item.defaultCarrierId
                    : "",
                paymentMethodId:
                  typeof item?.defaultPaymentMethodId === "string" && item.defaultPaymentMethodId
                    ? item.defaultPaymentMethodId
                    : prev.paymentMethodId,
                // A condicao padrao chega como texto (async abaixo); limpa a anterior.
                paymentTermId: "",
                customConditionText: ""
              }));
              // Pre-carrega a condicao padrao do cliente como texto editavel no campo.
              const defaultTermId =
                typeof item?.defaultPaymentTermId === "string" ? item.defaultPaymentTermId : "";
              if (defaultTermId && desktopApi) {
                void desktopApi
                  .queryCache({ entityType: "payment_term", limit: 200 })
                  .then((result) => {
                    const term = (result.rows as PaymentTermCacheEntry[]).find(
                      (t) => t.id === defaultTermId
                    );
                    if (!term) return;
                    setForm((prev) =>
                      prev.customerId === id
                        ? {
                            ...prev,
                            customConditionText: extractConditionRaw(term.rulesJson) || term.name
                          }
                        : prev
                    );
                  })
                  .catch(() => undefined);
              }
            }}
            onCreateNew={() => setShowCustomerModal(true)}
            desktopApi={desktopApi}
            refreshKey={customerRefreshKey}
          />
          <CacheSelect
            label="Produto"
            entityType="product"
            value={form.productId}
            onChange={(id) => setForm({ ...form, productId: id })}
            desktopApi={desktopApi}
            productFiscalType="finished_goods"
          />
          <CacheSelect
            label="Forma de pagamento"
            entityType="payment_method"
            value={form.paymentMethodId}
            onChange={(id) => setForm((prev) => ({ ...prev, paymentMethodId: id }))}
            desktopApi={desktopApi}
          />
          <Field
            label="Condicao de pagamento"
            hint='Digite: "5" (5 parcelas mensais), "7 14 21" ou "7/14/21" (prazos), "A Vista". Vazio = a vista. Se a condicao nao existir no OMIE, ela e criada automaticamente no envio.'
          >
            <input
              type="text"
              value={form.customConditionText}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  customConditionText: event.target.value,
                  paymentTermId: ""
                }))
              }
              placeholder='Ex.: "7/14/21"'
              style={getInputStyle(false)}
            />
          </Field>
        </article>

        <article style={styles.entryCard}>
          <SectionHeader
            iconSrc="midia/truck.png"
            title="Transporte"
            description="Transportadora, placa e motorista"
          />
          <div style={styles.freightBox}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                flexWrap: "wrap"
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "160px" }}>
                <span style={{ fontWeight: 600, fontSize: "13px" }}>Tipo de frete</span>
                <span style={styles.helperText}>
                  {form.freightModality === "none"
                    ? "Sem frete. Selecione a modalidade enviada ao OMIE."
                    : `${getFreightModalityInfo(form.freightModality).label} — ${getFreightModalityInfo(form.freightModality).description}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowFreightModal(true)}
                style={{ ...styles.secondaryButton, whiteSpace: "nowrap" }}
              >
                Selecionar tipo de frete
              </button>
            </div>
            {getFreightModalityInfo(form.freightModality).supportsCharge ? (
              <>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={form.chargeFreight}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, chargeFreight: event.target.checked }))
                    }
                  />
                  Lancar valor de frete nesta operacao
                </label>
                {form.chargeFreight ? (
                  <div style={styles.freightCompactGrid}>
                    <label style={styles.fieldLabel}>
                      Calculo
                      <select
                        value={form.freightCalculationType}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            freightCalculationType: event.target
                              .value as WeighingFormState["freightCalculationType"]
                          }))
                        }
                        style={styles.input}
                      >
                        <option value="per_ton">Por tonelada</option>
                        <option value="per_ton_km">Tonelada-km</option>
                        <option value="fixed_plus_ton">Fixo + tonelada</option>
                      </select>
                    </label>
                    <PriceInput
                      label={
                        form.freightCalculationType === "per_ton_km"
                          ? "Frete por ton-km"
                          : "Frete por tonelada"
                      }
                      suffix={form.freightCalculationType === "per_ton_km" ? "/ton-km" : "/ton"}
                      valueCents={form.freightBaseValueCents}
                      onChange={(cents) =>
                        setForm((prev) => ({ ...prev, freightBaseValueCents: cents }))
                      }
                      compact
                    />
                    {form.freightCalculationType === "fixed_plus_ton" ? (
                      <PriceInput
                        label="Valor fixo do frete"
                        suffix=""
                        valueCents={form.freightFixedValueCents}
                        onChange={(cents) =>
                          setForm((prev) => ({ ...prev, freightFixedValueCents: cents }))
                        }
                        compact
                      />
                    ) : null}
                    {form.freightCalculationType === "per_ton_km" ? (
                      <NumberInput
                        label="Distancia km"
                        value={form.freightDistanceKm}
                        onChange={(freightDistanceKm) =>
                          setForm((prev) => ({ ...prev, freightDistanceKm }))
                        }
                        placeholder="Ex: 35"
                      />
                    ) : null}
                    <PriceInput
                      label="Frete minimo"
                      suffix=""
                      valueCents={form.freightMinValueCents}
                      onChange={(cents) =>
                        setForm((prev) => ({ ...prev, freightMinValueCents: cents }))
                      }
                      compact
                    />
                    <TextInput
                      label="Destino/obs."
                      value={form.freightDestination}
                      onChange={(freightDestination) =>
                        setForm((prev) => ({ ...prev, freightDestination }))
                      }
                      placeholder="Destino ou regra comercial"
                    />
                    <label style={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={form.deductFreightFromCredit || freightGoesToCustomerInvoice(form)}
                        disabled={freightGoesToCustomerInvoice(form)}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            deductFreightFromCredit: event.target.checked
                          }))
                        }
                      />
                      Abater frete do credito do cliente
                    </label>
                    {freightGoesToCustomerInvoice(form) ? (
                      <p style={styles.muted}>
                        Frete pago pela Pedreira e forma de pagamento no credito do cliente: o frete
                        entra automaticamente na fatura.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <CacheSelect
            label="Transportadora"
            entityType="carrier"
            value={form.carrierId}
            onChange={(id) =>
              setForm((prev) => ({
                ...prev,
                carrierId: id,
                vehicleId: "",
                driverId: ""
              }))
            }
            onCreateNew={() => setShowCarrierModal(true)}
            desktopApi={desktopApi}
            refreshKey={carrierRefreshKey}
            filterIds={carrierSelectorFilterIds(availableCarrierIds)}
            disabled={isCustomerOwnTransport(form)}
          />
          {form.customerId && availableCarrierIds && availableCarrierIds.length === 0 ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
              <p style={{ ...styles.helperText, color: "#d97706", margin: 0 }}>
                Nenhuma transportadora vinculada a este cliente &mdash; exibindo todas as cadastradas.
              </p>
              <button
                type="button"
                onClick={() => setShowCarrierModal(true)}
                style={{ ...styles.secondaryButton, fontSize: "11px", padding: "4px 8px" }}
              >
                + Vincular transportadora
              </button>
            </div>
          ) : null}
          <div style={styles.compactInlineGrid}>
            <CacheSelect
              label="Placa"
              entityType="vehicle"
              value={form.vehicleId}
              onChange={(id) => setForm((prev) => ({ ...prev, vehicleId: id }))}
              onCreateNew={() => setShowVehicleModal(true)}
              desktopApi={desktopApi}
              refreshKey={vehicleRefreshKey}
              filterIds={isCustomerOwnTransport(form) ? undefined : availableVehicleIds}
              disabled={!transportReady}
            />
            <CacheSelect
              label="Motorista"
              entityType="driver"
              value={form.driverId}
              onChange={(id) => setForm({ ...form, driverId: id })}
              onCreateNew={() => setShowDriverModal(true)}
              desktopApi={desktopApi}
              refreshKey={driverRefreshKey}
              filterIds={getDriverFilterIds(form, availableDriverIds)}
              disabled={!transportReady}
            />
          </div>
          {form.carrierId && availableDriverIds && availableDriverIds.length === 0 ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
              <p style={{ ...styles.helperText, color: "#d97706", margin: 0 }}>
                Nenhum motorista vinculado a esta transportadora.
              </p>
              <button
                type="button"
                onClick={() => setShowDriverModal(true)}
                style={{ ...styles.secondaryButton, fontSize: "11px", padding: "4px 8px" }}
              >
                + Cadastrar motorista
              </button>
            </div>
          ) : null}
        </article>

        <aside style={styles.entrySummaryCard}>
          <SectionHeader
            iconComponent={BadgeDollarSign}
            title="Resumo da entrada"
            description="Preco, frete e captura"
          />
          <PriceDetailsPanel details={priceDetails} />
          <div style={styles.actionStack}>
            <button
              type="button"
              onClick={() => void handleCalculateWeight()}
              disabled={isCapturing || scaleState !== "connected"}
              style={{
                ...styles.captureButton,
                flex: 1,
                opacity: isCapturing || scaleState !== "connected" ? 0.55 : 1
              }}
            >
              <Scale size={18} strokeWidth={2.4} />
              {isCapturing ? "Capturando..." : "Capturar peso"}
            </button>
            <HelpTooltip content={TIPS.form.start} placement="top" shortcut="Ctrl+Enter" />
            <button
              type="button"
              onClick={onCancel}
              style={{ ...styles.secondaryButton, height: "40px" }}
            >
              Limpar e voltar
            </button>
          </div>
        </aside>
      </div>

      {showVehicleModal ? (
        <QuickVehicleModal
          desktopApi={desktopApi}
          onClose={() => setShowVehicleModal(false)}
          onCreated={(id) => {
            setForm((prev) => ({ ...prev, vehicleId: id }));
            setShowVehicleModal(false);
            if (desktopApi && form.carrierId) {
              void desktopApi.vehiclesLinkCarrier(id, form.carrierId).catch(() => undefined);
            }
            setVehicleRefreshKey((k) => k + 1);
          }}
        />
      ) : null}

      {showDriverModal ? (
        <QuickDriverModal
          desktopApi={desktopApi}
          onClose={() => setShowDriverModal(false)}
          onCreated={async (id) => {
            const carrierId = shouldLinkCreatedDriverToCarrier(form);
            setForm((prev) => ({ ...prev, driverId: id }));
            setShowDriverModal(false);
            if (desktopApi && carrierId) {
              try {
                await desktopApi.linkDriverCarrier(id, carrierId);
              } catch {
                /* ignore */
              }
            }
            setDriverRefreshKey((k) => k + 1);
          }}
        />
      ) : null}

      {showCustomerModal ? (
        <QuickCustomerModal
          desktopApi={desktopApi}
          onClose={() => setShowCustomerModal(false)}
          onCreated={(id) => {
            setForm((prev) => ({ ...prev, customerId: id }));
            setShowCustomerModal(false);
            setCustomerRefreshKey((k) => k + 1);
          }}
        />
      ) : null}

      {showCarrierModal ? (
        <QuickCarrierModal
          desktopApi={desktopApi}
          onClose={() => setShowCarrierModal(false)}
          onCreated={async (id) => {
            setForm((prev) => ({
              ...prev,
              carrierId: id,
              // Vincular uma transportadora da Pedreira sai do transporte proprio do cliente.
              freightModality:
                prev.freightModality === "own_recipient" ? "none" : prev.freightModality
            }));
            setShowCarrierModal(false);
            // O seletor filtra por "transportadoras vinculadas ao cliente": sem vincular
            // a recem-criada ao cliente selecionado, ela nao apareceria na lista.
            if (desktopApi && form.customerId) {
              try {
                await desktopApi.linkCustomerCarrier(form.customerId, id);
              } catch {
                /* ignore */
              }
            }
            // Mostra a nova transportadora de imediato, mesmo se a releitura falhar.
            setAvailableCarrierIds((prev) => appendAvailableId(prev, id));
            if (desktopApi && form.vehicleId) {
              try {
                await desktopApi.vehiclesLinkCarrier(form.vehicleId, id);
              } catch {
                /* ignore */
              }
            }
            setCarrierRefreshKey((k) => k + 1);
            setVehicleRefreshKey((k) => k + 1);
          }}
        />
      ) : null}

      {showFreightModal ? (
        <FreightTypeModal
          selected={form.freightModality}
          onClose={() => setShowFreightModal(false)}
          onSelect={(modality) => {
            setForm((prev) => {
              const info = getFreightModalityInfo(modality);
              const ownRecipient = modality === "own_recipient";
              return {
                ...prev,
                freightModality: modality,
                // Modalidade cobravel ja abre os campos de valor; sem cobranca, zera o toggle.
                chargeFreight: info.supportsCharge,
                deductFreightFromCredit: info.supportsCharge ? prev.deductFreightFromCredit : false,
                // Transporte proprio do cliente: a transportadora da Pedreira nao se aplica.
                carrierId: ownRecipient ? "" : prev.carrierId,
                vehicleId: ownRecipient ? "" : prev.vehicleId,
                driverId: ownRecipient ? "" : prev.driverId
              };
            });
            setShowFreightModal(false);
          }}
        />
      ) : null}
    </section>
  );
}

function FreightTypeModal({
  selected,
  onSelect,
  onClose
}: {
  selected: FreightModality;
  onSelect: (modality: FreightModality) => void;
  onClose: () => void;
}) {
  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div
        style={{ ...modalContentStyle, maxWidth: "440px" }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 4px" }}>Selecionar tipo de frete</h3>
        <p style={{ ...styles.helperText, marginTop: 0 }}>
          Escolha a modalidade enviada ao OMIE no pedido de venda. Apenas uma por operacao.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
          {FREIGHT_MODALITIES.map((modality) => {
            const isSelected = modality.key === selected;
            return (
              <button
                key={modality.key}
                type="button"
                onClick={() => onSelect(modality.key)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  alignItems: "flex-start",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: `1px solid ${isSelected ? "var(--kr-accent, #2563eb)" : "var(--kr-border)"}`,
                  background: isSelected ? "var(--kr-accent-soft, rgba(37,99,235,0.08))" : "var(--kr-surface)",
                  color: "var(--kr-text)",
                  cursor: "pointer"
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "13px" }}>{modality.label}</span>
                <span style={styles.helperText}>{modality.description}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} style={styles.secondaryButton}>
          Fechar
        </button>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  iconComponent: Icon,
  iconSrc,
  title,
  description
}: {
  icon?: string;
  iconComponent?: LucideIcon;
  iconSrc?: string;
  title: string;
  description: string;
}) {
  return (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionIcon}>
        {iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            style={{ width: "20px", height: "20px", objectFit: "contain" }}
          />
        ) : Icon ? (
          <Icon size={18} strokeWidth={2.4} />
        ) : (
          icon
        )}
      </span>
      <div>
        <h3 style={styles.sectionTitle}>{title}</h3>
        <p style={styles.sectionDescription}>{description}</p>
      </div>
    </div>
  );
}

interface QuickModalProps {
  desktopApi: KyberRockDesktopApi | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}

type QuickDriverModalProps = QuickModalProps;

function QuickVehicleModal({ desktopApi, onClose, onCreated }: QuickModalProps) {
  const [plateInput, setPlateInput] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!desktopApi) return;
    const normalizedPlate = normalizePlate(plateInput);
    if (!normalizedPlate) {
      setError("Informe a placa.");
      return;
    }
    if (!isValidPlate(normalizedPlate)) {
      setError("Placa invalida. Use o formato ABC1234 ou ABC1D23.");
      return;
    }
    setSaving(true);
    try {
      const result = await desktopApi.vehiclesCreate({
        plate: normalizedPlate,
        description: description.trim() || undefined
      });
      onCreated((result as { id: string }).id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ margin: "0 0 8px 0", color: "var(--kr-text-strong)", fontSize: "15px" }}>
          Cadastrar veiculo
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <PlateInput label="Placa" value={plateInput} onChange={setPlateInput} required />
        <TextInput
          label="Descricao"
          value={description}
          onChange={setDescription}
          placeholder="Ex: Caminhao basculante"
        />
        <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
          <button type="button" onClick={handleSave} disabled={saving} style={styles.primaryButton}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickDriverModal({ desktopApi, onClose, onCreated }: QuickDriverModalProps) {
  const [name, setName] = useState("");
  const [documentInput, setDocumentInput] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!desktopApi) return;
    if (!name.trim()) {
      setError("Informe o nome.");
      return;
    }
    const normalizedDocument = normalizeDocument(documentInput);
    if (normalizedDocument && !isValidDocument(normalizedDocument)) {
      setError("CPF invalido.");
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (phone.trim() && normalizedPhone.length !== 10 && normalizedPhone.length !== 11) {
      setError("Telefone invalido. Informe com DDD (11 digitos).");
      return;
    }
    setSaving(true);
    try {
      const result = await desktopApi.driversCreate({
        name: name.trim(),
        document: normalizedDocument || undefined,
        phone: normalizedPhone || undefined
      });
      onCreated((result as { id: string }).id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ margin: "0 0 8px 0", color: "var(--kr-text-strong)", fontSize: "15px" }}>
          Cadastrar motorista
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <TextInput
          label="Nome completo"
          value={name}
          onChange={setName}
          required
          autoComplete="name"
        />
        <DocumentInput
          label="CPF"
          value={documentInput}
          onChange={setDocumentInput}
          placeholder="000.000.000-00"
        />
        <PhoneInput label="Telefone" value={phone} onChange={setPhone} />
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button type="button" onClick={handleSave} disabled={saving} style={styles.primaryButton}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickCustomerModal({ desktopApi, onClose, onCreated }: QuickModalProps) {
  const [tradeName, setTradeName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [documentInput, setDocumentInput] = useState("");
  const [phone, setPhone] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!desktopApi) return;
    if (!tradeName.trim() || !legalName.trim()) {
      setError("Informe nome fantasia e razao social.");
      return;
    }
    const normalizedDocument = normalizeDocument(documentInput);
    if (normalizedDocument && !isValidDocument(normalizedDocument)) {
      setError("CPF/CNPJ invalido.");
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (phone.trim() && normalizedPhone.length !== 10 && normalizedPhone.length !== 11) {
      setError("Telefone invalido. Informe com DDD (11 digitos).");
      return;
    }
    const normalizedEmail = normalizeEmail(emailInput);
    if (emailInput.trim() && !isValidEmail(normalizedEmail)) {
      setError("Email invalido.");
      return;
    }
    setSaving(true);
    try {
      const result = await desktopApi.customersCreate({
        tradeName: tradeName.trim(),
        legalName: legalName.trim(),
        document: normalizedDocument || undefined,
        phone: normalizedPhone || undefined,
        email: normalizedEmail || undefined
      });
      onCreated((result as { id: string }).id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ margin: "0 0 8px 0", color: "var(--kr-text-strong)", fontSize: "15px" }}>
          Cadastrar cliente
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <TextInput label="Nome fantasia" value={tradeName} onChange={setTradeName} required />
        <TextInput label="Razao social" value={legalName} onChange={setLegalName} required />
        <DocumentInput label="CPF/CNPJ" value={documentInput} onChange={setDocumentInput} />
        <PhoneInput label="Telefone" value={phone} onChange={setPhone} />
        <EmailInput label="Email" value={emailInput} onChange={setEmailInput} />
        <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
          <button type="button" onClick={handleSave} disabled={saving} style={styles.primaryButton}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickCarrierModal({ desktopApi, onClose, onCreated }: QuickModalProps) {
  const [name, setName] = useState("");
  const [documentInput, setDocumentInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!desktopApi) return;
    if (!name.trim()) {
      setError("Informe o nome.");
      return;
    }
    const normalizedDocument = normalizeDocument(documentInput);
    if (normalizedDocument && !isValidDocument(normalizedDocument)) {
      setError("CPF/CNPJ invalido.");
      return;
    }
    setSaving(true);
    try {
      const result = await desktopApi.carriersCreate({
        name: name.trim(),
        document: normalizedDocument || undefined
      });
      onCreated((result as { id: string }).id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ margin: "0 0 8px 0", color: "var(--kr-text-strong)", fontSize: "15px" }}>
          Cadastrar transportadora
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <TextInput label="Nome" value={name} onChange={setName} required />
        <DocumentInput label="CPF/CNPJ" value={documentInput} onChange={setDocumentInput} />
        <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
          <button type="button" onClick={handleSave} disabled={saving} style={styles.primaryButton}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000
};

const modalContentStyle: React.CSSProperties = {
  background: "var(--kr-surface)",
  color: "var(--kr-text)",
  border: "1px solid var(--kr-border)",
  borderRadius: "14px",
  padding: "14px",
  width: "100%",
  maxWidth: "380px",
  boxShadow: "var(--kr-shadow)"
};

function CloseOperationWeighingDialog({
  desktopApi,
  operation,
  onConfirm,
  onCancel
}: {
  desktopApi: KyberRockDesktopApi | null;
  operation: WeighingOperationSummary;
  onConfirm: (operationType: OperationType, scaleCaptureId: string) => void;
  onCancel: () => void;
}) {
  const [operationType, setOperationType] = useState<OperationType>(operation.operationType);
  const [liveWeight, setLiveWeight] = useState<number | null>(null);
  const [capturedExitWeight, setCapturedExitWeight] = useState<number | null>(null);
  const [capturedExitCaptureId, setCapturedExitCaptureId] = useState<string | null>(null);
  const [scaleState, setScaleState] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [scaleMessage, setScaleMessage] = useState<string>("Balança desconectada");
  const [isVirtual, setIsVirtual] = useState(false);
  const [virtualWeightInput, setVirtualWeightInput] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopApi) return;
    const handler = (reading: { weightKg: number }) => setLiveWeight(reading.weightKg);
    desktopApi.onScaleReading(handler as (reading: unknown) => void);
    return () => {
      desktopApi.offScaleReading(handler as (reading: unknown) => void);
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) return;
    const api = desktopApi;
    let canceled = false;
    async function checkStatus() {
      try {
        const status = await api.scaleGetStatus();
        if (canceled) return;
        setScaleState(status.state);
        if (status.state === "connected") {
          setScaleMessage("Balança conectada");
        } else if (status.state === "connecting") {
          setScaleMessage("Conectando...");
        } else if (status.state === "error") {
          setScaleMessage(status.errorMessage || "Erro na balança");
        } else {
          setScaleMessage("Balança desconectada");
        }
      } catch {
        if (!canceled) {
          setScaleState("error");
          setScaleMessage("Erro ao verificar balança");
        }
      }
    }
    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => {
      canceled = true;
      clearInterval(interval);
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) return;
    const api = desktopApi;
    let canceled = false;
    async function autoConnect() {
      try {
        const config = await api.scaleGetConfig();
        if (canceled) return;
        setIsVirtual(config.adapterType === "virtual");
        const status = await api.scaleGetStatus();
        if (canceled) return;
        if (status.state !== "connected") {
          await api.scaleConnect();
        }
      } catch {
        // Silencioso
      }
    }
    autoConnect();
    return () => {
      canceled = true;
    };
  }, [desktopApi]);

  async function handleCaptureExitWeight(): Promise<void> {
    if (!desktopApi) return;
    setIsCapturing(true);
    setCaptureError(null);
    try {
      const capture = await desktopApi.scaleCaptureStable({ operationType: "exit" });
      setCapturedExitWeight(capture.reading.weightKg);
      setCapturedExitCaptureId(capture.captureId);
      if (operation.entryWeightKg !== null && capture.reading.weightKg <= operation.entryWeightKg) {
        setCaptureError("Peso de saida deve ser maior que o peso de entrada.");
      }
    } catch (err) {
      setCapturedExitCaptureId(null);
      setCaptureError(err instanceof Error ? err.message : "Falha ao capturar peso");
    } finally {
      setIsCapturing(false);
    }
  }

  const netWeight =
    capturedExitWeight !== null && operation.entryWeightKg !== null
      ? capturedExitWeight - operation.entryWeightKg
      : null;
  const invalidNetWeight = netWeight !== null && netWeight <= 0;

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalContentStyle, maxWidth: "720px", width: "90%" }}>
        <h3 style={{ margin: "0 0 8px 0", color: "var(--kr-text-strong)", fontSize: "18px" }}>
          Fechar operação - Captura de peso de saída
        </h3>

        {/* Dados da operação */}
        <div
          style={{
            background: "var(--kr-surface-soft)",
            padding: "12px",
            borderRadius: "10px",
            marginBottom: "12px",
            border: "1px solid var(--kr-border)"
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "12px",
              fontSize: "13px"
            }}
          >
            <div>
              <div style={{ color: "#64748b", fontSize: "11px" }}>Placa</div>
              <strong>{operation.plate}</strong>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: "11px" }}>Cliente</div>
              <strong>{operation.customerName}</strong>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: "11px" }}>Produto</div>
              <strong>{operation.productDescription}</strong>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: "11px" }}>Motorista</div>
              <strong>{operation.driverName}</strong>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: "11px" }}>Peso de entrada</div>
              <strong style={{ color: "#15803d" }}>
                {formatWeightKg(operation.entryWeightKg ?? 0)}
              </strong>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: "11px" }}>Preço</div>
              <strong>{formatMoney(operation.unitPriceCents)}/ton</strong>
            </div>
          </div>
        </div>

        {/* Balança - peso ao vivo e capturado */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
          <div
            style={{
              flex: 1,
              padding: "12px",
              background: "var(--kr-surface-soft)",
              borderRadius: "12px",
              border: "1px solid var(--kr-border)",
              textAlign: "center"
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginBottom: "8px"
              }}
            >
              <span style={{ fontSize: "13px", color: "#64748b" }}>Peso ao vivo</span>
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor:
                    scaleState === "connected"
                      ? "#22c55e"
                      : scaleState === "connecting"
                        ? "#f59e0b"
                        : "#ef4444"
                }}
              />
            </div>
            <strong
              style={{ fontSize: "28px", color: "var(--kr-text-strong)", fontFamily: "monospace" }}
            >
              {liveWeight !== null ? formatWeightKg(liveWeight) : "-- kg"}
            </strong>
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
              {scaleState === "connected" ? "Leitura em tempo real" : scaleMessage}
            </div>
            {scaleState !== "connected" ? (
              <button
                type="button"
                onClick={async () => {
                  if (!desktopApi) return;
                  const api = desktopApi;
                  setScaleState("connecting");
                  try {
                    await api.scaleConnect();
                  } catch (err) {
                    setScaleState("error");
                    setScaleMessage(err instanceof Error ? err.message : "Falha ao conectar");
                  }
                }}
                style={{
                  ...styles.secondaryButton,
                  fontSize: "12px",
                  padding: "6px 12px",
                  marginTop: "8px"
                }}
              >
                Reconectar balança
              </button>
            ) : null}
          </div>
          {/* end of live weight card - first div closes card, second the flex row container */}

          <div
            style={{
              flex: 1,
              padding: "16px",
              background: capturedExitWeight !== null ? "#f0fdf4" : "#f8fafc",
              borderRadius: "12px",
              border: `2px solid ${capturedExitWeight !== null ? "#86efac" : "#e2e8f0"}`,
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "8px" }}>
              Peso de saida capturado
            </div>
            <strong
              style={{
                fontSize: "32px",
                color: capturedExitWeight !== null ? "#15803d" : "#0f172a",
                fontFamily: "monospace"
              }}
            >
              {capturedExitWeight !== null ? formatWeightKg(capturedExitWeight) : "-- kg"}
            </strong>
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
              {capturedExitWeight !== null
                ? "Leitura estavel capturada"
                : "Clique em 'Capturar peso'"}
            </div>
          </div>
        </div>

        {isVirtual && scaleState === "connected" ? (
          <div
            style={{ marginBottom: "16px", display: "flex", gap: "8px", alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#475569",
                  display: "block",
                  marginBottom: "4px"
                }}
              >
                Peso de saida para simular (kg)
              </label>
              <input
                type="number"
                value={virtualWeightInput}
                onChange={(e) => setVirtualWeightInput(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!desktopApi) return;
                    const kg = parseFloat(virtualWeightInput);
                    if (!Number.isFinite(kg) || kg < 0) return;
                    try {
                      await desktopApi.virtualScaleSetWeight(kg);
                      setLiveWeight(kg);
                    } catch (err) {
                      setScaleMessage(err instanceof Error ? err.message : "Erro ao enviar peso");
                    }
                  }
                }}
                placeholder="Ex: 35000"
                min="0"
                step="1"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: "16px",
                  fontWeight: 700,
                  border: "2px solid #86efac",
                  borderRadius: "8px",
                  background: "#f0fdf4",
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "monospace"
                }}
              />
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!desktopApi) return;
                const kg = parseFloat(virtualWeightInput);
                if (!Number.isFinite(kg) || kg < 0) {
                  setScaleMessage("Digite um peso valido em kg.");
                  return;
                }
                try {
                  await desktopApi.virtualScaleSetWeight(kg);
                  setLiveWeight(kg);
                } catch (err) {
                  setScaleMessage(err instanceof Error ? err.message : "Erro ao enviar peso");
                }
              }}
              style={{
                ...styles.primaryButton,
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              Enviar peso
            </button>
          </div>
        ) : null}

        {/* Peso líquido */}
        {netWeight !== null ? (
          <div
            style={{
              textAlign: "center",
              padding: "12px",
              background: "var(--kr-info-bg)",
              border: "1px solid var(--kr-info-border)",
              borderRadius: "10px",
              marginBottom: "16px"
            }}
          >
            <span
              style={{
                fontSize: "14px",
                color: invalidNetWeight ? "var(--kr-danger)" : "var(--kr-info-text)"
              }}
            >
              Peso líquido:{" "}
              <strong style={{ fontSize: "20px" }}>{formatWeightKg(netWeight)}</strong>
            </span>
          </div>
        ) : null}

        {captureError ? <p style={styles.errorMessage}>{captureError}</p> : null}

        {/* Botão capturar peso */}
        <div style={{ textAlign: "center", marginBottom: "16px" }}>
          <button
            type="button"
            onClick={handleCaptureExitWeight}
            disabled={isCapturing || scaleState !== "connected"}
            style={{
              ...styles.captureButton,
              opacity: isCapturing || scaleState !== "connected" ? 0.5 : 1,
              fontSize: "16px",
              padding: "12px 24px"
            }}
          >
            <Scale size={20} strokeWidth={2.4} />
            {isCapturing ? "Capturando..." : "Capturar peso de saída"}
          </button>
        </div>

        {/* Tipo de operação */}
        <label style={styles.fieldLabel} title={TIPS.form.operationType}>
          Tipo de fechamento
          <select
            value={operationType}
            onChange={(event) => setOperationType(event.target.value as OperationType)}
            style={styles.input}
          >
            <option value="invoice">Com nota fiscal</option>
            <option value="internal">Interna (sem nota fiscal)</option>
          </select>
        </label>

        {/* Ações */}
        <div style={{ display: "flex", gap: "8px", marginTop: "16px", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => {
              if (capturedExitCaptureId && !invalidNetWeight) {
                onConfirm(operationType, capturedExitCaptureId);
              }
            }}
            disabled={!capturedExitCaptureId || invalidNetWeight}
            style={{
              ...styles.primaryButton,
              opacity: !capturedExitCaptureId || invalidNetWeight ? 0.5 : 1
            }}
          >
            Confirmar fechamento
          </button>
          <HelpTooltip content={TIPS.form.confirmClose} placement="top" />
          <button type="button" onClick={onCancel} style={styles.secondaryButton}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function OmieDirectSyncDialog({
  desktopApi,
  onClose
}: {
  desktopApi: KyberRockDesktopApi | null;
  onClose: () => void;
}) {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync(): Promise<void> {
    if (!desktopApi) return;
    const key = appKey.trim();
    const secret = appSecret.trim();
    if (!key || !secret) {
      setError("Informe o App Key e App Secret do OMIE.");
      return;
    }
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const res = await desktopApi.syncOmieDirect(key, secret);
      const parts: string[] = [];
      if (res.customersPulled > 0) parts.push(`${res.customersPulled} clientes baixados`);
      if (res.customersPushed > 0) parts.push(`${res.customersPushed} clientes enviados`);
      if (res.productsSynced > 0) parts.push(`${res.productsSynced} produtos`);
      if (res.paymentTermsSynced > 0) parts.push(`${res.paymentTermsSynced} condicoes`);
      if (res.suppliersSynced > 0) parts.push(`${res.suppliersSynced} transportadoras`);
      if (res.errors.length > 0) parts.push(`${res.errors.length} erro(s)`);
      setResult(parts.join(" | ") || "Nenhum dado sincronizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no sync direto OMIE");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalContentStyle, maxWidth: "480px" }}>
        <h3 style={{ margin: "0 0 8px 0", color: "var(--kr-text-strong)", fontSize: "16px" }}>
          Sincronizar OMIE direto
        </h3>
        <p style={styles.muted}>
          Puxa clientes, produtos e condicoes, alem de enviar transportadoras locais pendentes.
        </p>
        <TextInput
          label="OMIE App Key"
          value={appKey}
          onChange={setAppKey}
          placeholder="Informe o App Key"
        />
        <TextInput
          label="OMIE App Secret"
          value={appSecret}
          onChange={setAppSecret}
          placeholder="Informe o App Secret"
        />
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        {result ? (
          <p style={{ ...styles.muted, color: "#166534", fontWeight: 700 }}>{result}</p>
        ) : null}
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            style={{ ...styles.primaryButton, opacity: syncing ? 0.5 : 1 }}
          >
            {syncing ? "Sincronizando..." : "Iniciar sync"}
          </button>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelOperationDialog({
  operation,
  context,
  onConfirm,
  onCancel
}: {
  operation: WeighingOperationSummary;
  context: "open" | "completed";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isCompleted = context === "completed";
  // Operacao concluida ja foi enviada ao OMIE quando tem pedido criado ou ja foi faturada.
  const hasOmieOrder =
    operation.omieSalesOrderId != null || operation.omieBillingStatus === "billed";
  const title = isCompleted ? "Registrar venda cancelada" : "Cancelar operacao";
  const confirmLabel = isCompleted ? "Confirmar venda cancelada" : "Confirmar cancelamento";

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ margin: "0 0 8px 0", color: "var(--kr-text-strong)", fontSize: "15px" }}>
          {title}
        </h3>
        {isCompleted ? (
          <div
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              borderRadius: "10px",
              padding: "8px 10px",
              fontSize: "12px",
              fontWeight: 700,
              lineHeight: 1.4,
              marginBottom: "8px"
            }}
          >
            {hasOmieOrder
              ? `Esta venda ja foi concluida e enviada ao OMIE${
                  operation.omieSalesOrderId ? ` (Pedido ${operation.omieSalesOrderId})` : ""
                }. Ao confirmar, o cancelamento do pedido sera solicitado no OMIE e os valores desta operacao sairao dos insights e relatorios.`
              : "A operacao sera marcada como cancelada e seus valores sairao dos insights e relatorios."}
          </div>
        ) : null}
        <p style={styles.muted}>Informe o motivo do cancelamento.</p>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <label style={styles.fieldLabel}>
          Motivo
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            rows={4}
            style={{ ...styles.input, resize: "vertical" }}
            placeholder={
              isCompleted
                ? "Ex.: Cliente desistiu da compra antes do faturamento"
                : "Ex.: Cliente desistiu da carga"
            }
          />
        </label>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button
            type="button"
            onClick={() => {
              const trimmed = reason.trim();
              if (!trimmed) {
                setError("Informe o motivo do cancelamento.");
                return;
              }
              onConfirm(trimmed);
            }}
            style={styles.primaryButton}
          >
            {confirmLabel}
          </button>
          <HelpTooltip content={TIPS.operations.cancel} placement="top" />
          <button type="button" onClick={onCancel} style={styles.secondaryButton}>
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}

function FiscalProgressDialog({
  progress,
  onClose
}: {
  progress: FiscalCloseProgress;
  onClose: () => void;
}) {
  const steps: Array<{ key: FiscalCloseStep; label: string }> = [
    { key: "weighing", label: "Saida" },
    { key: "billing", label: "OMIE" },
    { key: "danfe", label: "DANFE" },
    { key: "receipt", label: "Cupom" }
  ];
  const activeIndex = steps.findIndex((step) => step.key === progress.step);

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalContentStyle, maxWidth: "520px", borderRadius: "18px" }}>
        <div style={styles.fiscalProgressHeader}>
          <div>
            <p style={styles.kicker}>Fluxo fiscal</p>
            <h3 style={styles.fiscalProgressTitle}>{progress.title}</h3>
          </div>
          <span style={fiscalProgressBadgeStyle(progress.status)}>
            {progress.status === "running"
              ? "Em andamento"
              : progress.status === "success"
                ? "OK"
                : "Atencao"}
          </span>
        </div>

        <div style={styles.fiscalStepRail}>
          {steps.map((step, index) => {
            const done = progress.status === "success" || index < activeIndex;
            const active = index === activeIndex && progress.status === "running";
            const failed = index === activeIndex && progress.status === "error";
            return (
              <div key={step.key} style={styles.fiscalStepItem}>
                <span style={fiscalStepDotStyle({ done, active, failed })}>
                  {done ? "OK" : failed ? "!" : index + 1}
                </span>
                <span style={styles.fiscalStepLabel}>{step.label}</span>
              </div>
            );
          })}
        </div>

        <div style={styles.fiscalProgressDetailCard}>
          <strong>{progress.detail}</strong>
          {progress.status === "running" ? (
            <span style={styles.fiscalProgressHint}>Aguarde. Nao feche o aplicativo.</span>
          ) : progress.status === "success" ? (
            <span style={styles.fiscalProgressHint}>Saida liberada para o operador.</span>
          ) : (
            <span style={styles.fiscalProgressHint}>
              O job fiscal ficou pendente/falho e pode ser retentado na aba Concluidas.
            </span>
          )}
        </div>

        <div style={styles.modalActions}>
          <button
            type="button"
            onClick={onClose}
            disabled={progress.status === "running"}
            style={{
              ...styles.secondaryButton,
              opacity: progress.status === "running" ? 0.5 : 1,
              cursor: progress.status === "running" ? "not-allowed" : "pointer"
            }}
          >
            Fechar painel
          </button>
        </div>
      </div>
    </div>
  );
}

function FiscalBillingStatus({
  operation,
  retrying,
  onRetry
}: {
  operation: WeighingOperationSummary;
  retrying: boolean;
  onRetry: () => void;
}) {
  const status = getFiscalBillingStatus(operation);

  return (
    <span style={styles.operationCellStack}>
      <span style={fiscalBillingPillStyle(status.tone)}>{status.label}</span>
      <small>{status.detail}</small>
      {status.canRetry ? (
        <IconActionButton
          icon="retry"
          label="Retentar OMIE"
          tip={retrying ? "Retentando..." : TIPS.operations.retryOmie}
          tone="primary"
          placement="left"
          disabled={retrying}
          onClick={onRetry}
        />
      ) : null}
    </span>
  );
}

function PriceDetailsPanel({ details }: { details: PriceDetails | null }) {
  if (!details) {
    return (
      <div
        style={{
          padding: "8px",
          border: "1px dashed var(--kr-input-border)",
          borderRadius: "10px",
          background: "var(--kr-surface-soft)"
        }}
      >
        <div style={{ fontSize: "12px", color: "var(--kr-muted)" }}>
          Selecione cliente e produto para ver o preco.
        </div>
      </div>
    );
  }

  const sourceLabel =
    details.source === "special"
      ? "Preco especial do cliente"
      : details.source === "default"
        ? "Preco padrao da empresa"
        : "Sem preco cadastrado";
  const savingsLabel = details.savingsPercent
    ? `${details.savingsPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
    : "Sem desconto";

  return (
    <div
      style={{
        padding: "8px",
        border: "1px solid var(--kr-border)",
        borderRadius: "10px",
        background: "var(--kr-surface-soft)"
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--kr-text-strong)" }}>
        {details.appliedUnitPriceCents !== null
          ? `${formatMoney(details.appliedUnitPriceCents)}/ton`
          : "Preco nao definido"}
      </div>
      <div style={{ fontSize: "12px", color: "var(--kr-muted)", marginTop: "2px" }}>
        Origem: {sourceLabel}
      </div>
      <div style={{ fontSize: "12px", color: "var(--kr-muted)" }}>
        Base padrao: {formatMoney(details.baseUnitPriceCents)}/ton
      </div>
      <div style={{ fontSize: "12px", color: "var(--kr-muted)" }}>Economia: {savingsLabel}</div>
    </div>
  );
}

function PriceInput({
  valueCents,
  onChange,
  label = "Preco por tonelada",
  suffix = "/ton",
  compact = false
}: {
  valueCents: number | null;
  onChange: (cents: number | null) => void;
  label?: string;
  suffix?: string;
  compact?: boolean;
}) {
  const centsToBRL = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  return (
    <div>
      <MoneyCentsInput
        label={label}
        valueCents={valueCents}
        onChange={onChange}
        allowZero
        hint={
          compact
            ? undefined
            : `Use virgula para centavos. Ex: 125,50${suffix ? ` (${suffix})` : ""}`
        }
      />
      {!compact && valueCents !== null ? (
        <span style={{ fontSize: "12px", color: "#64748b", marginTop: "2px", display: "block" }}>
          {centsToBRL(valueCents)}
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

/** Rotulo humano da acao de um item da fila OMIE (tela cloud). */
export function omieQueueActionLabel(action: string, operationType: string | null): string {
  switch (action) {
    case "create_order":
      return operationType === "internal" ? "Criar OS (interno)" : "Criar pedido (com nota)";
    case "create_and_bill_order":
      return "Criar e faturar pedido";
    case "cancel_order":
      return "Cancelar pedido no OMIE";
    default:
      return action;
  }
}

/** Rotulo humano do status de um item da fila OMIE (tela cloud). */
export function omieQueueStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "aguardando envio";
    case "failed":
      return "falhou (re-tenta sozinho)";
    case "dead_letter":
      return "parado apos varias falhas";
    default:
      return status;
  }
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "R$ 0,00";
  }

  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function formatWeightKg(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kg`;
}

// Tempo decorrido desde a entrada do caminhao (ex.: "ha 12 min", "ha 2 h 05 min").
export function formatElapsedSince(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "-";
  const then = parseDbTimestamp(iso);
  if (Number.isNaN(then.getTime())) return "-";
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "agora mesmo";
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) return "agora mesmo";
  if (totalMinutes < 60) return `ha ${totalMinutes} min`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return `ha ${totalHours} h ${String(minutes).padStart(2, "0")} min`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `ha ${days} d ${hours} h`;
}

function filterCanceledOperations(
  operations: WeighingOperationSummary[],
  filter: CanceledFilter,
  now = new Date()
): WeighingOperationSummary[] {
  if (filter === "all") return operations;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (filter === "week") {
    start.setDate(start.getDate() - 6);
  }
  if (filter === "month") {
    start.setDate(1);
  }

  return operations.filter((operation) => parseDbTimestamp(operation.updatedAt) >= start);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada.";
}

function subTabStyle(active: boolean) {
  return {
    border: "none",
    borderBottom: active ? "2px solid var(--kr-accent)" : "2px solid transparent",
    borderRadius: "0",
    padding: "8px 16px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0,
    background: "transparent",
    color: active ? "var(--kr-text-strong)" : "var(--kr-muted)",
    cursor: "pointer",
    fontWeight: active ? 700 : 500,
    fontSize: "12px"
  };
}

function operationsTabStyle(active: boolean): React.CSSProperties {
  return {
    border: "1px solid var(--kr-border)",
    borderRadius: "999px",
    padding: "7px 14px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0,
    background: active ? "var(--kr-primary-strong)" : "var(--kr-surface)",
    color: active ? "var(--kr-primary-text)" : "var(--kr-text-strong)",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "12px"
  };
}

function fiscalProgressBadgeStyle(status: FiscalCloseProgress["status"]): React.CSSProperties {
  const tone =
    status === "success"
      ? { background: "var(--kr-success-soft)", color: "var(--kr-success)" }
      : status === "error"
        ? { background: "var(--kr-danger-soft)", color: "var(--kr-danger)" }
        : { background: "var(--kr-info-bg)", color: "var(--kr-info-text)" };
  return {
    ...tone,
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 900
  };
}

function fiscalStepDotStyle(input: {
  done: boolean;
  active: boolean;
  failed: boolean;
}): React.CSSProperties {
  const tone = input.failed
    ? { background: "var(--kr-danger-strong)", color: "#ffffff", borderColor: "var(--kr-danger-strong)" }
    : input.done
      ? { background: "#16a34a", color: "#ffffff", borderColor: "#16a34a" }
      : input.active
        ? {
            background: "var(--kr-primary-strong)",
            color: "var(--kr-primary-text)",
            borderColor: "var(--kr-primary-strong)"
          }
        : {
            background: "var(--kr-surface)",
            color: "var(--kr-muted)",
            borderColor: "var(--kr-border)"
          };
  return {
    ...tone,
    width: "34px",
    height: "34px",
    border: "1px solid",
    borderRadius: "999px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: 900
  };
}

function getFiscalBillingStatus(operation: WeighingOperationSummary): {
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "neutral";
  canRetry: boolean;
} {
  if (operation.operationType !== "invoice") {
    return {
      label: "Interna",
      detail: "Sem nota fiscal de venda.",
      tone: "neutral",
      canRetry: false
    };
  }

  if (operation.omieBillingStatus === "billed") {
    return {
      label: "Faturada",
      detail: operation.omieSalesOrderId
        ? `Pedido OMIE ${operation.omieSalesOrderId}`
        : operation.omieDocumentUrl
          ? "DANFE disponivel."
          : "Pedido faturado no OMIE.",
      tone: "success",
      canRetry: false
    };
  }

  // Pedido ja criado no OMIE: o faturamento (NF-e) e feito no proprio OMIE (coluna
  // "Faturar"). O app nao fatura — nao ha "retry" de faturamento aqui.
  if (operation.omieSalesOrderId) {
    return {
      label: "Enviada ao OMIE",
      detail: `Pedido OMIE ${operation.omieSalesOrderId} — fature na coluna "Faturar" do OMIE.`,
      tone: "success",
      canRetry: false
    };
  }

  // Operacoes antigas (fluxo anterior) que ficaram bloqueadas por cadastro/erro:
  // mantem a recuperacao manual pelo botao.
  if (operation.omieBillingStatus === "cadastro_incompleto") {
    return {
      label: "Cadastro incompleto",
      detail:
        operation.omieBillingMessage ??
        "Falta Numero do Endereco e E-mail do cliente para emitir a NF-e.",
      tone: "warning",
      canRetry: true
    };
  }

  if (operation.omieBillingStatus === "failed") {
    return {
      label: "Falhou",
      detail: operation.omieBillingMessage ?? "Envio do pedido nao confirmado.",
      tone: "danger",
      canRetry: true
    };
  }

  return {
    label: "Enviando ao OMIE",
    detail: "Pedido sera enviado ao OMIE na proxima sincronizacao.",
    tone: "neutral",
    canRetry: false
  };
}

function fiscalBillingPillStyle(
  tone: "success" | "warning" | "danger" | "neutral"
): React.CSSProperties {
  const colors =
    tone === "success"
      ? { background: "#dcfce7", color: "#166534", borderColor: "#bbf7d0" }
      : tone === "danger"
        ? { background: "#fee2e2", color: "#991b1b", borderColor: "#fecaca" }
        : tone === "warning"
          ? { background: "#fef3c7", color: "#92400e", borderColor: "#fde68a" }
          : {
              background: "var(--kr-surface-soft)",
              color: "var(--kr-muted)",
              borderColor: "var(--kr-border)"
            };

  return {
    ...colors,
    display: "inline-flex",
    width: "fit-content",
    alignItems: "center",
    border: "1px solid",
    borderRadius: "999px",
    padding: "4px 8px",
    fontSize: "11px",
    fontWeight: 900
  };
}

// Identidade visual KyberRock: grafite (logo) + ambar (sinalizacao de patio/mineracao)
// sobre neutros da familia "stone". Tokens semanticos (success/danger/warning/accent)
// permitem que os dois temas compartilhem os mesmos estilos de componente.
function getThemeVariables(themeMode: ThemeMode): React.CSSProperties {
  if (themeMode === "dark") {
    return {
      "--kr-bg": "#0c0a09",
      "--kr-surface": "#171412",
      "--kr-surface-soft": "#1c1917",
      "--kr-surface-elevated": "#221e1b",
      "--kr-border": "#2e2925",
      "--kr-text": "#e7e5e4",
      "--kr-text-strong": "#fafaf9",
      "--kr-muted": "#a8a29e",
      "--kr-input-bg": "#0c0a09",
      "--kr-input-border": "#44403c",
      "--kr-input-disabled-bg": "#1c1917",
      "--kr-input-disabled-text": "#78716c",
      "--kr-primary": "#fbbf24",
      "--kr-primary-strong": "#f59e0b",
      "--kr-primary-text": "#1c1206",
      "--kr-accent": "#fbbf24",
      "--kr-accent-soft": "#451a03",
      "--kr-accent-border": "#92400e",
      "--kr-focus-ring": "rgba(251, 191, 36, 0.5)",
      "--kr-selection-bg": "#b45309",
      "--kr-selection-text": "#fffbeb",
      "--kr-scroll-track": "#0c0a09",
      "--kr-scroll-thumb": "#44403c",
      "--kr-shadow": "0 1px 2px rgba(0,0,0,0.4), 0 10px 30px rgba(0,0,0,0.45)",
      "--kr-card-bg": "#171412",
      "--kr-card-border": "#2e2925",
      "--kr-card-hover": "#221e1b",
      "--kr-success": "#4ade80",
      "--kr-success-soft": "#052e16",
      "--kr-success-border": "#166534",
      "--kr-danger": "#f87171",
      "--kr-danger-strong": "#dc2626",
      "--kr-danger-soft": "#450a0a",
      "--kr-danger-border": "#991b1b",
      "--kr-warning": "#fbbf24",
      "--kr-warning-soft": "#451a03",
      "--kr-warning-border": "#92400e",
      "--kr-chart-1": "#fbbf24",
      "--kr-chart-2": "#2dd4bf",
      "--kr-chart-3": "#a8a29e",
      "--kr-chart-4": "#f87171",
      "--kr-chart-5": "#4ade80",
      "--kr-chart-6": "#a78bfa",
      "--kr-chart-7": "#f472b6",
      "--kr-chart-axis": "#78716c",
      "--kr-chart-grid": "#2e2925",
      "--kr-chart-tooltip-bg": "#1c1917",
      "--kr-chart-tooltip-border": "#44403c",
      "--kr-chart-tooltip-text": "#e7e5e4",
      "--kr-info-bg": "#451a03",
      "--kr-info-border": "#92400e",
      "--kr-info-text": "#fde68a",
      "--kr-tooltip-bg": "#292524",
      "--kr-tooltip-text": "#fafaf9",
      "--kr-tooltip-border": "#57534e",
      "--kr-tooltip-kbd-bg": "#1c1917",
      "--kr-tooltip-kbd-border": "#57534e",
      "--kr-tooltip-shortcut": "#d6d3d1"
    } as React.CSSProperties;
  }

  return {
    "--kr-bg": "#f5f5f4",
    "--kr-surface": "#ffffff",
    "--kr-surface-soft": "#fafaf9",
    "--kr-surface-elevated": "#ffffff",
    "--kr-border": "#e7e5e4",
    "--kr-text": "#292524",
    "--kr-text-strong": "#1c1917",
    "--kr-muted": "#78716c",
    "--kr-input-bg": "#ffffff",
    "--kr-input-border": "#d6d3d1",
    "--kr-input-disabled-bg": "#f5f5f4",
    "--kr-input-disabled-text": "#78716c",
    "--kr-primary": "#292524",
    "--kr-primary-strong": "#1c1917",
    "--kr-primary-text": "#fafaf9",
    "--kr-accent": "#d97706",
    "--kr-accent-soft": "#fef3c7",
    "--kr-accent-border": "#fcd34d",
    "--kr-focus-ring": "rgba(217, 119, 6, 0.4)",
    "--kr-selection-bg": "#fde68a",
    "--kr-selection-text": "#1c1917",
    "--kr-scroll-track": "#f5f5f4",
    "--kr-scroll-thumb": "#d6d3d1",
    "--kr-shadow": "0 1px 2px rgba(28, 25, 23, 0.05), 0 8px 24px rgba(28, 25, 23, 0.06)",
    "--kr-card-bg": "#ffffff",
    "--kr-card-border": "#e7e5e4",
    "--kr-card-hover": "#fafaf9",
    "--kr-success": "#15803d",
    "--kr-success-soft": "#f0fdf4",
    "--kr-success-border": "#bbf7d0",
    "--kr-danger": "#b91c1c",
    "--kr-danger-strong": "#dc2626",
    "--kr-danger-soft": "#fef2f2",
    "--kr-danger-border": "#fecaca",
    "--kr-warning": "#b45309",
    "--kr-warning-soft": "#fffbeb",
    "--kr-warning-border": "#fde68a",
    "--kr-chart-1": "#d97706",
    "--kr-chart-2": "#0d9488",
    "--kr-chart-3": "#57534e",
    "--kr-chart-4": "#dc2626",
    "--kr-chart-5": "#16a34a",
    "--kr-chart-6": "#7c3aed",
    "--kr-chart-7": "#db2777",
    "--kr-chart-axis": "#78716c",
    "--kr-chart-grid": "#e7e5e4",
    "--kr-chart-tooltip-bg": "#ffffff",
    "--kr-chart-tooltip-border": "#e7e5e4",
    "--kr-chart-tooltip-text": "#292524",
    "--kr-info-bg": "#fef3c7",
    "--kr-info-border": "#fde68a",
    "--kr-info-text": "#92400e",
    "--kr-tooltip-bg": "#1c1917",
    "--kr-tooltip-text": "#fafaf9",
    "--kr-tooltip-border": "#44403c",
    "--kr-tooltip-kbd-bg": "#292524",
    "--kr-tooltip-kbd-border": "#57534e",
    "--kr-tooltip-shortcut": "#d6d3d1"
  } as React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Cadastro de transporte - CRUD unificado (motoristas, transportadoras, placas)
// Um unico componente/modal reaproveitado pelas tres abas: nao duplica o
// scaffolding de estado, formulario, tabela nem a confirmacao de exclusao.
// ---------------------------------------------------------------------------

type CrudFieldType = "text" | "document" | "phone" | "plate" | "checkbox" | "select";

interface CrudSelectOption {
  value: string;
  label: string;
}

/** Contexto entregue aos pontos de extensao do formulario generico. */
interface CrudFieldContext {
  formData: Record<string, string>;
  setFieldValue: (key: string, value: string) => void;
  setFormError: (message: string | null) => void;
}

interface CrudField {
  key: string;
  label: string;
  required?: boolean;
  type?: CrudFieldType;
  helper?: string;
  section?: string;
  options?: CrudSelectOption[];
  emptyOption?: string;
  uppercaseMax?: number;
  /** Conteudo renderizado ao lado do campo (ex.: botao de busca automatica de CNPJ). */
  trailing?: (ctx: CrudFieldContext) => React.ReactNode;
}

type CrudPayloadResult = { error: string } | { value: Record<string, unknown> };

interface ResourceCrudProps {
  desktopApi: KyberRockDesktopApi;
  entityType: "vehicle" | "driver" | "carrier" | "account";
  singular: string;
  gender: "m" | "f";
  title: string;
  description?: string;
  searchPlaceholder: string;
  emptyHint?: string;
  modalMaxWidth?: number;
  minWidth?: string;
  fields: CrudField[];
  columns: Array<DataTableColumn<Record<string, unknown>>>;
  rowToForm: (item: Record<string, unknown>) => Record<string, string>;
  enrichForm?: (item: Record<string, unknown>) => Promise<Record<string, string>>;
  buildPayload: (form: Record<string, string>, editing: boolean) => CrudPayloadResult;
  create: (payload: Record<string, unknown>) => Promise<void>;
  update: (id: string, payload: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  deleteDescription: string;
  expandedRow?: (item: Record<string, unknown>) => React.ReactNode;
  onChanged?: () => void;
  /** Barra extra entre o cabecalho e a busca (ex.: acoes em lote da lista). */
  toolbar?: (ctx: {
    reload: () => Promise<void>;
    showFlash: (kind: FlashKind, text: string) => void;
  }) => React.ReactNode;
}

const CRUD_DEFAULT_SECTION = "Dados principais";

async function reconcileDriverCarrier(
  desktopApi: KyberRockDesktopApi,
  driverId: string,
  carrierId: string
): Promise<void> {
  const current = await desktopApi.listCarriersByDriver(driverId);
  const currentIds = current.map((carrier) => carrier.id);
  const targetIds = carrierId ? [carrierId] : [];
  for (const id of currentIds) {
    if (!targetIds.includes(id)) await desktopApi.unlinkDriverCarrier(driverId, id);
  }
  for (const id of targetIds) {
    if (!currentIds.includes(id)) await desktopApi.linkDriverCarrier(driverId, id);
  }
}

function driverDetails(item: Record<string, unknown>): string {
  const parts: string[] = [];
  if (item.document) parts.push(`CPF: ${String(item.document)}`);
  if (item.phone) parts.push(String(item.phone));
  return parts.join(" | ");
}

function ResourceCrud({
  desktopApi,
  entityType,
  singular,
  gender,
  title,
  description,
  searchPlaceholder,
  emptyHint,
  modalMaxWidth,
  minWidth,
  fields,
  columns,
  rowToForm,
  enrichForm,
  buildPayload,
  create,
  update,
  remove,
  deleteDescription,
  expandedRow,
  onChanged,
  toolbar
}: ResourceCrudProps) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [flash, showFlash] = useFlash();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const article = gender === "f" ? "a" : "o";
  const newLabel = gender === "f" ? "Nova" : "Novo";
  const lower = singular.toLowerCase();

  const loadItems = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await desktopApi.queryCache({
        entityType,
        search: search || undefined,
        limit: 200
      });
      setItems(result.rows as Array<Record<string, unknown>>);
    } finally {
      setLoading(false);
    }
  }, [desktopApi, entityType, search]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const emptyForm = useCallback((): Record<string, string> => {
    const init: Record<string, string> = {};
    for (const field of fields) init[field.key] = field.type === "checkbox" ? "false" : "";
    return init;
  }, [fields]);

  function openCreate(): void {
    setFormData(emptyForm());
    setEditingId(null);
    setFormError(null);
    setShowForm(true);
  }

  async function openEdit(item: Record<string, unknown>): Promise<void> {
    setFormData({ ...emptyForm(), ...rowToForm(item) });
    setEditingId(String(item.id));
    setFormError(null);
    setShowForm(true);
    if (enrichForm) {
      try {
        const extra = await enrichForm(item);
        setFormData((prev) => ({ ...prev, ...extra }));
      } catch {
        // mantem o formulario base se o enriquecimento assincrono falhar
      }
    }
  }

  async function handleSave(): Promise<void> {
    const result = buildPayload(formData, editingId !== null);
    if ("error" in result) {
      setFormError(result.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await update(editingId, result.value);
      } else {
        await create(result.value);
      }
      setShowForm(false);
      setEditingId(null);
      await loadItems();
      onChanged?.();
      showFlash(
        "success",
        editingId ? `${singular} atualizad${article}.` : `${singular} criad${article}.`
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDeleteId) return;
    setDeleting(true);
    try {
      await remove(pendingDeleteId);
      setPendingDeleteId(null);
      await loadItems();
      onChanged?.();
      showFlash("success", `${singular} excluid${article}.`);
    } catch (err) {
      setPendingDeleteId(null);
      showFlash("error", err instanceof Error ? err.message : "Erro ao excluir.");
    } finally {
      setDeleting(false);
    }
  }

  const sections = useMemo(() => {
    const order: string[] = [];
    const grouped = new Map<string, CrudField[]>();
    for (const field of fields) {
      const section = field.section ?? CRUD_DEFAULT_SECTION;
      if (!grouped.has(section)) {
        grouped.set(section, []);
        order.push(section);
      }
      grouped.get(section)?.push(field);
    }
    return order.map((name) => ({ name, fields: grouped.get(name) ?? [] }));
  }, [fields]);

  function setFieldValue(key: string, value: string): void {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function renderField(field: CrudField): React.ReactNode {
    const value = formData[field.key] ?? "";
    if (field.type === "checkbox") {
      return (
        <label key={field.key} style={{ ...styles.checkboxLabel, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(event) => setFieldValue(field.key, event.target.checked ? "true" : "false")}
          />
          <span>
            {field.label}
            {field.helper ? (
              <small style={{ ...styles.helperText, display: "block", marginTop: "2px" }}>
                {field.helper}
              </small>
            ) : null}
          </span>
        </label>
      );
    }
    if (field.type === "select") {
      return (
        <Field key={field.key} label={field.label} required={field.required} hint={field.helper}>
          <select
            value={value}
            onChange={(event) => setFieldValue(field.key, event.target.value)}
            style={getInputStyle(false)}
          >
            <option value="">{field.emptyOption ?? "Selecione..."}</option>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      );
    }
    if (field.type === "document") {
      const input = (
        <DocumentInput
          label={field.label}
          value={value}
          required={field.required}
          onChange={(v) => setFieldValue(field.key, v)}
        />
      );
      if (field.trailing) {
        return (
          <div key={field.key} style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
            <div style={{ flex: 1 }}>{input}</div>
            {field.trailing({ formData, setFieldValue, setFormError })}
          </div>
        );
      }
      return <Fragment key={field.key}>{input}</Fragment>;
    }
    if (field.type === "phone") {
      return (
        <PhoneInput
          key={field.key}
          label={field.label}
          value={value}
          required={field.required}
          onChange={(v) => setFieldValue(field.key, v)}
        />
      );
    }
    if (field.type === "plate") {
      return (
        <PlateInput
          key={field.key}
          label={field.label}
          value={value}
          required={field.required}
          onChange={(v) => setFieldValue(field.key, v)}
        />
      );
    }
    return (
      <TextInput
        key={field.key}
        label={field.label}
        value={value}
        required={field.required}
        onChange={(v) =>
          setFieldValue(
            field.key,
            field.uppercaseMax ? v.toUpperCase().slice(0, field.uppercaseMax) : v
          )
        }
      />
    );
  }

  return (
    <div>
      <CrudSectionHeader
        title={title}
        description={description}
        count={items.length}
        actionLabel={`${newLabel} ${lower}`}
        onAction={openCreate}
      />
      {toolbar ? toolbar({ reload: loadItems, showFlash }) : null}
      <CrudSearchBar
        value={search}
        onChange={setSearch}
        placeholder={searchPlaceholder}
        onRefresh={() => void loadItems()}
      />
      <FlashBanner flash={flash} />

      {showForm ? (
        <CrudFormShell
          title={editingId ? `Editar ${lower}` : `${newLabel} ${lower}`}
          error={formError}
          saving={saving}
          maxWidth={modalMaxWidth}
          onClose={() => setShowForm(false)}
          onSubmit={() => void handleSave()}
        >
          {sections.map((section) => (
            <FormSection key={section.name} title={section.name}>
              {section.fields.map((field) => renderField(field))}
            </FormSection>
          ))}
        </CrudFormShell>
      ) : null}

      {pendingDeleteId ? (
        <ConfirmDialog
          title={`Excluir ${lower}`}
          description={deleteDescription}
          busy={deleting}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}

      <DataTable
        columns={[
          ...columns,
          {
            key: "actions",
            header: "Acoes",
            width: "170px",
            align: "right",
            render: (item: Record<string, unknown>) => (
              <>
                <EditRowButton onClick={() => void openEdit(item)} />
                <DeleteRowButton onClick={() => setPendingDeleteId(String(item.id))} />
              </>
            )
          }
        ]}
        rows={items}
        rowKey={(item) => String(item.id)}
        loading={loading}
        minWidth={minWidth}
        emptyTitle={
          search ? "Nenhum registro encontrado." : `Nenhum${article} ${lower} cadastrad${article}.`
        }
        emptyHint={search ? "Ajuste o termo de busca." : emptyHint}
        expandedRow={expandedRow}
      />
    </div>
  );
}

function DriverCrud({
  desktopApi,
  carrierOptions
}: {
  desktopApi: KyberRockDesktopApi;
  carrierOptions: CrudSelectOption[];
}) {
  const fields: CrudField[] = [
    { key: "name", label: "Nome", required: true },
    { key: "document", label: "CPF", type: "document" },
    { key: "phone", label: "Telefone", type: "phone" },
    {
      key: "carrierId",
      label: "Transportadora",
      type: "select",
      options: carrierOptions,
      emptyOption: "Sem transportadora",
      helper: "Vincule o motorista a uma transportadora para agilizar a nova entrada."
    }
  ];

  const columns: Array<DataTableColumn<Record<string, unknown>>> = [
    {
      key: "name",
      header: "Nome",
      width: "minmax(220px, 1.3fr)",
      render: (item) => <CellPrimary>{String(item.name ?? item.document ?? item.id ?? "")}</CellPrimary>
    },
    {
      key: "details",
      header: "Detalhes",
      width: "minmax(260px, 1.5fr)",
      render: (item) => <CellMuted>{driverDetails(item) || "-"}</CellMuted>
    }
  ];

  return (
    <ResourceCrud
      desktopApi={desktopApi}
      entityType="driver"
      singular="Motorista"
      gender="m"
      title="Motoristas"
      description="Motoristas usados na identificacao do caminhao e impressos no cupom."
      searchPlaceholder="Buscar motoristas..."
      emptyHint={'Cadastre pelo botao "Novo motorista".'}
      fields={fields}
      columns={columns}
      rowToForm={(item) => ({
        name: String(item.name ?? ""),
        document: String(item.document ?? ""),
        phone: String(item.phone ?? ""),
        carrierId: ""
      })}
      enrichForm={async (item) => {
        const linked = await desktopApi.listCarriersByDriver(String(item.id));
        return { carrierId: linked.length > 0 ? linked[0].id : "" };
      }}
      buildPayload={(form) => {
        if (!form.name.trim()) return { error: "Campo obrigatorio: Nome" };
        let document = "";
        if (form.document.trim()) {
          const normalized = normalizeDocument(form.document);
          if (!isValidDocument(normalized)) return { error: "CPF invalido." };
          document = normalized;
        }
        let phone = "";
        if (form.phone.trim()) {
          const normalized = normalizePhone(form.phone);
          if (normalized.length !== 10 && normalized.length !== 11) {
            return { error: "Telefone invalido. Informe com DDD (11 digitos)." };
          }
          phone = normalized;
        }
        return {
          value: {
            name: form.name.trim(),
            document,
            phone,
            carrierId: form.carrierId
          }
        };
      }}
      create={async (payload) => {
        const created = await desktopApi.driversCreate({
          name: payload.name as string,
          document: (payload.document as string) || undefined,
          phone: (payload.phone as string) || undefined
        });
        const id = (created as { id?: string } | null)?.id;
        if (id) {
          await reconcileDriverCarrier(desktopApi, id, payload.carrierId as string);
        }
      }}
      update={async (id, payload) => {
        await desktopApi.driversUpdate(id, {
          name: payload.name as string,
          document: (payload.document as string) || undefined,
          phone: (payload.phone as string) || undefined
        });
        await reconcileDriverCarrier(desktopApi, id, payload.carrierId as string);
      }}
      remove={(id) => desktopApi.driversDelete(id)}
      deleteDescription="O registro sera removido dos cadastros. Operacoes ja registradas nao sao afetadas."
    />
  );
}

/**
 * Botao "Busca de dados automatica": consulta o CNPJ digitado na Receita e
 * preenche os campos do formulario generico (usado no cadastro de transportadora,
 * espelhando o botao equivalente do cadastro de cliente).
 */
function CarrierCnpjAutoFillButton({
  desktopApi,
  ctx
}: {
  desktopApi: KyberRockDesktopApi;
  ctx: CrudFieldContext;
}) {
  const [busy, setBusy] = useState(false);

  async function handleLookup(): Promise<void> {
    const digits = (ctx.formData.document ?? "").replace(/\D/g, "");
    if (digits.length !== 14) {
      ctx.setFormError("Informe um CNPJ com 14 digitos para buscar.");
      return;
    }
    setBusy(true);
    ctx.setFormError(null);
    try {
      const data = await desktopApi.lookupCnpj(digits);
      if (!data.found) {
        ctx.setFormError("CNPJ nao encontrado na base da Receita.");
        return;
      }
      // So sobrescreve os campos que a Receita retornou preenchidos.
      if (data.legalName) ctx.setFieldValue("name", data.legalName);
      if (data.phone) ctx.setFieldValue("phone", data.phone);
      if (data.email) ctx.setFieldValue("email", data.email);
      if (data.zipcode) ctx.setFieldValue("zipcode", data.zipcode);
      if (data.addressStreet) ctx.setFieldValue("addressStreet", data.addressStreet);
      if (data.addressNumber) ctx.setFieldValue("addressNumber", data.addressNumber);
      if (data.addressComplement) ctx.setFieldValue("addressComplement", data.addressComplement);
      if (data.neighborhood) ctx.setFieldValue("neighborhood", data.neighborhood);
      if (data.city) ctx.setFieldValue("city", data.city);
      if (data.state) ctx.setFieldValue("state", data.state.toUpperCase().slice(0, 2));
    } catch (err) {
      ctx.setFormError(err instanceof Error ? err.message : "Falha ao buscar o CNPJ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tooltip content="Buscar os dados pelo CNPJ (Receita) e preencher o cadastro">
      <button
        type="button"
        onClick={() => void handleLookup()}
        disabled={busy}
        aria-label="Buscar os dados pelo CNPJ"
        style={{
          ...styles.secondaryButton,
          height: "38px",
          width: "38px",
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: busy ? 0.6 : 1
        }}
      >
        <Search size={16} />
      </button>
    </Tooltip>
  );
}

/** Botao de busca automatica em lote (todas as transportadoras com CNPJ valido). */
function CarrierBulkCnpjToolbar({
  desktopApi,
  reload,
  showFlash
}: {
  desktopApi: KyberRockDesktopApi;
  reload: () => Promise<void>;
  showFlash: (kind: FlashKind, text: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleEnrichAll(): Promise<void> {
    if (busy) return;
    const confirmed = window.confirm(
      "Buscar o CNPJ de todas as transportadoras na Receita e atualizar o cadastro (razao " +
        "social, endereco, telefone)?\n\nPode levar alguns minutos se houver muitas transportadoras."
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await desktopApi.enrichAllCarriersFromCnpj();
      await reload();
      const extras: string[] = [];
      if (result.notFound > 0) extras.push(`${result.notFound} nao encontrada(s) na Receita`);
      if (result.failed > 0) extras.push(`${result.failed} com falha`);
      const suffix = extras.length ? ` (${extras.join(", ")})` : "";
      showFlash(
        "success",
        `Busca automatica concluida: ${result.updated} de ${result.withCnpj} transportadora(s) ` +
          `com CNPJ atualizada(s)${suffix}. Cadastros atualizados serao enviados ao OMIE no proximo sync.`
      );
    } catch (err) {
      showFlash(
        "error",
        err instanceof Error ? err.message : "Falha ao buscar o CNPJ das transportadoras."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "10px",
        padding: "12px 14px",
        marginBottom: "12px",
        border: "1px solid var(--kr-border)",
        borderRadius: "12px",
        background: "var(--kr-surface-soft)"
      }}
    >
      <button
        type="button"
        onClick={() => void handleEnrichAll()}
        disabled={busy}
        title="Busca o CNPJ de TODAS as transportadoras na Receita e atualiza o cadastro (razao social, endereco, telefone)"
        style={{
          ...styles.secondaryButton,
          height: "38px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          opacity: busy ? 0.6 : 1
        }}
      >
        <Search size={14} />
        {busy ? "Buscando dados..." : "Busca de dados automatica (todas)"}
      </button>
      <span style={{ fontSize: "12px", color: "var(--kr-muted)" }}>
        Preenche razao social, endereco e telefone pela Receita para todas as transportadoras com
        CNPJ.
      </span>
    </div>
  );
}

function CarrierCrud({
  desktopApi,
  onChanged
}: {
  desktopApi: KyberRockDesktopApi;
  onChanged: () => void;
}) {
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);
  const [carrierVehicles, setCarrierVehicles] = useState<
    Array<{ id: string; plate: string; description: string | null }>
  >([]);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      if (!selectedCarrier) {
        setCarrierVehicles([]);
        return;
      }
      try {
        const vehicles = await desktopApi.carriersGetVehicles(selectedCarrier);
        if (active) setCarrierVehicles(vehicles);
      } catch {
        if (active) setCarrierVehicles([]);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [desktopApi, selectedCarrier]);

  const fields: CrudField[] = [
    { key: "name", label: "Nome", required: true, section: "Identificacao" },
    {
      key: "document",
      label: "CNPJ/CPF",
      type: "document",
      section: "Identificacao",
      trailing: (ctx) => <CarrierCnpjAutoFillButton desktopApi={desktopApi} ctx={ctx} />
    },
    { key: "phone", label: "Telefone", section: "Contato" },
    { key: "email", label: "Email", section: "Contato" },
    { key: "zipcode", label: "CEP", section: "Endereco" },
    { key: "addressStreet", label: "Endereco", section: "Endereco" },
    { key: "addressNumber", label: "Numero", section: "Endereco" },
    { key: "addressComplement", label: "Complemento", section: "Endereco" },
    { key: "neighborhood", label: "Bairro", section: "Endereco" },
    { key: "city", label: "Cidade", section: "Endereco" },
    { key: "state", label: "UF", uppercaseMax: 2, section: "Endereco" }
  ];

  const columns: Array<DataTableColumn<Record<string, unknown>>> = [
    {
      key: "name",
      header: "Transportadora",
      width: "minmax(220px, 1.3fr)",
      render: (item) => {
        const id = String(item.id);
        return (
          <button
            type="button"
            onClick={() => setSelectedCarrier(id === selectedCarrier ? null : id)}
            title="Ver veiculos vinculados"
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
              color: "inherit",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              width: "100%",
              minWidth: 0,
              overflow: "hidden"
            }}
          >
            <CellPrimary>{String(item.name ?? "")}</CellPrimary>
            <CellMuted>
              {selectedCarrier === id ? "Ocultar veiculos" : "Ver veiculos vinculados"}
            </CellMuted>
          </button>
        );
      }
    },
    {
      key: "document",
      header: "Documento",
      width: "140px",
      render: (item) => <CellMuted>{String(item.document ?? "") || "-"}</CellMuted>
    },
    {
      key: "contact",
      header: "Contato",
      width: "minmax(170px, 1fr)",
      render: (item) => (
        <>
          <CellText>{String(item.phone ?? "") || "-"}</CellText>
          <CellMuted>{String(item.email ?? "") || "-"}</CellMuted>
        </>
      )
    },
    {
      key: "city",
      header: "Cidade/UF",
      width: "minmax(130px, 0.8fr)",
      render: (item) => (
        <CellText>
          {[item.city, item.state].filter(Boolean).join("/") || "-"}
        </CellText>
      )
    },
    {
      key: "source",
      header: "Origem",
      width: "90px",
      render: (item) => <SourceBadge source={String(item.source ?? "local")} />
    }
  ];

  return (
    <ResourceCrud
      desktopApi={desktopApi}
      entityType="carrier"
      singular="Transportadora"
      gender="f"
      title="Transportadoras"
      description="Sincronizadas do OMIE pela tag 'transportadora' ou criadas localmente. Clique no nome para ver os veiculos vinculados."
      searchPlaceholder="Buscar por nome, documento ou cidade..."
      emptyHint={'Sincronize o OMIE na tela Cloud ou cadastre pelo botao "Nova transportadora".'}
      modalMaxWidth={980}
      minWidth="920px"
      toolbar={({ reload, showFlash }) => (
        <CarrierBulkCnpjToolbar desktopApi={desktopApi} reload={reload} showFlash={showFlash} />
      )}
      fields={fields}
      columns={columns}
      rowToForm={(item) => ({
        name: String(item.name ?? ""),
        document: String(item.document ?? ""),
        phone: String(item.phone ?? ""),
        email: String(item.email ?? ""),
        zipcode: String(item.zipcode ?? ""),
        addressStreet: String(item.addressStreet ?? ""),
        addressNumber: String(item.addressNumber ?? ""),
        addressComplement: String(item.addressComplement ?? ""),
        neighborhood: String(item.neighborhood ?? ""),
        city: String(item.city ?? ""),
        state: String(item.state ?? "")
      })}
      buildPayload={(form) => {
        if (!form.name.trim()) return { error: "Nome e obrigatorio." };
        let document = "";
        if (form.document.trim()) {
          const normalized = normalizeDocument(form.document);
          if (!isValidDocument(normalized)) return { error: "CPF/CNPJ invalido." };
          document = normalized;
        }
        return {
          value: {
            name: form.name.trim(),
            document,
            phone: form.phone.trim(),
            email: form.email.trim(),
            zipcode: form.zipcode.trim(),
            addressStreet: form.addressStreet.trim(),
            addressNumber: form.addressNumber.trim(),
            addressComplement: form.addressComplement.trim(),
            neighborhood: form.neighborhood.trim(),
            city: form.city.trim(),
            state: form.state.trim()
          }
        };
      }}
      create={(payload) =>
        desktopApi
          .carriersCreate({
            name: payload.name as string,
            document: (payload.document as string) || undefined,
            phone: (payload.phone as string) || undefined,
            email: (payload.email as string) || undefined,
            zipcode: (payload.zipcode as string) || undefined,
            addressStreet: (payload.addressStreet as string) || undefined,
            addressNumber: (payload.addressNumber as string) || undefined,
            addressComplement: (payload.addressComplement as string) || undefined,
            neighborhood: (payload.neighborhood as string) || undefined,
            city: (payload.city as string) || undefined,
            state: (payload.state as string) || undefined
          })
          .then(() => undefined)
      }
      update={(id, payload) =>
        desktopApi
          .carriersUpdate(id, {
            name: payload.name as string,
            document: (payload.document as string) || null,
            phone: (payload.phone as string) || null,
            email: (payload.email as string) || null,
            zipcode: (payload.zipcode as string) || null,
            addressStreet: (payload.addressStreet as string) || null,
            addressNumber: (payload.addressNumber as string) || null,
            addressComplement: (payload.addressComplement as string) || null,
            neighborhood: (payload.neighborhood as string) || null,
            city: (payload.city as string) || null,
            state: (payload.state as string) || null
          })
          .then(() => undefined)
      }
      remove={(id) => desktopApi.carriersDelete(id)}
      deleteDescription="A transportadora sera removida dos cadastros locais. Veiculos vinculados ficam sem transportadora."
      onChanged={onChanged}
      expandedRow={(item) =>
        selectedCarrier === String(item.id) ? (
          <div style={{ display: "grid", gap: "6px" }}>
            <strong style={{ color: "var(--kr-text-strong)", fontSize: "13px" }}>
              Veiculos vinculados
            </strong>
            {carrierVehicles.length === 0 ? (
              <p style={{ color: "var(--kr-muted)", fontSize: "13px", margin: 0 }}>
                Nenhum veiculo vinculado.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {carrierVehicles.map((vehicle) => (
                  <span
                    key={vehicle.id}
                    style={{
                      fontSize: "13px",
                      background: "var(--kr-surface)",
                      border: "1px solid var(--kr-border)",
                      padding: "4px 8px",
                      borderRadius: "8px",
                      color: "var(--kr-text-strong)"
                    }}
                  >
                    {vehicle.plate}
                    {vehicle.description ? ` - ${vehicle.description}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null
      }
    />
  );
}

function VehicleCrud({
  desktopApi,
  carrierOptions,
  carrierNameById
}: {
  desktopApi: KyberRockDesktopApi;
  carrierOptions: CrudSelectOption[];
  carrierNameById: Map<string, string>;
}) {
  const fields: CrudField[] = [
    { key: "plate", label: "Placa", type: "plate", required: true, section: "Identificacao" },
    { key: "description", label: "Descricao", section: "Identificacao" },
    {
      key: "carrierId",
      label: "Transportadora",
      type: "select",
      options: carrierOptions,
      emptyOption: "Sem transportadora",
      section: "Vinculo",
      helper: "Vincule a placa a transportadora quando houver."
    }
  ];

  const columns: Array<DataTableColumn<Record<string, unknown>>> = [
    {
      key: "plate",
      header: "Placa",
      width: "130px",
      render: (item) => <span style={styles.plateBadge}>{String(item.plate ?? "") || "-"}</span>
    },
    {
      key: "description",
      header: "Descricao",
      width: "minmax(180px, 1.2fr)",
      render: (item) => <CellMuted>{String(item.description ?? "") || "-"}</CellMuted>
    },
    {
      key: "carrier",
      header: "Transportadora",
      width: "minmax(200px, 1.3fr)",
      render: (item) => (
        <CellText>{carrierNameById.get(String(item.carrier_id ?? "")) ?? "-"}</CellText>
      )
    }
  ];

  return (
    <ResourceCrud
      desktopApi={desktopApi}
      entityType="vehicle"
      singular="Veiculo"
      gender="m"
      title="Placas"
      description="Caminhoes identificados pela placa. Vincule a transportadora quando houver."
      searchPlaceholder="Buscar por placa..."
      emptyHint={'Cadastre a primeira placa pelo botao "Novo veiculo".'}
      fields={fields}
      columns={columns}
      rowToForm={(item) => ({
        plate: String(item.plate ?? ""),
        description: String(item.description ?? ""),
        carrierId: String(item.carrier_id ?? "")
      })}
      buildPayload={(form) => {
        const normalizedPlate = normalizePlate(form.plate);
        if (!normalizedPlate) return { error: "Placa e obrigatoria." };
        if (!isValidPlate(normalizedPlate)) {
          return { error: "Placa invalida. Use o formato ABC1234 ou ABC1D23." };
        }
        return {
          value: {
            plate: normalizedPlate,
            description: form.description.trim(),
            carrierId: form.carrierId
          }
        };
      }}
      create={(payload) =>
        desktopApi
          .vehiclesCreate({
            plate: payload.plate as string,
            description: (payload.description as string) || undefined,
            carrierId: (payload.carrierId as string) || undefined
          })
          .then(() => undefined)
      }
      update={(id, payload) =>
        desktopApi
          .vehiclesUpdate(id, {
            plate: payload.plate as string,
            description: (payload.description as string) || undefined,
            carrierId: (payload.carrierId as string) || null
          })
          .then(() => undefined)
      }
      remove={(id) => desktopApi.vehiclesDelete(id)}
      deleteDescription="O veiculo sera removido dos cadastros. Operacoes ja registradas nao sao afetadas."
    />
  );
}

function TransportView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [transportTab, setTransportTab] = useState<"drivers" | "carriers" | "vehicles">("drivers");
  const [carriers, setCarriers] = useState<CarrierCacheEntry[]>([]);

  const loadCarriers = useCallback(async () => {
    try {
      const result = await desktopApi.queryCache({ entityType: "carrier", limit: 200 });
      setCarriers(result.rows as CarrierCacheEntry[]);
    } catch {
      setCarriers([]);
    }
  }, [desktopApi]);

  useEffect(() => {
    void loadCarriers();
  }, [loadCarriers]);

  const carrierOptions = useMemo(
    () => carriers.map((carrier) => ({ value: carrier.id, label: carrier.name })),
    [carriers]
  );
  const carrierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const carrier of carriers) map.set(carrier.id, carrier.name);
    return map;
  }, [carriers]);

  return (
    <div>
      <nav style={{ ...styles.subTabs, marginTop: 0 }}>
        <Tooltip content="Motoristas" placement="bottom">
          <button
            type="button"
            aria-label="Motoristas"
            aria-pressed={transportTab === "drivers"}
            onClick={() => setTransportTab("drivers")}
            style={subTabStyle(transportTab === "drivers")}
          >
            <User size={16} />
          </button>
        </Tooltip>
        <Tooltip content="Transportadoras" placement="bottom">
          <button
            type="button"
            aria-label="Transportadoras"
            aria-pressed={transportTab === "carriers"}
            onClick={() => setTransportTab("carriers")}
            style={subTabStyle(transportTab === "carriers")}
          >
            <Building2 size={16} />
          </button>
        </Tooltip>
        <Tooltip content="Placas" placement="bottom">
          <button
            type="button"
            aria-label="Placas"
            aria-pressed={transportTab === "vehicles"}
            onClick={() => setTransportTab("vehicles")}
            style={subTabStyle(transportTab === "vehicles")}
          >
            <Car size={16} />
          </button>
        </Tooltip>
      </nav>
      <div style={{ marginTop: "20px" }}>
        {transportTab === "drivers" ? (
          <DriverCrud desktopApi={desktopApi} carrierOptions={carrierOptions} />
        ) : null}
        {transportTab === "carriers" ? (
          <CarrierCrud desktopApi={desktopApi} onChanged={() => void loadCarriers()} />
        ) : null}
        {transportTab === "vehicles" ? (
          <VehicleCrud
            desktopApi={desktopApi}
            carrierOptions={carrierOptions}
            carrierNameById={carrierNameById}
          />
        ) : null}
      </div>
    </div>
  );
}

function paymentConditionSummary(term: PaymentTermCacheEntry): string {
  try {
    const rules = JSON.parse(term.rulesJson || "{}") as { summary?: string; raw?: string };
    return rules.summary || rules.raw || "-";
  } catch {
    return "-";
  }
}

function paymentConditionRaw(term: PaymentTermCacheEntry): string {
  try {
    const rules = JSON.parse(term.rulesJson || "{}") as { raw?: string };
    return rules.raw ?? "";
  } catch {
    return "";
  }
}

function PaymentMethodsCrud({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [methods, setMethods] = useState<PaymentMethodCacheEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountCacheEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [omieCode, setOmieCode] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, showFlash] = useFlash();

  const loadMethods = useCallback(async () => {
    setLoading(true);
    try {
      const [methodResult, accountResult] = await Promise.all([
        desktopApi.queryCache({ entityType: "payment_method", activeOnly: false, limit: 200 }),
        desktopApi.queryCache({ entityType: "account", activeOnly: false, limit: 200 })
      ]);
      setMethods(methodResult.rows as PaymentMethodCacheEntry[]);
      setAccounts(accountResult.rows as AccountCacheEntry[]);
    } finally {
      setLoading(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  function openEdit(method: PaymentMethodCacheEntry): void {
    setEditingId(method.id);
    setName(method.name);
    setAlias(method.alias ?? "");
    setOmieCode(method.omieCode ?? "");
    setAccountId(method.accountId ?? "");
    setIsActive(method.isActive);
    setFormError(null);
    setShowForm(true);
  }

  // As formas vem do OMIE (sincronizacao) ou do seed padrao. Localmente so e
  // permitido ativar/desativar, apelidar e vincular a conta.
  async function handleSave(): Promise<void> {
    if (!editingId) return;
    setSaving(true);
    try {
      await desktopApi.paymentMethodsUpdate(editingId, {
        alias: alias.trim() || null,
        accountId: accountId || null,
        isActive
      });
      showFlash("success", "Forma de pagamento atualizada.");
      setShowForm(false);
      await loadMethods();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <CrudSectionHeader
        title="Formas de pagamento"
        description="As formas vem do OMIE na sincronizacao (nome e codigo). Aqui voce ativa/desativa, apelida e vincula cada forma a uma conta."
        count={methods.length}
      />
      <FlashBanner flash={flash} />

      {showForm ? (
        <CrudFormShell
          title="Editar forma de pagamento"
          error={formError}
          saving={saving}
          maxWidth={520}
          onClose={() => setShowForm(false)}
          onSubmit={() => void handleSave()}
        >
          <FormSection title="Dados">
            <Field label="Forma" hint="Nome e codigo vem do OMIE e nao sao editaveis aqui.">
              <p style={{ ...styles.helperText, margin: 0 }}>
                {name}
                {omieCode ? ` | Cod. OMIE ${omieCode}` : " | Sem codigo OMIE (sincronize com o OMIE)"}
              </p>
            </Field>
            <TextInput
              label="Apelido"
              value={alias}
              onChange={setAlias}
              placeholder="Rotulo exibido (opcional)"
            />
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Ativa
            </label>
          </FormSection>
          <FormSection title="Integracao financeira">
            <Field
              label="Conta"
              hint="Conta usada no fechamento (ex.: Caixinha, OMIE Cash, GetNet)."
            >
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                style={getInputStyle(false)}
              >
                <option value="">Sem conta</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>
          </FormSection>
        </CrudFormShell>
      ) : null}

      <DataTable
        columns={[
          {
            key: "name",
            header: "Forma",
            width: "minmax(190px, 1.2fr)",
            render: (m: PaymentMethodCacheEntry) => (
              <>
                <CellPrimary>{m.displayName}</CellPrimary>
                <CellMuted>
                  {[m.alias ? m.name : null, m.isCustomerCredit ? "Credito do cliente" : null]
                    .filter(Boolean)
                    .join(" | ") || "-"}
                </CellMuted>
              </>
            )
          },
          {
            key: "account",
            header: "Conta",
            width: "minmax(130px, 0.9fr)",
            render: (m: PaymentMethodCacheEntry) => <CellText>{m.accountName ?? "-"}</CellText>
          },
          {
            key: "omie",
            header: "Cod. OMIE",
            width: "110px",
            render: (m: PaymentMethodCacheEntry) => <CellMuted>{m.omieCode ?? "-"}</CellMuted>
          },
          {
            key: "status",
            header: "Status",
            width: "90px",
            render: (m: PaymentMethodCacheEntry) => (
              <CellMuted>{m.isActive ? "Ativa" : "Inativa"}</CellMuted>
            )
          },
          {
            key: "actions",
            header: "Acoes",
            width: "150px",
            align: "right",
            render: (m: PaymentMethodCacheEntry) => <EditRowButton onClick={() => openEdit(m)} />
          }
        ]}
        rows={methods}
        rowKey={(m) => m.id}
        loading={loading}
        minWidth="760px"
        emptyTitle="Nenhuma forma de pagamento."
        emptyHint="Sincronize com o OMIE para puxar os meios de pagamento."
      />
    </div>
  );
}

function PaymentConditionsCrud({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [terms, setTerms] = useState<PaymentTermCacheEntry[]>([]);
  const [omieTerms, setOmieTerms] = useState<
    Array<{ code: string; description: string; installment_count: number | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [omieParcelaCode, setOmieParcelaCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, showFlash] = useFlash();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadTerms = useCallback(async () => {
    setLoading(true);
    try {
      const [result, omie] = await Promise.all([
        desktopApi.queryCache({
          entityType: "payment_term",
          activeOnly: false,
          limit: 500
        }),
        desktopApi.paymentTermsListOmie().catch(() => [])
      ]);
      setTerms(result.rows as PaymentTermCacheEntry[]);
      setOmieTerms(
        omie as Array<{ code: string; description: string; installment_count: number | null }>
      );
    } finally {
      setLoading(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    void loadTerms();
  }, [loadTerms]);

  function openCreate(): void {
    setEditingId(null);
    setName("");
    setCondition("");
    setOmieParcelaCode("");
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(term: PaymentTermCacheEntry): void {
    setEditingId(term.id);
    setName(term.name);
    setCondition(paymentConditionRaw(term));
    setOmieParcelaCode(term.omieParcelaCode ?? "");
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave(): Promise<void> {
    if (!name.trim()) {
      setFormError("Informe o nome da condicao.");
      return;
    }
    if (!condition.trim()) {
      setFormError("Informe o parcelamento (ex: 10/20/30/40).");
      return;
    }
    setSaving(true);
    try {
      const parcelaCode = omieParcelaCode.trim() || null;
      if (editingId) {
        await desktopApi.paymentTermsUpdate(editingId, {
          name: name.trim(),
          condition: condition.trim(),
          omieParcelaCode: parcelaCode
        });
        showFlash("success", "Condicao atualizada.");
      } else {
        await desktopApi.paymentTermsCreate({
          name: name.trim(),
          condition: condition.trim(),
          omieParcelaCode: parcelaCode
        });
        showFlash("success", "Condicao criada.");
      }
      setShowForm(false);
      await loadTerms();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDeleteId) return;
    setDeleting(true);
    try {
      await desktopApi.paymentTermsDelete(pendingDeleteId);
      setPendingDeleteId(null);
      await loadTerms();
      showFlash("success", "Condicao excluida.");
    } catch (err) {
      setPendingDeleteId(null);
      showFlash("error", err instanceof Error ? err.message : "Erro ao excluir.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ marginTop: "28px" }}>
      <CrudSectionHeader
        title="Condicoes de pagamento"
        description="Cadastradas no KyberRock no padrao de parcelas do OMIE: 10/20/30/40, A Vista/40/60, Para 93 dias, 50 ou 50 Parcelas."
        count={terms.length}
        actionLabel="Nova condicao"
        onAction={openCreate}
      />
      <FlashBanner flash={flash} />

      {showForm ? (
        <CrudFormShell
          title={editingId ? "Editar condicao" : "Nova condicao"}
          subtitle="Parcelas: 10/20/30/40 (dias fixos), A Vista/40/60, Para 93 dias (1 parcela), 50 ou 50 Parcelas (parcelas mensais)."
          error={formError}
          saving={saving}
          maxWidth={560}
          onClose={() => setShowForm(false)}
          onSubmit={() => void handleSave()}
        >
          <FormSection title="Dados">
            <TextInput label="Nome" value={name} onChange={setName} required />
            <TextInput
              label="Parcelamento"
              value={condition}
              onChange={setCondition}
              required
              placeholder="Ex: 10/20/30/40"
            />
          </FormSection>
          <FormSection title="Integracao OMIE">
            <Field
              label="Codigo OMIE (parcela)"
              hint="Codigo de parcela enviado no pedido/OS. Sem vinculo, o OMIE recebe 000 (a vista)."
            >
              {omieTerms.length > 0 ? (
                <select
                  value={omieParcelaCode}
                  onChange={(e) => setOmieParcelaCode(e.target.value)}
                  style={getInputStyle(false)}
                >
                  <option value="">Sem vinculo (usara 000)</option>
                  {omieParcelaCode && !omieTerms.some((t) => t.code === omieParcelaCode) ? (
                    <option value={omieParcelaCode}>{omieParcelaCode} (atual)</option>
                  ) : null}
                  {omieTerms.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} - {t.description}
                    </option>
                  ))}
                </select>
              ) : (
                <TextInput
                  label=""
                  value={omieParcelaCode}
                  onChange={setOmieParcelaCode}
                  placeholder="Codigo de parcela do OMIE (opcional, ex: 030)"
                />
              )}
            </Field>
          </FormSection>
        </CrudFormShell>
      ) : null}

      {pendingDeleteId ? (
        <ConfirmDialog
          title="Excluir condicao"
          description="A condicao sera removida dos cadastros."
          busy={deleting}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}

      <DataTable
        columns={[
          {
            key: "name",
            header: "Condicao",
            width: "minmax(200px, 1.2fr)",
            render: (t: PaymentTermCacheEntry) => <CellPrimary>{t.name}</CellPrimary>
          },
          {
            key: "parcelas",
            header: "Parcelamento",
            width: "minmax(180px, 1fr)",
            render: (t: PaymentTermCacheEntry) => <CellMuted>{paymentConditionSummary(t)}</CellMuted>
          },
          {
            key: "omie",
            header: "Cod. OMIE",
            width: "120px",
            render: (t: PaymentTermCacheEntry) => (
              <CellMuted>{t.omieParcelaCode || "000"}</CellMuted>
            )
          },
          {
            key: "status",
            header: "Status",
            width: "100px",
            render: (t: PaymentTermCacheEntry) => (
              <CellMuted>{t.isActive ? "Ativa" : "Inativa"}</CellMuted>
            )
          },
          {
            key: "actions",
            header: "Acoes",
            width: "150px",
            align: "right",
            render: (t: PaymentTermCacheEntry) => (
              <>
                <EditRowButton onClick={() => openEdit(t)} />
                <DeleteRowButton onClick={() => setPendingDeleteId(t.id)} />
              </>
            )
          }
        ]}
        rows={terms}
        rowKey={(t) => t.id}
        loading={loading}
        minWidth="800px"
        emptyTitle="Nenhuma condicao cadastrada."
        emptyHint='Crie uma condicao pelo botao "Nova condicao".'
      />
    </div>
  );
}

function AccountsCrud({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [accounts, setAccounts] = useState<AccountCacheEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [flash, showFlash] = useFlash();

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await desktopApi.queryCache({
        entityType: "account",
        activeOnly: false,
        limit: 200
      });
      setAccounts(result.rows as AccountCacheEntry[]);
    } finally {
      setLoading(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  // Contas vem do OMIE (sincronizacao); localmente so ativar/desativar.
  async function toggleActive(account: AccountCacheEntry): Promise<void> {
    setTogglingId(account.id);
    try {
      await desktopApi.accountsUpdate(account.id, { isActive: !account.isActive });
      await loadAccounts();
      showFlash("success", account.isActive ? "Conta desativada." : "Conta ativada.");
    } catch (err) {
      showFlash("error", err instanceof Error ? err.message : "Erro ao atualizar a conta.");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <CrudSectionHeader
        title="Contas"
        description="As contas correntes vem do OMIE na sincronizacao (nome e codigo). Ative/desative as que devem aparecer e vincule as formas de pagamento a elas."
        count={accounts.length}
      />
      <FlashBanner flash={flash} />
      <DataTable
        columns={[
          {
            key: "name",
            header: "Conta",
            width: "minmax(200px, 1.3fr)",
            render: (account: AccountCacheEntry) => <CellPrimary>{account.name}</CellPrimary>
          },
          {
            key: "omie",
            header: "Cod. OMIE",
            width: "140px",
            render: (account: AccountCacheEntry) => (
              <CellMuted>{account.omieCode ?? "-"}</CellMuted>
            )
          },
          {
            key: "status",
            header: "Status",
            width: "90px",
            render: (account: AccountCacheEntry) => (
              <CellMuted>{account.isActive ? "Ativa" : "Inativa"}</CellMuted>
            )
          },
          {
            key: "actions",
            header: "Acoes",
            width: "150px",
            align: "right",
            render: (account: AccountCacheEntry) => (
              <Tooltip
                content={account.isActive ? "Desativar conta" : "Ativar conta"}
                placement="left"
              >
                <button
                  type="button"
                  onClick={() => void toggleActive(account)}
                  disabled={togglingId === account.id}
                  aria-label={account.isActive ? "Desativar conta" : "Ativar conta"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "30px",
                    height: "30px",
                    padding: 0,
                    border: "1px solid var(--kr-border)",
                    background: "var(--kr-surface)",
                    color: account.isActive ? "var(--kr-success)" : "var(--kr-muted)",
                    borderRadius: "8px",
                    cursor: "pointer",
                    flexShrink: 0,
                    lineHeight: 0,
                    opacity: togglingId === account.id ? 0.6 : 1
                  }}
                >
                  <Power size={15} />
                </button>
              </Tooltip>
            )
          }
        ]}
        rows={accounts}
        rowKey={(account) => account.id}
        loading={loading}
        minWidth="600px"
        emptyTitle="Nenhuma conta."
        emptyHint="Sincronize com o OMIE para puxar as contas correntes."
      />
    </div>
  );
}

function PaymentRegistrationsView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  return (
    <div style={{ display: "grid", gap: "28px" }}>
      <PaymentMethodsCrud desktopApi={desktopApi} />
      <AccountsCrud desktopApi={desktopApi} />
      <PaymentConditionsCrud desktopApi={desktopApi} />
    </div>
  );
}

/** Tipo de conexao mostrado ao operador. USB e Serial (COM) usam o mesmo driver serial. */
type ScaleUiConnectionType = "tcp" | "usb" | "com" | "virtual";

const SCALE_UI_BAUD_RATES = ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"];
const SCALE_UI_VARIATION_ALERT_KG = 50;

function ScaleView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [connectionType, setConnectionType] = useState<ScaleUiConnectionType>("tcp");
  const [host, setHost] = useState("192.168.1.100");
  const [port, setPort] = useState("4001");
  const [serialPath, setSerialPath] = useState("");
  const [baudRate, setBaudRate] = useState("9600");
  const [autoConnect, setAutoConnect] = useState(true);
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [portsLoading, setPortsLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testProgress, setTestProgress] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [reading, setReading] = useState<{ weightKg: number; stable: boolean } | null>(null);
  const [status, setStatus] = useState<string>("Desconectado");
  const [error, setError] = useState<string | null>(null);

  // Estatísticas em tempo real
  const readingsRef = useRef<Array<{ weightKg: number; stable: boolean; at: number }>>([]);
  const [stats, setStats] = useState({
    count: 0,
    min: 0,
    max: 0,
    avg: 0,
    variation: 0,
    stableCount: 0,
    unstableCount: 0
  });

  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const isSerialType = connectionType === "usb" || connectionType === "com";

  useEffect(() => {
    if (!desktopApi) return;

    const handler = (r: { weightKg: number; stable: boolean }) => {
      setReading(r);
      const next = [...readingsRef.current, { ...r, at: Date.now() }].slice(-100);
      readingsRef.current = next;
      const weights = next.map((x) => x.weightKg);
      const min = Math.min(...weights);
      const max = Math.max(...weights);
      const avg = Math.round(weights.reduce((a, b) => a + b, 0) / weights.length);
      const stableCount = next.filter((x) => x.stable).length;
      setStats({
        count: next.length,
        min,
        max,
        avg,
        variation: max - min,
        stableCount,
        unstableCount: next.length - stableCount
      });
    };
    desktopApi.onScaleReading(handler as (reading: unknown) => void);

    return () => {
      desktopApi.offScaleReading(handler as (reading: unknown) => void);
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) return;

    let canceled = false;

    async function loadScaleConfig(): Promise<void> {
      try {
        const config = await desktopApi.scaleGetConfig();
        if (canceled) return;
        applyScaleConfig(config);
        setConfigLoaded(true);

        if (config.connection.autoConnect) {
          await desktopApi.scaleConnect();
          if (canceled) return;
          setConnected(true);
          setStatus("Conectado");
        }
      } catch (err) {
        if (!canceled) {
          setError(
            err instanceof Error ? err.message : "Falha ao carregar configuracao da balanca"
          );
          setConfigLoaded(true);
        }
      }
    }

    void loadScaleConfig();

    return () => {
      canceled = true;
    };
  }, [desktopApi]);

  useEffect(() => {
    // Poll status every 3 seconds
    if (!connected || !desktopApi) return;

    const interval = setInterval(async () => {
      try {
        const s = await desktopApi.scaleGetStatus();
        if (s.state === "disconnected" || s.state === "error") {
          setConnected(false);
          setStatus(s.errorMessage ?? "Desconectado");
        } else {
          setStatus(s.state === "connected" ? "Conectado" : "Conectando...");
        }
        if (s.errorMessage) setError(s.errorMessage);
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [connected, desktopApi]);

  // Atualiza a lista de portas ao entrar em um tipo serial (USB/COM)
  useEffect(() => {
    if (!desktopApi || !configLoaded || !isSerialType) return;
    void refreshSerialPorts();
  }, [desktopApi, configLoaded, isSerialType]);

  async function refreshSerialPorts(): Promise<void> {
    if (!desktopApi) return;
    setPortsLoading(true);
    setError(null);
    try {
      const ports = await desktopApi.scaleListSerialPorts();
      setSerialPorts(ports);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao listar portas seriais");
    } finally {
      setPortsLoading(false);
    }
  }

  // USB mostra so as portas USB quando o sistema consegue identifica-las;
  // se o driver nao reportar a origem, mostra todas para nao esconder a balanca.
  const usbPorts = serialPorts.filter((p) => p.isUsb);
  const visiblePorts =
    connectionType === "usb" && usbPorts.length > 0 ? usbPorts : serialPorts;

  // Auto-seleciona quando ha exatamente uma porta e nada foi escolhido ainda
  useEffect(() => {
    if (!isSerialType || serialPath || visiblePorts.length !== 1) return;
    const only = visiblePorts[0];
    if (only) setSerialPath(only.path);
  }, [isSerialType, serialPath, visiblePorts.length]);

  async function handleDiscover(): Promise<void> {
    setDiscovering(true);
    setError(null);
    setConfigMessage(null);
    try {
      const result = await desktopApi.scaleDiscover();
      if (result) {
        setHost(result.host);
        setPort(String(result.port));
        setConfigMessage(`Balanca encontrada em ${result.host}:${result.port}`);
      } else {
        setError("Nenhuma balanca encontrada na rede local.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao procurar balanca");
    } finally {
      setDiscovering(false);
    }
  }

  function validateBeforeConnect(): string | null {
    if (isSerialType && !serialPath.trim()) {
      return "Selecione a porta da balanca antes de conectar. Use \"Atualizar portas\" se a lista estiver vazia.";
    }
    if (connectionType === "tcp" && !host.trim()) {
      return "Informe o IP da balanca antes de conectar.";
    }
    return null;
  }

  async function handleConnect(): Promise<void> {
    setError(null);
    setConfigMessage(null);
    const validation = validateBeforeConnect();
    if (validation) {
      setError(validation);
      return;
    }
    try {
      const config = await desktopApi.scaleSaveConfig(buildScaleConfigInput());
      applyScaleConfig(config);
      await desktopApi.scaleConnect();
      setConnected(true);
      setStatus("Conectado");
      setConfigMessage("Configuracao salva e balanca conectada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conectar");
      setConnected(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    await desktopApi.scaleDisconnect();
    setConnected(false);
    setStatus("Desconectado");
    setReading(null);
    readingsRef.current = [];
    setStats({ count: 0, min: 0, max: 0, avg: 0, variation: 0, stableCount: 0, unstableCount: 0 });
  }

  async function handleSaveConfig(): Promise<void> {
    setSaving(true);
    setError(null);
    setConfigMessage(null);
    try {
      const config = await desktopApi.scaleSaveConfig(buildScaleConfigInput());
      applyScaleConfig(config);
      setConfigMessage("Configuracao salva.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar configuracao");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestCapture(): Promise<void> {
    setTesting(true);
    setError(null);
    setConfigMessage(null);
    setTestResult(null);
    const validation = validateBeforeConnect();
    if (validation) {
      setError(validation);
      setTesting(false);
      return;
    }
    setTestProgress("Preparando teste de captura...");

    try {
      const config = await desktopApi.scaleSaveConfig(buildScaleConfigInput());
      applyScaleConfig(config);

      if (!connectedRef.current) {
        await desktopApi.scaleConnect();
        setConnected(true);
        setStatus("Conectado");
      }

      setTestProgress("Aguardando a balanca estabilizar...");

      const capture = await desktopApi.scaleCaptureStable({ operationType: "entry" });
      setTestProgress(null);
      setTestResult(
        `Captura aprovada: ${new Intl.NumberFormat("pt-BR").format(capture.reading.weightKg)} kg (peso estavel).`
      );
    } catch (err) {
      setTestProgress(null);
      setError(err instanceof Error ? err.message : "Falha no teste de captura");
    } finally {
      setTesting(false);
    }
  }

  function applyScaleConfig(config: ScaleConfiguration): void {
    setConnectionType(
      config.adapterType === "virtual"
        ? "virtual"
        : config.adapterType === "serial"
          ? config.connection.serialTransport === "com"
            ? "com"
            : "usb"
          : "tcp"
    );
    setHost(config.connection.host);
    setPort(String(config.connection.port));
    setSerialPath(config.connection.serialPath);
    setBaudRate(String(config.connection.baudRate));
    setAutoConnect(config.connection.autoConnect);
  }

  function buildScaleConfigInput(): ScaleConfigurationInput {
    return {
      adapterType:
        connectionType === "virtual" ? "virtual" : connectionType === "tcp" ? "tcp" : "serial",
      connection: {
        host: host.trim() || "192.168.1.100",
        port: parseScaleInteger(port, 4001),
        serialPath: serialPath.trim(),
        baudRate: parseScaleInteger(baudRate, 9600),
        serialTransport: connectionType === "com" ? "com" : "usb",
        autoConnect
      }
    };
  }

  async function handleSelectType(type: ScaleUiConnectionType): Promise<void> {
    if (type === connectionType) return;
    setConnectionType(type);
    setError(null);
    setConfigMessage(null);
    setTestResult(null);
    if (connected) {
      await handleDisconnect();
    }
  }

  function renderTypeButton(type: ScaleUiConnectionType, label: string, hint: string) {
    const active = connectionType === type;
    return (
      <button
        type="button"
        onClick={() => void handleSelectType(type)}
        style={{
          flex: "1 1 45%",
          minWidth: "130px",
          padding: "10px 12px",
          border: active ? "2px solid var(--kr-accent)" : "1px solid var(--kr-border)",
          borderRadius: "8px",
          background: active ? "var(--kr-accent-soft)" : "var(--kr-surface-soft)",
          color: active ? "var(--kr-info-text)" : "var(--kr-muted)",
          fontWeight: active ? 700 : 500,
          fontSize: "13px",
          cursor: "pointer",
          textAlign: "left"
        }}
      >
        <span style={{ display: "block" }}>{label}</span>
        <span style={{ display: "block", fontSize: "11px", fontWeight: 400, marginTop: "2px" }}>
          {hint}
        </span>
      </button>
    );
  }

  return (
    <div>
      <section style={styles.twoColumns}>
        <article style={styles.panel}>
          <h2 style={styles.panelTitle}>Conexao da Balanca</h2>
          <p style={styles.muted}>
            Escolha como a balanca esta ligada ao computador e informe apenas os dados dessa
            conexao. A captura de peso aguarda a balanca estabilizar automaticamente.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", margin: "12px 0 16px" }}>
            {renderTypeButton("tcp", "Rede (IP)", "Balanca ligada na rede")}
            {renderTypeButton("usb", "USB", "Cabo USB ou conversor USB-serial")}
            {renderTypeButton("com", "Serial (COM)", "Porta serial do computador")}
            {renderTypeButton("virtual", "Virtual", "Simulada, para testes")}
          </div>

          {connectionType === "tcp" ? (
            <>
              <TextInput
                label="IP da balanca"
                value={host}
                onChange={setHost}
                placeholder="192.168.1.100"
              />
              <NumberInput
                label="Porta"
                value={port}
                onChange={setPort}
                placeholder="4001"
                maxLength={5}
                minLength={1}
                hint="Porta TCP do indicador (padrao 4001)."
              />
              <div style={{ marginTop: "10px" }}>
                <IconActionButton
                  icon="wifi"
                  label="Procurar balanca na rede"
                  tip={discovering ? "Procurando..." : "Procurar a balanca na rede local"}
                  tone="neutral"
                  disabled={discovering}
                  onClick={handleDiscover}
                />
              </div>
            </>
          ) : null}

          {isSerialType ? (
            <>
              <Field label={connectionType === "usb" ? "Dispositivo USB" : "Porta COM"}>
                <select
                  value={serialPath}
                  onChange={(event) => setSerialPath(event.target.value)}
                  style={getInputStyle(false)}
                >
                  <option value="">Selecione a porta...</option>
                  {visiblePorts.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.label}
                    </option>
                  ))}
                  {serialPath && !visiblePorts.some((p) => p.path === serialPath) ? (
                    <option value={serialPath}>{serialPath} (porta salva)</option>
                  ) : null}
                </select>
              </Field>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "6px" }}>
                <IconActionButton
                  icon="retry"
                  label="Atualizar portas"
                  tip={portsLoading ? "Atualizando..." : "Atualizar a lista de portas seriais"}
                  tone="neutral"
                  disabled={portsLoading}
                  onClick={() => void refreshSerialPorts()}
                />
                {!portsLoading && visiblePorts.length === 0 ? (
                  <span style={{ fontSize: "12px", color: "var(--kr-muted)" }}>
                    Nenhuma porta encontrada. Conecte o cabo da balanca e atualize.
                  </span>
                ) : null}
              </div>
              <Field label="Velocidade (baud rate)" style={{ marginTop: "12px" }}>
                <select
                  value={baudRate}
                  onChange={(event) => setBaudRate(event.target.value)}
                  style={getInputStyle(false)}
                >
                  {SCALE_UI_BAUD_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}
                    </option>
                  ))}
                </select>
              </Field>
              <p style={{ ...styles.muted, fontSize: "12px" }}>
                Use a mesma velocidade configurada no indicador da balanca (padrao Toledo: 9600).
              </p>
            </>
          ) : null}

          {connectionType === "virtual" ? (
            <div
              style={{
                marginTop: "10px",
                padding: "16px",
                background: "#f0fdf4",
                borderRadius: "8px",
                border: "1px solid #bbf7d0"
              }}
            >
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#166534" }}>
                Modo Balanca Virtual
              </p>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#166534" }}>
                Simula leituras de peso para testes e demonstracao, sem balanca fisica.
              </p>
            </div>
          ) : null}

          <label style={{ ...styles.checkboxLabel, marginTop: "12px" }}>
            <input
              type="checkbox"
              checked={autoConnect}
              onChange={(event) => setAutoConnect(event.target.checked)}
            />
            Conectar automaticamente ao abrir o sistema
          </label>

          {error ? <p style={styles.errorMessage}>{error}</p> : null}
          {configMessage ? (
            <p style={{ ...styles.muted, color: "#166534", fontWeight: 700 }}>{configMessage}</p>
          ) : null}

          <div style={{ display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap" }}>
            <IconActionButton
              icon="power"
              label="Conectar"
              tip="Conectar a balanca"
              tone="primary"
              disabled={connected || !configLoaded}
              onClick={handleConnect}
            />
            <IconActionButton
              icon="ban"
              label="Desconectar"
              tip="Desconectar a balanca"
              tone="neutral"
              disabled={!connected}
              onClick={handleDisconnect}
            />
            <IconActionButton
              icon="save"
              label="Salvar configuracao"
              tip={saving ? "Salvando..." : "Salvar a configuracao da balanca"}
              tone="neutral"
              disabled={saving || !configLoaded}
              onClick={handleSaveConfig}
            />
          </div>
        </article>

        <article style={styles.panel}>
          <h2 style={styles.panelTitle}>Leitura ao Vivo</h2>
          <p style={styles.muted}>
            Status: {status} | Amostras: {stats.count}
          </p>
          <div
            style={{
              marginTop: "16px",
              padding: "40px 20px",
              background: connected ? "#f0fdf4" : "#f8fafc",
              borderRadius: "16px",
              border: `3px solid ${connected && reading?.stable ? "#16a34a" : connected ? "#d97706" : "#e2e8f0"}`,
              textAlign: "center"
            }}
          >
            <p
              style={{
                fontSize: "48px",
                fontWeight: 700,
                margin: 0,
                color: connected ? "#0f172a" : "#94a3b8",
                fontFamily: "monospace"
              }}
            >
              {reading ? new Intl.NumberFormat("pt-BR").format(reading.weightKg) : "----"}
            </p>
            <p style={{ fontSize: "20px", color: "#64748b", margin: "8px 0 0 0" }}>
              {connected ? "kg" : ""}
            </p>
            {reading ? (
              <p
                style={{
                  fontSize: "14px",
                  color: reading.stable ? "#16a34a" : "#d97706",
                  marginTop: "8px",
                  fontWeight: 700
                }}
              >
                {reading.stable ? "Estavel" : "Instavel"}
              </p>
            ) : null}
          </div>

          {testProgress ? (
            <p style={{ ...styles.muted, color: "#0369a1", fontWeight: 700 }}>{testProgress}</p>
          ) : null}
          {testResult ? (
            <p style={{ ...styles.muted, color: "#166534", fontWeight: 700 }}>{testResult}</p>
          ) : null}

          <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
            <IconActionButton
              icon="check"
              label="Testar captura de peso"
              tip={testing ? "Testando..." : "Testar a captura de peso da balanca"}
              tone="primary"
              disabled={testing || !configLoaded}
              onClick={handleTestCapture}
            />
          </div>

          {connected && stats.count > 0 && (
            <div style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
              <h4 style={{ margin: "0", fontSize: "13px", color: "#0f172a" }}>
                Estatisticas (ultimas 100 leituras)
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div
                  style={{
                    background: "#f8fafc",
                    padding: "8px",
                    borderRadius: "8px",
                    textAlign: "center"
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Minimo</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    {new Intl.NumberFormat("pt-BR").format(stats.min)} kg
                  </div>
                </div>
                <div
                  style={{
                    background: "#f8fafc",
                    padding: "8px",
                    borderRadius: "8px",
                    textAlign: "center"
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Maximo</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    {new Intl.NumberFormat("pt-BR").format(stats.max)} kg
                  </div>
                </div>
                <div
                  style={{
                    background: "#f8fafc",
                    padding: "8px",
                    borderRadius: "8px",
                    textAlign: "center"
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Media</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    {new Intl.NumberFormat("pt-BR").format(stats.avg)} kg
                  </div>
                </div>
                <div
                  style={{
                    background: "#f8fafc",
                    padding: "8px",
                    borderRadius: "8px",
                    textAlign: "center"
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Variacao</div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: 700,
                      color: stats.variation > SCALE_UI_VARIATION_ALERT_KG ? "#dc2626" : "#0f172a"
                    }}
                  >
                    {new Intl.NumberFormat("pt-BR").format(stats.variation)} kg
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>
                  {stats.stableCount} estaveis
                </span>
                <span style={{ color: "#d97706", fontWeight: 700 }}>
                  {stats.unstableCount} instaveis
                </span>
              </div>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

function parseScaleInteger(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ProductsView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [items, setItems] = useState<
    Array<{
      id: string | null;
      productId: string;
      productCode: string | null;
      productDescription: string;
      unitPriceCents: number | null;
      unit: string;
    }>
  >([]);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [priceReais, setPriceReais] = useState("");
  const [flash, showFlash] = useFlash();
  const [pendingDefaultPrice, setPendingDefaultPrice] = useState<
    | { action: "save"; productId: string; unitPriceCents: number }
    | { action: "remove"; productId: string; productDescription: string }
    | null
  >(null);
  const [pricePasswordError, setPricePasswordError] = useState<string | null>(null);
  const [savingDefaultPrice, setSavingDefaultPrice] = useState(false);

  useEffect(() => {
    void loadPrices();
  }, []);

  async function loadPrices(): Promise<void> {
    const list = await desktopApi.productDefaultPricesList();
    setItems(list);
  }

  async function handleSaveDefaultPrice(): Promise<void> {
    if (!selectedProductId || !priceReais.trim()) return;
    const unitPriceCents = parseMoneyInputToCents(priceReais);
    if (unitPriceCents === null) return;

    setPricePasswordError(null);
    setPendingDefaultPrice({ action: "save", productId: selectedProductId, unitPriceCents });
  }

  function handleRemoveDefaultPrice(item: {
    productId: string;
    productDescription: string;
    unitPriceCents: number | null;
  }): void {
    if (item.unitPriceCents === null) return;
    setPricePasswordError(null);
    setPendingDefaultPrice({
      action: "remove",
      productId: item.productId,
      productDescription: item.productDescription
    });
  }

  async function handleConfirmDefaultPrice(password: string): Promise<void> {
    if (!pendingDefaultPrice || savingDefaultPrice) return;
    setSavingDefaultPrice(true);
    try {
      const valid = await desktopApi.verifyPriceChangePassword(password);
      if (!valid) {
        setPricePasswordError("Senha incorreta.");
        return;
      }

      if (pendingDefaultPrice.action === "save") {
        await desktopApi.productDefaultPricesUpsert({
          productId: pendingDefaultPrice.productId,
          unitPriceCents: pendingDefaultPrice.unitPriceCents,
          unit: "ton"
        });
        setSelectedProductId("");
        setPriceReais("");
        showFlash("success", "Preco padrao salvo.");
      } else {
        await desktopApi.productDefaultPricesRemove(pendingDefaultPrice.productId);
        showFlash("success", "Preco padrao removido.");
      }
      await loadPrices();
      setPendingDefaultPrice(null);
      setPricePasswordError(null);
    } catch (err) {
      setPricePasswordError(err instanceof Error ? err.message : "Erro ao salvar preco padrao.");
    } finally {
      setSavingDefaultPrice(false);
    }
  }

  const visibleItems = items.filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      item.productDescription.toLowerCase().includes(term) ||
      (item.productCode ?? "").toLowerCase().includes(term)
    );
  });

  return (
    <div>
      <CrudSectionHeader
        title="Produtos"
        description="Produtos sincronizados do OMIE com o preco padrao usado na pesagem. Preco especial do cliente tem prioridade sobre o preco padrao."
        count={items.length}
      />
      <FlashBanner flash={flash} />

      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
          flexWrap: "wrap",
          padding: "12px",
          borderRadius: "12px",
          border: "1px solid var(--kr-border)",
          background: "var(--kr-surface-soft)",
          marginBottom: "12px"
        }}
      >
        <Field label="Produto" style={{ flex: 1, minWidth: "260px", marginBottom: 0 }}>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            style={getInputStyle(false)}
          >
            <option value="">Selecione...</option>
            {items.map((item) => (
              <option key={item.productId} value={item.productId}>
                {item.productCode ? `${item.productCode} - ` : ""}
                {item.productDescription}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ width: "180px" }}>
          <MoneyInput
            label="Preco/ton (R$)"
            value={priceReais}
            onChange={setPriceReais}
            placeholder="150,00"
            allowZero={false}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSaveDefaultPrice()}
          disabled={!selectedProductId || !priceReais.trim()}
          style={{
            ...styles.primaryButton,
            padding: "10px 14px",
            opacity: !selectedProductId || !priceReais.trim() ? 0.55 : 1
          }}
        >
          Salvar preco
        </button>
      </div>

      <CrudSearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar produto por nome ou codigo..."
        onRefresh={() => void loadPrices()}
      />

      <DataTable
        columns={[
          {
            key: "product",
            header: "Produto",
            width: "minmax(240px, 1fr)",
            render: (item: (typeof items)[number]) => (
              <CellPrimary>{item.productDescription}</CellPrimary>
            )
          },
          {
            key: "code",
            header: "Codigo",
            width: "130px",
            render: (item) => <CellMuted>{item.productCode ?? "-"}</CellMuted>
          },
          {
            key: "price",
            header: "Preco padrao",
            width: "160px",
            align: "right",
            render: (item) =>
              item.unitPriceCents === null ? (
                <span style={{ color: "var(--kr-warning)", fontWeight: 700 }}>Sem preco</span>
              ) : (
                <CellPrimary>{`${formatMoney(item.unitPriceCents)}/ton`}</CellPrimary>
              )
          },
          {
            key: "actions",
            header: "Acoes",
            width: "210px",
            align: "right",
            render: (item) => (
              <>
                <EditRowButton
                  label={item.unitPriceCents === null ? "Definir preco" : "Alterar"}
                  onClick={() => {
                    setSelectedProductId(item.productId);
                    setPriceReais(
                      item.unitPriceCents === null
                        ? ""
                        : (item.unitPriceCents / 100).toFixed(2).replace(".", ",")
                    );
                  }}
                />
                <DeleteRowButton
                  label="Remover"
                  disabled={item.unitPriceCents === null}
                  onClick={() => handleRemoveDefaultPrice(item)}
                />
              </>
            )
          }
        ]}
        rows={visibleItems}
        rowKey={(item) => item.productId}
        emptyTitle={items.length === 0 ? "Nenhum produto sincronizado." : "Nenhum produto encontrado."}
        emptyHint={
          items.length === 0
            ? "Execute a sincronizacao OMIE na tela Cloud para baixar os produtos."
            : "Ajuste o termo de busca para localizar o produto."
        }
      />

      {pendingDefaultPrice ? (
        <PriceChangePasswordDialog
          title={
            pendingDefaultPrice.action === "remove"
              ? "Confirmar remocao do preco padrao"
              : "Confirmar alteracao de preco"
          }
          description={
            pendingDefaultPrice.action === "remove"
              ? `Digite a senha de 4 digitos para remover o preco padrao de ${pendingDefaultPrice.productDescription}.`
              : "Digite a senha de 4 digitos para alterar precos."
          }
          error={pricePasswordError}
          submitting={savingDefaultPrice}
          onCancel={() => {
            setPendingDefaultPrice(null);
            setPricePasswordError(null);
          }}
          onSubmit={(password) => void handleConfirmDefaultPrice(password)}
        />
      ) : null}
    </div>
  );
}

const styles = {
  page: {
    height: "100vh",
    minHeight: "100vh",
    margin: 0,
    padding: "10px 10px 34px",
    fontFamily:
      '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif',
    color: "var(--kr-text)",
    background: "var(--kr-bg)",
    overflow: "hidden" as const,
    boxSizing: "border-box" as const
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "6px 12px",
    borderRadius: "10px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)",
    marginBottom: "8px"
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  headerMessage: {
    fontSize: "11px",
    color: "var(--kr-muted)",
    maxWidth: "320px",
    overflow: "hidden" as const,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const
  },
  headerLogo: {
    height: "20px",
    width: "auto"
  },
  headerBrand: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  headerMeta: {
    fontSize: "11px",
    color: "var(--kr-muted)",
    marginLeft: "4px"
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  navInline: {
    display: "flex",
    gap: "2px",
    alignItems: "center"
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    borderLeft: "1px solid var(--kr-border)",
    paddingLeft: "6px",
    marginLeft: "2px"
  },
  shell: {
    display: "flex",
    gap: "10px",
    alignItems: "stretch",
    height: "calc(100vh - 44px)",
    minHeight: 0
  },
  sidebar: {
    width: "204px",
    flexShrink: 0,
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "16px",
    padding: "10px 0",
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
    boxShadow: "var(--kr-shadow)",
    minHeight: 0,
    overflow: "visible" as const
  },
  sidebarFooter: {
    marginTop: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px 0 12px",
    borderTop: "1px solid var(--kr-border)"
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0 12px 8px 12px",
    borderBottom: "1px solid var(--kr-border)"
  },
  sidebarLogo: {
    height: "22px",
    width: "auto"
  },
  sidebarBrand: {
    fontSize: "14px",
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  sidebarNav: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    overflowY: "auto" as const,
    paddingRight: "4px"
  },
  contentColumn: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
    minWidth: 0,
    minHeight: 0
  },
  topbar: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0
  },
  topbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0
  },
  topbarRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px"
  },
  contentBody: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
    flex: 1,
    minHeight: 0,
    overflowY: "auto" as const,
    overflowX: "hidden" as const,
    paddingRight: "2px"
  },
  headerBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    borderRadius: "6px",
    padding: "6px 8px",
    background: "transparent",
    color: "var(--kr-muted)",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: 1
  },
  themeToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    border: "1px solid var(--kr-border)",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-text-strong)",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "12px"
  },
  settingsDropdown: {
    position: "absolute" as const,
    right: 0,
    top: "100%",
    marginTop: "4px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "8px",
    boxShadow: "var(--kr-shadow)",
    minWidth: "160px",
    zIndex: 100,
    padding: "4px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px"
  },
  // Variante do menu de configuracoes ancorada no rodape da sidebar: abre para
  // cima (o botao fica na base) e transborda a direita sobre o conteudo.
  settingsDropdownUp: {
    position: "absolute" as const,
    left: 0,
    bottom: "100%",
    marginBottom: "4px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "8px",
    boxShadow: "var(--kr-shadow)",
    minWidth: "180px",
    zIndex: 100,
    padding: "4px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px"
  },
  settingsItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    border: "none",
    borderRadius: "4px",
    padding: "8px 10px",
    background: "transparent",
    color: "var(--kr-muted)",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 500,
    textAlign: "left" as const,
    width: "100%"
  },
  modalOverlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000
  },
  modal: {
    background: "var(--kr-surface)",
    padding: "16px",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "440px",
    boxShadow: "var(--kr-shadow)"
  },
  modalTitle: {
    margin: "0 0 6px 0",
    color: "var(--kr-text-strong)",
    fontSize: "16px"
  },
  modalText: {
    color: "var(--kr-muted)",
    margin: "0 0 12px 0",
    fontSize: "13px"
  },
  modalActions: {
    display: "flex",
    gap: "6px",
    justifyContent: "flex-end"
  },
  fiscalProgressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "14px"
  },
  fiscalProgressTitle: {
    margin: "4px 0 0 0",
    color: "var(--kr-text-strong)",
    fontSize: "20px"
  },
  fiscalStepRail: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(70px, 1fr))",
    gap: "8px",
    marginBottom: "14px"
  },
  fiscalStepItem: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "6px",
    minWidth: 0
  },
  fiscalStepLabel: {
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em"
  },
  fiscalProgressDetailCard: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
    padding: "14px",
    marginBottom: "14px",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-text-strong)"
  },
  fiscalProgressHint: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    lineHeight: 1.4
  },
  hero: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    padding: "14px 16px",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  kicker: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const
  },
  title: {
    margin: "4px 0",
    fontSize: "24px",
    lineHeight: 1.05
  },
  subtitle: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.35
  },
  actions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const
  },
  primaryButton: {
    border: "none",
    borderRadius: "10px",
    padding: "8px 12px",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  secondaryButton: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "8px 12px",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  dangerButton: {
    border: "none",
    borderRadius: "10px",
    padding: "8px 12px",
    background: "var(--kr-danger-strong)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  twoColumns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "10px",
    marginTop: 0
  },
  cloudGrid: {
    // Supabase (topo-esquerda) + Fila OMIE (baixo-esquerda) na coluna 1; Status OMIE
    // ocupa a coluna 2 inteira. flex 1 + minHeight 0 faz os cards preencherem o
    // contentBody ate o fim, sem espaco vazio na metade de baixo.
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(280px, 1fr))",
    gridTemplateRows: "auto 1fr",
    gap: "10px",
    marginTop: 0,
    flex: 1,
    minHeight: 0
  },
  subTabs: {
    display: "flex",
    gap: "2px",
    marginTop: "8px",
    borderBottom: "1px solid var(--kr-border)",
    flexWrap: "wrap" as const
  },
  card: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
    padding: "12px",
    border: "1px solid",
    borderRadius: "12px",
    background: "var(--kr-surface)",
    borderColor: "var(--kr-border)"
  },
  crudToolbar: {
    display: "flex",
    gap: "8px",
    marginBottom: "10px",
    flexWrap: "wrap" as const,
    alignItems: "center"
  },
  crudFormHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "14px 56px 14px 18px",
    borderBottom: "1px solid var(--kr-border)",
    background: "var(--kr-surface-soft)",
    flexWrap: "wrap" as const
  },
  crudFormTitle: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "16px",
    fontWeight: 700
  },
  crudFormGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "14px",
    padding: "18px"
  },
  crudFormSection: {
    display: "grid",
    alignContent: "start",
    gap: "10px",
    padding: "14px",
    border: "1px solid var(--kr-border)",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    minWidth: 0
  },
  crudFormSectionTitle: {
    margin: "0 0 4px 0",
    fontSize: "11px",
    fontWeight: 900,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--kr-muted)"
  },
  crudFormFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "14px 18px",
    borderTop: "1px solid var(--kr-border)",
    flexWrap: "wrap" as const,
    background: "var(--kr-surface-soft)",
    borderBottomLeftRadius: "16px",
    borderBottomRightRadius: "16px"
  },
  crudTable: {
    overflowX: "auto" as const,
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)",
    minHeight: 0
  },
  crudTableRow: {
    display: "grid",
    gap: 0,
    alignItems: "center",
    minWidth: "720px",
    padding: 0,
    borderTop: "1px solid var(--kr-border)",
    fontSize: "13px",
    color: "var(--kr-text)"
  },
  crudTableHead: {
    borderTop: "none",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    position: "sticky" as const,
    top: 0,
    zIndex: 1
  },
  crudTableHeaderCell: {
    padding: "8px 12px",
    borderRight: "1px solid var(--kr-border)",
    minHeight: "32px",
    display: "flex",
    alignItems: "center",
    minWidth: 0
  },
  crudTableCell: {
    padding: "8px 12px",
    borderRight: "1px solid var(--kr-border)",
    minHeight: "44px",
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    minWidth: 0
  },
  crudTableActionsCell: {
    padding: "8px 12px",
    borderRight: "1px solid var(--kr-border)",
    minHeight: "44px",
    display: "flex",
    gap: "6px",
    justifyContent: "flex-end",
    alignItems: "center",
    flexWrap: "wrap" as const,
    minWidth: 0
  },
  crudCellStack: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
    minWidth: 0
  },
  crudCellPrimary: {
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  crudCellMuted: {
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  crudActions: {
    display: "flex",
    gap: "6px",
    justifyContent: "flex-end",
    flexWrap: "wrap" as const
  },
  panel: {
    marginTop: 0,
    padding: "14px",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  openingVideoScreen: {
    position: "fixed" as const,
    inset: 0,
    width: "100vw",
    height: "100vh",
    overflow: "hidden" as const,
    background: "#020617",
    display: "grid",
    placeItems: "center",
    zIndex: 9999
  },
  openingVideo: {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    transition: "opacity 620ms ease, transform 620ms ease"
  },
  openingSkipButton: {
    position: "absolute" as const,
    left: "50%",
    bottom: "28px",
    transform: "translateX(-50%)",
    border: "1px solid rgba(255,255,255,0.32)",
    borderRadius: "999px",
    padding: "10px 18px",
    background: "rgba(2, 6, 23, 0.46)",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "0.02em",
    cursor: "pointer",
    backdropFilter: "blur(10px)",
    boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
    transition: "opacity 220ms ease, background 160ms ease"
  },
  openingVideoFade: {
    position: "absolute" as const,
    inset: 0,
    background: "#020617",
    pointerEvents: "none" as const,
    transition: "opacity 620ms ease"
  },
  visuallyHidden: {
    position: "absolute" as const,
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden" as const,
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap" as const,
    border: 0
  },
  entryShell: {
    // flex 1 + minHeight 0: preenche o contentBody para os 3 cards descerem ate o
    // fim da tela. O hero fica flexShrink 0 (nao comprime) e o excesso de cada card
    // vira scroll interno do proprio card, sem scroll da pagina.
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    marginTop: 0,
    flex: 1,
    minHeight: 0
  },
  entryHero: {
    position: "relative" as const,
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: "minmax(220px, 0.7fr) minmax(360px, 1fr)",
    alignItems: "stretch",
    gap: "10px",
    padding: "10px 12px",
    borderRadius: "14px",
    background: "#1c1917",
    border: "1px solid #292524",
    color: "#ffffff",
    boxShadow: "0 12px 28px rgba(28, 25, 23, 0.2)",
    flexShrink: 0
  },
  liveWeightCard: {
    minWidth: "180px",
    padding: "8px 10px",
    borderRadius: "12px",
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.22)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px"
  },
  metricHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  metricLabel: {
    color: "#fde68a",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em"
  },
  metricValue: {
    fontSize: "20px",
    lineHeight: 1,
    fontWeight: 700,
    color: "#ffffff"
  },
  metricHint: {
    color: "#e7e5e4",
    fontSize: "12px"
  },
  entryGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 1fr) minmax(340px, 1fr) minmax(360px, 1.05fr)",
    gap: "8px",
    alignItems: "stretch",
    flex: 1,
    minHeight: 0
  },
  entryCard: {
    padding: "10px",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)",
    minHeight: 0,
    overflow: "auto" as const
  },
  entrySummaryCard: {
    // Sem sticky: com o frete configuravel aberto o formulario rola, e um card
    // pinado em top:0 sobrepoe o hero e os demais cards (Ctrl+Enter captura
    // mesmo com o botao fora da tela).
    padding: "10px",
    borderRadius: "14px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-input-border)",
    boxShadow: "var(--kr-shadow)",
    minHeight: 0,
    overflow: "auto" as const
  },
  freightBox: {
    display: "grid",
    gap: "6px",
    marginTop: "6px",
    padding: "8px",
    borderRadius: "12px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)"
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontWeight: 800,
    fontSize: "13px",
    color: "var(--kr-text-strong)"
  },
  compactCheckboxCard: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "7px 9px",
    border: "1px solid var(--kr-border)",
    borderRadius: "10px",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-text-strong)",
    cursor: "pointer",
    marginBottom: "6px",
    fontSize: "12px",
    fontWeight: 800
  },
  compactInlineGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "8px",
    alignItems: "start"
  },
  freightCompactGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(138px, 1fr))",
    gap: "8px",
    alignItems: "start"
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px"
  },
  sectionIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    fontWeight: 900
  },
  sectionTitle: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  sectionDescription: {
    margin: "2px 0 0 0",
    color: "var(--kr-muted)",
    fontSize: "11px"
  },
  helperText: {
    margin: "-2px 0 6px 0",
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  checkboxCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    padding: "10px",
    border: "1px solid var(--kr-border)",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-text-strong)",
    cursor: "pointer",
    marginBottom: "10px",
    fontSize: "13px"
  },
  actionStack: {
    display: "flex",
    flexDirection: "row" as const,
    gap: "8px",
    marginTop: "8px",
    alignItems: "center"
  },
  captureButton: {
    border: "none",
    borderRadius: "12px",
    padding: "10px 12px",
    background: "linear-gradient(135deg, #16a34a, #15803d)",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "14px",
    boxShadow: "0 10px 22px rgba(22, 163, 74, 0.22)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px"
  },
  operationsPanel: {
    marginTop: 0,
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)",
    minHeight: 0
  },
  sectionTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px"
  },
  countBadge: {
    padding: "6px 10px",
    borderRadius: "999px",
    background: "var(--kr-info-bg)",
    border: "1px solid var(--kr-info-border)",
    color: "var(--kr-info-text)",
    fontWeight: 800,
    fontSize: "12px"
  },
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    padding: "26px",
    borderRadius: "14px",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-muted)",
    textAlign: "center" as const
  },
  operationsToolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px",
    flexWrap: "wrap" as const
  },
  segmentedTabs: {
    display: "flex",
    gap: "6px",
    alignItems: "center"
  },
  operationsTable: {
    overflowX: "auto" as const,
    overflowY: "auto" as const,
    maxHeight: "calc(100vh - 230px)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px"
  },
  operationsTableRow: {
    display: "grid",
    gridTemplateColumns: "96px minmax(180px, 1.4fr) minmax(120px, 0.8fr) 132px",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderTop: "1px solid var(--kr-border)",
    fontSize: "13px",
    color: "var(--kr-text)"
  },
  canceledOperationsTableRow: {
    display: "grid",
    gridTemplateColumns: "96px minmax(180px, 1.1fr) 150px minmax(180px, 1.2fr)",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderTop: "1px solid var(--kr-border)",
    fontSize: "13px",
    color: "var(--kr-text)"
  },
  closedOperationsTableRow: {
    display: "grid",
    gridTemplateColumns:
      "96px minmax(160px, 1.1fr) minmax(110px, 0.7fr) 140px minmax(170px, 0.9fr) 150px",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderTop: "1px solid var(--kr-border)",
    fontSize: "13px",
    color: "var(--kr-text)"
  },
  operationCellStack: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
    minWidth: 0
  },
  operationsTableHead: {
    borderTop: "none",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    position: "sticky" as const,
    top: 0,
    zIndex: 1
  },
  plateBadge: {
    justifySelf: "start",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: "5px 9px",
    borderRadius: "8px",
    background: "#1c1917",
    border: "1px solid #44403c",
    color: "#fafaf9",
    letterSpacing: "0.08em",
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontWeight: 700
  },
  rowActions: {
    display: "flex",
    gap: "6px",
    justifyContent: "flex-end"
  },
  smallPrimaryButton: {
    border: "none",
    borderRadius: "8px",
    padding: "6px 8px",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "11px"
  },
  smallSecondaryButton: {
    border: "1px solid var(--kr-border)",
    borderRadius: "8px",
    padding: "6px 8px",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "11px"
  },
  smallDangerButton: {
    border: "1px solid var(--kr-danger-border)",
    borderRadius: "8px",
    padding: "6px 8px",
    background: "var(--kr-danger-soft)",
    color: "var(--kr-danger)",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "11px"
  },
  panelTitle: {
    marginTop: 0,
    marginBottom: "4px",
    fontSize: "15px",
    color: "var(--kr-text-strong)"
  },
  muted: {
    color: "var(--kr-muted)",
    fontSize: "13px"
  },
  errorMessage: {
    color: "var(--kr-danger)",
    fontWeight: 700,
    fontSize: "13px"
  },
  omieFeedback: {
    marginTop: "12px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid",
    fontSize: "13px"
  },
  omieFeedbackSuccess: {
    color: "var(--kr-success)",
    background: "var(--kr-success-soft)",
    borderColor: "var(--kr-success-border)"
  },
  omieFeedbackWarning: {
    color: "var(--kr-warning)",
    background: "var(--kr-warning-soft)",
    borderColor: "var(--kr-warning-border)"
  },
  omieFeedbackChecking: {
    color: "var(--kr-info-text)",
    background: "var(--kr-info-bg)",
    borderColor: "var(--kr-info-border)"
  },
  omieFeedbackError: {
    color: "var(--kr-danger)",
    background: "var(--kr-danger-soft)",
    borderColor: "var(--kr-danger-border)"
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    marginBottom: "6px",
    fontWeight: 700,
    fontSize: "13px"
  },
  input: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "8px 10px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  operationRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "10px 0",
    borderTop: "1px solid var(--kr-border)"
  },
  receiptRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "10px 0",
    borderTop: "1px solid var(--kr-border)"
  },
  shortcutsLegend: {
    position: "fixed" as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: "var(--kr-surface-soft)",
    borderTop: "1px solid var(--kr-border)",
    padding: "5px 10px",
    display: "flex",
    gap: "10px",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap" as const,
    zIndex: 1000,
    fontSize: "11px"
  },
  shortcutsLegendItem: {
    display: "flex",
    alignItems: "center",
    gap: "4px"
  },
  shortcutsLegendKey: {
    display: "inline-block",
    padding: "2px 5px",
    borderRadius: "4px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    fontFamily: "monospace",
    fontSize: "10px",
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  shortcutsLegendLabel: {
    color: "var(--kr-muted)",
    fontSize: "11px"
  }
};
