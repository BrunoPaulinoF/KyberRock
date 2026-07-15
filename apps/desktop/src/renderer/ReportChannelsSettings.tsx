import { useCallback, useEffect, useRef, useState } from "react";

import type {
  KyberRockDesktopApi,
  ReportChannelSettingsView,
  WhatsappInstanceStateView
} from "../preload/api-types";

// Card de configuracao dos canais de envio (E-mail SMTP e WhatsApp/UAZAPI),
// exibido na tela de Relatorios acima dos destinatarios. A conexao do WhatsApp
// cria a instancia UAZAPI direto pelo app e mostra o QR code para parear.

interface FormState {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpSender: string;
  uazapiBaseUrl: string;
  uazapiAdminToken: string;
}

const emptyForm: FormState = {
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPassword: "",
  smtpSender: "",
  uazapiBaseUrl: "",
  uazapiAdminToken: ""
};

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
  headerBadges: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap" as const
  },
  body: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "14px",
    padding: "0 14px 14px 14px"
  },
  section: {
    display: "grid",
    gap: "10px",
    alignContent: "start",
    padding: "14px",
    border: "1px solid var(--kr-border)",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    minWidth: 0
  },
  sectionTitle: {
    margin: "0 0 4px 0",
    fontSize: "11px",
    fontWeight: 900,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--kr-muted)"
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    fontWeight: 700,
    fontSize: "13px",
    color: "var(--kr-text-strong)"
  },
  input: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "8px 10px",
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
  dangerButton: {
    border: "1px solid #fecaca",
    background: "var(--kr-surface)",
    color: "#b91c1c",
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
  error: {
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
    margin: 0
  },
  success: {
    color: "#166534",
    background: "#dcfce7",
    border: "1px solid #bbf7d0",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
    margin: 0
  },
  warning: {
    color: "#b45309",
    background: "#fef3c7",
    border: "1px solid #fde68a",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
    margin: 0
  },
  helperText: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    margin: 0
  },
  qrBox: {
    display: "grid",
    justifyItems: "center",
    gap: "8px",
    padding: "12px",
    border: "1px dashed var(--kr-border)",
    borderRadius: "12px",
    background: "var(--kr-surface)"
  },
  qrImage: {
    width: "220px",
    height: "220px",
    imageRendering: "pixelated" as const,
    background: "#fff",
    borderRadius: "8px"
  },
  buttonRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const
  }
};

type WhatsappUiStatus = "unconfigured" | "disconnected" | "connecting" | "connected";

function whatsappBadge(status: WhatsappUiStatus) {
  if (status === "connected") {
    return <span style={styles.badge("#166534", "#dcfce7")}>WhatsApp conectado</span>;
  }
  if (status === "connecting") {
    return <span style={styles.badge("#b45309", "#fef3c7")}>WhatsApp conectando...</span>;
  }
  if (status === "disconnected") {
    return <span style={styles.badge("#b91c1c", "#fee2e2")}>WhatsApp desconectado</span>;
  }
  return <span style={styles.badge("#475569", "#e2e8f0")}>WhatsApp nao configurado</span>;
}

function toUiStatus(
  settings: Pick<ReportChannelSettingsView, "uazapiBaseUrl" | "uazapiInstanceToken"> | null,
  state: WhatsappInstanceStateView | null
): WhatsappUiStatus {
  if (!settings?.uazapiBaseUrl || !settings?.uazapiInstanceToken) return "unconfigured";
  if (state?.status === "connected") return "connected";
  if (state?.status === "connecting") return "connecting";
  return "disconnected";
}

export function ReportChannelsSettings({
  desktopApi
}: {
  desktopApi: KyberRockDesktopApi | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [settings, setSettings] = useState<ReportChannelSettingsView | null>(null);
  const [whatsappState, setWhatsappState] = useState<WhatsappInstanceStateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applySettings = useCallback((next: ReportChannelSettingsView) => {
    setSettings(next);
    setForm({
      smtpHost: next.smtpHost ?? "",
      smtpPort: String(next.smtpPort || 587),
      smtpUser: next.smtpUser ?? "",
      smtpPassword: next.smtpPassword ?? "",
      smtpSender: next.smtpSender ?? "",
      uazapiBaseUrl: next.uazapiBaseUrl ?? "",
      uazapiAdminToken: next.uazapiAdminToken ?? ""
    });
    setWarning(
      next.cloudPushError
        ? `Configuracao salva no computador, mas ainda nao sincronizada com a nuvem: ${next.cloudPushError}`
        : null
    );
  }, []);

  const refreshWhatsappStatus = useCallback(async () => {
    if (!desktopApi) return null;
    try {
      const state = await desktopApi.whatsappStatus();
      setWhatsappState(state);
      return state;
    } catch {
      return null;
    }
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await desktopApi.getReportChannelSettings();
        if (cancelled) return;
        applySettings(stored);
        if (stored.uazapiBaseUrl && stored.uazapiInstanceToken) {
          await refreshWhatsappStatus();
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Falha ao carregar configuracao."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktopApi, applySettings, refreshWhatsappStatus]);

  // Enquanto o QR estiver na tela (status connecting), atualiza o QR e o status
  // a cada 3s ate conectar, expirar ou o usuario sair da tela.
  useEffect(() => {
    if (whatsappState?.status !== "connecting") {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => {
      void refreshWhatsappStatus().then((state) => {
        if (state?.status === "connected") {
          setSuccess("WhatsApp conectado com sucesso!");
        }
      });
    }, 3000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [whatsappState?.status, refreshWhatsappStatus]);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  async function handleSave(): Promise<ReportChannelSettingsView | null> {
    if (!desktopApi) return null;
    clearMessages();
    setBusy(true);
    try {
      const saved = await desktopApi.saveReportChannelSettings({
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort) || 587,
        smtpUser: form.smtpUser.trim(),
        smtpPassword: form.smtpPassword,
        smtpSender: form.smtpSender.trim(),
        uazapiBaseUrl: form.uazapiBaseUrl.trim(),
        uazapiAdminToken: form.uazapiAdminToken.trim()
      });
      applySettings(saved);
      setSuccess("Configuracao salva.");
      return saved;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar configuracao.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleTestSmtp() {
    if (!desktopApi) return;
    clearMessages();
    setBusy(true);
    try {
      const saved = await handleSaveSilently();
      if (!saved) return;
      const result = await desktopApi.verifySmtpConfig();
      if (result.success) {
        setSuccess("Conexao SMTP verificada com sucesso.");
      } else {
        setError(result.error ?? "Falha na conexao SMTP.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSilently(): Promise<ReportChannelSettingsView | null> {
    if (!desktopApi) return null;
    try {
      const saved = await desktopApi.saveReportChannelSettings({
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort) || 587,
        smtpUser: form.smtpUser.trim(),
        smtpPassword: form.smtpPassword,
        smtpSender: form.smtpSender.trim(),
        uazapiBaseUrl: form.uazapiBaseUrl.trim(),
        uazapiAdminToken: form.uazapiAdminToken.trim()
      });
      applySettings(saved);
      return saved;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar configuracao.");
      return null;
    }
  }

  async function handleWhatsappConnect() {
    if (!desktopApi) return;
    clearMessages();
    setBusy(true);
    try {
      // Salva URL/chave antes: a conexao usa o que esta persistido.
      const saved = await handleSaveSilently();
      if (!saved) return;
      const state = await desktopApi.whatsappConnect();
      setWhatsappState(state);
      const stored = await desktopApi.getReportChannelSettings();
      applySettings(stored);
      if (state.status === "connected") {
        setSuccess("WhatsApp ja esta conectado.");
      } else if (state.qrcode || state.paircode) {
        setSuccess("Escaneie o QR code no WhatsApp do celular (Aparelhos conectados).");
      }
    } catch (connectError) {
      setError(
        connectError instanceof Error ? connectError.message : "Falha ao conectar ao WhatsApp."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleWhatsappDisconnect() {
    if (!desktopApi) return;
    if (!window.confirm("Desconectar o WhatsApp? Os relatorios deixarao de ser enviados.")) return;
    clearMessages();
    setBusy(true);
    try {
      const state = await desktopApi.whatsappDisconnect();
      setWhatsappState(state);
      setSuccess("WhatsApp desconectado.");
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error ? disconnectError.message : "Falha ao desconectar."
      );
    } finally {
      setBusy(false);
    }
  }

  const uiStatus = toUiStatus(
    settings ? { ...settings, uazapiBaseUrl: form.uazapiBaseUrl || settings.uazapiBaseUrl } : null,
    whatsappState ??
      (settings?.uazapiStatus
        ? ({ status: settings.uazapiStatus } as WhatsappInstanceStateView)
        : null)
  );
  const smtpConfigured = Boolean(settings?.smtpHost && settings?.smtpUser);
  const showQr = whatsappState?.status === "connecting" && whatsappState.qrcode;

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <h3 style={styles.headerTitle}>Configuracao de envio (E-mail e WhatsApp)</h3>
        <div style={styles.headerBadges}>
          {smtpConfigured ? (
            <span style={styles.badge("#166534", "#dcfce7")}>E-mail configurado</span>
          ) : (
            <span style={styles.badge("#475569", "#e2e8f0")}>E-mail nao configurado</span>
          )}
          {whatsappBadge(uiStatus)}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            style={styles.secondaryButton}
          >
            {expanded ? "Fechar" : "Configurar"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div style={styles.body}>
          {error ? <p style={styles.error}>{error}</p> : null}
          {success ? <p style={styles.success}>{success}</p> : null}
          {warning ? <p style={styles.warning}>{warning}</p> : null}

          <section style={styles.section}>
            <h4 style={styles.sectionTitle}>E-mail (SMTP)</h4>
            <label style={styles.fieldLabel}>
              Servidor SMTP
              <input
                value={form.smtpHost}
                onChange={(event) => setForm({ ...form, smtpHost: event.target.value })}
                placeholder="smtp.gmail.com"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Porta
              <input
                type="number"
                value={form.smtpPort}
                onChange={(event) => setForm({ ...form, smtpPort: event.target.value })}
                placeholder="587"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Usuario (e-mail)
              <input
                value={form.smtpUser}
                onChange={(event) => setForm({ ...form, smtpUser: event.target.value })}
                placeholder="relatorios@suaempresa.com.br"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Senha
              <input
                type="password"
                value={form.smtpPassword}
                onChange={(event) => setForm({ ...form, smtpPassword: event.target.value })}
                placeholder="Senha ou senha de app"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Remetente (opcional)
              <input
                value={form.smtpSender}
                onChange={(event) => setForm({ ...form, smtpSender: event.target.value })}
                placeholder="Igual ao usuario se vazio"
                style={styles.input}
              />
            </label>
            <div style={styles.buttonRow}>
              <button
                type="button"
                onClick={() => void handleTestSmtp()}
                disabled={busy}
                style={styles.secondaryButton}
              >
                Testar conexao SMTP
              </button>
            </div>
            <p style={styles.helperText}>
              No Gmail, use uma senha de app (Conta Google &gt; Seguranca &gt; Senhas de app).
            </p>
          </section>

          <section style={styles.section}>
            <h4 style={styles.sectionTitle}>WhatsApp (UAZAPI)</h4>
            <label style={styles.fieldLabel}>
              Servidor UAZAPI (URL)
              <input
                value={form.uazapiBaseUrl}
                onChange={(event) => setForm({ ...form, uazapiBaseUrl: event.target.value })}
                placeholder="https://sua-instancia.uazapi.com"
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Chave de API (admin token)
              <input
                type="password"
                value={form.uazapiAdminToken}
                onChange={(event) => setForm({ ...form, uazapiAdminToken: event.target.value })}
                placeholder="Token de administrador do UAZAPI"
                style={styles.input}
              />
            </label>
            {settings?.uazapiInstanceName ? (
              <p style={styles.helperText}>
                Instancia: {settings.uazapiInstanceName}
                {whatsappState?.profileName || settings.uazapiProfileName
                  ? ` — perfil ${whatsappState?.profileName ?? settings.uazapiProfileName}`
                  : ""}
                {whatsappState?.owner ? ` (${whatsappState.owner})` : ""}
              </p>
            ) : (
              <p style={styles.helperText}>
                A instancia sera criada automaticamente ao conectar — nao e preciso criar nada no
                painel do UAZAPI (webhook nao e necessario).
              </p>
            )}

            {showQr ? (
              <div style={styles.qrBox}>
                <img src={whatsappState?.qrcode ?? undefined} alt="QR code" style={styles.qrImage} />
                <p style={styles.helperText}>
                  WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho. O QR se renova
                  automaticamente; se expirar, clique em conectar de novo.
                </p>
                {whatsappState?.paircode ? (
                  <p style={styles.helperText}>Codigo de pareamento: {whatsappState.paircode}</p>
                ) : null}
              </div>
            ) : null}

            {uiStatus === "connected" ? (
              <p style={styles.success}>
                Conectado
                {whatsappState?.profileName || settings?.uazapiProfileName
                  ? ` como ${whatsappState?.profileName ?? settings?.uazapiProfileName}`
                  : ""}
                . Os relatorios serao enviados por este numero.
              </p>
            ) : null}
            {uiStatus === "disconnected" && whatsappState?.lastDisconnectReason ? (
              <p style={styles.warning}>
                Desconectado: {whatsappState.lastDisconnectReason}. Gere um novo QR code para
                reconectar.
              </p>
            ) : null}

            <div style={styles.buttonRow}>
              <button
                type="button"
                onClick={() => void handleWhatsappConnect()}
                disabled={busy}
                style={styles.primaryButton}
              >
                {uiStatus === "connecting"
                  ? "Gerar novo QR code"
                  : "Conectar WhatsApp (gerar QR code)"}
              </button>
              {uiStatus === "connected" || uiStatus === "connecting" ? (
                <button
                  type="button"
                  onClick={() => void handleWhatsappDisconnect()}
                  disabled={busy}
                  style={styles.dangerButton}
                >
                  Desconectar
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void refreshWhatsappStatus()}
                disabled={busy || uiStatus === "unconfigured"}
                style={styles.secondaryButton}
              >
                Atualizar status
              </button>
            </div>
          </section>

          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy}
              style={styles.primaryButton}
            >
              Salvar configuracao
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
