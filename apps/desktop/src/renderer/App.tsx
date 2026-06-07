import { useEffect, useState } from "react";

import { desktopAppInfo } from "../app-info";
import type { DesktopStatusSnapshot } from "../services/status";
import type { KyberRockDesktopApi } from "./desktop-api";
import { buildStatusIndicatorViewModels } from "./status-view-model";

export interface AppProps {
  desktopApi?: KyberRockDesktopApi;
  initialStatus?: DesktopStatusSnapshot | null;
}

export function App({ desktopApi = window.kyberrockDesktop, initialStatus = null }: AppProps = {}) {
  const [status, setStatus] = useState<DesktopStatusSnapshot | null>(initialStatus);
  const [message, setMessage] = useState("Inicializando desktop offline-first...");

  useEffect(() => {
    let active = true;

    async function refreshStatus(): Promise<void> {
      if (!desktopApi) {
        setMessage("API do desktop indisponivel. Abra pelo Electron.");
        return;
      }

      const nextStatus = await desktopApi.getStatus(navigator.onLine);

      if (active) {
        setStatus(nextStatus);
        setMessage("Desktop pronto para operacao local offline-first.");
      }
    }

    void refreshStatus();
    const intervalId = window.setInterval(() => void refreshStatus(), 15_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [desktopApi]);

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

  const indicators = status ? buildStatusIndicatorViewModels(status) : [];

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.kicker}>Fase 3 - Desktop Base Offline-First</p>
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

      {status ? (
        <section style={styles.details}>
          <h2 style={styles.detailsTitle}>Identidade local</h2>
          <p>Empresa: {status.identity?.companyId ?? "nao configurada"}</p>
          <p>Unidade: {status.identity?.unitId ?? "nao configurada"}</p>
          <p>Dispositivo: {status.identity?.deviceId ?? "nao configurado"}</p>
          <p>Banco local: {status.databasePath}</p>
        </section>
      ) : null}
    </main>
  );
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
    gap: "12px"
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
  details: {
    marginTop: "20px",
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff"
  },
  detailsTitle: {
    marginTop: 0
  }
};
