import { useCallback, useEffect, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";

interface RecipientRow {
  id: string;
  email: string | null;
  whatsappPhone: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  scheduleFrequency: string;
  scheduleTime: string;
  displayName: string | null;
  isActive: boolean;
  syncStatus: "synced" | "pending" | "error";
  lastError: string | null;
  lastSyncedAt: string | null;
}

interface RecipientFormState {
  email: string;
  whatsappPhone: string;
  deliveryChannel: "email" | "whatsapp" | "both";
  scheduleFrequency: string;
  scheduleTime: string;
  displayName: string;
  isActive: boolean;
}

const initialForm: RecipientFormState = {
  email: "",
  whatsappPhone: "",
  deliveryChannel: "email",
  scheduleFrequency: "daily",
  scheduleTime: "20:00",
  displayName: "",
  isActive: true
};

const styles = {
  page: {
    padding: 0,
    display: "grid",
    gap: "10px",
    minHeight: 0
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
    gap: "10px"
  },
  title: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "18px"
  },
  subtitle: {
    margin: "4px 0 0 0",
    color: "var(--kr-muted)",
    maxWidth: "720px",
    fontSize: "13px"
  },
  card: {
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    padding: "14px",
    boxShadow: "var(--kr-shadow)",
    overflow: "hidden" as const,
    minHeight: 0
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns:
      "minmax(180px, 1.2fr) minmax(160px, 1fr) minmax(130px, 0.7fr) minmax(120px, 0.6fr) minmax(120px, 0.6fr) minmax(130px, 0.8fr) 90px auto",
    gap: "10px",
    alignItems: "end"
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
    padding: "10px 16px",
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
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px"
  },
  tableScroll: {
    overflow: "auto" as const,
    maxHeight: "calc(100vh - 390px)",
    border: "1px solid var(--kr-border)",
    borderRadius: "12px"
  },
  badge: (color: string, background: string) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
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
    fontSize: "13px"
  },
  success: {
    color: "#166534",
    background: "#dcfce7",
    border: "1px solid #bbf7d0",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px"
  },
  helperText: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    margin: 0
  }
};

function badgeForStatus(status: RecipientRow["syncStatus"]) {
  if (status === "synced") {
    return styles.badge("#166534", "#dcfce7");
  }
  if (status === "pending") {
    return styles.badge("#b45309", "#fef3c7");
  }
  return styles.badge("#b91c1c", "#fee2e2");
}

function scheduleLabel(frequency: string | null, time: string | null): string {
  const freqMap: Record<string, string> = {
    daily: "Diario",
    weekly: "Semanal",
    monthly: "Mensal"
  };
  const freq = freqMap[frequency ?? "daily"] ?? "Diario";
  return `${freq} as ${time ?? "20:00"}h`;
}

export function ReportsView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<RecipientFormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadRecipients = useCallback(async () => {
    if (!desktopApi) return;
    setLoading(true);
    try {
      const rows = await desktopApi.listReportRecipients();
      setRecipients(rows as RecipientRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar destinatarios.");
    } finally {
      setLoading(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    void loadRecipients();
  }, [loadRecipients]);

  function resetForm(): void {
    setForm(initialForm);
    setEditingId(null);
    setError(null);
    setSuccess(null);
  }

  function validateEmail(value: string): string | null {
    if (!value.trim()) return "E-mail obrigatorio.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return "E-mail invalido.";
    return null;
  }

  function validateWhatsapp(value: string): string | null {
    const digits = value.replace(/\D/g, "");
    const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    if (!value.trim()) return "WhatsApp obrigatorio.";
    if (!/^\d{12,13}$/.test(normalized)) return "WhatsApp invalido. Informe DDD e numero.";
    return null;
  }

  async function handleSave(): Promise<void> {
    if (!desktopApi) return;
    const sendEmail = form.deliveryChannel === "email" || form.deliveryChannel === "both";
    const sendWhatsapp = form.deliveryChannel === "whatsapp" || form.deliveryChannel === "both";
    const validationError = sendEmail
      ? validateEmail(form.email)
      : sendWhatsapp
        ? validateWhatsapp(form.whatsappPhone)
        : null;
    const whatsappError = sendWhatsapp ? validateWhatsapp(form.whatsappPhone) : null;
    if (validationError || whatsappError) {
      setError(validationError ?? whatsappError);
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        email: form.email.trim().toLowerCase() || null,
        whatsappPhone: form.whatsappPhone.trim() || null,
        sendEmail,
        sendWhatsapp,
        scheduleFrequency: form.scheduleFrequency,
        scheduleTime: form.scheduleTime,
        displayName: form.displayName.trim() || null,
        isActive: form.isActive
      };
      if (editingId) {
        await desktopApi.updateReportRecipient(editingId, payload);
        setSuccess("Destinatario atualizado.");
      } else {
        await desktopApi.createReportRecipient(payload);
        setSuccess("Destinatario adicionado.");
      }
      resetForm();
      await loadRecipients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar destinatario.");
    }
  }

  function handleEdit(recipient: RecipientRow): void {
    setEditingId(recipient.id);
    setForm({
      email: recipient.email ?? "",
      whatsappPhone: recipient.whatsappPhone ?? "",
      deliveryChannel:
        recipient.sendEmail && recipient.sendWhatsapp
          ? "both"
          : recipient.sendWhatsapp
            ? "whatsapp"
            : "email",
      scheduleFrequency: recipient.scheduleFrequency ?? "daily",
      scheduleTime: recipient.scheduleTime ?? "20:00",
      displayName: recipient.displayName ?? "",
      isActive: recipient.isActive
    });
    setError(null);
    setSuccess(null);
  }

  async function handleDelete(id: string): Promise<void> {
    if (!desktopApi) return;
    try {
      await desktopApi.deleteReportRecipient(id);
      setSuccess("Destinatario removido.");
      if (editingId === id) resetForm();
      await loadRecipients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remover destinatario.");
    }
  }

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}>Relatorios e fechamento diario</h2>
          <p style={styles.subtitle}>
            Cadastre os destinatarios que receberao o fechamento diario por e-mail, WhatsApp ou
            ambos as 20h, conforme o PRD 24.6. Defina a frequencia (diario, semanal, mensal) e o
            horario de envio para cada destinatario. Tambem e possivel exportar o periodo atual em
            PDF (A4) e Excel pelo menu Insights.
          </p>
        </div>
      </header>

      <div style={styles.card}>
        <h3 style={{ margin: 0, marginBottom: "12px", fontSize: "15px" }}>
          {editingId ? "Editar destinatario" : "Adicionar destinatario"}
        </h3>
        <div style={styles.formGrid}>
          <label style={styles.fieldLabel}>
            E-mail
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="dono@pedreira.com"
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            WhatsApp
            <input
              type="tel"
              value={form.whatsappPhone}
              onChange={(event) => setForm({ ...form, whatsappPhone: event.target.value })}
              placeholder="(11) 99999-9999"
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Enviar por
            <select
              value={form.deliveryChannel}
              onChange={(event) =>
                setForm({
                  ...form,
                  deliveryChannel: event.target.value as RecipientFormState["deliveryChannel"]
                })
              }
              style={styles.input}
            >
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="both">Ambos</option>
            </select>
          </label>
          <label style={styles.fieldLabel}>
            Frequencia
            <select
              value={form.scheduleFrequency}
              onChange={(event) => setForm({ ...form, scheduleFrequency: event.target.value })}
              style={styles.input}
            >
              <option value="daily">Diario</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensal</option>
            </select>
          </label>
          <label style={styles.fieldLabel}>
            Horario
            <input
              type="time"
              value={form.scheduleTime}
              onChange={(event) => setForm({ ...form, scheduleTime: event.target.value })}
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Nome (opcional)
            <input
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder="Dono ou responsavel"
              style={styles.input}
            />
          </label>
          <label style={{ ...styles.fieldLabel, marginBottom: 0 }}>
            Ativo
            <select
              value={form.isActive ? "yes" : "no"}
              onChange={(event) => setForm({ ...form, isActive: event.target.value === "yes" })}
              style={styles.input}
            >
              <option value="yes">Sim</option>
              <option value="no">Nao</option>
            </select>
          </label>
          <div style={{ display: "flex", gap: "6px" }}>
            <button type="button" onClick={handleSave} style={styles.primaryButton}>
              {editingId ? "Salvar" : "Adicionar"}
            </button>
            {editingId ? (
              <>
                <button type="button" onClick={resetForm} style={styles.secondaryButton}>
                  Cancelar
                </button>
              </>
            ) : null}
          </div>
        </div>
        {error ? <p style={{ ...styles.error, marginTop: "12px" }}>{error}</p> : null}
        {success ? <p style={{ ...styles.success, marginTop: "12px" }}>{success}</p> : null}
        <p style={{ ...styles.helperText, marginTop: "12px" }}>
          O envio automatico ocorre no horario agendado via Edge Function. Frequencia diaria envia
          todos os dias; semanal toda segunda-feira; mensal no dia 1. Para e-mail, configure
          SMTP_HOST, SMTP_USER, SMTP_PASSWORD e DAILY_REPORT_SENDER. Para WhatsApp, configure
          UAZAPI_INSTANCE_TOKEN e UAZAPI_WHATSAPP_URL.
        </p>
      </div>

      <div style={styles.card}>
        <h3 style={{ margin: 0, marginBottom: "12px", fontSize: "15px" }}>
          Destinatarios cadastrados
        </h3>
        {loading ? (
          <p style={styles.helperText}>Carregando...</p>
        ) : recipients.length === 0 ? (
          <p style={styles.helperText}>
            Nenhum destinatario cadastrado. Adicione pelo menos um canal acima.
          </p>
        ) : (
          <div style={styles.tableScroll}>
            <table style={styles.table}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--kr-muted)",
                    background: "var(--kr-surface-soft)",
                    position: "sticky",
                    top: 0,
                    zIndex: 1
                  }}
                >
                  <th style={{ padding: "8px" }}>Nome</th>
                  <th style={{ padding: "8px" }}>Canal</th>
                  <th style={{ padding: "8px" }}>E-mail</th>
                  <th style={{ padding: "8px" }}>WhatsApp</th>
                  <th style={{ padding: "8px" }}>Agendamento</th>
                  <th style={{ padding: "8px" }}>Status</th>
                  <th style={{ padding: "8px" }}>Ultima sincronizacao</th>
                  <th style={{ padding: "8px" }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((recipient) => (
                  <tr key={recipient.id} style={{ borderTop: "1px solid var(--kr-border)" }}>
                    <td style={{ padding: "8px" }}>{recipient.displayName ?? "-"}</td>
                    <td style={{ padding: "8px" }}>
                      {recipient.sendEmail && recipient.sendWhatsapp
                        ? "Ambos"
                        : recipient.sendWhatsapp
                          ? "WhatsApp"
                          : "E-mail"}
                    </td>
                    <td style={{ padding: "8px" }}>{recipient.email ?? "-"}</td>
                    <td style={{ padding: "8px" }}>{recipient.whatsappPhone ?? "-"}</td>
                    <td style={{ padding: "8px" }}>
                      {scheduleLabel(recipient.scheduleFrequency, recipient.scheduleTime)}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <span style={badgeForStatus(recipient.syncStatus)}>
                        {recipient.syncStatus === "synced"
                          ? recipient.isActive
                            ? "Sincronizado"
                            : "Inativo"
                          : recipient.syncStatus === "pending"
                            ? "Pendente"
                            : "Erro"}
                      </span>
                      {recipient.lastError ? (
                        <span style={{ ...styles.helperText, marginLeft: "8px", color: "#b91c1c" }}>
                          {recipient.lastError}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {recipient.lastSyncedAt
                        ? new Date(recipient.lastSyncedAt).toLocaleString("pt-BR")
                        : "-"}
                    </td>
                    <td style={{ padding: "8px", display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        onClick={() => handleEdit(recipient)}
                        style={styles.secondaryButton}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(recipient.id)}
                        style={styles.dangerButton}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
