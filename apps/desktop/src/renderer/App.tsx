import { useCallback, useEffect, useState } from "react";

import { desktopAppInfo } from "../app-info";
import type {
  PrintProfileSummary,
  PrintReceiptSummary,
  WindowsPrinterSummary
} from "../services/printing";
import type { DesktopStatusSnapshot } from "../services/status";
import {
  createInitialUpdateState,
  getManualUpdateButtonLabel,
  type UpdateState
} from "../services/update-flow";
import type { OperationType, WeighingOperationSummary } from "../services/weighing-operations";
import { ActivationGate } from "./ActivationGate";
import type { KyberRockDesktopApi } from "./desktop-api";
import { buildStatusIndicatorViewModels } from "./status-view-model";

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

type ActiveView = "dashboard" | "new-weighing" | "open-operations" | "printing" | "cloud";

const initialWeighingForm: WeighingFormState = {
  operationType: "invoice",
  customerName: "Cliente Teste",
  plate: "ABC1D23",
  driverName: "Motorista Teste",
  productDescription: "Brita 1",
  paymentTermName: "A vista",
  unitPriceReais: "0,12"
};

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

  useEffect(() => {
    if (!desktopApi) {
      setPhase("locked");
      return;
    }

    desktopApi.getAccessStatus().then((access) => {
      if (access.canOperate) {
        setPhase("unlocked");
      } else {
        setPhase("locked");
      }
    }).catch(() => {
      setPhase("locked");
    });
  }, [desktopApi]);

  const handleUnlocked = useCallback(() => setPhase("unlocked"), []);

  useEffect(() => {
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
        nextReceipts
      ] = await Promise.all([
        desktopApi.getStatus(navigator.onLine),
        desktopApi.getUpdateState(),
        desktopApi.listOpenWeighingOperations(),
        desktopApi.listWindowsPrinters(),
        desktopApi.listPrintProfiles(),
        desktopApi.listPrintReceipts()
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

  const indicators = status ? buildStatusIndicatorViewModels(status) : [];

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.kicker}>Fase 5 - Impressao local</p>
          <h1 style={styles.title}>{desktopAppInfo.name}</h1>
          <p style={styles.subtitle}>{message}</p>
        </div>
        <div style={styles.actions}>
          <button type="button" onClick={handleExportBackup} style={styles.primaryButton}>
            Exportar backup
          </button>
          <button type="button" onClick={handleRestoreBackup} style={styles.secondaryButton}>
            Restaurar backup
          </button>
        </div>
      </section>

      <section aria-label="Indicadores de status" style={styles.grid}>
        {indicators.map((indicator) => (
          <article
            key={indicator.label}
            style={{ ...styles.card, borderColor: toneColor(indicator.tone) }}
          >
            <p style={styles.cardLabel}>{indicator.label}</p>
            <strong style={{ ...styles.cardValue, color: toneColor(indicator.tone) }}>
              {indicator.value}
            </strong>
            <span style={styles.cardDetail}>{indicator.detail}</span>
          </article>
        ))}
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

      {activeView === "dashboard" ? (
        <section style={styles.twoColumns}>
          <article style={styles.panel}>
            <h2 style={styles.panelTitle}>Atualizacoes</h2>
            <p style={styles.muted}>
              O app nao atualiza sozinho. Quando houver versao nova, clique para baixar e instalar.
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

function toneColor(tone: string): string {
  const colors: Record<string, string> = {
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
    neutral: "#475569"
  };

  return colors[tone] ?? colors.neutral;
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
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
    marginTop: "20px"
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
  card: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    padding: "20px",
    border: "1px solid",
    borderRadius: "18px",
    background: "#ffffff"
  },
  cardLabel: {
    margin: 0,
    color: "#64748b",
    fontSize: "14px",
    fontWeight: 700
  },
  cardValue: {
    fontSize: "24px"
  },
  cardDetail: {
    color: "#475569",
    fontSize: "14px"
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
