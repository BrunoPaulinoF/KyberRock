import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Scale,
  ScrollText,
  Settings,
  Sun,
  Upload
} from "lucide-react";

import { desktopAppInfo } from "../app-info";
import type {
  PrintProfileSummary,
  PrintReceiptSummary,
  WindowsPrinterSummary
} from "../services/printing";
import type { DesktopAccessStatus } from "../services/desktop-activation";
import type { DesktopStatusSnapshot } from "../services/status";
import {
  createInitialUpdateState,
  type UpdateState
} from "../services/update-flow";
import type {
  OperationFreightInput,
  OperationType,
  WeighingOperationSummary
} from "../services/weighing-operations";
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
  parseMoneyInputToCents
} from "@kyberrock/shared";
import { ActivationGate } from "./ActivationGate";
import { BlockedScreen } from "./BlockedScreen";
import { DashboardView } from "./DashboardView";
import { InsightsView } from "./InsightsView";
import { ReportsView } from "./ReportsView";
import { CustomersView } from "./CustomersView";
import { HelpTooltip } from "./Tooltip";
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
import type { CarrierCacheEntry } from "./customers.types";
import type { KyberRockDesktopApi } from "./desktop-api";
import type { ScaleConfiguration, ScaleConfigurationInput } from "../services/scale-configs";
export interface AppProps {
  desktopApi?: KyberRockDesktopApi;
  initialStatus?: DesktopStatusSnapshot | null;
}

interface WeighingFormState {
  operationType: OperationType;
  vehicleId: string;
  carrierId: string;
  customerId: string;
  driverId: string;
  productId: string;
  paymentTermId: string;
  quotationId: string;
  deductFreightFromCredit: boolean;
  freightEnabled: boolean;
  freightPayer: "customer" | "quarry" | "third_party";
  freightCalculationType: "per_ton" | "per_ton_km" | "fixed_plus_ton";
  freightBaseValueCents: number | null;
  freightFixedValueCents: number | null;
  freightMinValueCents: number | null;
  freightDistanceKm: string;
  freightDestination: string;
  driverIsIndependent: boolean;
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
  | "reports"
  | "documentation";

const initialWeighingForm: WeighingFormState = {
  operationType: "invoice",
  vehicleId: "",
  carrierId: "",
  customerId: "",
  driverId: "",
  productId: "",
  paymentTermId: "",
  quotationId: "",
  deductFreightFromCredit: false,
  freightEnabled: false,
  freightPayer: "customer",
  freightCalculationType: "per_ton",
  freightBaseValueCents: null,
  freightFixedValueCents: null,
  freightMinValueCents: null,
  freightDistanceKm: "",
  freightDestination: "",
  driverIsIndependent: false
};

type RegistrationsTab = "customers" | "price_tables" | "products" | "payment_terms" | "transport";

type AppPhase = "checking_access" | "locked" | "unlocked";
type ThemeMode = "light" | "dark";
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

export function App({ desktopApi = getWindowDesktopApi(), initialStatus = null }: AppProps = {}) {
  const [phase, setPhase] = useState<AppPhase>("checking_access");
  const [status, setStatus] = useState<DesktopStatusSnapshot | null>(initialStatus);
  const [updateState, setUpdateState] = useState<UpdateState>(createInitialUpdateState());
  const [openOperations, setOpenOperations] = useState<WeighingOperationSummary[]>([]);
  const [canceledOperations, setCanceledOperations] = useState<WeighingOperationSummary[]>([]);
  const [closedOperations, setClosedOperations] = useState<WeighingOperationSummary[]>([]);
  const [operationsTab, setOperationsTab] = useState<OperationsTab>("open");
  const [canceledFilter, setCanceledFilter] = useState<CanceledFilter>("all");
  const [closedProductFilter, setClosedProductFilter] = useState<string>("all");
  const [printers, setPrinters] = useState<WindowsPrinterSummary[]>([]);
  const [printProfiles, setPrintProfiles] = useState<PrintProfileSummary[]>([]);
  const [printReceipts, setPrintReceipts] = useState<PrintReceiptSummary[]>([]);
  const [selectedPrinterName, setSelectedPrinterName] = useState("");
  const [form, setForm] = useState<WeighingFormState>(initialWeighingForm);
  const [activeView, setActiveView] = useState<ActiveView>("new-weighing");
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState("Inicializando desktop offline-first...");
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<{
    totalOperations: number;
    lastSync: string | null;
  } | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [unitName, setUnitName] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
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
    pendingOmieJobs: number;
    lastSyncAt: string | null;
  } | null>(null);
  const [registrationsTab, setRegistrationsTab] = useState<RegistrationsTab>("customers");
  const [closingOperationId, setClosingOperationId] = useState<string | null>(null);
  const [cancelOperationId, setCancelOperationId] = useState<string | null>(null);
  const [fiscalCloseProgress, setFiscalCloseProgress] = useState<FiscalCloseProgress | null>(null);
  const [retryingFiscalOperationId, setRetryingFiscalOperationId] = useState<string | null>(null);
  const [omieSyncing, setOmieSyncing] = useState(false);
  const [omieConnectionFeedback, setOmieConnectionFeedback] = useState<{
    status: "idle" | "checking" | "success" | "warning" | "error";
    message: string;
    details?: string;
  }>({ status: "idle", message: "" });
  const [omieLoop, setOmieLoop] = useState<OmieLoopUiState | null>(null);
  const [cloudSchedulerStatus, setCloudSchedulerStatus] = useState<{
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  } | null>(null);
  const [connectivity, setConnectivity] = useState<{
    internetOnline: boolean;
    cloudReachable: boolean;
    omieReachable: boolean;
  } | null>(null);
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
            closingOperationId ||
            cancelOperationId
          ) {
            setShowUpdateModal(false);
            setShowLogsModal(false);
            setShowSettings(false);
            setClosingOperationId(null);
            setCancelOperationId(null);
          } else {
            setActiveView("dashboard");
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showUpdateModal, showLogsModal, showSettings, closingOperationId, cancelOperationId]);

  useEffect(() => {
    if (!desktopApi) {
      setPhase("locked");
      return;
    }

    desktopApi
      .getAccessStatus()
      .then((access) => {
        setAccessStatus(access);
        setCompanyName(access.companyName);
        setUnitName(access.unitName);
        if (access.canOperate) {
          setPhase("unlocked");
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

  const handleUnlocked = useCallback(() => setPhase("unlocked"), []);

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
    if (!desktopApi) {
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
        nextPrinters,
        nextProfiles,
        nextReceipts
      ] = await Promise.all([
        desktopApi.getStatus(navigator.onLine),
        desktopApi.getUpdateState(),
        desktopApi.listOpenWeighingOperations(),
        desktopApi.listCanceledWeighingOperations(),
        desktopApi.listClosedWeighingOperations(),
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
      setPrinters(nextPrinters);
      setPrintProfiles(nextProfiles);
      setPrintReceipts(nextReceipts);
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
        setConnectivity(probe);
        const connected = probe.cloudReachable;
        setCloudConnected(connected);
        if (connected) {
          const nextCloudStatus = await desktopApi.getCloudStatus();
          if (active) setCloudStatus(nextCloudStatus);
        }
      } catch {
        if (active) {
          setConnectivity((prev) => prev ?? { internetOnline: false, cloudReachable: false, omieReachable: false });
          setCloudConnected(false);
        }
      }

      try {
        const omieStatusResult = await desktopApi.getOmieStatus();
        if (active) setOmieStatus(omieStatusResult);
      } catch {
        // OMIE status is optional
      }

      try {
        const cloudSched = await desktopApi.getCloudSyncSchedulerStatus();
        if (active) setCloudSchedulerStatus(cloudSched);
      } catch {
        // scheduler status is optional
      }

      if (active) {
        if (nextStatus.pendingSyncJobs > 0) {
          setMessage(
            `Fila: ${nextStatus.pendingSyncJobs} item(ns) pendente(s) - envio automatico a cada ${cloudSchedulerStatus?.intervalMinutes ?? 20} min.`
          );
        } else {
          setMessage("Sincronizacao automatica ativa (OMIE + Supabase) a cada 20 min.");
        }
      }
    }

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 15_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [desktopApi]);

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
      setConnectivity(probe);
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

  const autoSyncOmie = useCallback(async () => {
    if (!desktopApi) return;
    if (!navigator.onLine) return;
    setOmieSyncing(true);
    try {
      await desktopApi.omieSync();
      const omieStatusResult = await desktopApi.getOmieStatus();
      setOmieStatus(omieStatusResult);
      setMessage("Sincronizacao OMIE automatica concluida.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Auto-sync OMIE falhou", message);
    } finally {
      setOmieSyncing(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi || phase !== "unlocked") return;
    let cancelled = false;
    const initial = window.setTimeout(() => {
      if (cancelled) return;
      void autoSyncCloud();
      void autoSyncOmie();
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
    };
  }, [desktopApi, phase, autoSyncCloud, autoSyncOmie]);

  useEffect(() => {
    if (!desktopApi || phase !== "unlocked") return;
    const handleOnline = () => {
      setMessage("Internet disponivel novamente - drenando fila de sincronizacao.");
      void autoSyncCloud();
      void autoSyncOmie();
    };
    const handleOffline = () => {
      setMessage(
        "Internet indisponivel - operacao segue normalmente, dados ficarao na fila para envio."
      );
      setConnectivity((prev) =>
        prev ? { ...prev, internetOnline: false } : { internetOnline: false, cloudReachable: false, omieReachable: false }
      );
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [desktopApi, phase, autoSyncCloud, autoSyncOmie]);

  useEffect(() => {
    if (!desktopApi) return;
    const id = window.setInterval(() => {
      if (navigator.onLine) {
        void autoSyncCloud();
      }
    }, 20 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [desktopApi, autoSyncCloud]);

  async function refreshOpenOperations(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const [nextOpenOperations, nextCanceledOperations, nextClosedOperations, nextStatus] =
      await Promise.all([
        desktopApi.listOpenWeighingOperations(),
        desktopApi.listCanceledWeighingOperations(),
        desktopApi.listClosedWeighingOperations(),
        desktopApi.getStatus(navigator.onLine)
      ]);
    setOpenOperations(nextOpenOperations);
    setCanceledOperations(nextCanceledOperations);
    setClosedOperations(nextClosedOperations);
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
    setCompanyName(null);
    setUnitName(null);
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

  async function handleStartOmieDataEntryLoop(): Promise<void> {
    if (!desktopApi) return;

    setOmieLoop({
      running: true,
      finished: false,
      customersPulled: 0,
      productsSynced: 0,
      paymentTermsSynced: 0,
      iteration: 0,
      customersPage: 1,
      productsPage: 1,
      paymentTermsPage: 1,
      errorMessage: null
    });
    setMessage("Iniciando loop de entrada de dados do OMIE...");
    try {
      const result = await desktopApi.startOmieDataEntryLoop();
      setOmieLoop({
        running: false,
        finished: result.finished,
        customersPulled: result.customersPulled,
        productsSynced: result.productsSynced,
        paymentTermsSynced: result.paymentTermsSynced,
        iteration: result.iterations,
        customersPage: 1,
        productsPage: 1,
        paymentTermsPage: 1,
        errorMessage: result.errors.length > 0 ? result.errors.join(" | ") : null
      });
      const omieStatusResult = await desktopApi.getOmieStatus();
      setOmieStatus(omieStatusResult);
      const summary =
        `Loop OMIE: ${result.iterations} iteracoes | ` +
        `${result.customersPulled} clientes clonados, ${result.productsSynced} produtos, ${result.paymentTermsSynced} condicoes`;
      setMessage(summary);
      setOmieConnectionFeedback({
        status:
          result.finished && result.errors.length === 0
            ? "success"
            : result.errors.length > 0
              ? "warning"
              : "warning",
        message: result.finished
          ? "Loop OMIE concluido. Todos os dados foram clonados."
          : "Loop OMIE parou antes de concluir. Veja detalhes.",
        details: summary
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setMessage(`Falha no loop OMIE: ${errorMessage}`);
      setOmieLoop((prev) => ({
        running: false,
        finished: prev?.finished ?? false,
        customersPulled: prev?.customersPulled ?? 0,
        productsSynced: prev?.productsSynced ?? 0,
        paymentTermsSynced: prev?.paymentTermsSynced ?? 0,
        iteration: prev?.iteration ?? 0,
        customersPage: prev?.customersPage ?? 1,
        productsPage: prev?.productsPage ?? 1,
        paymentTermsPage: prev?.paymentTermsPage ?? 1,
        errorMessage
      }));
      setOmieConnectionFeedback({
        status: "error",
        message: "Nao foi possivel concluir o loop OMIE.",
        details: errorMessage
      });
    }
  }

  async function handleStartWeighing(): Promise<void> {
    if (!desktopApi) return;

    const validationError = validateWeighingForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);
    setMessage("Calculando peso medio da balanca. Aguarde...");

    try {
      const sampled = await desktopApi.scaleReadSampled();
      const operation = await desktopApi.startWeighing({
        operationType: form.operationType,
        customerId: form.customerId,
        vehicleId: form.vehicleId,
        carrierId: form.carrierId || undefined,
        driverId: form.driverId,
        productId: form.productId,
        paymentTermId: form.paymentTermId || undefined,
        freight: buildFreightInput(form),
        quotationId: form.quotationId || undefined,
        deductFreightFromCredit: form.deductFreightFromCredit,
        entryWeightKg: sampled.weightKg
      });
      setMessage(`Entrada registrada com peso medio calculado: ${operation.entryWeightKg} kg.`);
      setForm(initialWeighingForm);
      setActiveView("open-operations");
      await refreshOpenOperations();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  async function handleCloseOperation(
    operationId: string,
    operationType: OperationType
  ): Promise<void> {
    if (!desktopApi) return;

    if (operationType === "invoice" && !navigator.onLine) {
      setMessage(
        "Saida fiscal exige internet conectada para faturar no OMIE antes de liberar o caminhao."
      );
      return;
    }

    setMessage(
      operationType === "invoice"
        ? "Coletando peso de saida com os criterios configurados e fechando a operacao fiscal."
        : "Coletando peso de saida com os criterios configurados e fechando a operacao interna."
    );

    try {
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId,
          status: "running",
          step: "weighing",
          title: "Fechando saida fiscal",
          detail: "Capturando peso de saida com os criterios configurados e calculando peso liquido."
        });
        setMessage("Fechando operacao fiscal e faturando no OMIE. Mantenha a internet conectada.");
      }
      const operation = await desktopApi.closeWeighing(operationId, operationType);
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId: operation.id,
          status: "running",
          step: "billing",
          title: "Faturando no OMIE",
          detail: "Criando e faturando o pedido de venda fiscal."
        });
      }
      const billingStatus =
        operationType === "invoice" ? await desktopApi.billFiscalOperation(operation.id) : null;
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId: operation.id,
          status: "running",
          step: "danfe",
          title: "Documento fiscal",
          detail: billingStatus?.documentUrl
            ? billingStatus.documentPrinted
              ? "DANFE retornado pela OMIE e enviado para impressora."
              : "DANFE retornado pela OMIE, mas a impressao automatica nao confirmou."
            : "OMIE faturou o pedido, mas ainda nao retornou URL do DANFE."
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
      const fiscalStatus = billingStatus
        ? `Pedido fiscal OMIE ${billingStatus.orderId} faturado.${
            billingStatus.documentUrl
              ? billingStatus.documentPrinted
                ? " DANFE enviado para impressora."
                : ` DANFE disponivel, mas nao foi impresso automaticamente: ${billingStatus.documentPrintError ?? "sem detalhe"}.`
              : " DANFE ainda nao foi retornado pela OMIE; imprima pelo portal OMIE se necessario."
          } `
        : "";
      const operationLabel =
        operationType === "invoice" ? "Operacao fiscal fechada" : "Operacao interna fechada";
      setMessage(
        `${operationLabel}. Peso liquido: ${operation.netWeightKg} kg. ${fiscalStatus}${receiptStatus}`
      );
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId: operation.id,
          status: "success",
          step: "receipt",
          title: "Saida fiscal concluida",
          detail: fiscalStatus.trim() || "Pedido fiscal faturado no OMIE."
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

  async function handleConfigureReceiptPrinter(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const printerName = selectedPrinterName.trim();

    if (!printerName) {
      setMessage("Selecione uma impressora do Windows antes de salvar o perfil.");
      return;
    }

    try {
      const profile = await desktopApi.configureReceiptPrintProfile({
        windowsPrinterName: printerName,
        paperWidthMm: 80
      });
      setMessage(`Impressora de cupom configurada: ${profile.windowsPrinterName}.`);
      await refreshPrintData();
    } catch (error) {
      setMessage(getErrorMessage(error));
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
      setMessage(`Operacao cancelada: ${operation.cancelReason}.`);
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
                disabled
                badge="Em breve"
              />
            </SidebarSection>
          </nav>
        </aside>
        <div style={styles.contentColumn}>
          <header style={styles.topbar}>
            <div style={styles.topbarLeft}>
              {companyName && unitName ? (
                <span style={styles.headerMeta}>
                  {companyName} — {unitName}
                </span>
              ) : null}
              <ConnectivityBadge
                internetOnline={navigator.onLine}
                connectivity={connectivity}
                cloudScheduler={cloudSchedulerStatus}
                pendingSyncJobs={status?.pendingSyncJobs ?? 0}
                cloudSyncing={cloudSyncing}
                onSyncNow={() => void autoSyncCloud()}
              />
              <span style={styles.headerMessage}>{message}</span>
            </div>
            <div style={styles.topbarRight}>
              <button
                type="button"
                onClick={() => setThemeMode((mode) => (mode === "light" ? "dark" : "light"))}
                style={styles.themeToggle}
                title="Alternar tema (F11)"
              >
                {themeMode === "light" ? <Moon size={14} /> : <Sun size={14} />}
                {themeMode === "light" ? "Escuro" : "Claro"}
              </button>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowSettings((s) => !s)}
                  style={styles.headerBtn}
                  title="Configuracoes"
                >
                  <Settings size={17} />
                </button>
                {showSettings ? (
                  <div style={styles.settingsDropdown}>
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
                        setShowLogsModal(true);
                        setShowSettings(false);
                      }}
                      style={{
                        ...styles.settingsItem,
                        color: errorLogs.some((l) => l.level === "error") ? "#b91c1c" : "var(--kr-muted)"
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
          </header>
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
                    <button
                        type="button"
                        onClick={() => setErrorLogs([])}
                        style={styles.secondaryButton}
                      >
                        Limpar
                      </button>
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
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px"
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
                              borderBottom: "1px solid #f1f5f9",
                              background:
                                log.level === "error"
                                  ? "#fef2f2"
                                  : log.level === "warn"
                                    ? "#fffbeb"
                                    : "#fff"
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: "8px",
                                alignItems: "center",
                                fontSize: "12px",
                                color: "#64748b"
                              }}
                            >
                              <span>{new Date(log.timestamp).toLocaleString("pt-BR")}</span>
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
                                color: "#0f172a",
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
                                  color: "#94a3b8",
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
                    <button
                      type="button"
                      onClick={() => setOperationsTab("open")}
                      style={operationsTabStyle(operationsTab === "open")}
                    >
                      Abertas
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperationsTab("canceled")}
                      style={operationsTabStyle(operationsTab === "canceled")}
                    >
                      Canceladas
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperationsTab("closed")}
                      style={operationsTabStyle(operationsTab === "closed")}
                    >
                      Concluidas
                    </button>
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
                      <label style={{ ...styles.fieldLabel, marginBottom: 0 }} title={TIPS.operations.filterPeriod}>
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
                      <button
                          type="button"
                          onClick={() => void handleClearCanceledOperations()}
                          disabled={canceledOperations.length === 0}
                          style={{
                            ...styles.secondaryButton,
                            color: "#b91c1c",
                            borderColor: "#fecaca"
                          }}
                        >
                          Limpar canceladas
                        </button>
                    <HelpTooltip content={TIPS.operations.clearCanceled} placement="bottom" />
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
                      <label style={{ ...styles.fieldLabel, marginBottom: 0 }} title={TIPS.operations.filterProduct}>
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
                      <div style={{ ...styles.operationsTableRow, ...styles.operationsTableHead }}>
                        <span>Placa</span>
                        <span>Cliente / Produto</span>
                        <span>Entrada / Preco</span>
                        <span>Acoes</span>
                      </div>
                      {openOperations.map((operation) => (
                        <div key={operation.id} style={styles.operationsTableRow}>
                          <strong style={styles.plateBadge}>{operation.plate}</strong>
                          <span style={styles.operationCellStack}>
                            <strong>{operation.customerName}</strong>
                            <span>{operation.productDescription}</span>
                            <small>Motorista: {operation.driverName}</small>
                          </span>
                          <span style={styles.operationCellStack}>
                            <strong>{formatWeightKg(operation.entryWeightKg ?? 0)}</strong>
                            <span>{formatMoney(operation.unitPriceCents)}/ton</span>
                          </span>
                          <span style={styles.rowActions}>
                            <button
                                type="button"
                                onClick={() => setClosingOperationId(operation.id)}
                                style={styles.smallPrimaryButton}
                              >
                                Fechar
                              </button>
                            <HelpTooltip content={TIPS.operations.close} placement="left" />
                            <button
                                type="button"
                                onClick={() => setCancelOperationId(operation.id)}
                                style={styles.smallDangerButton}
                              >
                                Cancelar
                              </button>
                            <HelpTooltip content={TIPS.operations.cancel} placement="left" />
                          </span>
                        </div>
                      ))}
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
                        <div key={operation.id} style={styles.canceledOperationsTableRow}>
                          <strong style={styles.plateBadge}>{operation.plate || "--"}</strong>
                          <span style={styles.operationCellStack}>
                            <strong>{operation.customerName || "Cliente nao informado"}</strong>
                            <span>{operation.productDescription || "Produto nao informado"}</span>
                          </span>
                          <span>{new Date(operation.updatedAt).toLocaleString("pt-BR")}</span>
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
                    </div>
                    {filteredClosedOperations.map((operation) => (
                      <div key={operation.id} style={styles.closedOperationsTableRow}>
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
                        <span>{new Date(operation.updatedAt).toLocaleString("pt-BR")}</span>
                        <FiscalBillingStatus
                          operation={operation}
                          retrying={retryingFiscalOperationId === operation.id}
                          onRetry={() => void handleRetryFiscalBilling(operation.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {closingOperationId ? (
              <CloseOperationTypeDialog
                defaultOperationType="invoice"
                onConfirm={(operationType) => {
                  const id = closingOperationId;
                  setClosingOperationId(null);
                  void handleCloseOperation(id, operationType);
                }}
                onCancel={() => setClosingOperationId(null)}
              />
            ) : null}

            {cancelOperationId ? (
              <CancelOperationDialog
                onConfirm={(reason) => {
                  const id = cancelOperationId;
                  setCancelOperationId(null);
                  void handleCancelOperation(id, reason);
                }}
                onCancel={() => setCancelOperationId(null)}
              />
            ) : null}

            {fiscalCloseProgress ? (
              <FiscalProgressDialog
                progress={fiscalCloseProgress}
                onClose={() => setFiscalCloseProgress(null)}
              />
            ) : null}

            {activeView === "scale" ? <ScaleView desktopApi={desktopApi} /> : null}

            {activeView === "registrations" ? (
              <section style={styles.panel}>
                <h2 style={styles.panelTitle}>Cadastros</h2>
                <nav style={styles.subTabs}>
                  <button
                    type="button"
                    onClick={() => setRegistrationsTab("customers")}
                    style={subTabStyle(registrationsTab === "customers")}
                  >
                    Clientes
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrationsTab("price_tables")}
                    style={subTabStyle(registrationsTab === "price_tables")}
                  >
                    Precos Padrao
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrationsTab("products")}
                    style={subTabStyle(registrationsTab === "products")}
                  >
                    Produtos
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrationsTab("payment_terms")}
                    style={subTabStyle(registrationsTab === "payment_terms")}
                  >
                    Condicoes
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrationsTab("transport")}
                    style={subTabStyle(registrationsTab === "transport")}
                  >
                    Transporte
                  </button>
                </nav>
                <p style={styles.muted}>{TIPS.screens.registrations}</p>
                <div style={{ marginTop: "20px" }}>
                  {registrationsTab === "customers" ? (
                    <CustomersView desktopApi={desktopApi} />
                  ) : null}
                  {registrationsTab === "price_tables" ? (
                    <PriceTableListView desktopApi={desktopApi} />
                  ) : null}
                  {registrationsTab === "products" ? (
                    <OmieViewer
                      desktopApi={desktopApi}
                      entityType="product"
                      title="Produtos (OMIE)"
                      displayField="description"
                      subField="code"
                    />
                  ) : null}
                  {registrationsTab === "payment_terms" ? (
                    <OmieViewer
                      desktopApi={desktopApi}
                      entityType="payment_term"
                      title="Condicoes de Pagamento (OMIE)"
                      displayField="name"
                      subField="omieCode"
                    />
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
                  <h2 style={styles.panelTitle}>Perfil de cupom 80 mm</h2>
                  <p style={styles.muted}>
                    {TIPS.screens.printing}
                  </p>
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
                    <p style={styles.errorMessage}>Nenhuma impressora instalada foi encontrada.</p>
                  ) : null}
                  <button
                      type="button"
                      onClick={handleConfigureReceiptPrinter}
                      style={styles.primaryButton}
                    >
                      Salvar perfil 80 mm
                    </button>
                  <HelpTooltip content={TIPS.printing.saveProfile} placement="top" />

                  <button
                      type="button"
                      onClick={() => void handlePrintTest()}
                      style={{ ...styles.secondaryButton, marginTop: "12px" }}
                    >
                      Testar impressora (cupom exemplo)
                    </button>
                  <HelpTooltip content={TIPS.printing.testPrint} placement="top" />

                  <h3>Perfil ativo</h3>
                  {printProfiles.length === 0 ? (
                    <p style={styles.muted}>Nenhum perfil de impressao configurado.</p>
                  ) : (
                    <p>
                      {printProfiles[0].windowsPrinterName} - {printProfiles[0].paperWidthMm} mm
                    </p>
                  )}
                </article>

                <article style={styles.panel}>
                  <h2 style={styles.panelTitle}>Cupons emitidos</h2>
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
                      <button
                          type="button"
                          onClick={() => void handleReprintReceipt(receipt.id)}
                          style={styles.secondaryButton}
                        >
                          Reimprimir segunda via
                        </button>
                      <HelpTooltip content={TIPS.printing.reprint} placement="left" />
                    </div>
                  ))}
                </article>
              </section>
            ) : null}

            {activeView === "cloud" ? (
              <section style={styles.twoColumns}>
                <article style={styles.panel}>
                  <h2 style={styles.panelTitle}>Sincronizacao Supabase</h2>
                  <p style={styles.muted}>
                    {TIPS.screens.cloud}
                  </p>

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
                            ? new Date(cloudStatus.lastSync).toLocaleString("pt-BR")
                            : "Nunca"}
                        </p>
                      </>
                    )}
                  </div>

                  <button
                      type="button"
                      onClick={handleSyncToCloud}
                      disabled={cloudSyncing}
                      style={{
                        ...styles.primaryButton,
                        opacity: cloudSyncing ? 0.6 : 1,
                        cursor: cloudSyncing ? "not-allowed" : "pointer"
                      }}
                    >
                      {cloudSyncing ? "Sincronizando..." : "Sincronizar agora"}
                    </button>
                  <HelpTooltip content={TIPS.cloud.syncNow} placement="top" />
                </article>

                <article style={styles.panel}>
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
                          <p>Pendentes de envio: {omieStatus.pendingPushCustomers} clientes</p>
                          <p>Pedidos OMIE na fila: {omieStatus.pendingOmieJobs}</p>
                          <p>
                            Ultima sincronizacao:{" "}
                            {omieStatus.lastSyncAt
                              ? new Date(omieStatus.lastSyncAt).toLocaleString("pt-BR")
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
                          <button
                              type="button"
                              onClick={handleSyncOmie}
                              disabled={omieSyncing}
                              style={{
                                ...styles.primaryButton,
                                marginTop: "16px",
                                opacity: omieSyncing ? 0.6 : 1,
                                cursor: omieSyncing ? "not-allowed" : "pointer"
                              }}
                            >
                              {omieSyncing ? "Sincronizando..." : "Sincronizar OMIE agora"}
                            </button>
                          <HelpTooltip content={TIPS.cloud.syncOmie} placement="top" />
                          <div
                            style={{
                              marginTop: "16px",
                              padding: "12px",
                              border: "1px dashed #cbd5e1",
                              borderRadius: "8px",
                              background: "#f8fafc"
                            }}
                          >
                            <p style={{ margin: 0, fontWeight: 700, fontSize: "13px" }}>
                              Loop automatico OMIE (temporario)
                            </p>
                            <p style={{ ...styles.muted, margin: "4px 0 8px 0" }}>
                              Bate no OMIE pagina por pagina ate baixar todos os clientes, produtos
                              e condicoes que ainda nao foram clonados.
                            </p>
                            <button
                                type="button"
                                onClick={handleStartOmieDataEntryLoop}
                                disabled={omieLoop?.running}
                                style={{
                                  ...styles.primaryButton,
                                  background: "#0f766e",
                                  opacity: omieLoop?.running ? 0.6 : 1,
                                  cursor: omieLoop?.running ? "not-allowed" : "pointer"
                                }}
                              >
                                {omieLoop?.running
                                  ? "Executando loop..."
                                  : "Iniciar loop de entrada de dados"}
                              </button>
                            <HelpTooltip content={TIPS.cloud.omieLoop} placement="top" />
                            {omieLoop ? (
                              <div
                                style={{ marginTop: "10px", fontSize: "13px", color: "#0f172a" }}
                              >
                                <p style={{ margin: "2px 0" }}>
                                  <strong>Iteracao:</strong> {omieLoop.iteration}
                                </p>
                                <p style={{ margin: "2px 0" }}>
                                  <strong>Clientes clonados do OMIE:</strong>{" "}
                                  {omieLoop.customersPulled}
                                </p>
                                <p style={{ margin: "2px 0" }}>
                                  <strong>Produtos clonados do OMIE:</strong>{" "}
                                  {omieLoop.productsSynced}
                                </p>
                                <p style={{ margin: "2px 0" }}>
                                  <strong>Condicoes clonadas do OMIE:</strong>{" "}
                                  {omieLoop.paymentTermsSynced}
                                </p>
                                <p style={{ margin: "2px 0" }}>
                                  <strong>Paginas restantes:</strong> clientes{" "}
                                  {omieLoop.customersPage}, produtos {omieLoop.productsPage},{" "}
                                  condicoes {omieLoop.paymentTermsPage}
                                </p>
                                <p style={{ margin: "2px 0" }}>
                                  <strong>Status:</strong>{" "}
                                  {omieLoop.running
                                    ? "Executando..."
                                    : omieLoop.finished
                                      ? "Concluido"
                                      : "Parado"}
                                </p>
                                {omieLoop.errorMessage ? (
                                  <p style={{ margin: "6px 0 0 0", color: "#b91c1c" }}>
                                    {omieLoop.errorMessage}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
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
            {activeView === "reports" ? <ReportsView desktopApi={desktopApi} /> : null}
            {activeView === "documentation" ? (
              <section style={styles.panel}>
                <h2 style={styles.panelTitle}>Documentacao</h2>
                <p style={styles.muted}>Em breve.</p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
      <KeyboardShortcutsLegend />
    </main>
  );
}

function ConnectivityBadge({
  internetOnline,
  connectivity,
  cloudScheduler,
  pendingSyncJobs,
  cloudSyncing,
  onSyncNow
}: {
  internetOnline: boolean;
  connectivity: { internetOnline: boolean; cloudReachable: boolean; omieReachable: boolean } | null;
  cloudScheduler: { enabled: boolean; intervalMinutes: number; lastRunAt: string | null } | null;
  pendingSyncJobs: number;
  cloudSyncing: boolean;
  onSyncNow: () => void;
}) {
  const effectiveInternet = connectivity?.internetOnline ?? internetOnline;
  const cloudReachable = connectivity?.cloudReachable ?? false;
  const omieReachable = connectivity?.omieReachable ?? false;

  let tone: "success" | "warning" | "danger" | "neutral" = "neutral";
  let label = "Verificando...";
  let detail = "Coletando informacoes de rede";

  if (!effectiveInternet) {
    tone = "danger";
    label = "Sem internet";
    detail =
      pendingSyncJobs > 0
        ? `${pendingSyncJobs} item(ns) na fila; envio ao reconectar`
        : "Operacao local segue normalmente";
  } else if (!cloudReachable && !omieReachable) {
    tone = "danger";
    label = "Integrações indisponíveis";
    detail = "Supabase e OMIE não respondem - sincronização ficará pendente";
  } else if (!cloudReachable) {
    tone = "warning";
    label = "Supabase indisponível";
    detail = omieReachable
      ? "OMIE respondendo; Supabase offline - fila aguardando"
      : "Supabase não responde - fila aguardando";
  } else if (!omieReachable) {
    tone = "warning";
    label = "OMIE indisponível";
    detail = "Supabase OK; OMIE não responde - envio de pedidos aguardando";
  } else {
    tone = "success";
    label = cloudSyncing ? "Sincronizando..." : "Conectado";
    const interval = cloudScheduler?.intervalMinutes ?? 20;
    const last = cloudScheduler?.lastRunAt
      ? new Date(cloudScheduler.lastRunAt).toLocaleTimeString("pt-BR")
      : "nunca";
    detail = `Supabase + OMIE online · auto a cada ${interval} min · último: ${last}`;
  }

  const palette = badgePalette(tone);
  return (
    <div
      title={detail}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 8px",
        borderRadius: "999px",
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        fontSize: "11px",
        fontWeight: 700,
        whiteSpace: "nowrap"
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: palette.dot,
          display: "inline-block"
        }}
      />
      <span>{label}</span>
      {pendingSyncJobs > 0 ? (
        <span
          style={{
            background: "rgba(0,0,0,0.18)",
            color: palette.fg,
            borderRadius: "999px",
            padding: "0 6px",
            fontSize: "10px"
          }}
        >
          {pendingSyncJobs} fila
        </span>
      ) : null}
      {effectiveInternet && !cloudSyncing ? (
        <>
          <button
            type="button"
            onClick={onSyncNow}
            style={{
              background: "transparent",
              color: palette.fg,
              border: `1px solid ${palette.border}`,
              borderRadius: "999px",
              padding: "0 8px",
              fontSize: "10px",
              cursor: "pointer",
              fontWeight: 700
            }}
          >
            Sincronizar
          </button>
          <HelpTooltip content={TIPS.header.syncNow} placement="bottom" />
        </>
      ) : null}
    </div>
  );
}

function badgePalette(
  tone: "success" | "warning" | "danger" | "neutral"
): { bg: string; fg: string; border: string; dot: string } {
  switch (tone) {
    case "success":
      return { bg: "#dcfce7", fg: "#166534", border: "#86efac", dot: "#16a34a" };
    case "warning":
      return { bg: "#fef3c7", fg: "#92400e", border: "#fcd34d", dot: "#d97706" };
    case "danger":
      return { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5", dot: "#dc2626" };
    default:
      return { bg: "#e2e8f0", fg: "#475569", border: "#cbd5e1", dot: "#64748b" };
  }
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

function getWindowDesktopApi(): KyberRockDesktopApi | undefined {
  return typeof window === "undefined" ? undefined : window.kyberrockDesktop;
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

function SidebarItem({ id, label, icon: Icon, activeView, onSelect, disabled, badge, tooltip }: SidebarItemProps) {
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
    color: disabled ? "#94a3b8" : isActive ? "#0f172a" : "#475569",
    background: isActive ? "#e0f2fe" : "transparent",
    border: "none",
    borderLeft: isActive ? "3px solid #2563eb" : "3px solid transparent",
    borderRadius: "0 6px 6px 0",
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
          color: "#94a3b8",
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

function validateWeighingForm(form: WeighingFormState): string | null {
  if (!form.vehicleId) return "Selecione a placa.";
  if (!form.customerId) return "Selecione o cliente.";
  if (!form.driverId) return "Selecione o motorista.";
  if (!form.productId) return "Selecione o produto.";
  if (!form.driverIsIndependent && !form.carrierId) return "Selecione a transportadora.";
  if (form.freightEnabled) {
    if (form.freightBaseValueCents === null && form.freightFixedValueCents === null) {
      return "Informe o valor do frete.";
    }
    if (form.freightCalculationType === "per_ton_km" && parsePositiveNumber(form.freightDistanceKm) === null) {
      return "Informe a distancia do frete em km.";
    }
  }
  return null;
}

function buildFreightInput(form: WeighingFormState): OperationFreightInput | null {
  if (!form.freightEnabled) return null;
  const distanceKm = parsePositiveNumber(form.freightDistanceKm);
  return {
    payer: form.freightPayer,
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

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface OmieLoopUiState {
  running: boolean;
  finished: boolean;
  customersPulled: number;
  productsSynced: number;
  paymentTermsSynced: number;
  iteration: number;
  customersPage: number;
  productsPage: number;
  paymentTermsPage: number;
  errorMessage: string | null;
}

interface CacheSelectOption {
  id: string;
  label: string;
  raw?: Record<string, unknown>;
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
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
          limit: 20,
          productFiscalType
        });
        const allOptions = (result.rows as Array<Record<string, unknown>>).map((item) => ({
            id: String(item.id ?? item.omieCode ?? ""),
            label: String(
              item.tradeName ?? item.plate ?? item.name ?? item.description ?? item.fullName ?? ""
            ),
            raw: item
          }));
        setOptions(
          filterIds && filterIds.length > 0
            ? allOptions.filter((o) => filterIds.includes(o.id))
            : allOptions
        );
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [desktopApi, entityType, productFiscalType, search, refreshKey, filterIds]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const margin = 4;
    const preferredMaxHeight = 240;
    const minVisibleHeight = 80;
    const flipThreshold = 160;

    function recompute(): void {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const flip = spaceBelow < flipThreshold && spaceAbove > spaceBelow;
      const available = Math.max(minVisibleHeight, flip ? spaceAbove : spaceBelow);
      const maxHeight = Math.min(preferredMaxHeight, available);

      if (flip) {
        setDropdownStyle({
          position: "fixed",
          bottom: `${window.innerHeight - rect.top + margin}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          maxHeight: `${maxHeight}px`
        });
      } else {
        setDropdownStyle({
          position: "fixed",
          top: `${rect.bottom + margin}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          maxHeight: `${maxHeight}px`
        });
      }
    }

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative", marginBottom: "8px" }}>
      <label style={styles.fieldLabel}>
        {label}
        <input
          type="text"
          value={open ? search : selectedLabel}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setSearch("");
          }}
          disabled={disabled}
          placeholder={`Buscar ${label.toLowerCase()}...`}
          style={styles.input}
        />
      </label>
      {open ? (
        <div
          ref={dropdownRef}
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "4px",
            overflowY: "auto",
            zIndex: 100,
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
            ...dropdownStyle
          }}
        >
          {loading ? (
            <div style={{ padding: "8px 12px", color: "#94a3b8", fontSize: "13px" }}>
              Carregando...
            </div>
          ) : options.length === 0 ? (
            <div style={{ padding: "8px 12px", color: "#94a3b8", fontSize: "13px" }}>
              Nenhum resultado
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setSelectedOption(option);
                  onChange(option.id, option.raw);
                  setOpen(false);
                  setSearch("");
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "#0f172a"
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                {option.label}
              </button>
            ))
          )}
          {onCreateNew ? (
            <button
              type="button"
              onClick={() => {
                onCreateNew();
                setOpen(false);
                setSearch("");
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: "none",
                borderTop: "1px solid #e2e8f0",
                background: "#f8fafc",
                cursor: "pointer",
                fontSize: "13px",
                color: "#2563eb",
                fontWeight: 600
              }}
            >
              + Cadastrar novo
            </button>
          ) : null}
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
  onStart: () => void;
  onCancel: () => void;
}

function WeighingForm({
  desktopApi,
  form,
  setForm,
  formError,
  onStart,
  onCancel
}: WeighingFormProps) {
  const [liveWeight, setLiveWeight] = useState<number | null>(null);
  const [priceDetails, setPriceDetails] = useState<PriceDetails | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCarrierModal, setShowCarrierModal] = useState(false);
  const [vehicleRefreshKey, setVehicleRefreshKey] = useState(0);
  const [driverRefreshKey, setDriverRefreshKey] = useState(0);
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0);
  const [carrierRefreshKey, setCarrierRefreshKey] = useState(0);
  const [paymentTermInstallmentCount, setPaymentTermInstallmentCount] = useState<number | null>(
    null
  );
  const [availableCarrierIds, setAvailableCarrierIds] = useState<string[] | undefined>(undefined);
  const [availableDriverIds, setAvailableDriverIds] = useState<string[] | undefined>(undefined);
  const [driverIsIndependent, setDriverIsIndependent] = useState(false);

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
      } catch {
        setAvailableCarrierIds(undefined);
      }
    }
    load();
  }, [desktopApi, form.customerId]);

  // Buscar motoristas vinculados a transportadora + independentes
  useEffect(() => {
    async function load() {
      if (!desktopApi) {
        setAvailableDriverIds(undefined);
        return;
      }
      try {
        const independent = await desktopApi.listIndependentDrivers();
        const independentIds = independent.map((d) => d.id);

        if (form.carrierId) {
          const linked = await desktopApi.listDriversByCarrier(form.carrierId);
          const linkedIds = linked.map((d) => d.id);
          setAvailableDriverIds([...new Set([...linkedIds, ...independentIds])]);
        } else {
          setAvailableDriverIds(independentIds.length > 0 ? independentIds : undefined);
        }
      } catch {
        setAvailableDriverIds(undefined);
      }
    }
    load();
  }, [desktopApi, form.carrierId]);

  // Quando motorista muda, verificar se tem 1 transportadora e preencher
  useEffect(() => {
    async function load() {
      if (!desktopApi || !form.driverId) {
        setDriverIsIndependent(false);
        setForm((prev) => ({ ...prev, driverIsIndependent: false }));
        return;
      }
      try {
        const carriers = await desktopApi.listCarriersByDriver(form.driverId);
        const driverData = await desktopApi.queryCache({ entityType: "driver", limit: 1 });
        const driver = (driverData.rows as Array<Record<string, unknown>>).find(
          (d) => d.id === form.driverId
        );
        const isIndependent = Boolean(driver?.is_independent);
        setDriverIsIndependent(isIndependent);
        setForm((prev) => ({ ...prev, driverIsIndependent: isIndependent }));

        if (carriers.length === 1 && !isIndependent) {
          // Motorista tem exatamente 1 transportadora - preencher automaticamente
          setForm((prev) => ({ ...prev, carrierId: carriers[0].id }));
        } else if (isIndependent) {
          // Motorista independente - limpar transportadora
          setForm((prev) => ({ ...prev, carrierId: "" }));
        }
      } catch {
        setDriverIsIndependent(false);
        setForm((prev) => ({ ...prev, driverIsIndependent: false }));
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onStart();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onStart, onCancel]);

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
    async function syncInstallmentCount() {
      if (!form.paymentTermId || !desktopApi) {
        setPaymentTermInstallmentCount(null);
        return;
      }
      try {
        const result = await desktopApi.queryCache({ entityType: "payment_term", limit: 500 });
        const term = (result.rows as Array<{ id: string; installmentCount?: number }>).find(
          (r) => r.id === form.paymentTermId
        );
        setPaymentTermInstallmentCount(term?.installmentCount ?? null);
      } catch {
        setPaymentTermInstallmentCount(null);
      }
    }
    syncInstallmentCount();
  }, [form.paymentTermId, desktopApi]);

  return (
    <section style={styles.entryShell}>
      <div style={styles.entryHero}>
        <div>
          <p style={styles.kicker}>Operacao de balanca</p>
          <h2 style={{ ...styles.title, marginBottom: "6px" }}>Nova entrada</h2>
          <p style={styles.subtitle}>
            Selecione cliente, produto acabado OMIE, placa e motorista. O peso e capturado direto da
            balanca.
          </p>
        </div>
        <div style={styles.liveWeightCard}>
          <div style={styles.metricHeader}>
            <img
              src="midia/peso.png"
              alt=""
              style={{ width: "22px", height: "22px", objectFit: "contain" }}
            />
            <span style={styles.metricLabel}>Peso atual</span>
          </div>
          <strong style={styles.metricValue}>
            {liveWeight !== null ? formatWeightKg(liveWeight) : "-- kg"}
          </strong>
          <span style={styles.metricHint}>
            {liveWeight !== null ? "Leitura em tempo real" : "Aguardando balanca"}
          </span>
        </div>
      </div>

      {formError ? <p style={styles.errorMessage}>{formError}</p> : null}

      <div style={styles.entryGrid}>
        <article style={styles.entryCard}>
          <SectionHeader
            iconSrc="midia/commerce.png"
            title="Dados comerciais"
            description="Cliente, produto fiscal e condicao de pagamento"
          />
          <CacheSelect
            label="Cliente"
            entityType="customer"
            value={form.customerId}
            onChange={(id, item) =>
              setForm((prev) => ({
                ...prev,
                customerId: id,
                paymentTermId:
                  typeof item?.defaultPaymentTermId === "string" && item.defaultPaymentTermId
                    ? item.defaultPaymentTermId
                    : prev.paymentTermId
              }))
            }
            onCreateNew={() => setShowCustomerModal(true)}
            desktopApi={desktopApi}
            refreshKey={customerRefreshKey}
          />
          <CacheSelect
            label="Produto acabado OMIE"
            entityType="product"
            value={form.productId}
            onChange={(id) => setForm({ ...form, productId: id })}
            desktopApi={desktopApi}
            productFiscalType="finished_goods"
          />
          <p style={styles.helperText}>
            Somente produtos OMIE com recomendacao fiscal tipo 04 - produtos acabados.
          </p>
          <CacheSelect
            label="Condicao de pagamento"
            entityType="payment_term"
            value={form.paymentTermId}
            onChange={(id, item) => {
              const rawCount = item?.installmentCount;
              const count =
                typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount > 0
                  ? rawCount
                  : null;
              setPaymentTermInstallmentCount(count);
              setForm((prev) => ({
                ...prev,
                paymentTermId: id
              }));
            }}
            desktopApi={desktopApi}
          />
          {paymentTermInstallmentCount && paymentTermInstallmentCount > 1 ? (
            <p style={styles.helperText}>
              Condicao selecionada com {paymentTermInstallmentCount} parcelas.
            </p>
          ) : null}
        </article>

        <article style={styles.entryCard}>
          <SectionHeader
            iconSrc="midia/truck.png"
            title="Transporte"
            description="Placa, transportadora e motorista"
          />
          <CacheSelect
            label="Placa"
            entityType="vehicle"
            value={form.vehicleId}
            onChange={(id) => setForm((prev) => ({ ...prev, vehicleId: id, carrierId: "" }))}
            onCreateNew={() => setShowVehicleModal(true)}
            desktopApi={desktopApi}
            refreshKey={vehicleRefreshKey}
          />
          <CacheSelect
            label="Transportadora"
            entityType="carrier"
            value={form.carrierId}
            onChange={(id) => setForm((prev) => ({ ...prev, carrierId: id }))}
            onCreateNew={() => setShowCarrierModal(true)}
            desktopApi={desktopApi}
            refreshKey={carrierRefreshKey}
            filterIds={availableCarrierIds}
          />
          {form.customerId && availableCarrierIds && availableCarrierIds.length === 0 ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
              <p style={{ ...styles.helperText, color: "#d97706", margin: 0 }}>
                Nenhuma transportadora vinculada a este cliente.
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
          <CacheSelect
            label="Motorista"
            entityType="driver"
            value={form.driverId}
            onChange={(id) => setForm({ ...form, driverId: id })}
            onCreateNew={() => setShowDriverModal(true)}
            desktopApi={desktopApi}
            refreshKey={driverRefreshKey}
            filterIds={availableDriverIds}
          />
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
            description="Preco resolvido, frete e acao final"
          />
          <PriceDetailsPanel details={priceDetails} />
          <div style={styles.freightBox}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={form.freightEnabled}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, freightEnabled: event.target.checked }))
                }
              />
              Operacao com frete
            </label>
            {form.freightEnabled ? (
              <div style={{ display: "grid", gap: "10px" }}>
                <label style={styles.fieldLabel}>
                  Responsavel pelo frete
                  <select
                    value={form.freightPayer}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        freightPayer: event.target.value as WeighingFormState["freightPayer"]
                      }))
                    }
                    style={styles.input}
                  >
                    <option value="customer">Cliente</option>
                    <option value="quarry">Pedreira</option>
                    <option value="third_party">Terceiro</option>
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  Calculo do frete
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
                    <option value="per_ton">Valor por tonelada</option>
                    <option value="per_ton_km">Valor por tonelada-km</option>
                    <option value="fixed_plus_ton">Fixo + valor por tonelada</option>
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
                />
                {form.freightCalculationType === "fixed_plus_ton" ? (
                  <PriceInput
                    label="Valor fixo do frete"
                    suffix=""
                    valueCents={form.freightFixedValueCents}
                    onChange={(cents) =>
                      setForm((prev) => ({ ...prev, freightFixedValueCents: cents }))
                    }
                  />
                ) : null}
                {form.freightCalculationType === "per_ton_km" ? (
                  <NumberInput
                    label="Distancia (km)"
                    value={form.freightDistanceKm}
                    onChange={(freightDistanceKm) =>
                      setForm((prev) => ({ ...prev, freightDistanceKm }))
                    }
                    placeholder="Ex: 35"
                    hint="Apenas numeros inteiros."
                  />
                ) : null}
                <PriceInput
                  label="Frete minimo"
                  suffix=""
                  valueCents={form.freightMinValueCents}
                  onChange={(cents) =>
                    setForm((prev) => ({ ...prev, freightMinValueCents: cents }))
                  }
                />
                <TextInput
                  label="Destino/observacao do frete"
                  value={form.freightDestination}
                  onChange={(freightDestination) =>
                    setForm((prev) => ({ ...prev, freightDestination }))
                  }
                  placeholder="Destino ou regra comercial"
                />
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={form.deductFreightFromCredit}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        deductFreightFromCredit: event.target.checked
                      }))
                    }
                  />
                  Abater frete do credito do cliente
                </label>
                <p style={styles.helperText}>
                  Por padrao, o credito abate apenas o produto. Marque esta opcao para que o
                  frete tambem seja compensado do credito (exige saldo suficiente para produto
                  + frete).
                </p>
              </div>
            ) : null}
          </div>
          <div style={styles.actionStack}>
            <button type="button" onClick={onStart} style={styles.captureButton}>
              <Scale size={18} strokeWidth={2.4} />
              Calcular peso
            </button>
            <HelpTooltip content={TIPS.form.start} placement="top" shortcut="Ctrl+Enter" />
            <button type="button" onClick={onCancel} style={styles.secondaryButton}>
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
            setForm((prev) => ({ ...prev, vehicleId: id, carrierId: "" }));
            setShowVehicleModal(false);
            setVehicleRefreshKey((k) => k + 1);
          }}
        />
      ) : null}

      {showDriverModal ? (
        <QuickDriverModal
          desktopApi={desktopApi}
          onClose={() => setShowDriverModal(false)}
          onCreated={(id) => {
            setForm((prev) => ({ ...prev, driverId: id }));
            setShowDriverModal(false);
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
            setForm((prev) => ({ ...prev, carrierId: id }));
            setShowCarrierModal(false);
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
    </section>
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
          <img src={iconSrc} alt="" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
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
        <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "15px" }}>
          Cadastrar veiculo
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <PlateInput
          label="Placa"
          value={plateInput}
          onChange={setPlateInput}
          required
        />
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

function QuickDriverModal({ desktopApi, onClose, onCreated }: QuickModalProps) {
  const [name, setName] = useState("");
  const [documentInput, setDocumentInput] = useState("");
  const [phone, setPhone] = useState("");
  const [isIndependent, setIsIndependent] = useState(false);
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
        phone: normalizedPhone || undefined,
        isIndependent
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
        <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "15px" }}>
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
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={isIndependent}
            onChange={(e) => setIsIndependent(e.target.checked)}
          />
          Motorista independente (frete proprio)
        </label>
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
        <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "15px" }}>
          Cadastrar cliente
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <TextInput
          label="Nome fantasia"
          value={tradeName}
          onChange={setTradeName}
          required
        />
        <TextInput
          label="Razao social"
          value={legalName}
          onChange={setLegalName}
          required
        />
        <DocumentInput
          label="CPF/CNPJ"
          value={documentInput}
          onChange={setDocumentInput}
        />
        <PhoneInput label="Telefone" value={phone} onChange={setPhone} />
        <EmailInput
          label="Email"
          value={emailInput}
          onChange={setEmailInput}
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
        <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "15px" }}>
          Cadastrar transportadora
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <TextInput
          label="Nome"
          value={name}
          onChange={setName}
          required
        />
        <DocumentInput
          label="CPF/CNPJ"
          value={documentInput}
          onChange={setDocumentInput}
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
  background: "#fff",
  borderRadius: "8px",
  padding: "16px",
  width: "100%",
  maxWidth: "380px",
  boxShadow: "0 10px 25px rgba(0,0,0,0.15)"
};

function CloseOperationTypeDialog({
  defaultOperationType,
  onConfirm,
  onCancel
}: {
  defaultOperationType: OperationType;
  onConfirm: (operationType: OperationType) => void;
  onCancel: () => void;
}) {
  const [operationType, setOperationType] = useState<OperationType>(defaultOperationType);

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "15px" }}>
          Tipo de operacao na saida
        </h3>
        <p style={styles.muted}>Selecione como esta saida sera registrada.</p>
        <label style={styles.fieldLabel} title={TIPS.form.operationType}>
          Tipo
          <select
            value={operationType}
            onChange={(event) => setOperationType(event.target.value as OperationType)}
            style={styles.input}
          >
            <option value="invoice">Com nota (pedido de venda no OMIE)</option>
            <option value="internal">Interna (sem OMIE, permite offline)</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button
              type="button"
              onClick={() => onConfirm(operationType)}
              style={styles.primaryButton}
            >
              Confirmar saida
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

function CancelOperationDialog({
  onConfirm,
  onCancel
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "15px" }}>
          Cancelar operacao
        </h3>
        <p style={styles.muted}>Informe o motivo. Ele ficara registrado na auditoria e no sync.</p>
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
            placeholder="Ex.: Cliente desistiu da carga"
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
              Confirmar cancelamento
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
        <>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            style={{
              ...styles.smallPrimaryButton,
              width: "fit-content",
              opacity: retrying ? 0.6 : 1,
              cursor: retrying ? "not-allowed" : "pointer"
            }}
          >
            {retrying ? "Retentando..." : "Retentar OMIE"}
          </button>
          <HelpTooltip content={TIPS.operations.retryOmie} placement="left" />
        </>
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
          border: "1px dashed #cbd5e1",
          borderRadius: "8px",
          background: "#f8fafc"
        }}
      >
        <div style={{ fontSize: "12px", color: "#64748b" }}>
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
        border: "1px solid #e2e8f0",
        borderRadius: "8px",
        background: "#f8fafc"
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
        {details.appliedUnitPriceCents !== null
          ? `${formatMoney(details.appliedUnitPriceCents)}/ton`
          : "Preco nao definido"}
      </div>
      <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
        Origem: {sourceLabel}
      </div>
      <div style={{ fontSize: "12px", color: "#475569" }}>
        Base padrao: {formatMoney(details.baseUnitPriceCents)}/ton
      </div>
      <div style={{ fontSize: "12px", color: "#475569" }}>Economia: {savingsLabel}</div>
    </div>
  );
}

function PriceInput({
  valueCents,
  onChange,
  label = "Preco por tonelada",
  suffix = "/ton"
}: {
  valueCents: number | null;
  onChange: (cents: number | null) => void;
  label?: string;
  suffix?: string;
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
        hint={`Use virgula para centavos. Ex: 125,50${suffix ? ` (${suffix})` : ""}`}
      />
      {valueCents !== null ? (
        <span style={{ fontSize: "12px", color: "#64748b", marginTop: "2px", display: "block" }}>
          {centsToBRL(valueCents)}
          {suffix}
        </span>
      ) : null}
    </div>
  );
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

  return operations.filter((operation) => new Date(operation.updatedAt) >= start);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada.";
}

function subTabStyle(active: boolean) {
  return {
    border: "none",
    borderBottom: active ? "2px solid var(--kr-text-strong)" : "2px solid transparent",
    borderRadius: "0",
    padding: "6px 12px",
    background: "transparent",
    color: active ? "var(--kr-text-strong)" : "var(--kr-muted)",
    cursor: "pointer",
    fontWeight: active ? 700 : 400,
    fontSize: "12px"
  };
}

function operationsTabStyle(active: boolean): React.CSSProperties {
  return {
    border: "1px solid var(--kr-border)",
    borderRadius: "999px",
    padding: "6px 12px",
    background: active ? "#0f172a" : "var(--kr-surface)",
    color: active ? "#ffffff" : "var(--kr-text-strong)",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "12px"
  };
}

function fiscalProgressBadgeStyle(status: FiscalCloseProgress["status"]): React.CSSProperties {
  const tone =
    status === "success"
      ? { background: "#dcfce7", color: "#166534" }
      : status === "error"
        ? { background: "#fee2e2", color: "#991b1b" }
        : { background: "#dbeafe", color: "#1e40af" };
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
    ? { background: "#b91c1c", color: "#ffffff", borderColor: "#b91c1c" }
    : input.done
      ? { background: "#16a34a", color: "#ffffff", borderColor: "#16a34a" }
      : input.active
        ? { background: "#2563eb", color: "#ffffff", borderColor: "#2563eb" }
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

  if (operation.omieBillingStatus === "failed") {
    return {
      label: "Falhou",
      detail: operation.omieBillingMessage ?? "Faturamento nao confirmado.",
      tone: "danger",
      canRetry: true
    };
  }

  return {
    label: "Pendente",
    detail: "Aguardando faturamento OMIE.",
    tone: "warning",
    canRetry: true
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

function getThemeVariables(themeMode: ThemeMode): React.CSSProperties {
  if (themeMode === "dark") {
    return {
      "--kr-bg": "#020617",
      "--kr-surface": "#0f172a",
      "--kr-surface-soft": "#111827",
      "--kr-border": "#1e293b",
      "--kr-text": "#e5e7eb",
      "--kr-text-strong": "#f8fafc",
      "--kr-muted": "#94a3b8",
      "--kr-input-bg": "#020617",
      "--kr-input-border": "#334155",
      "--kr-shadow": "0 12px 36px rgba(0,0,0,0.35)",
      "--kr-card-bg": "#0b1326",
      "--kr-card-border": "#1e293b",
      "--kr-card-hover": "#111c38",
      "--kr-chart-1": "#60a5fa",
      "--kr-chart-2": "#38bdf8",
      "--kr-chart-3": "#fbbf24",
      "--kr-chart-4": "#f87171",
      "--kr-chart-5": "#34d399",
      "--kr-chart-6": "#a78bfa",
      "--kr-chart-7": "#f472b6",
      "--kr-chart-axis": "#64748b",
      "--kr-chart-grid": "#1e293b",
      "--kr-chart-tooltip-bg": "#0f172a",
      "--kr-chart-tooltip-border": "#334155",
      "--kr-chart-tooltip-text": "#e5e7eb",
      "--kr-info-bg": "#172554",
      "--kr-info-border": "#1e40af",
      "--kr-info-text": "#bfdbfe",
      "--kr-tooltip-bg": "#1e3a8a",
      "--kr-tooltip-text": "#eff6ff",
      "--kr-tooltip-border": "#3b82f6",
      "--kr-tooltip-kbd-bg": "#172554",
      "--kr-tooltip-kbd-border": "#3b82f6",
      "--kr-tooltip-shortcut": "#bfdbfe"
    } as React.CSSProperties;
  }

  return {
    "--kr-bg": "#f8fafc",
    "--kr-surface": "#ffffff",
    "--kr-surface-soft": "#f8fafc",
    "--kr-border": "#e2e8f0",
    "--kr-text": "#0f172a",
    "--kr-text-strong": "#0f172a",
    "--kr-muted": "#64748b",
    "--kr-input-bg": "#ffffff",
    "--kr-input-border": "#cbd5e1",
    "--kr-shadow": "0 12px 36px rgba(15, 23, 42, 0.08)",
    "--kr-card-bg": "#ffffff",
    "--kr-card-border": "#e2e8f0",
    "--kr-card-hover": "#f1f5f9",
    "--kr-chart-1": "#2563eb",
    "--kr-chart-2": "#0ea5e9",
    "--kr-chart-3": "#f59e0b",
    "--kr-chart-4": "#ef4444",
    "--kr-chart-5": "#10b981",
    "--kr-chart-6": "#8b5cf6",
    "--kr-chart-7": "#ec4899",
    "--kr-chart-axis": "#64748b",
    "--kr-chart-grid": "#e2e8f0",
    "--kr-chart-tooltip-bg": "#ffffff",
    "--kr-chart-tooltip-border": "#e2e8f0",
    "--kr-chart-tooltip-text": "#0f172a",
    "--kr-info-bg": "#eff6ff",
    "--kr-info-border": "#bfdbfe",
    "--kr-info-text": "#1d4ed8",
    "--kr-tooltip-bg": "#1e3a8a",
    "--kr-tooltip-text": "#eff6ff",
    "--kr-tooltip-border": "#3b82f6",
    "--kr-tooltip-kbd-bg": "#1e293b",
    "--kr-tooltip-kbd-border": "#334155",
    "--kr-tooltip-shortcut": "#cbd5e1"
  } as React.CSSProperties;
}

interface VehicleFormData {
  plate: string;
  description: string;
  carrierId: string;
}

function VehicleListView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [vehicles, setVehicles] = useState<Array<Record<string, unknown>>>([]);
  const [carriers, setCarriers] = useState<CarrierCacheEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleFormData>({ plate: "", description: "", carrierId: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadVehicles();
    loadCarriers();
  }, [search]);

  async function loadVehicles(): Promise<void> {
    const result = await desktopApi.queryCache({
      entityType: "vehicle",
      search: search || undefined,
      limit: 200
    });
    setVehicles(result.rows as Array<Record<string, unknown>>);
    setLoading(false);
  }

  async function loadCarriers(): Promise<void> {
    const result = await desktopApi.queryCache({
      entityType: "carrier",
      limit: 200
    });
    setCarriers(result.rows as CarrierCacheEntry[]);
  }

  function resetForm(): void {
    setForm({ plate: "", description: "", carrierId: "" });
    setEditingId(null);
    setFormError(null);
  }

  function openCreate(): void {
    resetForm();
    setShowForm(true);
  }

  function openEdit(item: Record<string, unknown>): void {
    setForm({
      plate: String(item.plate ?? ""),
      description: String(item.description ?? ""),
      carrierId: String(item.carrier_id ?? "")
    });
    setEditingId(String(item.id));
    setShowForm(true);
  }

  async function handleSave(): Promise<void> {
    const normalizedPlate = normalizePlate(form.plate);
    if (!normalizedPlate) {
      setFormError("Placa e obrigatoria.");
      return;
    }
    if (!isValidPlate(normalizedPlate)) {
      setFormError("Placa invalida. Use o formato ABC1234 ou ABC1D23.");
      return;
    }
    try {
      if (editingId) {
        await desktopApi.vehiclesUpdate(editingId, {
          plate: normalizedPlate,
          description: form.description.trim() || undefined,
          carrierId: form.carrierId || null
        });
      } else {
        await desktopApi.vehiclesCreate({
          plate: normalizedPlate,
          description: form.description.trim() || undefined,
          carrierId: form.carrierId || undefined
        });
      }
      setShowForm(false);
      resetForm();
      await loadVehicles();
      setMsg("Veiculo salvo.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar.");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("Confirmar exclusao?")) return;
    try {
      await desktopApi.vehiclesDelete(id);
      await loadVehicles();
      setMsg("Excluido.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erro.");
    }
  }

  async function handleLinkCarrier(vehicleId: string, carrierId: string): Promise<void> {
    try {
      await desktopApi.vehiclesLinkCarrier(vehicleId, carrierId);
      await loadVehicles();
      setMsg("Transportadora vinculada.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erro ao vincular.");
    }
  }

  if (loading) return <p style={{ color: "#64748b" }}>Carregando veiculos...</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar veiculo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "160px" }}
        />
        <button type="button" onClick={openCreate} style={styles.primaryButton}>
          + Novo Veiculo
        </button>
      </div>

      {msg ? (
        <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "6px", fontSize: "13px" }}>
          {msg}
        </p>
      ) : null}

      {showForm ? (
        <div style={{ ...styles.card, marginBottom: "12px", padding: "12px" }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "14px" }}>
            {editingId ? "Editar Veiculo" : "Novo Veiculo"}
          </h3>
          {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
            <PlateInput
              label="Placa"
              value={form.plate}
              onChange={(plate) => setForm({ ...form, plate })}
              required
            />
            <TextInput
              label="Descricao"
              value={form.description}
              onChange={(description) => setForm({ ...form, description })}
            />
          </div>
          <Field label="Transportadora">
            <select
              value={form.carrierId}
              onChange={(e) => setForm({ ...form, carrierId: e.target.value })}
              style={getInputStyle(false)}
            >
              <option value="">Selecione a transportadora</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>
              Salvar
            </button>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {vehicles.length === 0 ? (
        <p style={{ color: "#64748b" }}>Nenhum veiculo cadastrado.</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {vehicles.map((item) => {
            const plate = String(item.plate ?? "");
            const description = String(item.description ?? "");
            const currentCarrierId = String(item.carrier_id ?? "");
            return (
              <div key={String(item.id)} style={{ ...styles.card, padding: "12px 16px" }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div>
                    <strong>{plate}</strong>
                    {description ? (
                      <span style={{ color: "#64748b", fontSize: "13px", marginLeft: "8px" }}>
                        {description}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <select
                      value={currentCarrierId}
                      onChange={(e) => handleLinkCarrier(String(item.id), e.target.value)}
                      style={{ ...styles.input, width: "180px", fontSize: "13px" }}
                    >
                      <option value="">Sem transportadora</option>
                      {carriers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      style={styles.secondaryButton}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(String(item.id))}
                      style={{
                        ...styles.secondaryButton,
                        color: "#b91c1c",
                        borderColor: "#fecaca"
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TransportView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [transportTab, setTransportTab] = useState<"vehicles" | "drivers" | "carriers">("vehicles");

  return (
    <div>
      <nav style={{ ...styles.subTabs, marginTop: 0 }}>
        <button
          type="button"
          onClick={() => setTransportTab("vehicles")}
          style={subTabStyle(transportTab === "vehicles")}
        >
          Veiculos
        </button>
        <button
          type="button"
          onClick={() => setTransportTab("drivers")}
          style={subTabStyle(transportTab === "drivers")}
        >
          Motoristas
        </button>
        <button
          type="button"
          onClick={() => setTransportTab("carriers")}
          style={subTabStyle(transportTab === "carriers")}
        >
          Transportadoras
        </button>
      </nav>
      <div style={{ marginTop: "20px" }}>
        {transportTab === "vehicles" ? <VehicleListView desktopApi={desktopApi} /> : null}
        {transportTab === "drivers" ? (
          <SimpleCrudList
            desktopApi={desktopApi}
            entityType="driver"
            title="Motoristas"
            fields={[
              { key: "name", label: "Nome", required: true },
              { key: "document", label: "CPF", required: false },
              { key: "phone", label: "Telefone", required: false }
            ]}
          />
        ) : null}
        {transportTab === "carriers" ? <CarrierListView desktopApi={desktopApi} /> : null}
      </div>
    </div>
  );
}

interface CarrierFormData {
  name: string;
  document: string;
}

function CarrierListView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [carriers, setCarriers] = useState<CarrierCacheEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CarrierFormData>({ name: "", document: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);
  const [carrierVehicles, setCarrierVehicles] = useState<
    Array<{ id: string; plate: string; description: string | null }>
  >([]);

  useEffect(() => {
    loadCarriers();
  }, [search]);

  useEffect(() => {
    async function loadVehicles() {
      if (!selectedCarrier || !desktopApi) return;
      try {
        const vehicles = await desktopApi.carriersGetVehicles(selectedCarrier);
        setCarrierVehicles(vehicles);
      } catch {
        setCarrierVehicles([]);
      }
    }
    loadVehicles();
  }, [selectedCarrier, desktopApi]);

  async function loadCarriers(): Promise<void> {
    try {
      const result = await desktopApi.queryCache({
        entityType: "carrier",
        search: search || undefined,
        limit: 200
      });
      setCarriers(result.rows as CarrierCacheEntry[]);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  function resetForm(): void {
    setForm({ name: "", document: "" });
    setEditingId(null);
    setFormError(null);
  }

  function openCreate(): void {
    resetForm();
    setShowForm(true);
  }

  function openEdit(carrier: CarrierCacheEntry): void {
    setForm({ name: carrier.name, document: carrier.document ?? "" });
    setEditingId(carrier.id);
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave(): Promise<void> {
    if (!form.name.trim()) {
      setFormError("Nome e obrigatorio.");
      return;
    }
    const normalizedDocument = normalizeDocument(form.document);
    if (form.document.trim() && !isValidDocument(normalizedDocument)) {
      setFormError("CPF/CNPJ invalido.");
      return;
    }
    try {
      if (editingId) {
        await desktopApi.carriersUpdate(editingId, {
          name: form.name.trim(),
          document: normalizedDocument || undefined
        });
        setMessage("Transportadora atualizada.");
      } else {
        await desktopApi.carriersCreate({
          name: form.name.trim(),
          document: normalizedDocument || undefined
        });
        setMessage("Transportadora criada.");
      }
      setShowForm(false);
      resetForm();
      setLoading(true);
      await loadCarriers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar.");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("Deseja excluir esta transportadora?")) return;
    try {
      await desktopApi.carriersDelete(id);
      setMessage("Transportadora excluida.");
      await loadCarriers();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao excluir.");
    }
  }

  if (loading) return <p style={{ color: "#64748b" }}>Carregando transportadoras...</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar transportadora..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "160px" }}
        />
        <button type="button" onClick={openCreate} style={styles.primaryButton}>
          + Nova Transportadora
        </button>
      </div>

      {message ? (
        <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "6px", fontSize: "13px" }}>
          {message}
        </p>
      ) : null}

      {showForm ? (
        <div style={{ ...styles.card, marginBottom: "12px", padding: "12px" }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "14px" }}>
            {editingId ? "Editar Transportadora" : "Nova Transportadora"}
          </h3>
          {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
            <TextInput
              label="Nome"
              value={form.name}
              onChange={(name) => setForm({ ...form, name })}
              required
            />
            <DocumentInput
              label="CNPJ/CPF"
              value={form.document}
              onChange={(document) => setForm({ ...form, document })}
            />
          </div>
          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>
              Salvar
            </button>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {carriers.length === 0 ? (
        <p style={{ color: "#64748b" }}>Nenhuma transportadora cadastrada.</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {carriers.map((carrier) => (
            <div
              key={carrier.id}
              style={{ ...styles.card, padding: "12px 16px", cursor: "pointer" }}
              onClick={() => setSelectedCarrier(carrier.id === selectedCarrier ? null : carrier.id)}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <strong>{carrier.name}</strong>
                  {carrier.document ? (
                    <span style={{ color: "#64748b", fontSize: "13px", marginLeft: "8px" }}>
                      {carrier.document}
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontSize: "11px",
                      marginLeft: "8px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: carrier.source === "omie" ? "#dbeafe" : "#dcfce7",
                      color: carrier.source === "omie" ? "#1e40af" : "#166534"
                    }}
                  >
                    {carrier.source === "omie" ? "OMIE" : "LOCAL"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(carrier);
                    }}
                    style={styles.secondaryButton}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(carrier.id);
                    }}
                    style={{ ...styles.secondaryButton, color: "#b91c1c", borderColor: "#fecaca" }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
              {selectedCarrier === carrier.id ? (
                <div
                  style={{ marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}
                >
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#475569" }}>
                    Veiculos vinculados
                  </h4>
                  {carrierVehicles.length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0 }}>
                      Nenhum veiculo vinculado.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {carrierVehicles.map((v) => (
                        <span
                          key={v.id}
                          style={{
                            fontSize: "13px",
                            background: "#f1f5f9",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            color: "#0f172a"
                          }}
                        >
                          {v.plate}
                          {v.description ? ` — ${v.description}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScaleView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [host, setHost] = useState("192.168.1.100");
  const [port, setPort] = useState("4001");
  const [autoConnect, setAutoConnect] = useState(false);
  const [sampleDurationSeconds, setSampleDurationSeconds] = useState("5");
  const [sampleIntervalMs, setSampleIntervalMs] = useState("250");
  const [requireStable, setRequireStable] = useState(true);
  const [minStableSeconds, setMinStableSeconds] = useState("1");
  const [maxVariationKg, setMaxVariationKg] = useState("50");
  const [minWeightKg, setMinWeightKg] = useState("1000");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [reading, setReading] = useState<{ weightKg: number; stable: boolean } | null>(null);
  const [status, setStatus] = useState<string>("Desconectado");
  const [error, setError] = useState<string | null>(null);

  // Estatísticas em tempo real
  const [readings, setReadings] = useState<Array<{ weightKg: number; stable: boolean; at: number }>>([]);
  const [stats, setStats] = useState({
    count: 0,
    min: 0,
    max: 0,
    avg: 0,
    variation: 0,
    stableCount: 0,
    unstableCount: 0
  });
  const [testProgress, setTestProgress] = useState<string | null>(null);

  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  useEffect(() => {
    if (!desktopApi) return;

    const handler = (r: { weightKg: number; stable: boolean }) => {
      setReading(r);
      setReadings((prev) => {
        const next = [...prev, { ...r, at: Date.now() }].slice(-100);
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
        return next;
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
          await desktopApi.scaleConnect(config.connection);
          if (canceled) return;
          setConnected(true);
          setStatus("Conectado");
        }
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar configuracao da balanca");
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

  async function handleConnect(): Promise<void> {
    setError(null);
    setConfigMessage(null);
    try {
      const config = await desktopApi.scaleSaveConfig(buildScaleConfigInput());
      applyScaleConfig(config);
      await desktopApi.scaleConnect(config.connection);
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
    setReadings([]);
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

  async function handleTestInstant(): Promise<void> {
    setTesting(true);
    setError(null);
    setConfigMessage(null);
    setTestResult(null);
    setTestProgress("Fazendo leitura instantanea...");

    try {
      const config = await desktopApi.scaleSaveConfig(buildScaleConfigInput());
      applyScaleConfig(config);

      if (!connectedRef.current) {
        await desktopApi.scaleConnect(config.connection);
        setConnected(true);
        setStatus("Conectado");
      }

      const instant = await desktopApi.scaleRead();
      setTestProgress(null);
      setTestResult(
        `Leitura instantanea: ${new Intl.NumberFormat("pt-BR").format(instant.weightKg)} kg (${instant.stable ? "estavel" : "instavel"})`
      );
    } catch (err) {
      setTestProgress(null);
      setError(err instanceof Error ? err.message : "Falha na leitura instantanea");
    } finally {
      setTesting(false);
    }
  }

  async function handleTestCapture(): Promise<void> {
    setTesting(true);
    setError(null);
    setConfigMessage(null);
    setTestResult(null);
    setTestProgress("Iniciando captura com media...");

    try {
      const config = await desktopApi.scaleSaveConfig(buildScaleConfigInput());
      applyScaleConfig(config);

      if (!connectedRef.current) {
        await desktopApi.scaleConnect(config.connection);
        setConnected(true);
        setStatus("Conectado");
      }

      setTestProgress(`Coletando amostras durante ${config.stability.sampleDurationMs / 1000}s...`);

      const sampled = await desktopApi.scaleReadSampled();
      setTestProgress(null);
      setTestResult(
        `Captura aprovada: ${new Intl.NumberFormat("pt-BR").format(sampled.weightKg)} kg (${sampled.stable ? "estavel" : "instavel"}) em ${Math.round(config.stability.sampleDurationMs / 1000)}s de amostragem.`
      );
    } catch (err) {
      setTestProgress(null);
      setError(err instanceof Error ? err.message : "Falha no teste de captura");
    } finally {
      setTesting(false);
    }
  }

  function applyScaleConfig(config: ScaleConfiguration): void {
    setHost(config.connection.host);
    setPort(String(config.connection.port));
    setAutoConnect(config.connection.autoConnect);
    setSampleDurationSeconds(String(Math.max(1, Math.round(config.stability.sampleDurationMs / 1000))));
    setSampleIntervalMs(String(config.stability.sampleIntervalMs));
    setRequireStable(config.stability.requireStable);
    setMinStableSeconds(String(Math.round(config.stability.minStableMs / 1000)));
    setMaxVariationKg(String(config.stability.maxVariationKg));
    setMinWeightKg(String(config.stability.minWeightKg));
  }

  function buildScaleConfigInput(): ScaleConfigurationInput {
    return {
      connection: {
        host: host.trim() || "192.168.1.100",
        port: parseInteger(port, 4001),
        timeoutMs: 3000,
        reconnectIntervalMs: 5000,
        maxReconnectAttempts: 10,
        autoConnect
      },
      stability: {
        sampleDurationMs: parseInteger(sampleDurationSeconds, 5) * 1000,
        sampleIntervalMs: parseInteger(sampleIntervalMs, 250),
        requireStable,
        minStableMs: parseInteger(minStableSeconds, 1) * 1000,
        maxVariationKg: parseInteger(maxVariationKg, 50),
        minWeightKg: parseInteger(minWeightKg, 1000)
      }
    };
  }

  function parseInteger(value: string, fallback: number): number {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return (
    <div>
      <section style={styles.twoColumns}>
        <article style={styles.panel}>
          <h2 style={styles.panelTitle}>Configuracao da Balanca Toledo</h2>
          <TextInput
            label="Host / IP"
            value={host}
            onChange={setHost}
            placeholder="192.168.1.100"
          />
          <NumberInput
            label="Porta TCP"
            value={port}
            onChange={setPort}
            placeholder="4001"
            maxLength={5}
            minLength={1}
            hint="Apenas numeros (1-65535)."
          />
          <div style={{ marginTop: "10px" }}>
            <button
              type="button"
              onClick={handleDiscover}
              disabled={discovering}
              style={{ ...styles.secondaryButton, opacity: discovering ? 0.5 : 1 }}
            >
              {discovering ? "Procurando..." : "Procurar balanca"}
            </button>
          </div>
          <label style={{ ...styles.checkboxLabel, marginTop: "10px" }}>
            <input
              type="checkbox"
              checked={autoConnect}
              onChange={(event) => setAutoConnect(event.target.checked)}
            />
            Auto conectar ao abrir a tela da balanca
          </label>
          {error ? <p style={styles.errorMessage}>{error}</p> : null}
          {configMessage ? (
            <p style={{ ...styles.muted, color: "#166534", fontWeight: 700 }}>{configMessage}</p>
          ) : null}
          <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
            <button
              type="button"
              onClick={handleConnect}
              disabled={connected || !configLoaded}
              style={{ ...styles.primaryButton, opacity: connected || !configLoaded ? 0.5 : 1 }}
            >
              Conectar
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={!connected}
              style={{ ...styles.secondaryButton, opacity: connected ? 1 : 0.5 }}
            >
              Desconectar
            </button>
          </div>
        </article>

        <article style={styles.panel}>
          <h2 style={styles.panelTitle}>Leitura ao Vivo</h2>
          <p style={styles.muted}>Status: {status} | Amostras: {stats.count}</p>
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

          {connected && stats.count > 0 && (
            <div style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
              <h4 style={{ margin: "0", fontSize: "13px", color: "#0f172a" }}>Estatisticas (ultimas 100 leituras)</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div style={{ background: "#f8fafc", padding: "8px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Minimo</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>{new Intl.NumberFormat("pt-BR").format(stats.min)} kg</div>
                </div>
                <div style={{ background: "#f8fafc", padding: "8px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Maximo</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>{new Intl.NumberFormat("pt-BR").format(stats.max)} kg</div>
                </div>
                <div style={{ background: "#f8fafc", padding: "8px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Media</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>{new Intl.NumberFormat("pt-BR").format(stats.avg)} kg</div>
                </div>
                <div style={{ background: "#f8fafc", padding: "8px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Variacao</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: stats.variation > parseInt(maxVariationKg, 10) ? "#dc2626" : "#0f172a" }}>
                    {new Intl.NumberFormat("pt-BR").format(stats.variation)} kg
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>{stats.stableCount} estaveis</span>
                <span style={{ color: "#d97706", fontWeight: 700 }}>{stats.unstableCount} instaveis</span>
              </div>
            </div>
          )}
        </article>

        <article style={styles.panel}>
          <h2 style={styles.panelTitle}>Criterios de Captura</h2>
          <NumberInput
            label="Tempo para tirar media (s)"
            value={sampleDurationSeconds}
            onChange={setSampleDurationSeconds}
            placeholder="5"
            maxLength={2}
            minLength={1}
            hint="Duracao da janela de amostragem para calcular a media."
          />
          <NumberInput
            label="Intervalo entre leituras (ms)"
            value={sampleIntervalMs}
            onChange={setSampleIntervalMs}
            placeholder="250"
            maxLength={4}
            minLength={2}
            hint="Quanto menor, mais amostras e precisao."
          />
          <label style={{ ...styles.checkboxLabel, marginTop: "10px" }}>
            <input
              type="checkbox"
              checked={requireStable}
              onChange={(event) => setRequireStable(event.target.checked)}
            />
            Exigir peso estavel para capturar
          </label>
          <NumberInput
            label="Tempo minimo estavel (s)"
            value={minStableSeconds}
            onChange={setMinStableSeconds}
            disabled={!requireStable}
            placeholder="1"
            maxLength={2}
            hint="O caminhao precisa ficar parado na balanca por esse tempo."
          />
          <NumberInput
            label="Tolerancia de oscilacao (kg)"
            value={maxVariationKg}
            onChange={setMaxVariationKg}
            placeholder="50"
            maxLength={5}
            hint="Se a janela variar mais que isso, a captura e rejeitada."
          />
          <NumberInput
            label="Peso minimo para captura (kg)"
            value={minWeightKg}
            onChange={setMinWeightKg}
            placeholder="1000"
            maxLength={6}
            hint="Evita capturar com a balanca vazia."
          />

          {testProgress ? (
            <p style={{ ...styles.muted, color: "#0369a1", fontWeight: 700 }}>{testProgress}</p>
          ) : null}
          {testResult ? (
            <p style={{ ...styles.muted, color: "#166534", fontWeight: 700 }}>{testResult}</p>
          ) : null}

          <div style={{ display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={saving || !configLoaded}
              style={{ ...styles.secondaryButton, opacity: saving || !configLoaded ? 0.5 : 1 }}
            >
              {saving ? "Salvando..." : "Salvar configuracao"}
            </button>
            <button
              type="button"
              onClick={handleTestInstant}
              disabled={testing || !configLoaded}
              style={{ ...styles.secondaryButton, opacity: testing || !configLoaded ? 0.5 : 1 }}
            >
              {testing ? "Testando..." : "Testar leitura instantanea"}
            </button>
            <button
              type="button"
              onClick={handleTestCapture}
              disabled={testing || !configLoaded}
              style={{ ...styles.primaryButton, opacity: testing || !configLoaded ? 0.5 : 1 }}
            >
              {testing ? "Testando..." : "Testar captura com media"}
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}

function OmieViewer({
  desktopApi,
  entityType,
  title,
  displayField,
  subField
}: {
  desktopApi: KyberRockDesktopApi;
  entityType: "product" | "payment_term";
  title: string;
  displayField: string;
  subField: string;
}) {
  const pageSize = entityType === "product" ? 50 : 200;
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    loadItems();
  }, [search, page]);

  async function loadItems(): Promise<void> {
    const result = await desktopApi.queryCache({
      entityType: entityType as unknown as "product" | "payment_term",
      search: search || undefined,
      limit: pageSize,
      offset: page * pageSize
    });
    setItems(result.rows as Array<Record<string, unknown>>);
    setTotal(result.total);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        <input
          placeholder={`Buscar ${title.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "160px" }}
        />
      </div>
      {items.length === 0 ? (
        <p style={{ color: "#64748b" }}>
          Nenhum registro encontrado. Execute a sincronizacao OMIE.
        </p>
      ) : (
        items.map((item) => (
          <div
            key={String(item.id)}
            style={{ ...styles.operationRow, borderTop: "1px solid #e2e8f0" }}
          >
            <div>
              <strong>{String(item[displayField] ?? "")}</strong>
              {subField && item[subField] ? (
                <p style={{ ...styles.muted, margin: "2px 0 0 0", fontSize: "13px" }}>
                  {String(item[subField])}
                </p>
              ) : null}
            </div>
          </div>
        ))
      )}
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "10px"
        }}
      >
        <span style={styles.muted}>
          Mostrando {total === 0 ? 0 : page * pageSize + 1}-{Math.min(total, (page + 1) * pageSize)}{" "}
          de {total}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={styles.secondaryButton}
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * pageSize >= total}
            style={styles.secondaryButton}
          >
            Proximos {pageSize}
          </button>
        </div>
      </div>
    </div>
  );
}

function SimpleCrudList({
  desktopApi,
  entityType,
  title,
  fields
}: {
  desktopApi: KyberRockDesktopApi;
  entityType: "vehicle" | "driver";
  title: string;
  fields: Array<{ key: string; label: string; required: boolean }>;
}) {
  const [items, setItems] = useState<Array<Record<string, string | null>>>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    loadItems();
  }, [search]);

  async function loadItems(): Promise<void> {
    const result = await desktopApi.queryCache({
      entityType: entityType,
      search: search || undefined,
      limit: 200
    });
    setItems(result.rows as Array<Record<string, string | null>>);
  }

  function resetForm(): void {
    const init: Record<string, string> = {};
    for (const f of fields) init[f.key] = "";
    setFormData(init);
    setEditingId(null);
  }

  function openCreate(): void {
    resetForm();
    setShowForm(true);
  }

  function openEdit(item: Record<string, string | null>): void {
    const data: Record<string, string> = {};
    for (const f of fields) data[f.key] = item[f.key] ?? "";
    setFormData(data);
    setEditingId(item.id as string);
    setShowForm(true);
  }

  async function handleSave(): Promise<void> {
    const requiredField = fields.find((f) => f.required && !formData[f.key].trim());
    if (requiredField) return;

    try {
      const input: Record<string, string> = {};
      for (const f of fields) {
        const raw = formData[f.key].trim();
        if (!raw) continue;
        if (f.key === "document") {
          const normalized = normalizeDocument(raw);
          if (!isValidDocument(normalized)) {
            setMsg(f.label + " invalido.");
            return;
          }
          input[f.key] = normalized;
        } else if (f.key === "phone") {
          const normalized = normalizePhone(raw);
          if (normalized.length !== 10 && normalized.length !== 11) {
            setMsg("Telefone invalido. Informe com DDD (11 digitos).");
            return;
          }
          input[f.key] = normalized;
        } else {
          input[f.key] = raw;
        }
      }

      if (editingId) {
        if (entityType === "vehicle") {
          await desktopApi.vehiclesUpdate(editingId, input as unknown as { plate?: string });
        } else {
          await desktopApi.driversUpdate(editingId, input as unknown as { name?: string });
        }
      } else {
        if (entityType === "vehicle") {
          await desktopApi.vehiclesCreate(input as unknown as { plate: string });
        } else {
          await desktopApi.driversCreate(input as unknown as { name: string });
        }
      }

      setShowForm(false);
      resetForm();
      await loadItems();
      setMsg(`${entityType === "vehicle" ? "Veiculo" : "Motorista"} salvo.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erro");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("Confirmar exclusao?")) return;
    if (entityType === "vehicle") {
      await desktopApi.vehiclesDelete(id);
    } else {
      await desktopApi.driversDelete(id);
    }
    await loadItems();
    setMsg("Excluido.");
  }

  function displayLabel(item: Record<string, string | null>): string {
    if (entityType === "vehicle") return item.plate ?? item.id ?? "";
    return item.name ?? item.document ?? item.id ?? "";
  }

  function displaySub(item: Record<string, string | null>): string {
    if (entityType === "vehicle") {
      return item.description ? `Desc: ${item.description}` : "";
    }
    const parts: string[] = [];
    if (item.document) parts.push(`CPF: ${item.document}`);
    if (item.phone) parts.push(item.phone);
    return parts.join(" | ");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        <input
          placeholder={`Buscar ${title.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "160px" }}
        />
        <button type="button" onClick={openCreate} style={styles.primaryButton}>
          + Novo
        </button>
      </div>

      {msg ? (
        <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "6px", fontSize: "13px" }}>
          {msg}
        </p>
      ) : null}

      {showForm ? (
        <div style={{ ...styles.card, marginBottom: "12px", padding: "12px" }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "14px" }}>{editingId ? "Editar" : "Novo"}</h3>
          {fields.map((f) => {
            const value = formData[f.key] || "";
            if (f.key === "document") {
              return (
                <DocumentInput
                  key={f.key}
                  label={f.label}
                  value={value}
                  required={f.required}
                  onChange={(v) => setFormData({ ...formData, [f.key]: v })}
                />
              );
            }
            if (f.key === "phone") {
              return (
                <PhoneInput
                  key={f.key}
                  label={f.label}
                  value={value}
                  required={f.required}
                  onChange={(v) => setFormData({ ...formData, [f.key]: v })}
                />
              );
            }
            return (
              <TextInput
                key={f.key}
                label={f.label}
                value={value}
                required={f.required}
                onChange={(v) => setFormData({ ...formData, [f.key]: v })}
              />
            );
          })}
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>
              Salvar
            </button>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p style={{ color: "#64748b" }}>Nenhum registro encontrado.</p>
      ) : (
        items.map((item) => (
          <div key={item.id as string} style={styles.operationRow}>
            <div>
              <strong>{displayLabel(item)}</strong>
              {displaySub(item) ? (
                <p style={{ ...styles.muted, margin: "2px 0 0 0", fontSize: "13px" }}>
                  {displaySub(item)}
                </p>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" onClick={() => openEdit(item)} style={styles.secondaryButton}>
                Editar
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item.id as string)}
                style={{ ...styles.secondaryButton, color: "#b91c1c", borderColor: "#fecaca" }}
              >
                Excluir
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function PriceTableListView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
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
  const [selectedProductId, setSelectedProductId] = useState("");
  const [priceReais, setPriceReais] = useState("");
  const [message, setPriceMessage] = useState<string | null>(null);

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

    const password = window.prompt("Digite a senha de 4 digitos para alterar precos:");
    if (!password) return;
    const valid = await desktopApi.verifyPriceChangePassword(password);
    if (!valid) {
      setPriceMessage("Senha incorreta.");
      return;
    }

    await desktopApi.productDefaultPricesUpsert({
      productId: selectedProductId,
      unitPriceCents,
      unit: "ton"
    });
    setSelectedProductId("");
    setPriceReais("");
    setPriceMessage("Preco padrao salvo.");
    await loadPrices();
  }

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <div>
        <h3 style={{ marginTop: 0 }}>Preco padrao por produto</h3>
        <p style={styles.muted}>
          Este preco e usado quando o cliente nao tem preco especial cadastrado.
        </p>
      </div>

      {message ? (
        <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "8px" }}>{message}</p>
      ) : null}

      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
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
          style={{ ...styles.primaryButton, padding: "10px 14px" }}
        >
          Salvar preco
        </button>
      </div>

      {items.length === 0 ? (
        <p style={{ color: "#64748b", marginBottom: "24px" }}>Nenhum produto encontrado.</p>
      ) : (
        <div style={{ marginBottom: "24px" }}>
          {items.map((item) => (
            <div
              key={item.productId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                padding: "8px 0",
                borderTop: "1px solid #e2e8f0"
              }}
            >
              <span>
                <strong>{item.productDescription}</strong>
                {item.productCode ? ` (${item.productCode})` : ""}
              </span>
              <span style={{ fontWeight: 700 }}>{formatMoney(item.unitPriceCents)}/ton</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    margin: 0,
    padding: "16px",
    fontFamily: "Segoe UI, Arial, sans-serif",
    color: "var(--kr-text)",
    background: "var(--kr-bg)"
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
    gap: "12px",
    alignItems: "stretch",
    minHeight: "calc(100vh - 32px)"
  },
  sidebar: {
    width: "220px",
    flexShrink: 0,
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "10px",
    padding: "12px 0",
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    boxShadow: "var(--kr-shadow)"
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
    overflowY: "auto" as const
  },
  contentColumn: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
    minWidth: 0
  },
  topbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: "10px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)"
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
    gap: "12px"
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
    padding: "20px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
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
    margin: "8px 0",
    fontSize: "32px",
    lineHeight: 1.05
  },
  subtitle: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "15px"
  },
  actions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const
  },
  primaryButton: {
    border: "none",
    borderRadius: "8px",
    padding: "8px 12px",
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  secondaryButton: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "8px",
    padding: "8px 12px",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px"
  },
  twoColumns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "12px",
    marginTop: "12px"
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
  panel: {
    marginTop: "12px",
    padding: "16px",
    borderRadius: "12px",
    background: "var(--kr-surface)"
  },
  entryShell: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "14px",
    marginTop: "12px"
  },
  entryHero: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    padding: "22px",
    borderRadius: "20px",
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #2563eb 100%)",
    color: "#ffffff",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.18)"
  },
  liveWeightCard: {
    minWidth: "210px",
    padding: "14px",
    borderRadius: "16px",
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.22)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px"
  },
  metricHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  metricLabel: {
    color: "#bfdbfe",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em"
  },
  metricValue: {
    fontSize: "28px",
    lineHeight: 1,
    color: "#ffffff"
  },
  metricHint: {
    color: "#dbeafe",
    fontSize: "12px"
  },
  entryGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1.1fr) minmax(260px, 1fr) minmax(240px, 0.9fr)",
    gap: "14px",
    alignItems: "start"
  },
  entryCard: {
    padding: "16px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  entrySummaryCard: {
    padding: "16px",
    borderRadius: "16px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-input-border)",
    boxShadow: "var(--kr-shadow)"
  },
  freightBox: {
    display: "grid",
    gap: "10px",
    marginTop: "12px",
    padding: "12px",
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
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "12px"
  },
  sectionIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "10px",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 900
  },
  sectionTitle: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "14px"
  },
  sectionDescription: {
    margin: "2px 0 0 0",
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  helperText: {
    margin: "-2px 0 10px 0",
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
    flexDirection: "column" as const,
    gap: "8px",
    marginTop: "14px"
  },
  captureButton: {
    border: "none",
    borderRadius: "12px",
    padding: "12px 14px",
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
    marginTop: "12px",
    padding: "16px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)"
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
    background: "#e0f2fe",
    color: "#075985",
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
    border: "1px solid var(--kr-border)",
    borderRadius: "14px"
  },
  operationsTableRow: {
    display: "grid",
    gridTemplateColumns: "96px minmax(180px, 1.4fr) minmax(120px, 0.8fr) 132px",
    alignItems: "center",
    gap: "10px",
    padding: "10px 12px",
    borderTop: "1px solid var(--kr-border)",
    fontSize: "13px",
    color: "var(--kr-text)"
  },
  canceledOperationsTableRow: {
    display: "grid",
    gridTemplateColumns: "96px minmax(180px, 1.1fr) 150px minmax(180px, 1.2fr)",
    alignItems: "center",
    gap: "10px",
    padding: "10px 12px",
    borderTop: "1px solid var(--kr-border)",
    fontSize: "13px",
    color: "var(--kr-text)"
  },
  closedOperationsTableRow: {
    display: "grid",
    gridTemplateColumns: "96px minmax(180px, 1.2fr) minmax(120px, 0.8fr) 150px minmax(190px, 1fr)",
    alignItems: "center",
    gap: "10px",
    padding: "10px 12px",
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
    textTransform: "uppercase" as const
  },
  plateBadge: {
    justifySelf: "start",
    padding: "5px 8px",
    borderRadius: "8px",
    background: "#0f172a",
    color: "#ffffff",
    letterSpacing: "0.04em"
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
    background: "#2563eb",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "11px"
  },
  smallDangerButton: {
    border: "1px solid #fecaca",
    borderRadius: "8px",
    padding: "6px 8px",
    background: "#fef2f2",
    color: "#b91c1c",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "11px"
  },
  panelTitle: {
    marginTop: 0,
    fontSize: "15px"
  },
  muted: {
    color: "var(--kr-muted)",
    fontSize: "13px"
  },
  errorMessage: {
    color: "#b91c1c",
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
    color: "#166534",
    background: "#f0fdf4",
    borderColor: "#bbf7d0"
  },
  omieFeedbackWarning: {
    color: "#92400e",
    background: "#fffbeb",
    borderColor: "#fde68a"
  },
  omieFeedbackChecking: {
    color: "#1d4ed8",
    background: "#eff6ff",
    borderColor: "#bfdbfe"
  },
  omieFeedbackError: {
    color: "#b91c1c",
    background: "#fef2f2",
    borderColor: "#fecaca"
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    marginBottom: "8px",
    fontWeight: 700,
    fontSize: "13px"
  },
  input: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "8px",
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
    padding: "6px 12px",
    display: "flex",
    gap: "12px",
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
