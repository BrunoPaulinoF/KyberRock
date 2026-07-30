import { useEffect, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import { IconActionButton } from "./IconActionButton";
import { PriceChangePasswordDialog } from "./PriceChangePasswordDialog";
import { HelpTooltip } from "./Tooltip";
import {
  FINANCIAL_HOURS,
  defaultFinancialTime,
  isSameHourAsKyberRock,
  kyberRockHourLabel
} from "./financial-report-schedule";

// Card "Relatorio financeiro (OMIE)" da tela de Relatorios: em uma unica lista o
// usuario marca quais destinatarios ja cadastrados recebem o resumo executivo de
// financas do OMIE (contas a pagar + extrato) e escolhe o horario proprio de cada
// um. Sem este card so dava para mexer no financeiro abrindo o formulario de cada
// destinatario, um a um.
//
// O horario do financeiro e sempre proprio, nunca "o mesmo dos outros": o
// relatorio do OMIE e montado e enviado pela nuvem (edge function
// financial-report-email, unico lugar que fala com o OMIE), enquanto os
// relatorios do KyberRock saem do proprio computador no horario do card "Envios
// automaticos". Sao dois envios distintos e o usuario escolhe a hora de cada um.
// Como o agendador da nuvem roda de hora em hora e le so a hora, a escolha e
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
  primaryButton: {
    border: "none",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    borderRadius: "10px",
    padding: "9px 14px",
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
  warning: {
    color: "#b45309",
    background: "#fef3c7",
    border: "1px solid #fde68a",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px",
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
  },
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

function recipientLabel(recipient: FinancialRecipientRow): string {
  return recipient.displayName || recipient.email || recipient.whatsappPhone || "Sem identificacao";
}

function channelLabel(recipient: FinancialRecipientRow): string {
  return recipient.email ?? recipient.whatsappPhone ?? "-";
}

interface ModalContent {
  success: boolean;
  title: string;
  message: string;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalContent | null>(null);
  // Hora dos relatorios do KyberRock (card "Envios automaticos"), usada para
  // sugerir uma hora diferente para o OMIE e avisar quando os dois coincidem.
  const [kyberRockHour, setKyberRockHour] = useState(18);
  // Liberar o financeiro para um destinatario exige a senha padrao da unidade (a
  // mesma de alteracao de precos). Depois de confirmada uma vez, o card fica
  // liberado enquanto a tela estiver aberta — marcar varios destinatarios de uma
  // vez nao deve pedir a senha a cada clique.
  const [unlocked, setUnlocked] = useState(false);
  const [pendingEnableId, setPendingEnableId] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifyingPassword, setVerifyingPassword] = useState(false);

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi
      .getReportDispatchConfig()
      .then((config) => {
        if (!cancelled) setKyberRockHour(config.settings.sendHour);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  const activeFinancial = recipients.filter(
    (recipient) => recipient.sendFinancial && recipient.isActive
  );
  const collisions = activeFinancial.filter((recipient) =>
    isSameHourAsKyberRock(recipient.financialScheduleTime, kyberRockHour)
  );

  async function applyPatch(
    id: string,
    patch: { sendFinancial?: boolean; financialScheduleTime?: string | null }
  ): Promise<void> {
    if (!desktopApi) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  function enableFor(recipient: FinancialRecipientRow): void {
    // Ligar ja grava uma hora propria: o financeiro nunca herda o horario dos
    // relatorios do KyberRock.
    void applyPatch(recipient.id, {
      sendFinancial: true,
      financialScheduleTime:
        recipient.financialScheduleTime ?? defaultFinancialTime(kyberRockHour)
    });
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
    enableFor(recipient);
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
      const target = recipients.find((row) => row.id === pendingEnableId);
      setUnlocked(true);
      setPendingEnableId(null);
      setPasswordError(null);
      if (target) enableFor(target);
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

  // "Enviar agora" serve para testar a configuracao sem esperar o horario: a
  // nuvem monta os PDFs do OMIE e envia para os destinatarios marcados.
  async function handleSendNow(): Promise<void> {
    if (!desktopApi) return;
    setBusy(true);
    setError(null);
    try {
      const results = await desktopApi.sendFinancialReportNow();
      const sent = results.reduce((total, result) => total + result.recipients, 0);
      const problems = results
        .filter((result) => result.status === "failed" || result.status === "skipped")
        .map((result) => result.error ?? result.reason ?? result.status);
      const lines: string[] = [];
      lines.push(`Envios concluidos: ${sent}`);
      if (problems.length > 0) {
        lines.push("", "Avisos:", ...problems.slice(0, 5));
      }
      if (results.length === 0) {
        lines.push("A nuvem nao retornou nenhum resultado para esta unidade.");
      }
      setModal({
        success: sent > 0 && problems.length === 0,
        title:
          sent > 0 && problems.length === 0
            ? "Relatorio financeiro enviado!"
            : sent > 0
              ? "Envio parcial"
              : "Nada foi enviado",
        message: lines.join("\n")
      });
    } catch (sendError) {
      setModal({
        success: false,
        title: "Falha no envio",
        message:
          sendError instanceof Error
            ? sendError.message
            : "Falha ao enviar o relatorio financeiro do OMIE."
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h3 style={styles.headerTitle}>Relatorio financeiro (OMIE)</h3>
          <HelpTooltip
            content="Escolha quais destinatarios recebem o resumo executivo de financas do OMIE (contas a pagar + extrato, em PDF) e o horario de cada um. Este relatorio tem horario proprio, separado do horario dos relatorios do KyberRock, porque quem monta e envia e a nuvem — nao depende do computador estar ligado. Liberar o financeiro pede a senha padrao da unidade (a mesma de alteracao de precos)."
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
          {collisions.length > 0 ? (
            <p style={styles.warning}>
              {collisions.length} destinatario(s) com o financeiro no mesmo horario dos relatorios
              do KyberRock ({kyberRockHourLabel(kyberRockHour)}). Escolha uma hora diferente para o
              relatorio do OMIE chegar separado.
            </p>
          ) : null}
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
                    <th style={styles.tableHeadCell}>Horario do OMIE</th>
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
                            disabled={busy}
                            onChange={(event) => handleToggle(recipient, event.target.checked)}
                          />
                          {recipient.sendFinancial ? "Sim" : "Nao"}
                        </label>
                      </td>
                      <td style={styles.tableCell}>
                        {recipient.sendFinancial ? (
                          <select
                            value={
                              recipient.financialScheduleTime ??
                              defaultFinancialTime(kyberRockHour)
                            }
                            disabled={busy}
                            onChange={(event) =>
                              void applyPatch(recipient.id, {
                                financialScheduleTime: event.target.value
                              })
                            }
                            style={styles.select}
                          >
                            {FINANCIAL_HOURS.map((hour, index) => (
                              <option key={hour} value={hour}>
                                {index === kyberRockHour
                                  ? `${hour} (horario dos relatorios KyberRock)`
                                  : hour}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={styles.hint}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={styles.hint}>
            Os relatorios do KyberRock saem as {kyberRockHourLabel(kyberRockHour)} pelo computador; o
            financeiro do OMIE sai pela nuvem no horario escolhido acima, na hora cheia.
            Destinatarios inativos nao recebem, mesmo com o financeiro marcado.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <IconActionButton
              icon="send"
              label="Enviar financeiro agora"
              tip={
                busy
                  ? "Enviando..."
                  : "Enviar o relatorio financeiro do OMIE agora para os destinatarios marcados (para teste)."
              }
              tone="primary"
              placement="top"
              disabled={busy || activeFinancial.length === 0}
              onClick={() => void handleSendNow()}
            />
          </div>
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
