import { Fragment, useCallback, useEffect, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import { CrudFormModal } from "./CrudFormModal";
import { ReportChannelsSettings } from "./ReportChannelsSettings";
import { ReportDispatchSettings } from "./ReportDispatchSettings";
import { formatDbDateTime } from "./format-datetime";

type ReportType = "sales" | "trucks" | "both";

interface RecipientRow {
  id: string;
  email: string | null;
  whatsappPhone: string | null;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  scheduleFrequency: string;
  scheduleTime: string;
  reportTypes: ReportType;
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
  reportTypes: ReportType;
  displayName: string;
  isActive: boolean;
}

const initialForm: RecipientFormState = {
  email: "",
  whatsappPhone: "",
  deliveryChannel: "email",
  scheduleFrequency: "daily",
  scheduleTime: "20:00",
  reportTypes: "sales",
  displayName: "",
  isActive: true
};

const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  sales: "Vendas",
  trucks: "Caminhoes",
  both: "Vendas + Caminhoes"
};

// O agendador da nuvem roda de hora em hora: o horario e sempre a hora cheia.
const HOUR_OPTIONS = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`
);

function normalizeHourOption(value: string | null | undefined): string {
  const hour = parseInt((value ?? "").split(":")[0] ?? "", 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "20:00";
  return `${String(hour).padStart(2, "0")}:00`;
}

const styles = {
  page: {
    // flexShrink 0 + sem minHeight 0: dentro do contentBody (flex + overflowY),
    // encolher aqui comprimia a pagina e o card de configuracao (overflow hidden)
    // cortava o QR code sem dar scroll; com a altura natural, o excesso vira scroll.
    padding: 0,
    display: "grid",
    gap: "10px",
    flexShrink: 0
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
  formHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 56px 14px 18px",
    borderBottom: "1px solid var(--kr-border)",
    background: "var(--kr-surface-soft)",
    flexWrap: "wrap" as const,
    gap: "8px"
  },
  formTitle: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "14px",
    padding: "18px"
  },
  formSection: {
    display: "grid",
    gap: "10px",
    alignContent: "start",
    padding: "14px",
    border: "1px solid var(--kr-border)",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    minWidth: 0
  },
  formSectionTitle: {
    margin: "0 0 4px 0",
    fontSize: "11px",
    fontWeight: 900,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--kr-muted)"
  },
  formFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "14px 18px",
    borderTop: "1px solid var(--kr-border)",
    flexWrap: "wrap" as const,
    background: "var(--kr-surface-soft)"
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
  tableHeadCell: {
    padding: "8px 12px",
    borderRight: "1px solid var(--kr-border)",
    minHeight: "32px",
    whiteSpace: "nowrap" as const
  },
  tableCell: {
    padding: "8px 12px",
    borderRight: "1px solid var(--kr-border)",
    minHeight: "44px",
    verticalAlign: "middle" as const
  },
  tableScroll: {
    overflow: "auto" as const,
    maxHeight: "calc(100vh - 390px)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)"
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
  const [showForm, setShowForm] = useState(false);
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
    setShowForm(false);
  }

  function openCreateForm(): void {
    setForm(initialForm);
    setEditingId(null);
    setError(null);
    setSuccess(null);
    setShowForm(true);
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
    const emailError = sendEmail ? validateEmail(form.email) : null;
    const whatsappError = sendWhatsapp ? validateWhatsapp(form.whatsappPhone) : null;
    if (emailError || whatsappError) {
      setError(emailError ?? whatsappError);
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
        reportTypes: form.reportTypes,
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
      // Valores antigos com minutos ("14:15") viram a hora cheia correspondente,
      // que e o que o agendador da nuvem realmente executa.
      scheduleTime: normalizeHourOption(recipient.scheduleTime),
      reportTypes: recipient.reportTypes ?? "sales",
      displayName: recipient.displayName ?? "",
      isActive: recipient.isActive
    });
    setError(null);
    setSuccess(null);
    setShowForm(true);
  }

  async function handleDelete(id: string): Promise<void> {
    if (!desktopApi) return;
    if (!window.confirm("Confirmar exclusao do destinatario?")) return;
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
            Cadastre quem deve receber o fechamento diario por e-mail ou WhatsApp.
          </p>
        </div>
        <button type="button" onClick={openCreateForm} style={styles.primaryButton}>
          + Novo destinatario
        </button>
      </header>

      <ReportChannelsSettings desktopApi={desktopApi} />

      <ReportDispatchSettings desktopApi={desktopApi} />

      {showForm ? (
        <CrudFormModal onClose={resetForm} maxWidth={920}>
          <Fragment>
            <div style={styles.formHeader}>
              <h3 style={styles.formTitle}>
                {editingId ? "Editar destinatario" : "Adicionar destinatario"}
              </h3>
              {error ? <p style={{ ...styles.error, margin: 0 }}>{error}</p> : null}
              {success ? <p style={{ ...styles.success, margin: 0 }}>{success}</p> : null}
            </div>
            <div style={styles.formGrid}>
              <section style={styles.formSection}>
                <h4 style={styles.formSectionTitle}>Identificacao</h4>
                <label style={styles.fieldLabel}>
                  Nome (opcional)
                  <input
                    value={form.displayName}
                    onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                    placeholder="Dono ou responsavel"
                    style={styles.input}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Ativo
                  <select
                    value={form.isActive ? "yes" : "no"}
                    onChange={(event) =>
                      setForm({ ...form, isActive: event.target.value === "yes" })
                    }
                    style={styles.input}
                  >
                    <option value="yes">Sim</option>
                    <option value="no">Nao</option>
                  </select>
                </label>
              </section>
              <section style={styles.formSection}>
                <h4 style={styles.formSectionTitle}>Canais</h4>
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
              </section>
              <section style={styles.formSection}>
                <h4 style={styles.formSectionTitle}>Agendamento</h4>
                <label style={styles.fieldLabel}>
                  Frequencia
                  <select
                    value={form.scheduleFrequency}
                    onChange={(event) =>
                      setForm({ ...form, scheduleFrequency: event.target.value })
                    }
                    style={styles.input}
                  >
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensal</option>
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  Horario
                  <select
                    value={form.scheduleTime}
                    onChange={(event) => setForm({ ...form, scheduleTime: event.target.value })}
                    style={styles.input}
                  >
                    {HOUR_OPTIONS.map((hour) => (
                      <option key={hour} value={hour}>
                        {hour}
                      </option>
                    ))}
                  </select>
                  <small style={styles.helperText}>
                    O envio acontece na hora cheia (horario de Brasilia). Se a hora escolhida ja
                    passou hoje, o primeiro envio sera no proximo dia.
                  </small>
                </label>
                <label style={styles.fieldLabel}>
                  Relatorios enviados
                  <select
                    value={form.reportTypes}
                    onChange={(event) =>
                      setForm({ ...form, reportTypes: event.target.value as ReportType })
                    }
                    style={styles.input}
                  >
                    <option value="sales">Vendas</option>
                    <option value="trucks">Caminhoes</option>
                    <option value="both">Vendas + Caminhoes</option>
                  </select>
                </label>
              </section>
            </div>
            <div style={styles.formFooter}>
              <div style={{ display: "flex", gap: "6px" }}>
                <button type="button" onClick={resetForm} style={styles.secondaryButton}>
                  Cancelar
                </button>
                <button type="button" onClick={handleSave} style={styles.primaryButton}>
                  {editingId ? "Salvar" : "Adicionar"}
                </button>
              </div>
            </div>
          </Fragment>
        </CrudFormModal>
      ) : null}

      {!showForm && success ? <p style={styles.success}>{success}</p> : null}
      {!showForm && error ? <p style={styles.error}>{error}</p> : null}

      <div style={styles.card}>
        <h3 style={{ margin: 0, marginBottom: "12px", fontSize: "15px" }}>
          Destinatarios cadastrados
        </h3>
        {loading ? (
          <p style={styles.helperText}>Carregando...</p>
        ) : recipients.length === 0 ? (
          <p style={styles.helperText}>Nenhum destinatario cadastrado.</p>
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
                  <th style={styles.tableHeadCell}>Nome</th>
                  <th style={styles.tableHeadCell}>Canal</th>
                  <th style={styles.tableHeadCell}>E-mail</th>
                  <th style={styles.tableHeadCell}>WhatsApp</th>
                  <th style={styles.tableHeadCell}>Agendamento</th>
                  <th style={styles.tableHeadCell}>Relatorios</th>
                  <th style={styles.tableHeadCell}>Status</th>
                  <th style={styles.tableHeadCell}>Ultima sincronizacao</th>
                  <th style={{ ...styles.tableHeadCell, textAlign: "right" }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((recipient) => (
                  <tr key={recipient.id} style={{ borderTop: "1px solid var(--kr-border)" }}>
                    <td style={styles.tableCell}>{recipient.displayName ?? "-"}</td>
                    <td style={styles.tableCell}>
                      {recipient.sendEmail && recipient.sendWhatsapp
                        ? "Ambos"
                        : recipient.sendWhatsapp
                          ? "WhatsApp"
                          : "E-mail"}
                    </td>
                    <td style={styles.tableCell}>{recipient.email ?? "-"}</td>
                    <td style={styles.tableCell}>{recipient.whatsappPhone ?? "-"}</td>
                    <td style={styles.tableCell}>
                      {scheduleLabel(recipient.scheduleFrequency, recipient.scheduleTime)}
                    </td>
                    <td style={styles.tableCell}>
                      {REPORT_TYPE_LABEL[recipient.reportTypes ?? "sales"]}
                    </td>
                    <td style={styles.tableCell}>
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
                    <td style={styles.tableCell}>
                      {recipient.lastSyncedAt
                        ? formatDbDateTime(recipient.lastSyncedAt)
                        : "-"}
                    </td>
                    <td
                      style={{
                        ...styles.tableCell,
                        display: "flex",
                        gap: "6px",
                        justifyContent: "flex-end"
                      }}
                    >
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
