import { useEffect, useState } from "react";
import type { KyberRockDesktopApi } from "./desktop-api";
import type { DesktopAccessStatus } from "../services/desktop-activation";

interface BlockedScreenProps {
  desktopApi: KyberRockDesktopApi;
  onUnlocked: () => void;
}

export function BlockedScreen({ desktopApi, onUnlocked }: BlockedScreenProps) {
  const [status, setStatus] = useState<DesktopAccessStatus | null>(null);
  const [checking, setChecking] = useState(true);

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

  return (
    <main style={styles.page}>
      <div style={styles.content}>
        <h1 style={styles.title}>Acesso Bloqueado</h1>
        <p style={styles.message}>
          {resolveBlockedMessage(status)}
        </p>
        {checking && (
          <p style={styles.checking}>Verificando status...</p>
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
};
