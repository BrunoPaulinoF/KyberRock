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
  unitPriceCents: number | null;
}

type ActiveView = "dashboard" | "new-weighing" | "open-operations" | "scale" | "registrations" | "printing" | "cloud";

const initialWeighingForm: WeighingFormState = {
  vehicleId: "",
  carrierId: "",
  customerId: "",
  driverId: "",
  productId: "",
  paymentTermId: "",
  unitPriceCents: null
};

type RegistrationsTab = "customers" | "price_tables" | "products" | "payment_terms" | "transport";

type AppPhase = "checking_access" | "locked" | "unlocked";

export function App({ desktopApi = getWindowDesktopApi(), initialStatus = null }: AppProps = {}) {
  const [phase, setPhase] = useState<AppPhase>("checking_access");
  const [status, setStatus] = useState<DesktopStatusSnapshot | null>(initialStatus);
  const [updateState, setUpdateState] = useState<UpdateState>(createInitialUpdateState());
  const [openOperations, setOpenOperations] = useState<WeighingOperationSummary[]>([]);
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
  const [cloudStatus, setCloudStatus] = useState<{ totalOperations: number; lastSync: string | null } | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [unitName, setUnitName] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [errorLogs, setErrorLogs] = useState<Array<{ timestamp: string; level: string; source: string; message: string; details?: string }>>([]);
  const [accessStatus, setAccessStatus] = useState<DesktopAccessStatus | null>(null);
  const [omieStatus, setOmieStatus] = useState<{
    configured: boolean;
    totalCustomers: number;
    totalProducts: number;
    totalPaymentTerms: number;
    pendingPushCustomers: number;
    lastSyncAt: string | null;
  } | null>(null);
  const [registrationsTab, setRegistrationsTab] = useState<RegistrationsTab>("customers");
  const [closingOperationId, setClosingOperationId] = useState<string | null>(null);
  const [omieSyncing, setOmieSyncing] = useState(false);

  useEffect(() => {
    const captureLog = (level: string, source: string) => (...args: unknown[]) => {
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
    if (!desktopApi) {
      setPhase("locked");
      return;
    }

    desktopApi.getAccessStatus().then((access) => {
      setAccessStatus(access);
      setCompanyName(access.companyName);
      setUnitName(access.unitName);
      if (access.canOperate) {
        setPhase("unlocked");
      } else {
        setPhase("locked");
      }
    }).catch(() => {
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
        nextPrinters,
        nextProfiles,
        nextReceipts,
      ] = await Promise.all([
        desktopApi.getStatus(navigator.onLine),
        desktopApi.getUpdateState(),
        desktopApi.listOpenWeighingOperations(),
        desktopApi.listWindowsPrinters(),
        desktopApi.listPrintProfiles(),
        desktopApi.listPrintReceipts(),
      ]);

      if (active) {
        setStatus(nextStatus);
        setUpdateState(nextUpdateState);
        setOpenOperations(nextOpenOperations);
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

    setOpenOperations(await desktopApi.listOpenWeighingOperations());
    setStatus(await desktopApi.getStatus(navigator.onLine));
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
        setMessage(`Sincronizacao concluida com erros. ${result.synced} enviados, ${result.failed} falhas.`);
        if (result.errors.length > 0) {
          console.error("Cloud sync errors:", result.errors);
        }
      }
    } catch (error) {
      setMessage(`Falha na sincronizacao: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
    } finally {
      setCloudSyncing(false);
    }
  }

  async function handleSyncOmie(): Promise<void> {
    if (!desktopApi) return;

    setOmieSyncing(true);
    setMessage("Sincronizando OMIE...");
    try {
      const result = await desktopApi.omieSync();
      setMessage(
        `OMIE: ${result.customersPulled} clientes puxados, ${result.customersPushed} enviados, ` +
        `${result.productsSynced} produtos, ${result.paymentTermsSynced} condicoes.`
      );
      const omieStatusResult = await desktopApi.getOmieStatus();
      setOmieStatus(omieStatusResult);
    } catch (error) {
      setMessage(`Falha no sync OMIE: ${getErrorMessage(error)}`);
    } finally {
      setOmieSyncing(false);
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
        paymentTermId: form.paymentTermId || undefined,
        unitPriceCents: form.unitPriceCents ?? undefined
      });
      setMessage(`Entrada capturada: ${operation.entryWeightKg} kg.`);
      setActiveView("open-operations");
      await refreshOpenOperations();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  async function handleCloseOperation(operationId: string, operationType: OperationType): Promise<void> {
    if (!desktopApi) return;

    try {
      const operation = await desktopApi.closeWeighing(operationId, operationType);
      const receipt = await desktopApi.printReceipt(operation.id);
      const receiptStatus =
        receipt.status === "printed"
          ? `Cupom ${receipt.receiptNumber} impresso.`
          : `Falha ao imprimir cupom: ${receipt.errorMessage}.`;
      setMessage(`Operacao fechada. Peso liquido: ${operation.netWeightKg} kg. ${receiptStatus}`);
      await refreshOpenOperations();
      await refreshPrintData();
    } catch (error) {
      setMessage(getErrorMessage(error));
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

  async function handleCancelOperation(operationId: string): Promise<void> {
    const reason = window.prompt("Motivo do cancelamento");

    if (!desktopApi || reason === null) {
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

  if (phase === "checking_access") {
    return (
      <main style={styles.page}>
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
        <main style={styles.page}>
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
      <main style={styles.page}>
        <div style={{ ...styles.card, maxWidth: "480px", margin: "auto", marginTop: "40px" }}>
          <h1 style={styles.title}>API do desktop indisponivel</h1>
          <p style={styles.subtitle}>Abra o aplicativo pelo Electron.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <header style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <img src="midia/logodesk.png" alt="KyberRock" style={styles.topBarLogo} />
          <span style={styles.topBarBrand}>{desktopAppInfo.name}</span>
          {companyName && unitName ? (
            <span style={styles.topBarMeta}>
              {companyName} — {unitName}
            </span>
          ) : null}
          <span style={styles.topBarMessage}>{message}</span>
        </div>
        <div style={styles.topBarActions}>
          <button
            type="button"
            onClick={() => setShowLogsModal(true)}
            style={errorLogs.some((l) => l.level === "error") ? styles.topBarButtonError : styles.topBarButton}
            title="Ver logs do sistema"
          >
            Logs {errorLogs.length > 0 ? `(${errorLogs.length})` : ""}
          </button>
          <button type="button" onClick={handleExportBackup} style={styles.topBarButton}>
            Exportar
          </button>
          <button type="button" onClick={handleRestoreBackup} style={styles.topBarButton}>
            Restaurar
          </button>
          <button type="button" onClick={() => void handleLogout()} style={styles.topBarButtonDanger}>
            Sair
          </button>
        </div>
      </header>

      <nav aria-label="Fluxo operacional" style={styles.navigation}>
        <button
          type="button"
          onClick={() => setActiveView("dashboard")}
          style={viewButtonStyle(activeView === "dashboard")}
        >
          Painel
        </button>
        <button
          type="button"
          onClick={() => setActiveView("new-weighing")}
          style={viewButtonStyle(activeView === "new-weighing")}
        >
          Nova entrada
        </button>
        <button
          type="button"
          onClick={() => setActiveView("open-operations")}
          style={viewButtonStyle(activeView === "open-operations")}
        >
          Operacoes abertas
        </button>
        <button
          type="button"
          onClick={() => setActiveView("scale")}
          style={viewButtonStyle(activeView === "scale")}
        >
          Balanca
        </button>
        <button
          type="button"
          onClick={() => setActiveView("registrations")}
          style={viewButtonStyle(activeView === "registrations")}
        >
          Cadastros
        </button>
        <button
          type="button"
          onClick={() => setActiveView("printing")}
          style={viewButtonStyle(activeView === "printing")}
        >
          Impressao
        </button>
        <button
          type="button"
          onClick={() => setActiveView("cloud")}
          style={viewButtonStyle(activeView === "cloud")}
        >
          Cloud
        </button>
      </nav>

      {showUpdateModal ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>Nova versão disponível</h2>
            <p style={styles.modalText}>
              A versão <strong>{availableVersion}</strong> do KyberRock Desktop está disponível.
              Deseja atualizar agora?
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2 style={{ ...styles.modalTitle, margin: 0 }}>Logs do sistema</h2>
              <button type="button" onClick={() => setErrorLogs([])} style={styles.secondaryButton}>
                Limpar
              </button>
            </div>
            {errorLogs.length === 0 ? (
              <p style={styles.muted}>Nenhum log capturado. Logs de erro aparecerao aqui automaticamente.</p>
            ) : (
              <div style={{ maxHeight: "60vh", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                {errorLogs.slice().reverse().map((log, index) => (
                  <div
                    key={`${log.timestamp}-${index}`}
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid #f1f5f9",
                      background: log.level === "error" ? "#fef2f2" : log.level === "warn" ? "#fffbeb" : "#fff"
                    }}
                  >
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "#64748b" }}>
                      <span>{new Date(log.timestamp).toLocaleString("pt-BR")}</span>
                      <span style={{
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: log.level === "error" ? "#fee2e2" : log.level === "warn" ? "#fef3c7" : "#e2e8f0",
                        color: log.level === "error" ? "#991b1b" : log.level === "warn" ? "#92400e" : "#475569",
                        fontWeight: 700,
                        fontSize: "10px"
                      }}>{log.level.toUpperCase()}</span>
                      <span>{log.source}</span>
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "13px", color: "#0f172a", wordBreak: "break-word" }}>
                      {log.message}
                    </div>
                    {log.details ? (
                      <div style={{ marginTop: "4px", fontSize: "11px", color: "#94a3b8", wordBreak: "break-word" }}>
                        {log.details}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <button type="button" onClick={() => setShowLogsModal(false)} style={styles.secondaryButton}>
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
              O app checa automaticamente por novas versoes. Quando houver uma disponivel, voce sera notificado.
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
          onCancel={() => setActiveView("dashboard")}
        />
      ) : null}

      {activeView === "open-operations" ? (
        <section style={styles.panel}>
          <h2 style={styles.panelTitle}>Operacoes em aberto</h2>
          {openOperations.length === 0 ? (
            <p style={styles.muted}>Nenhuma operacao aberta.</p>
          ) : null}
          {openOperations.map((operation) => (
            <article key={operation.id} style={styles.operationRow}>
              <div>
                <strong>{operation.plate}</strong>
                <p style={styles.muted}>
                  {operation.customerName} - {operation.driverName} - {operation.productDescription}
                </p>
                <p>
                  Tipo: {operation.operationType === "invoice" ? "Com nota" : "Interna"} | Entrada:{" "}
                  {operation.entryWeightKg} kg | Preco: {formatMoney(operation.unitPriceCents)}/kg
                </p>
                <p>Condicao: {operation.paymentTermName ?? "nao informada"}</p>
              </div>
              <div style={styles.actions}>
                <button
                  type="button"
                  onClick={() => setClosingOperationId(operation.id)}
                  style={styles.primaryButton}
                >
                  Fechar saida
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancelOperation(operation.id)}
                  style={styles.secondaryButton}
                >
                  Cancelar
                </button>
              </div>
            </article>
          ))}
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

      {activeView === "scale" ? (
        <ScaleView desktopApi={desktopApi} />
      ) : null}

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
              Selecione uma impressora instalada no Windows. O cupom e impresso sem depender de
              campo manual.
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
                    {receipt.status === "printed" ? "Impresso" : "Falhou"} em {receipt.printerName}
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
                  {omieStatus.configured ? "Conectado" : "Nao configurado"}
                </p>
                {omieStatus.configured && (
              <>
                <p>Clientes sincronizados: {omieStatus.totalCustomers}</p>
                <p>Produtos sincronizados: {omieStatus.totalProducts}</p>
                <p>Condicoes sincronizadas: {omieStatus.totalPaymentTerms}</p>
                <p>Pendentes de envio: {omieStatus.pendingPushCustomers} clientes</p>
                <p>
                  Ultima sincronizacao:{" "}
                  {omieStatus.lastSyncAt
                    ? new Date(omieStatus.lastSyncAt).toLocaleString("pt-BR")
                    : "Nunca"}
                </p>
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
              </>
            )}
          </>
        ) : (
          <p style={{ color: "#64748b" }}>Carregando status OMIE...</p>
        )}
          </article>
        </section>
      ) : null}
    </main>
  );
}

function getWindowDesktopApi(): KyberRockDesktopApi | undefined {
  return typeof window === "undefined" ? undefined : window.kyberrockDesktop;
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

interface CacheSelectOption {
  id: string;
  label: string;
}

function CacheSelect({
  label,
  entityType,
  value,
  onChange,
  onCreateNew,
  desktopApi,
  disabled = false,
  refreshKey = 0
}: {
  label: string;
  entityType: CacheEntityType;
  value: string;
  onChange: (id: string) => void;
  onCreateNew?: () => void;
  desktopApi: KyberRockDesktopApi | null;
  disabled?: boolean;
  refreshKey?: number;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<CacheSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => {
    return options.find((o) => o.id === value)?.label ?? "";
  }, [options, value]);

  useEffect(() => {
    async function load() {
      if (!desktopApi) return;
      setLoading(true);
      try {
        const result = await desktopApi.queryCache({
          entityType,
          search: search.trim(),
          limit: 20
        });
        setOptions(
          (result.rows as Array<Record<string, unknown>>).map((item) => ({
            id: String(item.id ?? item.omieCode ?? ""),
            label: String(
              item.tradeName ?? item.plate ?? item.name ?? item.description ?? item.fullName ?? ""
            )
          }))
        );
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [desktopApi, entityType, search, refreshKey]);

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
    <div ref={containerRef} style={{ position: "relative", marginBottom: "12px" }}>
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
            <div style={{ padding: "8px 12px", color: "#94a3b8", fontSize: "13px" }}>Carregando...</div>
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
                  onChange(option.id);
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

function WeighingForm({ desktopApi, form, setForm, formError, onStart, onCancel }: WeighingFormProps) {
  const [liveWeight, setLiveWeight] = useState<number | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCarrierModal, setShowCarrierModal] = useState(false);
  const [vehicleRefreshKey, setVehicleRefreshKey] = useState(0);
  const [driverRefreshKey, setDriverRefreshKey] = useState(0);
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0);
  const [carrierRefreshKey, setCarrierRefreshKey] = useState(0);

  useEffect(() => {
    if (!desktopApi) return;
    const handler = (reading: { weightKg: number }) => setLiveWeight(reading.weightKg);
    desktopApi.onScaleReading(handler as (reading: unknown) => void);
    return () => {
      desktopApi.offScaleReading(handler as (reading: unknown) => void);
    };
  }, [desktopApi]);

  useEffect(() => {
    async function fetchPrice() {
      if (!desktopApi || !form.customerId || !form.productId) return;
      try {
        const price = await desktopApi.getPriceForCustomerProduct(form.customerId, form.productId);
        if (price !== null) {
          setForm((prev) => ({ ...prev, unitPriceCents: price }));
        }
      } catch {
        /* ignore */
      }
    }

    fetchPrice();
  }, [desktopApi, form.customerId, form.productId]);

  return (
    <section style={styles.panel}>
      <h2 style={styles.panelTitle}>Nova pesagem</h2>
      <p style={styles.muted}>
        Selecione a placa, cliente, transportadora e demais dados. O peso vem da balanca em tempo real.
      </p>

      {liveWeight !== null ? (
        <div
          style={{
            background: "#f1f5f9",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "16px",
            textAlign: "center"
          }}
        >
          <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>Peso atual</div>
          <div style={{ fontSize: "32px", fontWeight: 700, color: "#0f172a" }}>
            {liveWeight.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kg
          </div>
        </div>
      ) : null}

      {formError ? <p style={styles.errorMessage}>{formError}</p> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          marginBottom: "16px"
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "14px", color: "#475569", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px" }}>
          Entidade
        </div>
        <div style={{ fontWeight: 700, fontSize: "14px", color: "#475569", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px" }}>
          Transporte
        </div>

        <div>
          <CacheSelect
            label="Cliente"
            entityType="customer"
            value={form.customerId}
            onChange={(id) => setForm((prev) => ({ ...prev, customerId: id }))}
            onCreateNew={() => setShowCustomerModal(true)}
            desktopApi={desktopApi}
            refreshKey={customerRefreshKey}
          />
        </div>

        <div>
          <CacheSelect
            label="Placa"
            entityType="vehicle"
            value={form.vehicleId}
            onChange={(id) => setForm((prev) => ({ ...prev, vehicleId: id, carrierId: "" }))}
            onCreateNew={() => setShowVehicleModal(true)}
            desktopApi={desktopApi}
            refreshKey={vehicleRefreshKey}
          />
        </div>

        <div>
          <CacheSelect
            label="Produto"
            entityType="product"
            value={form.productId}
            onChange={(id) => setForm({ ...form, productId: id })}
            desktopApi={desktopApi}
          />
        </div>

        <div>
          <CacheSelect
            label="Transportadora"
            entityType="carrier"
            value={form.carrierId}
            onChange={(id) => setForm((prev) => ({ ...prev, carrierId: id }))}
            onCreateNew={() => setShowCarrierModal(true)}
            desktopApi={desktopApi}
            refreshKey={carrierRefreshKey}
          />
        </div>

        <div>
          <CacheSelect
            label="Condicao de pagamento"
            entityType="payment_term"
            value={form.paymentTermId}
            onChange={(id) => setForm({ ...form, paymentTermId: id })}
            desktopApi={desktopApi}
          />
        </div>

        <div>
          <CacheSelect
            label="Motorista"
            entityType="driver"
            value={form.driverId}
            onChange={(id) => setForm({ ...form, driverId: id })}
            onCreateNew={() => setShowDriverModal(true)}
            desktopApi={desktopApi}
            refreshKey={driverRefreshKey}
          />
        </div>

        <div>
          <PriceInput
            valueCents={form.unitPriceCents}
            onChange={(cents) => setForm((prev) => ({ ...prev, unitPriceCents: cents }))}
          />
        </div>

        <div></div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button type="button" onClick={onStart} style={styles.primaryButton}>
          Capturar peso entrada
        </button>
        <button type="button" onClick={onCancel} style={styles.secondaryButton}>
          Cancelar
        </button>
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
              try { await desktopApi.vehiclesLinkCarrier(form.vehicleId, id); } catch { /* ignore */ }
            }
            setCarrierRefreshKey((k) => k + 1);
            setVehicleRefreshKey((k) => k + 1);
          }}
        />
      ) : null}
    </section>
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
        <h3 style={{ margin: "0 0 12px 0", color: "#0f172a" }}>Cadastrar veiculo</h3>
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
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={styles.input} />
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
        <h3 style={{ margin: "0 0 12px 0", color: "#0f172a" }}>Cadastrar motorista</h3>
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
        <h3 style={{ margin: "0 0 12px 0", color: "#0f172a" }}>Cadastrar cliente</h3>
        {error ? <p style={styles.errorMessage}>{error}</p> : null}
        <label style={styles.fieldLabel}>
          Nome fantasia
          <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} style={styles.input} />
        </label>
        <label style={styles.fieldLabel}>
          Razao social
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} style={styles.input} />
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
        <h3 style={{ margin: "0 0 12px 0", color: "#0f172a" }}>Cadastrar transportadora</h3>
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
            placeholder="000.000.000-00 ou 00.000.000/0000-00"
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
  padding: "24px",
  width: "100%",
  maxWidth: "400px",
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
        <h3 style={{ margin: "0 0 12px 0", color: "#0f172a" }}>Tipo de operacao na saida</h3>
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
          <button type="button" onClick={() => onConfirm(operationType)} style={styles.primaryButton}>
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
    ? (valueCents !== null ? String(valueCents / 100).replace(".", ",") : "")
    : valueCents !== null ? centsToBRL(valueCents) : "";

  return (
    <label style={styles.fieldLabel}>
      Preco por kg
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        placeholder="0,00"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^\d,]/g, "");
          if (!raw) { onChange(null); return; }
          const parts = raw.split(",");
          const intPart = parts[0] || "0";
          const decPart = (parts[1] || "").slice(0, 2).padEnd(2, "0");
          onChange(Number(`${intPart}${decPart}`));
        }}
        style={styles.input}
      />
      {valueCents !== null ? (
        <span style={{ fontSize: "12px", color: "#64748b" }}>
          {centsToBRL(valueCents)}/kg
        </span>
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada.";
}

function viewButtonStyle(active: boolean) {
  return active ? styles.primaryButton : styles.secondaryButton;
}

function subTabStyle(active: boolean) {
  return {
    border: "none",
    borderBottom: active ? "2px solid #0f172a" : "2px solid transparent",
    borderRadius: "0",
    padding: "8px 16px",
    background: "transparent",
    color: active ? "#0f172a" : "#64748b",
    cursor: "pointer",
    fontWeight: active ? 700 : 400,
    fontSize: "14px"
  };
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
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar veiculo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "200px" }}
        />
        <button type="button" onClick={openCreate} style={styles.primaryButton}>
          + Novo Veiculo
        </button>
      </div>

      {msg ? <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "8px" }}>{msg}</p> : null}

      {showForm ? (
        <div style={{ ...styles.card, marginBottom: "16px", padding: "20px" }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? "Editar Veiculo" : "Novo Veiculo"}</h3>
          {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={styles.input} />
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
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>Salvar</button>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>Cancelar</button>
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{plate}</strong>
                    {description ? <span style={{ color: "#64748b", fontSize: "13px", marginLeft: "8px" }}>{description}</span> : null}
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <select
                      value={currentCarrierId}
                      onChange={(e) => handleLinkCarrier(String(item.id), e.target.value)}
                      style={{ ...styles.input, width: "180px", fontSize: "13px" }}
                    >
                      <option value="">Sem transportadora</option>
                      {carriers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => openEdit(item)} style={styles.secondaryButton}>Editar</button>
                    <button type="button" onClick={() => handleDelete(String(item.id))} style={{ ...styles.secondaryButton, color: "#b91c1c", borderColor: "#fecaca" }}>Excluir</button>
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
        {transportTab === "vehicles" ? (
          <VehicleListView desktopApi={desktopApi} />
        ) : null}
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
        {transportTab === "carriers" ? (
          <CarrierListView desktopApi={desktopApi} />
        ) : null}
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
  const [carrierVehicles, setCarrierVehicles] = useState<Array<{ id: string; plate: string; description: string | null }>>([]);

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
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar transportadora..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "200px" }}
        />
        <button type="button" onClick={openCreate} style={styles.primaryButton}>
          + Nova Transportadora
        </button>
      </div>

      {message ? <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "12px" }}>{message}</p> : null}

      {showForm ? (
        <div style={{ ...styles.card, marginBottom: "16px", padding: "20px" }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? "Editar Transportadora" : "Nova Transportadora"}</h3>
          {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={styles.fieldLabel}>
              Nome *
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={styles.input} />
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
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>Salvar</button>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>Cancelar</button>
          </div>
        </div>
      ) : null}

      {carriers.length === 0 ? (
        <p style={{ color: "#64748b" }}>Nenhuma transportadora cadastrada.</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {carriers.map((carrier) => (
            <div key={carrier.id} style={{ ...styles.card, padding: "12px 16px", cursor: "pointer" }} onClick={() => setSelectedCarrier(carrier.id === selectedCarrier ? null : carrier.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{carrier.name}</strong>
                  {carrier.document ? <span style={{ color: "#64748b", fontSize: "13px", marginLeft: "8px" }}>{carrier.document}</span> : null}
                  <span style={{ fontSize: "11px", marginLeft: "8px", padding: "2px 6px", borderRadius: "4px", background: carrier.source === "omie" ? "#dbeafe" : "#dcfce7", color: carrier.source === "omie" ? "#1e40af" : "#166534" }}>
                    {carrier.source === "omie" ? "OMIE" : "LOCAL"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(carrier); }} style={styles.secondaryButton}>Editar</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(carrier.id); }} style={{ ...styles.secondaryButton, color: "#b91c1c", borderColor: "#fecaca" }}>Excluir</button>
                </div>
              </div>
              {selectedCarrier === carrier.id ? (
                <div style={{ marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#475569" }}>Veiculos vinculados</h4>
                  {carrierVehicles.length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0 }}>Nenhum veiculo vinculado.</p>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {carrierVehicles.map((v) => (
                        <span key={v.id} style={{ fontSize: "13px", background: "#f1f5f9", padding: "4px 8px", borderRadius: "4px", color: "#0f172a" }}>
                          {v.plate}{v.description ? ` — ${v.description}` : ""}
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
  isActive: boolean;
}

interface CarrierCacheEntry {
  id: string;
  name: string;
  document: string | null;
  source: string;
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
}

function CustomerListView({
  desktopApi
}: {
  desktopApi: KyberRockDesktopApi;
}) {
  const [customers, setCustomers] = useState<CustomerCacheEntry[]>([]);
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
    defaultCarrierId: ""
  });
  const [formError, setFormErrorState] = useState<string | null>(null);
  const [message, setMessageState] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<CarrierCacheEntry[]>([]);

  useEffect(() => {
    loadCustomers();
    loadCarriers();
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

  async function loadCustomers(): Promise<void> {
    try {
      const result = await desktopApi.queryCache({
        entityType: "customer",
        search: search || undefined,
        limit: 200
      });
      setCustomers(result.rows as CustomerCacheEntry[]);
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
      defaultCarrierId: ""
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
      defaultCarrierId: customer.defaultCarrierId ?? ""
    });
    setEditingId(customer.id);
    setFormErrorState(null);
    setShowForm(true);
  }

  function validateForm(): string | null {
    if (!form.tradeName.trim()) return "Nome fantasia e obrigatorio.";
    if (!form.legalName.trim()) return "Razao social e obrigatoria.";
    return null;
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

    try {
      if (editingId) {
        await desktopApi.customersUpdate(editingId, {
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          omieBillingBlocked: form.omieBillingBlocked || undefined,
          observations: form.observations.trim() || undefined,
          defaultCarrierId: form.defaultCarrierId || null
        });
        setMessageState("Cliente atualizado com sucesso.");
      } else {
        await desktopApi.customersCreate({
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: normalizedDocument || undefined,
          phone: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          omieBillingBlocked: form.omieBillingBlocked,
          observations: form.observations.trim() || undefined,
          defaultCarrierId: form.defaultCarrierId || undefined
        });
        setMessageState("Cliente criado com sucesso.");
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
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "200px" }}
        />
        <button type="button" onClick={openCreateForm} style={styles.primaryButton}>
          + Novo Cliente
        </button>
      </div>

      {message ? (
        <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "12px" }}>{message}</p>
      ) : null}

      {showForm ? (
        <div style={{ ...styles.card, marginBottom: "16px", padding: "20px" }}>
          <h3 style={{ marginTop: 0 }}>
            {editingId ? "Editar Cliente" : "Novo Cliente"}
          </h3>

          {formError ? <p style={styles.errorMessage}>{formError}</p> : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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
                onChange={(e) => setForm({ ...form, document: normalizeDocument(e.target.value) })}
                placeholder="00.000.000/0000-00"
                style={styles.input}
              />
            </label>
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
            <label style={styles.fieldLabel}>
              Limite de Credito (R$)
              <input
                value={form.creditLimitReais}
                onChange={(e) => setForm({ ...form, creditLimitReais: e.target.value })}
                placeholder="50.000,00"
                style={styles.input}
              />
            </label>
          </div>

          <label style={{ ...styles.fieldLabel, marginTop: "12px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="checkbox"
                checked={form.omieBillingBlocked}
                onChange={(e) => setForm({ ...form, omieBillingBlocked: e.target.checked })}
              />
              Cliente bloqueado
            </span>
          </label>

          <label style={{ ...styles.fieldLabel, marginTop: "12px" }}>
            Observacoes
            <input
              value={form.observations}
              onChange={(e) => setForm({ ...form, observations: e.target.value })}
              style={styles.input}
            />
          </label>

          <label style={{ ...styles.fieldLabel, marginTop: "12px" }}>
            Transportadora padrao
            <select
              value={form.defaultCarrierId}
              onChange={(e) => setForm({ ...form, defaultCarrierId: e.target.value })}
              style={styles.input}
            >
              <option value="">Selecione a transportadora padrao</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>
              Salvar
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={styles.secondaryButton}
            >
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
                  Limite: {formatMoney(customer.creditLimitCents)} | Em aberto: {formatMoney(customer.openReceivablesCents)}
                  {customer.omieBillingBlocked ? " | \uD83D\uDD34 Bloqueado" : ""}
                </p>
                {customer.observations ? (
                  <p style={{ ...styles.muted, margin: "2px 0 0 0", fontSize: "12px", fontStyle: "italic" }}>
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
    </div>
  );
}

function ScaleView({
  desktopApi
}: {
  desktopApi: KyberRockDesktopApi;
}) {
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
          <div style={{
            marginTop: "16px",
            padding: "40px 20px",
            background: connected ? "#f0fdf4" : "#f8fafc",
            borderRadius: "16px",
            border: `3px solid ${connected && reading?.stable ? "#16a34a" : connected ? "#d97706" : "#e2e8f0"}`,
            textAlign: "center"
          }}>
            <p style={{ fontSize: "48px", fontWeight: 700, margin: 0, color: connected ? "#0f172a" : "#94a3b8", fontFamily: "monospace" }}>
              {reading ? new Intl.NumberFormat("pt-BR").format(reading.weightKg) : "----"}
            </p>
            <p style={{ fontSize: "20px", color: "#64748b", margin: "8px 0 0 0" }}>
              {connected ? "kg" : ""}
            </p>
            {reading ? (
              <p style={{
                fontSize: "14px",
                color: reading.stable ? "#16a34a" : "#d97706",
                marginTop: "8px",
                fontWeight: 700
              }}>
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
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadItems();
  }, [search]);

  async function loadItems(): Promise<void> {
    const result = await desktopApi.queryCache({
      entityType: entityType as unknown as "product" | "payment_term",
      search: search || undefined,
      limit: 200
    });
    setItems(result.rows as Array<Record<string, unknown>>);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          placeholder={`Buscar ${title.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "200px" }}
        />
      </div>
      {items.length === 0 ? (
        <p style={{ color: "#64748b" }}>Nenhum registro encontrado. Execute a sincronizacao OMIE.</p>
      ) : (
        items.map((item) => (
          <div key={String(item.id)} style={{ ...styles.operationRow, borderTop: "1px solid #e2e8f0" }}>
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
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          placeholder={`Buscar ${title.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: "200px" }}
        />
        <button type="button" onClick={openCreate} style={styles.primaryButton}>
          + Novo
        </button>
      </div>

      {msg ? <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "8px" }}>{msg}</p> : null}

      {showForm ? (
        <div style={{ ...styles.card, marginBottom: "16px", padding: "20px" }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? "Editar" : "Novo"}</h3>
          {fields.map((f) => (
            <label key={f.key} style={styles.fieldLabel}>
              {f.label}{f.required ? " *" : ""}
              <input
                value={
                  f.key === "document" ? formatDocument(formData[f.key] || "") :
                  f.key === "phone" ? formatPhone(formData[f.key] || "") :
                  formData[f.key] || ""
                }
                onChange={(e) => setFormData({
                  ...formData,
                  [f.key]: f.key === "document" ? normalizeDocument(e.target.value) :
                           f.key === "phone" ? normalizePhone(e.target.value) :
                           e.target.value
                })}
                style={styles.input}
              />
            </label>
          ))}
          <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>Salvar</button>
            <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>Cancelar</button>
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
              {displaySub(item) ? <p style={{ ...styles.muted, margin: "2px 0 0 0", fontSize: "13px" }}>{displaySub(item)}</p> : null}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" onClick={() => openEdit(item)} style={styles.secondaryButton}>Editar</button>
              <button type="button" onClick={() => handleDelete(item.id as string)} style={{ ...styles.secondaryButton, color: "#b91c1c", borderColor: "#fecaca" }}>Excluir</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function PriceTableListView({
  desktopApi
}: {
  desktopApi: KyberRockDesktopApi;
}) {
  const [tables, setTables] = useState<Array<{ id: string; name: string; needsPush?: boolean }>>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ id: string; productId: string; productDesc?: string; unitPriceCents: number }>>([]);
  const [linkedCustomers, setLinkedCustomers] = useState<Array<{ id: string; customerId: string; customerTradeName: string }>>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; tradeName: string }>>([]);
  const [products, setProducts] = useState<Array<{ id: string; code: string; description: string }>>([]);
  const [newTableName, setNewTableName] = useState("");
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editingTableName, setEditingTableName] = useState("");
  const [itemProductId, setItemProductId] = useState("");
  const [itemPriceReais, setItemPriceReais] = useState("");
  const [linkCustomerId, setLinkCustomerId] = useState("");
  const [message, setPriceMessage] = useState<string | null>(null);

  useEffect(() => {
    loadTables();
    loadProducts();
  }, []);

  useEffect(() => {
    if (selectedTableId) {
      loadTableDetails(selectedTableId);
      loadCustomers();
    }
  }, [selectedTableId]);

  async function loadTables(): Promise<void> {
    const list = await desktopApi.priceTablesList() as Array<{ id: string; name: string }>;
    setTables(list);
  }

  async function loadCustomers(): Promise<void> {
    const result = await desktopApi.queryCache({ entityType: "customer", activeOnly: true, limit: 200 });
    setCustomers(result.rows as Array<{ id: string; tradeName: string }>);
  }

  async function loadProducts(): Promise<void> {
    const result = await desktopApi.queryCache({ entityType: "product", activeOnly: true, limit: 200 });
    setProducts(result.rows as Array<{ id: string; code: string; description: string }>);
  }

  async function loadTableDetails(tableId: string): Promise<void> {
    const [itemList, links] = await Promise.all([
      desktopApi.priceTablesListItems(tableId) as Promise<Array<{ id: string; productId: string; unitPriceCents: number }>>,
      desktopApi.priceTablesListCustomerLinks(tableId) as Promise<Array<{ id: string; customerId: string; customerTradeName: string }>>
    ]);

    const enriched = await Promise.all(
      itemList.map(async (item) => {
        try {
          const productRows = (await desktopApi.queryCache({ entityType: "product" })).rows as Array<{ id: string; description: string }>;
          const product = productRows.find((p) => p.id === item.productId);
          return { ...item, productDesc: product?.description ?? item.productId };
        } catch {
          return { ...item, productDesc: item.productId };
        }
      })
    );

    setItems(enriched);
    setLinkedCustomers(links);
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

  async function handleLinkCustomer(): Promise<void> {
    if (!selectedTableId || !linkCustomerId) return;
    await desktopApi.priceTablesLinkCustomer({
      customerId: linkCustomerId,
      priceTableId: selectedTableId
    });
    setLinkCustomerId("");
    setPriceMessage("Cliente vinculado.");
    await loadTableDetails(selectedTableId);
  }

  async function handleUnlinkCustomer(linkId: string): Promise<void> {
    await desktopApi.priceTablesUnlinkCustomer(linkId);
    setPriceMessage("Vinculo removido.");
    if (selectedTableId) await loadTableDetails(selectedTableId);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: "20px", minHeight: "400px" }}>
      <div style={{ borderRight: "1px solid #e2e8f0", paddingRight: "16px" }}>
        <h3 style={{ marginTop: 0 }}>Tabelas</h3>
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          <input
            placeholder="Nova tabela..."
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
            style={{ ...styles.input, flex: 1, padding: "6px 8px", fontSize: "13px" }}
          />
          <button type="button" onClick={handleCreateTable} style={{ ...styles.primaryButton, padding: "6px 10px", fontSize: "13px" }}>
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
              fontWeight: selectedTableId === table.id ? 700 : 400
            }}
          >
            {editingTableId === table.id ? (
              <div style={{ display: "flex", gap: "4px" }}>
                <input
                  value={editingTableName}
                  onChange={(e) => setEditingTableName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRenameTable(); }}
                  style={{ ...styles.input, flex: 1, padding: "4px 6px", fontSize: "12px" }}
                  autoFocus
                />
                <button type="button" onClick={handleRenameTable} style={{ ...styles.primaryButton, padding: "4px 6px", fontSize: "11px" }}>OK</button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "14px" }}>{table.name}</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditingTableId(table.id); setEditingTableName(table.name); }}
                    style={{ border: "none", background: "none", cursor: "pointer", fontSize: "12px", color: "#64748b" }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteTable(table.id); }}
                    style={{ border: "none", background: "none", cursor: "pointer", fontSize: "12px", color: "#b91c1c" }}
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
        {message ? <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: "8px" }}>{message}</p> : null}

        {!selectedTableId ? (
          <p style={{ color: "#64748b" }}>Selecione uma tabela para ver seus itens.</p>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>Itens da Tabela</h3>

            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "flex-end" }}>
              <label style={{ ...styles.fieldLabel, marginBottom: 0, flex: 1 }}>
                Produto
                <select
                  value={itemProductId}
                  onChange={(e) => setItemProductId(e.target.value)}
                  style={styles.input}
                >
                  <option value="">Selecione...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} - {p.description}</option>
                  ))}
                </select>
              </label>
              <label style={{ ...styles.fieldLabel, marginBottom: 0, width: "120px" }}>
                Preco/kg (R$)
                <input
                  value={itemPriceReais}
                  onChange={(e) => setItemPriceReais(e.target.value)}
                  placeholder="0,45"
                  style={styles.input}
                />
              </label>
              <button type="button" onClick={handleAddItem} style={{ ...styles.primaryButton, padding: "10px 14px" }}>
                Adicionar
              </button>
            </div>

            {items.length === 0 ? (
              <p style={{ color: "#64748b", marginBottom: "24px" }}>
                Nenhum item cadastrado.
              </p>
            ) : (
              <div style={{ marginBottom: "24px" }}>
                {items.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid #e2e8f0" }}>
                    <span>
                      <strong>{item.productDesc}</strong> — {formatMoney(item.unitPriceCents)}/kg
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "#b91c1c", fontSize: "16px" }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ marginTop: "24px" }}>Clientes Vinculados</h3>

            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", alignItems: "flex-end" }}>
              <label style={{ ...styles.fieldLabel, marginBottom: 0, flex: 1 }}>
                Cliente
                <select
                  value={linkCustomerId}
                  onChange={(e) => setLinkCustomerId(e.target.value)}
                  style={styles.input}
                >
                  <option value="">Selecione...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.tradeName}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={handleLinkCustomer} style={{ ...styles.primaryButton, padding: "10px 14px" }}>
                Vincular
              </button>
            </div>

            {linkedCustomers.length === 0 ? (
              <p style={{ color: "#64748b" }}>Nenhum cliente vinculado.</p>
            ) : (
              linkedCustomers.map((link) => (
                <div key={link.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid #e2e8f0" }}>
                  <span>{link.customerTradeName}</span>
                  <button
                    type="button"
                    onClick={() => handleUnlinkCustomer(link.id)}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "#b91c1c", fontSize: "16px" }}
                  >
                    ✕
                  </button>
                </div>
              ))
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
    padding: "32px",
    fontFamily: "Segoe UI, Arial, sans-serif",
    color: "#0f172a",
    background: "#f8fafc"
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "10px 20px",
    borderRadius: "12px",
    background: "#ffffff",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.06)",
    marginBottom: "16px"
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap" as const
  },
  topBarLogo: {
    height: "32px",
    width: "auto"
  },
  topBarBrand: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#0f172a"
  },
  topBarMeta: {
    fontSize: "13px",
    color: "#64748b"
  },
  topBarMessage: {
    fontSize: "13px",
    color: "#94a3b8"
  },
  topBarActions: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const
  },
  topBarButton: {
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "6px 12px",
    background: "#ffffff",
    color: "#475569",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500
  },
  topBarButtonError: {
    border: "1px solid #fecaca",
    borderRadius: "8px",
    padding: "6px 12px",
    background: "#fef2f2",
    color: "#b91c1c",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600
  },
  topBarButtonDanger: {
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "6px 12px",
    background: "#ffffff",
    color: "#b91c1c",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500
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
    background: "#ffffff",
    padding: "24px",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "480px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.15)"
  },
  modalTitle: {
    margin: "0 0 8px 0",
    color: "#0f172a"
  },
  modalText: {
    color: "#475569",
    margin: "0 0 16px 0"
  },
  modalActions: {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end"
  },
  hero: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "24px",
    padding: "28px",
    borderRadius: "20px",
    background: "#ffffff",
    boxShadow: "0 18px 60px rgba(15, 23, 42, 0.08)"
  },
  kicker: {
    margin: 0,
    color: "#475569",
    fontSize: "14px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const
  },
  title: {
    margin: "10px 0",
    fontSize: "42px",
    lineHeight: 1.05
  },
  subtitle: {
    margin: 0,
    color: "#334155",
    fontSize: "18px"
  },
  actions: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap" as const
  },
  primaryButton: {
    border: "none",
    borderRadius: "12px",
    padding: "12px 16px",
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "12px 16px",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 700
  },
  twoColumns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
    marginTop: "20px"
  },
  navigation: {
    display: "flex",
    gap: "12px",
    marginTop: "20px",
    flexWrap: "wrap" as const
  },
  subTabs: {
    display: "flex",
    gap: "4px",
    marginTop: "16px",
    borderBottom: "1px solid #e2e8f0",
    flexWrap: "wrap" as const
  },
  card: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    padding: "20px",
    border: "1px solid",
    borderRadius: "18px",
    background: "#ffffff"
  },
  panel: {
    marginTop: "20px",
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff"
  },
  panelTitle: {
    marginTop: 0
  },
  muted: {
    color: "#64748b"
  },
  errorMessage: {
    color: "#b91c1c",
    fontWeight: 700
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
    marginBottom: "12px",
    fontWeight: 700
  },
  input: {
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "10px 12px",
    font: "inherit"
  },
  operationRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "16px 0",
    borderTop: "1px solid #e2e8f0"
  },
  receiptRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "14px 0",
    borderTop: "1px solid #e2e8f0"
  }
};
