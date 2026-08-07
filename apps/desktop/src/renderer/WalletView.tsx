import { useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { WalletOperation, WalletReport, WalletStatusFilter } from "../services/wallet";
import type { PaymentMethodCacheEntry } from "./customers.types";
import { IconActionButton } from "./IconActionButton";
import { HelpTooltip } from "./Tooltip";

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function formatKg(kg: number | null): string {
  if (kg === null) return "-";
  return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

const EMPTY_REPORT: WalletReport = {
  groups: [],
  summary: {
    openCount: 0,
    openTotalCents: 0,
    settledCount: 0,
    settledTotalCents: 0,
    advanceAppliedTotalCents: 0
  }
};

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
  summary: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
  settleBox: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap" as const,
    alignItems: "flex-end",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    padding: "12px 14px",
    flexShrink: 0
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
    padding: "9px 14px",
    cursor: "pointer",
    fontWeight: 700
  },
  scroll: {
    overflow: "auto" as const,
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px"
  },
  groupCard: {
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    boxShadow: "var(--kr-shadow)",
    overflow: "hidden",
    // O container da lista e uma coluna flex (e o que espaca os cards), e num flex
    // o filho encolhe por padrao. Com poucos clientes cabia tudo e ninguem encolhia;
    // com a carteira da pedreira inteira os cards eram espremidos ate virarem faixas
    // vazias -- a lista "sumia" mesmo com os totais certos no topo. Cada card mantem
    // a propria altura e quem rola e o container.
    flexShrink: 0
  },
  groupHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    background: "var(--kr-surface-soft)",
    borderBottom: "1px solid var(--kr-border)"
  },
  groupName: { fontWeight: 800, color: "var(--kr-text-strong)", fontSize: "14px" },
  groupTotal: { fontWeight: 800, color: "var(--kr-text-strong)" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: {
    padding: "8px 12px",
    textAlign: "left" as const,
    color: "var(--kr-muted)",
    borderBottom: "1px solid var(--kr-border)",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap" as const
  },
  td: {
    padding: "9px 12px",
    borderTop: "1px solid var(--kr-border)",
    verticalAlign: "top" as const
  },
  num: { textAlign: "right" as const },
  plate: {
    display: "inline-block",
    fontWeight: 800,
    letterSpacing: "0.06em",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)",
    borderRadius: "8px",
    padding: "2px 8px"
  },
  settledTag: {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: 800,
    color: "var(--kr-primary-text)",
    background: "var(--kr-primary-strong)",
    borderRadius: "8px",
    padding: "2px 8px"
  },
  muted: { color: "var(--kr-muted)", fontSize: "12px", margin: 0 },
  error: {
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px"
  }
};

/**
 * Carteira: vendas fechadas na forma "em carteira", que sairam da balanca sem forma
 * de recebimento definida. Aqui o operador seleciona as vendas do cliente e registra
 * o fechamento — a forma com que ele vai pagar e o vencimento combinado.
 */
export function WalletView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [status, setStatus] = useState<WalletStatusFilter>("open");
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<WalletReport>(EMPTY_REPORT);
  const [methods, setMethods] = useState<PaymentMethodCacheEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settlementMethodId, setSettlementMethodId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!desktopApi) return;
    setLoading(true);
    setError(null);
    try {
      const result = await desktopApi.walletReport({ status, search: search.trim() || undefined });
      setReport(result);
      // Some da selecao o que saiu do recorte atual (ex.: venda ja fechada).
      const visible = new Set(
        result.groups.flatMap((group) => group.operations.map((operation) => operation.operationId))
      );
      setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a carteira.");
    } finally {
      setLoading(false);
    }
  }, [desktopApi, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!desktopApi) return;
    desktopApi
      .queryCache({ entityType: "payment_method", limit: 200 })
      .then((result) => {
        const rows = result.rows as PaymentMethodCacheEntry[];
        // O fechamento define COMO o cliente paga: outra forma em carteira nao serve.
        setMethods(rows.filter((method) => method.isActive && !method.isWallet));
      })
      .catch(() => setMethods([]));
  }, [desktopApi]);

  const operationsById = useMemo(() => {
    const map = new Map<string, WalletOperation>();
    for (const group of report.groups) {
      for (const operation of group.operations) map.set(operation.operationId, operation);
    }
    return map;
  }, [report]);

  const selectedOperations = useMemo(
    () =>
      [...selected].map((id) => operationsById.get(id)).filter((op): op is WalletOperation => !!op),
    [selected, operationsById]
  );
  // O que o adiantamento ja cobriu nao entra no fechamento: o operador soma aqui o que
  // ainda vai receber das vendas escolhidas.
  const selectedTotalCents = selectedOperations.reduce((sum, op) => sum + op.openAmountCents, 0);
  const selectedOpenCount = selectedOperations.filter((op) => !op.settledAt).length;
  const selectedSettledCount = selectedOperations.length - selectedOpenCount;

  function toggle(operationId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  }

  function toggleGroup(operationIds: string[], checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of operationIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function handleSettle(): Promise<void> {
    if (!desktopApi) return;
    const openIds = selectedOperations.filter((op) => !op.settledAt).map((op) => op.operationId);
    if (openIds.length === 0) {
      setError("Selecione ao menos uma venda em aberto na carteira.");
      return;
    }
    if (!settlementMethodId) {
      setError("Escolha a forma de recebimento do fechamento.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const settledCount = await desktopApi.walletSettle({
        operationIds: openIds,
        settlementMethodId,
        dueDate: dueDate || null,
        note: note.trim() || null
      });
      setNotice(
        `${settledCount} venda(s) fechada(s) em ${
          methods.find((m) => m.id === settlementMethodId)?.displayName ?? "forma escolhida"
        }.`
      );
      setSelected(new Set());
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar o fechamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen(): Promise<void> {
    if (!desktopApi) return;
    const settledIds = selectedOperations.filter((op) => op.settledAt).map((op) => op.operationId);
    if (settledIds.length === 0) {
      setError("Selecione ao menos uma venda ja fechada para reabrir.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const reopened = await desktopApi.walletReopen(settledIds);
      setNotice(`${reopened} venda(s) de volta para a carteira.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reabrir o fechamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h2 style={styles.title}>Carteira</h2>
          <HelpTooltip
            content="Vendas fechadas na forma de pagamento 'Em carteira': elas saem da balanca sem forma de recebimento definida e ficam aqui ate o fechamento, quando voce escolhe como o cliente vai pagar e para quando. Quem pagou adiantado ja chega com a compra abatida do deposito: 'A receber' mostra so o que passou do adiantamento."
            placement="right"
          />
        </div>
        <IconActionButton
          icon="retry"
          label="Atualizar"
          tip="Atualizar"
          tone="neutral"
          placement="top"
          disabled={loading}
          onClick={() => void load()}
        />
      </header>

      <div style={styles.filters}>
        <label style={styles.field}>
          Situacao
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WalletStatusFilter)}
            style={styles.input}
          >
            <option value="open">Em aberto</option>
            <option value="settled">Fechadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <label style={{ ...styles.field, flex: 1, minWidth: "220px" }}>
          Buscar (cliente, placa ou produto)
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex: ACME"
            style={styles.input}
          />
        </label>
      </div>

      {error ? <p style={styles.error}>{error}</p> : null}
      {notice ? <p style={styles.muted}>{notice}</p> : null}

      <div style={styles.summary}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Vendas em aberto</span>
          <span style={styles.cardValue}>{report.summary.openCount}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Total em carteira</span>
          <span style={styles.cardValue}>{formatBRL(report.summary.openTotalCents)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Abatido do adiantamento</span>
          <span style={styles.cardValue}>{formatBRL(report.summary.advanceAppliedTotalCents)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Vendas fechadas</span>
          <span style={styles.cardValue}>{report.summary.settledCount}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Total fechado</span>
          <span style={styles.cardValue}>{formatBRL(report.summary.settledTotalCents)}</span>
        </div>
      </div>

      <div style={styles.settleBox}>
        <label style={styles.field}>
          Forma de recebimento
          <select
            value={settlementMethodId}
            onChange={(event) => setSettlementMethodId(event.target.value)}
            style={styles.input}
          >
            <option value="">Selecione...</option>
            {methods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.displayName}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.field}>
          Vencimento
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            style={styles.input}
          />
        </label>
        <label style={{ ...styles.field, flex: 1, minWidth: "200px" }}>
          Observacao
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex.: combinado com o financeiro"
            style={styles.input}
          />
        </label>
        <button
          type="button"
          style={{ ...styles.primaryButton, opacity: saving || selectedOpenCount === 0 ? 0.6 : 1 }}
          disabled={saving || selectedOpenCount === 0}
          onClick={() => void handleSettle()}
        >
          Fechar {selectedOpenCount > 0 ? `${selectedOpenCount} venda(s)` : "selecionadas"}
        </button>
        <button
          type="button"
          style={{
            ...styles.secondaryButton,
            opacity: saving || selectedSettledCount === 0 ? 0.6 : 1
          }}
          disabled={saving || selectedSettledCount === 0}
          onClick={() => void handleReopen()}
        >
          Reabrir fechamento
        </button>
        <span style={styles.muted}>
          {selectedOperations.length > 0
            ? `Selecionado: ${formatBRL(selectedTotalCents)}`
            : "Selecione as vendas do cliente para fechar."}
        </span>
      </div>

      <div style={styles.scroll}>
        {loading ? (
          <p style={styles.muted}>Carregando...</p>
        ) : report.groups.length === 0 ? (
          <p style={styles.muted}>
            {status === "open"
              ? "Nenhuma venda em carteira aguardando fechamento."
              : "Nenhuma venda em carteira no recorte."}
          </p>
        ) : (
          report.groups.map((group) => {
            const ids = group.operations.map((operation) => operation.operationId);
            const allSelected = ids.every((id) => selected.has(id));
            return (
              <div key={group.customerId ?? group.customerName} style={styles.groupCard}>
                <div style={styles.groupHeader}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => toggleGroup(ids, event.target.checked)}
                      aria-label={`Selecionar vendas de ${group.customerName}`}
                    />
                    <span style={styles.groupName}>{group.customerName}</span>
                  </label>
                  <span style={styles.groupTotal}>
                    {group.operations.length} venda(s) · {formatBRL(group.totalCents)}
                    {group.openTotalCents !== group.totalCents
                      ? ` · a receber ${formatBRL(group.openTotalCents)}`
                      : ""}
                  </span>
                </div>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th} aria-label="Selecao" />
                      <th style={styles.th}>Data</th>
                      <th style={styles.th}>Placa</th>
                      <th style={styles.th}>Produto</th>
                      <th style={{ ...styles.th, ...styles.num }}>Peso</th>
                      <th style={{ ...styles.th, ...styles.num }}>Valor</th>
                      <th style={{ ...styles.th, ...styles.num }}>Adiantamento</th>
                      <th style={{ ...styles.th, ...styles.num }}>A receber</th>
                      <th style={styles.th}>Fechamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.operations.map((operation) => (
                      <tr key={operation.operationId}>
                        <td style={styles.td}>
                          <input
                            type="checkbox"
                            checked={selected.has(operation.operationId)}
                            onChange={() => toggle(operation.operationId)}
                            aria-label={`Selecionar venda de ${formatDate(operation.soldAt)}`}
                          />
                        </td>
                        <td style={styles.td}>{formatDate(operation.soldAt)}</td>
                        <td style={styles.td}>
                          <span style={styles.plate}>{operation.plate}</span>
                        </td>
                        <td style={styles.td}>{operation.productDescription}</td>
                        <td style={{ ...styles.td, ...styles.num }}>
                          {formatKg(operation.netWeightKg)}
                        </td>
                        <td style={{ ...styles.td, ...styles.num }}>
                          {formatBRL(operation.totalCents)}
                        </td>
                        <td style={{ ...styles.td, ...styles.num }}>
                          {operation.advanceAppliedCents > 0
                            ? `- ${formatBRL(operation.advanceAppliedCents)}`
                            : "-"}
                        </td>
                        <td style={{ ...styles.td, ...styles.num }}>
                          {formatBRL(operation.settledAt ? 0 : operation.openAmountCents)}
                        </td>
                        <td style={styles.td}>
                          {operation.settledAt ? (
                            <>
                              <span style={styles.settledTag}>
                                {operation.settledByAdvance
                                  ? "Adiantamento do cliente"
                                  : (operation.settlementMethodName ?? "Fechada")}
                              </span>
                              <div style={styles.muted}>
                                {operation.settlementDueDate
                                  ? `Vence em ${formatDate(operation.settlementDueDate)}`
                                  : `Fechada em ${formatDate(operation.settledAt)}`}
                                {operation.settlementNote ? ` · ${operation.settlementNote}` : ""}
                              </div>
                            </>
                          ) : (
                            <span style={styles.muted}>
                              {operation.advanceAppliedCents > 0
                                ? "Aguardando fechamento do que passou do adiantamento"
                                : "Aguardando fechamento"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
