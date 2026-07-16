import { useEffect, useState } from "react";

import type { KyberRockDesktopApi, ReportDispatchConfigView } from "../preload/api-types";

// Card "Envios automaticos" da tela de Relatorios: liga/desliga o agendador
// local, escolhe a hora e quais pacotes saem (diario todo dia, semanal a cada
// 7 dias, mensal na virada do mes). Quando os pacotes coincidem no mesmo dia,
// os anexos (PDF Insights + Excel de vendas + PDF de caminhoes) vao juntos em
// um unico envio para cada destinatario.

const styles = {
  card: {
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    boxShadow: "var(--kr-shadow)",
    overflow: "hidden" as const
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    padding: "12px 14px",
    flexWrap: "wrap" as const
  },
  headerTitle: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--kr-text-strong)"
  },
  body: {
    display: "grid",
    gap: "12px",
    padding: "0 14px 14px 14px"
  },
  row: {
    display: "flex",
    gap: "16px",
    alignItems: "center",
    flexWrap: "wrap" as const
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontWeight: 700,
    fontSize: "13px",
    color: "var(--kr-text-strong)"
  },
  hint: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    margin: 0
  },
  select: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "7px 10px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  primaryButton: {
    border: "none",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    borderRadius: "10px",
    padding: "9px 14px",
    cursor: "pointer",
    fontWeight: 700
  },
  secondaryButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    borderRadius: "10px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700
  },
  badge: (color: string, background: string) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    color,
    background
  }),
  modalOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(15, 23, 42, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    zIndex: 1000
  },
  modalCard: {
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "16px",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
    padding: "22px",
    width: "min(460px, 100%)",
    display: "grid",
    gap: "12px",
    textAlign: "center" as const
  },
  modalIcon: {
    fontSize: "40px",
    lineHeight: 1
  },
  modalTitle: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 800,
    color: "var(--kr-text-strong)"
  },
  modalMessage: {
    margin: 0,
    fontSize: "14px",
    color: "var(--kr-muted)",
    wordBreak: "break-word" as const,
    whiteSpace: "pre-line" as const,
    textAlign: "left" as const
  }
};

function formatDate(iso: string | null): string {
  if (!iso) return "nunca";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

interface ModalContent {
  success: boolean;
  title: string;
  message: string;
}

export function ReportDispatchSettings({
  desktopApi
}: {
  desktopApi: KyberRockDesktopApi | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<ReportDispatchConfigView | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalContent | null>(null);

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi
      .getReportDispatchConfig()
      .then((stored) => {
        if (!cancelled) setConfig(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  async function saveSettings(
    patch: Partial<ReportDispatchConfigView["settings"]>
  ): Promise<void> {
    if (!desktopApi || !config) return;
    setBusy(true);
    try {
      const saved = await desktopApi.saveReportDispatchConfig(patch);
      setConfig(saved);
    } catch (error) {
      setModal({
        success: false,
        title: "Falha ao salvar",
        message: error instanceof Error ? error.message : "Falha ao salvar configuracao."
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSendNow(): Promise<void> {
    if (!desktopApi) return;
    setBusy(true);
    try {
      const result = await desktopApi.sendReportsNow();
      const errors = [...result.emailErrors, ...result.whatsappErrors];
      const sentSomething = result.emailsSent > 0 || result.whatsappSent > 0;
      const lines: string[] = [];
      if (result.recipients === 0) {
        lines.push("Nenhum destinatario ativo cadastrado.");
      } else {
        lines.push(`E-mails enviados: ${result.emailsSent}`);
        lines.push(`Documentos WhatsApp enviados: ${result.whatsappSent}`);
      }
      if (errors.length > 0) {
        lines.push("", "Erros:", ...errors.slice(0, 5));
      }
      setModal({
        success: sentSomething && errors.length === 0,
        title:
          sentSomething && errors.length === 0
            ? "Relatorios enviados!"
            : sentSomething
              ? "Envio parcial"
              : "Nada foi enviado",
        message: lines.join("\n")
      });
    } catch (error) {
      setModal({
        success: false,
        title: "Falha no envio",
        message: error instanceof Error ? error.message : "Falha ao enviar relatorios."
      });
    } finally {
      setBusy(false);
    }
  }

  const settings = config?.settings ?? null;
  const state = config?.state ?? null;

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <h3 style={styles.headerTitle}>Envios automaticos de relatorios</h3>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {settings?.enabled ? (
            <span style={styles.badge("#166534", "#dcfce7")}>Ativo</span>
          ) : (
            <span style={styles.badge("#475569", "#e2e8f0")}>Desativado</span>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            style={styles.secondaryButton}
          >
            {expanded ? "Fechar" : "Configurar"}
          </button>
        </div>
      </div>

      {expanded && settings ? (
        <div style={styles.body}>
          <div style={styles.row}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={busy}
                onChange={(event) => void saveSettings({ enabled: event.target.checked })}
              />
              Enviar relatorios automaticamente
            </label>
            <label style={styles.checkboxLabel}>
              Horario:
              <select
                value={settings.sendHour}
                disabled={busy}
                onChange={(event) => void saveSettings({ sendHour: Number(event.target.value) })}
                style={styles.select}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={styles.row}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.daily}
                disabled={busy}
                onChange={(event) => void saveSettings({ daily: event.target.checked })}
              />
              Diario (todo dia)
            </label>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.weekly}
                disabled={busy}
                onChange={(event) => void saveSettings({ weekly: event.target.checked })}
              />
              Semanal (a cada 7 dias, ultimos 7 dias)
            </label>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.monthly}
                disabled={busy}
                onChange={(event) => void saveSettings({ monthly: event.target.checked })}
              />
              Mensal (na virada do mes, mes anterior)
            </label>
          </div>

          <p style={styles.hint}>
            Cada envio leva os mesmos arquivos das telas: PDF do Painel de Insights + Excel de
            vendas e PDF do Controle de Caminhoes, para os destinatarios ativos conforme o tipo de
            relatorio de cada um. Quando os periodos coincidem (ex.: dia de semanal), os relatorios
            vao juntos no mesmo envio. O computador precisa estar ligado com o KyberRock aberto no
            horario configurado — envios perdidos sao recuperados na proxima abertura do app.
          </p>

          <p style={styles.hint}>
            Ultimo diario: {formatDate(state?.lastDailyDate ?? null)} · Ultimo semanal:{" "}
            {formatDate(state?.lastWeeklyDate ?? null)} · Ultimo mensal:{" "}
            {state?.lastMonthlyMonth ?? "nunca"}
            {state?.lastError ? ` · Ultimo erro: ${state.lastError}` : ""}
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => void handleSendNow()}
              disabled={busy}
              style={styles.primaryButton}
            >
              {busy ? "Enviando..." : "Enviar agora"}
            </button>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div
          style={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          onClick={() => setModal(null)}
        >
          <div style={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalIcon}>{modal.success ? "✅" : "❌"}</div>
            <h4 style={styles.modalTitle}>{modal.title}</h4>
            <p style={styles.modalMessage}>{modal.message}</p>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button type="button" onClick={() => setModal(null)} style={styles.primaryButton}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
