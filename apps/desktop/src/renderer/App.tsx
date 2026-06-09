import { useCallback, useEffect, useState } from "react";

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
import { ActivationGate } from "./ActivationGate";
import { BlockedScreen } from "./BlockedScreen";
import type { KyberRockDesktopApi } from "./desktop-api";
export interface AppProps {
  desktopApi?: KyberRockDesktopApi;
  initialStatus?: DesktopStatusSnapshot | null;
}

interface WeighingFormState {
  operationType: OperationType;
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  paymentTermName: string;
  unitPriceReais: string;
}

type ActiveView = "dashboard" | "new-weighing" | "open-operations" | "registrations" | "printing" | "cloud";

const initialWeighingForm: WeighingFormState = {
  operationType: "invoice",
  customerName: "Cliente Teste",
  plate: "ABC1D23",
  driverName: "Motorista Teste",
  productDescription: "Brita 1",
  paymentTermName: "A vista",
  unitPriceReais: "0,12"
};

type RegistrationsTab = "customers" | "price_tables" | "products" | "payment_terms" | "vehicles" | "drivers" | "carriers";

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
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState("Inicializando desktop offline-first...");
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<{ totalOperations: number; lastSync: string | null } | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [unitName, setUnitName] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [accessStatus, setAccessStatus] = useState<DesktopAccessStatus | null>(null);
  const [registrationsTab, setRegistrationsTab] = useState<RegistrationsTab>("customers");

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

  async function handleStartWeighing(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const unitPriceCents = parseCurrencyToCents(form.unitPriceReais);
    const validationError = validateWeighingForm(form, unitPriceCents);

    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);

    try {
      const operation = await desktopApi.startSimulatedWeighing({
        operationType: form.operationType,
        customerName: form.customerName,
        plate: form.plate,
        driverName: form.driverName,
        productDescription: form.productDescription,
        paymentTermName: form.paymentTermName,
        unitPriceCents: unitPriceCents ?? undefined
      });
      setMessage(`Entrada capturada pela balanca simulada: ${operation.entryWeightKg} kg.`);
      setActiveView("open-operations");
      await refreshOpenOperations();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  async function handleCloseOperation(operationId: string): Promise<void> {
    if (!desktopApi) {
      return;
    }

    try {
      const operation = await desktopApi.closeSimulatedWeighing(operationId);
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
      <section style={styles.hero}>
        <div>
          <p style={styles.kicker}>Fase 5 - Impressao local</p>
          <h1 style={styles.title}>{desktopAppInfo.name}</h1>
          {companyName && unitName ? (
            <p style={styles.subtitle}>
              <strong>{companyName}</strong> — {unitName}
            </p>
          ) : null}
          <p style={styles.subtitle}>{message}</p>
        </div>
        <div style={styles.actions}>
          <button type="button" onClick={handleExportBackup} style={styles.primaryButton}>
            Exportar backup
          </button>
          <button type="button" onClick={handleRestoreBackup} style={styles.secondaryButton}>
            Restaurar backup
          </button>
          <button type="button" onClick={() => void handleLogout()} style={styles.secondaryButton}>
            Sair da conta
          </button>
        </div>
      </section>

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
        <section style={styles.panel}>
          <h2 style={styles.panelTitle}>Nova pesagem simulada</h2>
          <p style={styles.muted}>
            Nao existe campo manual de peso. A entrada e a saida vem da balanca simulada.
          </p>
          {formError ? <p style={styles.errorMessage}>{formError}</p> : null}
          <label style={styles.fieldLabel}>
            Tipo de operacao
            <select
              value={form.operationType}
              onChange={(event) =>
                setForm({ ...form, operationType: event.target.value as OperationType })
              }
              style={styles.input}
            >
              <option value="invoice">Com nota</option>
              <option value="internal">Interna</option>
            </select>
          </label>
          <label style={styles.fieldLabel}>
            Cliente
            <input
              value={form.customerName}
              onChange={(event) => setForm({ ...form, customerName: event.target.value })}
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Placa
            <input
              value={form.plate}
              onChange={(event) => setForm({ ...form, plate: event.target.value })}
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Motorista
            <input
              value={form.driverName}
              onChange={(event) => setForm({ ...form, driverName: event.target.value })}
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Produto
            <input
              value={form.productDescription}
              onChange={(event) => setForm({ ...form, productDescription: event.target.value })}
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Forma/condicao de recebimento
            <select
              value={form.paymentTermName}
              onChange={(event) => setForm({ ...form, paymentTermName: event.target.value })}
              style={styles.input}
            >
              <option value="A vista">A vista</option>
              <option value="Quinzenal">Quinzenal</option>
              <option value="Mensal">Mensal</option>
            </select>
          </label>
          <label style={styles.fieldLabel}>
            Preco da tabela simulada por kg (R$)
            <input
              value={form.unitPriceReais}
              onChange={(event) => setForm({ ...form, unitPriceReais: event.target.value })}
              style={styles.input}
            />
          </label>
          <button type="button" onClick={handleStartWeighing} style={styles.primaryButton}>
            Capturar entrada simulada
          </button>
        </section>
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
                  onClick={() => void handleCloseOperation(operation.id)}
                  style={styles.primaryButton}
                >
                  Fechar saida simulada
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
              onClick={() => setRegistrationsTab("vehicles")}
              style={subTabStyle(registrationsTab === "vehicles")}
            >
              Veiculos
            </button>
            <button
              type="button"
              onClick={() => setRegistrationsTab("drivers")}
              style={subTabStyle(registrationsTab === "drivers")}
            >
              Motoristas
            </button>
            <button
              type="button"
              onClick={() => setRegistrationsTab("carriers")}
              style={subTabStyle(registrationsTab === "carriers")}
            >
              Transportadoras
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
              <RegistrationsPlaceholder title="Produtos (OMIE)" description="Produtos sincronizados do OMIE. Visualizacao apenas." />
            ) : null}
            {registrationsTab === "payment_terms" ? (
              <RegistrationsPlaceholder title="Condicoes de Pagamento (OMIE)" description="Condicoes de pagamento sincronizadas do OMIE." />
            ) : null}
            {registrationsTab === "vehicles" ? (
              <RegistrationsPlaceholder title="Veiculos" description="Cadastro de veiculos (placa) com suporte a cadastro rapido durante a pesagem." />
            ) : null}
            {registrationsTab === "drivers" ? (
              <RegistrationsPlaceholder title="Motoristas" description="Cadastro de motoristas com suporte a cadastro rapido durante a pesagem." />
            ) : null}
            {registrationsTab === "carriers" ? (
              <RegistrationsPlaceholder title="Transportadoras" description="Transportadoras do OMIE e cadastradas localmente." />
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
            <h2 style={styles.panelTitle}>Informacoes</h2>
            <p style={styles.muted}>
              A sincronizacao envia para o Supabase:
            </p>
            <ul style={{ color: "#64748b", paddingLeft: "20px" }}>
              <li>Operacoes de pesagem abertas</li>
              <li>Solicitacoes de carregamento</li>
              <li>Clientes e produtos</li>
              <li>Status da operacao</li>
            </ul>
            <p style={styles.muted}>
              Dados sensiveis como precos e limites de credito nao sao sincronizados.
            </p>
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

function validateWeighingForm(
  form: WeighingFormState,
  unitPriceCents: number | null | undefined
): string | null {
  if (!form.customerName.trim()) {
    return "Informe o cliente.";
  }

  if (!form.plate.trim()) {
    return "Informe a placa.";
  }

  if (!form.driverName.trim()) {
    return "Informe o motorista.";
  }

  if (!form.productDescription.trim()) {
    return "Informe o produto.";
  }

  if (unitPriceCents === null) {
    return "Informe um preco valido para a tabela simulada.";
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

function RegistrationsPlaceholder({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={{ padding: "40px 20px", textAlign: "center" }}>
      <h3 style={{ margin: "0 0 8px 0", color: "#0f172a" }}>{title}</h3>
      <p style={{ color: "#64748b", margin: 0 }}>{description}</p>
      <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "8px" }}>
        Em desenvolvimento...
      </p>
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
    observations: ""
  });
  const [formError, setFormErrorState] = useState<string | null>(null);
  const [message, setMessageState] = useState<string | null>(null);

  useEffect(() => {
    loadCustomers();
  }, [search]);

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
      observations: ""
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
      observations: customer.observations ?? ""
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

    const creditLimitCents = form.creditLimitReais.trim()
      ? parseCurrencyToCents(form.creditLimitReais)
      : undefined;

    try {
      if (editingId) {
        await desktopApi.customersUpdate(editingId, {
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: form.document.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          omieBillingBlocked: form.omieBillingBlocked || undefined,
          observations: form.observations.trim() || undefined
        });
        setMessageState("Cliente atualizado com sucesso.");
      } else {
        await desktopApi.customersCreate({
          tradeName: form.tradeName.trim(),
          legalName: form.legalName.trim(),
          document: form.document.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          creditLimitCents: creditLimitCents ?? undefined,
          omieBillingBlocked: form.omieBillingBlocked,
          observations: form.observations.trim() || undefined
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
                value={form.document}
                onChange={(e) => setForm({ ...form, document: e.target.value })}
                placeholder="00.000.000/0000-00"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Telefone
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Email
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
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
  },
  modalOverlay: {
    position: "fixed" as const,
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.5)",
    zIndex: 1000
  },
  modal: {
    width: "100%",
    maxWidth: "420px",
    padding: "28px",
    borderRadius: "20px",
    background: "#ffffff",
    boxShadow: "0 24px 80px rgba(15, 23, 42, 0.2)"
  },
  modalTitle: {
    margin: "0 0 12px 0",
    fontSize: "22px"
  },
  modalText: {
    margin: "0 0 20px 0",
    color: "#334155",
    fontSize: "16px",
    lineHeight: 1.5
  },
  modalActions: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap" as const
  }
};
