import { useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import { PriceChangePasswordDialog } from "./PriceChangePasswordDialog";
import { HelpTooltip } from "./Tooltip";

// Card "Relatorio financeiro (OMIE)" da tela de Relatorios: em uma unica lista o
// usuario marca quais destinatarios ja cadastrados recebem o resumo executivo de
// financas do OMIE (contas a pagar + extrato) e escolhe o horario proprio de cada
// um. Sem este card so dava para mexer no financeiro abrindo o formulario de cada
// destinatario, um a um.
//
// O envio do financeiro e feito pela nuvem (edge function financial-report-email,
// unico lugar que fala com o OMIE), que roda de hora em hora e usa exatamente
// estes campos: send_financial e financial_schedule_time. Por isso o horario e
// sempre hora cheia — minutos seriam ignorados no envio.

export interface FinancialRecipientRow {
  id: string;
  email: string | null;
  whatsappPhone: string | null;
  sendFinancial: boolean;
  financialScheduleTime: string | null;
  displayName: string | null;
  isActive: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

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
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px"
  },
  tableScroll: {
    overflow: "auto" as const,
    maxHeight: "320px",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface)"
  },
  tableHeadCell: {
    padding: "8px 12px",
    borderRight: "1px solid var(--kr-border)",
    whiteSpace: "nowrap" as const
  },
  tableCell: {
    padding: "8px 12px",
    borderRight: "1px solid var(--kr-border)",
    minHeight: "44px",
    verticalAlign: "middle" as const
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
  hint: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    margin: 0
  },
  error: {
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
    margin: 0
  }
};

function recipientLabel(recipient: FinancialRecipientRow): string {
  return recipient.displayName || recipient.email || recipient.whatsappPhone || "Sem identificacao";
}

function channelLabel(recipient: FinancialRecipientRow): string {
  return recipient.email ?? recipient.whatsappPhone ?? "-";
}

export function FinancialReportSettings({
  desktopApi,
  recipients,
  onChanged
}: {
  desktopApi: KyberRockDesktopApi | null;
  recipients: FinancialRecipientRow[];
  onChanged: () => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Liberar o financeiro para um destinatario exige a senha padrao da unidade (a
  // mesma de alteracao de precos). Depois de confirmada uma vez, o card fica
  // liberado enquanto a tela estiver aberta — marcar varios destinatarios de uma
  // vez nao deve pedir a senha a cada clique.
  const [unlocked, setUnlocked] = useState(false);
  const [pendingEnableId, setPendingEnableId] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifyingPassword, setVerifyingPassword] = useState(false);

  const activeFinancial = recipients.filter(
    (recipient) => recipient.sendFinancial && recipient.isActive
  );

  async function applyPatch(
    id: string,
    patch: { sendFinancial?: boolean; financialScheduleTime?: string | null }
  ): Promise<void> {
    if (!desktopApi) return;
    setBusyId(id);
    setError(null);
    try {
      await desktopApi.updateReportRecipient(id, patch);
      await onChanged();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Falha ao salvar o relatorio financeiro do destinatario."
      );
    } finally {
      setBusyId(null);
    }
  }

  function handleToggle(recipient: FinancialRecipientRow, checked: boolean): void {
    if (!checked) {
      // Desligar nunca pede senha; zera tambem o horario proprio para o
      // destinatario voltar ao padrao caso seja religado depois.
      void applyPatch(recipient.id, { sendFinancial: false, financialScheduleTime: null });
      return;
    }
    if (!unlocked) {
      setPasswordError(null);
      setPendingEnableId(recipient.id);
      return;
    }
    void applyPatch(recipient.id, { sendFinancial: true });
  }

  async function handleConfirmPassword(password: string): Promise<void> {
    if (!desktopApi || !pendingEnableId || verifyingPassword) return;
    setVerifyingPassword(true);
    try {
      const valid = await desktopApi.verifyPriceChangePassword(password);
      if (!valid) {
        setPasswordError("Senha incorreta.");
        return;
      }
      const id = pendingEnableId;
      setUnlocked(true);
      setPendingEnableId(null);
      setPasswordError(null);
      await applyPatch(id, { sendFinancial: true });
    } catch (verifyError) {
      setPasswordError(
        verifyError instanceof Error
          ? verifyError.message
          : "Falha ao liberar o relatorio financeiro."
      );
    } finally {
      setVerifyingPassword(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h3 style={styles.headerTitle}>Relatorio financeiro (OMIE)</h3>
          <HelpTooltip
            content="Escolha quais destinatarios recebem o resumo executivo de financas do OMIE (contas a pagar + extrato, em PDF) e o horario de envio de cada um. Este relatorio e enviado pela nuvem, entao nao depende do computador estar ligado. Liberar o financeiro pede a senha padrao da unidade (a mesma de alteracao de precos)."
            placement="right"
          />
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {activeFinancial.length > 0 ? (
            <span style={styles.badge("#166534", "#dcfce7")}>
              {activeFinancial.length} destinatario(s)
            </span>
          ) : (
            <span style={styles.badge("#475569", "#e2e8f0")}>Nenhum destinatario</span>
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

      {expanded ? (
        <div style={styles.body}>
          {error ? <p style={styles.error}>{error}</p> : null}
          {recipients.length === 0 ? (
            <p style={styles.hint}>
              Cadastre um destinatario primeiro para escolher quem recebe o financeiro do OMIE.
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
                    <th style={styles.tableHeadCell}>Destinatario</th>
                    <th style={styles.tableHeadCell}>Contato</th>
                    <th style={styles.tableHeadCell}>Recebe o financeiro</th>
                    <th style={styles.tableHeadCell}>Horario do envio</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((recipient) => (
                    <tr key={recipient.id} style={{ borderTop: "1px solid var(--kr-border)" }}>
                      <td style={styles.tableCell}>
                        {recipientLabel(recipient)}
                        {recipient.isActive ? null : (
                          <span style={{ ...styles.hint, marginLeft: "8px" }}>(inativo)</span>
                        )}
                      </td>
                      <td style={styles.tableCell}>{channelLabel(recipient)}</td>
                      <td style={styles.tableCell}>
                        <label
                          style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0 }}
                        >
                          <input
                            type="checkbox"
                            checked={recipient.sendFinancial}
                            disabled={busyId !== null}
                            onChange={(event) => handleToggle(recipient, event.target.checked)}
                          />
                          {recipient.sendFinancial ? "Sim" : "Nao"}
                        </label>
                      </td>
                      <td style={styles.tableCell}>
                        <select
                          value={recipient.financialScheduleTime ?? ""}
                          disabled={busyId !== null || !recipient.sendFinancial}
                          onChange={(event) =>
                            void applyPatch(recipient.id, {
                              financialScheduleTime: event.target.value || null
                            })
                          }
                          style={styles.select}
                        >
                          <option value="">Mesmo horario dos demais relatorios</option>
                          {HOURS.map((hour) => (
                            <option key={hour} value={hour}>
                              {hour}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={styles.hint}>
            O envio roda na hora cheia escolhida. Destinatarios inativos nao recebem, mesmo com o
            financeiro marcado.
          </p>
        </div>
      ) : null}

      {pendingEnableId ? (
        <PriceChangePasswordDialog
          title="Liberar relatorio financeiro (OMIE)"
          description="Digite a senha padrao da unidade (a mesma usada para alterar precos) para liberar o resumo executivo de financas do OMIE."
          error={passwordError}
          submitting={verifyingPassword}
          onCancel={() => {
            setPendingEnableId(null);
            setPasswordError(null);
          }}
          onSubmit={(password) => void handleConfirmPassword(password)}
        />
      ) : null}
    </div>
  );
}
