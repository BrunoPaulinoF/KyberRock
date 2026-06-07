import { useEffect, useState } from "react";

import { desktopAppInfo } from "../app-info";
import type { DesktopStatusSnapshot } from "../services/status";
import {
  createInitialUpdateState,
  getManualUpdateButtonLabel,
  type UpdateState
} from "../services/update-flow";
import type { OperationType, WeighingOperationSummary } from "../services/weighing-operations";
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

type ActiveView = "dashboard" | "new-weighing" | "open-operations";

const initialWeighingForm: WeighingFormState = {
  operationType: "invoice",
  customerName: "Cliente Teste",
  plate: "ABC1D23",
  driverName: "Motorista Teste",
  productDescription: "Brita 1",
  paymentTermName: "A vista",
  unitPriceReais: "0,12"
};

export function App({ desktopApi = getWindowDesktopApi(), initialStatus = null }: AppProps = {}) {
  const [status, setStatus] = useState<DesktopStatusSnapshot | null>(initialStatus);
  const [updateState, setUpdateState] = useState<UpdateState>(createInitialUpdateState());
  const [openOperations, setOpenOperations] = useState<WeighingOperationSummary[]>([]);
  const [form, setForm] = useState<WeighingFormState>(initialWeighingForm);
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState("Inicializando desktop offline-first...");

  useEffect(() => {
    let active = true;

    async function refresh(): Promise<void> {
      if (!desktopApi) {
        setMessage("API do desktop indisponivel. Abra pelo Electron.");
        return;
      }

      const [nextStatus, nextUpdateState, nextOpenOperations] = await Promise.all([
        desktopApi.getStatus(navigator.onLine),
        desktopApi.getUpdateState(),
        desktopApi.listOpenWeighingOperations()
      ]);

      if (active) {
        setStatus(nextStatus);
        setUpdateState(nextUpdateState);
        setOpenOperations(nextOpenOperations);
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
      setMessage(
        `Operacao fechada. Peso liquido: ${operation.netWeightKg} kg. Total: ${formatMoney(operation.totalCents)}.`
      );
      await refreshOpenOperations();
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

  const indicators = status ? buildStatusIndicatorViewModels(status) : [];

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.kicker}>Fase 4 - Pesagem simulada</p>
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
  }
};
