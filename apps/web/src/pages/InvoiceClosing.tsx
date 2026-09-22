import { useEffect, useMemo, useState } from "react";

import { Alert, Badge, DataTable, PageHead, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import {
  firstDayOfMonth,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPlate,
  formatTons,
  periodToIso,
  todayIso
} from "../lib/format";
import { q, type BillingRequest, type Operation } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/**
 * Fechamento de faturas: conferencia do periodo e o pedido de faturamento. O site nao fatura
 * — deixa o pedido, a balanca da unidade executa (docs/web-api.md, 4.8) e o resultado volta
 * aqui em `billing_requests`.
 */
export function InvoiceClosing() {
  const user = useUser();
  const toast = useToast();
  const today = todayIso();
  const [start, setStart] = useState(firstDayOfMonth(today));
  const [end, setEnd] = useState(today);
  const [customerFilter, setCustomerFilter] = useState("all");
  const [onlyPending, setOnlyPending] = useState(true);
  const period = useMemo(() => periodToIso(start, end), [start, end]);
  const ops = useAsync(
    () => q.closedOperations(user.companyId, period.startIso, period.endIso),
    [user.companyId, period.startIso, period.endIso]
  );
  const invoices = useMemo(
    () =>
      (ops.data ?? []).filter((op) => op.operation_type === "invoice" && op.status !== "cancelled"),
    [ops.data]
  );
  const ids = useMemo(() => invoices.map((op) => op.id), [invoices]);
  const requests = useAsync(
    () => q.billingRequests(user.companyId, ids),
    [user.companyId, ids.join(",")]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{
    requested: number;
    skipped: { operationId: string; reason: string }[];
  } | null>(null);

  const latestRequest = useMemo(() => {
    const map = new Map<string, BillingRequest>();
    for (const r of requests.data ?? []) if (!map.has(r.operation_id)) map.set(r.operation_id, r);
    return map;
  }, [requests.data]);

  // Enquanto houver pedido pendente/processando, recarrega a cada 10 s para ver o resultado.
  const hasLive = [...latestRequest.values()].some(
    (r) => r.status === "pending" || r.status === "processing"
  );
  useEffect(() => {
    if (!hasLive) return;
    const timer = window.setInterval(() => {
      void requests.reload();
      void ops.reload();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [hasLive]);

  const isBilled = (op: Operation) =>
    Boolean(op.omie_invoice_number) || op.omie_billing_status === "billed";
  const customers = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of invoices)
      map.set(
        op.customer_id ?? op.customer_name ?? "?",
        op.customer_name || "Cliente nao informado"
      );
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);
  const rows = useMemo(
    () =>
      invoices.filter(
        (op) =>
          (customerFilter === "all" || (op.customer_id ?? op.customer_name) === customerFilter) &&
          (!onlyPending || !isBilled(op))
      ),
    [invoices, customerFilter, onlyPending]
  );
  const totals = rows.reduce(
    (acc, op) => ({
      count: acc.count + 1,
      total: acc.total + (op.total_cents ?? 0),
      billed: acc.billed + (isBilled(op) ? 1 : 0)
    }),
    { count: 0, total: 0, billed: 0 }
  );
  const selectable = rows.filter(
    (op) =>
      !isBilled(op) && !["pending", "processing"].includes(latestRequest.get(op.id)?.status ?? "")
  );

  async function requestClosing() {
    setBusy(true);
    try {
      const result = await callWebApi("request_invoice_closing", { operationIds: [...selected] });
      setLastResult({
        requested: Number(result.requested),
        skipped: (result.skipped as { operationId: string; reason: string }[]) ?? []
      });
      toast.push(`${String(result.requested)} pedido(s) de faturamento enviados para a balanca.`);
      setSelected(new Set());
      await requests.reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    } finally {
      setBusy(false);
    }
  }

  function statusOf(op: Operation) {
    if (op.omie_invoice_number) return <Badge kind="ok">NF-e {op.omie_invoice_number}</Badge>;
    if (op.omie_billing_status === "billed") return <Badge kind="ok">faturada</Badge>;
    const request = latestRequest.get(op.id);
    if (request?.status === "pending") return <Badge kind="warn">aguardando a balanca</Badge>;
    if (request?.status === "processing") return <Badge kind="warn">faturando...</Badge>;
    if (request?.status === "failed") return <Badge kind="err">falhou</Badge>;
    if (op.omie_billing_status === "cadastro_incompleto")
      return <Badge kind="err">cadastro incompleto</Badge>;
    if (op.omie_billing_status) return <Badge>{op.omie_billing_status}</Badge>;
    return <Badge>a faturar</Badge>;
  }

  return (
    <>
      <PageHead
        title="Fechamento de faturas"
        description="Pesagens com nota do periodo, pela data de fechamento. O pedido de faturamento e executado pela balanca da unidade."
        actions={
          <>
            <button
              className="btn"
              onClick={() => setSelected(new Set(selectable.map((op) => op.id)))}
              disabled={selectable.length === 0}
            >
              Selecionar a faturar ({selectable.length})
            </button>
            <button
              className="btn primary"
              disabled={busy || selected.size === 0}
              onClick={() => void requestClosing()}
            >
              {busy ? "Enviando..." : `Fazer fechamento (${selected.size})`}
            </button>
          </>
        }
      />
      {(ops.error || requests.error) && <Alert kind="error">{ops.error ?? requests.error}</Alert>}
      {lastResult && lastResult.skipped.length > 0 && (
        <Alert kind="warn">
          {lastResult.requested} pedido(s) enviados; {lastResult.skipped.length} pesagem(ns) ficaram
          de fora:
          <ul style={{ margin: "6px 0 0 18px" }}>
            {lastResult.skipped.map((s) => (
              <li key={s.operationId}>
                {invoices.find((op) => op.id === s.operationId)?.operation_code ?? s.operationId}:{" "}
                {s.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="kpis">
        <div className="kpi">
          <span>Pesagens no filtro</span>
          <strong>{totals.count}</strong>
        </div>
        <div className="kpi">
          <span>Ja faturadas</span>
          <strong>{totals.billed}</strong>
        </div>
        <div className="kpi">
          <span>Total</span>
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
          <select
            className="select"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            style={{ minWidth: 240 }}
          >
            <option value="all">Todos os clientes</option>
            {customers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label className="check">
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
            />
            So as sem nota
          </label>
          {(ops.loading || requests.loading) && (
            <span style={{ color: "var(--muted)" }}>Carregando...</span>
          )}
        </div>
        <DataTable
          rows={rows}
          rowKey={(op) => op.id}
          empty={ops.loading ? "Carregando..." : "Nenhuma pesagem no periodo."}
          columns={[
            {
              key: "sel",
              header: "",
              render: (op) => (
                <input
                  type="checkbox"
                  checked={selected.has(op.id)}
                  disabled={!selectable.includes(op)}
                  onChange={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(op.id)) n.delete(op.id);
                      else n.add(op.id);
                      return n;
                    })
                  }
                />
              )
            },
            {
              key: "date",
              header: "Data",
              render: (op) => formatDate(op.closed_at ?? op.created_at)
            },
            { key: "code", header: "Vale", render: (op) => op.operation_code ?? "—" },
            {
              key: "customer",
              header: "Cliente",
              render: (op) => <strong>{op.customer_name || "—"}</strong>
            },
            { key: "plate", header: "Placa", render: (op) => formatPlate(op.plate) },
            { key: "product", header: "Produto", render: (op) => op.product_description ?? "—" },
            {
              key: "kg",
              header: "Ton",
              numeric: true,
              render: (op) => formatTons(op.net_weight_kg)
            },
            {
              key: "total",
              header: "Total",
              numeric: true,
              render: (op) => formatMoney(op.total_cents)
            },
            { key: "status", header: "Faturamento", render: (op) => statusOf(op) },
            {
              key: "msg",
              header: "Detalhe",
              render: (op) => {
                const request = latestRequest.get(op.id);
                const text = request?.result_message ?? op.omie_billing_message ?? "";
                return text ? (
                  <span
                    className="cell-sub"
                    title={
                      request
                        ? formatDateTime(request.processed_at ?? request.requested_at)
                        : undefined
                    }
                  >
                    {text.slice(0, 80)}
                  </span>
                ) : (
                  ""
                );
              }
            }
          ]}
        />
      </div>
    </>
  );
}
