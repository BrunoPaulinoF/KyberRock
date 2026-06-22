import { useEffect, useState } from "react";
import type { DesktopAccessStatus } from "../services/desktop-activation";
import type { KyberRockDesktopApi } from "./desktop-api";
import { HelpTooltip } from "./Tooltip";
import { TIPS } from "./tooltip-messages";

type GateScreen = "checking" | "activate" | "blocked" | "error" | "offline";

interface ActivationGateProps {
  desktopApi: KyberRockDesktopApi;
  onUnlocked: () => void;
}

export function ActivationGate({ desktopApi, onUnlocked }: ActivationGateProps) {
  const [screen, setScreen] = useState<GateScreen>("checking");
  const [status, setStatus] = useState<DesktopAccessStatus | null>(null);
  const [activationCode, setActivationCode] = useState(["", "", "", "", "", ""]);
  const [deviceName, setDeviceName] = useState("");
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState("Verificando acesso...");

  useEffect(() => {
    checkAccess();
  }, []);

  async function checkAccess(): Promise<void> {
    try {
      const access = await desktopApi.getAccessStatus();
      setStatus(access);
      if (access.canOperate) {
        onUnlocked();
        return;
      }

      if (access.requiresActivation) {
        setScreen("activate");
        setMessage(access.message);
        return;
      }

      if (access.status === "validation_expired") {
        const onlineValidation = await desktopApi.validateDesktopAccess(navigator.onLine, true);
        setStatus(onlineValidation);
        if (onlineValidation.canOperate) {
          onUnlocked();
          return;
        }

        setScreen("blocked");
        setMessage(onlineValidation.message);
        return;
      }

      setScreen("blocked");
      setMessage(access.message);
    } catch (error) {
      setScreen("error");
      setMessage(error instanceof Error ? error.message : "Erro ao verificar acesso.");
    }
  }

  function handleCodeChange(index: number, value: string): void {
    if (!/^\d?$/.test(value)) {
      return;
    }

    const next = [...activationCode];
    next[index] = value;
    setActivationCode(next);

    if (value && index < 5) {
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-code-digit]");
      inputs[index + 1]?.focus();
    }
  }

  function handleCodePaste(event: React.ClipboardEvent<HTMLInputElement>): void {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      event.preventDefault();
      setActivationCode(pasted.split(""));
    }
  }

  async function handleActivate(): Promise<void> {
    const code = activationCode.join("");
    if (code.length !== 6) {
      setMessage("Informe o codigo de 6 digitos.");
      return;
    }

    setActivating(true);
    setMessage("Ativando...");
    try {
      const result = await desktopApi.activateDesktop({
        activationCode: code,
        deviceName: deviceName.trim() || "Desktop balanca"
      });

      if (result.canOperate) {
        onUnlocked();
      } else {
        setScreen("blocked");
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na ativacao.");
    } finally {
      setActivating(false);
    }
  }

  async function handleRetryValidation(): Promise<void> {
    setScreen("checking");
    setMessage("Verificando acesso...");
    await checkAccess();
  }

  async function handleExportBackup(): Promise<void> {
    try {
      const result = await desktopApi.exportBackup();
      setMessage(result ? `Backup exportado: ${result.backupPath}` : "Exportacao cancelada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao exportar backup.");
    }
  }

  if (screen === "checking") {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>KyberRock</h1>
          <p style={styles.subtitle}>{message}</p>
        </div>
      </main>
    );
  }

  if (screen === "activate") {
    return (
      <main style={styles.page}>
        <div style={{ ...styles.card, maxWidth: "480px" }}>
          <h1 style={styles.title}>Ativacao</h1>
          <p style={styles.subtitle}>
            Informe o codigo de 6 digitos fornecido pelo administrador da pedreira.
          </p>
          <p style={styles.muted}>
            O primeiro acesso exige conexao com a internet.
          </p>

          <label style={styles.fieldLabel} title={TIPS.activation.code}>
            Codigo de ativacao
            <div style={styles.codeRow}>
              {activationCode.map((digit, index) => (
                <input
                  key={index}
                  data-code-digit
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onPaste={index === 0 ? handleCodePaste : undefined}
                  style={styles.codeInput}
                />
              ))}
            </div>
          </label>

          <label style={styles.fieldLabel} title={TIPS.activation.deviceName}>
            Nome do equipamento (opcional)
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Ex: Balanca principal"
              style={styles.textInput}
            />
          </label>

          {message ? <p style={styles.message}>{message}</p> : null}

          <button
              type="button"
              onClick={handleActivate}
              disabled={activating || activationCode.join("").length !== 6}
              style={{
                ...styles.primaryButton,
                opacity: activating || activationCode.join("").length !== 6 ? 0.5 : 1,
                cursor: activating || activationCode.join("").length !== 6 ? "not-allowed" : "pointer"
              }}
            >
              {activating ? "Ativando..." : "Ativar"}
            </button>
          <HelpTooltip content={TIPS.activation.code} placement="top" />
        </div>
      </main>
    );
  }

  const isCompanyBlocked = status?.status === "company_blocked";

  return (
    <main style={styles.page}>
      <div style={{ ...styles.card, maxWidth: "480px" }}>
        <h1 style={styles.title}>{isCompanyBlocked ? "Não autorizado" : "Acesso Bloqueado"}</h1>
        <p style={styles.subtitle}>{message}</p>
        {status && (
          <div style={styles.statusBox}>
            {status.deviceId && (
              <p style={styles.statusText}>Dispositivo: {status.deviceId.slice(0, 8)}...</p>
            )}
            {status.lastSuccessfulCheckAt && (
              <p style={styles.statusText}>
                Ultima validacao: {new Date(status.lastSuccessfulCheckAt).toLocaleString("pt-BR")}
              </p>
            )}
            {status.graceExpiresAt && (
              <p style={styles.statusText}>
                Acesso offline expira: {new Date(status.graceExpiresAt).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
        )}

        <div style={styles.buttonColumn}>
          <button type="button" onClick={handleRetryValidation} style={styles.primaryButton}>
              Tentar validar novamente
            </button>
          <HelpTooltip content={TIPS.activation.retry} placement="top" />
          <button type="button" onClick={() => setScreen("activate")} style={styles.secondaryButton}>
              Ver diagnostico
            </button>
          <HelpTooltip content={TIPS.activation.diagnostic} placement="top" />
          <button type="button" onClick={handleExportBackup} style={styles.secondaryButton}>
              Exportar backup
            </button>
          <HelpTooltip content={TIPS.activation.export} placement="top" />
        </div>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px",
    fontFamily: "Segoe UI, Arial, sans-serif",
    color: "#0f172a",
    background: "#f8fafc"
  },
  card: {
    width: "100%",
    padding: "40px",
    borderRadius: "20px",
    background: "#ffffff",
    boxShadow: "0 18px 60px rgba(15, 23, 42, 0.1)"
  },
  title: {
    margin: "0 0 8px 0",
    fontSize: "36px",
    lineHeight: 1.1
  },
  subtitle: {
    margin: "0 0 12px 0",
    color: "#334155",
    fontSize: "16px",
    lineHeight: 1.5
  },
  muted: {
    margin: "0 0 16px 0",
    color: "#94a3b8",
    fontSize: "14px"
  },
  message: {
    color: "#b91c1c",
    fontWeight: 700,
    fontSize: "14px"
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    marginBottom: "20px",
    fontWeight: 700,
    fontSize: "14px"
  },
  codeRow: {
    display: "flex",
    gap: "8px",
    justifyContent: "center"
  },
  codeInput: {
    width: "48px",
    height: "56px",
    textAlign: "center" as const,
    fontSize: "24px",
    fontWeight: 700,
    border: "2px solid #cbd5e1",
    borderRadius: "12px",
    outline: "none"
  },
  textInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "10px 12px",
    font: "inherit"
  },
  primaryButton: {
    width: "100%",
    border: "none",
    borderRadius: "12px",
    padding: "14px 16px",
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "16px"
  },
  secondaryButton: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "14px 16px",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "16px"
  },
  buttonColumn: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
    marginTop: "16px"
  },
  statusBox: {
    padding: "12px",
    marginBottom: "16px",
    borderRadius: "10px",
    background: "#f1f5f9"
  },
  statusText: {
    margin: "2px 0",
    fontSize: "13px",
    color: "#475569"
  }
};
