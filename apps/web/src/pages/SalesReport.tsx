import { useMemo, useState } from "react";

import { Alert, DataTable, PageHead } from "../components/ui";
import { useUser } from "../lib/auth";
import {
  firstDayOfMonth,
  formatMoney,
  formatTons,
  localDay,
  periodToIso,
  todayIso
} from "../lib/format";
import { q, type Operation } from "../lib/queries";
import { useAsync } from "../lib/use-async";

type GroupBy = "customer" | "product" | "day";

interface Group {
  key: string;
  label: string;
  count: number;
  kg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

function groupRows(rows: Operation[], by: GroupBy): Group[] {
  const map = new Map<string, Group>();
  for (const row of rows) {
    const key =
      by === "customer"
        ? (row.customer_id ?? row.customer_name ?? "?")
        : by === "product"
          ? (row.product_id ?? row.product_description ?? "?")
          : localDay(row.closed_at ?? row.created_at);
    const label =
      by === "customer"
        ? row.customer_name || "Cliente nao informado"
        : by === "product"
          ? row.product_description || "Produto nao informado"
          : new Date(`${key}T12:00:00Z`).toLocaleDateString("pt-BR");
    const group = map.get(key) ?? {
      key,
      label,
      count: 0,
      kg: 0,
      productCents: 0,
      freightCents: 0,
      totalCents: 0
    };
    group.count++;
    group.kg += row.net_weight_kg ?? 0;
    group.productCents += row.product_total_cents ?? 0;
    group.freightCents += row.freight_total_cents ?? 0;
    group.totalCents += row.total_cents ?? 0;
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) =>
    by === "day" ? a.key.localeCompare(b.key) : b.totalCents - a.totalCents
  );
}

function toCsv(groups: Group[], by: GroupBy): string {
  const head = [
    by === "day" ? "Dia" : by === "customer" ? "Cliente" : "Produto",
    "Pesagens",
    "Toneladas",
    "Produto",
    "Frete",
    "Total"
  ];
  const lines = groups.map((g) => [
    g.label,
    g.count,
    (g.kg / 1000).toFixed(3),
    (g.productCents / 100).toFixed(2),
    (g.freightCents / 100).toFixed(2),
    (g.totalCents / 100).toFixed(2)
  ]);
  return [head, ...lines]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
}

export function SalesReport() {
  const user = useUser();
  const today = todayIso();
  const [start, setStart] = useState(firstDayOfMonth(today));
  const [end, setEnd] = useState(today);
  const [by, setBy] = useState<GroupBy>("customer");
  const period = useMemo(() => periodToIso(start, end), [start, end]);
  const { data, loading, error } = useAsync(
    () => q.closedOperations(user.companyId, period.startIso, period.endIso),
    [user.companyId, period.startIso, period.endIso]
  );
  const rows = useMemo(() => (data ?? []).filter((r) => r.status !== "cancelled"), [data]);
  const groups = useMemo(() => groupRows(rows, by), [rows, by]);
  const totals = useMemo(
    () =>
      groups.reduce(
        (acc, g) => ({
          count: acc.count + g.count,
          kg: acc.kg + g.kg,
          total: acc.total + g.totalCents
        }),
        { count: 0, kg: 0, total: 0 }
      ),
    [groups]
  );

  function download() {
    const blob = new Blob(["﻿" + toCsv(groups, by)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendas-${start}-a-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHead
        kicker="Financeiro"
        title="Relatorio de vendas"
        description="Pesagens concluidas pela data de FECHAMENTO (a mesma que o OMIE usa na nota)."
        actions={
          <button className="btn" onClick={download} disabled={groups.length === 0}>
            Baixar CSV
          </button>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="kpis">
        <div className="kpi">
          <span>Pesagens</span>
          <strong>{totals.count}</strong>
        </div>
        <div className="kpi">
          <span>Toneladas</span>
          <strong>{formatTons(totals.kg)}</strong>
        </div>
        <div className="kpi">
          <span>Total vendido</span>
          <strong>{formatMoney(totals.total)}</strong>
        </div>
      </div>
      <div className="panel">
        <div className="toolbar">
          <label>
            De{" "}
            <input
              className="input"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            ate{" "}
            <input
              className="input"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <select className="select" value={by} onChange={(e) => setBy(e.target.value as GroupBy)}>
            <option value="customer">Por cliente</option>
            <option value="product">Por produto</option>
            <option value="day">Por dia</option>
          </select>
          {loading && <span style={{ color: "var(--kr-muted)" }}>Carregando...</span>}
        </div>
        <DataTable
          rows={groups}
          rowKey={(g) => g.key}
          empty={loading ? "Carregando..." : "Nenhuma venda no periodo."}
          columns={[
            {
              key: "label",
              header: by === "day" ? "Dia" : by === "customer" ? "Cliente" : "Produto",
              render: (g) => <strong>{g.label}</strong>
            },
            { key: "count", header: "Pesagens", numeric: true, render: (g) => g.count },
            { key: "kg", header: "Toneladas", numeric: true, render: (g) => formatTons(g.kg) },
            {
              key: "product",
              header: "Produto",
              numeric: true,
              render: (g) => formatMoney(g.productCents)
            },
            {
              key: "freight",
              header: "Frete",
              numeric: true,
              render: (g) => formatMoney(g.freightCents)
            },
            {
              key: "total",
              header: "Total",
              numeric: true,
              render: (g) => <strong>{formatMoney(g.totalCents)}</strong>
            }
          ]}
        />
      </div>
    </>
  );
}
