import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  getManualUpdateButtonLabel,
  type UpdateState
} from "../services/update-flow";
import type { OperationType, WeighingOperationSummary } from "../services/weighing-operations";
import type { PriceDetails } from "../services/pricing";
import type { CacheEntityType } from "../services/cache-store";
import {
  formatDocument,
  formatPhone,
  formatPlate,
  isValidDocument,
  isValidEmail,
  isValidPlate,
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
  normalizePlate
} from "@kyberrock/shared";
import { ActivationGate } from "./ActivationGate";
import { BlockedScreen } from "./BlockedScreen";
import { InsightsView } from "./InsightsView";
import type { KyberRockDesktopApi } from "./desktop-api";
export interface AppProps {
  desktopApi?: KyberRockDesktopApi;
  initialStatus?: DesktopStatusSnapshot | null;
}

interface WeighingFormState {
  vehicleId: string;
  carrierId: string;
  customerId: string;
  driverId: string;
  productId: string;
  paymentTermId: string;
  manualInstallmentsEnabled: boolean;
  installments: number | null;
  unitPriceCents: number | null;
  manualWeightEnabled: boolean;
  manualWeightKg: number | null;
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
  | "documentation";

const initialWeighingForm: WeighingFormState = {
  vehicleId: "",
  carrierId: "",
  customerId: "",
  driverId: "",
  productId: "",
  paymentTermId: "",
  manualInstallmentsEnabled: false,
  installments: null,
  unitPriceCents: null,
  manualWeightEnabled: false,
  manualWeightKg: null
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

      if (active) {
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

        // Check cloud status
        try {
          const connected = await desktopApi.isCloudConnected();
          setCloudConnected(connected);
          if (connected) {
            const nextCloudStatus = await desktopApi.getCloudStatus();
            setCloudStatus(nextCloudStatus);
          }
        } catch {
          setCloudConnected(false);
        }

        try {
          const omieStatusResult = await desktopApi.getOmieStatus();
          setOmieStatus(omieStatusResult);
        } catch {
          // OMIE status is optional
        }

        setMessage("Desktop pronto para operacao local offline-first.");
      }
    }

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 15_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [desktopApi]);

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

    try {
      const operation = await desktopApi.startWeighing({
        customerId: form.customerId,
        vehicleId: form.vehicleId,
        carrierId: form.carrierId || undefined,
        driverId: form.driverId,
        productId: form.productId,
        paymentTermId: form.manualInstallmentsEnabled ? undefined : form.paymentTermId || undefined,
        manualInstallments: form.manualInstallmentsEnabled
          ? (form.installments ?? undefined)
          : undefined,
        unitPriceCents: form.unitPriceCents ?? undefined,
        entryWeightKg: form.manualWeightEnabled ? (form.manualWeightKg ?? undefined) : undefined
      });
      setMessage(`Entrada capturada: ${operation.entryWeightKg} kg.`);
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

    try {
      if (operationType === "invoice") {
        setFiscalCloseProgress({
          operationId,
          status: "running",
          step: "weighing",
          title: "Fechando saida fiscal",
          detail: "Capturando peso de saida e calculando peso liquido."
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
      const receipt = await desktopApi.printReceipt(operation.id);
      const receiptStatus =
        receipt.status === "printed"
          ? `Cupom ${receipt.receiptNumber} impresso.`
          : `Falha ao imprimir cupom: ${receipt.errorMessage}.`;
      const fiscalStatus = billingStatus
        ? `Pedido fiscal OMIE ${billingStatus.orderId} faturado.${
            billingStatus.documentUrl
              ? billingStatus.documentPrinted
                ? " DANFE enviado para impressora."
                : ` DANFE disponivel, mas nao foi impresso automaticamente: ${billingStatus.documentPrintError ?? "sem detalhe"}.`
              : " DANFE ainda nao foi retornado pela OMIE; imprima pelo portal OMIE se necessario."
          } `
        : "";
      setMessage(
        `Operacao fechada. Peso liquido: ${operation.netWeightKg} kg. ${fiscalStatus}${receiptStatus}`
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
            <img src="midia/logodesk.png" alt="KyberRock" style={styles.sidebarLogo} />
            <span style={styles.sidebarBrand}>{desktopAppInfo.name}</span>
          </div>
          <nav aria-label="Navegacao principal" style={styles.sidebarNav}>
            <SidebarSection title="Operacional">
              <SidebarItem
                id="dashboard"
                label="Painel"
                icon="▦"
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="new-weighing"
                label="Nova entrada"
                icon="＋"
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="open-operations"
                label="Operacoes"
                icon="≡"
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="registrations"
                label="Cadastros"
                icon="☰"
                activeView={activeView}
                onSelect={setActiveView}
              />
            </SidebarSection>
            <SidebarSection title="Analise">
              <SidebarItem
                id="insights"
                label="Insights"
                icon="◔"
                activeView={activeView}
                onSelect={setActiveView}
              />
              <SidebarItem
                id="documentation"
                label="Documentacao"
                icon="✦"
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
              <span style={styles.headerMessage}>{message}</span>
            </div>
            <div style={styles.topbarRight}>
              <button
                type="button"
                onClick={() => setThemeMode((mode) => (mode === "light" ? "dark" : "light"))}
                style={styles.themeToggle}
                title="Alternar tema"
              >
                <span>{themeMode === "light" ? "☾" : "☀"}</span>
                {themeMode === "light" ? "Escuro" : "Claro"}
              </button>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowSettings((s) => !s)}
                  style={styles.headerBtn}
                  title="Configuracoes"
                >
                  ⚙
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
                      Balança
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView("printing");
                        setShowSettings(false);
                      }}
                      style={styles.settingsItem}
                    >
                      Impressão
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView("cloud");
                        setShowSettings(false);
                      }}
                      style={styles.settingsItem}
                    >
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
                        color: errorLogs.some((l) => l.level === "error") ? "#b91c1c" : "#475569"
                      }}
                    >
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
              <section style={styles.twoColumns}>
                <article style={styles.panel}>
                  <h2 style={styles.panelTitle}>Atualizacoes</h2>
                  <p style={styles.muted}>
                    O app checa automaticamente por novas versoes. Quando houver uma disponivel,
                    voce sera notificado.
                  </p>
                  <p>Status: {describeUpdateState(updateState)}</p>
                  <button type="button" onClick={handleUpdateAction} style={styles.primaryButton}>
                    {getManualUpdateButtonLabel(updateState.status)}
                  </button>
                </article>

                <article style={styles.panel}>
                  <h2 style={styles.panelTitle}>Resumo operacional</h2>
                  <p>Operacoes abertas: {openOperations.length}</p>
                  <p>Cupons emitidos: {printReceipts.length}</p>
                  <p>Banco local: {status?.databasePath ?? "carregando..."}</p>
                </article>
              </section>
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
                      <label style={{ ...styles.fieldLabel, marginBottom: 0 }}>
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
                      <label style={{ ...styles.fieldLabel, marginBottom: 0 }}>
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
                            <button
                              type="button"
                              onClick={() => setCancelOperationId(operation.id)}
                              style={styles.smallDangerButton}
                            >
                              Cancelar
                            </button>
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
                    Tabelas de Preco
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
                <div style={{ marginTop: "20px" }}>
                  {registrationsTab === "customers" ? (
                    <CustomerListView desktopApi={desktopApi} />
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
                    Selecione uma impressora instalada no Windows. O cupom e impresso sem depender
                    de campo manual.
                  </p>
                  <label style={styles.fieldLabel}>
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

                  <button
                    type="button"
                    onClick={() => void handlePrintTest()}
                    style={{ ...styles.secondaryButton, marginTop: "12px" }}
                  >
                    Testar impressora (cupom exemplo)
                  </button>

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
                    Sincronize os dados locais com a nuvem. O desktop funciona offline e sincroniza
                    quando voce clicar no botao.
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
  icon: string;
  activeView: ActiveView;
  onSelect: (view: ActiveView) => void;
  disabled?: boolean;
  badge?: string;
}

function SidebarItem({ id, label, icon, activeView, onSelect, disabled, badge }: SidebarItemProps) {
  const isActive = activeView === id;
  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "8px 12px",
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
    <button
      type="button"
      onClick={() => {
        if (!disabled) onSelect(id);
      }}
      style={baseStyle}
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
    >
      <span style={{ width: "16px", textAlign: "center", fontSize: "14px" }}>{icon}</span>
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
  if (form.unitPriceCents === null) return "Informe o preco.";
  if (form.manualInstallmentsEnabled && (!form.installments || form.installments <= 0)) {
    return "Informe o numero de parcelas.";
  }
  if (form.manualWeightEnabled && (!form.manualWeightKg || form.manualWeightKg <= 0)) {
    return "Informe um peso simulado maior que zero.";
  }
  return null;
}

function parseCurrencyToCents(value: string): number | null | undefined {
  const normalized = value.trim().replace(".", "").replace(",", ".");

  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

function normalizeCep(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatCep(value: string): string {
  const clean = normalizeCep(value);
  return clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

async function lookupCep(value: string): Promise<{
  street: string;
  neighborhood: string;
  city: string;
  state: string;
} | null> {
  const cep = normalizeCep(value);
  if (cep.length !== 8) return null;
  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!response.ok) return null;
  const data = (await response.json()) as {
    erro?: boolean;
    logradouro?: string;
    bairro?: string;
    localidade?: string;
    uf?: string;
  };
  if (data.erro) return null;
  return {
    street: data.logradouro ?? "",
    neighborhood: data.bairro ?? "",
    city: data.localidade ?? "",
    state: data.uf ?? ""
  };
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
  productFiscalType
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
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<CacheSelectOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<CacheSelectOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        setOptions(
          (result.rows as Array<Record<string, unknown>>).map((item) => ({
            id: String(item.id ?? item.omieCode ?? ""),
            label: String(
              item.tradeName ?? item.plate ?? item.name ?? item.description ?? item.fullName ?? ""
            ),
            raw: item
          }))
        );
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [desktopApi, entityType, productFiscalType, search, refreshKey]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "4px",
            maxHeight: "200px",
            overflowY: "auto",
            zIndex: 100,
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
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
  const displayedWeight = form.manualWeightEnabled ? form.manualWeightKg : liveWeight;

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
        if (
          details?.appliedUnitPriceCents !== null &&
          details?.appliedUnitPriceCents !== undefined
        ) {
          setForm((prev) => ({ ...prev, unitPriceCents: details.appliedUnitPriceCents }));
        }
      } catch {
        setPriceDetails(null);
      }
    }

    fetchPrice();
  }, [desktopApi, form.customerId, form.productId]);

  useEffect(() => {
    async function syncInstallmentCount() {
      if (form.manualInstallmentsEnabled || !form.paymentTermId || !desktopApi) {
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
  }, [form.manualInstallmentsEnabled, form.paymentTermId, desktopApi]);

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
          <span style={styles.metricLabel}>
            {form.manualWeightEnabled ? "Peso simulado" : "Peso atual"}
          </span>
          <strong style={styles.metricValue}>
            {displayedWeight !== null ? formatWeightKg(displayedWeight) : "-- kg"}
          </strong>
          <span style={styles.metricHint}>
            {form.manualWeightEnabled
              ? "Modo teste sem conexao com a balanca"
              : liveWeight !== null
                ? "Leitura em tempo real"
                : "Aguardando balanca"}
          </span>
          {form.manualWeightEnabled ? (
            <label style={styles.simulatedWeightField}>
              Peso de teste (kg)
              <input
                type="number"
                min={0}
                step={0.001}
                value={form.manualWeightKg ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    manualWeightKg: raw === "" ? null : Number(raw)
                  }));
                }}
                placeholder="Ex: 12500"
                style={styles.simulatedWeightInput}
              />
            </label>
          ) : null}
          <button
            type="button"
            onClick={() =>
              setForm((prev) => ({
                ...prev,
                manualWeightEnabled: !prev.manualWeightEnabled,
                manualWeightKg: prev.manualWeightEnabled ? null : prev.manualWeightKg
              }))
            }
            style={styles.simulateWeightButton}
          >
            {form.manualWeightEnabled ? "Usar balanca real" : "Simular peso"}
          </button>
        </div>
      </div>

      {formError ? <p style={styles.errorMessage}>{formError}</p> : null}

      <div style={styles.entryGrid}>
        <article style={styles.entryCard}>
          <SectionHeader
            icon="◈"
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
                  !prev.manualInstallmentsEnabled &&
                  typeof item?.defaultPaymentTermId === "string" &&
                  item.defaultPaymentTermId
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
          <label style={styles.checkboxCard}>
            <input
              type="checkbox"
              checked={form.manualInstallmentsEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setPaymentTermInstallmentCount(null);
                setForm((prev) => ({
                  ...prev,
                  manualInstallmentsEnabled: enabled,
                  paymentTermId: enabled ? "" : prev.paymentTermId,
                  installments: enabled ? prev.installments : null
                }));
              }}
            />
            <span>
              <strong>Informar numero de parcelas</strong>
              <small style={{ display: "block", color: "var(--kr-muted)", marginTop: "2px" }}>
                Troca a lista de condicoes por um campo manual.
              </small>
            </span>
          </label>
          {form.manualInstallmentsEnabled ? (
            <label style={styles.fieldLabel}>
              Numero de parcelas
              <input
                type="number"
                min={1}
                step={1}
                value={form.installments ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setForm((prev) => ({ ...prev, installments: null }));
                    return;
                  }
                  const parsed = Number.parseInt(raw, 10);
                  setForm((prev) => ({
                    ...prev,
                    installments: Number.isFinite(parsed) && parsed > 0 ? parsed : null
                  }));
                }}
                placeholder="Ex: 3"
                style={styles.input}
              />
            </label>
          ) : (
            <>
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
                    paymentTermId: id,
                    installments: count && count > 1 ? count : null
                  }));
                }}
                desktopApi={desktopApi}
              />
              {paymentTermInstallmentCount && paymentTermInstallmentCount > 1 ? (
                <p style={styles.helperText}>
                  Condicao selecionada com {paymentTermInstallmentCount} parcelas.
                </p>
              ) : null}
            </>
          )}
        </article>

        <article style={styles.entryCard}>
          <SectionHeader
            icon="▣"
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
          />
          <CacheSelect
            label="Motorista"
            entityType="driver"
            value={form.driverId}
            onChange={(id) => setForm({ ...form, driverId: id })}
            onCreateNew={() => setShowDriverModal(true)}
            desktopApi={desktopApi}
            refreshKey={driverRefreshKey}
          />
        </article>

        <aside style={styles.entrySummaryCard}>
          <SectionHeader
            icon="◆"
            title="Resumo da entrada"
            description="Preco, peso e acao final"
          />
          <PriceInput
            valueCents={form.unitPriceCents}
            onChange={(cents) => setForm((prev) => ({ ...prev, unitPriceCents: cents }))}
          />
          <PriceDetailsPanel details={priceDetails} appliedUnitPriceCents={form.unitPriceCents} />
          <div style={styles.actionStack}>
            <button type="button" onClick={onStart} style={styles.captureButton}>
              Capturar peso de entrada
            </button>
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
  title,
  description
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionIcon}>{icon}</span>
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
        <label style={styles.fieldLabel}>
          Placa
          <input
            value={formatPlate(plateInput)}
            onChange={(e) => setPlateInput(normalizePlate(e.target.value))}
            placeholder="ABC1234 ou ABC1D23"
            style={styles.input}
          />
        </label>
        <label style={styles.fieldLabel}>
          Descricao
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={styles.input}
          />
        </label>
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
        <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "15px" }}>
          Cadastrar motorista
        </h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <label style={styles.fieldLabel}>
          Nome completo
          <input value={name} onChange={(e) => setName(e.target.value)} style={styles.input} />
        </label>
        <label style={styles.fieldLabel}>
          CPF
          <input
            value={formatDocument(documentInput)}
            onChange={(e) => setDocumentInput(normalizeDocument(e.target.value))}
            placeholder="000.000.000-00"
            style={styles.input}
          />
        </label>
        <label style={styles.fieldLabel}>
          Telefone
          <input
            value={formatPhone(phone)}
            onChange={(e) => setPhone(normalizePhone(e.target.value))}
            placeholder="(11) 91234-5678"
            style={styles.input}
          />
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
        <label style={styles.fieldLabel}>
          Nome fantasia
          <input
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.fieldLabel}>
          Razao social
          <input
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.fieldLabel}>
          CPF/CNPJ
          <input
            value={formatDocument(documentInput)}
            onChange={(e) => setDocumentInput(normalizeDocument(e.target.value))}
            placeholder="000.000.000-00 ou 00.000.000/0000-00"
            style={styles.input}
          />
        </label>
        <label style={styles.fieldLabel}>
          Telefone
          <input
            value={formatPhone(phone)}
            onChange={(e) => setPhone(normalizePhone(e.target.value))}
            placeholder="(11) 91234-5678"
            style={styles.input}
          />
        </label>
        <label style={styles.fieldLabel}>
          Email
          <input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="cliente@exemplo.com"
            style={styles.input}
          />
        </label>
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
        <label style={styles.fieldLabel}>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} style={styles.input} />
        </label>
        <label style={styles.fieldLabel}>
          CPF/CNPJ
          <input
            value={formatDocument(documentInput)}
            onChange={(e) => setDocumentInput(normalizeDocument(e.target.value))}
            placeholder="00.000.000/0000-00"
            style={styles.input}
          />
        </label>
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
        <label style={styles.fieldLabel}>
          Tipo
          <select
            value={operationType}
            onChange={(event) => setOperationType(event.target.value as OperationType)}
            style={styles.input}
          >
            <option value="invoice">Com nota (pedido de venda no OMIE)</option>
            <option value="internal">Interna (ordem de servico no OMIE)</option>
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
      ) : null}
    </span>
  );
}

function PriceDetailsPanel({
  details,
  appliedUnitPriceCents
}: {
  details: PriceDetails | null;
  appliedUnitPriceCents: number | null;
}) {
  if (!details && appliedUnitPriceCents === null) return null;

  const tableLabel = details?.priceTableName ?? "Preco base OMIE";
  const savingsLabel = details?.savingsPercent
    ? `${details.savingsPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
    : "Sem desconto";

  return (
    <div
      style={{
        marginTop: "6px",
        padding: "8px",
        border: "1px solid #e2e8f0",
        borderRadius: "8px",
        background: "#f8fafc"
      }}
    >
      <div style={{ fontSize: "12px", color: "#475569" }}>
        Base OMIE: {formatMoney(details?.baseUnitPriceCents)}/ton
      </div>
      <div style={{ fontSize: "12px", color: "#475569" }}>Tabela: {tableLabel}</div>
      <div style={{ fontSize: "12px", color: "#475569" }}>
        Aplicado: {formatMoney(appliedUnitPriceCents)}/ton
      </div>
      <div style={{ fontSize: "12px", color: "#475569" }}>Economia: {savingsLabel}</div>
    </div>
  );
}

function PriceInput({
  valueCents,
  onChange
}: {
  valueCents: number | null;
  onChange: (cents: number | null) => void;
}) {
  const [focused, setFocused] = useState(false);

  const centsToBRL = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  const displayValue = focused
    ? valueCents !== null
      ? String(valueCents / 100).replace(".", ",")
      : ""
    : valueCents !== null
      ? centsToBRL(valueCents)
      : "";

  return (
    <label style={styles.fieldLabel}>
      Preco por tonelada
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        placeholder="0,00"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^\d,]/g, "");
          if (!raw) {
            onChange(null);
            return;
          }
          const parts = raw.split(",");
          const intPart = parts[0] || "0";
          const decPart = (parts[1] || "").slice(0, 2).padEnd(2, "0");
          onChange(Number(`${intPart}${decPart}`));
        }}
        style={styles.input}
      />
      {valueCents !== null ? (
        <span style={{ fontSize: "12px", color: "#64748b" }}>{centsToBRL(valueCents)}/ton</span>
      ) : null}
    </label>
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
      "--kr-shadow": "0 12px 36px rgba(0,0,0,0.35)"
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
    "--kr-shadow": "0 12px 36px rgba(15, 23, 42, 0.08)"
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <label style={styles.fieldLabel}>
              Placa *
              <input
                value={formatPlate(form.plate)}
                onChange={(e) => setForm({ ...form, plate: normalizePlate(e.target.value) })}
                placeholder="ABC1234 ou ABC1D23"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Descricao
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={styles.input}
              />
            </label>
          </div>
          <label style={styles.fieldLabel}>
            Transportadora
            <select
              value={form.carrierId}
              onChange={(e) => setForm({ ...form, carrierId: e.target.value })}
              style={styles.input}
            >
              <option value="">Selecione a transportadora</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <label style={styles.fieldLabel}>
              Nome *
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              CNPJ/CPF
              <input
                value={formatDocument(form.document)}
                onChange={(e) => setForm({ ...form, document: normalizeDocument(e.target.value) })}
                placeholder="00.000.000/0000-00"
                style={styles.input}
              />
            </label>
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

interface CustomerCacheEntry {
  id: string;
  tradeName: string;
  legalName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  creditLimitCents: number | null;
  openReceivablesCents: number;
  omieBillingBlocked: boolean;
  source: string;
  syncStatus: string;
  needsPush: boolean;
  lastSyncedAt: string | null;
  observations: string | null;
  defaultCarrierId: string | null;
  defaultPaymentTermId: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

interface CarrierCacheEntry {
  id: string;
  name: string;
  document: string | null;
  source: string;
  isActive: boolean;
}

interface PaymentTermCacheEntry {
  id: string;
  name: string;
  omieCode: string | null;
  isActive: boolean;
}

interface CustomerFormData {
  tradeName: string;
  legalName: string;
  document: string;
  phone: string;
  email: string;
  creditLimitReais: string;
  omieBillingBlocked: boolean;
  observations: string;
  defaultCarrierId: string;
  defaultPaymentTermId: string;
  priceTableId: string;
  zipcode: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
}

function CustomerListView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const pageSize = 100;
  const [customers, setCustomers] = useState<CustomerCacheEntry[]>([]);
  const [customerTotal, setCustomerTotal] = useState(0);
  const [customerPage, setCustomerPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerFormData>({
    tradeName: "",
    legalName: "",
    document: "",
    phone: "",
    email: "",
    creditLimitReais: "",
    omieBillingBlocked: false,
    observations: "",
    defaultCarrierId: "",
    defaultPaymentTermId: "",
    priceTableId: "",
    zipcode: "",
    addressStreet: "",
    addressNumber: "",
    addressComplement: "",
    neighborhood: "",
    city: "",
    state: ""
  });
  const [formError, setFormErrorState] = useState<string | null>(null);
  const [message, setMessageState] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<CarrierCacheEntry[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermCacheEntry[]>([]);
  const [priceTables, setPriceTables] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    loadCustomers();
  }, [search, customerPage]);

  useEffect(() => {
    loadCarriers();
    loadPaymentTerms();
    loadPriceTables();
  }, []);

  useEffect(() => {
    setCustomerPage(0);
  }, [search]);

  async function loadCarriers(): Promise<void> {
    try {
      const result = await desktopApi.queryCache({
        entityType: "carrier",
        limit: 200
      });
      setCarriers(result.rows as CarrierCacheEntry[]);
    } catch {
      /* ignore */
    }
  }

  async function loadPaymentTerms(): Promise<void> {
    try {
      const result = await desktopApi.queryCache({
        entityType: "payment_term",
        limit: 500
      });
      setPaymentTerms(result.rows as PaymentTermCacheEntry[]);
    } catch {
      /* ignore */
    }
  }

  async function loadPriceTables(): Promise<void> {
    try {
      const list = (await desktopApi.priceTablesList()) as Array<{ id: string; name: string }>;
      setPriceTables(list);
    } catch {
      /* ignore */
    }
  }

  async function loadCustomers(): Promise<void> {
    try {
      const result = await desktopApi.queryCache({
        entityType: "customer",
        search: search || undefined,
        limit: pageSize,
        offset: customerPage * pageSize
      });
      setCustomers(result.rows as CustomerCacheEntry[]);
      setCustomerTotal(result.total);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  function resetForm(): void {
    setForm({
      tradeName: "",
      legalName: "",
      document: "",
      phone: "",
      email: "",
      creditLimitReais: "",
      omieBillingBlocked: false,
      observations: "",
      defaultCarrierId: "",
      defaultPaymentTermId: "",
      priceTableId: "",
      zipcode: "",
      addressStreet: "",
      addressNumber: "",
      addressComplement: "",
      neighborhood: "",
      city: "",
      state: ""
    });
    setEditingId(null);
    setFormErrorState(null);
  }

  function openCreateForm(): void {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(customer: CustomerCacheEntry): void {
    setForm({
      tradeName: customer.tradeName,
      legalName: customer.legalName,
      document: customer.document ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      creditLimitReais: customer.creditLimitCents
        ? (customer.creditLimitCents / 100).toFixed(2).replace(".", ",")
        : "",
      omieBillingBlocked: customer.omieBillingBlocked,
      observations: customer.observations ?? "",
      defaultCarrierId: customer.defaultCarrierId ?? "",
      defaultPaymentTermId: customer.defaultPaymentTermId ?? "",
      priceTableId: "",
      zipcode: customer.zipcode ?? "",
      addressStreet: customer.addressStreet ?? "",
      addressNumber: customer.addressNumber ?? "",
      addressComplement: customer.addressComplement ?? "",
      neighborhood: customer.neighborhood ?? "",
      city: customer.city ?? "",
      state: customer.state ?? ""
    });
    setEditingId(customer.id);
    setFormErrorState(null);
    setShowForm(true);
  }

  function validateForm(): string | null {
    if (!form.tradeName.trim()) return "Nome fantasia e obrigatorio.";
    if (!form.legalName.trim()) return "Razao social e obrigatoria.";
    if (form.zipcode.trim() && normalizeCep(form.zipcode).length !== 8) return "CEP invalido.";
    return null;
  }

  async function applyCepToForm(): Promise<void> {
    const address = await lookupCep(form.zipcode);
    if (!address) return;
    setForm((prev) => ({
      ...prev,
      addressStreet: prev.addressStreet || address.street,
      neighborhood: prev.neighborhood || address.neighborhood,
      city: prev.city || address.city,
      state: prev.state || address.state
    }));
  }

  async function handleSave(): Promise<void> {
    const error = validateForm();
    if (error) {
      setFormErrorState(error);
      return;
    }

    const normalizedDocument = normalizeDocument(form.document);
    if (form.document.trim() && !isValidDocument(normalizedDocument)) {
      setFormErrorState("CPF/CNPJ invalido.");
      return;
    }

    const normalizedPhone = normalizePhone(form.phone);
    if (form.phone.trim() && normalizedPhone.length !== 10 && normalizedPhone.length !== 11) {
      setFormErrorState("Telefone invalido. Informe com DDD (11 digitos).");
      return;
    }

    const normalizedEmail = normalizeEmail(form.email);
    if (form.email.trim() && !isValidEmail(normalizedEmail)) {
      setFormErrorState("Email invalido.");
      return;
    }

    const creditLimitCents = form.creditLimitReais.trim()
      ? parseCurrencyToCents(form.creditLimitReais)
      : undefined;
    const normalizedZipcode = normalizeCep(form.zipcode);

    try {
      let customerId = editingId;
      if (editingId) {
        await desktopApi.customersUpdate(editingId, {
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          omieBillingBlocked: form.omieBillingBlocked,
          observations: form.observations.trim() || undefined,
          defaultCarrierId: form.defaultCarrierId || null,
          defaultPaymentTermId: form.defaultPaymentTermId || null,
          zipcode: normalizedZipcode || null,
          addressStreet: form.addressStreet.trim() || null,
          addressNumber: form.addressNumber.trim() || null,
          addressComplement: form.addressComplement.trim() || null,
          neighborhood: form.neighborhood.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim().toUpperCase() || null
        });
        setMessageState("Cliente atualizado com sucesso.");
      } else {
        const created = (await desktopApi.customersCreate({
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          omieBillingBlocked: form.omieBillingBlocked,
          observations: form.observations.trim() || undefined,
          defaultCarrierId: form.defaultCarrierId || undefined,
          defaultPaymentTermId: form.defaultPaymentTermId || undefined,
          zipcode: normalizedZipcode || undefined,
          addressStreet: form.addressStreet.trim() || undefined,
          addressNumber: form.addressNumber.trim() || undefined,
          addressComplement: form.addressComplement.trim() || undefined,
          neighborhood: form.neighborhood.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim().toUpperCase() || undefined
        })) as { id: string };
        customerId = created.id;
        setMessageState("Cliente criado com sucesso.");
      }

      if (customerId && form.priceTableId) {
        try {
          await desktopApi.priceTablesLinkCustomer({
            customerId,
            priceTableId: form.priceTableId
          });
        } catch {
          /* ignore link errors */
        }
      }

      setShowForm(false);
      resetForm();
      setLoading(true);
      await loadCustomers();
    } catch (err) {
      setFormErrorState(err instanceof Error ? err.message : "Erro ao salvar cliente.");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("Deseja realmente excluir este cliente?")) return;

    try {
      await desktopApi.customersDelete(id);
      setMessageState("Cliente excluido.");
      await loadCustomers();
    } catch (err) {
      setMessageState(err instanceof Error ? err.message : "Erro ao excluir cliente.");
    }
  }

  function syncIcon(customer: CustomerCacheEntry): string {
    if (customer.syncStatus === "error") return "\u2715";
    if (customer.needsPush) return "\u26A0";
    return "\u2713";
  }

  function syncColor(customer: CustomerCacheEntry): string {
    if (customer.syncStatus === "error") return "#b91c1c";
    if (customer.needsPush) return "#d97706";
    return "#16a34a";
  }

  if (loading) {
    return <p style={{ color: "#64748b" }}>Carregando clientes...</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "160px" }}
        />
        <button type="button" onClick={openCreateForm} style={styles.primaryButton}>
          + Novo Cliente
        </button>
      </div>

      {message ? (
        <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "6px", fontSize: "13px" }}>
          {message}
        </p>
      ) : null}

      {showForm ? (
        <div style={styles.customerFormShell}>
          <div style={styles.customerFormHeader}>
            <div>
              <p style={styles.kicker}>Cadastro comercial</p>
              <h3 style={styles.customerFormTitle}>
                {editingId ? "Editar Cliente" : "Novo Cliente"}
              </h3>
              <p style={styles.customerFormSubtitle}>
                Organize dados fiscais, contato, endereco e regras comerciais em uma unica ficha.
              </p>
            </div>
            <span style={styles.customerFormBadge}>{editingId ? "Edicao" : "Novo"}</span>
          </div>

          {formError ? <p style={styles.errorMessage}>{formError}</p> : null}

          <div style={styles.customerFormGrid}>
            <section style={styles.customerFormSection}>
              <h4 style={styles.customerSectionTitle}>Identificacao</h4>
              <div style={styles.customerFieldGrid}>
                <label style={styles.fieldLabel}>
                  Razao Social *
                  <input
                    value={form.legalName}
                    onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Nome Fantasia *
                  <input
                    value={form.tradeName}
                    onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  CNPJ/CPF
                  <input
                    value={formatDocument(form.document)}
                    onChange={(e) =>
                      setForm({ ...form, document: normalizeDocument(e.target.value) })
                    }
                    placeholder="00.000.000/0000-00"
                    style={styles.input}
                  />
                </label>
              </div>
            </section>

            <section style={styles.customerFormSection}>
              <h4 style={styles.customerSectionTitle}>Contato</h4>
              <div style={styles.customerFieldGrid}>
                <label style={styles.fieldLabel}>
                  Telefone
                  <input
                    value={formatPhone(form.phone)}
                    onChange={(e) => setForm({ ...form, phone: normalizePhone(e.target.value) })}
                    placeholder="(11) 91234-5678"
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Email
                  <input
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="cliente@exemplo.com"
                    style={styles.input}
                  />
                </label>
              </div>
            </section>

            <section style={styles.customerFormSectionWide}>
              <h4 style={styles.customerSectionTitle}>Endereco</h4>
              <div style={styles.customerFieldGrid}>
                <label style={styles.fieldLabel}>
                  CEP
                  <input
                    value={formatCep(form.zipcode)}
                    onChange={(e) => setForm({ ...form, zipcode: normalizeCep(e.target.value) })}
                    onBlur={applyCepToForm}
                    placeholder="00000-000"
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Endereco
                  <input
                    value={form.addressStreet}
                    onChange={(e) => setForm({ ...form, addressStreet: e.target.value })}
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Numero
                  <input
                    value={form.addressNumber}
                    onChange={(e) => setForm({ ...form, addressNumber: e.target.value })}
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Complemento
                  <input
                    value={form.addressComplement}
                    onChange={(e) => setForm({ ...form, addressComplement: e.target.value })}
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Bairro
                  <input
                    value={form.neighborhood}
                    onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Cidade
                  <input
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Estado
                  <input
                    value={form.state}
                    onChange={(e) =>
                      setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })
                    }
                    placeholder="UF"
                    style={styles.input}
                  />
                </label>
              </div>
            </section>

            <section style={styles.customerFormSection}>
              <h4 style={styles.customerSectionTitle}>Comercial</h4>
              <div style={styles.customerFieldGrid}>
                <label style={styles.fieldLabel}>
                  Limite de Credito (R$)
                  <input
                    value={form.creditLimitReais}
                    onChange={(e) => setForm({ ...form, creditLimitReais: e.target.value })}
                    placeholder="50.000,00"
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Transportadora padrao
                  <select
                    value={form.defaultCarrierId}
                    onChange={(e) => setForm({ ...form, defaultCarrierId: e.target.value })}
                    style={styles.input}
                  >
                    <option value="">Selecione a transportadora padrao</option>
                    {carriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  Condicao de pagamento padrao
                  <select
                    value={form.defaultPaymentTermId}
                    onChange={(e) => setForm({ ...form, defaultPaymentTermId: e.target.value })}
                    style={styles.input}
                  >
                    <option value="">Selecione a condicao padrao</option>
                    {paymentTerms.map((term) => (
                      <option key={term.id} value={term.id}>
                        {term.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  Tabela de preco
                  <select
                    value={form.priceTableId}
                    onChange={(e) => setForm({ ...form, priceTableId: e.target.value })}
                    style={styles.input}
                  >
                    <option value="">Selecione a tabela de preco</option>
                    {priceTables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={styles.checkboxCard}>
                <input
                  type="checkbox"
                  checked={form.omieBillingBlocked}
                  onChange={(e) => setForm({ ...form, omieBillingBlocked: e.target.checked })}
                />
                <span>
                  <strong>Cliente bloqueado</strong>
                  <small style={{ display: "block", color: "var(--kr-muted)", marginTop: "2px" }}>
                    Sinaliza restricao de faturamento no atendimento.
                  </small>
                </span>
              </label>
            </section>

            <section style={styles.customerFormSection}>
              <h4 style={styles.customerSectionTitle}>Observacoes</h4>
              <label style={styles.fieldLabel}>
                Anotacoes internas
                <input
                  value={form.observations}
                  onChange={(e) => setForm({ ...form, observations: e.target.value })}
                  style={styles.input}
                />
              </label>
            </section>
          </div>

          <div style={styles.customerFormActions}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>
              Salvar
            </button>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {customers.length === 0 ? (
        <p style={{ color: "#64748b" }}>
          {search ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado."}
        </p>
      ) : (
        <div>
          {customers.map((customer) => (
            <div key={customer.id} style={styles.operationRow}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <strong>{customer.tradeName}</strong>
                  <span style={{ color: syncColor(customer), fontSize: "14px" }}>
                    {syncIcon(customer)}
                  </span>
                  <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                    {customer.source === "omie" ? "OMIE" : "Local"}
                  </span>
                </div>
                <p style={{ ...styles.muted, margin: "4px 0 0 0" }}>
                  {customer.legalName}
                  {customer.document ? ` \u2022 ${customer.document}` : ""}
                </p>
                <p style={{ ...styles.muted, margin: "2px 0 0 0", fontSize: "13px" }}>
                  Limite: {formatMoney(customer.creditLimitCents)} | Em aberto:{" "}
                  {formatMoney(customer.openReceivablesCents)}
                  {customer.omieBillingBlocked ? " | \uD83D\uDD34 Bloqueado" : ""}
                </p>
                {customer.city || customer.state || customer.addressStreet ? (
                  <p style={{ ...styles.muted, margin: "2px 0 0 0", fontSize: "13px" }}>
                    {[
                      customer.addressStreet,
                      customer.addressNumber,
                      customer.neighborhood,
                      customer.city,
                      customer.state
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                ) : null}
                {customer.defaultPaymentTermId ? (
                  <p style={{ ...styles.muted, margin: "2px 0 0 0", fontSize: "13px" }}>
                    Condicao padrao:{" "}
                    {paymentTerms.find((term) => term.id === customer.defaultPaymentTermId)?.name ??
                      customer.defaultPaymentTermId}
                  </p>
                ) : null}
                {customer.observations ? (
                  <p
                    style={{
                      ...styles.muted,
                      margin: "2px 0 0 0",
                      fontSize: "12px",
                      fontStyle: "italic"
                    }}
                  >
                    {customer.observations}
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => openEditForm(customer)}
                  style={styles.secondaryButton}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(customer.id)}
                  style={{ ...styles.secondaryButton, color: "#b91c1c", borderColor: "#fecaca" }}
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
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
          Mostrando {customerTotal === 0 ? 0 : customerPage * pageSize + 1}-
          {Math.min(customerTotal, (customerPage + 1) * pageSize)} de {customerTotal}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setCustomerPage((page) => Math.max(0, page - 1))}
            disabled={customerPage === 0}
            style={styles.secondaryButton}
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setCustomerPage((page) => page + 1)}
            disabled={(customerPage + 1) * pageSize >= customerTotal}
            style={styles.secondaryButton}
          >
            Proximos 100
          </button>
        </div>
      </div>
    </div>
  );
}

function ScaleView({ desktopApi }: { desktopApi: KyberRockDesktopApi }) {
  const [host, setHost] = useState("192.168.1.100");
  const [port, setPort] = useState("4001");
  const [connected, setConnected] = useState(false);
  const [reading, setReading] = useState<{ weightKg: number; stable: boolean } | null>(null);
  const [status, setStatus] = useState<string>("Disconectado");
  const [error, setError] = useState<string | null>(null);

  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  useEffect(() => {
    if (!desktopApi) return;

    const handler = (r: { weightKg: number; stable: boolean }) => setReading(r);
    desktopApi.onScaleReading(handler as (reading: unknown) => void);

    return () => {
      desktopApi.offScaleReading(handler as (reading: unknown) => void);
      if (connectedRef.current) {
        void desktopApi.scaleDisconnect();
        setConnected(false);
      }
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

  async function handleConnect(): Promise<void> {
    setError(null);
    try {
      await desktopApi.scaleConnect({
        host: host.trim(),
        port: parseInt(port, 10) || 4001
      });
      setConnected(true);
      setStatus("Conectado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conectar");
      setConnected(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    await desktopApi.scaleDisconnect();
    setConnected(false);
    setStatus("Disconectado");
    setReading(null);
  }

  return (
    <div>
      <section style={styles.twoColumns}>
        <article style={styles.panel}>
          <h2 style={styles.panelTitle}>Configuracao da Balanca Toledo</h2>
          <label style={styles.fieldLabel}>
            Host / IP
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              style={styles.input}
              placeholder="192.168.1.100"
            />
          </label>
          <label style={styles.fieldLabel}>
            Porta TCP
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              style={styles.input}
              placeholder="4001"
            />
          </label>
          {error ? <p style={styles.errorMessage}>{error}</p> : null}
          <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
            <button
              type="button"
              onClick={handleConnect}
              disabled={connected}
              style={{ ...styles.primaryButton, opacity: connected ? 0.5 : 1 }}
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
          <p style={styles.muted}>Status: {status}</p>
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
          {fields.map((f) => (
            <label key={f.key} style={styles.fieldLabel}>
              {f.label}
              {f.required ? " *" : ""}
              <input
                value={
                  f.key === "document"
                    ? formatDocument(formData[f.key] || "")
                    : f.key === "phone"
                      ? formatPhone(formData[f.key] || "")
                      : formData[f.key] || ""
                }
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    [f.key]:
                      f.key === "document"
                        ? normalizeDocument(e.target.value)
                        : f.key === "phone"
                          ? normalizePhone(e.target.value)
                          : e.target.value
                  })
                }
                style={styles.input}
              />
            </label>
          ))}
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
  const [tables, setTables] = useState<Array<{ id: string; name: string; needsPush?: boolean }>>(
    []
  );
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [items, setItems] = useState<
    Array<{ id: string; productCode: string | null; productDesc: string; unitPriceCents: number }>
  >([]);
  const [products, setProducts] = useState<
    Array<{ id: string; code: string; description: string }>
  >([]);
  const [newTableName, setNewTableName] = useState("");
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editingTableName, setEditingTableName] = useState("");
  const [itemProductId, setItemProductId] = useState("");
  const [itemPriceReais, setItemPriceReais] = useState("");
  const [message, setPriceMessage] = useState<string | null>(null);

  useEffect(() => {
    loadTables();
    loadProducts();
  }, []);

  useEffect(() => {
    if (selectedTableId) {
      loadTableDetails(selectedTableId);
    }
  }, [selectedTableId]);

  async function loadTables(): Promise<void> {
    const list = (await desktopApi.priceTablesList()) as Array<{ id: string; name: string }>;
    setTables(list);
  }

  async function loadProducts(): Promise<void> {
    const result = await desktopApi.queryCache({
      entityType: "product",
      activeOnly: true,
      limit: 200
    });
    setProducts(result.rows as Array<{ id: string; code: string; description: string }>);
  }

  async function loadTableDetails(tableId: string): Promise<void> {
    const itemList = (await desktopApi.priceTablesListItems(tableId)) as Array<{
      id: string;
      productCode: string | null;
      productDesc: string;
      unitPriceCents: number;
    }>;
    setItems(itemList);
  }

  async function handleCreateTable(): Promise<void> {
    if (!newTableName.trim()) return;
    await desktopApi.priceTablesCreate({ name: newTableName.trim() });
    setNewTableName("");
    setPriceMessage("Tabela criada.");
    await loadTables();
  }

  async function handleRenameTable(): Promise<void> {
    if (!editingTableId || !editingTableName.trim()) return;
    await desktopApi.priceTablesUpdateName(editingTableId, editingTableName.trim());
    setEditingTableId(null);
    setEditingTableName("");
    setPriceMessage("Tabela renomeada.");
    await loadTables();
  }

  async function handleDeleteTable(id: string): Promise<void> {
    if (!window.confirm("Excluir tabela e todos os seus itens?")) return;
    await desktopApi.priceTablesDelete(id);
    if (selectedTableId === id) setSelectedTableId(null);
    setPriceMessage("Tabela excluida.");
    await loadTables();
  }

  async function handleAddItem(): Promise<void> {
    if (!selectedTableId || !itemProductId || !itemPriceReais.trim()) return;
    const unitPriceCents = parseCurrencyToCents(itemPriceReais);
    if (unitPriceCents === null || unitPriceCents === undefined) return;

    await desktopApi.priceTablesAddItem({
      priceTableId: selectedTableId,
      productId: itemProductId,
      unitPriceCents,
      unit: "kg"
    });
    setItemProductId("");
    setItemPriceReais("");
    setPriceMessage("Item adicionado.");
    await loadTableDetails(selectedTableId);
  }

  async function handleRemoveItem(itemId: string): Promise<void> {
    await desktopApi.priceTablesRemoveItem(itemId);
    setPriceMessage("Item removido.");
    if (selectedTableId) await loadTableDetails(selectedTableId);
  }

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: "20px", minHeight: "400px" }}
    >
      <div style={{ borderRight: "1px solid var(--kr-border)", paddingRight: "16px" }}>
        <h3 style={{ marginTop: 0 }}>Tabelas</h3>
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          <input
            placeholder="Nova tabela..."
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
            style={{ ...styles.input, flex: 1, padding: "6px 8px", fontSize: "13px" }}
          />
          <button
            type="button"
            onClick={handleCreateTable}
            style={{ ...styles.primaryButton, padding: "6px 10px", fontSize: "13px" }}
          >
            +
          </button>
        </div>

        {tables.map((table) => (
          <div
            key={table.id}
            onClick={() => setSelectedTableId(table.id)}
            style={{
              padding: "8px 10px",
              cursor: "pointer",
              borderRadius: "8px",
              marginBottom: "4px",
              background: selectedTableId === table.id ? "#f1f5f9" : "transparent",
              color: selectedTableId === table.id ? "#0f172a" : "var(--kr-text-strong)",
              fontWeight: selectedTableId === table.id ? 700 : 400
            }}
          >
            {editingTableId === table.id ? (
              <div style={{ display: "flex", gap: "4px" }}>
                <input
                  value={editingTableName}
                  onChange={(e) => setEditingTableName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameTable();
                  }}
                  style={{ ...styles.input, flex: 1, padding: "4px 6px", fontSize: "12px" }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleRenameTable}
                  style={{ ...styles.primaryButton, padding: "4px 6px", fontSize: "11px" }}
                >
                  OK
                </button>
              </div>
            ) : (
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span style={{ fontSize: "14px" }}>{table.name}</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTableId(table.id);
                      setEditingTableName(table.name);
                    }}
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "#64748b"
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTable(table.id);
                    }}
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "#b91c1c"
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div>
        {message ? (
          <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "8px" }}>{message}</p>
        ) : null}

        {!selectedTableId ? (
          <p style={{ color: "#64748b" }}>Selecione uma tabela para ver seus itens.</p>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>Itens da Tabela</h3>

            <div
              style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "flex-end" }}
            >
              <label style={{ ...styles.fieldLabel, marginBottom: 0, flex: 1 }}>
                Produto
                <select
                  value={itemProductId}
                  onChange={(e) => setItemProductId(e.target.value)}
                  style={styles.input}
                >
                  <option value="">Selecione...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.description}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...styles.fieldLabel, marginBottom: 0, width: "120px" }}>
                Preco/ton (R$)
                <input
                  value={itemPriceReais}
                  onChange={(e) => setItemPriceReais(e.target.value)}
                  placeholder="150,00"
                  style={styles.input}
                />
              </label>
              <button
                type="button"
                onClick={handleAddItem}
                style={{ ...styles.primaryButton, padding: "10px 14px" }}
              >
                Adicionar
              </button>
            </div>

            {items.length === 0 ? (
              <p style={{ color: "#64748b", marginBottom: "24px" }}>Nenhum item cadastrado.</p>
            ) : (
              <div style={{ marginBottom: "24px" }}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 0",
                      borderTop: "1px solid #e2e8f0"
                    }}
                  >
                    <span>
                      <strong>{item.productDesc}</strong>
                      {item.productCode ? ` (${item.productCode})` : ""} —{" "}
                      {formatMoney(item.unitPriceCents)}/ton
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        color: "#b91c1c",
                        fontSize: "16px"
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
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
    border: "none",
    borderRadius: "6px",
    padding: "4px 8px",
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
    border: "none",
    borderRadius: "4px",
    padding: "6px 10px",
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
  customerFormShell: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "14px",
    marginBottom: "14px",
    padding: "16px",
    border: "1px solid var(--kr-border)",
    borderRadius: "18px",
    background: "linear-gradient(180deg, var(--kr-surface) 0%, var(--kr-surface-soft) 100%)",
    boxShadow: "var(--kr-shadow)"
  },
  customerFormHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    paddingBottom: "12px",
    borderBottom: "1px solid var(--kr-border)"
  },
  customerFormTitle: {
    margin: "4px 0 4px 0",
    color: "var(--kr-text-strong)",
    fontSize: "20px"
  },
  customerFormSubtitle: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "13px"
  },
  customerFormBadge: {
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1e3a8a",
    fontSize: "12px",
    fontWeight: 900
  },
  customerFormGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "12px"
  },
  customerFormSection: {
    padding: "14px",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface)"
  },
  customerFormSectionWide: {
    padding: "14px",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    gridColumn: "1 / -1"
  },
  customerSectionTitle: {
    margin: "0 0 10px 0",
    color: "var(--kr-text-strong)",
    fontSize: "13px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em"
  },
  customerFieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "8px 10px"
  },
  customerFormActions: {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    paddingTop: "12px",
    borderTop: "1px solid var(--kr-border)"
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
  simulatedWeightField: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    marginTop: "8px",
    color: "#dbeafe",
    fontSize: "12px",
    fontWeight: 800
  },
  simulatedWeightInput: {
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: "10px",
    padding: "8px 10px",
    font: "inherit",
    fontSize: "13px",
    background: "rgba(255,255,255,0.92)",
    color: "#0f172a"
  },
  simulateWeightButton: {
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: "999px",
    padding: "7px 10px",
    marginTop: "8px",
    background: "rgba(255,255,255,0.14)",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "12px"
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
    boxShadow: "0 10px 22px rgba(22, 163, 74, 0.22)"
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
