import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  aggregateSalesReport,
  buildSalesReportCsv,
  SALES_CLOSED_STATUSES,
  type SalesGroupBy,
  type SalesOperationRow
} from "../lib/sales-report";

type PeriodPreset = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";

interface FetchedRow extends SalesOperationRow {
  customer_id: string | null;
  customer_name: string | null;
  product_id: string | null;
  product_description: string | null;
}

const GROUP_OPTIONS: Array<{ value: SalesGroupBy; label: string }> = [
  { value: "product", label: "Produtos" },
  { value: "customer", label: "Clientes" },
  { value: "customer_product", label: "Cliente × Produto" },
  { value: "day", label: "Por dia" }
];

const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "lastMonth", label: "Mês passado" },
  { value: "custom", label: "Personalizado" }
];

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function resolvePeriod(
  preset: PeriodPreset,
  customStart: string,
  customEnd: string
): { startIso: string; endIso: string; label: string } | null {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  if (preset === "custom") {
    const start = parseLocalDate(customStart);
    const end = parseLocalDate(customEnd);
    if (!start || !end || end.getTime() < start.getTime()) return null;
    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    return {
      startIso: start.toISOString(),
      endIso: endExclusive.toISOString(),
      label: `${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")}`
    };
  }
  if (preset === "today") {
    return {
      startIso: todayStart.toISOString(),
      endIso: tomorrowStart.toISOString(),
      label: "hoje"
    };
  }
  if (preset === "7d") {
    const start = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    return {
      startIso: start.toISOString(),
      endIso: tomorrowStart.toISOString(),
      label: "últimos 7 dias"
    };
  }
  if (preset === "30d") {
    const start = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
    return {
      startIso: start.toISOString(),
      endIso: tomorrowStart.toISOString(),
      label: "últimos 30 dias"
    };
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      startIso: start.toISOString(),
      endIso: tomorrowStart.toISOString(),
      label: "este mês"
    };
  }
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startIso: start.toISOString(), endIso: end.toISOString(), label: "mês passado" };
}

function formatMoney(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  })} t`;
}

export function SalesReport() {
  const { user, logout } = useAuth();
  const [groupBy, setGroupBy] = useState<SalesGroupBy>("product");
  const [period, setPeriod] = useState<PeriodPreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [rows, setRows] = useState<FetchedRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const resolvedPeriod = useMemo(
    () => resolvePeriod(period, customStart, customEnd),
    [period, customStart, customEnd]
  );

  const loadRows = useCallback(async () => {
    if (!user?.companyId || !resolvedPeriod) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const fetched: FetchedRow[] = [];
      let hitCap = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await supabase
          .from("weighing_operations")
          .select(
            "customer_id, customer_name, product_id, product_description, net_weight_kg, product_total_cents, freight_total_cents, total_cents, created_at"
          )
          .eq("company_id", user.companyId)
          .in("status", [...SALES_CLOSED_STATUSES])
          .gte("created_at", resolvedPeriod.startIso)
          .lt("created_at", resolvedPeriod.endIso)
          .order("created_at", { ascending: true })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        fetched.push(...((data ?? []) as FetchedRow[]));
        if (!data || data.length < PAGE_SIZE) break;
        if (page === MAX_PAGES - 1) hitCap = true;
      }
      setRows(fetched);
      setTruncated(hitCap);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Falha ao carregar as vendas do período."
      );
    } finally {
      setIsLoading(false);
    }
  }, [user?.companyId, resolvedPeriod]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const id = row.customer_id ?? row.customer_name;
      if (id) map.set(id, row.customer_name || "Cliente não informado");
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const productOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const id = row.product_id ?? row.product_description;
      if (id) map.set(id, row.product_description || "Produto não informado");
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (customerFilter !== "all" && (row.customer_id ?? row.customer_name) !== customerFilter) {
          return false;
        }
        if (
          productFilter !== "all" &&
          (row.product_id ?? row.product_description) !== productFilter
        ) {
          return false;
        }
        return true;
      }),
    [rows, customerFilter, productFilter]
  );

  const report = useMemo(
    () => aggregateSalesReport(filteredRows, groupBy),
    [filteredRows, groupBy]
  );

  function handleExportCsv(): void {
    const csv = buildSalesReportCsv(report, groupBy);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `relatorio-vendas-${groupBy}-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const groupColumns =
    groupBy === "customer_product"
      ? ["Cliente", "Produto"]
      : groupBy === "customer"
        ? ["Cliente"]
        : groupBy === "product"
          ? ["Produto"]
          : ["Dia"];

  return (
    <main className="loader-page report-page">
      <header className="loader-header report-no-print">
        <div className="operator-chip" aria-label={`Usuário ${user?.name ?? ""}`}>
          <span className="operator-avatar" aria-hidden="true">
            {(user?.name ?? "C").slice(0, 1).toUpperCase()}
          </span>
          <div>
            <span className="operator-name">{user?.name ?? user?.email ?? "Comercial"}</span>
            <span className="operator-role">Comercial</span>
          </div>
        </div>
        <button onClick={() => void logout()} className="secondary-action">
          Sair
        </button>
      </header>

      <section className="queue-panel" aria-labelledby="sales-report-title">
        <div className="queue-panel-header report-no-print">
          <div>
            <h2 id="sales-report-title" className="queue-panel-title">
              Relatório de vendas
            </h2>
            <p className="queue-panel-subtitle">
              Visões por produto, cliente e período — {resolvedPeriod?.label ?? "período inválido"}
            </p>
          </div>
          <div className="report-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => window.print()}
              disabled={report.lines.length === 0}
            >
              Imprimir / PDF
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={handleExportCsv}
              disabled={report.lines.length === 0}
            >
              Exportar CSV
            </button>
          </div>
        </div>

        <div className="report-controls report-no-print">
          <div className="report-tabs" role="tablist" aria-label="Visão do relatório">
            {GROUP_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={groupBy === option.value}
                className={`report-tab${groupBy === option.value ? " report-tab--active" : ""}`}
                onClick={() => setGroupBy(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="field-label report-field">
            Período
            <select
              className="field-input"
              value={period}
              onChange={(event) => setPeriod(event.target.value as PeriodPreset)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {period === "custom" ? (
            <>
              <label className="field-label report-field">
                De
                <input
                  type="date"
                  className="field-input"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </label>
              <label className="field-label report-field">
                Até
                <input
                  type="date"
                  className="field-input"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </label>
            </>
          ) : null}

          <label className="field-label report-field">
            Cliente
            <select
              className="field-input"
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {customerOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label report-field">
            Produto
            <select
              className="field-input"
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {productOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadError ? (
          <div className="error-banner report-no-print" role="alert">
            <span>{loadError}</span>
            <button type="button" className="secondary-action" onClick={() => void loadRows()}>
              Tentar novamente
            </button>
          </div>
        ) : null}

        {truncated ? (
          <p className="report-warning">
            Período com mais de {MAX_PAGES * PAGE_SIZE} operações — reduza o período para ver tudo.
          </p>
        ) : null}

        {isLoading ? (
          <p className="report-empty">Carregando vendas…</p>
        ) : report.lines.length === 0 ? (
          <p className="report-empty">Nenhuma venda concluída no período selecionado.</p>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  {groupColumns.map((column) => (
                    <th key={column} className="report-th-text">
                      {column}
                    </th>
                  ))}
                  <th>Operações</th>
                  <th>Peso líquido</th>
                  <th>Preço médio /t</th>
                  <th>Valor produto</th>
                  <th>Frete</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => (
                  <tr key={line.key}>
                    {groupBy === "customer_product" ? (
                      <>
                        <td className="report-td-text">{line.customerName}</td>
                        <td className="report-td-text">{line.productDescription}</td>
                      </>
                    ) : (
                      <td className="report-td-text">
                        {groupBy === "customer"
                          ? line.customerName
                          : groupBy === "product"
                            ? line.productDescription
                            : line.day
                              ? new Date(`${line.day}T12:00:00`).toLocaleDateString("pt-BR")
                              : "—"}
                      </td>
                    )}
                    <td>{line.operations}</td>
                    <td>{formatTons(line.netWeightKg)}</td>
                    <td>{formatMoney(line.avgPriceCentsPerTon)}</td>
                    <td>{formatMoney(line.productTotalCents)}</td>
                    <td>{formatMoney(line.freightTotalCents)}</td>
                    <td>
                      <strong>{formatMoney(line.totalCents)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="report-td-text" colSpan={groupColumns.length}>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>{report.totals.operations}</strong>
                  </td>
                  <td>
                    <strong>{formatTons(report.totals.netWeightKg)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(report.totals.avgPriceCentsPerTon)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(report.totals.productTotalCents)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(report.totals.freightTotalCents)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(report.totals.totalCents)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
