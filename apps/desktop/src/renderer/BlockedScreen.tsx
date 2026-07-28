import { useEffect, useState } from "react";
import type { KyberRockDesktopApi } from "./desktop-api";
import type { DesktopAccessStatus } from "../services/desktop-activation";

interface BlockedScreenProps {
  desktopApi: KyberRockDesktopApi;
  onUnlocked: () => void;
  /** Volta para a tela de ativacao depois que a credencial local foi limpa. */
  onRequireActivation: () => void;
}

export function BlockedScreen({
  desktopApi,
  onUnlocked,
  onRequireActivation
}: BlockedScreenProps) {
  const [status, setStatus] = useState<DesktopAccessStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function check(): Promise<void> {
      if (!active) return;
      try {
        const access = await desktopApi.validateDesktopAccess(navigator.onLine, true);
        setStatus(access);
        if (access.canOperate) {
          onUnlocked();
          return;
        }
      } catch (error) {
        console.error("Erro ao verificar desbloqueio:", error);
      } finally {
        if (active) setChecking(false);
      }
    }

    void check();
    const intervalId = window.setInterval(() => void check(), 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [desktopApi, onUnlocked]);

  /**
   * Apaga a credencial de nuvem guardada nesta maquina e volta para a tela do
   * codigo. E a saida para um computador preso aqui com credencial que a nuvem
   * nao reconhece mais (ex.: registro renovado em outra ativacao): reinstalar
   * nao resolve, porque o banco local fica fora da pasta do programa.
   * Operacoes, cadastro e backups continuam intactos.
   */
  async function handleClearActivation(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      await desktopApi.logoutDesktop();
      onRequireActivation();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao limpar a ativacao desta maquina."
      );
      setBusy(false);
    }
  }

  async function handleExportBackup(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await desktopApi.exportBackup();
      setFeedback(result ? `Backup exportado: ${result.backupPath}` : "Exportacao cancelada.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao exportar backup.");
    } finally {
      setBusy(false);
    }
  }

  // Bloqueio administrativo (empresa/pagamento/dispositivo desativado) so sai
  // pelo admin: reativar aqui nao adiantaria. Ja o "invalid_device" e problema
  // da credencial desta maquina, que a propria tela consegue resolver.
  const canReactivate = status?.status === "invalid_device" || status?.status === "validation_error";

  return (
    <main style={styles.page}>
      <div style={styles.content}>
        <h1 style={styles.title}>{canReactivate ? "Reative este computador" : "Acesso Bloqueado"}</h1>
        <p style={styles.message}>
          {resolveBlockedMessage(status)}
        </p>
        {checking && (
          <p style={styles.checking}>Verificando status...</p>
        )}
        {feedback && <p style={styles.checking}>{feedback}</p>}
        <div style={styles.actions}>
          <button
            type="button"
            onClick={handleClearActivation}
            disabled={busy}
            style={{ ...styles.primaryButton, opacity: busy ? 0.6 : 1 }}
          >
            Limpar ativacao e ativar de novo
          </button>
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={busy}
            style={{ ...styles.secondaryButton, opacity: busy ? 0.6 : 1 }}
          >
            Exportar backup
          </button>
        </div>
        {status?.deviceId && (
          <p style={styles.checking}>
            Dispositivo: {status.deviceId} - situacao: {status.status}
          </p>
        )}
      </div>
    </main>
  );
}

const BLOCKED_STATUS_MESSAGES: Partial<Record<DesktopAccessStatus["status"], string>> = {
  payment_blocked:
    "Acesso bloqueado por falta de pagamento. Regularize a pendência para reativar o acesso.",
};

function resolveBlockedMessage(status: DesktopAccessStatus | null): string {
  if (status && BLOCKED_STATUS_MESSAGES[status.status]) {
    return BLOCKED_STATUS_MESSAGES[status.status] as string;
  }
  return status?.message ?? "Sistema temporariamente bloqueado pelo administrador.";
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px",
    fontFamily: "Segoe UI, Arial, sans-serif",
    background: "#ffffff",
  },
  content: {
    textAlign: "center" as const,
    maxWidth: "480px",
  },
  title: {
    margin: "0 0 16px 0",
    fontSize: "48px",
    fontWeight: 700,
    color: "#dc2626",
    lineHeight: 1.2,
  },
  message: {
    margin: "0 0 24px 0",
    fontSize: "18px",
    color: "#991b1b",
    lineHeight: 1.5,
  },
  checking: {
    margin: "16px 0 0 0",
    fontSize: "14px",
    color: "#64748b",
  },
  actions: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
    marginTop: "24px",
  },
  primaryButton: {
    padding: "14px 20px",
    borderRadius: "12px",
    border: "none",
    background: "#dc2626",
    color: "#ffffff",
    fontSize: "16px",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "12px 20px",
    borderRadius: "12px",
    border: "1px solid #cbd5f5",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: "15px",
    fontWeight: 500,
    cursor: "pointer",
  },
};
