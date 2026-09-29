import "./wallet.css";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PlateBadge } from "../components/desk";
import { Picker } from "../components/Picker";
import {
  Alert,
  EmptyState,
  ErrorState,
  PageHeader,
  Pill,
  SkeletonRows,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { periodToIso } from "../lib/format";
import {
  INVOICE_CLOSING_PERIOD_KINDS,
  INVOICE_CLOSING_PERIOD_KIND_LABEL,
  formatDayLabel,
  resolveInvoiceClosingPeriod
} from "../lib/invoice-closing";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import { useUrlState } from "../lib/url-state";
import {
  EMPTY_WALLET_REPORT,
  buildWalletReport,
  loadWalletOperations,
  paymentMethodDisplayName,
  splitSelection,
  type WalletOperation,
  type WalletStatusFilter
} from "../lib/wallet";
import { FilterInput, oneOf, useClosingPeriodParams } from "./url-filters";

const WALLET_STATUSES: readonly WalletStatusFilter[] = ["open", "settled", "all"];

const HELP =
  "Vendas fechadas na forma de pagamento 'Em carteira': elas saem da balança sem forma de recebimento definida e ficam aqui até o fechamento, quando você escolhe como o cliente vai pagar e para quando. Quem pagou adiantado já chega com a compra abatida do depósito: 'A receber' mostra só o que passou do adiantamento. O filtro de período começa em 'Tudo em aberto' para não esconder venda antiga sem receber; escolha a quinzena (ou o mês, a semana, datas livres) quando estiver fechando um período com o cliente. O recorte usa a data da OPERAÇÃO, a mesma do Fechamento de faturas, para as duas telas mostrarem a mesma quinzena.";

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
  const toast = useToast();
  // Situacao, busca e periodo ficam no endereco e voltam quando a pessoa sai e volta pelo menu
  // (`useUrlState`).
  const [statusParam, setStatus] = useUrlState("situacao", "open");
  const status = oneOf(statusParam, WALLET_STATUSES, "open");
  const [search, setSearch] = useUrlState("busca");
  // O recorte por periodo comeca DESLIGADO (sem `periodo` no endereco): venda em aberto de tres
  // meses atras continua sendo dinheiro a receber hoje.
  const periodParams = useClosingPeriodParams("");
  const periodEnabled = periodParams.enabled;
  const period = periodParams.selection;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settlementMethodId, setSettlementMethodId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const range = useMemo(() => resolveInvoiceClosingPeriod(period, new Date()), [period]);
  const debouncedSearch = useDebounced(search);

  const methods = useAsync(() => q.paymentMethods(user.companyId), [user.companyId], {
    key: `carteira:formas:${user.companyId}`
  });
  const customers = useAsync(() => q.customers(user.companyId), [user.companyId], {
    key: `carteira:clientes:${user.companyId}`
  });
  useOnCadastroChange(methods.refresh, CADASTRO_TABLES.payment);
  useOnCadastroChange(customers.refresh, CADASTRO_TABLES.customers);
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
  const walletIdsKey = walletIds.join(",");
  // A busca filtra na tela: a leitura e so empresa + formas em carteira + situacao + periodo.
  const ops = useAsync(
    () => loadWalletOperations(user.companyId, walletIds, status, iso),
    [user.companyId, walletIdsKey, status, iso?.startIso ?? "", iso?.endIso ?? ""],
    {
      key: `carteira:vendas:${user.companyId}:${walletIdsKey}:${status}:${iso ? `${iso.startIso}:${iso.endIso}` : "tudo"}`
    }
  );
  // Pesagem fechada, editada ou cancelada na balanca entra na tela na hora.
  useOnCadastroChange(ops.refresh, CADASTRO_TABLES.operations);

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
  const loadError = methods.error ?? customers.error ?? ops.error;

  /** "Tentar de novo" do erro de leitura: rele so o que falhou. */
  function retryFailedReads(): void {
    for (const read of [methods, customers, ops]) {
      if (read.error) void read.reload();
    }
  }

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
    try {
      const result = await callWebApi("settle_wallet", {
        operationIds: openIds,
        settlementMethodId,
        dueDate: dueDate || null,
        note: note.trim() || null
      });
      const method = settlementMethods.find((m) => m.id === settlementMethodId);
      toast.push(
        `${String(result.settled)} ${result.settled === 1 ? "venda fechada" : "vendas fechadas"} em ${
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
      setActionError("Selecione ao menos uma venda já fechada para reabrir.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const result = await callWebApi("reopen_wallet", { operationIds: reopenIds });
      toast.push(
        `${String(result.reopened)} ${result.reopened === 1 ? "venda" : "vendas"} de volta para a carteira.`
      );
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
      <PageHeader
        kicker="Operacional"
        title="Carteira"
        help={HELP}
        actions={
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
        }
      />

      <div className="wallet-filters">
        <label className="wallet-field">
          Situação
          <select
            className="wallet-input"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="open">Em aberto</option>
            <option value="settled">Fechadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <label className="wallet-field wallet-search">
          Buscar (cliente, placa ou produto)
          <FilterInput
            type="search"
            className="wallet-input"
            value={search}
            onValue={setSearch}
            placeholder="Ex: ACME"
          />
        </label>
        <div className="wallet-field wallet-period">
          Período
          <div className="wallet-chip-row">
            <button
              type="button"
              className={`wallet-chip${periodEnabled ? "" : " active"}`}
              onClick={() => periodParams.setKind("")}
            >
              Tudo em aberto
            </button>
            {INVOICE_CLOSING_PERIOD_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`wallet-chip${periodEnabled && period.kind === kind ? " active" : ""}`}
                onClick={() => periodParams.setKind(kind)}
              >
                {INVOICE_CLOSING_PERIOD_KIND_LABEL[kind]}
              </button>
            ))}
          </div>
          {periodEnabled ? (
            <>
              <div className="wallet-chip-row">
                {period.kind === "biweekly" || period.kind === "monthly" ? (
                  <FilterInput
                    type="month"
                    className="wallet-input"
                    aria-label="Mês do período"
                    value={period.month}
                    onValue={periodParams.setMonth}
                    keepLastValid
                  />
                ) : null}
                {period.kind === "biweekly" ? (
                  <>
                    <button
                      type="button"
                      className={`wallet-chip${period.half === 1 ? " active" : ""}`}
                      onClick={() => periodParams.setHalf(1)}
                    >
                      1ª
                    </button>
                    <button
                      type="button"
                      className={`wallet-chip${period.half === 2 ? " active" : ""}`}
                      onClick={() => periodParams.setHalf(2)}
                    >
                      2ª
                    </button>
                  </>
                ) : null}
                {period.kind === "weekly" ? (
                  <FilterInput
                    type="date"
                    className="wallet-input"
                    aria-label="Qualquer dia da semana"
                    value={period.weekDay}
                    onValue={periodParams.setWeekDay}
                    keepLastValid
                  />
                ) : null}
                {period.kind === "custom" ? (
                  <>
                    <FilterInput
                      type="date"
                      className="wallet-input"
                      aria-label="Data inicial"
                      value={period.customStart}
                      onValue={periodParams.setCustomStart}
                      keepLastValid
                    />
                    <FilterInput
                      type="date"
                      className="wallet-input"
                      aria-label="Data final"
                      value={period.customEnd}
                      onValue={periodParams.setCustomEnd}
                      keepLastValid
                    />
                  </>
                ) : null}
              </div>
              <span className="wallet-muted">
                {formatDayLabel(range.start)} a {formatDayLabel(range.end)} — pela data da operação,
                a mesma do Fechamento de faturas.
              </span>
            </>
          ) : (
            <span className="wallet-muted">
              Sem recorte: mostra também as vendas antigas ainda em aberto.
            </span>
          )}
        </div>
      </div>

      {loadError ? <ErrorState message={loadError} onRetry={retryFailedReads} /> : null}
      {actionError ? <Alert kind="error">{actionError}</Alert> : null}
      {methods.data && walletIds.length === 0 ? (
        <Alert kind="info">
          Esta pedreira não tem forma de pagamento &quot;em carteira&quot; cadastrada.
        </Alert>
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
        <div className="wallet-field">
          Forma de recebimento
          <Picker
            value={settlementMethodId}
            options={settlementMethods.map((method) => ({
              value: method.id,
              label: paymentMethodDisplayName(method)
            }))}
            onChange={setSettlementMethodId}
            placeholder="Buscar forma de recebimento..."
          />
        </div>
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
          Observação
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
          Fechar{" "}
          {openIds.length > 0
            ? `${openIds.length} ${openIds.length === 1 ? "venda" : "vendas"}`
            : "selecionadas"}
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
          <div className="wallet-group">
            <SkeletonRows rows={5} columns={6} />
          </div>
        ) : report.groups.length === 0 ? (
          <EmptyState
            title={
              status === "open"
                ? "Nenhuma venda em carteira aguardando fechamento."
                : "Nenhuma venda em carteira no recorte."
            }
          />
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
                    {group.operations.length} {group.operations.length === 1 ? "venda" : "vendas"} ·{" "}
                    {formatBRL(group.totalCents)}
                    {group.openTotalCents !== group.totalCents
                      ? ` · a receber ${formatBRL(group.openTotalCents)}`
                      : ""}
                  </span>
                </div>
                <div className="wallet-table-wrap">
                  <table className="wallet-table">
                    <thead>
                      <tr>
                        <th aria-label="Seleção" />
                        <th>Operação</th>
                        <th>Saída</th>
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
                            <PlateBadge plate={operation.plate} />
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
                                <Pill tone="success">
                                  {operation.settledByAdvance
                                    ? "Adiantamento do cliente"
                                    : (operation.settlementMethodName ?? "Fechada")}
                                </Pill>
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
