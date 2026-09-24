import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

import { Picker, type PickerOption } from "../components/Picker";
import { Alert, Badge, DataTable, Field, Modal, PageHead, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import {
  formatDateTime,
  formatDocument,
  formatMoney,
  formatPlate,
  formatTons,
  periodToIso,
  todayIso
} from "../lib/format";
import {
  CLOSED_EDITABLE,
  OPEN_STATUS,
  REQUEST_KIND_LABELS,
  changedFields,
  estimateClose,
  formatDuration,
  isFinished,
  minutesSince,
  parsePriceCents,
  parseWeight,
  printWarning,
  requestStatusText,
  type EditableFields,
  type OperationRequest,
  type RequestKind
} from "../lib/operation";
import { q, type Operation } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { useAsync } from "../lib/use-async";

/**
 * Pesagem pelo site. O site PEDE (web-api `request_operation`) e a balanca executora da
 * unidade EXECUTA pelas mesmas funcoes dos botoes do desktop, imprimindo o cupom do fechamento
 * na impressora dela. Esta tela mostra o patio, monta o pedido e acompanha a resposta ao vivo
 * (enviando -> balanca registrando -> pronto). Contrato em `docs/web-api.md`.
 */

// ---------------------------------------------------------------------------
// Dados compartilhados pelas telas de operacao
// ---------------------------------------------------------------------------

interface Catalog {
  customers: PickerOption[];
  vehicles: PickerOption[];
  drivers: PickerOption[];
  products: PickerOption[];
  carriers: PickerOption[];
  paymentMethods: PickerOption[];
  paymentTerms: PickerOption[];
  customerDefaults: Map<
    string,
    { paymentMethodId: string; paymentTermId: string; carrierId: string }
  >;
}

function useCatalog(companyId: string) {
  return useAsync(async (): Promise<Catalog> => {
    const [customers, vehicles, drivers, products, carriers, methods, terms] = await Promise.all([
      q.customers(companyId),
      q.vehicles(companyId),
      q.drivers(companyId),
      q.products(companyId),
      q.carriers(companyId),
      q.paymentMethods(companyId),
      q.paymentTerms(companyId)
    ]);
    const liveCustomers = customers.filter((row) => row.is_active);
    return {
      customers: liveCustomers.map((row) => ({
        value: row.id,
        label: row.trade_name || row.legal_name,
        hint: formatDocument(row.document) || undefined
      })),
      vehicles: vehicles
        .filter((row) => row.is_active)
        .map((row) => ({
          value: row.id,
          label: formatPlate(row.plate),
          hint: row.description ?? undefined
        })),
      drivers: drivers
        .filter((row) => row.is_active)
        .map((row) => ({ value: row.id, label: row.name, hint: row.document ?? undefined })),
      products: products.map((row) => ({
        value: row.id,
        label: row.description,
        hint: row.code ?? undefined
      })),
      carriers: carriers
        .filter((row) => row.is_active)
        .map((row) => ({
          value: row.id,
          label: row.name,
          hint: formatDocument(row.document) || undefined
        })),
      paymentMethods: methods
        .filter((row) => row.is_active)
        .map((row) => ({ value: row.id, label: row.name })),
      paymentTerms: terms.map((row) => ({ value: row.id, label: row.name })),
      customerDefaults: new Map(
        liveCustomers.map((row) => [
          row.id,
          {
            paymentMethodId: row.default_payment_method_id ?? "",
            paymentTermId: row.default_payment_term_id ?? "",
            carrierId: row.default_carrier_id ?? ""
          }
        ])
      )
    };
  }, [companyId]);
}

interface ExecutorStatus {
  executor: { deviceId: string; name: string; online: boolean; seenAt: string | null } | null;
  requiresPricePassword: boolean;
}

/** A balanca que executa os pedidos: conectada ou nao. Pergunta de 20 em 20 s. */
function useExecutorStatus(): ExecutorStatus | null {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await callWebApi("operation_status");
        if (!cancelled) setStatus(result as unknown as ExecutorStatus);
      } catch {
        // Falha de rede: mantem o ultimo estado e tenta no proximo tique.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return status;
}

/**
 * Pedidos das ultimas 12 h, ao vivo: o Realtime avisa cada mudanca de status e, enquanto houver
 * pedido esperando a balanca, um tique de 3 s cobre aviso perdido. `onFinished` roda quando um
 * pedido termina (e a tela recarrega o patio).
 */
function useRequestFeed(companyId: string, onFinished: () => void) {
  const [requests, setRequests] = useState<OperationRequest[]>([]);
  const finishedRef = useRef(new Set<string>());
  // A primeira leitura so aprende o que ja estava pronto: recarregar o patio por causa de
  // pedidos antigos seria trabalho a toa.
  const initializedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    try {
      const rows = await q.operationRequests(companyId, since);
      let finishedNow = false;
      for (const row of rows) {
        if (isFinished(row) && !finishedRef.current.has(row.id)) {
          finishedRef.current.add(row.id);
          if (initializedRef.current) finishedNow = true;
        }
      }
      initializedRef.current = true;
      setRequests(rows);
      if (finishedNow) onFinishedRef.current();
    } catch {
      // A proxima rodada tenta de novo.
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`operation-requests:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operation_requests",
          filter: `company_id=eq.${companyId}`
        },
        () => void load()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, load]);

  const waiting = requests.some((request) => !isFinished(request));
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  return { requests, reload: load };
}

/** Manda o pedido para a web-api; avisos (balanca fora do ar) viram toast. */
async function sendRequest(
  toast: ReturnType<typeof useToast>,
  kind: RequestKind,
  body: { operationId?: string; data?: Record<string, unknown>; pricePassword?: string }
): Promise<boolean> {
  try {
    const result = await callWebApi("request_operation", { kind, ...body });
    for (const warning of result.warnings) toast.push(warning, "error");
    toast.push(`${REQUEST_KIND_LABELS[kind]} enviada para a balanca.`);
    return true;
  } catch (caught) {
    toast.push(errorMessage(caught), "error");
    return false;
  }
}

function operationLabel(operation: Pick<Operation, "operation_code" | "plate">): string {
  const code =
    operation.operation_code !== null
      ? `Nº ${operation.operation_code.toLocaleString("pt-BR")}`
      : "";
  const plate = operation.plate ? formatPlate(operation.plate) : "sem placa";
  return code ? `${code} · ${plate}` : plate;
}

/** Ctrl+Enter confirma o formulario, como no desktop. */
function submitOnCtrlEnter(event: ReactKeyboardEvent<HTMLFormElement>) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.currentTarget.requestSubmit();
  }
}

// ---------------------------------------------------------------------------
// Cabecalho comum: balanca conectada + pedidos ao vivo
// ---------------------------------------------------------------------------

function ExecutorBadge({ status }: { status: ExecutorStatus | null }) {
  if (!status) return <Badge>Balanca: verificando...</Badge>;
  if (!status.executor) {
    return <Badge kind="warn">Nenhuma balanca executa os pedidos do site</Badge>;
  }
  return status.executor.online ? (
    <Badge kind="ok">Balanca: {status.executor.name} conectada</Badge>
  ) : (
    <Badge kind="err">Balanca: {status.executor.name} fora do ar</Badge>
  );
}

function RequestFeed({ requests }: { requests: OperationRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <div className="panel">
      <div className="toolbar">
        <strong>Pedidos ao vivo</strong>
        <span className="cell-sub" style={{ display: "inline" }}>
          ultimas 12 h
        </span>
      </div>
      <ul className="request-feed">
        {requests.slice(0, 12).map((request) => {
          const warning = printWarning(request);
          const result = request.result as { operationCode?: number; plate?: string } | null;
          return (
            <li key={request.id} className={`request-item ${request.status}`}>
              <span className="request-dot" aria-hidden="true" />
              <div className="request-body">
                <strong>
                  {REQUEST_KIND_LABELS[request.kind]}
                  {result?.operationCode
                    ? ` · Nº ${result.operationCode.toLocaleString("pt-BR")}`
                    : ""}
                  {result?.plate ? ` · ${formatPlate(result.plate)}` : ""}
                </strong>
                <span className="cell-sub">
                  {requestStatusText(request)}
                  {request.result_message && isFinished(request)
                    ? ` — ${request.result_message}`
                    : ""}
                </span>
                {warning && <span className="request-warning">{warning}</span>}
              </div>
              <span className="cell-sub request-when">
                {request.requested_by_name ? `${request.requested_by_name} · ` : ""}
                {formatDateTime(request.requested_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patio
// ---------------------------------------------------------------------------

export function OperationYard() {
  const user = useUser();
  const toast = useToast();
  const executor = useExecutorStatus();
  const catalog = useCatalog(user.companyId);
  const yard = useAsync(
    () => q.openOperations(user.companyId, user.unitId),
    [user.companyId, user.unitId]
  );
  const reloadYard = yard.reload;
  const feed = useRequestFeed(user.companyId, () => void reloadYard());
  const [now, setNow] = useState(() => Date.now());
  const [entryOpen, setEntryOpen] = useState(false);
  const [closing, setClosing] = useState<Operation | null>(null);
  const [editing, setEditing] = useState<Operation | null>(null);
  const [cancelling, setCancelling] = useState<Operation | null>(null);

  // Patio pelo relogio: o tempo de cada caminhao anda, e uma entrada feita no proprio PC da
  // balanca aparece aqui sem ninguem clicar.
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const poll = window.setInterval(() => void reloadYard(), 15_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
    };
  }, [reloadYard]);

  // F2 abre a nova entrada, como no desktop.
  useEffect(() => {
    if (!user.canOperate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        setEntryOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user.canOperate]);

  const rows = yard.data ?? [];
  const pendingOps = useMemo(
    () =>
      new Set(
        feed.requests
          .filter((request) => !isFinished(request))
          .map((request) => request.operation_id)
      ),
    [feed.requests]
  );

  return (
    <>
      <PageHead
        kicker="Operacao"
        title="Patio"
        description="Caminhoes que entraram e ainda nao sairam. O site pede e a balanca registra, com as mesmas regras de preco, frete, credito e OMIE — e o cupom sai na impressora dela."
        actions={
          <>
            <ExecutorBadge status={executor} />
            {user.canOperate && (
              <button className="btn primary" onClick={() => setEntryOpen(true)}>
                Nova entrada (F2)
              </button>
            )}
          </>
        }
      />
      {yard.error && <Alert kind="error">{yard.error}</Alert>}
      {catalog.error && <Alert kind="error">{catalog.error}</Alert>}
      <div className="kpis">
        <div className="kpi">
          <span>No patio</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="kpi">
          <span>Pedidos esperando a balanca</span>
          <strong>{feed.requests.filter((request) => !isFinished(request)).length}</strong>
        </div>
      </div>
      <RequestFeed requests={feed.requests} />
      <div className="panel">
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty={yard.loading ? "Carregando o patio..." : "Nenhum caminhao no patio."}
          columns={[
            {
              key: "plate",
              header: "Pesagem",
              render: (row) => (
                <>
                  <strong>{formatPlate(row.plate ?? "") || "SEM PLACA"}</strong>
                  <span className="cell-sub">
                    {row.operation_code !== null
                      ? `Nº ${row.operation_code.toLocaleString("pt-BR")}`
                      : "sem numero"}
                  </span>
                </>
              )
            },
            {
              key: "customer",
              header: "Cliente",
              render: (row) => (
                <>
                  {row.customer_name || "—"}
                  <span className="cell-sub">{row.driver_name || ""}</span>
                </>
              )
            },
            { key: "product", header: "Produto", render: (row) => row.product_description || "—" },
            {
              key: "entry",
              header: "Entrada",
              numeric: true,
              render: (row) => (
                <>
                  {formatTons(row.entry_weight_kg)}
                  <span className="cell-sub">
                    {formatDuration(minutesSince(row.created_at, now))} no patio
                  </span>
                </>
              )
            },
            {
              key: "type",
              header: "Tipo",
              render: (row) =>
                row.operation_type === "internal" ? (
                  <Badge>sem nota</Badge>
                ) : (
                  <Badge kind="accent">com nota</Badge>
                )
            },
            {
              key: "actions",
              header: "",
              render: (row) =>
                user.canOperate &&
                (pendingOps.has(row.id) ? (
                  <Badge kind="warn">aguardando a balanca</Badge>
                ) : (
                  <span className="actions">
                    <button className="btn small primary" onClick={() => setClosing(row)}>
                      Fechar saida
                    </button>
                    <button className="btn small" onClick={() => setEditing(row)}>
                      Alterar
                    </button>
                    <button className="btn small ghost-danger" onClick={() => setCancelling(row)}>
                      Cancelar
                    </button>
                  </span>
                ))
            }
          ]}
        />
      </div>

      {entryOpen && catalog.data && (
        <EntryModal
          catalog={catalog.data}
          onClose={() => setEntryOpen(false)}
          onSent={() => {
            setEntryOpen(false);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
      {closing && (
        <ExitModal
          operation={closing}
          onClose={() => setClosing(null)}
          onSent={() => {
            setClosing(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
      {editing && catalog.data && (
        <EditModal
          operation={editing}
          catalog={catalog.data}
          requiresPricePassword={executor?.requiresPricePassword ?? false}
          onClose={() => setEditing(null)}
          onSent={() => {
            setEditing(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
      {cancelling && (
        <CancelModal
          operation={cancelling}
          onClose={() => setCancelling(null)}
          onSent={() => {
            setCancelling(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Concluidas
// ---------------------------------------------------------------------------

export function OperationDone() {
  const user = useUser();
  const toast = useToast();
  const executor = useExecutorStatus();
  const catalog = useCatalog(user.companyId);
  const [day, setDay] = useState(todayIso());
  const period = useMemo(() => periodToIso(day, day), [day]);
  const closed = useAsync(
    () => q.closedOperations(user.companyId, period.startIso, period.endIso),
    [user.companyId, period.startIso, period.endIso]
  );
  const reloadClosed = closed.reload;
  const feed = useRequestFeed(user.companyId, () => void reloadClosed());
  const [editing, setEditing] = useState<Operation | null>(null);
  const [cancelling, setCancelling] = useState<Operation | null>(null);

  const rows = useMemo(
    () =>
      (closed.data ?? [])
        .filter((row) => row.status !== "cancelled" && row.unit_id === user.unitId)
        .sort((a, b) => (b.closed_at ?? b.created_at).localeCompare(a.closed_at ?? a.created_at)),
    [closed.data, user.unitId]
  );

  async function reprint(operation: Operation) {
    await sendRequest(toast, "reprint", { operationId: operation.id });
    void feed.reload();
  }

  return (
    <>
      <PageHead
        kicker="Operacao"
        title="Concluidas"
        description="Pesagens fechadas no dia. Reimprimir manda o cupom para a impressora da balanca."
        actions={
          <>
            <ExecutorBadge status={executor} />
            <input
              className="input"
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value || todayIso())}
            />
          </>
        }
      />
      {closed.error && <Alert kind="error">{closed.error}</Alert>}
      <RequestFeed requests={feed.requests} />
      <div className="panel">
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty={closed.loading ? "Carregando..." : "Nenhuma pesagem fechada neste dia."}
          columns={[
            {
              key: "plate",
              header: "Pesagem",
              render: (row) => (
                <>
                  <strong>{formatPlate(row.plate ?? "") || "SEM PLACA"}</strong>
                  <span className="cell-sub">
                    {row.operation_code !== null
                      ? `Nº ${row.operation_code.toLocaleString("pt-BR")}`
                      : "sem numero"}{" "}
                    · {formatDateTime(row.closed_at ?? row.created_at)}
                  </span>
                </>
              )
            },
            {
              key: "customer",
              header: "Cliente",
              render: (row) => (
                <>
                  {row.customer_name || "—"}
                  <span className="cell-sub">{row.product_description || ""}</span>
                </>
              )
            },
            {
              key: "net",
              header: "Liquido",
              numeric: true,
              render: (row) => formatTons(row.net_weight_kg)
            },
            {
              key: "total",
              header: "Total",
              numeric: true,
              render: (row) => formatMoney(row.total_cents)
            },
            {
              key: "nf",
              header: "Nota",
              render: (row) =>
                row.omie_invoice_number ? (
                  <Badge kind="ok">NF {row.omie_invoice_number}</Badge>
                ) : row.operation_type === "internal" ? (
                  <Badge>sem nota</Badge>
                ) : (
                  <Badge kind="warn">a faturar</Badge>
                )
            },
            {
              key: "actions",
              header: "",
              render: (row) =>
                user.canOperate && (
                  <span className="actions">
                    <button className="btn small" onClick={() => void reprint(row)}>
                      Reimprimir
                    </button>
                    <button className="btn small" onClick={() => setEditing(row)}>
                      Alterar
                    </button>
                    <button className="btn small ghost-danger" onClick={() => setCancelling(row)}>
                      Cancelar
                    </button>
                  </span>
                )
            }
          ]}
        />
      </div>

      {editing && catalog.data && (
        <EditModal
          operation={editing}
          catalog={catalog.data}
          requiresPricePassword={executor?.requiresPricePassword ?? false}
          onClose={() => setEditing(null)}
          onSent={() => {
            setEditing(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
      {cancelling && (
        <CancelModal
          operation={cancelling}
          onClose={() => setCancelling(null)}
          onSent={() => {
            setCancelling(null);
            void feed.reload();
          }}
          toast={toast}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Janelas
// ---------------------------------------------------------------------------

type ModalProps = {
  onClose: () => void;
  onSent: () => void;
  toast: ReturnType<typeof useToast>;
};

function EntryModal({ catalog, onClose, onSent, toast }: ModalProps & { catalog: Catalog }) {
  const formId = "entry-form";
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [productId, setProductId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentTermId, setPaymentTermId] = useState("");
  const [operationType, setOperationType] = useState<"invoice" | "internal">("invoice");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // O cliente traz os padroes dele (forma, condicao, transportadora), como no desktop.
  function chooseCustomer(id: string) {
    setCustomerId(id);
    const defaults = catalog.customerDefaults.get(id);
    if (!defaults) return;
    if (defaults.paymentMethodId) setPaymentMethodId(defaults.paymentMethodId);
    if (defaults.paymentTermId) setPaymentTermId(defaults.paymentTermId);
    if (defaults.carrierId) setCarrierId(defaults.carrierId);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const entryWeightKg = parseWeight(weight);
    if (!customerId || !vehicleId || !driverId || !productId) {
      setError("Escolha cliente, placa, motorista e produto.");
      return;
    }
    if (entryWeightKg === null) {
      setError("Digite o peso de entrada em kg.");
      return;
    }
    setBusy(true);
    const ok = await sendRequest(toast, "entry", {
      data: {
        customerId,
        vehicleId,
        driverId,
        productId,
        carrierId: carrierId || undefined,
        paymentMethodId: paymentMethodId || undefined,
        paymentTermId: paymentTermId || undefined,
        operationType,
        entryWeightKg
      }
    });
    setBusy(false);
    if (ok) onSent();
  }

  return (
    <Modal
      title="Nova entrada"
      description="O peso e digitado aqui, como na balanca virtual. A balanca registra e o caminhao entra no patio."
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Registrar entrada (Ctrl+Enter)"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} onKeyDown={submitOnCtrlEnter}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid-2">
          <Field label="Cliente">
            <Picker
              value={customerId}
              options={catalog.customers}
              onChange={chooseCustomer}
              autoFocus
            />
          </Field>
          <Field label="Produto">
            <Picker value={productId} options={catalog.products} onChange={setProductId} />
          </Field>
          <Field label="Placa">
            <Picker value={vehicleId} options={catalog.vehicles} onChange={setVehicleId} />
          </Field>
          <Field label="Motorista">
            <Picker value={driverId} options={catalog.drivers} onChange={setDriverId} />
          </Field>
          <Field label="Transportadora">
            <Picker
              value={carrierId}
              options={catalog.carriers}
              onChange={setCarrierId}
              allowEmpty
              emptyLabel="Sem transportadora"
            />
          </Field>
          <Field label="Tipo">
            <select
              className="select"
              value={operationType}
              onChange={(event) =>
                setOperationType(event.target.value === "internal" ? "internal" : "invoice")
              }
            >
              <option value="invoice">Com nota (venda)</option>
              <option value="internal">Sem nota (interna)</option>
            </select>
          </Field>
          <Field label="Forma de pagamento">
            <Picker
              value={paymentMethodId}
              options={catalog.paymentMethods}
              onChange={setPaymentMethodId}
              allowEmpty
              emptyLabel="Padrao do cliente"
            />
          </Field>
          <Field label="Condicao de pagamento">
            <Picker
              value={paymentTermId}
              options={catalog.paymentTerms}
              onChange={setPaymentTermId}
              allowEmpty
              emptyLabel="A vista"
            />
          </Field>
        </div>
        <Field label="Peso de entrada (kg)" hint="Ex.: 15.420">
          <input
            className="input weight-input"
            inputMode="numeric"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            placeholder="0"
          />
        </Field>
      </form>
    </Modal>
  );
}

function ExitModal({ operation, onClose, onSent, toast }: ModalProps & { operation: Operation }) {
  const formId = "exit-form";
  const [weight, setWeight] = useState("");
  const [operationType, setOperationType] = useState(
    operation.operation_type === "internal" ? "internal" : "invoice"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exitKg = parseWeight(weight);
  const estimate = estimateClose(operation.entry_weight_kg, exitKg, operation.unit_price_cents);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (exitKg === null) {
      setError("Digite o peso de saida em kg.");
      return;
    }
    setBusy(true);
    const data: Record<string, unknown> = { exitWeightKg: exitKg };
    if (operationType !== operation.operation_type) data.operationType = operationType;
    const ok = await sendRequest(toast, "exit", { operationId: operation.id, data });
    setBusy(false);
    if (ok) onSent();
  }

  return (
    <Modal
      title={`Fechar saida — ${operationLabel(operation)}`}
      description={`${operation.customer_name ?? ""} · ${operation.product_description ?? ""}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Fechar e imprimir (Ctrl+Enter)"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} onKeyDown={submitOnCtrlEnter}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid-2">
          <Field label="Peso de entrada">
            <input className="input" value={formatTons(operation.entry_weight_kg)} disabled />
          </Field>
          <Field label="Peso de saida (kg)" hint="Ex.: 40.120">
            <input
              className="input weight-input"
              inputMode="numeric"
              value={weight}
              autoFocus
              onChange={(event) => setWeight(event.target.value)}
              placeholder="0"
            />
          </Field>
        </div>
        <Field label="Tipo">
          <select
            className="select"
            value={operationType}
            onChange={(event) => setOperationType(event.target.value)}
          >
            <option value="invoice">Com nota (venda)</option>
            <option value="internal">Sem nota (interna)</option>
          </select>
        </Field>
        {estimate && (
          <div className="kpis">
            <div className="kpi">
              <span>Liquido</span>
              <strong>{formatTons(estimate.netKg)}</strong>
            </div>
            <div className="kpi">
              <span>Produto (estimativa)</span>
              <strong>
                {estimate.productTotalCents === null
                  ? "—"
                  : formatMoney(estimate.productTotalCents)}
              </strong>
            </div>
          </div>
        )}
        <p className="cell-sub">
          Frete, credito e o valor final a balanca calcula no fechamento. O cupom sai na impressora
          dela.
        </p>
      </form>
    </Modal>
  );
}

function EditModal({
  operation,
  catalog,
  requiresPricePassword,
  onClose,
  onSent,
  toast
}: ModalProps & { operation: Operation; catalog: Catalog; requiresPricePassword: boolean }) {
  const formId = "edit-form";
  const open = operation.status === OPEN_STATUS;
  // A nuvem nao guarda o id da placa e do motorista da pesagem, so o texto: em branco aqui
  // significa "manter", e so vai no pedido se alguem escolher outro.
  const original: EditableFields = useMemo(
    () => ({
      customerId: operation.customer_id ?? "",
      productId: operation.product_id ?? "",
      vehicleId: "",
      driverId: "",
      carrierId: operation.carrier_id ?? "",
      paymentMethodId: operation.payment_method_id ?? "",
      paymentTermId: operation.payment_term_id ?? "",
      operationType: operation.operation_type,
      unitPriceCents: operation.unit_price_cents
    }),
    [operation]
  );
  const [fields, setFields] = useState<EditableFields>(original);
  const [price, setPrice] = useState(
    operation.unit_price_cents
      ? (operation.unit_price_cents / 100).toFixed(2).replace(".", ",")
      : ""
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edited: EditableFields = {
    ...fields,
    unitPriceCents: parsePriceCents(price) ?? original.unitPriceCents
  };
  const changes = changedFields(original, edited, open ? undefined : CLOSED_EDITABLE);
  const priceChanged = "unitPriceCents" in changes;
  const set = (key: keyof EditableFields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (Object.keys(changes).length === 0) {
      setError("Nada foi alterado.");
      return;
    }
    if (priceChanged && requiresPricePassword && !password) {
      setError("Digite a senha de alteracao de preco.");
      return;
    }
    setBusy(true);
    const ok = await sendRequest(toast, "update", {
      operationId: operation.id,
      data: changes,
      pricePassword: priceChanged && requiresPricePassword ? password : undefined
    });
    setBusy(false);
    if (ok) onSent();
  }

  return (
    <Modal
      title={`Alterar — ${operationLabel(operation)}`}
      description={
        open
          ? "Mude o que precisar. So o que for alterado vai para a balanca."
          : "Pesagem concluida: da para trocar cliente, produto ou transportadora."
      }
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Salvar alteracao (Ctrl+Enter)"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} onKeyDown={submitOnCtrlEnter}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid-2">
          <Field label="Cliente">
            <Picker
              value={fields.customerId}
              options={catalog.customers}
              onChange={set("customerId")}
            />
          </Field>
          <Field label="Produto">
            <Picker
              value={fields.productId}
              options={catalog.products}
              onChange={set("productId")}
            />
          </Field>
          <Field label="Transportadora">
            <Picker
              value={fields.carrierId}
              options={catalog.carriers}
              onChange={set("carrierId")}
              allowEmpty
              emptyLabel="Sem transportadora"
            />
          </Field>
          {open && (
            <>
              <Field label="Placa" hint={`Atual: ${formatPlate(operation.plate ?? "") || "—"}`}>
                <Picker
                  value={fields.vehicleId}
                  options={catalog.vehicles}
                  onChange={set("vehicleId")}
                  placeholder="Manter a atual"
                />
              </Field>
              <Field label="Motorista" hint={`Atual: ${operation.driver_name || "—"}`}>
                <Picker
                  value={fields.driverId}
                  options={catalog.drivers}
                  onChange={set("driverId")}
                  placeholder="Manter o atual"
                />
              </Field>
              <Field label="Tipo">
                <select
                  className="select"
                  value={fields.operationType}
                  onChange={(event) => set("operationType")(event.target.value)}
                >
                  <option value="invoice">Com nota (venda)</option>
                  <option value="internal">Sem nota (interna)</option>
                </select>
              </Field>
              <Field label="Forma de pagamento">
                <Picker
                  value={fields.paymentMethodId}
                  options={catalog.paymentMethods}
                  onChange={set("paymentMethodId")}
                  allowEmpty
                  emptyLabel="Sem forma"
                />
              </Field>
              <Field label="Condicao de pagamento">
                <Picker
                  value={fields.paymentTermId}
                  options={catalog.paymentTerms}
                  onChange={set("paymentTermId")}
                  allowEmpty
                  emptyLabel="A vista"
                />
              </Field>
              <Field label="Preco por tonelada (R$)">
                <input
                  className="input"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </Field>
              {priceChanged && requiresPricePassword && (
                <Field label="Senha de alteracao de preco">
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              )}
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

function CancelModal({ operation, onClose, onSent, toast }: ModalProps & { operation: Operation }) {
  const formId = "cancel-form";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError("Escreva o motivo do cancelamento.");
      return;
    }
    setBusy(true);
    const ok = await sendRequest(toast, "cancel", {
      operationId: operation.id,
      data: { reason: reason.trim() }
    });
    setBusy(false);
    if (ok) onSent();
  }

  return (
    <Modal
      title={`Cancelar — ${operationLabel(operation)}`}
      description={
        operation.status === OPEN_STATUS
          ? "O caminhao sai do patio."
          : "Se o pedido ja foi para o OMIE, a balanca pede o cancelamento la tambem."
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn danger" type="submit" form={formId} disabled={busy}>
            {busy ? "Enviando..." : "Cancelar pesagem"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} onKeyDown={submitOnCtrlEnter}>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Motivo">
          <textarea
            className="textarea"
            rows={3}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
