import "./wallet.css";

import { Lightbulb, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { periodToIso } from "../lib/format";
import {
  INVOICE_CLOSING_PERIOD_KINDS,
  INVOICE_CLOSING_PERIOD_KIND_LABEL,
  defaultInvoiceClosingPeriod,
  formatDayLabel,
  resolveInvoiceClosingPeriod,
  type InvoiceClosingPeriodSelection
} from "../lib/invoice-closing";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import {
  EMPTY_WALLET_REPORT,
  buildWalletReport,
  loadWalletOperations,
  paymentMethodDisplayName,
  splitSelection,
  type WalletOperation,
  type WalletStatusFilter
} from "../lib/wallet";

const HELP =
  "Vendas fechadas na forma de pagamento 'Em carteira': elas saem da balanca sem forma de recebimento definida e ficam aqui ate o fechamento, quando voce escolhe como o cliente vai pagar e para quando. Quem pagou adiantado ja chega com a compra abatida do deposito: 'A receber' mostra so o que passou do adiantamento. O filtro de periodo comeca em 'Tudo em aberto' para nao esconder venda antiga sem receber; escolha a quinzena (ou o mes, a semana, datas livres) quando estiver fechando um periodo com o cliente. O recorte usa a data da OPERACAO, a mesma do Fechamento de faturas, para as duas telas mostrarem a mesma quinzena.";

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(
    "pt-BR",
    value.length === 10 ? undefined : { timeZone: "America/Sao_Paulo" }
  );
}

// Peso em quilos, so o numero: a coluna ja diz "Peso".
function formatKg(kg: number | null): string {
  if (kg === null) return "-";
  return kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** A busca espera a palavra antes de virar filtro (o `useDebouncedValue` do desktop). */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Carteira: vendas fechadas na forma "em carteira", que sairam da balanca sem forma de
 * recebimento definida. O gestor seleciona as vendas do cliente e registra o fechamento — a
 * forma com que ele vai pagar e o vencimento combinado. Mesma tela do desktop (`WalletView`).
 */
export function Wallet() {
  const user = useUser();
  const [status, setStatus] = useState<WalletStatusFilter>("open");
  const [search, setSearch] = useState("");
  // O recorte por periodo comeca DESLIGADO: venda em aberto de tres meses atras continua
  // sendo dinheiro a receber hoje.
  const [periodEnabled, setPeriodEnabled] = useState(false);
  const [period, setPeriod] = useState<InvoiceClosingPeriodSelection>(() =>
    defaultInvoiceClosingPeriod(new Date())
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settlementMethodId, setSettlementMethodId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const range = useMemo(() => resolveInvoiceClosingPeriod(period, new Date()), [period]);
  const debouncedSearch = useDebounced(search);

  const methods = useAsync(() => q.paymentMethods(user.companyId), [user.companyId]);
  const customers = useAsync(() => q.customers(user.companyId), [user.companyId]);
  const walletIds = useMemo(
    () => (methods.data ?? []).filter((method) => method.is_wallet).map((method) => method.id),
    [methods.data]
  );
  // O fechamento define COMO o cliente paga: outra forma em carteira nao serve.
  const settlementMethods = useMemo(
    () => (methods.data ?? []).filter((method) => method.is_active && !method.is_wallet),
    [methods.data]
  );
  const iso = periodEnabled ? periodToIso(range.start, range.end) : null;
  const ops = useAsync(
    () => loadWalletOperations(user.companyId, walletIds, status, iso),
    [user.companyId, walletIds.join(","), status, iso?.startIso ?? "", iso?.endIso ?? ""]
  );

  const report = useMemo(
    () =>
      ops.data
        ? buildWalletReport(ops.data, {
            customers: customers.data ?? [],
            methods: methods.data ?? [],
            search: debouncedSearch
          })
        : EMPTY_WALLET_REPORT,
    [ops.data, customers.data, methods.data, debouncedSearch]
  );

  const operationsById = useMemo(() => {
    const map = new Map<string, WalletOperation>();
    for (const group of report.groups) {
      for (const operation of group.operations) map.set(operation.operationId, operation);
    }
    return map;
  }, [report]);

  // Some da selecao o que saiu do recorte atual (ex.: venda ja fechada).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => operationsById.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [operationsById]);

  const selectedOperations = useMemo(
    () =>
      [...selected].map((id) => operationsById.get(id)).filter((op): op is WalletOperation => !!op),
    [selected, operationsById]
  );
  const { openIds, reopenIds, totalCents: selectedTotalCents } = splitSelection(selectedOperations);

  const loading = ops.loading || methods.loading;
  const error = actionError ?? methods.error ?? customers.error ?? ops.error;

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
    if (openIds.length === 0) {
      setActionError("Selecione ao menos uma venda em aberto na carteira.");
      return;
    }
    if (!settlementMethodId) {
      setActionError("Escolha a forma de recebimento do fechamento.");
      return;
    }
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await callWebApi("settle_wallet", {
        operationIds: openIds,
        settlementMethodId,
        dueDate: dueDate || null,
        note: note.trim() || null
      });
      const method = settlementMethods.find((m) => m.id === settlementMethodId);
      setNotice(
        `${String(result.settled)} venda(s) fechada(s) em ${
          method ? paymentMethodDisplayName(method) : "forma escolhida"
        }.`
      );
      setSelected(new Set());
      setNote("");
      await ops.reload();
    } catch (caught) {
      setActionError(errorMessage(caught, "Falha ao registrar o fechamento."));
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen(): Promise<void> {
    if (reopenIds.length === 0) {
      setActionError("Selecione ao menos uma venda ja fechada para reabrir.");
      return;
    }
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await callWebApi("reopen_wallet", { operationIds: reopenIds });
      setNotice(`${String(result.reopened)} venda(s) de volta para a carteira.`);
      setSelected(new Set());
      await ops.reload();
    } catch (caught) {
      setActionError(errorMessage(caught, "Falha ao reabrir o fechamento."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="wallet">
      <header className="wallet-header">
        <div className="wallet-title-row">
          <h2 className="wallet-title">Carteira</h2>
          <span className="wallet-help" role="img" aria-label="Dica" title={HELP}>
            <Lightbulb size={14} />
          </span>
        </div>
        <button
          type="button"
          className="icon-action"
          aria-label="Atualizar"
          title="Atualizar"
          disabled={loading}
          onClick={() => {
            void methods.reload();
            void ops.reload();
          }}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="wallet-filters">
        <label className="wallet-field">
          Situacao
          <select
            className="wallet-input"
            value={status}
            onChange={(event) => setStatus(event.target.value as WalletStatusFilter)}
          >
            <option value="open">Em aberto</option>
            <option value="settled">Fechadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <label className="wallet-field wallet-search">
          Buscar (cliente, placa ou produto)
          <input
            type="search"
            className="wallet-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex: ACME"
          />
        </label>
        <div className="wallet-field wallet-period">
          Periodo
          <div className="wallet-chip-row">
            <button
              type="button"
              className={`wallet-chip${periodEnabled ? "" : " active"}`}
              onClick={() => setPeriodEnabled(false)}
            >
              Tudo em aberto
            </button>
            {INVOICE_CLOSING_PERIOD_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`wallet-chip${periodEnabled && period.kind === kind ? " active" : ""}`}
                onClick={() => {
                  setPeriodEnabled(true);
                  setPeriod((current) => ({ ...current, kind }));
                }}
              >
                {INVOICE_CLOSING_PERIOD_KIND_LABEL[kind]}
              </button>
            ))}
          </div>
          {periodEnabled ? (
            <>
              <div className="wallet-chip-row">
                {period.kind === "biweekly" || period.kind === "monthly" ? (
                  <input
                    type="month"
                    className="wallet-input"
                    aria-label="Mes do periodo"
                    value={period.month}
                    onChange={(event) =>
                      setPeriod((current) => ({ ...current, month: event.target.value }))
                    }
                  />
                ) : null}
                {period.kind === "biweekly" ? (
                  <>
                    <button
                      type="button"
                      className={`wallet-chip${period.half === 1 ? " active" : ""}`}
                      onClick={() => setPeriod((current) => ({ ...current, half: 1 }))}
                    >
                      1a
                    </button>
                    <button
                      type="button"
                      className={`wallet-chip${period.half === 2 ? " active" : ""}`}
                      onClick={() => setPeriod((current) => ({ ...current, half: 2 }))}
                    >
                      2a
                    </button>
                  </>
                ) : null}
                {period.kind === "weekly" ? (
                  <input
                    type="date"
                    className="wallet-input"
                    aria-label="Qualquer dia da semana"
                    value={period.weekDay}
                    onChange={(event) =>
                      setPeriod((current) => ({ ...current, weekDay: event.target.value }))
                    }
                  />
                ) : null}
                {period.kind === "custom" ? (
                  <>
                    <input
                      type="date"
                      className="wallet-input"
                      aria-label="Data inicial"
                      value={period.customStart}
                      onChange={(event) =>
                        setPeriod((current) => ({ ...current, customStart: event.target.value }))
                      }
                    />
                    <input
                      type="date"
                      className="wallet-input"
                      aria-label="Data final"
                      value={period.customEnd}
                      onChange={(event) =>
                        setPeriod((current) => ({ ...current, customEnd: event.target.value }))
                      }
                    />
                  </>
                ) : null}
              </div>
              <span className="wallet-muted">
                {formatDayLabel(range.start)} a {formatDayLabel(range.end)} — pela data da operacao,
                a mesma do Fechamento de faturas.
              </span>
            </>
          ) : (
            <span className="wallet-muted">
              Sem recorte: mostra tambem as vendas antigas ainda em aberto.
            </span>
          )}
        </div>
      </div>

      {error ? <p className="wallet-error">{error}</p> : null}
      {notice ? <p className="wallet-muted">{notice}</p> : null}
      {methods.data && walletIds.length === 0 ? (
        <p className="wallet-muted">
          Esta pedreira nao tem forma de pagamento &quot;em carteira&quot; cadastrada.
        </p>
      ) : null}

      <div className="wallet-summary">
        <div className="wallet-card">
          <span className="wallet-card-label">Vendas em aberto</span>
          <span className="wallet-card-value">{report.summary.openCount}</span>
        </div>
        <div className="wallet-card">
          <span className="wallet-card-label">Total em carteira</span>
          <span className="wallet-card-value">{formatBRL(report.summary.openTotalCents)}</span>
        </div>
        <div className="wallet-card">
          <span className="wallet-card-label">Abatido do adiantamento</span>
          <span className="wallet-card-value">
            {formatBRL(report.summary.advanceAppliedTotalCents)}
          </span>
        </div>
        <div className="wallet-card">
          <span className="wallet-card-label">Vendas fechadas</span>
          <span className="wallet-card-value">{report.summary.settledCount}</span>
        </div>
        <div className="wallet-card">
          <span className="wallet-card-label">Total fechado</span>
          <span className="wallet-card-value">{formatBRL(report.summary.settledTotalCents)}</span>
        </div>
      </div>

      <div className="wallet-settle">
        <label className="wallet-field">
          Forma de recebimento
          <select
            className="wallet-input"
            value={settlementMethodId}
            onChange={(event) => setSettlementMethodId(event.target.value)}
          >
            <option value="">Selecione...</option>
            {settlementMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {paymentMethodDisplayName(method)}
              </option>
            ))}
          </select>
        </label>
        <label className="wallet-field">
          Vencimento
          <input
            type="date"
            className="wallet-input"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>
        <label className="wallet-field wallet-note">
          Observacao
          <input
            type="text"
            className="wallet-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex.: combinado com o financeiro"
          />
        </label>
        <button
          type="button"
          className="wallet-primary"
          disabled={saving || openIds.length === 0}
          onClick={() => void handleSettle()}
        >
          Fechar {openIds.length > 0 ? `${openIds.length} venda(s)` : "selecionadas"}
        </button>
        <button
          type="button"
          className="wallet-secondary"
          disabled={saving || reopenIds.length === 0}
          onClick={() => void handleReopen()}
        >
          Reabrir fechamento
        </button>
        <span className="wallet-muted">
          {selectedOperations.length > 0
            ? `Selecionado: ${formatBRL(selectedTotalCents)}`
            : "Selecione as vendas do cliente para fechar."}
        </span>
      </div>

      <div className="wallet-scroll">
        {loading && !ops.data ? (
          <p className="wallet-muted">Carregando...</p>
        ) : report.groups.length === 0 ? (
          <p className="wallet-muted">
            {status === "open"
              ? "Nenhuma venda em carteira aguardando fechamento."
              : "Nenhuma venda em carteira no recorte."}
          </p>
        ) : (
          report.groups.map((group) => {
            const ids = group.operations.map((operation) => operation.operationId);
            const allSelected = ids.every((id) => selected.has(id));
            return (
              <div key={group.key} className="wallet-group">
                <div className="wallet-group-header">
                  <label className="wallet-group-check">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => toggleGroup(ids, event.target.checked)}
                      aria-label={`Selecionar vendas de ${group.customerName}`}
                    />
                    <span className="wallet-group-name">{group.customerName}</span>
                  </label>
                  <span className="wallet-group-total">
                    {group.operations.length} venda(s) · {formatBRL(group.totalCents)}
                    {group.openTotalCents !== group.totalCents
                      ? ` · a receber ${formatBRL(group.openTotalCents)}`
                      : ""}
                  </span>
                </div>
                <div className="wallet-table-wrap">
                  <table className="wallet-table">
                    <thead>
                      <tr>
                        <th aria-label="Selecao" />
                        <th>Operacao</th>
                        <th>Saida</th>
                        <th>Placa</th>
                        <th>Produto</th>
                        <th className="num">Peso</th>
                        <th className="num">Valor</th>
                        <th className="num">Adiantamento</th>
                        <th className="num">A receber</th>
                        <th>Fechamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.operations.map((operation) => (
                        <tr key={operation.operationId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(operation.operationId)}
                              onChange={() => toggle(operation.operationId)}
                              aria-label={`Selecionar venda de ${formatDate(operation.soldAt)}`}
                            />
                          </td>
                          <td>{formatDate(operation.operationDate)}</td>
                          <td>{formatDate(operation.soldAt)}</td>
                          <td>
                            <span className="wallet-plate">{operation.plate}</span>
                          </td>
                          <td>{operation.productDescription}</td>
                          <td className="num">{formatKg(operation.netWeightKg)}</td>
                          <td className="num">{formatBRL(operation.totalCents)}</td>
                          <td className="num">
                            {operation.advanceAppliedCents > 0
                              ? `- ${formatBRL(operation.advanceAppliedCents)}`
                              : "-"}
                          </td>
                          <td className="num">
                            {formatBRL(operation.settledAt ? 0 : operation.openAmountCents)}
                          </td>
                          <td>
                            {operation.settledAt ? (
                              <>
                                <span className="wallet-settled-tag">
                                  {operation.settledByAdvance
                                    ? "Adiantamento do cliente"
                                    : (operation.settlementMethodName ?? "Fechada")}
                                </span>
                                <div className="wallet-muted">
                                  {operation.settlementDueDate
                                    ? `Vence em ${formatDate(operation.settlementDueDate)}`
                                    : `Fechada em ${formatDate(operation.settledAt)}`}
                                  {operation.settlementNote ? ` · ${operation.settlementNote}` : ""}
                                </div>
                              </>
                            ) : (
                              <span className="wallet-muted">
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
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
