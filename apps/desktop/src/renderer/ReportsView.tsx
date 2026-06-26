import { useCallback, useEffect, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";

interface RecipientRow {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
  syncStatus: "synced" | "pending" | "error";
  lastError: string | null;
  lastSyncedAt: string | null;
}

interface RecipientFormState {
  email: string;
  displayName: string;
  isActive: boolean;
}

const initialForm: RecipientFormState = {
  email: "",
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
    gridTemplateColumns: "minmax(220px, 1.5fr) minmax(170px, 1fr) 110px auto",
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

  async function handleSave(): Promise<void> {
    if (!desktopApi) return;
    const emailError = validateEmail(form.email);
    if (emailError) {
      setError(emailError);
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        email: form.email.trim().toLowerCase(),
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
      email: recipient.email,
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
            Cadastre os destinatarios que receberao o fechamento diario por e-mail as 20h, conforme
            o PRD 24.6. Tambem e possivel exportar o periodo atual em PDF (A4) e Excel pelo menu
            Insights.
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
          O envio automatico ocorre as 20h via Edge Function e SMTP. Configure
          SMTP_HOST/SMTP_USER/SMTP_PASSWORD/DAILY_REPORT_SENDER nas variaveis de ambiente.
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
            Nenhum destinatario cadastrado. Adicione pelo menos um e-mail acima.
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
                  <th style={{ padding: "8px" }}>E-mail</th>
                  <th style={{ padding: "8px" }}>Status</th>
                  <th style={{ padding: "8px" }}>Ultima sincronizacao</th>
                  <th style={{ padding: "8px" }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((recipient) => (
                  <tr key={recipient.id} style={{ borderTop: "1px solid var(--kr-border)" }}>
                    <td style={{ padding: "8px" }}>{recipient.displayName ?? "-"}</td>
                    <td style={{ padding: "8px" }}>{recipient.email}</td>
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
