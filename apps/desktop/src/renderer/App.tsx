import { useEffect, useState } from "react";

import { desktopAppInfo } from "../app-info";
import type { DesktopStatusSnapshot } from "../services/status";
import {
  createInitialUpdateState,
  getManualUpdateButtonLabel,
  type UpdateState
} from "../services/update-flow";
import type { WeighingOperationSummary } from "../services/weighing-operations";
import type { KyberRockDesktopApi } from "./desktop-api";
import { buildStatusIndicatorViewModels } from "./status-view-model";

export interface AppProps {
  desktopApi?: KyberRockDesktopApi;
  initialStatus?: DesktopStatusSnapshot | null;
}

interface WeighingFormState {
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
}

const initialWeighingForm: WeighingFormState = {
  customerName: "Cliente Teste",
  plate: "ABC1D23",
  driverName: "Motorista Teste",
  productDescription: "Brita 1"
};

export function App({ desktopApi = getWindowDesktopApi(), initialStatus = null }: AppProps = {}) {
  const [status, setStatus] = useState<DesktopStatusSnapshot | null>(initialStatus);
  const [updateState, setUpdateState] = useState<UpdateState>(createInitialUpdateState());
  const [openOperations, setOpenOperations] = useState<WeighingOperationSummary[]>([]);
  const [form, setForm] = useState<WeighingFormState>(initialWeighingForm);
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

    const operation = await desktopApi.startSimulatedWeighing(form);
    setMessage(`Entrada capturada pela balanca simulada: ${operation.entryWeightKg} kg.`);
    await refreshOpenOperations();
  }

  async function handleCloseOperation(operationId: string): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const operation = await desktopApi.closeSimulatedWeighing(operationId);
    setMessage(`Operacao fechada. Peso liquido: ${operation.netWeightKg} kg.`);
    await refreshOpenOperations();
  }

  async function handleCancelOperation(operationId: string): Promise<void> {
    const reason = window.prompt("Motivo do cancelamento");

    if (!desktopApi || reason === null) {
      return;
    }

    const operation = await desktopApi.cancelWeighing(operationId, reason);
    setMessage(`Operacao cancelada: ${operation.cancelReason}.`);
    await refreshOpenOperations();
  }

  const indicators = status ? buildStatusIndicatorViewModels(status) : [];

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.kicker}>Fase 3.1 + Fase 4</p>
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
          <h2 style={styles.panelTitle}>Nova pesagem simulada</h2>
          <p style={styles.muted}>
            Nao existe campo manual de peso. A entrada e a saida vem da balanca simulada.
          </p>
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
          <button type="button" onClick={handleStartWeighing} style={styles.primaryButton}>
            Capturar entrada simulada
          </button>
        </article>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>Operacoes em aberto</h2>
        {openOperations.length === 0 ? <p style={styles.muted}>Nenhuma operacao aberta.</p> : null}
        {openOperations.map((operation) => (
          <article key={operation.id} style={styles.operationRow}>
            <div>
              <strong>{operation.plate}</strong>
              <p style={styles.muted}>
                {operation.customerName} - {operation.driverName} - {operation.productDescription}
              </p>
              <p>Entrada: {operation.entryWeightKg} kg</p>
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
