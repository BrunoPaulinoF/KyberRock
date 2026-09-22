import { useMemo, useState } from "react";

import { Alert, Badge, DataTable, Field, Modal, PageHead, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatDate, formatMoney, formatPlate, formatTons, todayIso } from "../lib/format";
import { q, type Operation } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/** Carteira: vendas fechadas "em carteira" esperando o combinado de COMO o cliente vai pagar. */
export function Wallet() {
  const user = useUser();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "settled">("open");
  const methods = useAsync(() => q.paymentMethods(user.companyId), [user.companyId]);
  const walletIds = useMemo(
    () => (methods.data ?? []).filter((m) => m.is_wallet).map((m) => m.id),
    [methods.data]
  );
  const ops = useAsync(
    () =>
      walletIds.length
        ? q.walletOperations(user.companyId, walletIds, status)
        : Promise.resolve([] as Operation[]),
    [user.companyId, walletIds.join(","), status]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settling, setSettling] = useState(false);
  const rows = ops.data ?? [];
  const methodName = (id: string | null) => {
    const m = (methods.data ?? []).find((x) => x.id === id);
    return m ? m.alias || m.name : "—";
  };
  const openCents = (op: Operation) =>
    Math.max(0, (op.total_cents ?? 0) - (op.omie_advance_settle_cents ?? 0));
  const selectedTotal = rows
    .filter((r) => selected.has(r.id))
    .reduce((acc, r) => acc + openCents(r), 0);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function reopen(ids: string[]) {
    try {
      const result = await callWebApi("reopen_wallet", { operationIds: ids });
      toast.push(`${String(result.reopened)} venda(s) reaberta(s).`);
      setSelected(new Set());
      await ops.reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <PageHead
        kicker="Financeiro"
        title="Carteira"
        description="Vendas em carteira: a nota ja saiu, falta definir como e quando o cliente paga."
        actions={
          status === "open" ? (
            <button
              className="btn primary"
              disabled={selected.size === 0}
              onClick={() => setSettling(true)}
            >
              Fechar{" "}
              {selected.size > 0
                ? `${selected.size} venda(s) — ${formatMoney(selectedTotal)}`
                : "selecionadas"}
            </button>
          ) : (
            <button
              className="btn"
              disabled={selected.size === 0}
              onClick={() => void reopen([...selected])}
            >
              Reabrir selecionadas
            </button>
          )
        }
      />
      {(methods.error || ops.error) && <Alert kind="error">{methods.error ?? ops.error}</Alert>}
      {methods.data && walletIds.length === 0 && (
        <Alert kind="info">
          Esta pedreira nao tem forma de pagamento "em carteira" cadastrada.
        </Alert>
      )}
      <div className="tabs">
        <button
          className={`tab ${status === "open" ? "active" : ""}`}
          onClick={() => {
            setStatus("open");
            setSelected(new Set());
          }}
        >
          Em aberto
        </button>
        <button
          className={`tab ${status === "settled" ? "active" : ""}`}
          onClick={() => {
            setStatus("settled");
            setSelected(new Set());
          }}
        >
          Fechadas
        </button>
      </div>
      <div className="panel">
        <DataTable
          rows={rows}
          rowKey={(op) => op.id}
          empty={
            ops.loading
              ? "Carregando..."
              : status === "open"
                ? "Nenhuma venda em aberto na carteira."
                : "Nenhum fechamento."
          }
          columns={[
            {
              key: "sel",
              header: "",
              render: (op) => (
                <input
                  type="checkbox"
                  checked={selected.has(op.id)}
                  onChange={() => toggle(op.id)}
                  disabled={status === "settled" && !op.wallet_settlement_method_id}
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
            {
              key: "open",
              header: "A receber",
              numeric: true,
              render: (op) => <strong>{formatMoney(openCents(op))}</strong>
            },
            ...(status === "settled"
              ? [
                  {
                    key: "method",
                    header: "Recebimento",
                    render: (op: Operation) =>
                      op.wallet_settlement_method_id ? (
                        methodName(op.wallet_settlement_method_id)
                      ) : (
                        <Badge kind="accent">adiantamento</Badge>
                      )
                  },
                  {
                    key: "due",
                    header: "Vencimento",
                    render: (op: Operation) => formatDate(op.wallet_settlement_due_date)
                  },
                  {
                    key: "note",
                    header: "Obs.",
                    render: (op: Operation) => op.wallet_settlement_note ?? ""
                  }
                ]
              : [])
          ]}
        />
      </div>

      {settling && (
        <SettleModal
          methods={(methods.data ?? []).filter((m) => m.is_active && !m.is_wallet)}
          count={selected.size}
          total={selectedTotal}
          onClose={() => setSettling(false)}
          onSettled={async () => {
            setSettling(false);
            setSelected(new Set());
            await ops.reload();
          }}
          operationIds={[...selected]}
        />
      )}
    </>
  );
}

function SettleModal({
  methods,
  count,
  total,
  operationIds,
  onClose,
  onSettled
}: {
  methods: { id: string; name: string; alias: string | null }[];
  count: number;
  total: number;
  operationIds: string[];
  onClose: () => void;
  onSettled: () => Promise<void>;
}) {
  const toast = useToast();
  const [methodId, setMethodId] = useState("");
  const [dueDate, setDueDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await callWebApi("settle_wallet", {
        operationIds,
        settlementMethodId: methodId,
        dueDate: dueDate || null,
        note: note.trim() || null
      });
      toast.push(`${String(result.settled)} venda(s) fechada(s).`);
      await onSettled();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Fechar ${count} venda(s) — ${formatMoney(total)}`}
      description="Defina como o cliente vai pagar e o vencimento combinado."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={busy || !methodId}
            onClick={() => void submit()}
          >
            {busy ? "Fechando..." : "Confirmar fechamento"}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="Forma de recebimento">
        <select
          className="select"
          value={methodId}
          onChange={(e) => setMethodId(e.target.value)}
          autoFocus
        >
          <option value="">Escolha</option>
          {methods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.alias || m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vencimento">
        <input
          className="input"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Field>
      <Field label="Observacao">
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: combinado por telefone com o financeiro"
        />
      </Field>
    </Modal>
  );
}
