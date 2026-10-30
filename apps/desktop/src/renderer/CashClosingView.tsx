import { useCallback, useEffect, useState } from "react";

import { formatMoneyInput, parseMoneyInputToCents } from "@kyberrock/shared";

import type { KyberRockDesktopApi } from "../preload/api-types";
import {
  NO_ACCOUNT_KEY,
  NO_CHARGE_KIND_LABEL,
  RECEIVABLE_KIND_LABEL,
  type CashClosingReport
} from "../services/cash-closing-model";
import { operationSaleDay } from "../services/weighing-operation-status";
import { IconActionButton } from "./IconActionButton";
import { HelpTooltip } from "./Tooltip";

/**
 * Fechamento do caixa do dia: vendido x recebido, conta por conta, com o valor que o
 * operador conferiu. A conta e a classificacao vivem em `services/cash-closing.ts`; aqui so
 * se digita o conferido e se mostra a diferenca.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

function formatDifference(cents: number): string {
  if (cents === 0) return formatCents(0);
  return `${cents > 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

/** Hoje no calendario de Sao Paulo: o mesmo dia de venda dos relatorios e do OMIE. */
function todaySaleDay(): string {
  return operationSaleDay(new Date().toISOString());
}

function centsToText(cents: number | undefined): string {
  return cents === undefined ? "" : formatMoneyInput(String(cents / 100));
}

const styles = {
  page: {
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
    minHeight: 0,
    flex: 1
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
    gap: "10px",
    flexShrink: 0
  },
  title: { margin: 0, color: "var(--kr-text-strong)", fontSize: "18px" },
  subtitle: { margin: "4px 0 0 0", color: "var(--kr-muted)", maxWidth: "760px", fontSize: "13px" },
  filters: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap" as const,
    alignItems: "flex-end",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    padding: "12px 14px",
    boxShadow: "var(--kr-shadow)",
    flexShrink: 0
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    fontSize: "12px",
    fontWeight: 700,
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
  moneyInput: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "8px",
    padding: "6px 8px",
    font: "inherit",
    fontSize: "13px",
    width: "120px",
    textAlign: "right" as const,
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  summary: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
    flexShrink: 0
  },
  card: {
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    padding: "12px 14px",
    boxShadow: "var(--kr-shadow)"
  },
  cardLabel: { display: "block", color: "var(--kr-muted)", fontSize: "12px", fontWeight: 700 },
  cardValue: { fontSize: "20px", fontWeight: 800, color: "var(--kr-text-strong)" },
  sectionTitle: { margin: "4px 0 0", fontSize: "14px", color: "var(--kr-text-strong)" },
  tableWrap: {
    overflow: "auto" as const,
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)",
    flexShrink: 0
  },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: {
    padding: "9px 12px",
    textAlign: "left" as const,
    color: "var(--kr-muted)",
    background: "var(--kr-surface-soft)",
    borderBottom: "1px solid var(--kr-border)",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap" as const
  },
  td: {
    padding: "10px 12px",
    borderTop: "1px solid var(--kr-border)",
    verticalAlign: "top" as const
  },
  num: { textAlign: "right" as const, whiteSpace: "nowrap" as const },
  total: { fontWeight: 800, background: "var(--kr-surface-soft)" },
  methodLine: { fontSize: "12px", color: "var(--kr-muted)" },
  ok: { color: "#15803d", fontWeight: 800 },
  short: { color: "#b91c1c", fontWeight: 800 },
  over: { color: "#b45309", fontWeight: 800 },
  muted: { color: "var(--kr-muted)", fontSize: "12px", margin: 0 },
  warning: {
    color: "#92400e",
    background: "#fffbeb",
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
  notes: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "8px 10px",
    font: "inherit",
    fontSize: "13px",
    minHeight: "64px",
    resize: "vertical" as const,
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
    fontWeight: 700,
    alignSelf: "flex-start" as const
  }
};

export function CashClosingView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [date, setDate] = useState<string>(todaySaleDay());
  const [report, setReport] = useState<CashClosingReport | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyReport = useCallback((result: CashClosingReport) => {
    setReport(result);
    const saved = result.saved?.countedCents ?? {};
    setCounted(
      Object.fromEntries(
        result.accounts.map((account) => [account.key, centsToText(saved[account.key])])
      )
    );
    setNotes(result.saved?.notes ?? "");
  }, []);

  const load = useCallback(async () => {
    if (!desktopApi) return;
    setLoading(true);
    setError(null);
    try {
      applyReport(await desktopApi.getCashClosing(date));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o fechamento do caixa.");
    } finally {
      setLoading(false);
    }
  }, [desktopApi, date, applyReport]);

  useEffect(() => {
    void load();
  }, [load]);

  function countedCentsOf(key: string): number | null {
    const text = counted[key] ?? "";
    return text.trim() ? parseMoneyInputToCents(text) : null;
  }

  const invalidKeys = Object.keys(counted).filter(
    (key) => (counted[key] ?? "").trim() !== "" && countedCentsOf(key) === null
  );

  async function handleSave(): Promise<void> {
    if (!desktopApi || !report) return;
    if (invalidKeys.length > 0) {
      setError("Corrija os valores conferidos invalidos antes de salvar.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const values: Record<string, number> = {};
      for (const account of report.accounts) {
        const cents = countedCentsOf(account.key);
        if (cents !== null) values[account.key] = cents;
      }
      await desktopApi.saveCashClosing(date, values, notes);
      setNotice("Conferencia salva.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar a conferencia.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (!desktopApi) return;
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await desktopApi.exportCashClosing(date);
      if (result?.path) setNotice(`PDF salvo em: ${result.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar o PDF.");
    } finally {
      setExporting(false);
    }
  }

  const countedTotal = (report?.accounts ?? []).reduce(
    (sum, account) => sum + (countedCentsOf(account.key) ?? 0),
    0
  );
  const anyCounted = (report?.accounts ?? []).some(
    (account) => countedCentsOf(account.key) !== null
  );
  const hasNoAccount = report?.accounts.some((account) => account.key === NO_ACCOUNT_KEY);
  const missingMethod = report?.receivables.some((line) => line.kind === "sem_forma");

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <h2 style={styles.title}>Fechamento do caixa</h2>
            <HelpTooltip
              content="Confere o que foi vendido no dia com o que entrou em cada conta (caixinha, OMIE Cash, maquininha...). 'Sistema' e o que deveria ter entrado: a parte a vista das vendas do dia e as vendas em carteira que o cliente pagou hoje. Digite em 'Conferido' o que voce contou ou viu no extrato e salve. Boleto, prazo, carteira e fiado ficam em 'A receber' — nao entram no caixa hoje."
              placement="right"
            />
          </div>
          <p style={styles.subtitle}>
            Vendido x recebido no dia, conta por conta. A conta de cada forma de pagamento vem do
            cadastro de formas de pagamento.
          </p>
        </div>
        <IconActionButton
          icon="file-text"
          label="Gerar PDF"
          tip={exporting ? "Gerando PDF..." : "Gerar PDF com a conferencia salva e as assinaturas"}
          tone="primary"
          placement="top"
          disabled={exporting || loading}
          onClick={() => void handleExport()}
        />
      </header>

      <div style={styles.filters}>
        <label style={styles.field}>
          Dia
          <input
            type="date"
            value={date}
            max={todaySaleDay()}
            onChange={(event) => setDate(event.target.value)}
            style={styles.input}
          />
        </label>
        <IconActionButton
          icon="retry"
          label="Atualizar"
          tip="Atualizar"
          tone="neutral"
          placement="top"
          onClick={() => void load()}
        />
        {report?.saved ? (
          <p style={styles.muted}>
            Conferencia salva em {new Date(report.saved.savedAt).toLocaleString("pt-BR")}.
          </p>
        ) : (
          <p style={styles.muted}>Conferencia deste dia ainda nao foi salva.</p>
        )}
      </div>

      {error ? <p style={styles.error}>{error}</p> : null}
      {notice ? <p style={styles.muted}>{notice}</p> : null}
      {hasNoAccount ? (
        <p style={styles.warning}>
          Ha recebimentos em formas de pagamento sem conta vinculada. Vincule a conta em Cadastros
          &gt; Formas de pagamento para o fechamento separar certo.
        </p>
      ) : null}
      {missingMethod ? (
        <p style={styles.warning}>
          Ha vendas sem forma de pagamento informada: elas aparecem em &quot;A receber&quot; ate
          alguem conferir como o cliente pagou.
        </p>
      ) : null}

      <div style={styles.summary}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Vendas do dia</span>
          <span style={styles.cardValue}>{report?.operations ?? 0}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Vendido</span>
          <span style={styles.cardValue}>{formatCents(report?.soldCents ?? 0)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Recebido hoje (sistema)</span>
          <span style={styles.cardValue}>{formatCents(report?.receivedCents ?? 0)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>A receber</span>
          <span style={styles.cardValue}>{formatCents(report?.receivableCents ?? 0)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Sem entrada de dinheiro</span>
          <span style={styles.cardValue}>{formatCents(report?.noChargeCents ?? 0)}</span>
        </div>
      </div>

      <h3 style={styles.sectionTitle}>Recebido hoje, por conta</h3>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Conta</th>
              <th style={styles.th}>De onde veio</th>
              <th style={{ ...styles.th, ...styles.num }}>Sistema</th>
              <th style={{ ...styles.th, ...styles.num }}>Conferido</th>
              <th style={{ ...styles.th, ...styles.num }}>Diferenca</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={styles.td} colSpan={5}>
                  Carregando...
                </td>
              </tr>
            ) : !report || report.accounts.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={5}>
                  Nenhum recebimento na hora neste dia.
                </td>
              </tr>
            ) : (
              <>
                {report.accounts.map((account) => {
                  const value = countedCentsOf(account.key);
                  const difference = value === null ? null : value - account.expectedCents;
                  return (
                    <tr key={account.key}>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{account.accountName}</td>
                      <td style={styles.td}>
                        {account.sales.map((line) => (
                          <div key={`s-${line.paymentMethodName}`} style={styles.methodLine}>
                            {line.paymentMethodName}: {formatCents(line.totalCents)} (
                            {line.operations} venda{line.operations > 1 ? "s" : ""})
                          </div>
                        ))}
                        {account.walletSettlements.map((line) => (
                          <div key={`w-${line.paymentMethodName}`} style={styles.methodLine}>
                            Carteira paga hoje ({line.paymentMethodName}):{" "}
                            {formatCents(line.totalCents)}
                          </div>
                        ))}
                      </td>
                      <td style={{ ...styles.td, ...styles.num }}>
                        {formatCents(account.expectedCents)}
                      </td>
                      <td style={{ ...styles.td, ...styles.num }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Conferido em ${account.accountName}`}
                          placeholder="0,00"
                          value={counted[account.key] ?? ""}
                          onChange={(event) =>
                            setCounted((current) => ({
                              ...current,
                              [account.key]: event.target.value.replace(/[^\d.,]/g, "")
                            }))
                          }
                          onBlur={() =>
                            setCounted((current) => ({
                              ...current,
                              [account.key]: formatMoneyInput(current[account.key] ?? "")
                            }))
                          }
                          style={{
                            ...styles.moneyInput,
                            ...(invalidKeys.includes(account.key) ? { borderColor: "#b91c1c" } : {})
                          }}
                        />
                      </td>
                      <td
                        style={{
                          ...styles.td,
                          ...styles.num,
                          ...(difference === null
                            ? {}
                            : difference === 0
                              ? styles.ok
                              : difference < 0
                                ? styles.short
                                : styles.over)
                        }}
                      >
                        {difference === null
                          ? "-"
                          : difference === 0
                            ? "Confere"
                            : `${formatDifference(difference)} ${difference < 0 ? "(falta)" : "(sobra)"}`}
                      </td>
                    </tr>
                  );
                })}
                <tr style={styles.total}>
                  <td style={styles.td}>TOTAL</td>
                  <td style={styles.td} />
                  <td style={{ ...styles.td, ...styles.num }}>
                    {formatCents(report.receivedCents)}
                  </td>
                  <td style={{ ...styles.td, ...styles.num }}>
                    {anyCounted ? formatCents(countedTotal) : "-"}
                  </td>
                  <td style={{ ...styles.td, ...styles.num }}>
                    {anyCounted ? formatDifference(countedTotal - report.receivedCents) : "-"}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <h3 style={styles.sectionTitle}>A receber (nao entrou no caixa hoje)</h3>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Tipo</th>
              <th style={styles.th}>Forma</th>
              <th style={{ ...styles.th, ...styles.num }}>Vendas</th>
              <th style={{ ...styles.th, ...styles.num }}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {!report || report.receivables.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={4}>
                  Nada a receber das vendas deste dia.
                </td>
              </tr>
            ) : (
              report.receivables.map((line) => (
                <tr key={`${line.kind}-${line.paymentMethodName}`}>
                  <td style={styles.td}>{RECEIVABLE_KIND_LABEL[line.kind]}</td>
                  <td style={styles.td}>{line.paymentMethodName}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{line.operations}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{formatCents(line.totalCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {report && report.noCharge.length > 0 ? (
        <>
          <h3 style={styles.sectionTitle}>Sem entrada de dinheiro</h3>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Motivo</th>
                  <th style={{ ...styles.th, ...styles.num }}>Vendas</th>
                  <th style={{ ...styles.th, ...styles.num }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {report.noCharge.map((line) => (
                  <tr key={line.kind}>
                    <td style={styles.td}>{NO_CHARGE_KIND_LABEL[line.kind]}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{line.operations}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{formatCents(line.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <label style={styles.field}>
        Observacoes do fechamento
        <textarea
          value={notes}
          maxLength={2000}
          placeholder="Ex.: troco inicial de R$ 200,00; sangria de R$ 1.000,00 as 15h"
          onChange={(event) => setNotes(event.target.value)}
          style={styles.notes}
        />
      </label>
      <button
        type="button"
        style={styles.primaryButton}
        disabled={saving || loading || !report}
        onClick={() => void handleSave()}
      >
        {saving ? "Salvando..." : "Salvar conferencia"}
      </button>
    </section>
  );
}
